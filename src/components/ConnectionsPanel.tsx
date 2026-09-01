"use client";

import { useEffect, useMemo, useState } from "react";
import ProductManager from "@/components/ProductManager";
import { createClient } from "@/lib/supabase";
import { card, primaryButton, secondaryButton } from "@/lib/ui";

type Connection = {
  id: string;
  provider: string;
  status: string;
  external_account_name: string | null;
  connected_at: string | null;
};

type ProviderHealth = { configured?: boolean; detail?: string };
type HealthResponse = {
  instagram?: ProviderHealth;
  tiktok?: ProviderHealth;
  fanvue?: ProviderHealth;
};

const providers = [
  {
    id: "openai",
    name: "CreatorHub AI · Claude",
    detail: "Claude runs through CreatorHub's Vercel AI Gateway. Creators do not need a Claude password or Anthropic API key.",
    managed: true,
  },
  {
    id: "instagram",
    name: "Instagram",
    detail: "Connect an Instagram professional creator or business account and return to CreatorHub automatically.",
    managed: false,
  },
  {
    id: "tiktok",
    name: "TikTok",
    detail: "Authorize with TikTok Login Kit. CreatorHub stores tokens server-side and can refresh access without asking for the password again.",
    managed: false,
  },
  {
    id: "fanvue",
    name: "Fanvue",
    detail: "Authorize a verified Fanvue creator through OAuth with PKCE and keep the connection available for CreatorHub workflows.",
    managed: false,
  },
] as const;

export default function ConnectionsPanel({ userId, creatorId }: { userId: string; creatorId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [health, setHealth] = useState<HealthResponse>({});
  const [message, setMessage] = useState("");

  async function loadConnections() {
    const [{ data, error }, healthResponse] = await Promise.all([
      supabase
        .from("integration_connections")
        .select("id,provider,status,external_account_name,connected_at")
        .eq("user_id", userId)
        .or(`creator_id.eq.${creatorId},creator_id.is.null`),
      fetch("/api/system/integration-health", { cache: "no-store" }).catch(() => null),
    ]);
    if (error) return setMessage(error.message);
    setConnections((data ?? []) as Connection[]);
    if (healthResponse?.ok) setHealth((await healthResponse.json()) as HealthResponse);
  }

  useEffect(() => { void loadConnections(); }, [creatorId]);

  function getConnection(provider: string) {
    return connections.find((item) => item.provider === provider);
  }

  function configured(providerId: "instagram" | "tiktok" | "fanvue") {
    return health[providerId]?.configured === true;
  }

  function connect(provider: typeof providers[number]) {
    if (provider.managed) {
      setMessage("Claude is managed inside CreatorHub through Vercel AI Gateway. No separate Claude login is required.");
      return;
    }
    if (!configured(provider.id)) {
      setMessage(`${provider.name} OAuth is built, but the CreatorHub developer-app credentials still need to be added before accounts can connect.`);
      return;
    }
    window.location.href = `/api/oauth/${provider.id}/start?creator_id=${encodeURIComponent(creatorId)}`;
  }

  return (
    <>
      <section style={{ ...card, marginTop: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: "#c4a7ef" }}>Connections</div>
            <h2 style={{ margin: "6px 0", color: "#ffffff" }}>Connect once. Stay connected.</h2>
            <p style={{ marginTop: 0, color: "#cfc7da", maxWidth: 680, lineHeight: 1.5 }}>
              Tap Connect, approve access on the provider&apos;s trusted screen, and CreatorHub brings you back automatically. No auth-code or URL copying.
            </p>
          </div>
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          {providers.map((provider) => {
            const connection = getConnection(provider.id);
            const connected = connection?.status === "connected";
            const ready = provider.managed || configured(provider.id);
            const statusText = provider.managed
              ? "Built in"
              : connected
                ? "Connected"
                : !ready
                  ? "Setup required"
                  : connection?.status === "error"
                    ? "Needs attention"
                    : "Ready to connect";
            return (
              <div
                key={provider.id}
                style={{
                  border: "1px solid #4a3565",
                  background: "rgba(13, 10, 21, 0.52)",
                  borderRadius: 18,
                  padding: 16,
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 14,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ minWidth: 220, flex: 1 }}>
                  <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}>
                    <strong style={{ color: "#ffffff", fontSize: 18 }}>{provider.name}</strong>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 800,
                        padding: "5px 9px",
                        borderRadius: 999,
                        color: connected || provider.managed ? "#f3e8ff" : "#ddd6e8",
                        background: connected || provider.managed ? "#53317c" : "#2a2235",
                        border: `1px solid ${connected || provider.managed ? "#8b5cf6" : "#4a4057"}`,
                      }}
                    >
                      {statusText}
                    </span>
                  </div>
                  <div style={{ color: "#bbb2c8", marginTop: 7, lineHeight: 1.45 }}>
                    {connected && connection?.external_account_name ? <><span style={{ color: "#d8b4fe", fontWeight: 700 }}>{connection.external_account_name}</span><span> · </span></> : null}
                    {provider.detail}
                  </div>
                </div>
                <button style={connected ? secondaryButton : primaryButton} onClick={() => connect(provider)}>
                  {provider.managed ? "AI status" : connected ? `Reconnect ${provider.name}` : ready ? `Connect ${provider.name}` : `Set up ${provider.name}`}
                </button>
              </div>
            );
          })}
        </div>
        {message && (
          <p style={{ color: "#d8c8eb", background: "#21172f", border: "1px solid #4d3769", borderRadius: 12, padding: 12, marginBottom: 0 }}>
            {message}
          </p>
        )}
      </section>
      <ProductManager userId={userId} creatorId={creatorId} />
    </>
  );
}
