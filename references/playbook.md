# One product, for people and for AI agents: the playbook

> Chinese version: [playbook.zh-CN.md](playbook.zh-CN.md). English is the source of truth.
>
> Origin: built for Shuttlely.ca on 2026-10-28 so that people and AI agents can both order.
> Applies to: any product that sells services or goods (charters, property-tax appeals, document formatting, construction quotes…).
> How to use: section 1 is the principles, section 2 the checklist, section 3 can be pasted as-is into a project's `AGENTS.md` / `CLAUDE.md`.

---

## 1. Five principles

1. **One product, two doors.** People use the website for the experience and the final decision; agents use the API to look things up and get things done. Both share one price list, one set of rules and one order path. **Never two ways to compute a price.**
2. **Read first, then act.** Open "look up" (catalogue, quote) first: it carries no risk. "Do" (order, send an inquiry) happens only with the customer's own consent.
3. **Agent orders take no money.** An agent order only creates an order number; a person confirms availability or feasibility and then sends a payment or deposit link. A wrong agent order costs nothing, and that is what makes the whole approach safe.
4. **Choices first.** Forms for people use buttons, options, date pickers and steppers; a text box appears only once "custom" is chosen. Agent APIs likewise use fixed values (city ids, route ids, enums), not free text. Easier for people, easier for machines.
5. **No single-platform bet.** Use open, general formats (OpenAPI + MCP + llms.txt), not something tailored to one AI platform. Add a platform's own protocol once it actually brings orders.

---

## 2. Checklist (in order)

### Step 1: read-only endpoints (half a day)
- [ ] `GET /api/agent/catalog`: everything that can be bought (services, routes, regions), each with id, name, whether it prices instantly, from-price and detail-page URL.
- [ ] `POST /api/agent/quote`: structured request in; price range, deposit, the reasons a person must quote, and a link a person can open to check, out.
- [ ] **The quote calls the site's own pricing function** (same parser, same price book), never a copy. One test: agent quote = website quote.
- [ ] Where there is no instant price, return a clear error code and say which endpoint to call next (for example `written_quote_only → request_quote`).
- [ ] Read-only endpoints allow cross-origin calls (`Access-Control-Allow-Origin: *`) and may be cached for a few minutes.

### Step 2: order / inquiry endpoints (half a day to a day)
- [ ] `POST /api/agent/orders` requires:
  - `requestId` (UUID): a resend returns the first result and **never creates a second order**.
  - `customerConsent: true` (or `travellerConsent`): refuse without it, and say in the error that the customer must agree first, with the terms URL.
  - The customer's name and email: the confirmation goes to the customer, so a real person sees it.
- [ ] Orders go through the website's own path (same order-assembly function, same emails). **The server re-prices and trusts no price an agent sends.**
- [ ] Order notes are tagged automatically ("via agent API by XXX") so the operator sees the source at a glance.
- [ ] Rate limits: a few orders per IP per 15 minutes, a few per recipient email per day, plus a site-wide cap. Over the limit: 429 with `Retry-After`. **In-memory counters are only a backstop**: with real traffic on a multi-instance platform, use a shared store or the platform firewall.
- [ ] **Never a way to email strangers**: in any email sent to the address on the order, what the caller typed (name and so on) may not carry links, domains, email addresses or markup; the website form uses the same check.
- [ ] **Writes are server-side only**: a request with another site's `Origin` gets 403, and no CORS headers are sent (MCP requires Origin validation too). Only read-only endpoints allow cross-origin calls.
- [ ] The same requestId with different content gets 409, not the first result.
- [ ] The website's legal and business red lines (what it cannot promise, opinions it cannot give) hold for the agent API too.
- [ ] Return the order number, the status and one sentence on what happens next (for example "confirmation by email within 2 hours, deposit only after that, nothing charged now").
- [ ] What cannot be sold instantly (other cities, custom requests) goes to `POST /api/agent/inquiries`, with the same rules, into the same inquiry inbox.

### Step 3: MCP endpoint (half a day)
- [ ] `POST /api/mcp`: Streamable HTTP, stateless, one JSON reply per request. No sign-in, no server push (GET returns 405).
- [ ] Support `initialize` (answer with the version the client asks for: 2025-06-18 / 2025-03-26 / 2024-11-05), `ping`, `tools/list`, `tools/call`; notifications (no id) get 202.
- [ ] One tool per endpoint from steps 1 and 2, for example `list_*` / `get_quote` / `place_order` / `request_quote`.
- [ ] Look tools up with `Object.hasOwn`, not `in` (or built-in names like `constructor` count as tools). Check Origin first; send no CORS headers.
- [ ] Annotate tools: read-only tools `readOnlyHint: true`; order tools `idempotentHint: true`, `destructiveHint: false`.
- [ ] Each tool description says: call only after the customer agrees; nothing is charged.
- [ ] `initialize` `instructions`: two or three sentences on what the product sells and which tool to call first.
- [ ] A failing tool returns `isError: true` with the reason in `structuredContent`, not a JSON-RPC error, so the model can read the reason and fix its call.

### Step 4: public description (an hour)
- [ ] `/openapi.json`: generated from **the same JSON Schema** the MCP tools use, so they cannot drift.
- [ ] `/llms.txt`: a few lines on what is sold, how prices work, what needs a person, the endpoint and MCP URLs, one example request per endpoint, and "no payment, consent required". **Generated from the price-book code; never copy numbers by hand.**
- [ ] Detail pages render on the server (no JavaScript needed), so agents that do not run scripts can still read prices and itineraries.
- [ ] Structured data (schema.org) covers the service, prices, area and business details.

### Step 5: tests and launch
- [ ] Tests cover at least: a complete catalogue; agent quote = website quote; clear errors for unknown ids, past dates and out-of-range values; no order without consent; the same requestId never books twice and different content gets 409; per-IP and per-email limits; names with links refused; another site's Origin gets 403; the MCP handshake, tool list, calls and notifications, and built-in names refused as tools.
- [ ] Call every endpoint locally for real (without local email settings, an order returns 503 "nothing was booked").
- [ ] After launch, call the read-only endpoints and the MCP handshake on the real domain once. A live order only if it is marked "test, please ignore", checked in the inbox afterwards.

---

## 3. Rules to paste into a project (AGENTS.md / CLAUDE.md)

```markdown
## Agent-ready rules
- People and agents share one price list, one set of rules and one order path; the agent quote calls the website's own pricing function, with a test proving they match.
- Read-only endpoints (catalogue, quote) are open; order and inquiry endpoints require a requestId (no duplicates), a customer-consent flag and the customer's email.
- Agent orders never take payment: they create an order number, and a person confirms before sending a payment link. The server re-prices and trusts no price in the request.
- Order notes are tagged "via agent API by <agentName>"; rate-limit per IP, per recipient email and site-wide, 429 when over (in-memory counters are a backstop; use a shared store once traffic is real).
- In emails sent to the address on an order, caller-typed fields such as the name carry no links, domains or email addresses; the website form and the API share the check.
- Orders, inquiries and MCP are server-side only: another site's Origin gets 403 and no CORS headers are sent; only read-only endpoints allow cross-origin calls.
- The same requestId with different content gets 409; MCP looks tools up with Object.hasOwn.
- The website's legal and business red lines hold for the agent API too.
- Forms and APIs prefer options and enums; free text only for "custom".
- MCP endpoint /api/mcp (stateless Streamable HTTP), one tool per REST endpoint, all sharing one JSON Schema in lib, which also generates OpenAPI.
- llms.txt gives the endpoint URLs, example requests and "no payment, consent required"; numbers come from the price-book code.
- When prices, rules or order fields change, the website, REST endpoints, MCP tools, OpenAPI and llms.txt stay in line through shared code and tests, never by editing five places by hand.
```

---

## 4. Applying it to other products (illustrations; verify per project)

| Product | Catalogue | Instant price | Needs a person | After an agent order |
|---|---|---|---|---|
| Shuttlely charters | city × route | Toronto routes from the price book | other cities, 8+ guests, holidays | order number → availability confirmed → deposit link |
| Property-tax appeal tool | supported regions | savings estimate + fixed fee (⚠ where appraiser law forbids value opinions, the API must not give one either) | unsupported regions | order number → the customer pays through an emailed link |
| Document formatting tool | styles (APA / MLA / Chicago) | free / paid-tier price | unusual styles | result or payment link |
| Construction quotes | job types | estimate from unit prices | items that need a site visit | inquiry → a person sends the formal quote |

Only the first row is built; the others are illustrations, not finished designs. Step 0 reads the actual code and confirms with the user first; do not build straight from this table.

In every case: **agents can look up and submit, but money and the final confirmation stay with a person.**
