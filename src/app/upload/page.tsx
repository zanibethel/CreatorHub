import TransferAuthPanel from "@/components/TransferAuthPanel";
import TransferHeaderActions from "@/components/TransferHeaderActions";
import UploadCenter from "@/components/UploadCenter";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { colors } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function UploadPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || user.is_anonymous) {
    return <TransferAuthPanel destination="/upload" />;
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
          <div style={{ color: colors.purpleBright, fontWeight: 900, fontSize: 22 }}>File Transfer</div>
          <div style={{ color: colors.muted, marginTop: 3, fontSize: 13 }}>Private upload and cross-device sharing</div>
        </div>
        <TransferHeaderActions fullAccess={fullAccess} />
      </header>
      <UploadCenter userId={user.id} />
    </main>
  );
}
