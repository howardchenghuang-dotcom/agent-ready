> 中文版（给人看）。Claude 读的是英文版 [SKILL.md](SKILL.md)，两份内容一致，以英文版为准。

# Agent-ready：让产品同时给人用、给 AI 用

参考实现：Shuttlely.ca，2026-10-28 上线，含安全复查后的修复。代码是私有的，`references/shuttlely-reference.zh-CN.md` 按文件说明了它的设计。
完整规则：`references/playbook.zh-CN.md`（英文版 `references/playbook.md` 为准）。

## 铁律（每一步都要守）

1. **一套价格、一条下单流程。** 接口报价必须调用网站本身的计价代码。写测试证明：接口报价 = 网页报价。绝不另写一份价格逻辑。
2. **AI 下单永远不收款。** AI 下单只生成订单号或询价编号，人工确认后再发付款链接。服务器自己重新算价，不信请求里传来的价格。
3. **写操作有三道门。** 下单和询价都必须带：`requestId`（UUID，重发只返回第一次的结果；同一个编号配不同内容返回 409）、`travellerConsent/customerConsent: true`、用户本人的邮箱。另外要按 IP、按收件邮箱、按全站做频率限制。
4. **接口不能变成替别人发信的工具。** 只要系统会给订单上的邮箱发确认信，信里出现的客户填写内容（姓名等）就不许带网址、域名、邮箱或标记（参考 `nameLooksUnsafe`），网页表单也要套同一个检查；同一个收件邮箱每天限几封。
5. **写操作只给服务器调用。** 下单、询价、MCP 三个接口：请求带了别的网站的 `Origin` 就返回 403，也不发跨域头。只读的目录和报价才开放 `Access-Control-Allow-Origin: *`。MCP 规范本身也要求校验 Origin。
6. **选择题优先。** 网页表单和接口字段都用选项或枚举；只有「定制」才给自由文本。
7. **不押注单一平台。** 只做 REST + OpenAPI + MCP（无状态 Streamable HTTP）+ llms.txt。
8. **上线前先给用户看；上线后只调只读接口和 MCP 握手，绝不发真实订单。** 用户要求实测写入时，只发标了「测试，请忽略」的单，并请用户去收件箱确认。

## 流程

### 0. 先摸清产品，讲给用户确认（不写代码）
读代码后，用中文、白话列给用户：
- 卖什么：服务或商品的目录，以及它们的代号来自哪里。
- **法律或业务红线**：网页上不能说、不能做的事（例如房产税工具可能受估价师法限制，不能给价值意见；某些产品不能承诺结果）。AI 接口必须守同样的红线，返回内容也不能越界。
- 价格怎么算：计价函数在哪个文件，哪些情况能即时出价，哪些要人工。
- 现在用户怎么下单：下单接口、组装订单和发邮件的函数，有没有现成的频率限制和防重复。
- 哪些字段现在是填空题，能改成选择题。
- 计划新增的文件和接口清单。

**等用户确认后再动手。** 每个产品不一样，别照搬 Shuttlely 的包车逻辑。

### 1. 只读：目录 + 报价
- 新建 `lib/agent-desk.ts`（或项目惯用的位置），放纯函数：`catalog(lang)`、`quote(input)`，返回 `{status, body}`，不依赖框架，方便测试。
- 报价：把结构化输入转成网站自己的请求格式，再交给**同一个解析/计价函数**。错误要具体（`unknown_*`、`invalid_*`、`written_quote_only`），并告诉调用方下一步该调哪个接口。
- 返回值里带一个人能打开核对的网址（网页上的同一份方案或报价页）。
- 路由：`GET /api/agent/catalog`（名字按产品取，例如 routes、regions、formats）、`POST /api/agent/quote`，开放跨域，只读接口可以缓存。

### 2. 写操作：下单 / 询价
- 先把网站现有下单流程里「组装订单」的那段抽成共用函数（例如 Shuttlely 的 `assembleOrder`）。网站和 AI 都调它，邮件模板也共用。
- `POST /api/agent/orders`：先查三道门，再重新算价，订单备注自动标 `[Booked through the agent API by <agentName>]`，然后发送。返回订单号、状态，以及一句「接下来会发生什么、现在没有扣款」。
- 不能即时成交的走 `POST /api/agent/inquiries`，进同一个询价收件箱，`source` 填 `agent-api`。
- 防重复：在内存里记 `requestId → 结果 Promise`，15 分钟内重发就返回同一个结果；失败的结果要清掉，允许重试。
- 频率限制参考：下单每个 IP 15 分钟 3 次、全站 10 次、每个收件邮箱每天 2 次；询价每个 IP 5 次、全站 30 次。超出返回 429 和 `Retry-After`。
- **内存计数只是兜底**：Serverless 平台（Vercel、Cloudflare）会同时开多个实例，各自计数。流量一大，就要换成共享存储（Vercel KV / Upstash / Cloudflare KV 或 Durable Objects），或者用平台防火墙的限流规则。汇报时要跟用户说明这一点。
- 网页表单原有的检查（来源、填写时间、蜜罐字段）在 AI 接口里没有，要靠上面这几条补上。

### 3. MCP
- 复制 `templates/mcp-handler.ts` 和 `templates/agent-http.ts`，改掉工具清单、`instructions` 和 `serverInfo`。
- `app/api/mcp/route.ts`（或对应框架的路由）：先做 Origin 检查，然后 POST 走 JSON-RPC；通知类消息返回 202；GET 返回 405；不发跨域头。
- 查工具名要用 `Object.hasOwn(tools, name)`，不能用 `name in tools`，否则 `constructor`、`toString` 这类内置名字也会被当成工具。
- 工具和 REST 一一对应。工具的输入 schema 从共用的 `lib/agent-schema.ts` 引用；OpenAPI 也从这里生成。
- 只读工具标 `readOnlyHint: true`，写入工具标 `idempotentHint: true`、`destructiveHint: false`。工具出错返回 `isError: true`，原因放进 `structuredContent`。
- 写入工具的 `requestId` 可以不传，服务器会生成；但调用方传了的话，以调用方的为准。

### 4. 公开说明
- `/openapi.json`：由 `lib/agent-schema.ts` 生成，force-static。
- `llms.txt`：写清楚接口和 MCP 的网址，每个接口给一个请求例子，并注明「不收款、需要用户同意、同一个 requestId 不会重复下单」。价格数字从价格表代码生成。
- 网页详情页和报价页要在服务器端渲染，结构化数据要齐全。

### 5. 选择题优先（网页表单）
按 `references/playbook.zh-CN.md` 原则 4：城市、项目、日期（加一个「还没定」选项）、数量（加减号）、附加需求（多选按钮），一律用选项。只有选了「定制」才出现文字框。联系方式只要一个必填邮箱，电话选填。

### 6. 测试与验收
测试至少覆盖下面几项（Shuttlely 的写法在 `tests/agent-api.test.mjs`）：
- 目录完整，接口报价 = 网页报价；
- 各种错误都有明确代码；
- 没有用户同意不能下单，同一个 requestId 不会重复下单，同编号不同内容返回 409，频率限制（IP、收件邮箱）生效；
- 带网址或邮箱的姓名被拒绝（网页和接口都要测）；
- 写接口遇到别的网站的 Origin 返回 403，不带 Origin 的服务器调用能正常通过；
- MCP 遇到 `constructor` / `toString` 这类工具名返回「未知工具」；
- 订单备注带上来源标记；
- MCP 的 initialize 能协商版本，通知返回 202（对应代码里返回 null），tools/list、tools/call 和 isError 都正确。

然后：
- 跑完整测试并构建；本地用 curl 调每个接口（本地没有邮件配置时，下单应返回 503「什么都没下单」）。
- 推到预览分支，**给用户看**，用户同意了才推主分支。
- 上线后用真实地址调目录、报价、MCP initialize 和 tools/list，**不发订单**。
- 把 `references/playbook.zh-CN.md` 第 3 部分贴进该项目的规则文件。**先确认这个文件不是自动生成的**：开头写着 "auto-generated"、有记忆或编排工具插进去的内容块，或者会被其他工具重写的，都算自动生成，贴进去会被覆盖。这种情况改贴到 `CLAUDE.md`，或者文件里明确不会被重写的段落。

## 换框架时要改的地方

模板是 Next.js App Router + Vercel 的写法，换框架时按下表对应：

| | 拿客户端 IP | 路由 | 内存计数 |
|---|---|---|---|
| Vercel（Next.js） | `x-real-ip` 请求头 | `app/api/**/route.ts` | 每个实例各算各的 |
| Cloudflare Worker | `CF-Connecting-IP` 请求头 | `fetch` 里按路径分发 | 每个 isolate 各算各的，用 KV 或 Durable Objects |
| Python FastAPI | 反向代理传过来的真实 IP（只信自己代理加的 `X-Forwarded-For` 最后一跳），否则用 `request.client.host` | `@app.post("/api/agent/...")` | 进程内存；多进程时用 Redis |

不管哪个框架，**都不能信调用方自己报的 IP 或来源**。

## 给用户的汇报
用中文、白话、简短：做了哪几步、线上实测了什么、哪些没验证（例如真实下单）、频率限制目前是内存兜底还是共享存储。最后给出其他 AI 接入的方法：

```bash
claude mcp add --transport http <name> https://<domain>/api/mcp
```
