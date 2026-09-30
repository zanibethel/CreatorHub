import { createServerSupabaseClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || user.is_anonymous) {
    return Response.json({ error: "Sign in first." }, { status: 401 });
  }

  const creatorId = new URL(request.url).searchParams.get("creatorId") || "";
  if (!creatorId) {
    return Response.json({ error: "creatorId is required." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("creator_image_jobs")
    .select("cooperative_job_id,status,local_profile,aspect_ratio,created_at")
    .eq("user_id", user.id)
    .eq("creator_id", creatorId)
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return Response.json({ error: "Could not load active image job." }, { status: 500 });
  }

  return Response.json(
    { job: data ?? null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
