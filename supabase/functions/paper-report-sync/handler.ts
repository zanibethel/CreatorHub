import { collectPaperReport } from "./collector.ts";
import { collectPaperBotMarks } from "./marks.ts";

export function createHandler(env: (name: string) => string | undefined, fetcher: typeof fetch = fetch) {
  return async (request: Request) => {
    const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
    if (request.method !== "POST") return reply({ error: "Method not allowed." }, 405);
    const token = request.headers.get("x-paper-report-token") ?? "";
    if (!/^[a-f0-9]{64}$/.test(token)) return reply({ error: "Unauthorized." }, 401);
    const url = env("SUPABASE_URL");
    let admin: string | undefined;
    try { admin = JSON.parse(env("SUPABASE_SECRET_KEYS") || "{}").default || env("SUPABASE_SERVICE_ROLE_KEY"); }
    catch { return reply({ error: "Collector storage is not configured." }, 503); }
    if (!url || !admin) return reply({ error: "Collector storage is not configured." }, 503);
    const headers: Record<string, string> = { apikey: admin, "Content-Type": "application/json" };
    if (admin.startsWith("eyJ")) headers.Authorization = `Bearer ${admin}`;
    const db = async (
      path: string,
      body?: unknown,
      method: "GET" | "POST" | "PATCH" | "DELETE" = body === undefined ? "GET" : "POST",
      prefer?: string,
    ) => {
      const response = await fetcher(`${url}/rest/v1/${path}`, {
        method,
        headers: { ...headers, ...(prefer ? { Prefer: prefer } : {}) },
        ...((body === undefined || method === "GET" || method === "DELETE") ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`Report storage returned HTTP ${response.status}.`);
      const bodyText = await response.text();
      return bodyText ? JSON.parse(bodyText) : null;
    };
    let claimed = false;
    let phase = "scheduler authentication";
    try {
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))).map(b => b.toString(16).padStart(2, "0")).join("");
      const config = await db("paper_report_state?report_key=eq.main&select=cron_token_hash&limit=1");
      if (config[0]?.cron_token_hash !== digest) return reply({ error: "Unauthorized." }, 401);
      phase = "refresh lease";
      claimed = await db("rpc/paper_report_claim_refresh", {});
      if (!claimed) return reply({ ok: true, skipped: true });
      const key = env("ALPACA_PAPER_API_KEY_ID")?.trim() ?? "";
      const secret = env("ALPACA_PAPER_API_SECRET_KEY")?.trim() ?? "";
      if (!key || !secret) {
        await db("rpc/paper_report_record_failure", { p_message: "Add the paper account keys to Supabase Edge Function Secrets.", p_status: "setup_required" });
        return reply({ ok: false, setupRequired: true }, 503);
      }
      phase = "paper account fetch";
      const { report, sourceKey, brokerActivity } = await collectPaperReport(key, secret, fetcher);
      phase = "broker attribution reconciliation";
      await db("rpc/paper_bot_reconcile_broker_activity", { p_orders: brokerActivity.orders, p_fills: brokerActivity.fills, p_collected_at: report.collectedAt });
      phase = "order lifecycle timestamps";
      // Supplemental evidence must never block the existing fill-to-ledger
      // reconciliation if the new audit RPC is temporarily unavailable.
      try {
        await db("rpc/paper_bot_record_order_lifecycle_evidence", {
          p_orders: brokerActivity.orders, p_collected_at: report.collectedAt,
        });
      } catch {
        report.errors.brokerLifecycle = "Broker lifecycle timestamp evidence unavailable.";
      }
      phase = "prepared order linkage";
      await db("rpc/paper_bot_link_prepared_orders", { p_collected_at: report.collectedAt });
      phase = "virtual ledger fill application";
      await db("rpc/paper_bot_apply_unapplied_fills", { p_collected_at: report.collectedAt });
      phase = "closed trade telemetry";
      await db("rpc/paper_bot_finalize_trade_metrics", { p_collected_at: report.collectedAt });
      phase = "virtual position marks";
      let marks: Array<{ symbol: string; price: number; timestamp: string; source: string }> = [];
      try {
        const positions = await db("paper_bot_positions?select=symbol,asset_class&quantity=gt.0");
        marks = await collectPaperBotMarks(key, secret, Array.isArray(positions) ? positions : [], fetcher);
        await db("rpc/paper_bot_mark_to_market", { p_prices: marks, p_collected_at: report.collectedAt });
      } catch (markError) {
        report.errors.virtualMarks = markError instanceof Error ? markError.message.slice(0, 180) : "Virtual position marks unavailable.";
      }

      phase = "snapshot save";
      await db("rpc/paper_report_save_snapshot", { p_source_key: sourceKey, p_payload: report });
      return reply({ ok: true, collectedAt: report.collectedAt, partial: Object.keys(report.errors).length > 0 });
    } catch (error) {
      console.error("Paper report collection failed", { phase, reason: error instanceof Error ? error.message : "Request failed." });
      if (claimed) {
        try { await db("rpc/paper_report_record_failure", { p_message: "Account collection failed. Check the paper keys and provider access.", p_status: "error" }); } catch { /* lease expires so the next job can retry */ }
      }
      return reply({ error: "Account collection failed; previous data was retained.", phase }, 502);
    }
  };
}
