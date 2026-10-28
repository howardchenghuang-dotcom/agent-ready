# Reference implementation: Shuttlely.ca

> Chinese version: [shuttlely-reference.zh-CN.md](shuttlely-reference.zh-CN.md). English is the source of truth.

Shuttlely's code is in a private repository. This page describes the design file by file so the same approach can be rebuilt elsewhere. First release 2026-10-28; the security-review fixes the same day are listed at the end.

| File | What it does |
|---|---|
| `lib/agent-desk.ts` | The core: `routeCatalog`, `quote`, `order`, `inquiry`, returning `{status, body}`, framework-free |
| `lib/agent-schema.ts` | Shared JSON Schemas (trip, traveller, order, inquiry), used by the MCP tools and OpenAPI |
| `lib/agent-mcp.ts` | MCP JSON-RPC handling (this skill's `templates/mcp-handler.ts` comes from it) |
| `lib/agent-http.ts` | Reading JSON, the client IP, CORS for read-only endpoints, the Origin check for writes (`foreignOrigin`) |
| `lib/contact-name.ts` | `nameLooksUnsafe`: no links, domains or email addresses in a name; shared by the website form and the API |
| `lib/order-handler.ts` → `assembleOrder()` | Extracted from the website's order flow; website and agents both call it |
| `app/api/agent/{routes,quote,orders,inquiries}/route.ts` | Thin REST wrappers, about 10 lines each |
| `app/api/mcp/route.ts` | The MCP endpoint |
| `app/openapi.json/route.ts` | OpenAPI 3.1 generated from the shared schemas |
| `lib/agent-booking.ts` → `llms.txt` | The guide for AI readers, numbers generated from the price book |
| `components/inquiry-panel.tsx` | The choice-first inquiry form (for people) |
| `tests/agent-api.test.mjs` | 13 tests: catalogue, quote parity, errors, consent, duplicates, 409, per-IP and per-email limits, inquiries, MCP, built-in tool names, names with links, Origin |

## Key techniques

- **Quotes reuse the pricing function**: the agent's JSON becomes the website's own plan-link parameters (`t=…&d=…&g=…&v=…`) and goes to `planFromQuery`. The website, the plan page and the order endpoint all use that parser, so prices cannot differ.
- **Routing by region**: a non-Toronto route sent to `quote` gets 422 `written_quote_only`, telling the agent to call `request_quote` instead.
- **Order numbers**: `SL-YYMMDD-XXXX` is derived from the requestId, so one id always yields one order number.
- **Loading TypeScript in tests**: the `.mjs` tests load TS modules with `typescript.transpileModule` + `vm` and resolve `@/` paths by hand. Arrays created inside the sandbox fail `deepEqual`; wrap them in `Array.from()`.
- **Pitfalls hit**: the project already had a variable with the same name (`setDeparture` was the airport drop-off state), so the shared store import had to be renamed; preview URLs are not on the origin allow-list and cannot send inquiries, which is expected.

## Found in the security review (fixed; get these right from the start)

1. **The confirmation email as a spam channel**: it goes to the address on the order and opens with the name the caller typed. The agent API lacks the website form's anti-bot checks, so anyone could have Shuttlely email a stranger. Fix: the name check, a per-recipient daily cap, a lower site-wide cap.
2. **CORS on write endpoints**: another site's page could make its visitors' browsers place orders and spread the per-IP limit. Fix: writes and MCP refuse another site's Origin and send no CORS headers.
3. **MCP looked tools up with `name in tools`**: built-in names like `constructor` counted as tools. Fix: `Object.hasOwn`.
4. **The same requestId with different content** silently returned the first result. Fix: 409.
5. **In-memory counters** are only a backstop on multi-instance platforms.
