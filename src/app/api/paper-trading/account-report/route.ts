import { NextResponse } from "next/server";
import { paperAccountSchema, type AccountReport } from "@/lib/account-report";

export const dynamic = "force-dynamic";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://yufptpfiwdbzzrvhkvux.supabase.co";
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) return NextResponse.json({ error: "Account report storage is not configured on the server." }, { status: 503 });
  const headers: Record<string, string> = { apikey: secret };
  if (secret.startsWith("eyJ")) headers.Authorization = `Bearer ${secret}`;
  const read = async (path: string) => {
    const result = await fetch(`${url}/rest/v1/${path}`, { headers, cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!result.ok) throw new Error("Account report storage is unavailable.");
    return result.json();
  };
  try {
    const states = await read("paper_report_state?report_key=eq.main&select=payload,source_key,status,last_attempt_at,next_sync_at,message&limit=1");
    const state = states[0];
    const parsed = state?.payload ? paperAccountSchema.safeParse(state.payload) : null;
    if (parsed && !parsed.success) throw new Error("Stored account report is invalid.");
    const points = state?.source_key ? await read(`paper_report_history?source_key=eq.${encodeURIComponent(state.source_key)}&select=collected_at,equity&order=collected_at.desc&limit=1440`) : [];
    const body: AccountReport = {
      snapshot: parsed?.success ? parsed.data : null,
      history: points.filter((p: { collected_at: string; equity: number }) => Number.isFinite(Date.parse(p.collected_at)) && Number.isFinite(Number(p.equity)))
        .map((p: { collected_at: string; equity: number }) => ({ time: p.collected_at, equity: Number(p.equity) })).reverse(),
      status: ["ready", "error", "setup_required"].includes(state?.status) ? state.status : "pending",
      lastAttemptAt: state?.last_attempt_at ?? null,
      nextSyncAt: state?.next_sync_at ?? null,
      message: state?.status === "setup_required" ? "Waiting for collector credentials."
        : state?.status === "error" ? "The last collection failed; the previous snapshot is retained." : null,
    };
    // Only this allowlisted projection is public. Database rows and broker identifiers stay private.
    return NextResponse.json(body, { headers: { "Cache-Control": "public, s-maxage=5, stale-while-revalidate=5" } });
  } catch {
    return NextResponse.json({ error: "Stored account report is temporarily unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
