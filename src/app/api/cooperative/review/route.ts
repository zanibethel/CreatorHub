import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const maxDuration = 30;

const schema = z.object({
  creatorId: z.string().uuid(),
  taskId: z.string().uuid(),
  action: z.enum(["approve", "deny", "explain"]),
});

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || user.is_anonymous) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  try {
    const input = schema.parse(await request.json());

    const { data: creator, error } = await supabase
      .from("creators")
      .select("id")
      .eq("id", input.creatorId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) throw error;
    if (!creator) {
      return NextResponse.json({ error: "Creator workspace not found." }, { status: 404 });
    }

    const cooperativeUrl = process.env.COOPERATIVE_INFERENCE_URL?.replace(/\/+$/, "");
    const cooperativeSecret = process.env.COOPERATIVE_INFERENCE_SECRET;
    if (!cooperativeUrl || !cooperativeSecret) {
      return NextResponse.json(
        { error: "CoOperative review bridge is not configured." },
        { status: 503 },
      );
    }

    const response = await fetch(
      `${cooperativeUrl}/api/integrations/creatorhub/agents/review`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cooperativeSecret}`,
        },
        body: JSON.stringify({
          userId: user.id,
          creatorId: input.creatorId,
          taskId: input.taskId,
          action: input.action,
        }),
        cache: "no-store",
      },
    );

    const payload = await response.json().catch(() => ({}));
    return NextResponse.json(payload, {
      status: response.status,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Could not review proposal.";
    return NextResponse.json(
      { error: "Could not review proposal.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
