import { EromifyMcpClient, eromifyMcpConfigured } from "@/lib/eromify-mcp";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || user.is_anonymous) {
    return Response.json(
      { error: "Sign in with a permanent account first." },
      { status: 401 },
    );
  }

  if (!eromifyMcpConfigured()) {
    return Response.json(
      {
        configured: false,
        reachable: false,
        tools: [],
        detail: "EROMIFY_API_KEY is not configured.",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const client = new EromifyMcpClient();

  try {
    const tools = await client.listTools();
    return Response.json(
      {
        configured: true,
        reachable: true,
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description ?? null,
          inputSchema: tool.inputSchema ?? null,
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        configured: true,
        reachable: false,
        tools: [],
        detail: error instanceof Error ? error.message : "Could not reach Eromify MCP.",
      },
      {
        status: 502,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } finally {
    await client.close();
  }
}
