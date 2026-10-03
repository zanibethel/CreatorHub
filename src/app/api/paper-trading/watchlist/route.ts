import { NextResponse } from "next/server";
import { watchlistSchema } from "@/lib/paper-watchlist";
export const dynamic = "force-dynamic";
export async function GET() {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) return NextResponse.json({error:"Shared watchlist storage is not configured."},{status:503});
  const headers: Record<string,string> = {apikey:secret};
  if (secret.startsWith("eyJ")) headers.Authorization = `Bearer ${secret}`;
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL || "https://yufptpfiwdbzzrvhkvux.supabase.co"}/rest/v1/paper_report_watchlist?report_key=eq.main&select=config&limit=1`, {headers,cache:"no-store",signal:AbortSignal.timeout(10_000)});
    if (!response.ok) throw new Error("Storage unavailable");
    const rows = await response.json();
    const parsed = watchlistSchema.safeParse(rows[0]?.config);
    if (!parsed.success) throw new Error("Invalid stored watchlist");
    return NextResponse.json(parsed.data,{headers:{"Cache-Control":"public, s-maxage=30, stale-while-revalidate=30"}});
  } catch {
    return NextResponse.json({error:"Shared watchlist is temporarily unavailable."},{status:503,headers:{"Cache-Control":"no-store"}});
  }
}
