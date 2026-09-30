import { createServerSupabaseClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || user.is_anonymous) {
    return Response.json({ error: "Sign in first." }, { status: 401 });
  }

  const { id } = await context.params;
  const { data: localJob, error: localError } = await supabase
    .from("creator_image_jobs")
    .select("*")
    .eq("user_id", user.id)
    .eq("cooperative_job_id", id)
    .maybeSingle();

  if (localError) {
    return Response.json({ error: "Could not read image job." }, { status: 500 });
  }
  if (!localJob) {
    return Response.json({ error: "Image job not found." }, { status: 404 });
  }

  const cooperativeUrl = process.env.COOPERATIVE_INFERENCE_URL?.replace(/\\\/+$/, "");
  const cooperativeSecret = process.env.COOPERATIVE_INFERENCE_SECRET;
  if (!cooperativeUrl || !cooperativeSecret) {
    return Response.json({ error: "CoOperative inference connection is not configured." }, { status: 503 });
  }

  const response = await fetch(
    `${cooperativeUrl}/api/inference/jobs/status?jobId=${encodeURIComponent(id)}&ownerRef=${encodeURIComponent(user.id)}`,
    {
      headers: { Authorization: `Bearer ${cooperativeSecret}` },
      cache: "no-store",
    },
  );

  const payload = (await response.json().catch(() => null)) as
    | {
        status?: "queued" | "running" | "completed" | "failed" | "cancelled";
        profile?: "fast" | "quality";
        image?: string | null;
        model?: string | null;
        provider?: string | null;
        referencesUsed?: number;
        referenceTitles?: string[];
        latencyMs?: number | null;
        seed?: number | null;
        variationMode?: "preserve" | "balanced" | "new-scene";
        error?: string | null;
        aspectRatio?: string;
        createdAt?: string;
        completedAt?: string | null;
        detail?: string;
      }
    | null;

  if (!response.ok || !payload?.status) {
    return Response.json(
      {
        error: "Could not read CoOperative image job.",
        detail: payload?.detail || `CoOperative returned HTTP ${response.status}.`,
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }

  const nextStatus = payload.status;
  await supabase
    .from("creator_image_jobs")
    .update({
      status: nextStatus,
      result_model: payload.model ?? null,
      result_reference_count: payload.referencesUsed ?? null,
      seed: payload.seed ?? localJob.seed ?? null,
      variation_mode: payload.variationMode || localJob.variation_mode || "balanced",
      error: payload.error ?? null,
      completed_at: payload.completedAt ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id)
    .eq("cooperative_job_id", id);

  if (nextStatus === "completed" && payload.image) {
    const profileLabel = payload.profile === "quality" ? "Quality" : "Fast";
    return Response.json(
      {
        ok: true,
        async: true,
        jobId: id,
        status: "completed",
        image: payload.image,
        model: payload.model || "cooperative-worker",
        modelLabel: `Local ${profileLabel} · ${payload.model || "CoOperative AI worker"}`,
        mode: "reference",
        routedBy: "cooperative-async-queue",
        costHint: "local inference · no per-image API charge",
        aspectRatio: payload.aspectRatio || localJob.aspect_ratio,
        referenceCount: payload.referencesUsed ?? 0,
        referenceTitles: payload.referenceTitles ?? [],
        referenceFallback: null,
        latencyMs: payload.latencyMs ?? null,
        seed: payload.seed ?? localJob.seed ?? null,
        variationMode: payload.variationMode || localJob.variation_mode || "balanced",
        createdAt: payload.completedAt || payload.createdAt || new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  return Response.json(
    {
      ok: nextStatus !== "failed",
      async: true,
      jobId: id,
      status: nextStatus,
      profile: payload.profile || localJob.local_profile,
      seed: payload.seed ?? localJob.seed ?? null,
      variationMode: payload.variationMode || localJob.variation_mode || "balanced",
      error: payload.error || null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
