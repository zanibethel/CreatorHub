import { NextRequest } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { ownYouTubeQuotaStatus } from "@/lib/clipper-youtube-quota-server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.is_anonymous) {
    return Response.json({ error: "Sign in first." }, { status: 401 });
  }
  const { data: access } = await supabase.from("creatorhub_account_access")
    .select("access_level").eq("user_id", user.id).maybeSingle();
  if (access?.access_level !== "full") {
    return Response.json({ error: "Full CreatorHub access is required." }, { status: 403 });
  }

  const creatorId = request.nextUrl.searchParams.get("creatorId") ?? "";
  const { data: creator } = await supabase.from("creators")
    .select("id").eq("id", creatorId).eq("user_id", user.id).maybeSingle();
  if (!creator) {
    return Response.json({ error: "Creator workspace not found." }, { status: 403 });
  }
  try {
    const search = await ownYouTubeQuotaStatus(user.id, "search.list");
    return Response.json({ search }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ error: "YouTube quota status is unavailable." }, { status: 503 });
  }
}
