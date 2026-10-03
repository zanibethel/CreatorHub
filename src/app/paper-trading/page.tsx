import { redirect } from "next/navigation";
import PaperTradingLab from "@/components/PaperTradingLab";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export default async function PaperTradingPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || user.is_anonymous) redirect("/");

  return <PaperTradingLab />;
}
