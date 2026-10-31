/**
 * Mock Chatwoot Application API（应用接口）—— 仅供 e2e 验证「真实 HTTP 客户端代码路径」。
 * ⚠️ 演示项目，非客户案例。
 *
 * 模拟的端点、鉴权与响应信封均对照官方材料实现（2026-10-30 实抓，出处见 src/chatwoot.ts 头注释）：
 * - 无 api_access_token 请求头 → HTTP 401（官方 securitySchemes；401 形状按常见返回 {"error":"Unauthorized"}）
 * - GET  /api/v1/accounts/:accountId/conversations        → {data:{meta,payload}}（conversations/index.json.jbuilder）
 * - GET  /api/v1/accounts/:accountId/conversations/:id    → 会话对象（conversation partial）
 * - GET/POST /api/v1/accounts/:accountId/conversations/:id/messages
 * - POST /api/v1/accounts/:accountId/conversations/:id/toggle_status
 * - GET/POST /api/v1/accounts/:accountId/conversations/:id/labels → {payload:[…]}
 * - POST /api/v1/accounts/:accountId/conversations/:id/assignments
 * - GET/POST /api/v1/accounts/:accountId/contacts、GET /contacts/search、PUT /contacts/:id → {meta,payload}
 * - GET  /api/v1/accounts/:accountId/inboxes              → {payload:[…]}
 * - GET  /api/v1/accounts/:accountId/agents               → 裸数组
 * - PATCH /api/v1/accounts/:accountId/agents/:id          → 必须带 agent 根键（agents_controller.rb:67
 *   params.require(:agent)），否则返回 HTTP 400 "param is missing or the value is empty: agent"
 * - GET  /api/v1/accounts/:accountId/teams                → 裸数组
 * - GET  /api/v1/profile
 */
import { createServer } from "node:http";

export function createMockChatwootApi(port = 18091, accountId = "1", validToken = "mock-user-token") {
  let nextId = 100;
  const conversations = new Map([
    [1, { id: 1, inbox_id: 1, contact_id: 1, status: "open", labels: ["billing"], assignee_id: null, team_id: null, uuid: "mock-conv-1" }],
    [2, { id: 2, inbox_id: 2, contact_id: 2, status: "pending", labels: [], assignee_id: 1, team_id: null, uuid: "mock-conv-2" }],
  ]);
  const messages = new Map([
    [1, [{ id: 11, conversation_id: 1, inbox_id: 1, content: "mock: 账单有问题", message_type: 0, private: false, created_at: 1769904000 }]],
    [2, [{ id: 21, conversation_id: 2, inbox_id: 2, content: "mock: 换个收货地址", message_type: 0, private: false, created_at: 1769904100 }]],
  ]);
  const contacts = new Map([
    [
      1,
      {
        id: 1,
        name: "Oliver Smith",
        email: "oliver@acme-corp.example.com",
        phone_number: "+14155550001",
        identifier: "acme-oliver",
        additional_attributes: {},
        custom_attributes: {},
        created_at: 1769904000,
        last_activity_at: 1769904100,
        contact_inboxes: [],
      },
    ],
  ]);
  const agents = [
    { id: 1, account_id: Number(accountId), availability_status: "online", auto_offline: true, confirmed: true, email: "ava@demo.example.com", provider: "email", available_name: "Ava Chen", name: "Ava Chen", role: "administrator", thumbnail: "" },
    { id: 2, account_id: Number(accountId), availability_status: "busy", auto_offline: true, confirmed: true, email: "leo@demo.example.com", provider: "email", available_name: "Leo Wang", name: "Leo Wang", role: "agent", thumbnail: "" },
  ];
  const teams = [
    { id: 1, name: "Billing Support", description: "mock 团队", allow_auto_d_assignment: true },
    { id: 2, name: "Technical Support", description: "mock 团队", allow_auto_d_assignment: true },
  ];
  const inboxes = [
    { id: 1, name: "Website Live Chat", channel_type: "Channel::WebWidget" },
    { id: 2, name: "Email Support", channel_type: "Channel::Email" },
  ];

  const conversationJson = (c) => ({
    meta: { sender: null, channel: "Channel::WebWidget", hmac_verified: false },
    ...c,
    messages: [],
    account_id: Number(accountId),
    additional_attributes: {},
    custom_attributes: {},
    agent_last_seen_at: 0,
    assignee_last_seen_at: 0,
    can_reply: c.status !== "resolved",
    contact_last_seen_at: 0,
    muted: false,
    snoozed_until: null,
    created_at: 1769904000,
    updated_at: 1769904100.5,
    timestamp: 1769904100,
    first_reply_created_at: 1769904300,
    unread_count: 0,
    last_non_activity_message: null,
    last_activity_at: 1769904100,
    priority: null,
    waiting_since: 0,
    sla_policy_id: null,
  });

  async function handler(req, res) {
    const url = new URL(req.url, "http://mock");
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const q = Object.fromEntries(url.searchParams);

    const send = (code, obj) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(obj ?? null));
    };

    // 鉴权：api_access_token 头缺失或值不对 → 401（真实实例会校验 token 值）
    if (!req.headers["api_access_token"] || req.headers["api_access_token"] !== validToken) {
      send(401, { error: "Unauthorized" });
      return;
    }

    const readBody = () =>
      new Promise((resolve) => {
        let data = "";
        req.on("data", (c) => (data += c));
        req.on("end", () => resolve(data ? JSON.parse(data) : {}));
      });

    let m;
    const convRe = new RegExp(`^/api/v1/accounts/${accountId}/conversations/(\\d+)(/(messages|toggle_status|labels|assignments))?$`);

    if (path === `/api/v1/accounts/${accountId}/conversations` && req.method === "GET") {
      const status = q.status || "open";
      let rows = [...conversations.values()].filter((c) => (status === "all" ? true : c.status === status));
      send(200, { data: { meta: { mine_count: 0, assigned_count: rows.filter((c) => c.assignee_id).length, unassigned_count: rows.filter((c) => !c.assignee_id).length, all_count: rows.length }, payload: rows.map(conversationJson) } });
      return;
    }
    if ((m = path.match(convRe))) {
      const conv = conversations.get(Number(m[1]));
      if (!conv) {
        send(404, { error: "Conversation not found" });
        return;
      }
      const sub = m[3];
      if (!sub) {
        send(200, conversationJson(conv));
        return;
      }
      if (sub === "messages" && req.method === "GET") {
        const all = messages.get(conv.id) ?? [];
        let rows = all.sort((a, b) => a.id - b.id);
        if (q.after) rows = rows.filter((x) => x.id > Number(q.after)).slice(0, 100);
        else if (q.before) rows = rows.filter((x) => x.id < Number(q.before)).slice(-20);
        send(200, { meta: { labels: conv.labels, contact: null }, payload: rows });
        return;
      }
      if (sub === "messages" && req.method === "POST") {
        const body = await readBody();
        if (!body.content) {
          send(422, { error: "Content can't be blank" });
          return;
        }
        const msg = {
          id: ++nextId,
          conversation_id: conv.id,
          inbox_id: conv.inbox_id,
          content: body.content,
          message_type: body.message_type === "incoming" ? 0 : 1,
          private: Boolean(body.private),
          created_at: Math.floor(Date.now() / 1000),
        };
        messages.set(conv.id, [...(messages.get(conv.id) ?? []), msg]);
        send(200, msg);
        return;
      }
      if (sub === "toggle_status" && req.method === "POST") {
        const body = await readBody();
        if (!body.status || !["open", "resolved", "pending", "snoozed"].includes(body.status)) {
          send(400, { error: "Invalid status" });
          return;
        }
        conv.status = body.status;
        send(200, conversationJson(conv));
        return;
      }
      if (sub === "labels" && req.method === "GET") {
        send(200, { payload: conv.labels });
        return;
      }
      if (sub === "labels" && req.method === "POST") {
        const body = await readBody();
        conv.labels = [...new Set(body.labels ?? [])];
        send(200, { payload: conv.labels });
        return;
      }
      if (sub === "assignments" && req.method === "POST") {
        const body = await readBody();
        if (body.assignee_id !== undefined) {
          const agent = agents.find((a) => a.id === Number(body.assignee_id));
          if (!agent) {
            send(404, { error: "Agent not found" });
            return;
          }
          conv.assignee_id = agent.id;
          send(200, agent);
          return;
        }
        if (body.team_id !== undefined) {
          const team = teams.find((t) => t.id === Number(body.team_id));
          if (!team) {
            send(404, { error: "Team not found" });
            return;
          }
          conv.team_id = team.id;
          send(200, team);
          return;
        }
        send(200, null);
        return;
      }
    }
    if (path === `/api/v1/accounts/${accountId}/contacts` && req.method === "GET") {
      const rows = [...contacts.values()];
      send(200, { meta: { count: rows.length, current_page: Number(q.page ?? 1) }, payload: rows });
      return;
    }
    if (path === `/api/v1/accounts/${accountId}/contacts/search` && req.method === "GET") {
      const needle = String(q.q ?? "").toLowerCase();
      const rows = [...contacts.values()].filter((c) => c.name.toLowerCase().includes(needle) || c.email.toLowerCase().includes(needle));
      send(200, { meta: { count: rows.length, current_page: Number(q.page ?? 1) }, payload: rows });
      return;
    }
    if (path === `/api/v1/accounts/${accountId}/contacts` && req.method === "POST") {
      const body = await readBody();
      const contact = {
        id: ++nextId,
        name: body.name ?? "",
        email: body.email ?? "",
        phone_number: body.phone_number ?? "",
        identifier: body.identifier ?? "",
        additional_attributes: body.additional_attributes ?? {},
        custom_attributes: body.custom_attributes ?? {},
        created_at: Math.floor(Date.now() / 1000),
        last_activity_at: Math.floor(Date.now() / 1000),
        contact_inboxes: body.inbox_id ? [{ source_id: `src-${nextId}`, inbox_id: body.inbox_id, created_at: Math.floor(Date.now() / 1000) }] : [],
      };
      contacts.set(contact.id, contact);
      send(200, contact);
      return;
    }
    if ((m = path.match(new RegExp(`^/api/v1/accounts/${accountId}/contacts/(\\d+)$`))) && req.method === "PUT") {
      const contact = contacts.get(Number(m[1]));
      if (!contact) {
        send(404, { error: "Contact not found" });
        return;
      }
      const body = await readBody();
      for (const k of ["name", "email", "phone_number", "identifier"]) if (body[k] !== undefined) contact[k] = body[k];
      send(200, contact);
      return;
    }
    if (path === `/api/v1/accounts/${accountId}/inboxes` && req.method === "GET") {
      send(200, { payload: inboxes });
      return;
    }
    if (path === `/api/v1/accounts/${accountId}/agents` && req.method === "GET") {
      send(200, agents);
      return;
    }
    if ((m = path.match(new RegExp(`^/api/v1/accounts/${accountId}/agents/(\\d+)$`))) && req.method === "PATCH") {
      const agent = agents.find((a) => a.id === Number(m[1]));
      if (!agent) {
        send(404, { error: "not found" });
        return;
      }
      const body = await readBody();
      // 对照 agents_controller.rb:67 params.require(:agent)：无 agent 根键 → 400
      if (!body || typeof body !== "object" || body.agent === undefined) {
        send(400, { error: "param is missing or the value is empty: agent" });
        return;
      }
      if (body.agent.role !== undefined) agent.role = body.agent.role;
      if (body.agent.availability !== undefined) agent.availability_status = body.agent.availability;
      if (body.agent.auto_offline !== undefined) agent.auto_offline = body.agent.auto_offline;
      send(200, agent);
      return;
    }
    if (path === `/api/v1/accounts/${accountId}/teams` && req.method === "GET") {
      send(200, teams);
      return;
    }
    if (path === "/api/v1/profile" && req.method === "GET") {
      send(200, { id: 1, name: "Ava Chen", email: "ava@demo.example.com", accounts: [{ id: Number(accountId), name: "Mock Corp", role: "administrator" }] });
      return;
    }

    send(404, { error: `mock-chatwoot-api 未实现：${req.method} ${path}` });
  }

  const server = createServer(handler);
  server.listen(port);
  return { server, conversations, contacts, agents };
}

// 直接运行：node scripts/mock-chatwoot-api.mjs [port]
if (process.argv[1] && process.argv[1].endsWith("mock-chatwoot-api.mjs")) {
  const port = Number(process.argv[2] ?? 18091);
  createMockChatwootApi(port);
  console.log(`[mock-chatwoot-api] listening on http://127.0.0.1:${port}`);
}
