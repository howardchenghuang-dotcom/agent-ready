# 参考实现：Shuttlely.ca

> 中文版。英文版 [shuttlely-reference.md](shuttlely-reference.md) 为准。

Shuttlely 的代码在私有仓库里。这一页按文件说明它的设计，方便在别的项目照着做一遍。2026-10-28 第一版上线，当天做了安全复查和修复，修了什么写在最后。

| 文件 | 作用 |
|---|---|
| `lib/agent-desk.ts` | 核心：`routeCatalog`、`quote`、`order`、`inquiry`，返回 `{status, body}`，不依赖框架 |
| `lib/agent-schema.ts` | 共用 JSON Schema：trip、traveller、order、inquiry；MCP 工具和 OpenAPI 都引用它 |
| `lib/agent-mcp.ts` | MCP 的 JSON-RPC 处理（本技能 `templates/mcp-handler.ts` 就是从这里抽出来的） |
| `lib/agent-http.ts` | 读取 JSON、拿客户端 IP、只读接口的跨域头、写接口的 Origin 检查（`foreignOrigin`） |
| `lib/contact-name.ts` | `nameLooksUnsafe`：姓名里不许带网址、域名、邮箱；网页表单和接口共用 |
| `lib/order-handler.ts` → `assembleOrder()` | 从网站下单流程里抽出来的共用函数，网站和 AI 都调它 |
| `app/api/agent/{routes,quote,orders,inquiries}/route.ts` | REST 接口的外壳，各 10 行左右 |
| `app/api/mcp/route.ts` | MCP 接入点 |
| `app/openapi.json/route.ts` | 从共用 schema 生成 OpenAPI 3.1 |
| `lib/agent-booking.ts` → `llms.txt` | 给 AI 读的说明，数字从价格表生成 |
| `components/inquiry-panel.tsx` | 选择题优先的询价表单（人用） |
| `tests/agent-api.test.mjs` | 13 条测试：目录、报价一致、错误、同意、防重复、409、IP 和邮箱限流、询价、MCP、内置工具名、姓名带网址、Origin |

## 几个关键做法

- **报价复用计价函数**：把 AI 传来的 JSON 转成网页的方案链接参数（`t=…&d=…&g=…&v=…`），再交给 `planFromQuery`。网页、方案页、下单接口都用这同一个解析器，价格不可能对不上。
- **按地区分流**：多伦多以外的线路调 `quote` 时返回 422 `written_quote_only`，并告诉 AI 改调 `request_quote`。
- **订单号**：`SL-YYMMDD-XXXX` 由 requestId 算出来，同一个 id 永远得到同一个订单号。
- **测试加载方式**：`.mjs` 测试用 `typescript.transpileModule` 加 `vm` 加载 TS 模块，`@/` 路径手动解析。注意：沙箱里建出的数组不能直接 `deepEqual`，先用 `Array.from()` 转一下。
- **踩过的坑**：项目里原本就有同名变量（`setDeparture` 是送机的状态），导入共用 store 时要改名；预览网址不在来源白名单里，发不出询价，这是正常的。

## 安全复查发现的问题（已修复；新项目一开始就要做对）

1. **确认信被用来发垃圾邮件**：确认信发到订单上的邮箱，开头写着客户填的姓名。AI 接口又没有网页表单那几道防机器人的检查，任何人都能借 shuttlely.ca 给陌生人发信。修法：姓名检查 + 每个收件邮箱每天上限 + 调低全站上限。
2. **写接口开了跨域**：别的网站的网页能借访客的浏览器下单，还能绕过「每个 IP」的限制。修法：写接口和 MCP 拒绝别的网站的 Origin，也不发跨域头。
3. **MCP 用 `name in tools` 查工具**：`constructor` 这类内置名字也会被当成工具。修法：改用 `Object.hasOwn`。
4. **同一个 requestId 配不同内容**：原来会悄悄返回第一次的结果。修法：改为返回 409。
5. **内存计数**：在多实例平台上只能算兜底。
