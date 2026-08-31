"use client";

import { useEffect, useMemo, useState } from "react";
import AuthPanel from "@/components/AuthPanel";
import Dashboard from "@/components/Dashboard";
import IntegrationHealthPanel from "@/components/IntegrationHealthPanel";
import { createClient } from "@/lib/supabase";

export default function Home() {
  const supabase = useMemo(() => createClient(), []);
  const [userId, setUserId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id ?? null);
    });
    return () => data.subscription.unsubscribe();
  }, [supabase]);

  if (userId === undefined) {
    return <main style={{ padding: 24 }}>Loading CreatorHub…</main>;
  }

  if (!userId) return <AuthPanel />;

  return (
    <>
      <div style={{ maxWidth: 1120, margin: "0 auto", padding: "24px 24px 0" }}>
        <IntegrationHealthPanel />
      </div>
      <Dashboard userId={userId} />
    </>
  );
}
