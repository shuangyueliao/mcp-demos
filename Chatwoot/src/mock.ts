/**
 * 内置 mock 数据层：不依赖真实 Chatwoot 实例即可跑通全部工具。⚠️ 演示项目，非客户案例。
 *
 * 设计目标：
 * 1. 响应信封形状对照真实接口（出处同 src/chatwoot.ts / src/store.ts 头注释，2026-10-30 实抓），
 *    让「演示走查」与「连真实实例」看到同构的数据，e2e 同时覆盖两种实现；
 * 2. 写操作真实改动内存数据（发消息会追加、改状态会生效、打标签会覆盖），
 *    让 AI 侧能形成完整的「读 → 写 → 再读验证」闭环；
 * 3. 数据为虚构演示数据，不含任何真实客户信息。
 */
import { ChatwootError } from "./chatwoot.js";
import type {
  AgentUpdateArgs,
  ChatwootStore,
  ContactFields,
  ConversationListParams,
  CreateMessageArgs,
} from "./store.js";

// ── 虚构演示数据 ──────────────────────────────────────────────────────────

interface MockAgent {
  id: number;
  name: string;
  email: string;
  role: "agent" | "administrator";
  availability: "online" | "busy" | "offline";
  auto_offline: boolean;
}

interface MockTeam {
  id: number;
  name: string;
  description: string;
  allow_auto_d_assignment: boolean;
}

interface MockInbox {
  id: number;
  name: string;
  channel_type: string;
}

interface MockContact {
  id: number;
  name: string;
  email: string;
  phone_number: string;
  identifier: string;
  additional_attributes: Record<string, unknown>;
  custom_attributes: Record<string, unknown>;
  created_at: number;
  last_activity_at: number;
  contact_inboxes: { source_id: string; inbox_id: number; created_at: number }[];
}

interface MockMessage {
  id: number;
  conversation_id: number;
  inbox_id: number;
  content: string;
  message_type: 0 | 1 | 2; // 0=incoming 1=outgoing 2=activity（真实接口为数字，_message.json.jbuilder message_type_before_type_cast）
  private: boolean;
  sender_type: "contact" | "agent" | null;
  sender_id: number | null;
  created_at: number;
}

interface MockConversation {
  id: number;
  inbox_id: number;
  contact_id: number;
  status: "open" | "resolved" | "pending" | "snoozed";
  labels: string[];
  assignee_id: number | null;
  team_id: number | null;
  priority: "urgent" | "high" | "medium" | "low" | null;
  snoozed_until: number | null;
  uuid: string;
  additional_attributes: Record<string, unknown>;
  custom_attributes: Record<string, unknown>;
  created_at: number;
  last_activity_at: number;
  agent_last_seen_at: number;
  contact_last_seen_at: number;
  unread_count: number;
}

const BASE_TS = 1769904000; // 2026-02-01 起的演示时间线（Unix 秒，与真实接口 created_at 为秒级整数一致）

export class MockChatwootStore implements ChatwootStore {
  private readonly accountId: string;
  private nextMessageId = 100;
  private nextContactId = 100;
  private nextConversationId = 100;

  private readonly agents: MockAgent[] = [
    { id: 1, name: "Ava Chen", email: "ava@demo-corp.example.com", role: "administrator", availability: "online", auto_offline: true },
    { id: 2, name: "Leo Wang", email: "leo@demo-corp.example.com", role: "agent", availability: "busy", auto_offline: true },
    { id: 3, name: "Mia Torres", email: "mia@demo-corp.example.com", role: "agent", availability: "offline", auto_offline: false },
  ];

  private readonly teams: MockTeam[] = [
    { id: 1, name: "Billing Support", description: "账单与订阅支持（演示团队）", allow_auto_d_assignment: true },
    { id: 2, name: "Technical Support", description: "技术支持（演示团队）", allow_auto_d_assignment: true },
  ];

  private readonly inboxes: MockInbox[] = [
    { id: 1, name: "Website Live Chat", channel_type: "Channel::WebWidget" },
    { id: 2, name: "Email Support", channel_type: "Channel::Email" },
    { id: 3, name: "WhatsApp Business", channel_type: "Channel::Whatsapp" },
  ];

  private contacts: MockContact[] = [
    {
      id: 1,
      name: "Oliver Smith",
      email: "oliver@acme-corp.example.com",
      phone_number: "+14155550001",
      identifier: "acme-oliver",
      additional_attributes: { company: "Acme Corp", country: "US" },
      custom_attributes: { plan: "pro" },
      created_at: BASE_TS + 3600,
      last_activity_at: BASE_TS + 86400 * 2,
      contact_inboxes: [{ source_id: "src-1001", inbox_id: 1, created_at: BASE_TS + 3600 }],
    },
    {
      id: 2,
      name: "Emma Müller",
      email: "emma@berlinkg.example.de",
      phone_number: "+493055550002",
      identifier: "berlin-emma",
      additional_attributes: { company: "Berlin KG", country: "DE" },
      custom_attributes: { plan: "starter" },
      created_at: BASE_TS + 7200,
      last_activity_at: BASE_TS + 86400 * 5,
      contact_inboxes: [{ source_id: "src-1002", inbox_id: 2, created_at: BASE_TS + 7200 }],
    },
    {
      id: 3,
      name: "Kenji Sato",
      email: "kenji@sakura-ltd.example.jp",
      phone_number: "+81355550003",
      identifier: "sakura-kenji",
      additional_attributes: { company: "Sakura Ltd", country: "JP" },
      custom_attributes: {},
      created_at: BASE_TS + 10800,
      last_activity_at: BASE_TS + 86400,
      contact_inboxes: [{ source_id: "src-1003", inbox_id: 3, created_at: BASE_TS + 10800 }],
    },
  ];

  private messages: MockMessage[] = [
    { id: 11, conversation_id: 1, inbox_id: 1, content: "Hi! Our payment failed but the invoice says paid — can you check?", message_type: 0, private: false, sender_type: "contact", sender_id: 1, created_at: BASE_TS + 86400 },
    { id: 12, conversation_id: 1, inbox_id: 1, content: "Sure Oliver, let me look into the billing record for you.", message_type: 1, private: false, sender_type: "agent", sender_id: 1, created_at: BASE_TS + 86700 },
    { id: 21, conversation_id: 2, inbox_id: 2, content: "We need to change the shipping address on order #2331.", message_type: 0, private: false, sender_type: "contact", sender_id: 2, created_at: BASE_TS + 86400 * 2 },
    { id: 22, conversation_id: 2, inbox_id: 2, content: "客户地址变更请求，需要核实订单归属（内部备注）", message_type: 1, private: true, sender_type: "agent", sender_id: 2, created_at: BASE_TS + 86400 * 2 + 300 },
    { id: 31, conversation_id: 3, inbox_id: 3, content: "Bot 已应答，等待人工接手（演示待处理会话）", message_type: 2, private: false, sender_type: null, sender_id: null, created_at: BASE_TS + 86400 * 3 },
    { id: 41, conversation_id: 4, inbox_id: 1, content: "Thanks, the setup guide solved it!", message_type: 0, private: false, sender_type: "contact", sender_id: 1, created_at: BASE_TS + 86400 * 4 },
  ];

  private conversations: MockConversation[] = [
    {
      id: 1, inbox_id: 1, contact_id: 1, status: "open", labels: ["billing", "payment"], assignee_id: 1, team_id: 1,
      priority: "high", snoozed_until: null, uuid: "demo-conv-0001", additional_attributes: { browser: "Chrome" },
      custom_attributes: { invoice_no: "INV-2026-0031" }, created_at: BASE_TS + 86400,
      last_activity_at: BASE_TS + 86700, agent_last_seen_at: BASE_TS + 86800, contact_last_seen_at: BASE_TS + 86900, unread_count: 0,
    },
    {
      id: 2, inbox_id: 2, contact_id: 2, status: "open", labels: ["shipping"], assignee_id: null, team_id: null,
      priority: null, snoozed_until: null, uuid: "demo-conv-0002", additional_attributes: {},
      custom_attributes: {}, created_at: BASE_TS + 86400 * 2,
      last_activity_at: BASE_TS + 86400 * 2 + 300, agent_last_seen_at: 0, contact_last_seen_at: BASE_TS + 86400 * 2, unread_count: 1,
    },
    {
      id: 3, inbox_id: 3, contact_id: 3, status: "pending", labels: [], assignee_id: null, team_id: 2,
      priority: null, snoozed_until: null, uuid: "demo-conv-0003", additional_attributes: {},
      custom_attributes: {}, created_at: BASE_TS + 86400 * 3,
      last_activity_at: BASE_TS + 86400 * 3, agent_last_seen_at: 0, contact_last_seen_at: BASE_TS + 86400 * 3, unread_count: 0,
    },
    {
      id: 4, inbox_id: 1, contact_id: 1, status: "resolved", labels: ["onboarding"], assignee_id: 1, team_id: null,
      priority: null, snoozed_until: null, uuid: "demo-conv-0004", additional_attributes: {},
      custom_attributes: {}, created_at: BASE_TS + 86400 * 4,
      last_activity_at: BASE_TS + 86400 * 4 + 600, agent_last_seen_at: BASE_TS + 86400 * 4 + 700,
      contact_last_seen_at: BASE_TS + 86400 * 4 + 600, unread_count: 0,
    },
  ];

  constructor(accountId: string) {
    this.accountId = accountId;
  }

  // ── 对象 → 真实接口形状 ─────────────────────────────────────────────────

  private agentJson(a: MockAgent) {
    return {
      id: a.id,
      account_id: Number(this.accountId),
      availability_status: a.availability,
      auto_offline: a.auto_offline,
      confirmed: true,
      email: a.email,
      provider: "email",
      available_name: a.name,
      name: a.name,
      role: a.role,
      thumbnail: "",
    };
  }

  private contactJson(c: MockContact) {
    return {
      id: c.id,
      name: c.name,
      email: c.email,
      phone_number: c.phone_number,
      identifier: c.identifier,
      additional_attributes: c.additional_attributes,
      custom_attributes: c.custom_attributes,
      created_at: c.created_at,
      last_activity_at: c.last_activity_at,
      contact_inboxes: c.contact_inboxes,
    };
  }

  private messageJson(m: MockMessage) {
    const sender =
      m.sender_type === "agent"
        ? (() => {
            const a = this.agents.find((x) => x.id === m.sender_id);
            return a ? { id: a.id, name: a.name, available_name: a.name, type: "user" } : null;
          })()
        : m.sender_type === "contact"
          ? (() => {
              const c = this.contacts.find((x) => x.id === m.sender_id);
              return c ? { id: c.id, name: c.name, type: "contact" } : null;
            })()
          : null;
    return {
      id: m.id,
      content: m.content,
      inbox_id: m.inbox_id,
      conversation_id: m.conversation_id,
      message_type: m.message_type,
      content_type: "text",
      status: "sent",
      content_attributes: {},
      created_at: m.created_at,
      private: m.private,
      source_id: null,
      sender,
      attachments: [],
    };
  }

  private conversationJson(c: MockConversation) {
    const contact = this.contacts.find((x) => x.id === c.contact_id);
    const assignee = this.agents.find((x) => x.id === c.assignee_id);
    const team = this.teams.find((x) => x.id === c.team_id);
    const inbox = this.inboxes.find((x) => x.id === c.inbox_id);
    const msgs = this.messages.filter((m) => m.conversation_id === c.id).sort((a, b) => a.id - b.id);
    const last = msgs[msgs.length - 1];
    const lastNonActivity = [...msgs].reverse().find((m) => m.message_type !== 2);
    return {
      meta: {
        sender: contact ? this.contactJson(contact) : null,
        channel: inbox?.channel_type ?? null,
        ...(assignee ? { assignee: this.agentJson(assignee), assignee_type: "User" } : {}),
        ...(team ? { team: teamJson(team) } : {}),
        hmac_verified: false,
      },
      id: c.id,
      messages: last ? [this.messageJson(last)] : [],
      account_id: Number(this.accountId),
      uuid: c.uuid,
      additional_attributes: c.additional_attributes,
      agent_last_seen_at: c.agent_last_seen_at,
      assignee_last_seen_at: c.agent_last_seen_at,
      can_reply: c.status !== "resolved",
      contact_last_seen_at: c.contact_last_seen_at,
      custom_attributes: c.custom_attributes,
      inbox_id: c.inbox_id,
      labels: c.labels,
      muted: false,
      snoozed_until: c.snoozed_until,
      status: c.status,
      created_at: c.created_at,
      updated_at: c.last_activity_at + 0.5,
      timestamp: c.last_activity_at,
      first_reply_created_at: c.created_at + 300,
      unread_count: c.unread_count,
      last_non_activity_message: lastNonActivity ? this.messageJson(lastNonActivity) : null,
      last_activity_at: c.last_activity_at,
      priority: c.priority,
      waiting_since: c.status === "open" && !c.assignee_id ? c.last_activity_at : 0,
      sla_policy_id: null,
    };
  }

  private requireConversation(id: number): MockConversation {
    const c = this.conversations.find((x) => x.id === id);
    if (!c) {
      throw new ChatwootError(`会话不存在（HTTP 404，mock 演示数据中无会话 ${id}）`, {
        httpStatus: 404,
        hint: "先用 chatwoot_list_conversations 查看现有会话 ID",
      });
    }
    return c;
  }

  // ── ChatwootStore 实现 ──────────────────────────────────────────────────

  async listConversations(params: ConversationListParams): Promise<unknown> {
    const status = params.status ?? "open"; // 真实 ConversationFinder 默认 status=open
    let rows = this.conversations.filter((c) => (status === "all" ? true : c.status === status));
    const at = params.assigneeType ?? "all";
    if (at === "me") rows = rows.filter((c) => c.assignee_id === 1);
    else if (at === "unassigned") rows = rows.filter((c) => c.assignee_id === null);
    else if (at === "assigned") rows = rows.filter((c) => c.assignee_id !== null);
    if (params.inboxId !== undefined) rows = rows.filter((c) => c.inbox_id === params.inboxId);
    if (params.teamId !== undefined) rows = rows.filter((c) => c.team_id === params.teamId);
    if (params.labels) {
      const want = params.labels.split(",").filter(Boolean);
      rows = rows.filter((c) => want.every((l) => c.labels.includes(l)));
    }
    if (params.q) {
      const q = params.q.toLowerCase();
      rows = rows.filter((c) => {
        const contact = this.contacts.find((x) => x.id === c.contact_id);
        const assignee = this.agents.find((x) => x.id === c.assignee_id);
        return (
          (contact && (contact.name.toLowerCase().includes(q) || contact.email.toLowerCase().includes(q))) ||
          (assignee && assignee.name.toLowerCase().includes(q)) ||
          c.labels.some((l) => l.toLowerCase().includes(q))
        );
      });
    }
    const meta = {
      mine_count: rows.filter((c) => c.assignee_id === 1).length,
      assigned_count: rows.filter((c) => c.assignee_id !== null).length,
      unassigned_count: rows.filter((c) => c.assignee_id === null).length,
      all_count: rows.length,
    };
    const page = params.page ?? 1;
    const PAGE_SIZE = 25;
    const payload = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((c) => this.conversationJson(c));
    return { data: { meta, payload } };
  }

  async getConversation(conversationId: number): Promise<unknown> {
    return this.conversationJson(this.requireConversation(conversationId));
  }

  async listMessages(conversationId: number, opts?: { after?: number; before?: number }): Promise<unknown> {
    const c = this.requireConversation(conversationId);
    let rows = this.messages.filter((m) => m.conversation_id === conversationId).sort((a, b) => a.id - b.id);
    if (opts?.after !== undefined) {
      // 真实接口：after 返回该 ID 之后最多 100 条（升序）
      rows = rows.filter((m) => m.id > opts.after!).slice(0, 100);
    } else if (opts?.before !== undefined) {
      // 真实接口：before 返回该 ID 之前最多 20 条（升序）
      rows = rows.filter((m) => m.id < opts.before!).slice(-20);
    }
    const contact = this.contacts.find((x) => x.id === c.contact_id);
    const assignee = this.agents.find((x) => x.id === c.assignee_id);
    return {
      meta: {
        labels: c.labels,
        additional_attributes: c.additional_attributes,
        contact: contact ? this.contactJson(contact) : null,
        ...(assignee ? { assignee: this.agentJson(assignee) } : {}),
        agent_last_seen_at: c.agent_last_seen_at,
        assignee_last_seen_at: c.agent_last_seen_at,
      },
      payload: rows.map((m) => this.messageJson(m)),
    };
  }

  async createMessage(conversationId: number, args: CreateMessageArgs): Promise<unknown> {
    const c = this.requireConversation(conversationId);
    const messageType = args.messageType ?? "outgoing";
    const m: MockMessage = {
      id: ++this.nextMessageId,
      conversation_id: c.id,
      inbox_id: c.inbox_id,
      content: args.content,
      message_type: messageType === "incoming" ? 0 : 1,
      private: args.private ?? false,
      sender_type: messageType === "incoming" ? "contact" : "agent",
      sender_id: messageType === "incoming" ? c.contact_id : 1,
      created_at: BASE_TS + Math.floor(Date.now() / 1000) % 86400,
    };
    this.messages.push(m);
    c.last_activity_at = m.created_at;
    if (!m.private && messageType === "outgoing") c.unread_count = 0;
    return this.messageJson(m);
  }

  async setConversationStatus(conversationId: number, status: "open" | "resolved" | "pending" | "snoozed", snoozedUntil?: number): Promise<unknown> {
    const c = this.requireConversation(conversationId);
    c.status = status;
    c.snoozed_until = status === "snoozed" ? (snoozedUntil ?? c.last_activity_at + 86400) : null;
    return this.conversationJson(c);
  }

  async listConversationLabels(conversationId: number): Promise<unknown> {
    const c = this.requireConversation(conversationId);
    return { payload: c.labels };
  }

  async setConversationLabels(conversationId: number, labels: string[]): Promise<unknown> {
    const c = this.requireConversation(conversationId);
    c.labels = [...new Set(labels)]; // 官方语义：update_labels 整表覆盖（LabelConcern → model.update_labels）
    return { payload: c.labels };
  }

  async assignConversation(conversationId: number, args: { assigneeId?: number; teamId?: number }): Promise<unknown> {
    const c = this.requireConversation(conversationId);
    // 官方语义（assignments_controller.rb）：传 assignee_id 时优先指派座席，team_id 被忽略
    if (args.assigneeId !== undefined) {
      const agent = this.agents.find((a) => a.id === args.assigneeId);
      if (!agent) {
        throw new ChatwootError(`座席不存在（HTTP 404，mock 演示数据中无座席 ${args.assigneeId}）`, {
          httpStatus: 404,
          hint: "先用 chatwoot_list_agents 查看现有座席 ID",
        });
      }
      c.assignee_id = agent.id;
      return this.agentJson(agent);
    }
    if (args.teamId !== undefined) {
      const team = this.teams.find((t) => t.id === args.teamId);
      if (!team) {
        throw new ChatwootError(`团队不存在（HTTP 404，mock 演示数据中无团队 ${args.teamId}）`, {
          httpStatus: 404,
          hint: "先用 chatwoot_list_teams 查看现有团队 ID",
        });
      }
      c.team_id = team.id;
      return teamJson(team);
    }
    return null;
  }

  async listContacts(page?: number): Promise<unknown> {
    const PAGE_SIZE = 15; // 真实接口 RESULTS_PER_PAGE = 15（contacts_controller.rb:12）
    const p = page ?? 1;
    const payload = this.contacts.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE).map((c) => this.contactJson(c));
    return { meta: { count: payload.length, current_page: p }, payload };
  }

  async searchContacts(q: string, page?: number): Promise<unknown> {
    // 真实接口对 name/email/phone_number/identifier 做 ILIKE 模糊匹配（contacts_controller.rb:39-46）
    const needle = q.toLowerCase();
    const hits = this.contacts.filter(
      (c) =>
        c.name.toLowerCase().includes(needle) ||
        c.email.toLowerCase().includes(needle) ||
        c.phone_number.includes(needle) ||
        c.identifier.toLowerCase().includes(needle)
    );
    const PAGE_SIZE = 15;
    const p = page ?? 1;
    const payload = hits.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE).map((c) => this.contactJson(c));
    return { meta: { count: payload.length, current_page: p }, payload };
  }

  async createContact(args: ContactFields): Promise<unknown> {
    const email = args.email ?? "";
    if (args.email && this.contacts.some((c) => c.email.toLowerCase() === email.toLowerCase())) {
      throw new ChatwootError("Email 已经被使用（HTTP 422）", {
        httpStatus: 422,
        hint: "先用 chatwoot_search_contacts 查重，已有联系人请用 chatwoot_update_contact 更新",
      });
    }
    const now = BASE_TS + Math.floor(Date.now() / 1000) % 86400;
    const c: MockContact = {
      id: ++this.nextContactId,
      name: args.name ?? "",
      email: args.email ?? "",
      phone_number: args.phoneNumber ?? "",
      identifier: args.identifier ?? "",
      additional_attributes: args.additionalAttributes ?? {},
      custom_attributes: args.customAttributes ?? {},
      created_at: now,
      last_activity_at: now,
      contact_inboxes: args.inboxId !== undefined ? [{ source_id: `src-${now}`, inbox_id: args.inboxId, created_at: now }] : [],
    };
    this.contacts.push(c);
    return this.contactJson(c);
  }

  async updateContact(contactId: number, args: ContactFields): Promise<unknown> {
    const c = this.contacts.find((x) => x.id === contactId);
    if (!c) {
      throw new ChatwootError(`联系人不存在（HTTP 404，mock 演示数据中无联系人 ${contactId}）`, {
        httpStatus: 404,
        hint: "先用 chatwoot_search_contacts 确认联系人 ID",
      });
    }
    if (args.name !== undefined) c.name = args.name;
    if (args.email !== undefined) c.email = args.email;
    if (args.phoneNumber !== undefined) c.phone_number = args.phoneNumber;
    if (args.identifier !== undefined) c.identifier = args.identifier;
    if (args.additionalAttributes) c.additional_attributes = { ...c.additional_attributes, ...args.additionalAttributes };
    if (args.customAttributes) c.custom_attributes = { ...c.custom_attributes, ...args.customAttributes };
    return this.contactJson(c);
  }

  async listInboxes(): Promise<unknown> {
    return { payload: this.inboxes.map((i) => ({ ...i, greeting_enabled: true, auto_assignment_enabled: true })) };
  }

  async listAgents(): Promise<unknown> {
    return this.agents.map((a) => this.agentJson(a));
  }

  async listTeams(): Promise<unknown> {
    return this.teams.map((t) => teamJson(t));
  }

  async updateAgent(agentId: number, args: AgentUpdateArgs): Promise<unknown> {
    const a = this.agents.find((x) => x.id === agentId);
    if (!a) {
      throw new ChatwootError(`座席不存在（HTTP 404，mock 演示数据中无座席 ${agentId}）`, {
        httpStatus: 404,
        hint: "先用 chatwoot_list_agents 查看现有座席 ID",
      });
    }
    if (args.role !== undefined) a.role = args.role;
    if (args.availability !== undefined) a.availability = args.availability;
    if (args.autoOffline !== undefined) a.auto_offline = args.autoOffline;
    return this.agentJson(a);
  }

  /** 通用桥接的 mock 路由：按真实接口路径形态分发到上面同一套实现 */
  async rawRequest(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    query: Record<string, string | number | boolean | undefined> = {},
    body?: unknown
  ): Promise<unknown> {
    const acct = this.accountId;
    const num = (v: unknown) => Number(v);
    const seg = (re: RegExp): RegExpMatchArray | null => path.match(re);
    let m: RegExpMatchArray | null;

    if (path === `/api/v1/accounts/${acct}/conversations` && method === "GET") {
      return this.listConversations({
        status: query.status as ConversationListParams["status"],
        assigneeType: query.assignee_type as ConversationListParams["assigneeType"],
        q: query.q ? String(query.q) : undefined,
        inboxId: query.inbox_id !== undefined ? num(query.inbox_id) : undefined,
        teamId: query.team_id !== undefined ? num(query.team_id) : undefined,
        labels: query.labels ? String(query.labels) : undefined,
        page: query.page !== undefined ? num(query.page) : undefined,
      });
    }
    if ((m = seg(new RegExp(`^/api/v1/accounts/${acct}/conversations/(\\d+)$`))) && method === "GET") {
      return this.getConversation(num(m[1]));
    }
    if ((m = seg(new RegExp(`^/api/v1/accounts/${acct}/conversations/(\\d+)/messages$`)))) {
      if (method === "GET") {
        return this.listMessages(num(m[1]), {
          after: query.after !== undefined ? num(query.after) : undefined,
          before: query.before !== undefined ? num(query.before) : undefined,
        });
      }
      if (method === "POST") {
        const b = (body ?? {}) as Record<string, unknown>;
        return this.createMessage(num(m[1]), {
          content: String(b.content ?? ""),
          messageType: b.message_type === "incoming" ? "incoming" : "outgoing",
          private: Boolean(b.private),
        });
      }
    }
    if ((m = seg(new RegExp(`^/api/v1/accounts/${acct}/conversations/(\\d+)/toggle_status$`))) && method === "POST") {
      const b = (body ?? {}) as Record<string, unknown>;
      const status = b.status as "open" | "resolved" | "pending" | "snoozed";
      return this.setConversationStatus(num(m[1]), status, b.snoozed_until !== undefined ? num(b.snoozed_until) : undefined);
    }
    if ((m = seg(new RegExp(`^/api/v1/accounts/${acct}/conversations/(\\d+)/labels$`))) && (method === "GET" || method === "POST")) {
      if (method === "GET") return this.listConversationLabels(num(m[1]));
      const b = (body ?? {}) as { labels?: string[] };
      return this.setConversationLabels(num(m[1]), b.labels ?? []);
    }
    if ((m = seg(new RegExp(`^/api/v1/accounts/${acct}/conversations/(\\d+)/assignments$`))) && method === "POST") {
      const b = (body ?? {}) as Record<string, unknown>;
      return this.assignConversation(num(m[1]), {
        assigneeId: b.assignee_id !== undefined ? num(b.assignee_id) : undefined,
        teamId: b.team_id !== undefined ? num(b.team_id) : undefined,
      });
    }
    if (path === `/api/v1/accounts/${acct}/contacts` && method === "GET") {
      return this.listContacts(query.page !== undefined ? num(query.page) : undefined);
    }
    if (path === `/api/v1/accounts/${acct}/contacts/search` && method === "GET") {
      return this.searchContacts(String(query.q ?? ""), query.page !== undefined ? num(query.page) : undefined);
    }
    if (path === `/api/v1/accounts/${acct}/contacts` && method === "POST") {
      const b = (body ?? {}) as Record<string, unknown>;
      return this.createContact({
        name: b.name as string | undefined,
        email: b.email as string | undefined,
        phoneNumber: b.phone_number as string | undefined,
        identifier: b.identifier as string | undefined,
        inboxId: b.inbox_id !== undefined ? num(b.inbox_id) : undefined,
        additionalAttributes: b.additional_attributes as Record<string, unknown> | undefined,
        customAttributes: b.custom_attributes as Record<string, unknown> | undefined,
      });
    }
    if ((m = seg(new RegExp(`^/api/v1/accounts/${acct}/contacts/(\\d+)$`))) && (method === "GET" || method === "PUT")) {
      if (method === "GET") {
        const c = this.contacts.find((x) => x.id === num(m![1]));
        if (!c) throw new ChatwootError(`联系人不存在（HTTP 404）`, { httpStatus: 404 });
        return this.contactJson(c);
      }
      const b = (body ?? {}) as Record<string, unknown>;
      return this.updateContact(num(m[1]), {
        name: b.name as string | undefined,
        email: b.email as string | undefined,
        phoneNumber: b.phone_number as string | undefined,
        identifier: b.identifier as string | undefined,
        additionalAttributes: b.additional_attributes as Record<string, unknown> | undefined,
        customAttributes: b.custom_attributes as Record<string, unknown> | undefined,
      });
    }
    if (path === `/api/v1/accounts/${acct}/inboxes` && method === "GET") return this.listInboxes();
    if (path === `/api/v1/accounts/${acct}/agents` && method === "GET") return this.listAgents();
    if ((m = seg(new RegExp(`^/api/v1/accounts/${acct}/agents/(\\d+)$`))) && method === "PATCH") {
      const root = (body ?? {}) as { agent?: Record<string, unknown> };
      if (root.agent === undefined) {
        // mock 同样要求 agent 根键：真实源码 params.require(:agent)
        throw new ChatwootError("param is missing or the value is empty: agent（HTTP 400，mock 与真实源码一致：请求体必须带 agent 根键）", {
          httpStatus: 400,
        });
      }
      const a = root.agent;
      return this.updateAgent(num(m[1]), {
        role: a.role as AgentUpdateArgs["role"],
        availability: a.availability as AgentUpdateArgs["availability"],
        autoOffline: a.auto_offline as boolean | undefined,
      });
    }
    if (path === `/api/v1/accounts/${acct}/teams` && method === "GET") return this.listTeams();
    if (path === "/api/v1/profile" && method === "GET") {
      const me = this.agents.find((a) => a.id === 1)!;
      return { id: me.id, name: me.name, email: me.email, role: me.role, availability_status: me.availability, accounts: [{ id: Number(acct), name: "Demo Corp（演示账号）", role: "administrator" }] };
    }

    throw new ChatwootError(`mock 未实现该端点：${method} ${path}`, {
      httpStatus: 404,
      hint: "内置 mock 只覆盖 chatwoot_api 默认白名单中的路径；要调其它端点请连真实实例（CHATWOOT_MOCK=false）",
    });
  }
}

function teamJson(t: MockTeam) {
  return { id: t.id, name: t.name, description: t.description, allow_auto_d_assignment: t.allow_auto_d_assignment };
}
