"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase";
import { primaryButton } from "@/lib/ui";
import type { ContentItem, Creator } from "@/lib/types";

export default function AIRecommendationsButton({
  creator,
  creatorId,
  content,
  onDone,
}: {
  creator: Creator;
  creatorId: string;
  content: ContentItem[];
  onDone: () => Promise<void> | void;
}) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");

  async function generate() {
    if (loading) return;
    setLoading(true);
    setStatus("CreatorHub AI is thinking…");

    try {
      const supabase = createClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Your CreatorHub session expired. Please sign in again.");

      const response = await fetch("/api/ai/recommendations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          creator: {
            name: creator.name,
            creator_type: creator.creator_type,
            primary_goal: creator.primary_goal,
            niche: creator.niche,
            tone: creator.tone,
          },
          content,
        }),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "CreatorHub AI could not generate recommendations.");

      await supabase.from("recommendations").delete().eq("creator_id", creatorId).eq("status", "pending");
      const rows = (result.recommendations ?? []).slice(0, 3).map((item: Record<string, unknown>) => ({
        creator_id: creatorId,
        recommendation_type: "ai_content",
        title: String(item.title ?? "Next content opportunity"),
        summary: String(item.summary ?? ""),
        reason: String(item.reason ?? ""),
        goal: String(item.goal ?? "learning"),
        confidence: Number(item.confidence ?? 0.5),
        effort_minutes: Number(item.effort_minutes ?? 20),
        source_context: {
          engine: "creatorhub_ai",
          creator_summary: result.creator_summary ?? "",
        },
      }));

      const { error } = await supabase.from("recommendations").insert(rows);
      if (error) throw error;
      await onDone();
      setStatus("CreatorHub AI recommendations are ready.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button style={primaryButton} onClick={generate} disabled={loading}>
        {loading ? "Thinking…" : "Generate with CreatorHub AI"}
      </button>
      {status && <div style={{ marginTop: 8, color: "#6b7280", fontSize: 14 }}>{status}</div>}
    </div>
  );
}
