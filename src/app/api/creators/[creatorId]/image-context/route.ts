import { NextRequest } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ creatorId: string }> },
) {
  const { creatorId } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();

  if (userError || !user || user.is_anonymous) {
    return Response.json({ error: "Sign in with a permanent CreatorHub account." }, { status: 401 });
  }

  const { data: creator } = await supabase
    .from("creators")
    .select("id,name,description,niche,target_audience,tone,visual_description,persona_lore,boundaries,content_pillars")
    .eq("id", creatorId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!creator) {
    return Response.json({ error: "Creator workspace not found." }, { status: 404 });
  }

  const { data: rows, error } = await supabase
    .from("creator_assets")
    .select("id,asset_type,title,storage_path,mime_type,prompt_notes,tags,is_primary,source,created_at")
    .eq("creator_id", creatorId)
    .eq("user_id", user.id)
    .eq("approved", true)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(6);

  if (error) {
    return Response.json({ error: "Could not read creator references." }, { status: 500 });
  }

  const references = await Promise.all(
    (rows ?? []).map(async (asset) => {
      const { data: signed, error: signedError } = await supabase.storage
        .from("creator-reference-assets")
        .createSignedUrl(asset.storage_path, 15 * 60);

      return {
        id: asset.id,
        asset_type: asset.asset_type,
        title: asset.title,
        mime_type: asset.mime_type,
        prompt_notes: asset.prompt_notes,
        tags: asset.tags,
        is_primary: asset.is_primary,
        source: asset.source,
        created_at: asset.created_at,
        signed_url: signedError ? null : signed?.signedUrl || null,
      };
    }),
  );

  return Response.json(
    {
      creator,
      references,
      generation_contract: {
        primary_reference_id: references.find((item) => item.is_primary)?.id ?? null,
        use_only_approved_references: true,
        identity_guidance:
          "Prefer the primary reference for facial identity and body proportions. Use secondary approved references for expression, angle, hair, wardrobe, and lighting continuity. If the selected model cannot consume image references, fall back to the saved visual description and clearly treat identity consistency as lower-confidence.",
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
