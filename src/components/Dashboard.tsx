"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import CreatorForm from "@/components/CreatorForm";
import ConnectionsPanel from "@/components/ConnectionsPanel";
import { createClient } from "@/lib/supabase";
import { card, input, primaryButton, secondaryButton } from "@/lib/ui";
import type { ContentItem, Creator, Recommendation } from "@/lib/types";

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export default function Dashboard({ userId }: { userId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [creators, setCreators] = useState<Creator[]>([]);
  const [creatorId, setCreatorId] = useState("");
  const [content, setContent] = useState<ContentItem[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [message, setMessage] = useState("");
  const [savingCreator, setSavingCreator] = useState(false);
  const activeCreator = creators.find((item) => item.id === creatorId) ?? null;

  async function loadCreators(preferredId?: string) {
    const { data, error } = await supabase.from("creators")
      .select("id,name,slug,creator_type,primary_goal,niche,tone")
      .eq("user_id", userId).order("created_at");
    if (error) return setMessage(error.message);
    const rows = (data ?? []) as Creator[];
    setCreators(rows);
    if (preferredId) setCreatorId(preferredId);
    else if (!creatorId && rows.length) setCreatorId(rows[0].id);
  }

  async function loadWorkspace(id: string) {
    const [posts, recs] = await Promise.all([
      supabase.from("content_items").select("id,platform,title,caption,views,link_clicks,revenue").eq("creator_id", id).order("created_at", { ascending: false }),
      supabase.from("recommendations").select("id,title,summary,reason,goal,effort_minutes,status").eq("creator_id", id).order("created_at", { ascending: false }),
    ]);
    setContent((posts.data ?? []) as ContentItem[]);
    setRecommendations((recs.data ?? []) as Recommendation[]);
  }

  useEffect(() => { void loadCreators(); }, []);
  useEffect(() => { if (creatorId) void loadWorkspace(creatorId); }, [creatorId]);

  async function createCreator(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingCreator) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const name = String(form.get("name") ?? "").trim();
    const type = String(form.get("type") ?? "human");
    const adult = form.get("adult") === "on";
    if (type === "ai" && !adult) return setMessage("Please confirm the AI creator age requirement.");

    setSavingCreator(true);
    setMessage("Creating workspace…");
    const { data, error } = await supabase.from("creators").insert({
      user_id: userId,
      name,
      slug: `${slugify(name)}-${Math.random().toString(36).slice(2, 6)}`,
      creator_type: type,
      primary_goal: String(form.get("goal") ?? "grow audience"),
      niche: String(form.get("niche") ?? ""),
      tone: String(form.get("tone") ?? ""),
      is_ai_generated: type === "ai",
      adult_confirmed: type === "ai" ? adult : false,
    }).select("id").single();

    if (error) {
      setSavingCreator(false);
      return setMessage(error.message);
    }

    formElement.reset();
    await loadCreators(data.id);
    setSavingCreator(false);
    setMessage("Creator workspace created.");
  }

  async function addContent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!creatorId) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const numeric = (key: string) => Number(form.get(key) || 0);
    const { error } = await supabase.from("content_items").insert({
      creator_id: creatorId,
      platform: String(form.get("platform") ?? "Other"),
      title: String(form.get("title") ?? ""),
      caption: String(form.get("caption") ?? ""),
      views: numeric("views"),
      link_clicks: numeric("clicks"),
      revenue: numeric("revenue"),
    });
    if (error) return setMessage(error.message);
    formElement.reset();
    await loadWorkspace(creatorId);
    setMessage("Content added.");
  }

  async function generateRecommendations() {
    if (!creatorId || !activeCreator) return;
    const ranked = [...content].sort((a, b) =>
      (Number(b.revenue) * 100 + Number(b.link_clicks) * 4 + Number(b.views) / 1000) -
      (Number(a.revenue) * 100 + Number(a.link_clicks) * 4 + Number(a.views) / 1000));
    const winner = ranked[0];
    const niche = activeCreator.niche || "your niche";
    const rows = winner ? [
      { creator_id: creatorId, title: `Follow up on ${winner.title || "your strongest post"}`, summary: "Reuse the winning idea with a different hook instead of starting from scratch.", reason: "It has the strongest blended signal from revenue, clicks and views in the content you entered.", goal: Number(winner.revenue) > 0 || Number(winner.link_clicks) > 0 ? "monetization" : "growth", confidence: 0.82, effort_minutes: 25 },
      { creator_id: creatorId, title: `Create a simple ${niche} recommendation post`, summary: "Teach, compare or recommend one useful thing your audience can act on.", reason: "This creates a clean test for profile intent and future affiliate opportunities.", goal: "learning", confidence: 0.68, effort_minutes: 20 },
      { creator_id: creatorId, title: "Test one new hook", summary: "Keep the subject familiar and change only the first few seconds.", reason: "Controlled variants help CreatorHub learn why something worked.", goal: "growth", confidence: 0.72, effort_minutes: 15 },
    ] : [
      { creator_id: creatorId, title: `Create your first ${niche} baseline post`, summary: "Start with one low-effort piece so CreatorHub has something to learn from.", reason: "There is not enough performance history yet for a personalized recommendation.", goal: "learning", confidence: 0.60, effort_minutes: 20 },
    ];
    await supabase.from("recommendations").delete().eq("creator_id", creatorId).eq("status", "pending");
    const { error } = await supabase.from("recommendations").insert(rows);
    if (error) return setMessage(error.message);
    await loadWorkspace(creatorId);
    setMessage("Today recommendations generated.");
  }

  async function approveRecommendation(item: Recommendation) {
    if (!creatorId || !activeCreator) return;
    const { error: updateError } = await supabase.from("recommendations")
      .update({ status: "approved", resolved_at: new Date().toISOString() }).eq("id", item.id);
    if (updateError) return setMessage(updateError.message);
    const platformPlan = activeCreator.creator_type === "ai"
      ? { tiktok: { format: "10-20 second vertical teaser", hook: "Put the clearest visual in the first second" }, instagram: { format: "Reel plus carousel", hook: "Lead with the strongest frame" }, premium: { format: "Expanded continuation for the creator's paid destination" } }
      : { tiktok: { duration: "20-30 seconds", script: `Hook: Here is one ${activeCreator.niche || "thing"} I actually recommend.\n1. Show it immediately.\n2. Give one reason you use it.\n3. Mention one limitation.\n4. CTA: point viewers to your SmartLink.` }, instagram: { format: "Reuse the recording as a Reel with the key takeaway in the caption" } };
    const { error } = await supabase.from("campaigns").insert({ creator_id: creatorId, recommendation_id: item.id, name: item.title, objective: item.goal, reasoning: item.reason, status: "awaiting_approval", platform_plan: platformPlan, monetization_plan: { smartlink: true } });
    if (error) return setMessage(error.message);
    await loadWorkspace(creatorId);
    setMessage("Approved. A campaign plan was created.");
  }

  const totalViews = content.reduce((sum, item) => sum + Number(item.views || 0), 0);
  const totalRevenue = content.reduce((sum, item) => sum + Number(item.revenue || 0), 0);

  return <main style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
    <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 20 }}>
      <div><strong style={{ fontSize: 22 }}>CreatorHub</strong><div style={{ color: "#6b7280" }}>Track → suggest → approve → learn</div></div>
      <button style={secondaryButton} onClick={() => supabase.auth.signOut()}>Sign out</button>
    </header>
    <section style={{ ...card, marginBottom: 16 }}>
      <select style={{ ...input, margin: 0 }} value={creatorId} onChange={(e) => setCreatorId(e.target.value)}><option value="">Choose creator</option>{creators.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.creator_type}</option>)}</select>
      {activeCreator && <p><a href={`/s/${activeCreator.slug}`} target="_blank">Open {activeCreator.name}&apos;s SmartLink →</a></p>}
    </section>
    {!activeCreator ? <section style={card}><h2>Create your first workspace</h2><CreatorForm onSubmit={createCreator} /></section> : <>
      <ConnectionsPanel userId={userId} creatorId={creatorId} />
      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12, marginTop: 22 }}><div style={card}><small>Content tracked</small><h2>{content.length}</h2></div><div style={card}><small>Views</small><h2>{totalViews.toLocaleString()}</h2></div><div style={card}><small>Revenue</small><h2>${totalRevenue.toFixed(2)}</h2></div></section>
      <h2>Today</h2><button style={primaryButton} onClick={generateRecommendations}>Generate recommendations</button>
      <div style={{ display: "grid", gap: 12, marginTop: 12 }}>{recommendations.filter((r) => r.status === "pending").slice(0, 3).map((r) => <article key={r.id} style={{ ...card, borderLeft: "5px solid #111" }}><strong>{r.title}</strong><p>{r.summary}</p><p style={{ color: "#6b7280" }}><strong>Why:</strong> {r.reason}</p><button style={primaryButton} onClick={() => approveRecommendation(r)}>Approve & build campaign</button></article>)}</div>
      <h2>Teach CreatorHub what works</h2><form onSubmit={addContent} style={card}><select name="platform" style={input}><option>TikTok</option><option>Instagram</option><option>Facebook</option><option>YouTube</option><option>X</option><option>Other</option></select><input name="title" style={input} placeholder="Post title / idea"/><textarea name="caption" style={{ ...input, minHeight: 80 }} placeholder="Caption, hook, product, or what happened"/><div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8 }}><input name="views" type="number" min="0" style={input} placeholder="Views"/><input name="clicks" type="number" min="0" style={input} placeholder="Link clicks"/><input name="revenue" type="number" min="0" step="0.01" style={input} placeholder="Revenue"/></div><button style={{ ...primaryButton, marginTop: 12 }}>Add content</button></form>
      <h2>Add another creator</h2><section style={card}><CreatorForm onSubmit={createCreator}/></section>
    </>}
    {savingCreator && <div style={{ ...card, position: "fixed", right: 18, bottom: 18 }}>Creating workspace…</div>}
    {!savingCreator && message && <div style={{ ...card, position: "fixed", right: 18, bottom: 18, maxWidth: 420 }}>{message}</div>}
  </main>;
}
