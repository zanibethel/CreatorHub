import { redirect } from "next/navigation";
import AuthPanel from "@/components/AuthPanel";
import Dashboard from "@/components/Dashboard";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export default async function Home() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return <AuthPanel />;

  if (!user.is_anonymous) {
    const { data: access } = await supabase
      .from("creatorhub_account_access")
      .select("access_level")
      .eq("user_id", user.id)
      .maybeSingle();

    if (access?.access_level !== "full") {
      redirect("/upload");
    }
  }

  return <Dashboard userId={user.id} />;
}
