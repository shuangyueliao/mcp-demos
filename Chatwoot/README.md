# chatwoot-mcp-bridge —— 把 Chatwoot 客服系统接进 Claude / 扣子的示范 MCP server

> **⚠️ 演示项目，非客户案例**：本目录是给「想把自家系统接上 AI agent」的团队看的**示范工程**，
> 不代表任何已发生的客户合作或交付记录。数据层内置的是**虚构演示数据**，不含任何真实客户信息。

> 定位：**示范/模板**。给想把自家 Chatwoot（国际开源自托管客服/全渠道对话系统，Ruby on Rails 技术栈）
> 变成 Claude Desktop、Claude Code、扣子（Coze）里「AI 可直接操作」的团队一个 30 分钟能跑通的起点。
> TypeScript + `@modelcontextprotocol/sdk`（v1.32.2），单进程，零数据库依赖；
> **默认运行在内置 mock 数据层上，不需要真实 Chatwoot 实例即可跑通全部 17 个工具**。

## 为什么是这个方向（一句话版）

Chatwoot 是出海企业常用的一类自托管客服系统（GitHub 主仓 `chatwoot/chatwoot` ⭐38,580、
最近推送 2026-10-29，均为 2026-10-30 GitHub API 实测；官方自我定位「Open-source live-chat, email support,
omni-channel desk」）。官方**产品内已有 AI 助手 Captain**（消费大模型做客服辅助的方向，官网可见）——
但「把 Chatwoot 系统本身作为 MCP server（Model Context Protocol 服务器，即让外部 AI 客户端可调用的一端）
暴露出去、让 Claude/扣子直接查会话、回消息、改状态」这条通道，在官方开发者文档
（developers.chatwoot.com，2026-10-30 实抓）与官方 MCP 注册表中均未见提供，第三方社区已有若干实现
（GitHub 检索 chatwoot+mcp 于 2026-10-30 命中 36 个第三方仓库，无官方第一方）——本 demo 补的是这条反向通道，
并且是**按客户系统定制交付**的模板：会话查询、消息收发、状态流转、打标签、指派，正是 AI agent 在客服场景里
最自然的写操作落地路径（社区版许可证为 MIT，enterprise/ 目录另有商业许可，2026-10-30 实测；
本 demo 仅经 REST 接口调用、不派生 Chatwoot 代码，不受影响）。

## 快速开始

```bash
npm install
npm run build          # tsc 编译到 dist/
```

**默认就是 mock 演示模式**（`CHATWOOT_MOCK=true`），上面两步跑完即可接入任何 MCP 客户端演示，
不需要安装或连任何真实 Chatwoot。

### 配置（环境变量）

| 变量 | 必填 | 说明 |
|---|---|---|
| `CHATWOOT_MOCK` | 默认 `true` | `true`=内置 mock 演示数据（开箱即跑）；`false`=连真实实例 |
| `CHATWOOT_BASE_URL` | 真实模式必填 | Chatwoot 根地址，如 `https://support.yourcompany.com`（**不含** `/api/v1` 后缀） |
| `CHATWOOT_API_ACCESS_TOKEN` | 真实模式必填 | 用户 API token：登录 Chatwoot → 个人资料设置（Profile Settings）→ 复制 API token |
| `CHATWOOT_ACCOUNT_ID` | 默认 `1` | 账号 ID（Chatwoot 每个账号有数字 ID，URL `/app/accounts/<数字>/` 可见） |
| `CHATWOOT_AUTH` | 默认 `header` | `header`=`api_access_token` 请求头（官方注明全版本可用、未来弃用）；`bearer`=`Authorization: Bearer`（官方注明 v4.19.0+ 可用） |
| `CHATWOOT_API_WHITELIST` | 可选 | `chatwoot_api` 通用桥接的放行清单（`METHOD:路径`，逗号分隔）。留空=默认只读白名单；`none`=禁用桥接 |
| `CHATWOOT_MCP_HTTP_PORT` | 默认 `3002` | `--http` 模式监听端口（刻意与 JeecgBoot demo 的 3001 错开，两个 demo 可同机并存） |

### 两种启动模式

```bash
# stdio（Claude Desktop / Claude Code 用）
node dist/index.js

# Streamable HTTP（扣子等需要 URL 的客户端用；会话模式）
node dist/index.js --http
```

想连真实实例：官方仓库根目录自带 `docker-compose.production.yaml`（chatwoot/chatwoot 主分支根目录，
2026-10-30 GitHub API 实测存在），`git clone` 后按官方自托管文档部署即可；官方云版（app.chatwoot.com）也可直接用。

## 内置的 17 个工具

每个端点都对照过官方材料核实（**2026-10-30 实抓**）：OpenAPI 规范
（`chatwoot/chatwoot` develop 分支 `swagger/tag_groups/application_swagger.json`，developers.chatwoot.com
各 API 页内嵌的同一份规范）+ Rails 源码（develop 分支，下表为源码文件与行号）。

| 工具 | 类型 | 端点 | 核实出处 |
|---|---|---|---|
| `chatwoot_list_conversations` | 查询 | `GET /api/v1/accounts/{account_id}/conversations`（status 默认 open；assignee_type/q/inbox_id/team_id/labels/page） | swagger；信封 `{data:{meta,payload}}` 见 `conversations/index.json.jbuilder` |
| `chatwoot_get_conversation` | 查询 | `GET .../conversations/{id}`（含标签、指派、最新消息） | swagger；`conversations/partials/_conversation.json.jbuilder` |
| `chatwoot_list_messages` | 查询 | `GET .../conversations/{id}/messages`（after ≤100 条 / before ≤20 条） | swagger 参数；信封见 `conversations/messages/index.json.jbuilder` |
| `chatwoot_send_message` | **写** | `POST .../conversations/{id}/messages`（content 必填；`private=true` 为内部备注不触达客户） | `messages_controller.rb:8`；消息体见 swagger `conversation_message_create_payload` |
| `chatwoot_set_conversation_status` | **写** | `POST .../conversations/{id}/toggle_status`（status 必填 open/resolved/pending/snoozed） | `conversations_controller.rb:83-89`；枚举见 swagger |
| `chatwoot_list_conversation_labels` | 查询 | `GET .../conversations/{id}/labels`（信封 `{payload:[名称]}`） | `conversations/labels/index.json.jbuilder` |
| `chatwoot_set_conversation_labels` | **写** | `POST .../conversations/{id}/labels`（**官方语义为整表覆盖**，工具描述与返回值均已标注） | `label_concern.rb` → `model.update_labels`；官方文档原注 "would overwrite" |
| `chatwoot_assign_conversation` | **写** | `POST .../conversations/{id}/assignments`（assigneeId 优先于 teamId） | `conversations/assignments_controller.rb:6-16` |
| `chatwoot_list_contacts` | 查询 | `GET /api/v1/accounts/{account_id}/contacts`（每页 15 条） | `contacts_controller.rb:12`（RESULTS_PER_PAGE=15） |
| `chatwoot_search_contacts` | 查询 | `GET .../contacts/search?q=`（姓名/邮箱/电话/标识符模糊匹配） | `contacts_controller.rb:39-46` |
| `chatwoot_create_contact` | **写** | `POST .../contacts`（源码中 inbox_id 可缺省，缺省时新建为 lead） | `contacts_controller.rb:85-93,165-175` |
| `chatwoot_update_contact` | **写** | `PUT .../contacts/{id}` | swagger（put 方法） |
| `chatwoot_list_inboxes` | 查询 | `GET .../inboxes`（信封 `{payload}`） | `inboxes/index.json.jbuilder` |
| `chatwoot_list_agents` | 查询 | `GET .../agents`（**裸数组**，含 role/availability_status） | `agents/index.json.jbuilder` |
| `chatwoot_list_teams` | 查询 | `GET .../teams`（裸数组） | `teams/index.json.jbuilder` |
| `chatwoot_set_agent_availability` | **写** | `PATCH .../agents/{id}`（请求体必须带 `agent` 根键且 role 必填——不传 role 时工具自动查现有角色沿用） | `agents_controller.rb:25-27,58,67`（`params.require(:agent)`） |
| `chatwoot_api` | 白名单桥 | 任意相对路径的 GET/POST/PUT/PATCH/DELETE，**必须命中白名单**（默认只放行只读查询；拒绝绝对 URL/协议相对路径防 SSRF） | 见下节 |

`chatwoot_api` 与 JeecgBoot demo 的裸通用桥不同：**默认白名单只放行 7 条只读查询路径**
（会话列表/详情/消息/标签、联系人列表/搜索、收件箱、座席、团队、profile），
要开放写路径需在 `CHATWOOT_API_WHITELIST` 显式追加 `METHOD:路径`——护栏是显式配置，不是默认放行。

## 3 分钟接入演示

### 版本 A：Claude Desktop（约 3 分钟，mock 模式无需任何实例）

1. 编辑配置文件（macOS：`~/Library/Application Support/Claude/claude_desktop_config.json`；Windows：`%APPDATA%\Claude\claude_desktop_config.json`）：

```json
{
  "mcpServers": {
    "chatwoot": {
      "command": "node",
      "args": ["/绝对路径/mcp-demos/Chatwoot/dist/index.js"],
      "env": { "CHATWOOT_MOCK": "true" }
    }
  }
}
```

2. 完全退出并重启 Claude Desktop，对话输入框右侧出现 🔨 工具图标即接入成功。
3. 逐句输入这三句（对应 查询 → 写 → 状态变更）：
   - 「看看现在有哪些待处理的客服会话」→ 触发 `chatwoot_list_conversations`
   - 「给会话 1 写一条内部备注：账单问题已升级到支付团队」→ 触发 `chatwoot_send_message`（private=true，可顺带讲清「对外回复会真实触达客户」这层护栏）
   - 「把会话 2 标记为已解决，并打上 shipping 和 urgent 标签」→ 触发 `chatwoot_set_conversation_status` + `chatwoot_set_conversation_labels`
4. 演示话术落点：**「你客服系统里的会话、消息、状态，AI 现在能直接读、直接改——这一步用的是 Chatwoot 官方的 Application API（应用接口），不需要改 Chatwoot 一行代码」**。

### 版本 B：Claude Code（约 3 分钟）

```bash
cd /绝对路径/mcp-demos/Chatwoot
claude mcp add chatwoot \
  -e CHATWOOT_MOCK=true \
  -- node "$(pwd)/dist/index.js"

claude mcp list        # 应看到 chatwoot ✓ connected
```

然后在 Claude Code 里直接说：
- 「搜一下邮箱带 acme 的联系人，把ta的 plan 属性改成 enterprise」→ `chatwoot_search_contacts` + `chatwoot_update_contact`
- 「把 Leo 的座席状态改成 offline」→ `chatwoot_set_agent_availability`
（也可在会话内 `/mcp` 查看工具与调用状态。）

### 版本 C：扣子 coze.cn（约 3 分钟，需要公网可达的 URL）

1. 起本地 HTTP 模式：`CHATWOOT_MOCK=true node dist/index.js --http` → 监听 `http://localhost:3002/mcp`。
2. 让它公网可达（内网穿透任选其一）：`ngrok http 3002` / frp / 你自己的反向代理，得到类似 `https://xxx.ngrok.app/mcp`。
3. 扣子编辑器 → 智能体 → 技能/插件区 → **添加 MCP 服务** → 粘贴公网 URL → 获取工具列表
   （入口名称随版本迭代可能略有差异，认准"MCP"即可；扣子支持 Streamable HTTP）。
4. 在调试窗口逐句试：「列一下当前的客服会话」「把会话 1 指派给 Ava，再打上 billing 标签」→ 会触发 `chatwoot_assign_conversation` + `chatwoot_set_conversation_labels`。
5. 注意：**不要把无鉴权的 MCP 地址长期暴露公网**——本 demo 的 HTTP 端点没有自带鉴权，演示完就关（生产化清单第 6 条）。

## 本机验证情况（如实记录）

验证环境：node v22.23.1 / npm 10.9.8（macOS，2026-10-30 实跑）。

```bash
npm run smoke   # 真实 MCP 客户端经 stdio 连接 → initialize + tools/list → 17 个工具齐全     ✅ PASS（exit 0）
npm run e2e     # 三段端到端断言，共 50 项                                                    ✅ 50/50 PASS（exit 0）
```

- `npm run smoke`：任务要求的最小验证（server 能列出 tools），用官方 SDK 客户端真实走完 stdio 握手。
- `npm run e2e` 三段（`scripts/e2e.mjs`）：
  - **A 段（32 项）**：内置 mock 数据层 + stdio——17 个工具逐个读写往返：会话列表过滤/信封、详情、
    消息历史、发内部备注与对外回复后再读验证、状态 resolved→open 往返、标签先读后写与覆盖语义、
    指派（assigneeId 优先语义）、联系人搜索/创建/重复邮箱 422/更新、收件箱、座席、团队、
    可用性变更（role 自动沿用）、白名单桥放行/拒绝、绝对 URL 与协议相对路径的 SSRF 拒绝；
  - **B 段（14 项）**：`CHATWOOT_MOCK=false` + 指向 `scripts/mock-chatwoot-api.mjs`（按官方 swagger + 源码
    形态实现的 mock Chatwoot HTTP server）——验证**真实 REST 客户端代码路径**：路径拼接、
    `api_access_token` 请求头、错误 token → 401 与排查提示、`agent` 根键 PATCH、各资源信封解析、404；
  - **C 段（3 项）**：`--http` 会话模式（扣子接入路径）经 Streamable HTTP 列工具并读写往返。
- 另以裸 curl 实测了 HTTP 模式手工流程（initialize 取会话 ID → tools/list 返回 17 个工具 →
  tools/call 返回会话数据；注意响应为 SSE（Server-Sent Events，服务器推送事件）流，
  JSON 在 `data:` 行内，直接 `json.load` 整个响应会解析失败）。
- **边界**：以上验证均基于内置 mock 数据层与按官方规范实现的 mock HTTP server；
  本次未连真实 Chatwoot 实例（沙箱内未部署）。端点、参数名、请求体根键（`agent`）、
  响应信封形状均逐一对照官方 swagger 与 develop 分支源码核实（出处见工具表），
  但真实实例的行为差异（角色权限拦截、渠道类型差异、云版与自托管版本差）请按下表自测。
- 连真实实例的自测三步：① `CHATWOOT_MOCK=false CHATWOOT_BASE_URL=… CHATWOOT_API_ACCESS_TOKEN=… npm run smoke`
  确认管道；② Claude Desktop 里说「列出待处理会话」；③ 任选一个 demo 未内置的端点（如团队详情）用
  `chatwoot_api` 调一次验证白名单桥。

## 把这个 demo 变成你的生产封装还差什么（交付清单）

1. **token 权限模型**：`CHATWOOT_API_ACCESS_TOKEN` 是某个真人座席的 token，等于把该账号的全部界面权限交给 AI
   （与界面一致：修改座席角色/可用性等操作需要 administrator 角色）。生产应建专用集成账号 + 最小权限角色。
2. **token 生命周期与鉴权头版本差**：token 泄露即等于客服账号泄露，需要轮换/撤销流程；
   `api_access_token` 头官方已注明未来弃用，`Authorization: Bearer` 需 v4.19.0+——
   自托管版本差异要写进交付文档（`CHATWOOT_AUTH` 已留切换开关）。
3. **对外回复的二次确认与触达护栏**：`chatwoot_send_message` 的 outgoing 消息会**真实发给客户**。
   生产封装应做：默认 private 备注、敏感操作（对外回复/状态批量变更）人工确认步骤、
   高峰限流、以及「AI 起草 + 人工审核发送」的双档模式——这是客服场景区别于内部系统的核心风险点。
4. **标签覆盖语义的合并策略**：官方 `POST /labels` 是整表覆盖。生产封装应封装成「先读后合并」，
   避免并发座席与 AI 互相覆盖标签（demo 已在读工具描述与返回值里显式提示，仍未做自动合并）。
5. **审计与追溯**：谁、何时、让 AI 改了哪个会话/联系人。Chatwoot 的审计日志（audit logs）属 Enterprise
   功能，社区版需自建审计表或对接外部日志——交付时作为独立工作量报价。
6. **HTTP 端点鉴权与会话治理**：`--http` 模式现无任何鉴权（扣子场景必须挂在你自己的带鉴权反代后面），
   会话 Map 无 TTL 清理（内存泄漏），无并发限制。这三点不解决不能上公网。
7. **白名单产品化**：`CHATWOOT_API_WHITELIST` 现在是环境变量字符串。生产应改为配置文件 + 只读开关 +
   字段级脱敏（客户手机号/邮箱），并按客户业务模块逐条评审放行清单。
8. **幂等与限速**：AI 重试可能导致重复回复客户；需幂等键、超时预算、以及 Chatwoot 侧的发送速率约束。
9. **契约测试**：mock 与真实实例的偏差（角色权限拦截行为、渠道差异、版本间字段增减）要用客户的真实环境
   跑一遍契约测试再交付。
10. **多账号/多实例**：一个 Chatwoot 常有多个 account（多品牌客服）。`CHATWOOT_ACCOUNT_ID` 现在是静态配置，
    生产要按调用方动态注入；集团多套实例需要多 server 注册或路由层。

## 目录结构

```
mcp-demos/Chatwoot/
├── src/
│   ├── index.ts      # 入口：stdio / --http（会话模式）
│   ├── config.ts     # 环境变量（mock/api 双模式、鉴权头格式、白名单）
│   ├── chatwoot.ts   # Application API HTTP 客户端：api_access_token/Bearer、401/403/404 提示、防 SSRF
│   ├── store.ts      # 数据层接口 + ApiStore（真实模式，含 agent 根键等源码级细节）
│   ├── mock.ts       # 内置 mock 演示数据层（与真实接口同构的信封，写操作真实改内存数据）
│   └── tools.ts      # 17 个工具（含端点→官方 swagger/源码行号对照注释）+ 白名单桥
├── scripts/
│   ├── mock-chatwoot-api.mjs  # 按官方规范实现的 mock Chatwoot HTTP server（校验 token 值/agent 根键）
│   ├── smoke.mjs              # 最小验证：MCP 客户端列出 17 个 tools
│   └── e2e.mjs                # 50 项端到端断言（mock 层 / API 模式 / HTTP 会话模式 三段）
├── package.json / tsconfig.json / .env.example / .gitignore
```

---

**再次声明：本目录为演示项目，非客户案例。** 文中所有数字均为 2026-10-30 实测值并标注日期；
不含任何客户案例、用户量或收入表述。本 demo 许可证 MIT，允许商用与二次集成。
