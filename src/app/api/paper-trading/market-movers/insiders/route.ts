import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
const DATABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://yufptpfiwdbzzrvhkvux.supabase.co";

export async function GET() {
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!key) return NextResponse.json({ error: "SEC research storage unavailable" }, { status: 503 });
  const headers: Record<string, string> = { apikey: key, Accept: "application/json" };
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;
  const [rows, runs] = await Promise.all([
    fetch(
      `${DATABASE_URL}/rest/v1/paper_midas_sec_insider_transactions?select=issuer_ticker,issuer_name,owner_name,owner_role,filing_date,filing_accepted_at_raw,observed_at,transaction_date,classification,transaction_code,acquire_dispose,shares,price_per_share,reported_notional_usd,ownership_form,plan_10b5_1,source_url&order=observed_at.desc&limit=75`,
      { headers, cache: "no-store", signal: AbortSignal.timeout(9_000) },
    ),
    fetch(
      `${DATABASE_URL}/rest/v1/paper_midas_sec_scan_runs?select=collected_at,status,symbols_checked,filings_checked,rows_saved_or_deduplicated,source_failures&order=collected_at.desc&limit=5`,
      { headers, cache: "no-store", signal: AbortSignal.timeout(9_000) },
    ),
  ]).catch(() => [null, null]);
  if (!rows?.ok || !runs?.ok) return NextResponse.json({ error: "Midas SEC research temporarily unavailable" }, { status: 503 });
  return NextResponse.json({
    module: "midas-sec-form4-v1",
    status: "research-only",
    executionEnabled: false,
    disclosureTiming: "first observed by CreatorHub, not original transaction date",
    transactions: await rows.json(),
    scanRuns: await runs.json(),
  }, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120", "X-Robots-Tag": "noindex" } });
}
