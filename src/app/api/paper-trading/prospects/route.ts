import { NextResponse } from "next/server";
import { z } from "zod";
import { PAPER_PROSPECT_SCANNER_V1 as config } from "@/lib/paper-prospect-scanner-config";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://yufptpfiwdbzzrvhkvux.supabase.co";

const trendRowSchema = z.object({
  asset_class: z.enum(["stock","crypto"]),
  symbol: z.string(),
  scanned_at: z.string(),
  score: z.coerce.number().finite().min(0).max(100),
});

const rowSchema = z.object({
  asset_class: z.enum(["stock","crypto"]),
  symbol: z.string(),
  status: z.enum(["candidate","watchlist","review-ready","expired"]),
  score: z.coerce.number().finite().min(0).max(100),
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

export async function GET() {
  const secret = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  if (!secret) return NextResponse.json({ error:"Prospect scanner storage is not configured." }, { status:503 });

  const headers: Record<string,string> = { apikey:secret, Accept:"application/json" };
  if (secret.startsWith("eyJ")) headers.Authorization = `Bearer ${secret}`;

  const trendCutoff = encodeURIComponent(new Date(Date.now() - 48 * 60 * 60_000).toISOString());
  const [response,trendResponse] = await Promise.all([
    fetch(
      `${SUPABASE_URL}/rest/v1/paper_prospects?select=asset_class,symbol,status,score,price,percent_change,spread_pct,volume,volume_ratio,activity_rank,near_high_pct,watchlist_eligible,bot_review_eligible,suggested_bot_ids,assigned_bot_ids,score_components,reasons,source_flags,source_updated_at,first_seen_at,first_watchlist_at,first_review_ready_at,last_seen_at,metadata&status=neq.expired&order=score.desc,last_seen_at.desc&limit=100`,
      { headers, cache:"no-store", signal:AbortSignal.timeout(10_000) },
    ),
    fetch(
      `${SUPABASE_URL}/rest/v1/paper_prospect_observations?select=asset_class,symbol,scanned_at,score&scanned_at=gte.${trendCutoff}&order=scanned_at.asc&limit=2500`,
      { headers, cache:"no-store", signal:AbortSignal.timeout(10_000) },
    ),
  ]);
  if (!response.ok) {
    return NextResponse.json({ error:"Prospect scanner results are temporarily unavailable." }, {
      status:503,
      headers:{ "Cache-Control":"no-store" },
    });
  }

  const rows = z.array(rowSchema).parse(await response.json());
  const trendRows = trendResponse.ok ? z.array(trendRowSchema).parse(await trendResponse.json()) : [];
  const trends: Record<string,Array<{time:string;score:number}>> = {};
  for (const point of trendRows) {
    const key = `${point.asset_class}:${point.symbol}`;
    const bucket = trends[key] ?? [];
    bucket.push({ time:point.scanned_at, score:point.score });
    trends[key] = bucket.slice(-72);
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
