import { redirect } from "next/navigation";
import PasswordForm from "@/components/PasswordForm";
import TransferHeaderActions from "@/components/TransferHeaderActions";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { colors } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function PasswordPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || user.is_anonymous) {
    redirect("/upload");
  }

  const { data: access } = await supabase
    .from("creatorhub_account_access")
    .select("access_level")
    .eq("user_id", user.id)
    .maybeSingle();

  const fullAccess = access?.access_level === "full";

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 24 }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <div style={{ color: colors.purpleBright, fontWeight: 900, fontSize: 22 }}>File Transfer Password</div>
          <div style={{ color: colors.muted, marginTop: 3, fontSize: 13 }}>Set a known password for your account</div>
        </div>
        <TransferHeaderActions fullAccess={fullAccess} />
      </header>
      <PasswordForm />
    </main>
  );
}
