import { NextResponse } from "next/server";
import { DEFAULT_PAPER_WATCHLIST } from "@/lib/paper-watchlist";
import { evaluatePaperCandidate, type DecisionCandle } from "@/lib/paper-decision-engine";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { GET as readOnlyMarketSnapshot } from "@/app/api/paper-trading/market-data/route";
import { atlasEvaluationIds, atlasJournalPayload } from "@/lib/paper-atlas-decision-audit";

export const dynamic = "force-dynamic";

// Auditing is intentionally independent of execution. No broker trading client or
// submission handler is imported by this route.
type Quote = { bid?: number | null; ask?: number | null; timestamp?: string | null };
type CryptoBook = { product: string; timestamp: string | null;
  bestBid?: { price: number } | null; bestAsk?: { price: number } | null; candles: DecisionCandle[] };
type Market = { stocks: Record<string, Quote>; stockBars: Record<string, DecisionCandle[]>;
  crypto: CryptoBook[]; sources?: Record<string, unknown>; errors?: Record<string, unknown> };
type Ledger = { equity: number | string; open_planned_risk_pct: number | string | null;
  correlated_risk_pct: number | string | null; daily_realized_loss_pct: number | string | null;
  weekly_drawdown_pct: number | string | null; last_synced_at: string | null };
type Prospect = { asset_class: string; symbol: string; scanner_id: string; scanner_version: number;
  score: number | string; status: string; last_scanned_at: string;
  assigned_bot_ids: string[]; source_updated_at: string | null };

const numeric = (v: number | string | null | undefined) =>
  v == null || !Number.isFinite(Number(v)) ? null : Number(v);

function response(body: unknown, status = 200) {
  return NextResponse.json(body, {status, headers: {"Cache-Control": "no-store"}});
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`)
    return response({error: "Unauthorized."}, 401);
  if (!process.env.SUPABASE_SECRET_KEY) return response({error: "Audit storage unavailable."}, 503);

  const db = createAdminSupabaseClient();
  const {data: ledgers, error: ledgerError} = await db.from("paper_bot_ledgers")
    .select("equity,open_planned_risk_pct,correlated_risk_pct,daily_realized_loss_pct,weekly_drawdown_pct,last_synced_at")
    .eq("bot_id","default-diverse").limit(1);
  if (ledgerError || !ledgers?.[0]) return response({error: "Atlas ledger risk context unavailable."},503);
  const ledger = ledgers[0] as Ledger;

  const stocks = DEFAULT_PAPER_WATCHLIST.stocks.map(v => v.symbol);
  const crypto = DEFAULT_PAPER_WATCHLIST.crypto.map(v => v.symbol);
  const marketUrl = new URL("/api/paper-trading/market-data", request.url);
  marketUrl.searchParams.set("stocks", stocks.join(","));
  marketUrl.searchParams.set("crypto", crypto.join(","));
  const snapshotResponse = await readOnlyMarketSnapshot(new Request(marketUrl));
  if (!snapshotResponse.ok) return response({error:"Read-only market snapshot unavailable; no candidate events fabricated."},503);
  const market = await snapshotResponse.json() as Market;
  const {data: prospectRows, error: prospectError} = await db.from("paper_prospects")
    .select("asset_class,symbol,scanner_id,scanner_version,score,status,last_scanned_at,assigned_bot_ids,source_updated_at")
    .in("symbol", [...new Set([...stocks, ...crypto.map(s => s.replace("-", "/"))])]);
  if (prospectError) return response({error:"Scanner attribution unavailable; no incomplete candidate records written."},503);
  const bySymbol = new Map((prospectRows as Prospect[] ?? []).map(p => [`${p.asset_class}:${p.symbol}`,p]));
  const cryptoBySymbol = new Map((market.crypto ?? []).map(book => [book.product, book]));
  const risk = {accountEquity:numeric(ledger.equity),openRiskPct:numeric(ledger.open_planned_risk_pct),
    correlatedRiskPct:numeric(ledger.correlated_risk_pct),dailyRealizedLossPct:numeric(ledger.daily_realized_loss_pct),
    weeklyDrawdownPct:numeric(ledger.weekly_drawdown_pct)};
  const now = Date.now();
  const evaluatedAt = new Date(now).toISOString();
  const scanBucketUtc = new Date(Math.floor(now / 300_000) * 300_000).toISOString();
  const benchmarkStocks = market.stockBars?.SPY ?? [];
  const benchmarkCrypto = cryptoBySymbol.get("BTC-USD")?.candles ?? [];
  const auditRows = [];

  for (const candidate of [...DEFAULT_PAPER_WATCHLIST.stocks, ...DEFAULT_PAPER_WATCHLIST.crypto]) {
    const assetClass = stocks.includes(candidate.symbol) ? "stock" as const : "crypto" as const;
    const book = assetClass === "crypto" ? cryptoBySymbol.get(candidate.symbol) : null;
    const quote = assetClass === "stock" ? market.stocks?.[candidate.symbol] : {
      bid: book?.bestBid?.price ?? null, ask: book?.bestAsk?.price ?? null, timestamp: book?.timestamp ?? null,
    };
    const candles = assetClass === "stock" ? market.stockBars?.[candidate.symbol] ?? [] : book?.candles ?? [];
    const benchmarkCandles = assetClass === "stock" ? benchmarkStocks : benchmarkCrypto;
    const result = evaluatePaperCandidate({
      candidate,assetClass,quote:{bid:quote?.bid ?? null,ask:quote?.ask ?? null,timestamp:quote?.timestamp ?? null},
      candles,benchmarkCandles,now,risk,
    });
    if (result.orderSubmission !== false) throw new Error("Atlas audit cannot submit a trade.");
    const scannerSymbol = assetClass === "crypto" ? candidate.symbol.replace("-","/") : candidate.symbol;
    const prospect = bySymbol.get(`${assetClass}:${scannerSymbol}`) ?? null;
    const ids = atlasEvaluationIds({assetClass,symbol:candidate.symbol,scanBucketUtc});
    const scanIsAssigned = prospect?.assigned_bot_ids?.includes("default-diverse") ?? false;
    auditRows.push(atlasJournalPayload({
      decision:result,ids,evaluatedAt,scanBucketUtc,
      inputProvenance:{
        engine:"paper-medium-high-v1",candidateSource:"persisted-paper-watchlist",
        marketSources:market.sources ?? {},marketErrors:market.errors ?? {},
        latestBarAt:candles.at(-1)?.time ?? null,
        latestBenchmarkBarAt:benchmarkCandles.at(-1)?.time ?? null,
        quoteAt:quote?.timestamp ?? null,
        ledgerRiskSnapshotAt:ledger.last_synced_at,
        scanner:prospect ? {scannerId:prospect.scanner_id,scannerVersion:prospect.scanner_version,
          symbol:prospect.symbol,score:prospect.score,scannedAt:prospect.last_scanned_at,
          sourceUpdatedAt:prospect.source_updated_at,assignedToAtlas:scanIsAssigned,
          note:"A scanner score/assignment is not an Atlas strategy decision."}:null,
      },
    }));
  }
  let written = 0, duplicate = 0, errors = 0;
  for (const entry of auditRows) {
    const {data,error} = await db.rpc("paper_atlas_record_candidate",{p_event:entry});
    if (error) {errors++;continue;}
    if (data === true) written++;
    else duplicate++;
  }
  if (errors) return response({ok:false,readOnly:true,evaluated:auditRows.length,written,duplicate,
    errors,scanBucketUtc,note:"Some candidate journal writes failed; retry is safe."},503);
  return response({ok:true,readOnly:true,ordersSubmitted:0,scanBucketUtc,evaluated:auditRows.length,
    written,duplicate,watchlistOnly:true,unmatchedScannerProspectsNotStrategyEvaluated:true});
}
