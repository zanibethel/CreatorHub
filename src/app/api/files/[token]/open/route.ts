import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const supabase = createAdminSupabaseClient();

  const { data: file, error: lookupError } = await supabase
    .from("creator_uploads")
    .select("storage_path,share_enabled")
    .eq("share_token", token)
    .eq("share_enabled", true)
    .maybeSingle();

  if (lookupError || !file) {
    return new Response("File link not found or disabled.", { status: 404 });
  }

  const { data: signed, error } = await supabase.storage
    .from("creatorhub-uploads")
    .createSignedUrl(file.storage_path, 10 * 60);

  if (error || !signed?.signedUrl) {
    return new Response("CreatorHub could not open this file.", { status: 500 });
  }

  return NextResponse.redirect(signed.signedUrl);
}
