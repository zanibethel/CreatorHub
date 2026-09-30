import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || user.is_anonymous) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  try {
    const form = await request.formData();
    const creatorId = String(form.get("creatorId") || "");
    const file = form.get("file");

    if (!creatorId) {
      return NextResponse.json({ error: "Creator workspace is required." }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Image file is required." }, { status: 400 });
    }

    const { data: creator, error } = await supabase
      .from("creators")
      .select("id")
      .eq("id", creatorId)
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
        { error: "CoOperative attachment bridge is not configured." },
        { status: 503 },
      );
    }

    const outbound = new FormData();
    outbound.set("file", file, file.name);

    const response = await fetch(
      `${cooperativeUrl}/api/integrations/creatorhub/attachments`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cooperativeSecret}`,
          "x-creatorhub-user-id": user.id,
          "x-creatorhub-creator-id": creatorId,
        },
        body: outbound,
        cache: "no-store",
      },
    );

    const payload = await response.json().catch(() => ({}));
    return NextResponse.json(payload, {
      status: response.status,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Could not upload chat image.";
    return NextResponse.json(
      { error: "Could not upload chat image.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
