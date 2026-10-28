/**
 * Shared HTTP helpers for the agent endpoints. Copy into lib/agent-http.ts and point `desk` at the
 * product's agent desk (pure functions returning { status, body }). Next.js + Vercel as written;
 * see "换框架时要改的地方" in SKILL.md for Cloudflare Workers and FastAPI.
 */
// import { createAgentDesk } from "@/lib/agent-desk";
// export const desk = createAgentDesk({ sendOrder, sendInquiry }); // one per server instance: holds limits and retry memory

export type DeskResult = { status: number; body: Record<string, unknown> };

// ---- Read-only endpoints (catalogue, quote): any web page may call them. ----
export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept",
};
const noStore = (status: number) => ({ "Cache-Control": "no-store", ...(status === 429 ? { "Retry-After": "900" } : {}) });
export const reply = ({ status, body }: DeskResult) => Response.json(body, { status, headers: { ...noStore(status), ...CORS } });
export const preflight = () => new Response(null, { status: 204, headers: CORS });

// ---- Endpoints that book or send email (orders, inquiries, MCP): server-side callers only. ----
// Server-side agents send no Origin header; a page on another site sends its own and is refused, so it
// cannot make its visitors' browsers place orders (spreading per-IP limits). MCP requires this check.
const OWN_ORIGINS = ["https://example.com", "https://www.example.com"]; // TODO: the product's own origins
export const foreignOrigin = (request: Request) => {
  const origin = request.headers.get("origin");
  return origin !== null && !OWN_ORIGINS.includes(origin);
};
export const writeReply = ({ status, body }: DeskResult) => Response.json(body, { status, headers: noStore(status) });
export const foreignOriginReply = () => writeReply({ status: 403, body: { error: "origin", detail: "Call this endpoint from a server, not from a web page on another site." } });
export const writePreflight = () => new Response(null, { status: 204 });

// Vercel sets x-real-ip (Cloudflare: CF-Connecting-IP). Never trust an address the caller chooses.
export const clientIp = (request: Request) => request.headers.get("x-real-ip") ?? "unknown";

const LIMIT = 32768;
export async function readJson(request: Request): Promise<{ value: unknown } | { error: DeskResult }> {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return { error: { status: 415, body: { error: "content_type", detail: "Send JSON with Content-Type: application/json." } } };
  const text = await request.text();
  if (text.length > LIMIT) return { error: { status: 413, body: { error: "too_large", detail: "Request body over 32 KB." } } };
  try { return { value: JSON.parse(text) }; } catch { return { error: { status: 400, body: { error: "invalid_json", detail: "Body is not valid JSON." } } }; }
}

/**
 * A customer's name is printed in the email sent to the address on the order. A name carrying a link
 * or an address would let anyone use that email to reach a stranger in the product's name. Use the
 * same check on the website form.
 */
const DOMAIN = /[a-z0-9-]+\.(?:com|net|org|io|ca|cn|co|me|info|biz|xyz|top|ru|link|app|site|online|shop|club|vip|cc|tk|ly|gl|to|us|uk|de)\b/i;
export const nameLooksUnsafe = (name: string) => /:\/\/|www\.|@|[<>\\/{}[\]|]/i.test(name) || DOMAIN.test(name);

/**
 * Retry memory and rate limits for write actions. In memory, so per server instance: a backstop only.
 * On multi-instance platforms move them to a shared store (Vercel KV / Upstash / Cloudflare KV or
 * Durable Objects) or the platform firewall once traffic is real.
 */
const windowMs = 15 * 60 * 1000;
const dayMs = 24 * 60 * 60 * 1000;
export function createGuards() {
  const done = new Map<string, { expires: number; fingerprint: string; result: Promise<DeskResult> }>();
  const attempts = new Map<string, { count: number; expires: number }>();
  const perEmail = new Map<string, { count: number; expires: number }>();
  let global = { count: 0, expires: 0 };
  return {
    /** Same requestId and content within 15 minutes returns the first result; same id, other content: 409. Failures are forgotten. */
    once(key: string, fingerprint: string, time: number, run: () => Promise<DeskResult>) {
      for (const [k, entry] of done) if (entry.expires <= time) done.delete(k);
      const existing = done.get(key);
      if (existing) return existing.fingerprint === fingerprint ? existing.result : Promise.resolve({ status: 409, body: { error: "conflict", detail: "This requestId was already used for a different request." } });
      const result = run().then((r) => { if (r.status !== 200) done.delete(key); return r; });
      done.set(key, { expires: time + windowMs, fingerprint, result });
      return result;
    },
    /** True when this address or the whole site is over the limit for the window. */
    limited(ip: string, time: number, perIp: number, total: number) {
      for (const [key, entry] of attempts) if (entry.expires <= time) attempts.delete(key);
      if (global.expires <= time) global = { count: 0, expires: time + windowMs };
      const bucket = attempts.get(ip) ?? { count: 0, expires: time + windowMs };
      if (bucket.count >= perIp || global.count >= total || attempts.size >= 1000) return true;
      bucket.count++; global.count++; attempts.set(ip, bucket);
      return false;
    },
    /** True when this recipient email already got `max` emails today. */
    emailCapped(email: string, time: number, max = 2) {
      for (const [k, entry] of perEmail) if (entry.expires <= time) perEmail.delete(k);
      const key = email.toLowerCase();
      const entry = perEmail.get(key) ?? { count: 0, expires: time + dayMs };
      if (entry.count >= max || perEmail.size >= 5000) return true;
      entry.count++; perEmail.set(key, entry);
      return false;
    },
  };
}
