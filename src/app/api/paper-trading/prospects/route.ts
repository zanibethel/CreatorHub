import { NextResponse } from "next/server";
import { z } from "zod";
import { PAPER_PROSPECT_SCANNER_V2 as config } from "@/lib/paper-prospect-scanner-config";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://yufptpfiwdbzzrvhkvux.supabase.co";
const SQUEEZE_BOT_ID = "squeeze-breakout-100";

const nullablePositiveNumber = z.preprocess(value => {
  if (value == null) return null;
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed <= 0 ? null : value;
}, z.coerce.number().finite().positive().nullable());

const trendRowSchema = z.object({
  asset_class: z.enum(["stock","crypto"]),
  symbol: z.string(),
  scanned_at: z.string(),
  score: z.coerce.number().finite().min(0).max(100),
});

const squeezeTrendRowSchema = z.object({
  symbol: z.string(),
  scanned_at: z.string(),
  score: z.coerce.number().finite().min(0).max(100),
});

const newsComponentSchema = z.preprocess(value => {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string"
      ? Number(value)
      : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}, z.number().finite().min(-20).max(20));

const rowSchema = z.object({
  asset_class: z.enum(["stock","crypto"]),
  symbol: z.string(),
  status: z.enum(["candidate","watchlist","review-ready","expired"]),
  score: z.coerce.number().finite().min(0).max(100),
  news_score: z.coerce.number().finite().min(-100).max(100),
  news_scanner_impact: z.coerce.number().finite().min(-20).max(20),
  news_bot_impact: z.coerce.number().finite().min(-20).max(20),
  news_evidence_count: z.coerce.number().int().nonnegative(),
  news_score_updated_at: z.string().nullable(),
  price: z.coerce.number().finite().positive().nullable(),
  percent_change: z.coerce.number().finite().nullable(),
  spread_pct: z.coerce.number().finite().nonnegative().nullable(),
  volume: z.coerce.number().finite().nonnegative().nullable(),
  volume_ratio: z.coerce.number().finite().nonnegative().nullable(),
  activity_rank: z.coerce.number().int().positive().nullable(),
  near_high_pct: z.coerce.number().finite().nonnegative().nullable(),
  watchlist_eligible: z.boolean(),
  bot_review_eligible: z.boolean(),
  suggested_bot_ids: z.array(z.string()),
  assigned_bot_ids: z.array(z.string()),
  score_components: z.object({
    momentum: z.coerce.number().finite().nonnegative(),
    activity: z.coerce.number().finite().nonnegative(),
    liquidity: z.coerce.number().finite().nonnegative(),
    volumeExpansion: z.coerce.number().finite().nonnegative(),
    structure: z.coerce.number().finite().nonnegative(),
    news: newsComponentSchema,
  }),
  reasons: z.array(z.string()),
  source_flags: z.array(z.string()),
  source_updated_at: z.string().nullable(),
  first_seen_at: z.string(),
  first_watchlist_at: z.string().nullable(),
  first_review_ready_at: z.string().nullable(),
  last_seen_at: z.string(),
  metadata: z.record(z.string(),z.unknown()),
});

const squeezeRowSchema = z.object({
  symbol: z.string(),
  status: z.enum(["candidate","watchlist","review-ready","expired"]),
  score: z.coerce.number().finite().min(0).max(100),
  price: z.coerce.number().finite().positive().nullable(),
  spread_pct: z.coerce.number().finite().nonnegative().nullable(),
  current_volume: z.coerce.number().finite().nonnegative().nullable(),
  relative_volume_pace: z.coerce.number().finite().nonnegative().nullable(),
  breakout_distance_pct: z.coerce.number().finite().nullable(),
  session_change_pct: z.coerce.number().finite().nullable(),
  watchlist_eligible: z.boolean(),
  bot_review_eligible: z.boolean(),
  score_components: z.object({
    compression: z.coerce.number().finite().nonnegative(),
    baseLocation: z.coerce.number().finite().nonnegative(),
    volumeDryness: z.coerce.number().finite().nonnegative(),
    volumeIgnition: z.coerce.number().finite().nonnegative(),
    breakoutStructure: z.coerce.number().finite().nonnegative(),
    liquidity: z.coerce.number().finite().nonnegative(),
  }),
  reasons: z.array(z.string()),
  source_updated_at: z.string().nullable(),
  first_seen_at: z.string(),
  last_seen_at: z.string(),
  base_high: nullablePositiveNumber,
  base_low: nullablePositiveNumber,
  base_range_pct: z.coerce.number().finite().nonnegative().nullable(),
  average_dollar_volume: z.coerce.number().finite().nonnegative().nullable(),
  metadata: z.record(z.string(),z.unknown()),
});

type ProspectRow = z.infer<typeof rowSchema>;

function unique(values: string[]) {
  return [...new Set(values)];
}

function mapSqueezeRow(row: z.infer<typeof squeezeRowSchema>): ProspectRow {
  const isPenny = row.price != null && row.price >= 0.08 && row.price <= 5;
  return {
    asset_class:"stock",
    symbol:row.symbol,
    status:row.status,
    score:row.score,
    news_score:0,
    news_scanner_impact:0,
    news_bot_impact:0,
    news_evidence_count:0,
    news_score_updated_at:null,
    price:row.price,
    percent_change:row.session_change_pct,
    spread_pct:row.spread_pct,
    volume:row.current_volume,
    volume_ratio:row.relative_volume_pace,
    activity_rank:null,
    near_high_pct:row.breakout_distance_pct == null ? null : Math.max(0,row.breakout_distance_pct),
    watchlist_eligible:row.watchlist_eligible,
    bot_review_eligible:row.bot_review_eligible,
    suggested_bot_ids:[SQUEEZE_BOT_ID],
    assigned_bot_ids:row.bot_review_eligible ? [SQUEEZE_BOT_ID] : [],
    score_components:{
      momentum:row.score_components.breakoutStructure,
      activity:row.score_components.baseLocation,
      liquidity:row.score_components.liquidity,
      volumeExpansion:row.score_components.volumeDryness + row.score_components.volumeIgnition,
      structure:row.score_components.compression,
      news:0,
    },
    reasons:row.reasons,
    source_flags:["squeeze-scanner", ...(isPenny ? ["penny-stock"] : [])],
    source_updated_at:row.source_updated_at,
    first_seen_at:row.first_seen_at,
    first_watchlist_at:row.watchlist_eligible ? row.first_seen_at : null,
    first_review_ready_at:row.bot_review_eligible ? row.first_seen_at : null,
    last_seen_at:row.last_seen_at,
    metadata:{
      ...row.metadata,
      alreadyKnown:false,
      scannerSource:"squeeze",
      pennyStock:isPenny,
      baseHigh:row.base_high,
      baseLow:row.base_low,
      baseRangePct:row.base_range_pct,
      averageDollarVolume:row.average_dollar_volume,
    },
  };
}

function mergeProspects(rows: ProspectRow[]) {
  const merged = new Map<string,ProspectRow>();
  for (const row of rows) {
    const key = `${row.asset_class}:${row.symbol}`;
    const current = merged.get(key);
    if (!current) {
      merged.set(key,row);
      continue;
    }
    const preferred = row.score > current.score ? row : current;
    const secondary = preferred === row ? current : row;
    merged.set(key,{
      ...preferred,
      status: current.status === "review-ready" || row.status === "review-ready"
        ? "review-ready"
        : current.status === "watchlist" || row.status === "watchlist"
          ? "watchlist"
          : preferred.status,
      watchlist_eligible:current.watchlist_eligible || row.watchlist_eligible,
      bot_review_eligible:current.bot_review_eligible || row.bot_review_eligible,
      suggested_bot_ids:unique([...current.suggested_bot_ids,...row.suggested_bot_ids]),
      assigned_bot_ids:unique([...current.assigned_bot_ids,...row.assigned_bot_ids]),
      reasons:unique([...preferred.reasons,...secondary.reasons]),
      source_flags:unique([...current.source_flags,...row.source_flags]),
      first_seen_at:Date.parse(current.first_seen_at) <= Date.parse(row.first_seen_at) ? current.first_seen_at : row.first_seen_at,
      first_watchlist_at:current.first_watchlist_at ?? row.first_watchlist_at,
      first_review_ready_at:current.first_review_ready_at ?? row.first_review_ready_at,
      last_seen_at:Date.parse(current.last_seen_at) >= Date.parse(row.last_seen_at) ? current.last_seen_at : row.last_seen_at,
      metadata:{...secondary.metadata,...preferred.metadata,scannerSources:unique([
        ...current.source_flags,
        ...row.source_flags,
      ])},
    });
  }
  return [...merged.values()].sort((a,b) => b.score - a.score || Date.parse(b.last_seen_at) - Date.parse(a.last_seen_at));
}

export async function GET() {
  const secret = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  if (!secret) return NextResponse.json({ error:"Prospect scanner storage is not configured." }, { status:503 });

  const headers: Record<string,string> = { apikey:secret, Accept:"application/json" };
  if (secret.startsWith("eyJ")) headers.Authorization = `Bearer ${secret}`;

  const trendCutoff = encodeURIComponent(new Date(Date.now() - 48 * 60 * 60_000).toISOString());
  const [response,trendResponse,squeezeResponse,squeezeTrendResponse] = await Promise.all([
    fetch(
      `${SUPABASE_URL}/rest/v1/paper_prospects?select=asset_class,symbol,status,score,news_score,news_scanner_impact,news_bot_impact,news_evidence_count,news_score_updated_at,price,percent_change,spread_pct,volume,volume_ratio,activity_rank,near_high_pct,watchlist_eligible,bot_review_eligible,suggested_bot_ids,assigned_bot_ids,score_components,reasons,source_flags,source_updated_at,first_seen_at,first_watchlist_at,first_review_ready_at,last_seen_at,metadata&status=neq.expired&order=score.desc,last_seen_at.desc&limit=100`,
      { headers, cache:"no-store", signal:AbortSignal.timeout(10_000) },
    ),
    fetch(
      `${SUPABASE_URL}/rest/v1/paper_prospect_observations?select=asset_class,symbol,scanned_at,score&scanned_at=gte.${trendCutoff}&order=scanned_at.asc&limit=2500`,
      { headers, cache:"no-store", signal:AbortSignal.timeout(10_000) },
    ),
    fetch(
      `${SUPABASE_URL}/rest/v1/paper_squeeze_prospects?select=symbol,status,score,price,spread_pct,current_volume,relative_volume_pace,breakout_distance_pct,session_change_pct,watchlist_eligible,bot_review_eligible,score_components,reasons,source_updated_at,first_seen_at,last_seen_at,base_high,base_low,base_range_pct,average_dollar_volume,metadata&status=neq.expired&order=score.desc,last_seen_at.desc&limit=100`,
      { headers, cache:"no-store", signal:AbortSignal.timeout(10_000) },
    ),
    fetch(
      `${SUPABASE_URL}/rest/v1/paper_squeeze_observations?select=symbol,scanned_at,score&scanned_at=gte.${trendCutoff}&order=scanned_at.asc&limit=2500`,
      { headers, cache:"no-store", signal:AbortSignal.timeout(10_000) },
    ),
  ]);
  if (!response.ok) {
    return NextResponse.json({ error:"Prospect scanner results are temporarily unavailable." }, {
      status:503,
      headers:{ "Cache-Control":"no-store" },
    });
  }

  const baseRows = z.array(rowSchema).parse(await response.json());
  const squeezeRows = squeezeResponse.ok
    ? z.array(squeezeRowSchema).parse(await squeezeResponse.json()).map(mapSqueezeRow)
    : [];
  const rows = mergeProspects([...baseRows,...squeezeRows]);

  const trendRows = trendResponse.ok ? z.array(trendRowSchema).parse(await trendResponse.json()) : [];
  const squeezeTrendRows = squeezeTrendResponse.ok
    ? z.array(squeezeTrendRowSchema).parse(await squeezeTrendResponse.json()).map(row => ({...row,asset_class:"stock" as const}))
    : [];
  const trends: Record<string,Array<{time:string;score:number}>> = {};
  for (const point of [...trendRows,...squeezeTrendRows]) {
    const key = `${point.asset_class}:${point.symbol}`;
    const bucket = trends[key] ?? [];
    bucket.push({ time:point.scanned_at, score:point.score });
    trends[key] = bucket
      .sort((a,b) => Date.parse(a.time) - Date.parse(b.time))
      .slice(-72);
  }

  const prospects = rows.filter(row => row.watchlist_eligible);
  const nearMisses = rows
    .filter(row => !row.watchlist_eligible && row.score >= Math.max(0, config.thresholds.watchlistScore - 10))
    .slice(0, 12);

  return NextResponse.json({
    scannerId: config.id,
    scannerVersion: config.version,
    thresholds: config.thresholds,
    lastSeenAt: rows[0]?.last_seen_at ?? null,
    counts: {
      watchlist: prospects.filter(row => row.status === "watchlist").length,
      reviewReady: prospects.filter(row => row.status === "review-ready").length,
      newToExistingLists: prospects.filter(row => row.metadata.alreadyKnown !== true).length,
      nearMisses: nearMisses.length,
    },
    prospects,
    nearMisses,
    trends,
  }, {
    headers:{ "Cache-Control":"public, s-maxage=15, stale-while-revalidate=30" },
  });
}
