import { EromifyError } from "@/lib/eromify";

const DEFAULT_EROMIFY_MCP_URL = "https://api.eromify.in/mcp";
const MODERN_PROTOCOL_VERSION = "2026-07-28";
const LEGACY_PROTOCOL_VERSION = "2025-11-25";
const REQUEST_TIMEOUT_MS = 12_000;

type JsonRpcEnvelope = {
  jsonrpc?: string;
  id?: string | number | null;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
};

export type EromifyMcpTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

export type EromifyMcpToolResult = {
  content?: unknown[];
  structuredContent?: unknown;
  isError?: boolean;
  [key: string]: unknown;
};

function networkFailureDetail(error: unknown) {
  if (!(error instanceof Error)) return "unknown network failure";

  const cause =
    "cause" in error && error.cause && typeof error.cause === "object"
      ? (error.cause as { code?: unknown; message?: unknown; errno?: unknown; syscall?: unknown; hostname?: unknown })
      : null;

  const parts = [error.message];
  if (typeof cause?.code === "string") parts.push(cause.code);
  if (typeof cause?.message === "string" && cause.message !== error.message) parts.push(cause.message);
  if (typeof cause?.syscall === "string") parts.push(cause.syscall);
  if (typeof cause?.hostname === "string") parts.push(cause.hostname);

  return Array.from(new Set(parts.filter(Boolean))).join(" · ");
}

type ProtocolEra = "modern" | "legacy";

function clientMeta() {
  return {
    "io.modelcontextprotocol/protocolVersion": MODERN_PROTOCOL_VERSION,
    "io.modelcontextprotocol/clientCapabilities": {},
    "io.modelcontextprotocol/clientInfo": {
      name: "creatorhub",
      version: "0.1.0",
    },
  };
}

function endpointFromEnv() {
  const raw = (process.env.EROMIFY_MCP_URL || DEFAULT_EROMIFY_MCP_URL).trim();
  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    throw new EromifyError("EROMIFY_MCP_URL is invalid.", "INVALID_REQUEST");
  }

  if (url.protocol !== "https:") {
    throw new EromifyError("EROMIFY_MCP_URL must use HTTPS.", "INVALID_REQUEST");
  }

  return url;
}

function apiKeyFromEnv() {
  return (process.env.EROMIFY_API_KEY || "").trim();
}

export function eromifyMcpConfigured() {
  return Boolean(apiKeyFromEnv());
}

function parseEventStream(text: string): JsonRpcEnvelope | null {
  const events = text.split(/\r?\n\r?\n/);

  for (const event of events) {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");

    if (!data || data === "[DONE]") continue;

    try {
      return JSON.parse(data) as JsonRpcEnvelope;
    } catch {
      continue;
    }
  }

  return null;
}

async function readEventStreamEnvelope(response: Response): Promise<JsonRpcEnvelope | null> {
  if (!response.body) return null;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: !done });

      const boundary = buffer.search(/\r?\n\r?\n/);
      if (boundary >= 0) {
        const event = buffer.slice(0, boundary);
        const envelope = parseEventStream(event + "\n\n");
        if (envelope) return envelope;
        buffer = buffer.slice(boundary).replace(/^\r?\n\r?\n/, "");
      }

      if (done) {
        buffer += decoder.decode();
        return buffer ? parseEventStream(buffer) : null;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

async function readEnvelope(response: Response): Promise<JsonRpcEnvelope | null> {
  if (response.status === 202 || response.status === 204) return null;

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("text/event-stream")) {
    return readEventStreamEnvelope(response);
  }

  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text) as JsonRpcEnvelope;
  } catch {
    throw new EromifyError(
      `Eromify MCP returned an unreadable response (${response.status}).`,
      "NETWORK_ERROR",
    );
  }
}

function errorFromResponse(response: Response, envelope: JsonRpcEnvelope | null) {
  const detail = envelope?.error?.message || `HTTP ${response.status}`;

  if (response.status === 401 || response.status === 403) {
    return new EromifyError(`Eromify authorization failed: ${detail}`, "AUTH_FAILED");
  }

  if (response.status === 429) {
    return new EromifyError(`Eromify rate limit reached: ${detail}`, "RATE_LIMITED");
  }

  return new EromifyError(`Eromify MCP request failed: ${detail}`, "NETWORK_ERROR");
}

export class EromifyMcpClient {
  private readonly endpoint: URL;
  private readonly apiKey: string;
  private era: ProtocolEra | null = null;
  private protocolVersion = LEGACY_PROTOCOL_VERSION;
  private sessionId: string | null = null;
  private requestId = 0;

  constructor(options?: { endpoint?: URL; apiKey?: string }) {
    this.endpoint = options?.endpoint ?? endpointFromEnv();
    this.apiKey = options?.apiKey ?? apiKeyFromEnv();

    if (!this.apiKey) {
      throw new EromifyError(
        "EROMIFY_API_KEY is not configured. Add a personal Eromify MCP API key as a server-only secret.",
        "NOT_CONFIGURED",
      );
    }
  }

  private nextId() {
    this.requestId += 1;
    return this.requestId;
  }

  private async post(
    method: string,
    params: Record<string, unknown> | undefined,
    options?: { modernProbe?: boolean; notification?: boolean },
  ) {
    const id = options?.notification ? undefined : this.nextId();
    const modern = options?.modernProbe || this.era === "modern";
    const effectiveParams = modern
      ? { ...(params ?? {}), _meta: clientMeta() }
      : params;

    const body: Record<string, unknown> = {
      jsonrpc: "2.0",
      method,
    };
    if (id !== undefined) body.id = id;
    if (effectiveParams && Object.keys(effectiveParams).length > 0) {
      body.params = effectiveParams;
    }

    const headers = new Headers({
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": options?.modernProbe
        ? MODERN_PROTOCOL_VERSION
        : this.protocolVersion,
    });

    if (modern) {
      headers.set("Mcp-Method", method);
      const name = typeof params?.name === "string" ? params.name : "";
      if (name) headers.set("Mcp-Name", name);
    } else if (this.sessionId) {
      headers.set("Mcp-Session-Id", this.sessionId);
    }

    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const errorName = error instanceof Error ? error.name : "";
      if (errorName === "TimeoutError" || errorName === "AbortError") {
        throw new EromifyError(
          "Eromify MCP request timed out before a response was received.",
          "NETWORK_ERROR",
          error,
        );
      }

      throw new EromifyError(
        `Could not reach Eromify MCP: ${networkFailureDetail(error)}`,
        "NETWORK_ERROR",
        error,
      );
    }

    const returnedSessionId = response.headers.get("mcp-session-id");
    if (returnedSessionId) this.sessionId = returnedSessionId;

    let envelope: JsonRpcEnvelope | null;
    try {
      envelope = await readEnvelope(response);
    } catch (error) {
      if (error instanceof EromifyError) throw error;

      const errorName = error instanceof Error ? error.name : "";
      if (errorName === "TimeoutError" || errorName === "AbortError") {
        throw new EromifyError(
          "Eromify MCP response stream timed out.",
          "NETWORK_ERROR",
          error,
        );
      }

      throw new EromifyError(
        error instanceof Error
          ? `Could not read Eromify MCP response: ${error.message}`
          : "Could not read Eromify MCP response.",
        "NETWORK_ERROR",
        error,
      );
    }

    if (!response.ok || envelope?.error) {
      throw errorFromResponse(response, envelope);
    }

    return envelope;
  }

  private async connectModern() {
    const envelope = await this.post("server/discover", undefined, { modernProbe: true });
    if (!envelope?.result) {
      throw new EromifyError("Modern MCP discovery returned no capabilities.", "NETWORK_ERROR");
    }

    this.era = "modern";
    this.protocolVersion = MODERN_PROTOCOL_VERSION;
  }

  private async connectLegacy() {
    this.era = "legacy";
    this.protocolVersion = LEGACY_PROTOCOL_VERSION;

    const envelope = await this.post("initialize", {
      protocolVersion: LEGACY_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: "creatorhub",
        version: "0.1.0",
      },
    });

    const result =
      envelope?.result && typeof envelope.result === "object"
        ? (envelope.result as Record<string, unknown>)
        : null;

    const negotiated =
      result && typeof result.protocolVersion === "string"
        ? result.protocolVersion
        : LEGACY_PROTOCOL_VERSION;

    this.protocolVersion = negotiated;
    await this.post("notifications/initialized", undefined, { notification: true });
  }

  async connect() {
    if (this.era) return;

    try {
      await this.connectModern();
    } catch (error) {
      if (error instanceof EromifyError && ["AUTH_FAILED", "RATE_LIMITED"].includes(error.code)) {
        throw error;
      }

      this.era = null;
      this.sessionId = null;
      await this.connectLegacy();
    }
  }

  async listTools(): Promise<EromifyMcpTool[]> {
    await this.connect();
    const envelope = await this.post("tools/list", {});
    const result =
      envelope?.result && typeof envelope.result === "object"
        ? (envelope.result as Record<string, unknown>)
        : null;
    const tools = result && Array.isArray(result.tools) ? result.tools : [];

    return tools
      .filter((tool): tool is Record<string, unknown> => Boolean(tool) && typeof tool === "object")
      .filter((tool) => typeof tool.name === "string")
      .map((tool) => ({
        name: tool.name as string,
        description: typeof tool.description === "string" ? tool.description : undefined,
        inputSchema:
          tool.inputSchema && typeof tool.inputSchema === "object"
            ? (tool.inputSchema as Record<string, unknown>)
            : undefined,
      }));
  }

  async callTool(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<EromifyMcpToolResult> {
    if (!name.trim()) {
      throw new EromifyError("Eromify MCP tool name is required.", "INVALID_REQUEST");
    }

    await this.connect();
    const envelope = await this.post("tools/call", {
      name,
      arguments: args,
    });

    const result =
      envelope?.result && typeof envelope.result === "object"
        ? (envelope.result as EromifyMcpToolResult)
        : {};

    return result;
  }

  async close() {
    if (this.era !== "legacy" || !this.sessionId) return;

    try {
      await fetch(this.endpoint, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "MCP-Protocol-Version": this.protocolVersion,
          "Mcp-Session-Id": this.sessionId,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(4_000),
      });
    } catch {
      // Best-effort legacy session cleanup only.
    } finally {
      this.sessionId = null;
      this.era = null;
    }
  }
}

export async function checkEromifyMcp() {
  if (!eromifyMcpConfigured()) {
    return {
      configured: false,
      reachable: false,
      toolCount: 0,
      toolNames: [] as string[],
      detail: "EROMIFY_API_KEY is not configured.",
    };
  }

  const client = new EromifyMcpClient();

  try {
    const tools = await client.listTools();
    return {
      configured: true,
      reachable: true,
      toolCount: tools.length,
      toolNames: tools.map((tool) => tool.name),
      detail: `Eromify MCP is reachable and exposed ${tools.length} tool${tools.length === 1 ? "" : "s"}.`,
    };
  } catch (error) {
    const detail =
      error instanceof EromifyError
        ? error.message
        : "Could not reach Eromify MCP.";

    return {
      configured: true,
      reachable: false,
      toolCount: 0,
      toolNames: [] as string[],
      detail,
    };
  } finally {
    await client.close();
  }
}
