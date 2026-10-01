import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const maxDuration = 30;

const requestSchema = z
  .object({
    creatorId: z.string().uuid(),
    message: z.string().trim().max(16000).default(""),
    conversationId: z.string().uuid().optional(),
    attachmentIds: z.array(z.string().uuid()).max(4).default([]),
    pageContext: z.string().max(200).optional(),
  })
  .refine(
    (value) => Boolean(value.message.trim()) || value.attachmentIds.length > 0,
    "Message or image attachment is required.",
  );

type ModuleId =
  | "creator-studio"
  | "character-library"
  | "connections"
  | "monetization"
  | "smartlink"
  | "ebook"
  | "operator"
  | "learning"
  | "system-health"
  | "workspaces";

function moduleForMessage(message: string): ModuleId | null {
  const value = message.toLowerCase();
  const asksToOpen = /(open|show|take me|go to|navigate|where is|bring up)/.test(value);
  if (!asksToOpen) return null;

  if (/(image|creator studio|generate)/.test(value)) return "creator-studio";
  if (/(reference|character|brand library|identity)/.test(value)) return "character-library";
  if (/(connection|instagram|tiktok|fanvue)/.test(value)) return "connections";
  if (/(monet|product|offer|earn|partner)/.test(value)) return "monetization";
  if (/(smartlink|smart link|public page)/.test(value)) return "smartlink";
  if (/(ebook|book)/.test(value)) return "ebook";
  if (/(suggestion|recommendation|campaign)/.test(value)) return "operator";
  if (/(performance|learning|results|analytics)/.test(value)) return "learning";
  if (/(health|integration|system)/.test(value)) return "system-health";
  if (/(workspace|creator workspace|new creator)/.test(value)) return "workspaces";
  return null;
}

function wantsStats(message: string) {
  return /(views|revenue|content tracked|stats|statistics|performance numbers|how many posts)/i.test(message);
}

function wantsReferences(message: string) {
  return /(how many|count|status|what).*?(reference|identity image|approved image)|reference images?|identity references?/i.test(message);
}

function wantsConnections(message: string) {
  return /(what.*connected|connection status|instagram status|tiktok status|fanvue status|which.*connected)/i.test(message);
}

function wantsLatestImage(message: string) {
  return /(latest|last|recent|still|current|currently).*?(image|generation)|image.*?(status|job|running|generating|done|finished|failed)/i.test(message);
}

function hasEngineeringIntent(message: string) {
  const value = message.toLowerCase();
  const action = /(fix|debug|inspect|investigate|test|implement|change|update|refactor|repair|trace|prepare|patch)/;
  const target = /(code|repo|repository|worker|model|inference|pipeline|api|route|component|image generation|identity|ip-adapter|supervisor|bug|error)/;
  return action.test(value) && target.test(value);
}

function configuredProviders() {
  return {
    instagram: Boolean(process.env.INSTAGRAM_APP_ID && process.env.INSTAGRAM_APP_SECRET),
    tiktok: Boolean(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET),
    fanvue: Boolean(process.env.FANVUE_CLIENT_ID && process.env.FANVUE_CLIENT_SECRET),
  };
}

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || user.is_anonymous) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  try {
    const input = requestSchema.parse(await request.json());

    const { data: creator, error: creatorError } = await supabase
      .from("creators")
      .select("id,name,slug,creator_type,primary_goal,niche,target_audience,tone,visual_description")
      .eq("id", input.creatorId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (creatorError) throw creatorError;
    if (!creator) {
      return NextResponse.json({ error: "Creator workspace not found." }, { status: 404 });
    }

    const hasAttachments = input.attachmentIds.length > 0;
    const engineeringIntent = hasEngineeringIntent(input.message);
    const moduleId =
      engineeringIntent || hasAttachments ? null : moduleForMessage(input.message);
    if (moduleId) {
      const label =
        moduleId === "creator-studio" ? "Creator Studio" :
        moduleId === "character-library" ? "Character & Brand Library" :
        moduleId === "connections" ? "Connections" :
        moduleId === "monetization" ? "Monetization" :
        moduleId === "smartlink" ? "SmartLink" :
        moduleId === "ebook" ? "Ebook Studio" :
        moduleId === "operator" ? "Today's Suggestions" :
        moduleId === "learning" ? "Performance Learning" :
        moduleId === "system-health" ? "System Health" :
        "Creator Workspaces";

      return NextResponse.json({
        mode: "code",
        text: `Opening ${label}.`,
        action: { type: "open-module", moduleId, label },
      });
    }

    const [contentResult, assetsResult, connectionsResult, latestImageResult] = await Promise.all([
      supabase
        .from("content_items")
        .select("views,revenue")
        .eq("creator_id", creator.id),
      supabase
        .from("creator_assets")
        .select("id,title,approved,is_primary,asset_type")
        .eq("creator_id", creator.id),
      supabase
        .from("integration_connections")
        .select("provider,status,external_account_name,connected_at")
        .eq("user_id", user.id)
        .or(`creator_id.eq.${creator.id},creator_id.is.null`),
      supabase
        .from("creator_image_jobs")
        .select("cooperative_job_id,status,local_profile,aspect_ratio,variation_mode,seed,result_model,error,created_at,updated_at")
        .eq("creator_id", creator.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (contentResult.error) throw contentResult.error;
    if (assetsResult.error) throw assetsResult.error;
    if (connectionsResult.error) throw connectionsResult.error;
    if (latestImageResult.error) throw latestImageResult.error;

    const contentRows = contentResult.data || [];
    const assetRows = assetsResult.data || [];
    const connectionRows = connectionsResult.data || [];
    const providerConfig = configuredProviders();

    const stats = {
      contentCount: contentRows.length,
      views: contentRows.reduce((sum, row) => sum + Number(row.views || 0), 0),
      revenue: contentRows.reduce((sum, row) => sum + Number(row.revenue || 0), 0),
    };

    const references = {
      total: assetRows.length,
      approved: assetRows.filter((row) => row.approved).length,
      primary:
        assetRows.find((row) => row.is_primary)?.title || null,
      approvedTitles: assetRows.filter((row) => row.approved).map((row) => row.title).slice(0, 8),
    };

    const connections = ["instagram", "tiktok", "fanvue"].map((provider) => {
      const row = connectionRows.find((item) => item.provider === provider);
      return {
        provider,
        configured: providerConfig[provider as keyof typeof providerConfig],
        status: row?.status || (providerConfig[provider as keyof typeof providerConfig] ? "ready" : "setup-required"),
        account: row?.external_account_name || null,
      };
    });

    let latestImage = latestImageResult.data || null;

    const cooperativeUrl = process.env.COOPERATIVE_INFERENCE_URL?.replace(/\/+$/, "");
    const cooperativeSecret = process.env.COOPERATIVE_INFERENCE_SECRET;

    // Reconcile CreatorHub's cached image status with CoOperative before answering
    // status questions or passing job context to the AI. This prevents a failed
    // or completed local job from remaining "queued" indefinitely in chat.
    if (
      latestImage?.cooperative_job_id &&
      (latestImage.status === "queued" || latestImage.status === "running") &&
      cooperativeUrl &&
      cooperativeSecret
    ) {
      try {
        const statusResponse = await fetch(
          `${cooperativeUrl}/api/inference/jobs/status?jobId=${encodeURIComponent(latestImage.cooperative_job_id)}&ownerRef=${encodeURIComponent(user.id)}`,
          {
            headers: { Authorization: `Bearer ${cooperativeSecret}` },
            cache: "no-store",
          },
        );
        const remote = (await statusResponse.json().catch(() => null)) as
          | {
              status?: "queued" | "running" | "completed" | "failed" | "cancelled";
              model?: string | null;
              error?: string | null;
              completedAt?: string | null;
            }
          | null;

        if (statusResponse.ok && remote?.status) {
          await supabase
            .from("creator_image_jobs")
            .update({
              status: remote.status,
              result_model: remote.model ?? latestImage.result_model ?? null,
              error: remote.error ?? null,
              completed_at: remote.completedAt ?? null,
              updated_at: new Date().toISOString(),
            })
            .eq("user_id", user.id)
            .eq("cooperative_job_id", latestImage.cooperative_job_id);

          latestImage = {
            ...latestImage,
            status: remote.status,
            result_model: remote.model ?? latestImage.result_model,
            error: remote.error ?? null,
            updated_at: new Date().toISOString(),
          };
        }
      } catch {
        // Keep the cached status if CoOperative is temporarily unavailable.
      }
    }

    if (!engineeringIntent && !hasAttachments && wantsStats(input.message)) {
      return NextResponse.json({
        mode: "code",
        text: `${creator.name} currently has ${stats.contentCount} tracked content item${stats.contentCount === 1 ? "" : "s"}, ${stats.views.toLocaleString()} views, and $${stats.revenue.toFixed(2)} recorded revenue.`,
      });
    }

    if (!engineeringIntent && !hasAttachments && wantsReferences(input.message)) {
      const primary = references.primary ? ` Primary: ${references.primary}.` : "";
      return NextResponse.json({
        mode: "code",
        text: `${creator.name} has ${references.total} saved reference image${references.total === 1 ? "" : "s"}, with ${references.approved} approved for generation.${primary}`,
        action: { type: "open-module", moduleId: "character-library", label: "Character & Brand Library" },
      });
    }

    if (!engineeringIntent && !hasAttachments && wantsConnections(input.message)) {
      const summary = connections
        .map((item) => {
          const account = item.account ? ` (${item.account})` : "";
          return `${item.provider}: ${item.status}${account}`;
        })
        .join(" · ");
      return NextResponse.json({
        mode: "code",
        text: summary,
        action: { type: "open-module", moduleId: "connections", label: "Connections" },
      });
    }

    if (!engineeringIntent && !hasAttachments && wantsLatestImage(input.message)) {
      if (!latestImage) {
        return NextResponse.json({
          mode: "code",
          text: `${creator.name} does not have a recorded image-generation job yet.`,
          action: { type: "open-module", moduleId: "creator-studio", label: "Creator Studio" },
        });
      }

      return NextResponse.json({
        mode: "code",
        text: `Latest image job: ${latestImage.status} · ${latestImage.local_profile || "unknown profile"} · ${latestImage.variation_mode || "default variation"}${latestImage.result_model ? ` · ${latestImage.result_model}` : ""}${latestImage.error ? `. Error: ${latestImage.error}` : ""}`,
        action: { type: "open-module", moduleId: "creator-studio", label: "Creator Studio" },
      });
    }

    if (!cooperativeUrl || !cooperativeSecret) {
      return NextResponse.json(
        { error: "CoOperative chat bridge is not configured." },
        { status: 503 },
      );
    }

    const context = {
      creator: {
        id: creator.id,
        name: creator.name,
        type: creator.creator_type,
        primaryGoal: creator.primary_goal,
        niche: creator.niche,
        targetAudience: creator.target_audience,
        tone: creator.tone,
        visualDescription: creator.visual_description,
      },
      stats,
      references,
      connections,
      latestImage,
    };

    const bridgeResponse = await fetch(
      `${cooperativeUrl}/api/integrations/creatorhub/chat`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cooperativeSecret}`,
        },
        body: JSON.stringify({
          userId: user.id,
          creatorId: creator.id,
          creatorName: creator.name,
          conversationId: input.conversationId,
          message: input.message,
          attachmentIds: input.attachmentIds,
          pageContext: input.pageContext || "CreatorHub dashboard",
          context,
        }),
        cache: "no-store",
      },
    );

    const payload = await bridgeResponse.json().catch(() => ({}));
    return NextResponse.json(payload, {
      status: bridgeResponse.status,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "CreatorHub AI request failed.";
    return NextResponse.json(
      { error: "CreatorHub AI request failed.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function GET(request: Request) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || user.is_anonymous) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const url = new URL(request.url);
  const creatorId = url.searchParams.get("creatorId") || "";
  const jobId = url.searchParams.get("jobId") || "";
  const taskId = url.searchParams.get("taskId") || "";
  if (!creatorId || (!jobId && !taskId)) {
    return NextResponse.json({ error: "Missing status parameters." }, { status: 400 });
  }

  const { data: creator, error } = await supabase
    .from("creators")
    .select("id")
    .eq("id", creatorId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }
  if (!creator) {
    return NextResponse.json({ error: "Creator workspace not found." }, { status: 404 });
  }

  const cooperativeUrl = process.env.COOPERATIVE_INFERENCE_URL?.replace(/\/+$/, "");
  const cooperativeSecret = process.env.COOPERATIVE_INFERENCE_SECRET;
  if (!cooperativeUrl || !cooperativeSecret) {
    return NextResponse.json({ error: "CoOperative chat bridge is not configured." }, { status: 503 });
  }

  const params = new URLSearchParams({
    userId: user.id,
    creatorId,
  });
  if (jobId) params.set("jobId", jobId);
  if (taskId) params.set("taskId", taskId);

  const response = await fetch(
    `${cooperativeUrl}/api/integrations/creatorhub/chat?${params.toString()}`,
    {
      headers: { Authorization: `Bearer ${cooperativeSecret}` },
      cache: "no-store",
    },
  );

  const payload = await response.json().catch(() => ({}));
  return NextResponse.json(payload, {
    status: response.status,
    headers: { "Cache-Control": "no-store" },
  });
}
