/**
 * Midas Form 4 research parser (non-derivative Table I only).
 * Never interpret a grant (A), exercise (M), tax withholding (F), or gift as a purchase.
 * Form 4 code P includes private purchases; it is NOT necessarily exchange buying.
 * No trader identity is inferred from anonymous market prints.
 */
export type SecTicker = { cik_str: number; ticker: string; title: string };
export type SecRecent = {
  form?: string[];
  accessionNumber?: string[];
  primaryDocument?: string[];
  acceptanceDateTime?: string[];
  filingDate?: string[];
};
export type SecSubmission = { cik?: string; name?: string; filings?: { recent?: SecRecent } };
export type SecFiling = { accession: string; primaryDocument: string; acceptedAtRaw: string | null; filedAt: string };
export type SecInsiderRecord = {
  issuer_cik: string;
  issuer_ticker: string;
  issuer_name: string;
  owner_cik: string;
  owner_name: string;
  owner_role: string;
  accession: string;
  filing_accepted_at_raw: string | null;
  filing_date: string;
  observed_at: string;
  transaction_date: string;
  transaction_index: number;
  security_title: string;
  transaction_code: string;
  acquire_dispose: string;
  shares: number;
  price_per_share: number | null;
  reported_notional_usd: number | null;
  ownership_form: string | null;
  plan_10b5_1: boolean | null;
  classification: "reported_purchase" | "reported_sale" | "other_reported_transaction";
  source_url: string;
};

const entityDecode = (text: string) => text.replace(/&(amp|lt|gt|quot|apos|#39);/g, entity =>
  ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&#39;": "'" })[entity] ?? entity);
const field = (xml: string, tag: string): string | null => {
  const match = xml.match(new RegExp("<" + tag + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + tag + ">", "i"));
  return match ? entityDecode(match[1].replace(/<[^>]+>/g, "").trim()) : null;
};
const segment = (xml: string, tag: string): string | null => {
  const match = xml.match(new RegExp("<" + tag + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + tag + ">", "i"));
  return match?.[1] ?? null;
};
const number = (s: string | null) => {
  if (s === null || !/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const isDate = (s: string) => /^20\d\d-\d\d-\d\d$/.test(s) && !Number.isNaN(Date.parse(s));
export function mapSecTickers(raw: unknown): Map<string, SecTicker> {
  const values = raw && typeof raw === "object" ? Object.values(raw) : [];
  const result = new Map<string, SecTicker>();
  for (const entry of values) {
    const row = entry as Partial<SecTicker> | null;
    if (!row || typeof row.ticker !== "string" || !/^[A-Z][A-Z0-9.-]{0,9}$/.test(row.ticker)
      || typeof row.cik_str !== "number" || !Number.isSafeInteger(row.cik_str) || row.cik_str <= 0
      || typeof row.title !== "string") continue;
    result.set(row.ticker.toUpperCase(), { ticker: row.ticker, cik_str: row.cik_str, title: row.title });
  }
  return result;
}

export function selectForm4Filings(input: SecSubmission, maxItems = 3): SecFiling[] {
  const r = input.filings?.recent;
  if (!r?.form || !r.accessionNumber || !r.primaryDocument || !r.filingDate) return [];
  const accepted = r.acceptanceDateTime ?? [];
  const out: SecFiling[] = [];
  for (let i = 0; i < Math.min(r.form.length, 1500); i += 1) {
    // Handle 4/A separately after amendment-chain reconciliation is implemented.
    if (r.form[i] !== "4") continue;
    const accession = r.accessionNumber[i] ?? "";
    const primaryDocument = r.primaryDocument[i] ?? "";
    const filedAt = r.filingDate[i] ?? "";
    if (!/^\d{10}-\d{2}-\d{6}$/.test(accession) || !isDate(filedAt)
      || !/^[a-zA-Z0-9._/-]{1,120}\.xml$/i.test(primaryDocument)
      || primaryDocument.includes("..") || primaryDocument.startsWith("/")) continue;
    out.push({ accession, primaryDocument, acceptedAtRaw: accepted[i] ?? null, filedAt });
    if (out.length >= maxItems) break;
  }
  return out;
}
export function secFilingUrl(cik: string, filing: SecFiling): string {
  if (!/^\d{1,10}$/.test(cik)) throw new Error("Invalid issuer CIK");
  if (!/^\d{10}-\d{2}-\d{6}$/.test(filing.accession)
      || filing.primaryDocument.includes("..") || filing.primaryDocument.startsWith("/")
      || !/^[a-zA-Z0-9._/-]+\.xml$/i.test(filing.primaryDocument)) throw new Error("Invalid SEC filing path");
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${filing.accession.replaceAll("-", "")}/${filing.primaryDocument}`;
}

export function parseSecForm4(
  xml: string, cik: string, ticker: string, filing: SecFiling, firstObserved: string,
): SecInsiderRecord[] {
  if (xml.length > 1_500_000 || !/<ownershipDocument(?:\s|>)/.test(xml)) return [];
  const issuer = segment(xml, "issuer");
  const issuerCik = issuer ? field(issuer, "issuerCik") : null;
  const issuerTicker = issuer ? field(issuer, "issuerTradingSymbol") : null;
  if (!issuer || !issuerCik || Number(issuerCik) !== Number(cik) || issuerTicker?.toUpperCase() !== ticker.toUpperCase()) return [];

  // Multiple reporting owners may have joint or divergent ownership; no invented attribution.
  const owners = [...xml.matchAll(/<reportingOwner(?:\s[^>]*)?>([\s\S]*?)<\/reportingOwner>/gi)];
  if (owners.length !== 1) return [];
  const owner = owners[0][1];
  const id = segment(owner, "reportingOwnerId");
  const relation = segment(owner, "reportingOwnerRelationship");
  const ownerName = id && field(id, "rptOwnerName");
  const ownerCik = id && field(id, "rptOwnerCik");
  if (!ownerName || !ownerCik || !/^\d{1,10}$/.test(ownerCik)) return [];
  const roles = [
    field(relation ?? "", "isOfficer") === "1" ? field(relation ?? "", "officerTitle") || "Officer" : null,
    field(relation ?? "", "isDirector") === "1" ? "Director" : null,
    field(relation ?? "", "isTenPercentOwner") === "1" ? "10% owner" : null,
    field(relation ?? "", "isOther") === "1" ? "Other" : null,
  ].filter((x): x is string => Boolean(x));

  const nonDerivative = segment(xml, "nonDerivativeTable");
  if (!nonDerivative) return [];
  const items = [...nonDerivative.matchAll(/<nonDerivativeTransaction(?:\s[^>]*)?>([\s\S]*?)<\/nonDerivativeTransaction>/gi)].slice(0, 100);
  const planValue = field(xml, "aff10b5One");
  const plan: boolean | null = planValue === "1" || planValue === "true" ? true
    : planValue === "0" || planValue === "false" ? false : null;
  const observed = Date.parse(firstObserved);
  if (!Number.isFinite(observed)) return [];

  const out: SecInsiderRecord[] = [];
  for (let idx = 0; idx < items.length; idx += 1) {
    const body = items[idx][1];
    const dt = segment(body, "transactionDate");
    const coding = segment(body, "transactionCoding");
    const amounts = segment(body, "transactionAmounts");
    const date = dt && field(dt, "value");
    const code = coding && field(coding, "transactionCode");
    const shares = number(field(segment(amounts ?? "", "transactionShares") ?? "", "value"));
    const price = number(field(segment(amounts ?? "", "transactionPricePerShare") ?? "", "value"));
    const side = field(segment(amounts ?? "", "transactionAcquiredDisposedCode") ?? "", "value");
    const securityTitle = field(segment(body, "securityTitle") ?? "", "value") || "Unspecified";
    const form = field(segment(body, "ownershipNature") ?? "", "directOrIndirectOwnership");
    if (!date || !isDate(date) || !code || !/^[A-Z]$/.test(code) || shares === null || shares <= 0
      || (side !== "A" && side !== "D") || date > firstObserved.slice(0,10)) continue;
    const classification = code === "P" && side === "A" ? "reported_purchase"
      : code === "S" && side === "D" ? "reported_sale" : "other_reported_transaction";
    out.push({
      issuer_cik: String(Number(cik)),
      issuer_ticker: ticker.toUpperCase(),
      issuer_name: field(issuer, "issuerName") || ticker,
      owner_cik: String(Number(ownerCik)),
      owner_name: ownerName.slice(0, 200),
      owner_role: roles.join("; ").slice(0, 200),
      accession: filing.accession,
      filing_accepted_at_raw: filing.acceptedAtRaw,
      filing_date: filing.filedAt,
      observed_at: firstObserved,
      transaction_date: date,
      transaction_index: idx,
      security_title: securityTitle.slice(0, 120),
      transaction_code: code,
      acquire_dispose: side,
      shares,
      price_per_share: price,
      reported_notional_usd: price === null ? null : Number((shares * price).toFixed(2)),
      ownership_form: form && /^[DI]$/.test(form) ? form : null,
      plan_10b5_1: plan,
      classification,
      source_url: secFilingUrl(cik, filing),
    });
  }
  return out;
}
