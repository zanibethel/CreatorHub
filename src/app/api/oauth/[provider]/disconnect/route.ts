import { NextRequest } from "next/server";
import { isOAuthProvider } from "@/lib/oauth";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export async function POST(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: rawProvider } = await params;
  if (!isOAuthProvider(rawProvider)) return Response.json({ error: "Unsupported provider." }, { status: 404 });

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.is_anonymous) return Response.json({ error: "Sign in with a permanent account first." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const creatorId = String(body.creatorId ?? "");
  if (!creatorId) return Response.json({ error: "Creator workspace is required." }, { status: 400 });

  const { data: creator } = await supabase.from("creators")
    .select("id")
    .eq("id", creatorId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!creator) return Response.json({ error: "Creator workspace not found." }, { status: 403 });

  const { error } = await supabase.from("integration_connections")
    .delete()
    .eq("user_id", user.id)
    .eq("creator_id", creatorId)
    .eq("provider", rawProvider);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true });
}
