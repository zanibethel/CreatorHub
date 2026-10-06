import { NextResponse } from "next/server";
import { z } from "zod";
import { evaluateCryptoSwingCandidate, type CryptoSwingBar } from "@/lib/paper-crypto-swing-readiness";
import { CRYPTO_SWING_STRATEGY_V1 as strategy } from "@/lib/paper-crypto-swing-strategy-config";

export const dynamic = "force-dynamic";

const BOT_ID = strategy.botProfileId;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://yufptpfiwdbzzrvhkvux.supabase.co";
const ALPACA_DATA = "https://data.alpaca.markets";

const prospectSchema = z.object({
  symbol: z.string(),
  score: z.coerce.number().finite(),
  news_score: z.coerce.number().finite().min(-100).max(100),
  news_bot_impact: z.coerce.number().finite().min(-20).max(20),
  news_evidence_count: z.coerce.number().int().nonnegative(),
  reasons: z.array(z.string()),
  first_seen_at: z.string(),
  assigned_bot_ids: z.array(z.string()),
});
const ledgerSchema = z.object({
  status: z.enum(["active","planned","paused"]),
  equity: z.coerce.number().finite().nonnegative(),
  buying_power: z.coerce.number().finite().nullable(),
  open_planned_risk_pct: z.coerce.number().finite().nullable(),
  metadata: z.object({ executionEnabled: z.boolean().optional() }).passthrough(),
});
const positionSchema = z.object({
  symbol: z.string(),
  quantity: z.coerce.number().finite().positive(),
});
const quoteSchema = z.object({
  bp: z.coerce.number().finite().positive().optional(),
  ap: z.coerce.number().finite().positive().optional(),
  t: z.string().optional(),
});
const barSchema = z.object({
  t: z.string(),
  o: z.coerce.number().finite().positive(),
  h: z.coerce.number().finite().positive(),
  l: z.coerce.number().finite().positive(),
  c: z.coerce.number().finite().positive(),
  v: z.coerce.number().finite().nonnegative().default(0),
});

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers:{ "Cache-Control":"no-store" } });
}

function completedBars(raw: unknown, now: number): CryptoSwingBar[] {
  const parsed = z.array(barSchema).safeParse(raw);
  if (!parsed.success) return [];
  return parsed.data
    .filter(bar => Number.isFinite(Date.parse(bar.t)) && Date.parse(bar.t) + 60 * 60_000 <= now)
    .sort((a,b) => Date.parse(a.t) - Date.parse(b.t));
}

export async function GET(request: Request) {
  const supabaseSecret = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  const alpacaKey = process.env.ALPACA_API_KEY_ID?.trim() ?? "";
  const alpacaSecret = process.env.ALPACA_API_SECRET_KEY?.trim() ?? "";
  if (!supabaseSecret || !alpacaKey || !alpacaSecret) {
    return reply({ error:"Crypto swing readiness dependencies are not configured." }, 503);
  }

  const dbHeaders: Record<string,string> = { apikey:supabaseSecret, Accept:"application/json" };
  if (supabaseSecret.startsWith("eyJ")) dbHeaders.Authorization = `Bearer ${supabaseSecret}`;

  const readDb = async (path: string) => {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers:dbHeaders,
      cache:"no-store",
      signal:AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Crypto swing storage returned HTTP ${response.status}.`);
    return response.json();
  };

  const alpacaHeaders = {
    "APCA-API-KEY-ID":alpacaKey,
    "APCA-API-SECRET-KEY":alpacaSecret,
    Accept:"application/json",
  };
  const cryptoFetch = async (path: string) => {
    const response = await fetch(`${ALPACA_DATA}${path}`, {
      headers:alpacaHeaders,
      cache:"no-store",
      signal:AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Crypto swing market-data source returned HTTP ${response.status}.`);
    return response.json();
  };

  try {
    const now = Date.now();
    const [prospectsRaw, ledgerRaw, positionsRaw] = await Promise.all([
      readDb("paper_prospects?select=symbol,score,news_score,news_bot_impact,news_evidence_count,reasons,first_seen_at,assigned_bot_ids&asset_class=eq.crypto&status=neq.expired&order=score.desc,last_seen_at.desc&limit=40"),
      readDb(`paper_bot_ledgers?select=status,equity,buying_power,open_planned_risk_pct,metadata&bot_id=eq.${BOT_ID}&limit=1`),
      readDb(`paper_bot_positions?select=symbol,quantity&bot_id=eq.${BOT_ID}&quantity=gt.0&limit=20`),
    ]);

    const prospects = z.array(prospectSchema).parse(prospectsRaw)
      .filter(item => item.assigned_bot_ids.includes(BOT_ID))
      .slice(0, 12);
    const ledger = z.array(ledgerSchema).parse(ledgerRaw)[0];
    const positions = z.array(positionSchema).parse(positionsRaw);
    if (!ledger) return reply({ error:"Crypto Swing virtual ledger is missing." }, 503);

    if (!prospects.length) {
      return reply({
        collectedAt:new Date(now).toISOString(),
        strategyId:strategy.id,
        strategyVersion:strategy.version,
        paperOnly:true,
        executionEnabled:ledger.metadata.executionEnabled === true,
        plans:[],
      });
    }

    const symbols = prospects.map(item => item.symbol).join(",");
    const quoteQuery = new URLSearchParams({ symbols });
    const barsQuery = new URLSearchParams({
      symbols,
      timeframe:strategy.marketData.timeframe,
      start:new Date(now - strategy.marketData.lookbackHours * 60 * 60_000).toISOString(),
      end:new Date(now).toISOString(),
      limit:"10000",
      sort:"asc",
    });

    const [quotesRaw,barsRaw] = await Promise.all([
      cryptoFetch(`/v1beta3/crypto/us/latest/quotes?${quoteQuery.toString()}`),
      cryptoFetch(`/v1beta3/crypto/us/bars?${barsQuery.toString()}`),
    ]);

    const quoteRecord = (quotesRaw as {quotes?:Record<string,unknown>}).quotes ?? {};
    const barRecord = (barsRaw as {bars?:Record<string,unknown>}).bars ?? {};
    const executionEnabled = ledger.metadata.executionEnabled === true;

    const plans = prospects.map(candidate => {
      const parsedQuote = quoteSchema.safeParse(quoteRecord[candidate.symbol]);
      const quote = parsedQuote.success
        ? {
            bid: parsedQuote.data.bp ?? null,
            ask: parsedQuote.data.ap ?? null,
            timestamp: parsedQuote.data.t ?? null,
          }
        : { bid:null, ask:null, timestamp:null };
      return evaluateCryptoSwingCandidate({
        now,
        candidate: {
          symbol:candidate.symbol,
          prospectScore:candidate.score,
          prospectReasons:candidate.reasons,
          firstSeenAt:candidate.first_seen_at,
          newsScore:candidate.news_score,
          newsBotImpact:candidate.news_bot_impact,
        },
        quote,
        bars:completedBars(barRecord[candidate.symbol], now),
        ledger: {
          active:ledger.status === "active",
          equity:ledger.equity,
          buyingPower:ledger.buying_power ?? 0,
          openRiskPct:ledger.open_planned_risk_pct ?? 0,
          openPositions:positions.length,
          executionEnabled,
        },
      });
    });

    const cronSecret = process.env.CRON_SECRET?.trim() ?? "";
    const isCron = Boolean(cronSecret && request.headers.get("authorization") === `Bearer ${cronSecret}`);
    if (isCron && plans.length) {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/paper_bot_journal`, {
        method:"POST",
        headers:{...dbHeaders,"Content-Type":"application/json",Prefer:"return=minimal"},
        body:JSON.stringify(plans.map(plan => ({
          bot_id:BOT_ID,
          strategy_id:strategy.id,
          strategy_version:strategy.version,
          event_type:"candidate",
          symbol:plan.symbol,
          asset_class:"crypto",
          occurred_at:new Date(now).toISOString(),
          score:plan.score,
          qualification:plan.score !== null && plan.score >= strategy.setup.readyScore
            ? "trade-ready"
            : plan.score !== null && plan.score >= strategy.setup.qualifiedScore
              ? "qualified"
              : plan.score !== null && plan.score >= strategy.setup.watchScore
                ? "watch"
                : "unqualified",
          regime:"unknown",
          component_scores:{ prospectSource:"paper-prospect-scanner-v1" },
          market_snapshot:{ currentPrice:plan.currentPrice },
          risk_plan:plan.plan,
          blockers:plan.blockers,
          warnings:plan.warnings,
          metadata:{ executionEnabled, discoveryAssigned:true, reviewOnly:!executionEnabled },
        }))),
        cache:"no-store",
        signal:AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`Crypto swing journal returned HTTP ${response.status}.`);
    }

    return reply({
      collectedAt:new Date(now).toISOString(),
      strategyId:strategy.id,
      strategyVersion:strategy.version,
      paperOnly:true,
      executionEnabled,
      intendedHoldingDays:strategy.cadence.intendedHoldingDays,
      plans,
    });
  } catch (error) {
    return reply({
      error:error instanceof Error ? error.message : "Crypto swing readiness unavailable.",
    },503);
  }
}
