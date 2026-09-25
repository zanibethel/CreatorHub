import { EromifyError } from "@/lib/eromify";
import {
  EromifyMcpClient,
  eromifyMcpConfigured,
  type EromifyMcpTool,
} from "@/lib/eromify-mcp";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

type GenerateRequest = {
  prompt?: unknown;
  toolName?: unknown;
  model?: unknown;
  aspectRatio?: unknown;
  count?: unknown;
  confirmedSpend?: unknown;
};

type ToolPropertyMap = Record<string, Record<string, unknown>>;

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asProperties(tool: EromifyMcpTool): ToolPropertyMap {
  const raw = tool.inputSchema?.properties;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};

  return Object.fromEntries(
    Object.entries(raw).filter(
      (entry): entry is [string, Record<string, unknown>] =>
        Boolean(entry[1]) && typeof entry[1] === "object" && !Array.isArray(entry[1]),
    ),
  );
}

function findProperty(properties: ToolPropertyMap, aliases: string[]) {
  const normalized = new Map(
    Object.keys(properties).map((key) => [
      key.toLowerCase().replace(/[^a-z0-9]/g, ""),
      key,
    ]),
  );

  for (const alias of aliases) {
    const match = normalized.get(alias.toLowerCase().replace(/[^a-z0-9]/g, ""));
    if (match) return match;
  }

  return undefined;
}

function requiredFields(tool: EromifyMcpTool) {
  const raw = tool.inputSchema?.required;
  return Array.isArray(raw)
    ? raw.filter((value): value is string => typeof value === "string")
    : [];
}

function enumStrings(property?: Record<string, unknown>) {
  const raw = property?.enum;
  return Array.isArray(raw)
    ? raw.filter((value): value is string => typeof value === "string")
    : [];
}

function imageGenerationScore(tool: EromifyMcpTool) {
  const name = tool.name.toLowerCase();
  if (!name.includes("image")) return -1;
  if (name.includes("video") || name.includes("upload") || name.includes("history")) return -1;

  let score = 0;
  if (name.includes("generate")) score += 6;
  if (name.includes("create")) score += 5;
  if (name.includes("text")) score += 2;
  if (name.includes("edit") || name.includes("upscale")) score -= 3;
  return score;
}

function imageGenerationTools(tools: EromifyMcpTool[]) {
  return tools
    .map((tool) => ({ tool, score: imageGenerationScore(tool) }))
    .filter((item) => item.score >= 0)
    .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))
    .map((item) => item.tool);
}

function buildToolArgs(
  tool: EromifyMcpTool,
  request: {
    prompt: string;
    model: string;
    aspectRatio: string;
    count: number;
  },
) {
  const properties = asProperties(tool);
  const propertyNames = Object.keys(properties);
  const args: Record<string, unknown> = {};

  const promptKey =
    findProperty(properties, ["prompt", "textPrompt", "description", "instruction", "request"]) ??
    (propertyNames.length === 0 ? "prompt" : undefined);

  if (!promptKey) {
    throw new EromifyError(
      `Eromify tool ${tool.name} does not expose a recognizable prompt field.`,
      "INVALID_REQUEST",
    );
  }

  args[promptKey] = request.prompt;

  const modelKey = findProperty(properties, ["model", "modelId", "modelName"]);
  if (modelKey) {
    const choices = enumStrings(properties[modelKey]);
    if (request.model) {
      if (choices.length && !choices.includes(request.model)) {
        throw new EromifyError("Selected Eromify model is not available for this tool.", "INVALID_REQUEST");
      }
      args[modelKey] = request.model;
    } else if (requiredFields(tool).includes(modelKey)) {
      if (choices.length === 1) args[modelKey] = choices[0];
      else {
        throw new EromifyError(
          choices.length
            ? `Choose an Eromify model before generating. Available: ${choices.join(", ")}.`
            : `Eromify tool ${tool.name} requires a model value.`,
          "INVALID_REQUEST",
        );
      }
    }
  }

  const ratioKey = findProperty(properties, ["aspectRatio", "ratio", "aspect"]);
  if (ratioKey) args[ratioKey] = request.aspectRatio;

  const countKey = findProperty(properties, ["count", "numImages", "numberOfImages", "n", "batchSize"]);
  if (countKey) args[countKey] = request.count;

  const missing = requiredFields(tool).filter((field) => !(field in args));
  if (missing.length) {
    throw new EromifyError(
      `Eromify tool ${tool.name} requires additional fields before CreatorHub can call it safely: ${missing.join(", ")}.`,
      "INVALID_REQUEST",
    );
  }

  return args;
}

function collectArtifacts(value: unknown) {
  const urls = new Set<string>();
  const messages: string[] = [];

  const visit = (item: unknown, depth: number) => {
    if (depth > 6 || item === null || item === undefined) return;

    if (typeof item === "string") {
      for (const match of item.matchAll(/https?:\/\/[^\s"'<>]+/g)) {
        urls.add(match[0].replace(/[),.;]+$/, ""));
      }
      if (item.trim() && item.length <= 2_000) messages.push(item.trim());
      return;
    }

    if (Array.isArray(item)) {
      for (const child of item.slice(0, 20)) visit(child, depth + 1);
      return;
    }

    if (typeof item !== "object") return;

    const record = item as Record<string, unknown>;
    const mimeType = asString(record.mimeType || record.mime_type);
    const data = asString(record.data);
    if (record.type === "image" && data && mimeType.startsWith("image/") && data.length < 12_000_000) {
      urls.add(`data:${mimeType};base64,${data}`);
    }

    for (const key of ["url", "uri", "imageUrl", "image_url", "downloadUrl", "download_url", "outputUrl", "output_url"]) {
      const candidate = asString(record[key]);
      if (candidate.startsWith("https://") || candidate.startsWith("http://")) {
        urls.add(candidate);
      }
    }

    for (const [key, child] of Object.entries(record)) {
      if (["data", "base64"].includes(key) && typeof child === "string" && child.length > 20_000) continue;
      visit(child, depth + 1);
    }
  };

  visit(value, 0);

  return {
    artifacts: Array.from(urls).slice(0, 12),
    messages: Array.from(new Set(messages)).slice(0, 12),
  };
}

async function authenticatedUser() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  // Production keeps the permanent-account requirement. Vercel previews may
  // use CreatorHub's anonymous guest session so provider connectivity can be
  // exercised without depending on another app's shared Supabase Site URL.
  if (user.is_anonymous && process.env.VERCEL_ENV !== "preview") return null;

  return user;
}

export async function GET() {
  const user = await authenticatedUser();
  if (!user) {
    return Response.json(
      { error: "Sign in with a permanent account, or use guest mode on a Vercel preview." },
      { status: 401 },
    );
  }

  if (!eromifyMcpConfigured()) {
    return Response.json(
      {
        configured: false,
        reachable: false,
        tools: [],
        detail: "CreatorHub still needs its one-time Eromify server credential.",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const client = new EromifyMcpClient();

  try {
    const tools = imageGenerationTools(await client.listTools());
    return Response.json(
      {
        configured: true,
        reachable: true,
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description ?? null,
          inputSchema: tool.inputSchema ?? null,
        })),
        detail: tools.length
          ? `Found ${tools.length} Eromify image-generation tool${tools.length === 1 ? "" : "s"}.`
          : "Eromify is connected, but no image-generation tool was exposed.",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        configured: true,
        reachable: false,
        tools: [],
        detail: error instanceof Error ? error.message : "Could not reach Eromify.",
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  } finally {
    await client.close();
  }
}

export async function POST(request: Request) {
  const user = await authenticatedUser();
  if (!user) {
    return Response.json({ error: "Sign in with a permanent account first." }, { status: 401 });
  }

  if (!eromifyMcpConfigured()) {
    return Response.json({ error: "Eromify is not configured on CreatorHub yet." }, { status: 503 });
  }

  let body: GenerateRequest;
  try {
    body = (await request.json()) as GenerateRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (body.confirmedSpend !== true) {
    return Response.json(
      { error: "Generation requires explicit confirmation because it can spend Eromify credits." },
      { status: 409 },
    );
  }

  const prompt = asString(body.prompt);
  if (prompt.length < 3 || prompt.length > 2_000) {
    return Response.json({ error: "Prompt must be between 3 and 2,000 characters." }, { status: 400 });
  }

  const toolName = asString(body.toolName);
  const model = asString(body.model);
  const aspectRatio = asString(body.aspectRatio) || "4:5";
  if (!["1:1", "4:5", "9:16", "16:9"].includes(aspectRatio)) {
    return Response.json({ error: "Unsupported aspect ratio." }, { status: 400 });
  }

  const numericCount = Number(body.count ?? 1);
  const count = Number.isFinite(numericCount) ? Math.max(1, Math.min(4, Math.floor(numericCount))) : 1;

  const client = new EromifyMcpClient();

  try {
    const available = imageGenerationTools(await client.listTools());
    const selected = toolName
      ? available.find((tool) => tool.name === toolName)
      : available[0];

    if (!selected) {
      return Response.json(
        {
          error: toolName
            ? "That Eromify tool is not available for image generation."
            : "Eromify is connected, but no image-generation tool is currently available.",
        },
        { status: 422 },
      );
    }

    const args = buildToolArgs(selected, { prompt, model, aspectRatio, count });
    const result = await client.callTool(selected.name, args);
    if (result.isError) {
      return Response.json(
        { error: "Eromify returned an error for this generation request.", toolName: selected.name },
        { status: 502 },
      );
    }

    const output = collectArtifacts(result);
    return Response.json(
      {
        ok: true,
        toolName: selected.name,
        ...output,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const status =
      error instanceof EromifyError && error.code === "INVALID_REQUEST"
        ? 422
        : error instanceof EromifyError && error.code === "RATE_LIMITED"
          ? 429
          : error instanceof EromifyError && error.code === "AUTH_FAILED"
            ? 401
            : 502;

    return Response.json(
      { error: error instanceof Error ? error.message : "Eromify generation failed." },
      { status },
    );
  } finally {
    await client.close();
  }
}
