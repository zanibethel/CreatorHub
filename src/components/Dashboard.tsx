
"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import AIRecommendationsButton from "@/components/AIRecommendationsButton";
import ConnectionsPanel from "@/components/ConnectionsPanel";
import CreatorForm from "@/components/CreatorForm";
import CreatorImageStudio from "@/components/CreatorImageStudio";
import CreatorHubAiBubble from "@/components/CreatorHubAiBubble";
import CreatorReferenceLibrary from "@/components/CreatorReferenceLibrary";
import EbookStudio from "@/components/EbookStudio";
import IntegrationHealthPanel from "@/components/IntegrationHealthPanel";
import PartnerBank from "@/components/PartnerBank";
import ProductManager from "@/components/ProductManager";
import { createClient } from "@/lib/supabase";
import { card, colors, input, primaryButton, secondaryButton } from "@/lib/ui";
import type { ContentItem, Creator, Recommendation } from "@/lib/types";

type ModuleId =
  | "creator-studio"
  | "character-library"
  | "connections"
  | "monetization"
  | "smartlink"
  | "ebook"
  | "operator"
  | "learning"
  | "system-health"
  | "workspaces";

const DEFAULT_LAYOUT: ModuleId[] = [
  "creator-studio",
  "character-library",
  "connections",
  "monetization",
  "smartlink",
  "ebook",
  "operator",
  "learning",
  "system-health",
  "workspaces",
];

const MODULE_META: Record<ModuleId, { eyebrow: string; title: string; summary: string }> = {
  "creator-studio": { eyebrow: "Create", title: "Creator Studio", summary: "Generate images and creator content." },
  "character-library": { eyebrow: "Identity", title: "Character & Brand Library", summary: "Manage approved identity references and brand assets." },
  connections: { eyebrow: "Connections", title: "Connections", summary: "Instagram, TikTok, Fanvue, and built-in AI." },
  monetization: { eyebrow: "Earn", title: "Monetization", summary: "Products, offers, partners, and earnings tools." },
  smartlink: { eyebrow: "Publish", title: "SmartLink", summary: "Open and share this creator's public destination." },
  ebook: { eyebrow: "Create", title: "Ebook Studio", summary: "Draft, package, and publish creator ebooks." },
  operator: { eyebrow: "Operate", title: "Today's Suggestions", summary: "Review AI recommendations and build campaigns." },
  learning: { eyebrow: "Learn", title: "Performance Learning", summary: "Record results so CreatorHub can learn what works." },
  "system-health": { eyebrow: "System", title: "System Health", summary: "Check core integrations only when you need them." },
  workspaces: { eyebrow: "Workspace", title: "Creator Workspaces", summary: "Add another creator or AI persona." },
};

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

  const [layout, setLayout] = useState<ModuleId[]>(DEFAULT_LAYOUT);
  const [hiddenModules, setHiddenModules] = useState<ModuleId[]>([]);
  const [openModules, setOpenModules] = useState<ModuleId[]>([]);
  const [editingLayout, setEditingLayout] = useState(false);
  const [draggingModule, setDraggingModule] = useState<ModuleId | null>(null);
  const [layoutReady, setLayoutReady] = useState(false);

  const activeCreator = creators.find((item) => item.id === creatorId) ?? null;
  const layoutKey = creatorId ? `creatorhub.dashboard-layout.v2.${userId}.${creatorId}` : "";

  async function loadCreators(preferredId?: string) {
    const { data, error } = await supabase
      .from("creators")
      .select("id,name,slug,creator_type,primary_goal,description,niche,target_audience,tone,visual_description,persona_lore,boundaries,content_pillars,preferred_platforms")
      .eq("user_id", userId)
      .order("created_at");
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

  useEffect(() => {
    if (!layoutKey) return;
    setLayoutReady(false);
    setOpenModules([]);
    setEditingLayout(false);
    try {
      const raw = window.localStorage.getItem(layoutKey);
      if (!raw) {
        setLayout(DEFAULT_LAYOUT);
        setHiddenModules([]);
      } else {
        const saved = JSON.parse(raw) as { order?: string[]; hidden?: string[] };
        const validOrder = (saved.order || []).filter(
          (id): id is ModuleId => DEFAULT_LAYOUT.includes(id as ModuleId),
        );
        setLayout([
          ...validOrder,
          ...DEFAULT_LAYOUT.filter((id) => !validOrder.includes(id)),
        ]);
        setHiddenModules(
          (saved.hidden || []).filter(
            (id): id is ModuleId => DEFAULT_LAYOUT.includes(id as ModuleId),
          ),
        );
      }
    } catch {
      setLayout(DEFAULT_LAYOUT);
      setHiddenModules([]);
    }
    setLayoutReady(true);
  }, [layoutKey]);

  useEffect(() => {
    if (!layoutReady || !layoutKey) return;
    window.localStorage.setItem(layoutKey, JSON.stringify({ order: layout, hidden: hiddenModules }));
  }, [layout, hiddenModules, layoutKey, layoutReady]);

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
    const { error: updateError } = await supabase
      .from("recommendations")
      .update({ status: "approved", resolved_at: new Date().toISOString() })
      .eq("id", item.id);
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

  function toggleModule(id: ModuleId) {
    setOpenModules((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  function openAndScroll(id: ModuleId) {
    setHiddenModules((current) => current.filter((item) => item !== id));
    setOpenModules((current) => (current.includes(id) ? current : [...current, id]));
    window.setTimeout(() => {
      document.getElementById(`creatorhub-module-${id}`)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 80);
  }

  function moveModule(id: ModuleId, direction: -1 | 1) {
    setLayout((current) => {
      const index = current.indexOf(id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  }

  function dropModule(target: ModuleId) {
    if (!draggingModule || draggingModule === target) return;
    setLayout((current) => {
      const next = current.filter((item) => item !== draggingModule);
      const targetIndex = next.indexOf(target);
      next.splice(targetIndex, 0, draggingModule);
      return next;
    });
    setDraggingModule(null);
  }

  function toggleHidden(id: ModuleId) {
    setHiddenModules((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  function resetLayout() {
    setLayout(DEFAULT_LAYOUT);
    setHiddenModules([]);
    setOpenModules([]);
  }

  const totalViews = content.reduce((sum, item) => sum + Number(item.views || 0), 0);
  const totalRevenue = content.reduce((sum, item) => sum + Number(item.revenue || 0), 0);
  const pendingRecommendations = recommendations.filter((item) => item.status === "pending");
  const visibleLayout = layout.filter((id) => !hiddenModules.includes(id));

  function renderModuleContent(id: ModuleId) {
    if (!activeCreator) return null;

    switch (id) {
      case "creator-studio":
        return <CreatorImageStudio creator={activeCreator} userId={userId} />;
      case "character-library":
        return (
          <CreatorReferenceLibrary
            userId={userId}
            creatorId={creatorId}
            creatorName={activeCreator.name}
          />
        );
      case "connections":
        return <ConnectionsPanel userId={userId} creatorId={creatorId} />;
      case "monetization":
        return (
          <>
            <ProductManager userId={userId} creatorId={creatorId} />
            <PartnerBank />
          </>
        );
      case "smartlink":
        return (
          <div style={{ padding: "14px 0 4px" }}>
            <p style={{ color: colors.muted, marginTop: 0 }}>
              Open the public page for {activeCreator.name}, preview what visitors see,
              and share it when you are ready.
            </p>
            <a
              style={{ ...primaryButton, display: "inline-flex", textDecoration: "none" }}
              href={`/s/${activeCreator.slug}`}
              target="_blank"
            >
              Open {activeCreator.name}&apos;s SmartLink →
            </a>
          </div>
        );
      case "ebook":
        return <EbookStudio userId={userId} creatorId={creatorId} />;
      case "operator":
        return (
          <div style={{ paddingTop: 14 }}>
            <AIRecommendationsButton
              creator={activeCreator}
              creatorId={creatorId}
              content={content}
              onDone={() => loadWorkspace(creatorId)}
            />
            <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
              {pendingRecommendations.slice(0, 3).map((item) => (
                <article key={item.id} style={{ ...card, borderLeft: `5px solid ${colors.purple}` }}>
                  <strong style={{ fontSize: 18 }}>{item.title}</strong>
                  <p>{item.summary}</p>
                  <p style={{ color: colors.muted }}>
                    <strong style={{ color: colors.text }}>Why:</strong> {item.reason}
                  </p>
                  <button style={primaryButton} onClick={() => void approveRecommendation(item)}>
                    Approve & build campaign
                  </button>
                </article>
              ))}
              {pendingRecommendations.length === 0 ? (
                <p style={{ color: colors.muted, marginBottom: 0 }}>
                  No pending recommendations right now.
                </p>
              ) : null}
            </div>
          </div>
        );
      case "learning":
        return (
          <form onSubmit={addContent} style={{ ...card, marginTop: 14 }}>
            <select name="platform" style={input}>
              <option>TikTok</option><option>Instagram</option><option>Facebook</option>
              <option>YouTube</option><option>X</option><option>Other</option>
            </select>
            <input name="title" style={input} placeholder="Post title / idea" />
            <textarea
              name="caption"
              style={{ ...input, minHeight: 80 }}
              placeholder="Caption, hook, product, or what happened"
            />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8 }}>
              <input name="views" type="number" min="0" style={input} placeholder="Views" />
              <input name="clicks" type="number" min="0" style={input} placeholder="Link clicks" />
              <input name="revenue" type="number" min="0" step="0.01" style={input} placeholder="Revenue" />
            </div>
            <button style={{ ...primaryButton, marginTop: 12 }}>Add content</button>
          </form>
        );
      case "system-health":
        return <IntegrationHealthPanel />;
      case "workspaces":
        return (
          <section style={{ ...card, marginTop: 14 }}>
            <CreatorForm onSubmit={createCreator} />
          </section>
        );
    }
  }

  return (
    <main style={{ maxWidth: 1120, margin: "0 auto", padding: 24 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <div>
          <div style={{ color: colors.purpleBright, fontWeight: 900, fontSize: 22 }}>CreatorHub</div>
          <div style={{ color: colors.muted, marginTop: 3, fontSize: 13 }}>
            Track → understand → suggest → approve → learn
          </div>
        </div>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <a href="/upload" style={{ ...secondaryButton, display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
            Upload
          </a>
          <a href="/paper-trading" style={{ ...secondaryButton, display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
            Trading Lab
          </a>
          <a href="/paper-trading/bots" style={{ ...secondaryButton, display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
            Bot Lab
          </a>
          {activeCreator ? (
            <button type="button" style={secondaryButton} onClick={() => setEditingLayout((current) => !current)}>
              {editingLayout ? "Done" : "Edit"}
            </button>
          ) : null}
          <button style={secondaryButton} onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </header>

      <section style={{ ...card, marginBottom: 12, padding: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 10, alignItems: "end" }}>
          <label style={{ minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em", color: colors.muted, fontWeight: 800, marginBottom: 6 }}>
              Active workspace
            </span>
            <select style={{ ...input, margin: 0 }} value={creatorId} onChange={(event) => setCreatorId(event.target.value)}>
              <option value="">Choose creator</option>
              {creators.map((creator) => (
                <option key={creator.id} value={creator.id}>{creator.name} · {creator.creator_type}</option>
              ))}
            </select>
          </label>
          {activeCreator ? (
            <a
              style={{ ...secondaryButton, textDecoration: "none", whiteSpace: "nowrap", display: "inline-flex" }}
              href={`/s/${activeCreator.slug}`}
              target="_blank"
            >
              SmartLink →
            </a>
          ) : null}
        </div>
      </section>

      {!activeCreator ? (
        <section style={card}>
          <div style={{ color: colors.purpleBright, fontWeight: 800, fontSize: 12, textTransform: "uppercase", letterSpacing: ".08em" }}>Start here</div>
          <h2>Create your first workspace</h2>
          <CreatorForm onSubmit={createCreator} />
        </section>
      ) : (
        <>
          <section style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8, marginBottom: 12 }}>
            <div style={{ ...card, padding: 12 }}>
              <small style={{ color: colors.muted }}>Content</small>
              <div style={{ fontWeight: 900, fontSize: 23, marginTop: 4 }}>{content.length}</div>
            </div>
            <div style={{ ...card, padding: 12 }}>
              <small style={{ color: colors.muted }}>Views</small>
              <div style={{ fontWeight: 900, fontSize: 23, marginTop: 4 }}>{totalViews.toLocaleString()}</div>
            </div>
            <div style={{ ...card, padding: 12, borderColor: "#5b3a86" }}>
              <small style={{ color: colors.muted }}>Revenue</small>
              <div style={{ fontWeight: 900, fontSize: 23, marginTop: 4, color: colors.purpleBright }}>${totalRevenue.toFixed(2)}</div>
            </div>
          </section>

          <section style={{ ...card, padding: 14, marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: colors.purpleBright, fontWeight: 900, textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 9 }}>
              Quick actions
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8 }}>
              <button type="button" style={primaryButton} onClick={() => openAndScroll("creator-studio")}>Generate image</button>
              <button type="button" style={secondaryButton} onClick={() => openAndScroll("connections")}>Create post</button>
              <button type="button" style={secondaryButton} onClick={() => openAndScroll("ebook")}>New ebook</button>
              <button type="button" style={secondaryButton} onClick={() => openAndScroll("monetization")}>Add product</button>
            </div>
          </section>

          {editingLayout ? (
            <section style={{ ...card, marginBottom: 12, padding: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", marginBottom: 10 }}>
                <div>
                  <strong>Customize dashboard</strong>
                  <div style={{ color: colors.muted, fontSize: 12, marginTop: 3 }}>
                    Drag on desktop or use arrows. You can hide anything you do not use often.
                  </div>
                </div>
                <button type="button" style={secondaryButton} onClick={resetLayout}>Reset</button>
              </div>
              <div style={{ display: "grid", gap: 7 }}>
                {layout.map((id, index) => {
                  const meta = MODULE_META[id];
                  const hidden = hiddenModules.includes(id);
                  return (
                    <div
                      key={id}
                      draggable
                      onDragStart={() => setDraggingModule(id)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => dropModule(id)}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(0,1fr) auto",
                        gap: 8,
                        alignItems: "center",
                        border: "1px solid #4a3565",
                        background: "rgba(13,10,21,.52)",
                        borderRadius: 12,
                        padding: 10,
                        opacity: hidden ? 0.58 : 1,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <strong>☰ {meta.title}</strong>
                        <div style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>
                          {hidden ? "Hidden" : meta.summary}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button type="button" style={{ ...secondaryButton, padding: "6px 8px" }} disabled={index === 0} onClick={() => moveModule(id, -1)}>↑</button>
                        <button type="button" style={{ ...secondaryButton, padding: "6px 8px" }} disabled={index === layout.length - 1} onClick={() => moveModule(id, 1)}>↓</button>
                        <button type="button" style={{ ...secondaryButton, padding: "6px 9px" }} onClick={() => toggleHidden(id)}>
                          {hidden ? "Show" : "Hide"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}

          <section>
            <div style={{ color: colors.muted, fontSize: 11, fontWeight: 900, textTransform: "uppercase", letterSpacing: ".08em", margin: "0 2px 8px" }}>
              Your workspace
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {visibleLayout.map((id) => {
                const meta = MODULE_META[id];
                const open = openModules.includes(id);
                return (
                  <article
                    id={`creatorhub-module-${id}`}
                    key={id}
                    style={{ ...card, padding: 0, overflow: "hidden", scrollMarginTop: 16 }}
                  >
                    <button
                      type="button"
                      onClick={() => toggleModule(id)}
                      style={{
                        width: "100%",
                        border: 0,
                        background: "transparent",
                        color: colors.text,
                        padding: 14,
                        display: "grid",
                        gridTemplateColumns: "minmax(0,1fr) auto",
                        gap: 10,
                        textAlign: "left",
                        alignItems: "center",
                        cursor: "pointer",
                      }}
                    >
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: "block", color: colors.purpleBright, fontSize: 10, fontWeight: 900, textTransform: "uppercase", letterSpacing: ".09em", marginBottom: 3 }}>
                          {meta.eyebrow}
                        </span>
                        <strong style={{ display: "block", fontSize: 17 }}>{meta.title}</strong>
                        <span style={{ display: "block", color: colors.muted, fontSize: 12, marginTop: 3, lineHeight: 1.3 }}>
                          {meta.summary}
                        </span>
                      </span>
                      <span
                        aria-hidden="true"
                        style={{
                          color: colors.purpleBright,
                          fontSize: 22,
                          transform: open ? "rotate(90deg)" : "none",
                          transition: "transform .15s ease",
                        }}
                      >
                        ›
                      </span>
                    </button>
                    {open ? (
                      <div style={{ borderTop: "1px solid #3d2d50", padding: "0 14px 14px" }}>
                        {renderModuleContent(id)}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </section>
        </>
      )}

      {savingCreator ? (
        <div style={{ ...card, position: "fixed", right: 18, bottom: 90 }}>Creating workspace…</div>
      ) : null}
      {!savingCreator && message ? (
        <div style={{ ...card, position: "fixed", right: 18, bottom: 90, maxWidth: 420, zIndex: 10 }}>
          {message}
        </div>
      ) : null}

      {activeCreator ? (
        <CreatorHubAiBubble
          creatorId={creatorId}
          creatorName={activeCreator.name}
          onOpenModule={openAndScroll}
        />
      ) : null}
    </main>
  );
}
