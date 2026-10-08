import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
const DATABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://yufptpfiwdbzzrvhkvux.supabase.co";

export async function GET() {
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!key) return NextResponse.json({ error: "Mover evidence storage unavailable." }, { status: 503 });

  const headers: Record<string, string> = { apikey: key, Accept: "application/json" };
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;
  const cutoff = new Date(Date.now() - 7 * 86_400_000).toISOString();

  const response = await fetch(
    `${DATABASE_URL}/rest/v1/paper_market_mover_observations?select=asset_class,symbol,signal_kind,observed_at,event_at,available_at,score,confidence,direction,actor_class,source_name,evidence&observed_at=gte.${encodeURIComponent(cutoff)}&order=observed_at.desc&limit=240`,
    { headers, cache: "no-store", signal: AbortSignal.timeout(10_000) },
  ).catch(() => null);
  if (!response?.ok) return NextResponse.json({ error: "Mover evidence currently unavailable." }, { status: 503 });

  return NextResponse.json({
    module: "market-mover-intelligence-v1",
    status: "research-only",
    executionEnabled: false,
    collectedAt: new Date().toISOString(),
    observations: await response.json(),
  }, { headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30" } });
}
