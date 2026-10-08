import { NextResponse } from "next/server";
import { mapSecTickers, parseSecForm4, secFilingUrl, selectForm4Filings, type SecSubmission } from "@/lib/midas-sec-insider";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const DB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://yufptpfiwdbzzrvhkvux.supabase.co";
const SEC_DATA = "https://data.sec.gov/submissions";

type Prospect = { symbol?: string; asset_class?: string; last_seen_at?: string };
type RunStatus = "ok" | "partial" | "source-unavailable" | "not-configured";
const reply = (payload: unknown, status = 200) => NextResponse.json(payload, {
  status, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
});

async function secFetch(url: string, userAgent: string): Promise<Response> {
  // Allowlist prevents SSRF and limits requests to SEC data and archival files.
  if (!url.startsWith("https://data.sec.gov/submissions/") &&
      !url.startsWith("https://www.sec.gov/Archives/edgar/data/") &&
      url !== "https://www.sec.gov/files/company_tickers.json") throw new Error("SEC URL rejected");
  const response = await fetch(url, {
    headers: { "User-Agent": userAgent, Accept: "application/json, application/xml, text/xml" },
    cache: "no-store", signal: AbortSignal.timeout(9_000),
  });
  if (!response.ok) throw new Error(`SEC HTTP ${response.status}`);
  return response;
}

export async function GET(request: Request) {
  const cron = process.env.CRON_SECRET?.trim();
  if (!cron || request.headers.get("authorization") !== `Bearer ${cron}`) return reply({ error: "Unauthorized" }, 401);
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!key) return reply({ error: "Midas evidence storage unavailable" }, 503);
  const dbHeaders: Record<string, string> = { apikey: key, Accept: "application/json" };
  if (key.startsWith("eyJ")) dbHeaders.Authorization = `Bearer ${key}`;
  const secUserAgent = process.env.SEC_USER_AGENT?.trim();
  // SEC asks automated fetchers to identify themselves with valid contact details.
  if (!secUserAgent || !/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(secUserAgent)) {
    return reply({ module: "midas-sec-form4-v1", status: "not-configured",
      message: "SEC_USER_AGENT with project contact email is required", tradeAuthority: false }, 503);
  }

  let symbols = ["MSFT", "NVDA"];
  try {
    const response = await fetch(
      `${DB_URL}/rest/v1/paper_prospects?select=symbol,asset_class,last_seen_at&asset_class=eq.stock&status=neq.expired&order=score.desc&limit=40`,
      { headers: dbHeaders, cache: "no-store", signal: AbortSignal.timeout(8_000) },
    );
    if (response.ok) {
      const rows = await response.json() as Prospect[];
      const recent = rows.filter(row => typeof row.symbol === "string" &&
        /^[A-Z][A-Z0-9.]{0,8}$/.test(row.symbol)
        && typeof row.last_seen_at === "string"
        && Date.now() - Date.parse(row.last_seen_at) >= 0
        && Date.now() - Date.parse(row.last_seen_at) <= 7 * 86_400_000);
      symbols = [...new Set([...recent.slice(0, 2).map(row => row.symbol!), ...symbols])].slice(0, 4);
    }
  } catch {
    // Known liquid company pilot sentinels still permit SEC source connectivity checks.
  }

  let symbolsChecked = 0;
  let filingsChecked = 0;
  let rowsPrepared = 0;
  const failures: string[] = [];
  const started = new Date().toISOString();
  let tickers;
  try {
    const response = await secFetch("https://www.sec.gov/files/company_tickers.json", secUserAgent);
    const body = await response.text();
    if (body.length > 3_000_000) throw new Error("SEC ticker index exceeds size cap");
    tickers = mapSecTickers(JSON.parse(body) as unknown);
    if (!tickers.size) throw new Error("SEC ticker index contained no valid mappings");
  } catch (error) {
    failures.push(`ticker-map: ${error instanceof Error ? error.message : "unavailable"}`);
  }

  if (tickers) {
    // Serial company batches bound external API request rate well below SEC fair-access limits.
    for (const symbol of symbols) {
      const company = tickers.get(symbol);
      if (!company) { failures.push(`${symbol}: no SEC ticker mapping`); continue; }
      symbolsChecked += 1;
      try {
        const issuerCik = String(company.cik_str).padStart(10, "0");
        const submissionResponse = await secFetch(`${SEC_DATA}/CIK${issuerCik}.json`, secUserAgent);
        const subText = await submissionResponse.text();
        if (subText.length > 4_000_000) throw new Error("SEC submissions response too large");
        const submission = JSON.parse(subText) as SecSubmission;
        if (Number(submission.cik) !== company.cik_str) throw new Error("Issuer CIK mismatch");
        const filings = selectForm4Filings(submission, 2);
        for (const filing of filings) {
          filingsChecked += 1;
          try {
            const url = secFilingUrl(String(company.cik_str), filing);
            const response = await secFetch(url, secUserAgent);
            const xml = await response.text();
            const observed = new Date().toISOString();
            const parsed = parseSecForm4(xml, String(company.cik_str), symbol, filing, observed);
            if (parsed.length === 0) {
              failures.push(`${symbol}: no attributable Table I entries in ${filing.accession}`);
              continue;
            }
            const store = await fetch(
              `${DB_URL}/rest/v1/paper_midas_sec_insider_transactions?on_conflict=issuer_cik,accession,transaction_index`,
              {
                method: "POST",
                headers: { ...dbHeaders, "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates,return=minimal" },
                body: JSON.stringify(parsed),
                cache: "no-store", signal: AbortSignal.timeout(8_000),
              },
            );
            if (!store.ok) {
              failures.push(`${symbol}: persistence rejected (HTTP ${store.status})`);
              continue;
            }
            rowsPrepared += parsed.length;
          } catch (error) {
            failures.push(`${symbol}: filing read failed (${error instanceof Error ? error.message : "unknown"})`);
          }
        }
      } catch (error) {
        failures.push(`${symbol}: submissions unavailable (${error instanceof Error ? error.message : "unknown"})`);
      }
    }
  }

  const status: RunStatus = !tickers ? "source-unavailable"
    : failures.length ? "partial" : "ok";
  const result = {
    module: "midas-sec-form4-v1", status, researchOnly: true, tradeAuthority: false,
    startedAt: started, symbolsChecked, filingsChecked, rowsSavedOrDeduplicated: rowsPrepared,
    failures: failures.slice(0, 16),
    // Ownership data never changes scan thresholds or authorizes stock purchases.
  };
  const log = await fetch(`${DB_URL}/rest/v1/paper_midas_sec_scan_runs`, {
    method: "POST",
    headers: { ...dbHeaders, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({
      collected_at: started, status, symbols_checked: symbolsChecked,
      filings_checked: filingsChecked, rows_saved_or_deduplicated: rowsPrepared,
      source_failures: failures.slice(0, 16),
    }),
    cache: "no-store", signal: AbortSignal.timeout(8_000),
  }).catch(() => null);
  if (!log?.ok) return reply({ error: "Midas SEC scan could not journal its outcome", ...result }, 502);
  return reply(result, status === "source-unavailable" ? 503 : 200);
}
