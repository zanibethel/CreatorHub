import Link from "next/link";
import { redirect } from "next/navigation";
import YouTubeClipperDiscovery from "@/components/YouTubeClipperDiscovery";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { colors, secondaryButton } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function ClipperPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.is_anonymous) redirect("/");
  const { data: access } = await supabase.from("creatorhub_account_access")
    .select("access_level").eq("user_id", user.id).maybeSingle();
  if (access?.access_level !== "full") redirect("/upload");

  const { data: creators } = await supabase.from("creators")
    .select("id,name").eq("user_id", user.id).order("created_at");

  return (
    <main style={{ maxWidth: 1120, margin: "0 auto", padding: 22 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <div style={{ color: colors.purpleBright, fontWeight: 900, fontSize: 22 }}>CreatorHub · AI Clipper</div>
          <div style={{ color: colors.muted, fontSize: 13 }}>Discover YouTube sources without copying links</div>
        </div>
        <Link href="/" style={{ ...secondaryButton, display: "inline-flex", textDecoration: "none" }}>← CreatorHub</Link>
      </header>
      <YouTubeClipperDiscovery creators={creators ?? []} />
    </main>
  );
}
