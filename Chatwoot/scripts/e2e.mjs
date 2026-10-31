/**
 * 端到端验证（三段，全部经真实 MCP 客户端）。⚠️ 演示项目，非客户案例。
 *
 * A. stdio + 内置 mock 数据层（CHATWOOT_MOCK=true，默认）：
 *    逐个调用 17 个工具，断言数据真实往返（读 → 写 → 再读）+ 安全护栏；
 * B. stdio + API 模式（CHATWOOT_MOCK=false，指向本目录 mock-chatwoot-api.mjs）：
 *    验证真实 REST 客户端代码路径（路径拼接、api_access_token 头、agent 根键、信封解析、401）；
 * C. --http 会话模式（扣子接入路径）：Streamable HTTP 连接 → 列工具 → 调用。
 *
 * 运行：npm run e2e
 * 边界：A/C 基于内置 mock 数据层；B 基于「按官方 swagger+源码形态实现的 mock Chatwoot HTTP server」，
 * 均未连真实 Chatwoot 实例。
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { createMockChatwootApi } from "./mock-chatwoot-api.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const MOCK_API_PORT = 18091;
const HTTP_PORT = 18092;

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.error(`  FAIL  ${name} ${detail}`);
  }
}

const parseText = (res) => JSON.parse(res.content[0].text);

// ═══════════════════════ A. 内置 mock 数据层（默认模式）═════════════════════
console.log("═══ A. stdio + 内置 mock 数据层 ═══");
{
  const env = { ...process.env, CHATWOOT_MOCK: "true" };
  const transport = new StdioClientTransport({ command: "node", args: [join(root, "dist", "index.js")], env });
  const client = new Client({ name: "e2e-mock", version: "0.0.1" });
  await client.connect(transport);

  try {
    const { tools } = await client.listTools();
    check("A0 tools/list 返回 17 个工具", tools.length === 17, `实际 ${tools.length}`);

    // 会话列表
    let res = await client.callTool({ name: "chatwoot_list_conversations", arguments: {} });
    let out = parseText(res);
    check("A1 会话列表默认 status=open，meta 计数与 payload 同构", res.isError !== true &&
      out.data.meta.all_count === 2 &&
      out.data.payload.length === 2 &&
      out.data.payload.every((c) => c.status === "open"), JSON.stringify(out).slice(0, 160));
    check("A2 会话对象含官方 partial 字段（labels/status/assignee/meta.sender）",
      Array.isArray(out.data.payload[0].labels) && typeof out.data.payload[0].status === "string" &&
      out.data.payload[0].meta && "sender" in out.data.payload[0].meta, JSON.stringify(out.data.payload[0]).slice(0, 200));

    res = await client.callTool({ name: "chatwoot_list_conversations", arguments: { status: "all", assigneeType: "unassigned" } });
    out = parseText(res);
    check("A3 status=all + assigneeType=unassigned 过滤生效", out.data.payload.every((c) => c.meta.assignee === undefined), JSON.stringify(out.data.meta));

    // 会话详情 + 消息历史
    res = await client.callTool({ name: "chatwoot_get_conversation", arguments: { conversationId: 1 } });
    out = parseText(res);
    check("A4 会话详情返回 labels=billing,payment 与 meta.sender", Array.isArray(out.labels) && out.labels.includes("billing") && out.meta.sender?.id === 1, res.content[0].text.slice(0, 150));

    res = await client.callTool({ name: "chatwoot_list_messages", arguments: { conversationId: 1 } });
    out = parseText(res);
    check("A5 消息历史信封 {meta,payload} 且含客户来信与座席回复", res.isError !== true && out.payload.length === 2 && out.payload[0].message_type === 0 && out.payload[1].message_type === 1, res.content[0].text.slice(0, 150));

    res = await client.callTool({ name: "chatwoot_get_conversation", arguments: { conversationId: 999 } });
    check("A6 不存在的会话返回 404 提示", res.isError === true && /404/.test(res.content[0].text), res.content[0].text.slice(0, 120));

    // 发消息：内部备注（private）与对外回复
    res = await client.callTool({ name: "chatwoot_send_message", arguments: { conversationId: 1, content: "内部备注：查一下支付网关", private: true } });
    out = parseText(res);
    check("A7 发内部备注成功且 message.private=true", res.isError !== true && out.message.private === true && out.message.message_type === 1, res.content[0].text.slice(0, 150));
    res = await client.callTool({ name: "chatwoot_send_message", arguments: { conversationId: 1, content: "Oliver 你好，我们已经核实账单问题" } });
    out = parseText(res);
    check("A8 默认 message_type=outgoing 对外回复", res.isError !== true && out.message.message_type === 1 && out.message.private === false, res.content[0].text.slice(0, 150));
    res = await client.callTool({ name: "chatwoot_list_messages", arguments: { conversationId: 1 } });
    out = parseText(res);
    check("A9 再读消息历史能看到刚发的两条", out.payload.length === 4, `实际 ${out.payload.length}`);

    // 状态变更
    res = await client.callTool({ name: "chatwoot_set_conversation_status", arguments: { conversationId: 1, status: "resolved" } });
    out = parseText(res);
    check("A10 会话置为 resolved", res.isError !== true && out.conversation.status === "resolved", res.content[0].text.slice(0, 120));
    res = await client.callTool({ name: "chatwoot_list_conversations", arguments: { status: "resolved" } });
    out = parseText(res);
    check("A11 resolved 列表能看到该会话", out.data.payload.some((c) => c.id === 1), JSON.stringify(out.data.meta));
    res = await client.callTool({ name: "chatwoot_set_conversation_status", arguments: { conversationId: 1, status: "open" } });
    check("A12 会话重开为 open", res.isError !== true && parseText(res).conversation.status === "open", res.content[0].text.slice(0, 120));

    // 标签：先读后写（整表覆盖语义）
    res = await client.callTool({ name: "chatwoot_list_conversation_labels", arguments: { conversationId: 2 } });
    check("A13 会话 2 初始标签为演示种子 shipping", res.isError !== true && JSON.parse(res.content[0].text).payload.join() === "shipping", res.content[0].text.slice(0, 120));
    res = await client.callTool({ name: "chatwoot_set_conversation_labels", arguments: { conversationId: 2, labels: ["shipping", "urgent"] } });
    out = parseText(res);
    check("A14 打标签成功（两个标签）", res.isError !== true && out.labels.payload.length === 2, res.content[0].text.slice(0, 120));
    res = await client.callTool({ name: "chatwoot_set_conversation_labels", arguments: { conversationId: 2, labels: ["shipping"] } });
    check("A15 覆盖语义生效（重写为单标签）", parseText(res).labels.payload.length === 1, res.content[0].text.slice(0, 120));

    // 指派
    res = await client.callTool({ name: "chatwoot_assign_conversation", arguments: { conversationId: 2, assigneeId: 2, teamId: 1 } });
    out = parseText(res);
    check("A16 assigneeId 优先：返回座席对象", res.isError !== true && out.assigned?.id === 2 && out.assigned?.role !== undefined, res.content[0].text.slice(0, 150));
    res = await client.callTool({ name: "chatwoot_list_conversations", arguments: { assigneeType: "me" } });
    out = parseText(res);
    // mock 中 me = 座席 1；会话 2 被指派给了座席 2，不应出现
    check("A17 指派后 assigneeType=me 列表不含会话 2", res.isError !== true && !out.data.payload.some((c) => c.id === 2), JSON.stringify(out.data.meta));

    // 联系人
    res = await client.callTool({ name: "chatwoot_list_contacts", arguments: {} });
    out = parseText(res);
    check("A18 联系人列表信封 {meta:{count,current_page},payload}", res.isError !== true && out.meta.current_page === 1 && out.payload.length === 3, res.content[0].text.slice(0, 150));
    res = await client.callTool({ name: "chatwoot_search_contacts", arguments: { q: "oliver" } });
    out = parseText(res);
    check("A19 搜索命中 Oliver", out.payload.length === 1 && out.payload[0].id === 1, res.content[0].text.slice(0, 150));
    res = await client.callTool({ name: "chatwoot_create_contact", arguments: { name: "New Lead", email: "lead@newco.example.com", phoneNumber: "+8613800000000", inboxId: 1 } });
    out = parseText(res);
    check("A20 创建联系人成功且带 contact_inboxes", res.isError !== true && out.contact.id > 3 && out.contact.contact_inboxes.length === 1, res.content[0].text.slice(0, 150));
    res = await client.callTool({ name: "chatwoot_create_contact", arguments: { email: "lead@newco.example.com" } });
    check("A21 重复邮箱被拒（422）", res.isError === true && /422|已经被使用/.test(res.content[0].text), res.content[0].text.slice(0, 120));
    res = await client.callTool({ name: "chatwoot_update_contact", arguments: { contactId: 1, name: "Oliver S.", customAttributes: { plan: "enterprise" } } });
    out = parseText(res);
    check("A22 更新联系人生效（姓名+自定义属性合并）", res.isError !== true && out.contact.name === "Oliver S." && out.contact.custom_attributes.plan === "enterprise", res.content[0].text.slice(0, 150));

    // 收件箱 / 座席 / 团队
    res = await client.callTool({ name: "chatwoot_list_inboxes", arguments: {} });
    out = parseText(res);
    check("A23 收件箱列表 {payload:[…]} 3 个渠道", res.isError !== true && out.payload.length === 3 && out.payload[0].channel_type === "Channel::WebWidget", res.content[0].text.slice(0, 150));
    res = await client.callTool({ name: "chatwoot_list_agents", arguments: {} });
    out = parseText(res);
    check("A24 座席列表为裸数组且含 availability_status/role", Array.isArray(out) && out.length === 3 && "availability_status" in out[0] && "role" in out[0], res.content[0].text.slice(0, 150));
    res = await client.callTool({ name: "chatwoot_list_teams", arguments: {} });
    out = parseText(res);
    check("A25 团队列表为裸数组 2 个", Array.isArray(out) && out.length === 2, res.content[0].text.slice(0, 120));

    // 座席可用性（不提供 role → 自动沿用现有角色）
    res = await client.callTool({ name: "chatwoot_set_agent_availability", arguments: { agentId: 2, availability: "offline" } });
    out = parseText(res);
    check("A26 置 offline 成功且 role 自动沿用为 agent", res.isError !== true && out.agent.availability_status === "offline" && out.agent.role === "agent", res.content[0].text.slice(0, 150));
    res = await client.callTool({ name: "chatwoot_set_agent_availability", arguments: { agentId: 2, availability: "online" } });
    check("A27 置回 online 成功", parseText(res).agent.availability_status === "online", res.content[0].text.slice(0, 120));

    // 通用桥接：白名单内放行、白名单外拒绝、SSRF 拒绝
    res = await client.callTool({ name: "chatwoot_api", arguments: { method: "GET", path: "/api/v1/accounts/{account_id}/teams" } });
    check("A28 白名单内路径（{account_id} 占位符）转发成功", res.isError !== true && Array.isArray(JSON.parse(res.content[0].text)) && JSON.parse(res.content[0].text).length === 2, res.content[0].text.slice(0, 150));
    res = await client.callTool({ name: "chatwoot_api", arguments: { method: "DELETE", path: "/api/v1/accounts/1/contacts/1" } });
    check("A29 白名单外方法被拒绝", res.isError === true && /白名单/.test(res.content[0].text), res.content[0].text.slice(0, 160));
    res = await client.callTool({ name: "chatwoot_api", arguments: { method: "POST", path: "/api/v1/accounts/1/conversations/1/messages", body: { content: "x" } } });
    check("A30 默认白名单拒绝写路径（POST messages）", res.isError === true && /白名单/.test(res.content[0].text), res.content[0].text.slice(0, 160));
    res = await client.callTool({ name: "chatwoot_api", arguments: { method: "GET", path: "https://evil.example.com/api/v1/profile" } });
    check("A31 拒绝绝对 URL（防 SSRF）", res.isError === true, res.content[0].text.slice(0, 120));
    res = await client.callTool({ name: "chatwoot_api", arguments: { method: "GET", path: "//evil.example.com/api/v1/profile" } });
    check("A32 拒绝协议相对路径（防 SSRF）", res.isError === true, res.content[0].text.slice(0, 120));
  } finally {
    await client.close();
  }
}

// ═══════════════════════ B. API 模式（真实 HTTP 客户端路径）══════════════════
console.log("\n═══ B. stdio + API 模式（mock Chatwoot HTTP server）═══");
{
  const mockApi = createMockChatwootApi(MOCK_API_PORT, "1");
  await new Promise((r) => setTimeout(r, 200));

  // B 前置：错误 token → 401 提示
  {
    const env = {
      ...process.env,
      CHATWOOT_MOCK: "false",
      CHATWOOT_BASE_URL: `http://127.0.0.1:${MOCK_API_PORT}`,
      CHATWOOT_API_ACCESS_TOKEN: "wrong-token",
    };
    const transport = new StdioClientTransport({ command: "node", args: [join(root, "dist", "index.js")], env });
    const client = new Client({ name: "e2e-api-badtoken", version: "0.0.1" });
    await client.connect(transport);
    const res = await client.callTool({ name: "chatwoot_list_conversations", arguments: {} });
    check("B0 错误 token 返回 401 与排查提示", res.isError === true && /401/.test(res.content[0].text) && /CHATWOOT_API_ACCESS_TOKEN/.test(res.content[0].text), res.content[0].text.slice(0, 160));
    await client.close();
  }

  const env = {
    ...process.env,
    CHATWOOT_MOCK: "false",
    CHATWOOT_BASE_URL: `http://127.0.0.1:${MOCK_API_PORT}`,
    CHATWOOT_API_ACCESS_TOKEN: "mock-user-token",
    CHATWOOT_ACCOUNT_ID: "1",
  };
  const transport = new StdioClientTransport({ command: "node", args: [join(root, "dist", "index.js")], env });
  const client = new Client({ name: "e2e-api", version: "0.0.1" });
  await client.connect(transport);

  try {
    let res = await client.callTool({ name: "chatwoot_list_conversations", arguments: {} });
    let out = parseText(res);
    // mock HTTP server 种子：会话 1 open、会话 2 pending → 默认 status=open 只含会话 1
    check("B1 API 模式会话列表信封 {data:{meta,payload}}（默认 open=1 条）", res.isError !== true && out.data.meta.all_count === 1, res.content[0].text.slice(0, 150));

    res = await client.callTool({ name: "chatwoot_get_conversation", arguments: { conversationId: 1 } });
    out = parseText(res);
    check("B2 会话详情（labels=billing）", res.isError !== true && Array.isArray(out.labels) && out.labels[0] === "billing", res.content[0].text.slice(0, 150));

    res = await client.callTool({ name: "chatwoot_list_messages", arguments: { conversationId: 1 } });
    out = parseText(res);
    check("B3 消息历史 {meta,payload}", res.isError !== true && out.payload.length === 1, res.content[0].text.slice(0, 120));

    res = await client.callTool({ name: "chatwoot_send_message", arguments: { conversationId: 1, content: "mock 回复：已核实账单", private: false } });
    out = parseText(res);
    check("B4 发消息往返（POST /messages）", res.isError !== true && out.message.content === "mock 回复：已核实账单", res.content[0].text.slice(0, 150));

    res = await client.callTool({ name: "chatwoot_set_conversation_status", arguments: { conversationId: 1, status: "resolved" } });
    check("B5 toggle_status（POST /toggle_status）", res.isError !== true && parseText(res).conversation.status === "resolved", res.content[0].text.slice(0, 120));

    res = await client.callTool({ name: "chatwoot_set_conversation_labels", arguments: { conversationId: 1, labels: ["billing", "checked"] } });
    check("B6 打标签（POST /labels 整表覆盖）", res.isError !== true && JSON.parse(res.content[0].text).labels.payload.length === 2, res.content[0].text.slice(0, 120));

    res = await client.callTool({ name: "chatwoot_assign_conversation", arguments: { conversationId: 1, assigneeId: 1 } });
    check("B7 指派座席（POST /assignments）", res.isError !== true && parseText(res).assigned?.id === 1, res.content[0].text.slice(0, 120));

    res = await client.callTool({ name: "chatwoot_create_contact", arguments: { name: "API Lead", email: "lead2@newco.example.com", inboxId: 2 } });
    check("B8 创建联系人（POST /contacts）", res.isError !== true && JSON.parse(res.content[0].text).contact.email === "lead2@newco.example.com", res.content[0].text.slice(0, 120));

    res = await client.callTool({ name: "chatwoot_update_contact", arguments: { contactId: 1, name: "Oliver S." } });
    check("B9 更新联系人（PUT /contacts/{id}）", res.isError !== true && parseText(res).contact.name === "Oliver S.", res.content[0].text.slice(0, 120));

    res = await client.callTool({ name: "chatwoot_set_agent_availability", arguments: { agentId: 2, availability: "offline" } });
    out = parseText(res);
    check("B10 座席可用性（PATCH /agents/{id}，agent 根键 + role 自动沿用）", res.isError !== true && out.agent.availability_status === "offline" && out.agent.role === "agent", res.content[0].text.slice(0, 150));

    res = await client.callTool({ name: "chatwoot_list_inboxes", arguments: {} });
    check("B11 收件箱 {payload:[…]}", res.isError !== true && JSON.parse(res.content[0].text).payload.length === 2, res.content[0].text.slice(0, 120));

    res = await client.callTool({ name: "chatwoot_api", arguments: { method: "GET", path: "/api/v1/accounts/{account_id}/teams" } });
    check("B12 桥接白名单内 GET /teams", res.isError !== true && Array.isArray(JSON.parse(res.content[0].text)) && JSON.parse(res.content[0].text).length === 2, res.content[0].text.slice(0, 120));

    res = await client.callTool({ name: "chatwoot_get_conversation", arguments: { conversationId: 12345 } });
    check("B13 不存在资源返回 404 提示", res.isError === true && /404/.test(res.content[0].text), res.content[0].text.slice(0, 120));
  } finally {
    await client.close();
    mockApi.server.close();
  }
}

// ═══════════════════════ C. --http 会话模式（扣子接入路径）══════════════════
console.log(`\n═══ C. --http 会话模式 :${HTTP_PORT} ═══`);
{
  const httpEnv = { ...process.env, CHATWOOT_MOCK: "true", CHATWOOT_MCP_HTTP_PORT: String(HTTP_PORT) };
  const httpProc = spawn("node", [join(root, "dist", "index.js"), "--http"], { env: httpEnv, stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((resolve, reject) => {
    httpProc.stderr.on("data", (d) => {
      if (String(d).includes("HTTP 模式已启动")) resolve();
    });
    httpProc.on("exit", (code) => reject(new Error(`--http 进程提前退出（${code}）`)));
    setTimeout(() => resolve(), 3000);
  });

  try {
    const client2 = new Client({ name: "e2e-http", version: "0.0.1" });
    await client2.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${HTTP_PORT}/mcp`)));
    const { tools } = await client2.listTools();
    check("C1 HTTP 模式 tools/list 返回 17 个工具", tools.length === 17, `实际 ${tools.length}`);
    let r = await client2.callTool({ name: "chatwoot_list_conversations", arguments: {} });
    check("C2 HTTP 模式工具调用往返成功", r.isError !== true && JSON.parse(r.content[0].text).data.meta.all_count === 2, r.content[0].text.slice(0, 120));
    r = await client2.callTool({ name: "chatwoot_set_conversation_status", arguments: { conversationId: 1, status: "pending" } });
    check("C3 HTTP 模式写操作往返成功", r.isError !== true && JSON.parse(r.content[0].text).conversation.status === "pending", r.content[0].text.slice(0, 120));
    await client2.close();
  } finally {
    httpProc.kill();
  }
}

console.log(`\n===== e2e 结果：${passed} 通过，${failed} 失败 =====`);
process.exit(failed > 0 ? 1 : 0);
