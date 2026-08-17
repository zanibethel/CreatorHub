"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase";
import { card, primaryButton, secondaryButton } from "@/lib/ui";

type Connection = {
  id: string;
  provider: string;
  status: string;
  external_account_name: string | null;
  connected_at: string | null;
};

const providers = [
  {
    id: "openai",
    name: "CreatorHub AI",
    detail: "AI is managed by CreatorHub. Creators do not need an OpenAI password or API key.",
    managed: true,
  },
  {
    id: "instagram",
    name: "Instagram",
    detail: "One-tap authorization for professional creator/business accounts. Return to CreatorHub automatically.",
  },
  {
    id: "tiktok",
    name: "TikTok",
    detail: "Connect with TikTok Login Kit. No auth-code copying; tokens refresh server-side.",
  },
  {
    id: "fanvue",
    name: "Fanvue",
    detail: "Connect the creator account once with Fanvue OAuth and keep it refreshed in the background.",
  },
] as const;

export default function ConnectionsPanel({ userId, creatorId }: { userId: string; creatorId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [message, setMessage] = useState("");

  async function loadConnections() {
    const { data, error } = await supabase
      .from("integration_connections")
      .select("id,provider,status,external_account_name,connected_at")
      .eq("user_id", userId)
      .or(`creator_id.eq.${creatorId},creator_id.is.null`);
    if (error) return setMessage(error.message);
    setConnections((data ?? []) as Connection[]);
  }

  useEffect(() => { void loadConnections(); }, [creatorId]);

  function getConnection(provider: string) {
    return connections.find((item) => item.provider === provider);
  }

  function connect(provider: string) {
    if (provider === "openai") {
      setMessage("CreatorHub AI will be configured once at the server level; creators will not have to sign into OpenAI.");
      return;
    }
    window.location.href = `/api/oauth/${provider}/start?creator_id=${encodeURIComponent(creatorId)}`;
  }

  return (
    <section style={{ ...card, marginTop: 22 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start", flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: "#6b7280" }}>Connections</div>
          <h2 style={{ margin: "6px 0" }}>Connect once. Stay connected.</h2>
          <p style={{ marginTop: 0, color: "#59606b", maxWidth: 680 }}>
            CreatorHub should handle redirects, authorization codes, token exchange and refresh behind the scenes. You only approve access with the provider.
          </p>
        </div>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        {providers.map((provider) => {
          const connection = getConnection(provider.id);
          const connected = connection?.status === "connected";
          return (
            <div key={provider.id} style={{ border: "1px solid #e5e7eb", borderRadius: 16, padding: 14, display: "flex", justifyContent: "space-between", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ minWidth: 220, flex: 1 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <strong>{provider.name}</strong>
                  <span style={{ fontSize: 12, padding: "4px 8px", borderRadius: 999, background: connected || provider.managed ? "#eef8f0" : "#f3f4f6" }}>
                    {provider.managed ? "CreatorHub managed" : connected ? "Connected" : connection?.status === "needs_setup" ? "Setup needed" : "Not connected"}
                  </span>
                </div>
                <div style={{ color: "#6b7280", marginTop: 5 }}>{connected && connection?.external_account_name ? `${connection.external_account_name} · ` : ""}{provider.detail}</div>
              </div>
              <button
                style={connected ? secondaryButton : primaryButton}
                onClick={() => connect(provider.id)}
              >
                {provider.managed ? "AI setup" : connected ? "Reconnect" : `Connect ${provider.name}`}
              </button>
            </div>
          );
        })}
      </div>
      {message && <p style={{ color: "#59606b", marginBottom: 0 }}>{message}</p>}
    </section>
  );
}
