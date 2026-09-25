"use client";

import { useEffect, useMemo, useState } from "react";
import type { Creator } from "@/lib/types";
import { card, colors, input, primaryButton } from "@/lib/ui";

type Tool = {
  name: string;
  description: string | null;
  inputSchema: Record<string, unknown> | null;
};

type Status = {
  configured: boolean;
  reachable: boolean;
  tools: Tool[];
  detail?: string;
  error?: string;
};

function properties(tool?: Tool) {
  const raw = tool?.inputSchema?.properties;
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, Record<string, unknown>>)
    : {};
}

function findProperty(tool: Tool | undefined, aliases: string[]) {
  const entries = Object.keys(properties(tool));
  const normalized = new Map(
    entries.map((key) => [key.toLowerCase().replace(/[^a-z0-9]/g, ""), key]),
  );

  for (const alias of aliases) {
    const match = normalized.get(alias.toLowerCase().replace(/[^a-z0-9]/g, ""));
    if (match) return match;
  }
  return undefined;
}

function stringEnum(property?: Record<string, unknown>) {
  const raw = property?.enum;
  return Array.isArray(raw)
    ? raw.filter((value): value is string => typeof value === "string")
    : [];
}

export default function EromifyStudio({ creator }: { creator: Creator }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [toolName, setToolName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("");
  const [aspectRatio, setAspectRatio] = useState("4:5");
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [artifacts, setArtifacts] = useState<string[]>([]);
  const [resultMessages, setResultMessages] = useState<string[]>([]);

  async function loadStatus() {
    setMessage("");
    try {
      const response = await fetch("/api/eromify/generate", { cache: "no-store" });
      const data = (await response.json()) as Status;
      setStatus(data);
      const first = data.tools?.[0]?.name ?? "";
      setToolName((current) => current || first);
      if (!response.ok && data.error) setMessage(data.error);
    } catch {
      setStatus({
        configured: false,
        reachable: false,
        tools: [],
        detail: "Could not check Eromify right now.",
      });
    }
  }

  useEffect(() => {
    void loadStatus();
  }, []);

  useEffect(() => {
    setPrompt("");
    setArtifacts([]);
    setResultMessages([]);
  }, [creator.id]);

  const selectedTool = status?.tools.find((tool) => tool.name === toolName) ?? status?.tools[0];
  const modelKey = findProperty(selectedTool, ["model", "modelId", "modelName"]);
  const modelChoices = useMemo(
    () => stringEnum(modelKey ? properties(selectedTool)[modelKey] : undefined),
    [selectedTool, modelKey],
  );

  useEffect(() => {
    if (modelChoices.length === 1) setModel(modelChoices[0]);
    else if (model && modelChoices.length && !modelChoices.includes(model)) setModel("");
  }, [modelChoices, model]);

  const contextHint = [
    creator.niche ? `niche: ${creator.niche}` : "",
    creator.tone ? `tone: ${creator.tone}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  async function generate() {
    if (!prompt.trim() || !selectedTool) return;
    const approved = window.confirm(
      "Generate this image with Eromify? This action can spend Eromify credits.",
    );
    if (!approved) return;

    setBusy(true);
    setMessage("Generating with Eromify…");
    setArtifacts([]);
    setResultMessages([]);

    try {
      const response = await fetch("/api/eromify/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          toolName: selectedTool.name,
          model,
          aspectRatio,
          count,
          confirmedSpend: true,
        }),
      });
      const data = (await response.json()) as {
        error?: string;
        toolName?: string;
        artifacts?: string[];
        messages?: string[];
      };

      if (!response.ok) {
        setMessage(data.error ?? "Eromify could not generate this image.");
        return;
      }

      setArtifacts(data.artifacts ?? []);
      setResultMessages(data.messages ?? []);
      setMessage(
        data.artifacts?.length
          ? `Generated through ${data.toolName ?? selectedTool.name}.`
          : `Eromify completed the request through ${data.toolName ?? selectedTool.name}. No image URL was returned, so the provider message is shown below.`,
      );
    } catch {
      setMessage("Could not reach the Eromify generation route.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ ...card, marginTop: 22 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start", flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: colors.purpleBright }}>
            Eromify studio
          </div>
          <h2 style={{ margin: "6px 0" }}>Generate creator visuals</h2>
          <p style={{ color: colors.muted, marginTop: 0, maxWidth: 720 }}>
            CreatorHub discovers Eromify&apos;s live image tools first, then only makes a paid generation call after you confirm it.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadStatus()}
          style={{
            border: `1px solid ${colors.border}`,
            background: colors.purpleSoft,
            color: colors.text,
            borderRadius: 999,
            padding: "9px 13px",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Refresh
        </button>
      </div>

      {!status ? (
        <p style={{ color: colors.muted }}>Checking Eromify…</p>
      ) : !status.configured ? (
        <div style={{ background: "#21172f", border: "1px solid #4d3769", borderRadius: 14, padding: 14 }}>
          <strong>One-time provider setup remains.</strong>
          <p style={{ marginBottom: 0, color: colors.muted }}>
            {status.detail ?? "CreatorHub needs an Eromify server credential before generation can run."}
          </p>
        </div>
      ) : !status.reachable ? (
        <p style={{ color: "#f0b4b4" }}>{status.detail ?? "Eromify is configured but not reachable."}</p>
      ) : !status.tools.length ? (
        <p style={{ color: colors.muted }}>{status.detail ?? "No image-generation tool is currently exposed."}</p>
      ) : (
        <>
          <label style={{ display: "block", fontWeight: 700, marginTop: 8 }}>
            Eromify tool
            <select
              value={selectedTool?.name ?? ""}
              onChange={(event) => setToolName(event.target.value)}
              style={input}
            >
              {status.tools.map((tool) => (
                <option key={tool.name} value={tool.name}>{tool.name}</option>
              ))}
            </select>
          </label>

          {selectedTool?.description ? (
            <p style={{ color: colors.muted, marginTop: 8 }}>{selectedTool.description}</p>
          ) : null}

          <label style={{ display: "block", fontWeight: 700, marginTop: 12 }}>
            Prompt
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              style={{ ...input, minHeight: 110, resize: "vertical" }}
              placeholder={`Create a 4:5 social image for ${creator.name}${contextHint ? ` — ${contextHint}` : ""}`}
              maxLength={2000}
            />
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10 }}>
            {modelKey ? (
              <label style={{ display: "block", fontWeight: 700 }}>
                Model
                {modelChoices.length ? (
                  <select value={model} onChange={(event) => setModel(event.target.value)} style={input}>
                    <option value="">Choose model</option>
                    {modelChoices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}
                  </select>
                ) : (
                  <input
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                    style={input}
                    placeholder="Provider model"
                  />
                )}
              </label>
            ) : null}

            <label style={{ display: "block", fontWeight: 700 }}>
              Aspect ratio
              <select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)} style={input}>
                <option value="1:1">1:1</option>
                <option value="4:5">4:5</option>
                <option value="9:16">9:16</option>
                <option value="16:9">16:9</option>
              </select>
            </label>

            <label style={{ display: "block", fontWeight: 700 }}>
              Images
              <select value={count} onChange={(event) => setCount(Number(event.target.value))} style={input}>
                <option value={1}>1</option>
                <option value={2}>2</option>
                <option value={3}>3</option>
                <option value={4}>4</option>
              </select>
            </label>
          </div>

          <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <button
              type="button"
              disabled={busy || !prompt.trim()}
              onClick={() => void generate()}
              style={{ ...primaryButton, opacity: busy || !prompt.trim() ? 0.55 : 1 }}
            >
              {busy ? "Generating…" : "Generate with Eromify"}
            </button>
            <span style={{ color: colors.muted, fontSize: 13 }}>You will be asked to confirm before credits can be spent.</span>
          </div>
        </>
      )}

      {message ? (
        <p style={{ color: "#d8c8eb", background: "#21172f", border: "1px solid #4d3769", borderRadius: 12, padding: 12 }}>
          {message}
        </p>
      ) : null}

      {artifacts.length ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12, marginTop: 14 }}>
          {artifacts.map((url, index) => (
            <a key={url} href={url.startsWith("data:") ? undefined : url} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={`Eromify generation ${index + 1}`}
                style={{ display: "block", width: "100%", borderRadius: 14, border: `1px solid ${colors.border}` }}
              />
            </a>
          ))}
        </div>
      ) : null}

      {resultMessages.length ? (
        <details style={{ marginTop: 14 }}>
          <summary style={{ cursor: "pointer", color: colors.purpleBright, fontWeight: 700 }}>Provider response</summary>
          <div style={{ color: colors.muted, whiteSpace: "pre-wrap", marginTop: 10 }}>
            {resultMessages.join("\n\n")}
          </div>
        </details>
      ) : null}
    </section>
  );
}
