---
name: agent-ready
description: Make a product usable by both people and AI agents - a read-only catalogue and quote API that reuses the site's own pricing, agent orders and inquiries that never take payment (request id, consent, rate limits, server-side only), an MCP endpoint, OpenAPI and llms.txt, and choice-first forms. Use when the user says "make this agent-ready", "let AI agents quote or book", "add MCP", "build for agents", 「做 Agent 接入」「让 AI 能查价/下单」「加 MCP」, or when adding machine-callable endpoints to a product that sells services or goods.
---

# agent-ready: one product, for people and for AI agents

Reference implementation: Shuttlely.ca, live since 2026-10-28 including its security-review fixes. Its code is private; `references/shuttlely-reference.md` describes the design file by file.
Full rules: `references/playbook.md`. Chinese versions sit next to each file as `*.zh-CN.md`; English is the source of truth, and both are updated together.

## Iron rules (every step)

1. **One price, one order path.** The quote endpoint calls the site's own pricing code. A test proves the agent quote equals the website quote. Never write a second pricing path.
2. **Agent orders never take payment.** They produce an order or inquiry number; a person confirms, then sends a payment link. The server re-prices everything and trusts no price in the request.
3. **Three gates on every write.** A `requestId` (UUID: a resend returns the first result; the same id with different content gets 409), `customerConsent: true` (or `travellerConsent`), and the customer's own email. Rate-limit per IP, per recipient email and site-wide.
4. **Never a way to email strangers.** If the system emails the address on the order, nothing the caller typed (name and so on) may carry a link, domain, email address or markup (see `nameLooksUnsafe`), and the website form uses the same check. Cap emails per recipient per day.
5. **Writes are server-side only.** Orders, inquiries and MCP refuse a request whose `Origin` is another site (403) and send no CORS headers. Only the read-only catalogue and quote send `Access-Control-Allow-Origin: *`. MCP itself requires Origin validation.
6. **Choices first.** Website forms and API fields use options and enums; free text only for "custom".
7. **No single-platform bet.** REST + OpenAPI + MCP (stateless Streamable HTTP) + llms.txt only.
8. **Show the user before shipping; after shipping, call only read-only endpoints and the MCP handshake, never place a real order.** If the user asks for a live write test, send one marked "test, please ignore" and ask them to check the inbox.

## Workflow

### 0. Understand the product and confirm with the user (no code yet)
Read the code, then list for the user, in plain words and in their language:
- What it sells: the catalogue of services or goods, and where their ids come from.
- **Legal and business red lines**: what the website must not say or do (for example a property-tax tool may not be allowed to give a value opinion under appraiser law; some products cannot promise outcomes). The agent API keeps the same lines, including in what it returns.
- How pricing works: which file computes prices, what prices instantly, what needs a person.
- How people order today: the order endpoint, the functions that assemble an order and send emails, any existing rate limits and duplicate protection.
- Which form fields are free text and could become choices.
- The files and endpoints you plan to add.

**Wait for the user's go-ahead.** Every product is different; do not copy Shuttlely's charter logic.

### 1. Read-only: catalogue + quote
- Add `lib/agent-desk.ts` (or the project's usual place) with pure functions `catalog(lang)` and `quote(input)` returning `{status, body}`, framework-free and easy to test.
- Quote: turn the structured input into the site's own request format and hand it to **the same parser and pricing function**. Errors are specific (`unknown_*`, `invalid_*`, `written_quote_only`) and say which endpoint to call next.
- Return a link a person can open to check the same plan or quote on the website.
- Routes: `GET /api/agent/catalog` (name it for the product: routes, regions, formats…) and `POST /api/agent/quote`, with CORS; read-only answers may be cached.

### 2. Writes: orders / inquiries
- First extract the "assemble the order" part of the website's order flow into a shared function (Shuttlely: `assembleOrder`). Website and agents both call it and share the email templates.
- `POST /api/agent/orders`: check the three gates, re-price, tag the order notes `[Booked through the agent API by <agentName>]`, send. Return the order number, status, and one sentence on what happens next and that nothing was charged.
- What cannot be sold instantly goes to `POST /api/agent/inquiries`, into the same inquiry inbox, with `source: "agent-api"`.
- Duplicates: keep `requestId → (content fingerprint, result promise)` for 15 minutes; forget failures so a retry can succeed.
- Starting limits: orders 3 per IP per 15 minutes, 10 site-wide, 2 per recipient email per day; inquiries 5 per IP and 30 site-wide. Over the limit: 429 with `Retry-After`.
- **In-memory counters are only a backstop.** Serverless platforms (Vercel, Cloudflare) run several instances, each counting on its own. With real traffic move to a shared store (Vercel KV / Upstash / Cloudflare KV or Durable Objects) or the platform firewall's rate limiting. Tell the user which one is in place.
- The website form's own checks (origin, time to fill, honeypot) do not exist on the agent API; the rules above replace them.

### 3. MCP
- Copy `templates/mcp-handler.ts` and `templates/agent-http.ts`; replace the tool list, `instructions` and `serverInfo`, and set the product's own origins.
- `app/api/mcp/route.ts` (or the framework's route): check Origin first, then JSON-RPC on POST; notifications get 202; GET gets 405; no CORS headers.
- Look tools up with `Object.hasOwn(tools, name)`, never `name in tools`, or built-in names like `constructor` and `toString` count as tools.
- One tool per REST endpoint. Tool input schemas come from the shared `lib/agent-schema.ts`, which also generates OpenAPI.
- Read-only tools: `readOnlyHint: true`. Write tools: `idempotentHint: true`, `destructiveHint: false`. A failing tool returns `isError: true` with the reason in `structuredContent`.
- Write tools may omit `requestId` (the server makes one); a caller's own `requestId` always wins.

### 4. Public description
- `/openapi.json`: generated from `lib/agent-schema.ts`, force-static.
- `llms.txt`: the endpoint and MCP URLs, one example request per endpoint, and "no payment, customer consent required, the same requestId never books twice". Numbers come from the price-book code.
- Detail and quote pages render on the server; structured data is complete.

### 5. Choices first (website forms)
Following playbook principle 4: city, item, date (plus a "not decided" choice), quantities (steppers) and extra needs (multi-select buttons) are all choices. A text box appears only after "custom" is chosen. Contact: one required email, phone optional.

### 6. Tests and sign-off
Tests cover at least (Shuttlely's are in `tests/agent-api.test.mjs`):
- the catalogue is complete and the agent quote equals the website quote;
- every error has a clear code;
- no order without consent; the same requestId never books twice; the same id with other content gets 409; per-IP and per-email limits hold;
- a name with a link or email address is refused, on the website and the API;
- write endpoints return 403 for another site's Origin and accept server calls without Origin;
- MCP treats `constructor` / `toString` as unknown tools;
- order notes carry the source tag;
- MCP `initialize` negotiates the version, notifications get 202 (null from the handler), and `tools/list`, `tools/call` and `isError` behave.

Then:
- Run the full suite and the build; call every endpoint locally with curl (without local email settings an order must return 503 "nothing was booked").
- Push a preview branch and **show the user**; push the main branch only after they agree.
- After launch, call the catalogue, a quote, MCP `initialize` and `tools/list` on the real domain. **No orders.**
- Paste playbook section 3 into the project's rules file. **First check the file is not generated**: an "auto-generated" header, a block injected by a memory or orchestration tool, or a file another tool rewrites will be overwritten. Use `CLAUDE.md`, or a section that is never rewritten.

## Other frameworks

The templates are Next.js App Router on Vercel. Elsewhere:

| | Client IP | Routes | In-memory counters |
|---|---|---|---|
| Vercel (Next.js) | `x-real-ip` header | `app/api/**/route.ts` | one set per instance |
| Cloudflare Workers | `CF-Connecting-IP` header | dispatch by path in `fetch` | one set per isolate; use KV or Durable Objects |
| Python FastAPI | the real IP from your own proxy (trust only the last hop it adds to `X-Forwarded-For`), else `request.client.host` | `@app.post("/api/agent/...")` | process memory; Redis with several workers |

Whatever the framework, **never trust an IP or origin the caller reports about itself**.

## Reporting to the user

In the user's language, plain and short: which steps were done, what was checked live, what was not verified (for example a real order), and whether rate limits are an in-memory backstop or a shared store. End with how other AI tools connect:

```bash
claude mcp add --transport http <name> https://<domain>/api/mcp
```
