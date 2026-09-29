"use client";

import { useEffect, useMemo, useState } from "react";
import type { Creator } from "@/lib/types";
import { chooseImageModel, imageModeOptions, type ImageGenerationMode } from "@/lib/generation-router";
import { card, colors, input, primaryButton } from "@/lib/ui";

type GenerationResult = {
  image: string;
  model: string;
  modelLabel: string;
  mode: string;
  routedBy: string;
  costHint: string;
  aspectRatio: string;
  createdAt: string;
};

type HistoryItem = Omit<GenerationResult, "image"> & {
  prompt: string;
};

function storageKey(creatorId: string) {
  return `creatorhub:image-history:v1:${creatorId}`;
}

export default function CreatorImageStudio({ creator }: { creator: Creator }) {
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<ImageGenerationMode>("auto");
  const [aspectRatio, setAspectRatio] = useState("4:5");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const routePreview = useMemo(
    () => chooseImageModel(mode, prompt || "general creator visual"),
    [mode, prompt],
  );

  useEffect(() => {
    setPrompt("");
    setResult(null);
    setMessage("");
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey(creator.id)) || "[]");
      setHistory(Array.isArray(parsed) ? parsed.slice(0, 8) : []);
    } catch {
      setHistory([]);
    }
  }, [creator.id]);

  function saveHistory(item: HistoryItem) {
    const next = [item, ...history].slice(0, 8);
    setHistory(next);
    try {
      localStorage.setItem(storageKey(creator.id), JSON.stringify(next));
    } catch {
      // Metadata history is a preview convenience only; generation still succeeds without it.
    }
  }

  async function generate() {
    const trimmed = prompt.trim();
    if (trimmed.length < 3 || busy) return;

    const approved = window.confirm(
      `Generate 1 image with ${routePreview.label}? Estimated pricing: ${routePreview.costHint}. This can incur AI Gateway charges.`,
    );
    if (!approved) return;

    setBusy(true);
    setResult(null);
    setMessage(`Generating with ${routePreview.label}…`);

    try {
      const response = await fetch("/api/generate/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: trimmed,
          mode,
          aspectRatio,
          confirmedSpend: true,
          creator: {
            name: creator.name,
            niche: creator.niche,
            tone: creator.tone,
          },
        }),
      });

      const data = (await response.json()) as GenerationResult & {
        error?: string;
        detail?: string;
      };

      if (!response.ok) {
        setMessage([data.error, data.detail].filter(Boolean).join(" "));
        return;
      }

      setResult(data);
      setMessage(
        `Generated with ${data.modelLabel}. Routing: ${data.routedBy === "manual" ? "manual tier" : "CreatorHub Auto v1"}.`,
      );
      saveHistory({
        prompt: trimmed,
        model: data.model,
        modelLabel: data.modelLabel,
        mode: data.mode,
        routedBy: data.routedBy,
        costHint: data.costHint,
        aspectRatio: data.aspectRatio,
        createdAt: data.createdAt,
      });
    } catch {
      setMessage("Could not reach CreatorHub image generation.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ ...card, marginTop: 22, borderColor: "#5b3a86" }}>
      <div style={{ color: colors.purpleBright, fontWeight: 800, fontSize: 12, textTransform: "uppercase", letterSpacing: ".08em" }}>
        CreatorHub Studio
      </div>
      <h2 style={{ margin: "6px 0" }}>Generate with our model stack</h2>
      <p style={{ color: colors.muted, marginTop: 0, lineHeight: 1.55 }}>
        CreatorHub routes through Vercel AI Gateway instead of Eromify. Claude/CoOperative can become the planner and router while dedicated image models render the pixels.
      </p>

      <label style={{ display: "block", fontWeight: 700, marginTop: 14 }}>
        Prompt
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          style={{ ...input, minHeight: 110, resize: "vertical" }}
          maxLength={2000}
          placeholder={`Create a social image for ${creator.name}${creator.niche ? ` in the ${creator.niche} niche` : ""}…`}
        />
      </label>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}>
        <label style={{ display: "block", fontWeight: 700 }}>
          Routing
          <select value={mode} onChange={(event) => setMode(event.target.value as ImageGenerationMode)} style={input}>
            {imageModeOptions().map((option) => (
              <option key={option.value} value={option.value}>{option.label} · {option.detail}</option>
            ))}
          </select>
        </label>

        <label style={{ display: "block", fontWeight: 700 }}>
          Aspect ratio
          <select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)} style={input}>
            <option value="1:1">1:1</option>
            <option value="4:5">4:5</option>
            <option value="9:16">9:16</option>
            <option value="16:9">16:9</option>
          </select>
        </label>
      </div>

      <div style={{ background: colors.purpleSoft, border: `1px solid ${colors.border}`, borderRadius: 12, padding: 12, marginTop: 8 }}>
        <strong>Selected: {routePreview.label}</strong>
        <div style={{ color: colors.muted, marginTop: 4 }}>{routePreview.reason}</div>
        <div style={{ color: colors.muted, marginTop: 4 }}>{routePreview.costHint} · 1 image max in this first slice</div>
      </div>

      <div style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button
          type="button"
          style={{ ...primaryButton, opacity: busy || prompt.trim().length < 3 ? 0.55 : 1 }}
          disabled={busy || prompt.trim().length < 3}
          onClick={() => void generate()}
        >
          {busy ? "Generating…" : "Generate 1 image"}
        </button>
        <span style={{ color: colors.muted, fontSize: 13 }}>A confirmation appears before any model charge.</span>
      </div>

      {message ? (
        <p style={{ color: "#d8c8eb", background: "#21172f", border: "1px solid #4d3769", borderRadius: 12, padding: 12 }}>
          {message}
        </p>
      ) : null}

      {result ? (
        <div style={{ marginTop: 16 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={result.image}
            alt={`Generated visual for ${creator.name}`}
            style={{ width: "100%", maxWidth: 720, borderRadius: 16, border: `1px solid ${colors.border}`, display: "block" }}
          />
          <div style={{ marginTop: 8, color: colors.muted, fontSize: 13 }}>
            {result.modelLabel} · {result.aspectRatio} · {new Date(result.createdAt).toLocaleString()}
          </div>
        </div>
      ) : null}

      {history.length ? (
        <details style={{ marginTop: 18 }}>
          <summary style={{ cursor: "pointer", color: colors.purpleBright, fontWeight: 800 }}>
            Recent generation metadata ({history.length})
          </summary>
          <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
            {history.map((item, index) => (
              <div key={item.createdAt + index} style={{ border: `1px solid ${colors.border}`, borderRadius: 12, padding: 10 }}>
                <strong>{item.modelLabel}</strong>
                <div style={{ color: colors.muted, fontSize: 13, marginTop: 3 }}>
                  {item.aspectRatio} · {item.costHint} · {new Date(item.createdAt).toLocaleString()}
                </div>
                <div style={{ marginTop: 6 }}>{item.prompt}</div>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}
