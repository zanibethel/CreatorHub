import { createClient } from "@supabase/supabase-js";

const FALLBACK_URL = "https://yufptpfiwdbzzrvhkvux.supabase.co";
const FALLBACK_PUBLISHABLE_KEY = "sb_publishable_JpayDIqb8Gy-hnGSL99fdg_jmKQQNJh";

export default async function SmartLinkPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || FALLBACK_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || FALLBACK_PUBLISHABLE_KEY;

  const supabase = createClient(url, key);
  const { data } = await supabase.rpc("get_public_smartlink", { p_slug: slug });
  if (!data?.creator) return <main style={{ padding: 24 }}>Creator not found.</main>;

  const creator = data.creator as { name: string; description?: string; niche?: string; is_ai_generated?: boolean };
  const destinations = (data.destinations ?? []) as Array<{ id: string; label: string; url: string; is_featured: boolean }>;

  return (
    <main style={{ maxWidth: 520, margin: "0 auto", padding: "48px 20px", textAlign: "center" }}>
      <div style={{ width: 84, height: 84, borderRadius: 999, background: "#111", color: "white", display: "grid", placeItems: "center", margin: "0 auto", fontSize: 32, fontWeight: 800 }}>
        {creator.name.slice(0, 1).toUpperCase()}
      </div>
      <h1>{creator.name}</h1>
      {creator.niche && <p style={{ color: "#6b7280" }}>{creator.niche}</p>}
      {creator.is_ai_generated && <p style={{ fontSize: 13, color: "#6b7280" }}>AI-generated creator</p>}
      {creator.description && <p>{creator.description}</p>}
      <div style={{ marginTop: 24 }}>
        {destinations.map((item) => (
          <a key={item.id} href={item.url} target="_blank" rel="noreferrer" style={{ display: "block", padding: 15, margin: "10px 0", borderRadius: 14, background: "white", color: "#111", textDecoration: "none", fontWeight: 700, border: item.is_featured ? "2px solid #111" : "1px solid #e5e7eb" }}>
            {item.is_featured ? "★ " : ""}{item.label}
          </a>
        ))}
        {!destinations.length && <p style={{ color: "#6b7280" }}>Links coming soon.</p>}
      </div>
      <p style={{ marginTop: 30, fontSize: 12, color: "#9ca3af" }}>Powered by CreatorHub</p>
    </main>
  );
}
