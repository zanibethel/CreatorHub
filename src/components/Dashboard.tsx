"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import AIRecommendationsButton from "@/components/AIRecommendationsButton";
import ConnectionsPanel from "@/components/ConnectionsPanel";
import CreatorForm from "@/components/CreatorForm";
import { createClient } from "@/lib/supabase";
import { card, colors, input, primaryButton, secondaryButton } from "@/lib/ui";
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

  async function approveRecommendation(item: Recommendation) {
    if (!creatorId || !activeCreator) return;
    const { error: updateError } = await supabase.from("recommendations")
      .update({ status: "approved", resolved_at: new Date().toISOString() }).eq("id", item.id);
    if (updateError) return setMessage(updateError.message);

    const platformPlan = activeCreator.creator_type === "ai"
      ? {
          tiktok: { format: "10-20 second vertical teaser", hook: "Put the clearest visual in the first second" },
          instagram: { format: "Reel plus carousel", hook: "Lead with the strongest frame" },
          premium: { format: "Expanded continuation for the creator's paid destination" },
        }
      : {
          tiktok: {
            duration: "20-30 seconds",
            script: `Hook: Here is one ${activeCreator.niche || "thing"} I actually recommend.\n1. Show it immediately.\n2. Give one reason you use it.\n3. Mention one limitation.\n4. CTA: point viewers to your SmartLink.`,
          },
          instagram: { format: "Reuse the recording as a Reel with the key takeaway in the caption" },
        };

    const { error } = await supabase.from("campaigns").insert({
      creator_id: creatorId,
      recommendation_id: item.id,
      name: item.title,
      objective: item.goal,
      reasoning: item.reason,
      status: "awaiting_approval",
      platform_plan: platformPlan,
      monetization_plan: { smartlink: true },
    });
    if (error) return setMessage(error.message);
    await loadWorkspace(creatorId);
    setMessage("Approved. A campaign plan was created.");
  }

  const totalViews = content.reduce((sum, item) => sum + Number(item.views || 0), 0);
  const totalRevenue = content.reduce((sum, item) => sum + Number(item.revenue || 0), 0);

  return (
    <main style={{ maxWidth: 1120, margin: "0 auto", padding: 24 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 22 }}>
        <div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, color: colors.purpleBright, fontWeight: 900, letterSpacing: ".02em", fontSize: 22 }}>CreatorHub</div>
          <div style={{ color: colors.muted, marginTop: 4 }}>Track → understand → suggest → approve → learn</div>
        </div>
        <button style={secondaryButton} onClick={() => supabase.auth.signOut()}>Sign out</button>
      </header>

      <section style={{ ...card, marginBottom: 16 }}>
        <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: ".08em", color: colors.muted, fontWeight: 800, marginBottom: 8 }}>Active workspace</div>
        <select style={{ ...input, margin: 0 }} value={creatorId} onChange={(event) => setCreatorId(event.target.value)}>
          <option value="">Choose creator</option>
          {creators.map((creator) => <option key={creator.id} value={creator.id}>{creator.name} · {creator.creator_type}</option>)}
        </select>
        {activeCreator && <p style={{ marginBottom: 0 }}><a style={{ color: colors.purpleBright, fontWeight: 700 }} href={`/s/${activeCreator.slug}`} target="_blank">Open {activeCreator.name}&apos;s SmartLink →</a></p>}
      </section>

      {!activeCreator ? (
        <section style={card}>
          <div style={{ color: colors.purpleBright, fontWeight: 800, fontSize: 12, textTransform: "uppercase", letterSpacing: ".08em" }}>Start here</div>
          <h2>Create your first workspace</h2>
          <CreatorForm onSubmit={createCreator} />
        </section>
      ) : (
        <>
          <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}>
            <div style={card}><small style={{ color: colors.muted }}>Content tracked</small><h2 style={{ marginBottom: 0 }}>{content.length}</h2></div>
            <div style={card}><small style={{ color: colors.muted }}>Views</small><h2 style={{ marginBottom: 0 }}>{totalViews.toLocaleString()}</h2></div>
            <div style={{ ...card, borderColor: "#5b3a86" }}><small style={{ color: colors.muted }}>Revenue</small><h2 style={{ marginBottom: 0, color: colors.purpleBright }}>${totalRevenue.toFixed(2)}</h2></div>
          </section>

          <ConnectionsPanel userId={userId} creatorId={creatorId} />

          <section style={{ marginTop: 26 }}>
            <div style={{ color: colors.purpleBright, fontWeight: 800, fontSize: 12, textTransform: "uppercase", letterSpacing: ".08em" }}>Creator operator</div>
            <h2 style={{ marginTop: 6 }}>Today</h2>
            <AIRecommendationsButton creator={activeCreator} creatorId={creatorId} content={content} onDone={() => loadWorkspace(creatorId)} />
          </section>

          <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
            {recommendations.filter((item) => item.status === "pending").slice(0, 3).map((item) => (
              <article key={item.id} style={{ ...card, borderLeft: `5px solid ${colors.purple}` }}>
                <strong style={{ fontSize: 18 }}>{item.title}</strong>
                <p>{item.summary}</p>
                <p style={{ color: colors.muted }}><strong style={{ color: colors.text }}>Why:</strong> {item.reason}</p>
                <button style={primaryButton} onClick={() => approveRecommendation(item)}>Approve & build campaign</button>
              </article>
            ))}
          </div>

          <section style={{ marginTop: 26 }}>
            <div style={{ color: colors.muted, fontWeight: 800, fontSize: 12, textTransform: "uppercase", letterSpacing: ".08em" }}>Learning</div>
            <h2 style={{ marginTop: 6 }}>Teach CreatorHub what works</h2>
          </section>
          <form onSubmit={addContent} style={card}>
            <select name="platform" style={input}>
              <option>TikTok</option><option>Instagram</option><option>Facebook</option><option>YouTube</option><option>X</option><option>Other</option>
            </select>
            <input name="title" style={input} placeholder="Post title / idea" />
            <textarea name="caption" style={{ ...input, minHeight: 80 }} placeholder="Caption, hook, product, or what happened" />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8 }}>
              <input name="views" type="number" min="0" style={input} placeholder="Views" />
              <input name="clicks" type="number" min="0" style={input} placeholder="Link clicks" />
              <input name="revenue" type="number" min="0" step="0.01" style={input} placeholder="Revenue" />
            </div>
            <button style={{ ...primaryButton, marginTop: 12 }}>Add content</button>
          </form>

          <section style={{ marginTop: 26 }}>
            <div style={{ color: colors.muted, fontWeight: 800, fontSize: 12, textTransform: "uppercase", letterSpacing: ".08em" }}>Workspaces</div>
            <h2 style={{ marginTop: 6 }}>Add another creator</h2>
          </section>
          <section style={card}><CreatorForm onSubmit={createCreator} /></section>
        </>
      )}

      {savingCreator && <div style={{ ...card, position: "fixed", right: 18, bottom: 18 }}>Creating workspace…</div>}
      {!savingCreator && message && <div style={{ ...card, position: "fixed", right: 18, bottom: 18, maxWidth: 420 }}>{message}</div>}
    </main>
  );
}
