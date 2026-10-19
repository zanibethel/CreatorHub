"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { card, colors, input, primaryButton, secondaryButton } from "@/lib/ui";
import type { YouTubeHit } from "@/lib/youtube-discovery";

type SavedChannel = {
  channel_id: string;
  channel_title: string;
  thumbnail_url: string | null;
  created_at: string;
};
type CreatorChoice = { id: string; name: string };
type SearchKind = "channel" | "video";

export default function YouTubeClipperDiscovery({ creators }: { creators: CreatorChoice[] }) {
  const [creatorId, setCreatorId] = useState(creators[0]?.id ?? "");
  const [kind, setKind] = useState<SearchKind>("channel");
  const [query, setQuery] = useState("");
  const [channelFilter, setChannelFilter] = useState<{ id: string; name: string } | null>(null);
  const [results, setResults] = useState<YouTubeHit[]>([]);
  const [saved, setSaved] = useState<SavedChannel[]>([]);
  const [selectedVideo, setSelectedVideo] = useState<YouTubeHit | null>(null);
  const [busy, setBusy] = useState(false);
  const [savingId, setSavingId] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    setSaved([]);
    setResults([]);
    setSelectedVideo(null);
    setChannelFilter(null);
    setMessage("");
    if (!creatorId) return;
    fetch(`/api/clipper/youtube/sources?creatorId=${encodeURIComponent(creatorId)}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Could not load saved channels.");
        if (!cancelled) setSaved(data.channels ?? []);
      })
      .catch((error) => { if (!cancelled) setMessage(error instanceof Error ? error.message : "Could not load channels."); });
    return () => { cancelled = true; };
  }, [creatorId]);

  async function search(searchKind: SearchKind, text: string, filter: { id: string; name: string } | null) {
    setBusy(true);
    setMessage("");
    setResults([]);
    setSelectedVideo(null);
    try {
      const params = new URLSearchParams({ type: searchKind });
      if (text.trim()) params.set("q", text.trim());
      if (searchKind === "video" && filter) params.set("channelId", filter.id);
      const response = await fetch(`/api/clipper/youtube/search?${params}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "YouTube search failed.");
      setResults(data.items ?? []);
      if (!data.items?.length) setMessage("No matching YouTube results found.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "YouTube search failed.");
    } finally {
      setBusy(false);
    }
  }

  function browse(channelId: string, channelName: string) {
    const filter = { id: channelId, name: channelName };
    setKind("video");
    setQuery("");
    setChannelFilter(filter);
    void search("video", "", filter);
  }

  async function changeSaved(channelId: string, remove: boolean) {
    if (!creatorId || savingId) return;
    setSavingId(channelId);
    setMessage("");
    try {
      const response = await fetch("/api/clipper/youtube/sources", {
        method: remove ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creatorId, channelId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not update channel.");
      if (remove) {
        setSaved((current) => current.filter((row) => row.channel_id !== channelId));
        setMessage("Channel removed from this workspace.");
      } else {
        const refresh = await fetch(`/api/clipper/youtube/sources?creatorId=${encodeURIComponent(creatorId)}`, { cache: "no-store" });
        const data = await refresh.json();
        if (refresh.ok) setSaved(data.channels ?? []);
        setMessage("Channel saved to this workspace. This is a bookmark, not an authorized account connection.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update channel.");
    } finally {
      setSavingId("");
    }
  }

  function switchKind(next: SearchKind) {
    setKind(next);
    setChannelFilter(null);
    setSelectedVideo(null);
    setResults([]);
    setQuery("");
    setMessage("");
  }

  if (creators.length === 0) {
    return <section style={card}><p>Create a CreatorHub workspace before saving YouTube channels.</p><Link href="/" style={{ color: colors.purpleBright }}>Open CreatorHub →</Link></section>;
  }

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <section style={card}>
        <div style={{ color: colors.purpleBright, fontSize: 12, fontWeight: 900, textTransform: "uppercase", letterSpacing: ".08em" }}>AI Clipper · Discovery preview</div>
        <h1 style={{ margin: "7px 0 8px", fontSize: 27 }}>Find videos. Save channels. Create from one place.</h1>
        <p style={{ color: colors.muted, lineHeight: 1.55, marginTop: 0 }}>
          Search YouTube directly inside CreatorHub. Save public channels with one tap and preview videos here.
          AI clipping, original-media import, ownership authorization, and publishing are separate upcoming phases.
        </p>
        <label style={{ display: "block", maxWidth: 420, marginBottom: 14 }}>
          Creator workspace
          <select style={input} value={creatorId} onChange={(event) => setCreatorId(event.target.value)}>
            {creators.map((creator) => <option key={creator.id} value={creator.id}>{creator.name}</option>)}
          </select>
        </label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 9, marginBottom: 12 }}>
          <button type="button" style={kind === "channel" ? primaryButton : secondaryButton} onClick={() => switchKind("channel")}>Channels</button>
          <button type="button" style={kind === "video" ? primaryButton : secondaryButton} onClick={() => switchKind("video")}>Videos</button>
        </div>
        {channelFilter && (
          <div style={{ marginBottom: 11, color: colors.muted }}>
            Browsing <strong style={{ color: colors.text }}>{channelFilter.name}</strong> ·{" "}
            <button type="button" style={{ ...secondaryButton, padding: "5px 10px" }} onClick={() => { setChannelFilter(null); setResults([]); }}>All videos</button>
          </div>
        )}
        <form onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void search(kind, query, channelFilter); }}
          style={{ display: "flex", alignItems: "end", gap: 10, flexWrap: "wrap" }}>
          <label style={{ flex: "1 1 260px" }}>
            <span style={{ color: colors.muted, fontSize: 13 }}>{kind === "channel" ? "Channel name or topic" : "Video title, keyword, or topic"}</span>
            <input style={input} value={query} onChange={(event) => setQuery(event.target.value)} maxLength={120}
              placeholder={kind === "channel" ? "Search YouTube creators…" : "Search YouTube videos…"} />
          </label>
          <button type="submit" disabled={busy || (query.trim().length < 2 && !channelFilter)} style={primaryButton}>
            {busy ? "Searching…" : "Search YouTube"}
          </button>
        </form>
        <p style={{ color: colors.muted, marginBottom: 0, fontSize: 12 }}>
          Powered by YouTube Data API. Browsing public channels does not authorize downloads or publishing.
        </p>
      </section>

      {message && <div role="status" style={{ ...card, padding: 13, color: colors.text }}>{message}</div>}

      <section style={card}>
        <h2 style={{ margin: "0 0 8px" }}>Saved channels ({saved.length})</h2>
        {!saved.length && <p style={{ color: colors.muted }}>Channels you save will appear here for this creator workspace.</p>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}>
          {saved.map((channel) => (
            <article key={channel.channel_id} style={{ border: `1px solid ${colors.border}`, borderRadius: 14, padding: 12, display: "grid", gap: 9 }}>
              <strong>{channel.channel_title}</strong>
              <span style={{ fontSize: 12, color: colors.muted }}>Public channel bookmark</span>
              <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                <button type="button" style={primaryButton} onClick={() => browse(channel.channel_id, channel.channel_title)}>Browse videos</button>
                <button type="button" disabled={Boolean(savingId)} style={secondaryButton} onClick={() => void changeSaved(channel.channel_id, true)}>Remove</button>
              </div>
            </article>
          ))}
        </div>
      </section>

      {results.length > 0 && (
        <section style={card}>
          <h2 style={{ margin: "0 0 14px" }}>{kind === "channel" ? "YouTube channels" : "YouTube videos"}</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(235px,1fr))", gap: 12 }}>
            {results.map((item) => {
              const isSaved = saved.some((row) => row.channel_id === item.channelId);
              return (
                <article key={item.id} style={{ border: `1px solid ${colors.border}`, borderRadius: 14, padding: 12, minWidth: 0 }}>
                  {item.thumbnail && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.thumbnail} alt="" loading="lazy" style={{ width: "100%", aspectRatio: "16 / 9", objectFit: "cover", borderRadius: 8 }} />
                  )}
                  <h3 style={{ fontSize: 15, marginBottom: 5, overflowWrap: "anywhere" }}>{item.title}</h3>
                  {kind === "video" && <div style={{ fontSize: 12, color: colors.muted }}>{item.channelTitle}</div>}
                  <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                    {kind === "channel" ? (
                      <button type="button" style={primaryButton} onClick={() => browse(item.channelId, item.title)}>Browse videos</button>
                    ) : (
                      <button type="button" style={primaryButton} onClick={() => setSelectedVideo(item)}>Preview</button>
                    )}
                    <button type="button" style={secondaryButton} disabled={isSaved || Boolean(savingId)}
                      onClick={() => void changeSaved(item.channelId, false)}>{isSaved ? "Saved" : savingId === item.channelId ? "Saving…" : "Save channel"}</button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {selectedVideo && (
        <section style={card}>
          <h2 style={{ marginTop: 0 }}>Preview: {selectedVideo.title}</h2>
          <div style={{ aspectRatio: "16 / 9", maxWidth: 760 }}>
            <iframe title={selectedVideo.title} src={`https://www.youtube-nocookie.com/embed/${selectedVideo.id}`}
              loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen style={{ width: "100%", height: "100%", border: 0, borderRadius: 12 }} />
          </div>
          <p style={{ color: colors.muted, lineHeight: 1.5 }}>
            You can preview this video here. For clipping, use your original file or separately licensed source media.
            Selecting a YouTube video does not download or authorize copying it.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link href="/upload" style={{ ...primaryButton, display: "inline-flex", textDecoration: "none" }}>Upload authorized media →</Link>
            <a href={`https://www.youtube.com/watch?v=${selectedVideo.id}`} target="_blank" rel="noopener noreferrer"
              style={{ ...secondaryButton, display: "inline-flex", textDecoration: "none" }}>View on YouTube ↗</a>
          </div>
        </section>
      )}

      <section style={{ ...card, background: colors.surface }}>
        <h2 style={{ marginTop: 0 }}>Coming next: multimodel AI Clipper</h2>
        <p style={{ color: colors.muted, lineHeight: 1.55 }}>
          CoOperative AI will orchestrate transcription, highlight ranking, captioning, and editing across suitable models.
          Planned choices: Auto, Economy, Balanced, and Premium, with local-node preference and a clear per-job budget.
          These processing actions are not yet enabled in this discovery preview.
        </p>
      </section>
    </div>
  );
}
