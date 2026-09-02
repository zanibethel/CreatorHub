"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase";
import { card, colors, input, primaryButton, secondaryButton } from "@/lib/ui";

type EbookProject = {
  id: string;
  title: string;
  topic: string;
  target_audience: string;
  core_promise: string;
  tone: string;
  target_word_count: number;
  price_cents: number;
  distribution_mode: "private" | "affiliate" | "marketplace";
  promoter_commission_bps: number | null;
  status: string;
  metadata: { subtitle?: string; positioning?: string } | null;
};

type EbookChapter = {
  id: string;
  project_id: string;
  position: number;
  title: string;
  summary: string;
  content: string;
  status: "planned" | "drafting" | "review" | "approved";
};

export default function EbookStudio({ userId, creatorId }: { userId: string; creatorId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [projects, setProjects] = useState<EbookProject[]>([]);
  const [projectId, setProjectId] = useState("");
  const [chapters, setChapters] = useState<EbookChapter[]>([]);
  const [chapterId, setChapterId] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftSummary, setDraftSummary] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [message, setMessage] = useState("");
  const [saveState, setSaveState] = useState("");
  const [busy, setBusy] = useState(false);
  const activeProject = projects.find((project) => project.id === projectId) ?? null;
  const activeChapter = chapters.find((chapter) => chapter.id === chapterId) ?? null;

  async function loadProjects(preferredId?: string) {
    const { data, error } = await supabase.from("ebook_projects")
      .select("id,title,topic,target_audience,core_promise,tone,target_word_count,price_cents,distribution_mode,promoter_commission_bps,status,metadata")
      .eq("creator_id", creatorId)
      .order("updated_at", { ascending: false });
    if (error) return setMessage(error.message);
    const rows = (data ?? []) as EbookProject[];
    setProjects(rows);
    if (preferredId) setProjectId(preferredId);
    else if (!projectId && rows.length) setProjectId(rows[0].id);
  }

  async function loadChapters(id: string, preferredId?: string) {
    const { data, error } = await supabase.from("ebook_chapters")
      .select("id,project_id,position,title,summary,content,status")
      .eq("project_id", id)
      .order("position");
    if (error) return setMessage(error.message);
    const rows = (data ?? []) as EbookChapter[];
    setChapters(rows);
    const nextId = preferredId ?? rows[0]?.id ?? "";
    setChapterId(nextId);
    const next = rows.find((chapter) => chapter.id === nextId);
    setDraftTitle(next?.title ?? "");
    setDraftSummary(next?.summary ?? "");
    setDraftContent(next?.content ?? "");
  }

  useEffect(() => { void loadProjects(); }, [creatorId]);
  useEffect(() => {
    if (projectId) void loadChapters(projectId);
    else {
      setChapters([]);
      setChapterId("");
    }
  }, [projectId]);

  async function saveActiveChapter() {
    if (!chapterId || !activeChapter) return;
    if (draftTitle === activeChapter.title && draftSummary === activeChapter.summary && draftContent === activeChapter.content) return;
    const nextTitle = draftTitle.trim() || activeChapter.title;
    const nextStatus = draftContent.trim() ? "drafting" : activeChapter.status;
    setSaveState("Saving…");
    const { error } = await supabase.from("ebook_chapters").update({
      title: nextTitle,
      summary: draftSummary,
      content: draftContent,
      status: nextStatus,
      updated_at: new Date().toISOString(),
    }).eq("id", chapterId);
    if (error) return setSaveState(`Save failed: ${error.message}`);
    setChapters((current) => current.map((chapter) => chapter.id === chapterId ? {
      ...chapter,
      title: nextTitle,
      summary: draftSummary,
      content: draftContent,
      status: nextStatus,
    } : chapter));
    setSaveState("Saved");
  }

  useEffect(() => {
    if (!chapterId || !activeChapter) return;
    if (draftTitle === activeChapter.title && draftSummary === activeChapter.summary && draftContent === activeChapter.content) return;
    setSaveState("Unsaved changes");
    const timer = window.setTimeout(() => { void saveActiveChapter(); }, 900);
    return () => window.clearTimeout(timer);
  }, [chapterId, draftTitle, draftSummary, draftContent]);

  function selectChapter(id: string) {
    const chapter = chapters.find((item) => item.id === id);
    setChapterId(id);
    setDraftTitle(chapter?.title ?? "");
    setDraftSummary(chapter?.summary ?? "");
    setDraftContent(chapter?.content ?? "");
    setSaveState("");
  }

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const distribution = String(form.get("distribution") ?? "private") as EbookProject["distribution_mode"];
    const commission = distribution === "private" ? null : Math.round(Number(form.get("commission") || 0) * 100);
    const { data, error } = await supabase.from("ebook_projects").insert({
      creator_id: creatorId,
      owner_user_id: userId,
      title: String(form.get("title") ?? "").trim(),
      topic: String(form.get("topic") ?? "").trim(),
      target_audience: String(form.get("audience") ?? "").trim(),
      core_promise: String(form.get("promise") ?? "").trim(),
      tone: String(form.get("tone") ?? "clear and practical").trim(),
      target_word_count: Number(form.get("wordCount") || 12000),
      price_cents: Math.round(Number(form.get("price") || 9) * 100),
      distribution_mode: distribution,
      promoter_commission_bps: commission,
    }).select("id").single();
    setBusy(false);
    if (error || !data) return setMessage(error?.message ?? "Could not create the ebook project.");
    formElement.reset();
    await loadProjects(data.id);
    setMessage("Ebook project created. Generate the outline when the brief feels right.");
  }

  async function generateOutline() {
    if (!projectId || chapters.length || busy) {
      if (chapters.length) setMessage("This project already has an outline. Edit the chapter list instead of replacing work automatically.");
      return;
    }
    setBusy(true);
    setMessage("Claude is designing the outline…");
    const { data: { session } } = await supabase.auth.getSession();
    const response = await fetch("/api/ai/ebook-outline", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
      body: JSON.stringify({ projectId }),
    });
    const result = await response.json();
    if (!response.ok) {
      setBusy(false);
      return setMessage(result.error ?? "Could not generate the outline.");
    }
    const rows = result.chapters.map((chapter: { title: string; summary: string }, index: number) => ({
      project_id: projectId,
      position: index + 1,
      title: chapter.title,
      summary: chapter.summary,
      status: "planned",
    }));
    const { error } = await supabase.from("ebook_chapters").insert(rows);
    if (!error) {
      await supabase.from("ebook_projects").update({
        title: result.title,
        status: "outlining",
        metadata: { ...(activeProject?.metadata ?? {}), subtitle: result.subtitle, positioning: result.positioning },
        updated_at: new Date().toISOString(),
      }).eq("id", projectId);
    }
    setBusy(false);
    if (error) return setMessage(error.message);
    await Promise.all([loadProjects(projectId), loadChapters(projectId)]);
    setMessage("Outline generated. Review the chapter plan before drafting.");
  }

  async function generateChapter() {
    if (!projectId || !chapterId || busy) return;
    if (draftContent.trim() && !window.confirm("Replace this chapter with a fresh Claude draft? Your current draft has been autosaved, but the editor will switch to the new version.")) return;
    setBusy(true);
    setMessage(`Claude is drafting ${draftTitle || "this chapter"}…`);
    const { data: { session } } = await supabase.auth.getSession();
    const response = await fetch("/api/ai/ebook-chapter", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
      body: JSON.stringify({ projectId, chapterId }),
    });
    const result = await response.json();
    setBusy(false);
    if (!response.ok) return setMessage(result.error ?? "Could not draft the chapter.");
    setDraftTitle(result.title);
    setDraftContent(result.content);
    const { error } = await supabase.from("ebook_chapters").update({
      title: result.title,
      content: result.content,
      status: "drafting",
      updated_at: new Date().toISOString(),
    }).eq("id", chapterId);
    if (error) return setMessage(error.message);
    await supabase.from("ebook_projects").update({ status: "drafting", updated_at: new Date().toISOString() }).eq("id", projectId);
    await loadChapters(projectId, chapterId);
    setMessage("Chapter drafted. It remains fully editable and is not published.");
  }

  const wordCount = draftContent.trim() ? draftContent.trim().split(/\s+/).length : 0;

  return (
    <section style={{ marginTop: 26 }}>
      <div style={{ color: colors.purpleBright, fontWeight: 800, fontSize: 12, textTransform: "uppercase", letterSpacing: ".08em" }}>Create</div>
      <h2 style={{ margin: "6px 0" }}>Ebook Studio</h2>
      <p style={{ color: colors.muted, marginTop: 0 }}>Plan with Claude, approve the outline, draft one chapter at a time, and keep editorial control.</p>

      <form onSubmit={createProject} style={card}>
        <h3 style={{ marginTop: 0 }}>Start a new ebook</h3>
        <input name="title" required style={input} placeholder="Working title" />
        <input name="topic" required style={input} placeholder="What is the ebook about?" />
        <textarea name="audience" required style={{ ...input, minHeight: 72 }} placeholder="Who is it specifically for?" />
        <textarea name="promise" required style={{ ...input, minHeight: 72 }} placeholder="What useful result should the reader get?" />
        <input name="tone" required style={input} defaultValue="clear, practical, direct, and encouraging" placeholder="Tone" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8 }}>
          <input name="wordCount" required type="number" min="1000" max="100000" step="500" defaultValue="12000" style={input} aria-label="Target word count" />
          <input name="price" required type="number" min="0" step="0.01" defaultValue="9" style={input} aria-label="Price in US dollars" />
          <select name="distribution" style={input} aria-label="Distribution mode">
            <option value="private">My store only</option>
            <option value="affiliate">Affiliate enabled</option>
            <option value="marketplace">CreatorHub Marketplace</option>
          </select>
          <input name="commission" type="number" min="0" max="100" step="1" defaultValue="40" style={input} aria-label="Promoter commission percent" />
        </div>
        <button disabled={busy} style={{ ...primaryButton, marginTop: 10 }}>{busy ? "Working…" : "Create ebook project"}</button>
      </form>

      {projects.length ? (
        <div style={{ ...card, marginTop: 12 }}>
          <label htmlFor="ebook-project" style={{ color: colors.muted, fontSize: 12, fontWeight: 800, textTransform: "uppercase" }}>Open project</label>
          <select id="ebook-project" style={input} value={projectId} onChange={(event) => setProjectId(event.target.value)}>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.title} · {project.status}</option>)}
          </select>
          {activeProject ? (
            <div style={{ color: colors.muted, fontSize: 14, lineHeight: 1.5, marginTop: 10 }}>
              <div><strong style={{ color: colors.text }}>Promise:</strong> {activeProject.core_promise}</div>
              <div><strong style={{ color: colors.text }}>Plan:</strong> {activeProject.target_word_count.toLocaleString()} words · ${(activeProject.price_cents / 100).toFixed(2)} · {activeProject.distribution_mode}</div>
              {activeProject.metadata?.subtitle ? <div><strong style={{ color: colors.text }}>Subtitle:</strong> {activeProject.metadata.subtitle}</div> : null}
            </div>
          ) : null}
          {!chapters.length ? <button type="button" disabled={busy} style={{ ...primaryButton, marginTop: 12 }} onClick={generateOutline}>Generate outline with Claude</button> : null}
        </div>
      ) : null}

      {chapters.length ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))", gap: 12, marginTop: 12 }}>
          <aside style={card}>
            <div style={{ color: colors.muted, fontSize: 12, fontWeight: 800, textTransform: "uppercase" }}>Outline</div>
            <div style={{ display: "grid", gap: 7, marginTop: 10 }}>
              {chapters.map((chapter) => (
                <button key={chapter.id} type="button" onClick={() => selectChapter(chapter.id)} style={{ ...secondaryButton, borderColor: chapter.id === chapterId ? colors.purple : colors.border, borderRadius: 12, textAlign: "left", whiteSpace: "normal" }}>
                  {chapter.position}. {chapter.title}
                </button>
              ))}
            </div>
          </aside>

          {activeChapter ? (
            <div style={card}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div style={{ color: colors.muted, fontSize: 12, fontWeight: 800, textTransform: "uppercase" }}>Chapter {activeChapter.position}</div>
                <div style={{ color: colors.muted, fontSize: 12 }}>{wordCount.toLocaleString()} words · {saveState || activeChapter.status}</div>
              </div>
              <input value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} onBlur={() => { void saveActiveChapter(); }} style={{ ...input, fontSize: 18, fontWeight: 800 }} aria-label="Chapter title" />
              <textarea value={draftSummary} onChange={(event) => setDraftSummary(event.target.value)} onBlur={() => { void saveActiveChapter(); }} style={{ ...input, minHeight: 80 }} aria-label="Chapter purpose" />
              <textarea value={draftContent} onChange={(event) => setDraftContent(event.target.value)} onBlur={() => { void saveActiveChapter(); }} style={{ ...input, minHeight: 460, lineHeight: 1.6, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }} placeholder="Draft or paste the chapter in Markdown…" aria-label="Chapter manuscript" />
              <button type="button" disabled={busy} style={{ ...primaryButton, marginTop: 10 }} onClick={generateChapter}>
                {busy ? "Working…" : draftContent.trim() ? "Generate a fresh draft" : "Draft chapter with Claude"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {message ? <p style={{ color: colors.muted, background: colors.purpleSoft, border: `1px solid ${colors.border}`, borderRadius: 12, padding: 12 }}>{message}</p> : null}
    </section>
  );
}
