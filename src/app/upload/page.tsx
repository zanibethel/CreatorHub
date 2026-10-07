import { redirect } from "next/navigation";
import UploadCenter from "@/components/UploadCenter";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { colors, secondaryButton } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function UploadPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || user.is_anonymous) {
    redirect("/");
  }

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <div style={{ color: colors.purpleBright, fontWeight: 900, fontSize: 22 }}>CreatorHub Upload</div>
          <div style={{ color: colors.muted, marginTop: 3, fontSize: 13 }}>Private file transfer and cross-device links</div>
        </div>
        <a href="/" style={{ ...secondaryButton, display: "inline-flex", textDecoration: "none" }}>← CreatorHub</a>
      </header>
      <UploadCenter userId={user.id} />
    </main>
  );
}
