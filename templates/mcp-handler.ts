/**
 * Minimal MCP server over Streamable HTTP: stateless JSON-RPC on POST, one JSON reply per request,
 * no session and no server-sent events. Copy into lib/agent-mcp.ts and fill in TOOLS, INSTRUCTIONS
 * and SERVER_INFO. Each tool handler returns { status, body } from the agent desk.
 */
export type DeskResult = { status: number; body: Record<string, unknown> };
type Handler = (args: Record<string, unknown>) => DeskResult | Promise<DeskResult>;

export const MCP_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

// TODO: product name and a two-sentence "what this sells, which tool to call first, no payment".
const SERVER_INFO = { name: "my-product", title: "My product", version: "1.0.0" };
const INSTRUCTIONS = "What this product sells. Call list_* first, then get_quote. Only call write tools after the customer agrees; no payment is taken through these tools.";

// TODO: one entry per REST endpoint; inputSchema comes from lib/agent-schema.ts (shared with /openapi.json).
export const MCP_TOOLS = [
  { name: "list_items", title: "List what can be bought", description: "…", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true, openWorldHint: false } },
  { name: "get_quote", title: "Price a request", description: "Read-only; books nothing.", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true, openWorldHint: false } },
  { name: "place_order", title: "Place an order", description: "With the customer's consent. No payment is taken; a person confirms and then sends a payment link.", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true } },
];

type Rpc = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };

/** Answers one JSON-RPC message; null for notifications (the route then replies 202 with no body). */
export async function handleMcp(message: unknown, tools: Record<string, Handler>): Promise<object | null> {
  const msg = (message && typeof message === "object" ? message : {}) as Rpc;
  const hasId = typeof msg.id === "string" || typeof msg.id === "number";
  const error = (code: number, text: string) => ({ jsonrpc: "2.0", id: hasId ? msg.id : null, error: { code, message: text } });
  if (msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return error(-32600, "Invalid request");
  if (!hasId) return null;
  const result = (value: object) => ({ jsonrpc: "2.0", id: msg.id, result: value });
  const params = (msg.params && typeof msg.params === "object" ? msg.params : {}) as Record<string, unknown>;

  switch (msg.method) {
    case "initialize": {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      return result({ protocolVersion: MCP_VERSIONS.includes(asked) ? asked : MCP_VERSIONS[0], capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS });
    }
    case "ping":
      return result({});
    case "tools/list":
      return result({ tools: MCP_TOOLS });
    case "tools/call": {
      const name = params.name;
      const args = (params.arguments && typeof params.arguments === "object" ? params.arguments : {}) as Record<string, unknown>;
      // Object.hasOwn, not `in`: "constructor" or "toString" must not count as tools.
      if (typeof name !== "string" || !Object.hasOwn(tools, name)) return error(-32602, `Unknown tool: ${String(name)}`);
      const { status, body } = await tools[name](args);
      // Tool failures are results the model can read and fix, not protocol errors.
      return result({ content: [{ type: "text", text: JSON.stringify(body) }], structuredContent: body, isError: status !== 200 });
    }
    default:
      return error(-32601, `Method not found: ${msg.method}`);
  }
}

/*
 * Next.js App Router route (app/api/mcp/route.ts):
 *
 * import { randomUUID } from "node:crypto";
 * import { clientIp, desk, foreignOrigin, foreignOriginReply, readJson, writePreflight } from "@/lib/agent-http";
 * import { handleMcp } from "@/lib/agent-mcp";
 * export const runtime = "nodejs";
 * export const dynamic = "force-dynamic";
 * // Write tools book and send email: server-side clients only, no cross-site headers.
 * const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
 * export async function POST(request: Request) {
 *   if (foreignOrigin(request)) return foreignOriginReply(); // MCP requires Origin validation
 *   const parsed = await readJson(request);
 *   if ("error" in parsed) return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: String(parsed.error.body.detail) } }, 400);
 *   const ip = clientIp(request);
 *   const tools = {
 *     list_items: (a: Record<string, unknown>) => desk.catalog(a.language),
 *     get_quote: (a: Record<string, unknown>) => desk.quote(a),
 *     place_order: (a: Record<string, unknown>) => desk.order({ requestId: randomUUID(), ...a }, ip), // caller's requestId wins
 *   };
 *   const messages = Array.isArray(parsed.value) ? parsed.value : [parsed.value];
 *   const replies = (await Promise.all(messages.map((m) => handleMcp(m, tools)))).filter((r) => r !== null);
 *   if (!replies.length) return new Response(null, { status: 202 });
 *   return json(Array.isArray(parsed.value) ? replies : replies[0]);
 * }
 * export function GET() { return new Response("Use POST with JSON-RPC (MCP Streamable HTTP).", { status: 405, headers: { Allow: "POST, OPTIONS" } }); }
 * export const OPTIONS = writePreflight;
 */
