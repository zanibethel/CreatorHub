import DownloadCenter from "@/components/DownloadCenter";
import TransferAuthPanel from "@/components/TransferAuthPanel";
import TransferHeaderActions from "@/components/TransferHeaderActions";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { colors } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function DownloadPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || user.is_anonymous) {
    return <TransferAuthPanel destination="/download" />;
  }

  const { data: access } = await supabase
    .from("creatorhub_account_access")
    .select("access_level")
    .eq("user_id", user.id)
    .maybeSingle();

  const fullAccess = access?.access_level === "full";

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <div style={{ color: colors.purpleBright, fontWeight: 900, fontSize: 22 }}>File Downloads</div>
          <div style={{ color: colors.muted, marginTop: 3, fontSize: 13 }}>Your recent uploaded files and share links</div>
        </div>
        <TransferHeaderActions fullAccess={fullAccess} />
      </header>
      <DownloadCenter userId={user.id} />
    </main>
  );
}
