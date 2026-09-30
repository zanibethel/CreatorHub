"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

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

type RouteMode = "code" | "local-fast" | "local-quality" | "agent";

type ChatAction = {
  type: "open-module";
  moduleId: ModuleId;
  label?: string;
};

type ReviewCheck = {
  command?: string;
  passed?: boolean;
  skipped?: boolean;
  output?: string;
};

type ReviewDetails = {
  taskId: string;
  branchName?: string | null;
  summary?: string | null;
  changedFiles?: string[];
  checksPassed?: boolean | null;
  checks?: ReviewCheck[];
  diffStat?: string;
  diff?: string;
  showDetails?: boolean;
  decision?: "approved" | "denied";
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  mode?: RouteMode;
  action?: ChatAction | null;
  attachmentNames?: string[];
  review?: ReviewDetails | null;
};

type BridgeResponse = {
  mode?: RouteMode;
  text?: string;
  action?: ChatAction | null;
  jobId?: string;
  taskId?: string;
  conversationId?: string;
  status?: string;
  partialText?: string | null;
  result?: {
    summary?: string;
    changedFiles?: string[];
    checksPassed?: boolean;
    checks?: ReviewCheck[];
    diffStat?: string;
    diff?: string;
  } | null;
  review?: Omit<ReviewDetails, "taskId"> | null;
  decision?: "approved" | "denied";
  branchName?: string | null;
  model?: string | null;
  error?: string | null;
  detail?: string | null;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function labelForMode(mode?: RouteMode) {
  if (mode === "code") return "Code";
  if (mode === "local-quality") return "Local Quality";
  if (mode === "agent") return "Repo Agent";
  return "Local Fast";
}

function newId() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function CreatorHubAiBubble({
  creatorId,
  creatorName,
  onOpenModule,
}: {
  creatorId: string;
  creatorName: string;
  onOpenModule: (moduleId: ModuleId) => void;
}) {
  const historyKey = useMemo(
    () => `creatorhub.cooperative-chat.v1.${creatorId}`,
    [creatorId],
  );
  const activeKey = useMemo(
    () => `creatorhub.cooperative-chat.active.v1.${creatorId}`,
    [creatorId],
  );

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [routeLabel, setRouteLabel] = useState("Code first · Local AI when needed");
  const [pendingAttachment, setPendingAttachment] = useState<{
    id: string;
    fileName: string;
    previewUrl: string;
  } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [reviewBusyId, setReviewBusyId] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const activePollRef = useRef("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const persistMessages = useCallback(
    (next: ChatMessage[]) => {
      setMessages(next);
      try {
        window.localStorage.setItem(historyKey, JSON.stringify(next.slice(-30)));
      } catch {
        // Chat still works when localStorage is unavailable.
      }
    },
    [historyKey],
  );

  const appendMessage = useCallback(
    (message: ChatMessage) => {
      setMessages((current) => {
        const next = [...current, message].slice(-30);
        try {
          window.localStorage.setItem(historyKey, JSON.stringify(next));
        } catch {
          // Ignore storage failures.
        }
        return next;
      });
    },
    [historyKey],
  );

  const replaceAssistant = useCallback(
    (id: string, patch: Partial<ChatMessage>) => {
      setMessages((current) => {
        const next = current.map((message) =>
          message.id === id ? { ...message, ...patch } : message,
        );
        try {
          window.localStorage.setItem(historyKey, JSON.stringify(next.slice(-30)));
        } catch {
          // Ignore storage failures.
        }
        return next;
      });
    },
    [historyKey],
  );

  const poll = useCallback(
    async ({
      jobId,
      taskId,
      assistantId,
      mode,
    }: {
      jobId?: string;
      taskId?: string;
      assistantId: string;
      mode: RouteMode;
    }) => {
      const pollId = jobId || taskId || "";
      if (!pollId) return;
      activePollRef.current = pollId;
      setBusy(true);

      try {
        while (activePollRef.current === pollId) {
          const params = new URLSearchParams({ creatorId });
          if (jobId) params.set("jobId", jobId);
          if (taskId) params.set("taskId", taskId);

          const response = await fetch(
            `/api/cooperative/chat?${params.toString()}`,
            { cache: "no-store" },
          );
          const result = (await response.json()) as BridgeResponse;
          if (!response.ok) {
            throw new Error(result.detail || result.error || "CoOperative status failed.");
          }

          if (result.conversationId) setConversationId(result.conversationId);

          if (mode === "agent") {
            if (["completed", "needs_approval", "failed", "cancelled"].includes(result.status || "")) {
              if (result.status === "needs_approval") {
                const review: ReviewDetails = {
                  taskId: taskId || result.taskId || "",
                  branchName: result.branchName || null,
                  summary: result.result?.summary || null,
                  changedFiles: result.result?.changedFiles || [],
                  checksPassed:
                    typeof result.result?.checksPassed === "boolean"
                      ? result.result.checksPassed
                      : null,
                  checks: result.result?.checks || [],
                  diffStat: result.result?.diffStat || "",
                  diff: result.result?.diff || "",
                };

                const summary = [
                  review.summary || "The Repo Engineer prepared a change for review.",
                  review.changedFiles?.length
                    ? `Changed: ${review.changedFiles.join(", ")}.`
                    : null,
                  review.branchName ? `Proposal branch: ${review.branchName}.` : null,
                  typeof review.checksPassed === "boolean"
                    ? review.checksPassed
                      ? "Configured checks passed."
                      : "At least one configured check did not pass or could not run."
                    : null,
                  "Nothing was pushed, merged, or deployed.",
                ]
                  .filter(Boolean)
                  .join(" ");

                replaceAssistant(assistantId, {
                  text: summary,
                  mode: "agent",
                  review,
                });
              } else {
                const summary =
                  result.status === "completed"
                    ? result.result?.summary || "The Repo Engineer completed the task."
                    : result.error || `Agent task ${result.status}.`;
                replaceAssistant(assistantId, {
                  text: summary,
                  mode: "agent",
                });
              }

              window.localStorage.removeItem(activeKey);
              return;
            }

            replaceAssistant(assistantId, {
              text:
                result.status === "waiting_llm"
                  ? "Repo Engineer is using Local Quality on the repository evidence…"
                  : "Repo Engineer is inspecting the owning repository and running deterministic checks…",
              mode: "agent",
            });
          } else {
            const partial = result.partialText?.trim();
            if (partial) {
              replaceAssistant(assistantId, { text: partial, mode });
            }

            if (result.status === "completed") {
              replaceAssistant(assistantId, {
                text: result.text?.trim() || "Completed with no text response.",
                mode,
              });
              window.localStorage.removeItem(activeKey);
              return;
            }

            if (["failed", "cancelled"].includes(result.status || "")) {
              replaceAssistant(assistantId, {
                text: result.error || `Local AI job ${result.status}.`,
                mode,
              });
              window.localStorage.removeItem(activeKey);
              return;
            }
          }

          await wait(1200);
        }
      } catch (error) {
        replaceAssistant(assistantId, {
          text: error instanceof Error ? error.message : "CoOperative chat failed.",
          mode,
        });
        window.localStorage.removeItem(activeKey);
      } finally {
        if (activePollRef.current === pollId) activePollRef.current = "";
        setBusy(false);
      }
    },
    [activeKey, creatorId, replaceAssistant],
  );

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(historyKey);
      const parsed = saved ? JSON.parse(saved) : [];
      if (Array.isArray(parsed)) {
        setMessages(
          parsed.filter(
            (message): message is ChatMessage =>
              message &&
              (message.role === "user" || message.role === "assistant") &&
              typeof message.text === "string",
          ),
        );
      }

      const activeRaw = window.localStorage.getItem(activeKey);
      if (activeRaw) {
        const active = JSON.parse(activeRaw) as {
          jobId?: string;
          taskId?: string;
          assistantId?: string;
          mode?: RouteMode;
          conversationId?: string;
        };
        if (active.conversationId) setConversationId(active.conversationId);
        if (active.assistantId && active.mode && (active.jobId || active.taskId)) {
          void poll({
            jobId: active.jobId,
            taskId: active.taskId,
            assistantId: active.assistantId,
            mode: active.mode,
          });
        }
      }
    } catch {
      setMessages([]);
    }

    return () => {
      activePollRef.current = "";
    };
  }, [activeKey, historyKey, poll]);

  useEffect(() => {
    if (!open) return;
    window.setTimeout(() => {
      scrollRef.current?.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    }, 40);
  }, [messages, open]);

  async function send(event?: FormEvent) {
    event?.preventDefault();
    const message = input.trim();
    if (!message || busy) return;

    const userMessage: ChatMessage = {
      id: newId(),
      role: "user",
      text: message,
    };
    const assistantId = newId();
    const assistantMessage: ChatMessage = {
      id: assistantId,
      role: "assistant",
      text: "Checking CreatorHub first…",
      mode: "code",
    };

    persistMessages([...messages, userMessage, assistantMessage]);
    setInput("");
    setBusy(true);
    setRouteLabel("Checking code/data first…");

    try {
      const response = await fetch("/api/cooperative/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creatorId,
          message,
          conversationId,
          pageContext: "CreatorHub creator command center",
        }),
      });
      const result = (await response.json()) as BridgeResponse;
      if (!response.ok) {
        throw new Error(result.detail || result.error || "CoOperative request failed.");
      }

      const mode = result.mode || "local-fast";
      setRouteLabel(
        mode === "code"
          ? "Answered from CreatorHub code/data"
          : mode === "agent"
            ? "Repo Engineer · Local Quality as needed"
            : mode === "local-quality"
              ? "Local Quality"
              : "Local Fast",
      );

      if (result.conversationId) setConversationId(result.conversationId);

      if (mode === "code") {
        replaceAssistant(assistantId, {
          text: result.text || "Done.",
          mode,
          action: result.action || null,
        });
        if (result.action?.type === "open-module") {
          onOpenModule(result.action.moduleId);
        }
        setBusy(false);
        return;
      }

      if (mode === "agent" && result.taskId) {
        replaceAssistant(assistantId, {
          text:
            result.text ||
            "Repo Engineer is inspecting CreatorHub before preparing a change…",
          mode,
        });
        window.localStorage.setItem(
          activeKey,
          JSON.stringify({
            taskId: result.taskId,
            assistantId,
            mode,
            conversationId: result.conversationId,
          }),
        );
        void poll({ taskId: result.taskId, assistantId, mode });
        return;
      }

      if (result.jobId) {
        replaceAssistant(assistantId, {
          text:
            mode === "local-quality"
              ? "Local Quality is working on that…"
              : "Local Fast is working on that…",
          mode,
        });
        window.localStorage.setItem(
          activeKey,
          JSON.stringify({
            jobId: result.jobId,
            assistantId,
            mode,
            conversationId: result.conversationId,
          }),
        );
        void poll({ jobId: result.jobId, assistantId, mode });
        return;
      }

      replaceAssistant(assistantId, {
        text: result.text || "CoOperative returned no runnable response.",
        mode,
      });
      setBusy(false);
    } catch (error) {
      replaceAssistant(assistantId, {
        text: error instanceof Error ? error.message : "CoOperative request failed.",
        mode: "code",
      });
      setRouteLabel("Request failed");
      setBusy(false);
    }
  }

  function clearChat() {
    activePollRef.current = "";
    setMessages([]);
    setConversationId(undefined);
    setBusy(false);
    try {
      window.localStorage.removeItem(historyKey);
      window.localStorage.removeItem(activeKey);
    } catch {
      // Ignore storage failures.
    }
  }

  return (
    <>
      <button
        type="button"
        aria-label={open ? "Close CoOperative AI" : "Open CoOperative AI"}
        onClick={() => setOpen((current) => !current)}
        style={{
          position: "fixed",
          right: 18,
          bottom: 18,
          zIndex: 70,
          width: 58,
          height: 58,
          borderRadius: 999,
          border: "1px solid #8b5cf6",
          background: "linear-gradient(145deg,#8b5cf6,#6d28d9)",
          color: "#fff",
          fontWeight: 900,
          fontSize: 20,
          boxShadow: "0 18px 44px rgba(0,0,0,.38)",
          cursor: "pointer",
        }}
      >
        {open ? "×" : "AI"}
      </button>

      {open ? (
        <section
          aria-label="CoOperative AI chat"
          style={{
            position: "fixed",
            right: 16,
            bottom: 88,
            zIndex: 69,
            width: "min(390px, calc(100vw - 24px))",
            height: "min(620px, calc(100dvh - 120px))",
            display: "grid",
            gridTemplateRows: "auto 1fr auto",
            overflow: "hidden",
            border: "1px solid #5b3a86",
            borderRadius: 22,
            background: "rgba(19,12,30,.98)",
            boxShadow: "0 24px 80px rgba(0,0,0,.52)",
            color: "#fff",
          }}
        >
          <header
            style={{
              padding: "14px 14px 11px",
              borderBottom: "1px solid #3d2d50",
              display: "flex",
              justifyContent: "space-between",
              gap: 10,
              alignItems: "start",
            }}
          >
            <div>
              <strong style={{ display: "block" }}>CoOperative AI</strong>
              <span style={{ display: "block", color: "#b8aec7", fontSize: 11, marginTop: 3 }}>
                {creatorName} · {routeLabel}
              </span>
            </div>
            <button
              type="button"
              onClick={clearChat}
              disabled={busy}
              style={{
                border: "1px solid #4a3565",
                borderRadius: 999,
                background: "#21172f",
                color: "#d8c8eb",
                padding: "6px 9px",
                fontSize: 11,
              }}
            >
              New chat
            </button>
          </header>

          <div
            ref={scrollRef}
            style={{
              overflowY: "auto",
              padding: 12,
              display: "grid",
              alignContent: "start",
              gap: 9,
            }}
          >
            {messages.length === 0 ? (
              <div style={{ color: "#cfc7da", lineHeight: 1.5, padding: "6px 2px" }}>
                Ask about {creatorName}, CreatorHub, connections, image jobs, project code, or what to do next.
                <div style={{ display: "grid", gap: 7, marginTop: 12 }}>
                  {[
                    "How many approved references do I have?",
                    "What is connected?",
                    "What should I work on next?",
                  ].map((suggestion) => (
                    <button
                      type="button"
                      key={suggestion}
                      onClick={() => setInput(suggestion)}
                      style={{
                        textAlign: "left",
                        border: "1px solid #4a3565",
                        borderRadius: 12,
                        padding: "9px 10px",
                        background: "#21172f",
                        color: "#eee8f6",
                      }}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((message) => (
                <div
                  key={message.id}
                  style={{
                    justifySelf: message.role === "user" ? "end" : "start",
                    maxWidth: "88%",
                  }}
                >
                  <div
                    style={{
                      borderRadius: 15,
                      padding: "10px 11px",
                      background: message.role === "user" ? "#6d28d9" : "#241832",
                      border:
                        message.role === "user"
                          ? "1px solid #8b5cf6"
                          : "1px solid #423052",
                      color: "#fff",
                      whiteSpace: "pre-wrap",
                      lineHeight: 1.45,
                      fontSize: 14,
                    }}
                  >
                    {message.text}
                  </div>
                  {message.role === "assistant" && message.mode ? (
                    <div style={{ color: "#9f95ac", fontSize: 10, margin: "4px 3px 0" }}>
                      {labelForMode(message.mode)}
                    </div>
                  ) : null}
                  {message.action?.type === "open-module" ? (
                    <button
                      type="button"
                      onClick={() => onOpenModule(message.action!.moduleId)}
                      style={{
                        marginTop: 6,
                        border: "1px solid #7c3aed",
                        borderRadius: 999,
                        background: "#2d1b42",
                        color: "#e9ddff",
                        padding: "6px 9px",
                        fontSize: 11,
                        fontWeight: 800,
                      }}
                    >
                      Open {message.action.label || "section"} →
                    </button>
                  ) : null}
                </div>
              ))
            )}
          </div>

          <form
            onSubmit={(event) => void send(event)}
            style={{
              borderTop: "1px solid #3d2d50",
              padding: 10,
              display: "grid",
              gridTemplateColumns: "minmax(0,1fr) auto",
              gap: 8,
              alignItems: "end",
            }}
          >
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
              placeholder="Ask CoOperative…"
              rows={2}
              disabled={busy}
              style={{
                width: "100%",
                resize: "none",
                boxSizing: "border-box",
                border: "1px solid #4a3565",
                borderRadius: 13,
                background: "#0f0a17",
                color: "#fff",
                padding: "10px 11px",
                font: "inherit",
              }}
            />
            <button
              type="submit"
              disabled={busy || input.trim().length === 0}
              style={{
                border: 0,
                borderRadius: 13,
                background: busy ? "#49365f" : "#7c3aed",
                color: "#fff",
                fontWeight: 900,
                padding: "11px 13px",
                minHeight: 44,
              }}
            >
              {busy ? "…" : "Send"}
            </button>
          </form>
        </section>
      ) : null}
    </>
  );
}
