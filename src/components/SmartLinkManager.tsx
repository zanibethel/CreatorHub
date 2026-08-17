"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase";
import { card, input, primaryButton, secondaryButton } from "@/lib/ui";

type Destination = {
  id: string;
  label: string;
  url: string;
  destination_type: string;
  is_featured: boolean;
};

export default function SmartLinkManager({ creatorId }: { creatorId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<Destination[]>([]);
  const [message, setMessage] = useState("");

  async function load() {
    const { data, error } = await supabase
      .from("smartlink_destinations")
      .select("id,label,url,destination_type,is_featured")
      .eq("creator_id", creatorId)
      .eq("is_active", true)
      .order("is_featured", { ascending: false })
      .order("priority");
    if (error) return setMessage(error.message);
    setItems((data ?? []) as Destination[]);
  }

  useEffect(() => { load(); }, [creatorId]);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const { error } = await supabase.from("smartlink_destinations").insert({
      creator_id: creatorId,
      label: String(form.get("label") ?? ""),
      url: String(form.get("url") ?? ""),
      destination_type: String(form.get("type") ?? "social"),
      priority: items.length,
    });
    if (error) return setMessage(error.message);
    event.currentTarget.reset();
    await load();
  }

  async function feature(id: string) {
    await supabase.from("smartlink_destinations").update({ is_featured: false }).eq("creator_id", creatorId);
    const { error } = await supabase.from("smartlink_destinations").update({ is_featured: true }).eq("id", id);
    if (error) return setMessage(error.message);
    await load();
  }

  return (
    <section style={card}>
      <h3 style={{ marginTop: 0 }}>SmartLink destinations</h3>
      <p style={{ color: "#6b7280" }}>One universal link. Feature the destination that matters most right now.</p>
      {items.map((item) => (
        <div key={item.id} style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid #eee" }}>
          <div><strong>{item.is_featured ? "★ " : ""}{item.label}</strong><div style={{ color: "#6b7280", fontSize: 13 }}>{item.destination_type}</div></div>
          {!item.is_featured && <button style={secondaryButton} onClick={() => feature(item.id)}>Feature</button>}
        </div>
      ))}
      <form onSubmit={add} style={{ marginTop: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <input name="label" required style={input} placeholder="Instagram, Store, Membership..." />
          <select name="type" style={input}><option value="social">Social</option><option value="affiliate">Affiliate</option><option value="subscription">Subscription</option><option value="store">Store</option><option value="other">Other</option></select>
        </div>
        <input name="url" type="url" required style={input} placeholder="https://..." />
        <button style={{ ...primaryButton, marginTop: 10 }}>Add destination</button>
      </form>
      {message && <p>{message}</p>}
    </section>
  );
}
