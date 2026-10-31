/**
 * 数据层：ChatwootStore 接口 + 真实 API 实现（ApiStore）。⚠️ 演示项目，非客户案例。
 *
 * 每个方法的端点、请求体与响应信封均对照官方 OpenAPI 规范与 develop 分支源码核实
 * （2026-10-30 实抓，逐条出处见 src/chatwoot.ts 头注释与 src/tools.ts 头注释）。
 * 内置 mock 实现（src/mock.ts）返回与真实接口相同信封形状的演示数据。
 */
import { ChatwootClient } from "./chatwoot.js";

export interface ConversationListParams {
  status?: "all" | "open" | "resolved" | "pending" | "snoozed";
  assigneeType?: "me" | "unassigned" | "all" | "assigned";
  q?: string;
  inboxId?: number;
  teamId?: number;
  labels?: string;
  page?: number;
}

export interface CreateMessageArgs {
  content: string;
  messageType?: "outgoing" | "incoming";
  private?: boolean;
  contentType?: "text" | "input_email" | "cards" | "input_select" | "form" | "article";
  contentAttributes?: Record<string, unknown>;
}

export interface ContactFields {
  name?: string;
  email?: string;
  phoneNumber?: string;
  identifier?: string;
  additionalAttributes?: Record<string, unknown>;
  customAttributes?: Record<string, unknown>;
  inboxId?: number;
}

export interface AgentUpdateArgs {
  role?: "agent" | "administrator";
  availability?: "online" | "busy" | "offline";
  autoOffline?: boolean;
}

export interface ChatwootStore {
  /** GET /api/v1/accounts/{id}/conversations */
  listConversations(params: ConversationListParams): Promise<unknown>;
  /** GET /api/v1/accounts/{id}/conversations/{conversation_id} */
  getConversation(conversationId: number): Promise<unknown>;
  /** GET /api/v1/accounts/{id}/conversations/{conversation_id}/messages（after/before 分页） */
  listMessages(conversationId: number, opts?: { after?: number; before?: number }): Promise<unknown>;
  /** POST /api/v1/accounts/{id}/conversations/{conversation_id}/messages（写） */
  createMessage(conversationId: number, args: CreateMessageArgs): Promise<unknown>;
  /** POST /api/v1/accounts/{id}/conversations/{conversation_id}/toggle_status（写） */
  setConversationStatus(conversationId: number, status: "open" | "resolved" | "pending" | "snoozed", snoozedUntil?: number): Promise<unknown>;
  /** GET /api/v1/accounts/{id}/conversations/{conversation_id}/labels */
  listConversationLabels(conversationId: number): Promise<unknown>;
  /** POST /api/v1/accounts/{id}/conversations/{conversation_id}/labels（写：官方语义为整表覆盖） */
  setConversationLabels(conversationId: number, labels: string[]): Promise<unknown>;
  /** POST /api/v1/accounts/{id}/conversations/{conversation_id}/assignments（写：assignee_id 优先于 team_id） */
  assignConversation(conversationId: number, args: { assigneeId?: number; teamId?: number }): Promise<unknown>;
  /** GET /api/v1/accounts/{id}/contacts（每页 15 条） */
  listContacts(page?: number): Promise<unknown>;
  /** GET /api/v1/accounts/{id}/contacts/search?q= */
  searchContacts(q: string, page?: number): Promise<unknown>;
  /** POST /api/v1/accounts/{id}/contacts（写） */
  createContact(args: ContactFields): Promise<unknown>;
  /** PUT /api/v1/accounts/{id}/contacts/{id}（写） */
  updateContact(contactId: number, args: ContactFields): Promise<unknown>;
  /** GET /api/v1/accounts/{id}/inboxes */
  listInboxes(): Promise<unknown>;
  /** GET /api/v1/accounts/{id}/agents（裸数组） */
  listAgents(): Promise<unknown>;
  /** GET /api/v1/accounts/{id}/teams（裸数组） */
  listTeams(): Promise<unknown>;
  /** PATCH /api/v1/accounts/{id}/agents/{id}（写：请求体必须带 agent 根键） */
  updateAgent(agentId: number, args: AgentUpdateArgs): Promise<unknown>;
  /** 通用桥接：转发到任意（经 tools.ts 白名单校验后的）相对路径 */
  rawRequest(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, query?: Record<string, string | number | boolean | undefined>, body?: unknown): Promise<unknown>;
}

/** 真实模式实现：全部委托给 ChatwootClient */
export class ApiStore implements ChatwootStore {
  constructor(private readonly client: ChatwootClient) {}

  listConversations(params: ConversationListParams): Promise<unknown> {
    return this.client.request(this.client.accountPath("/conversations"), {
      query: {
        status: params.status,
        assignee_type: params.assigneeType,
        q: params.q,
        inbox_id: params.inboxId,
        team_id: params.teamId,
        labels: params.labels,
        page: params.page,
      },
    });
  }

  getConversation(conversationId: number): Promise<unknown> {
    return this.client.request(this.client.accountPath(`/conversations/${conversationId}`));
  }

  listMessages(conversationId: number, opts?: { after?: number; before?: number }): Promise<unknown> {
    return this.client.request(this.client.accountPath(`/conversations/${conversationId}/messages`), {
      query: { after: opts?.after, before: opts?.before },
    });
  }

  createMessage(conversationId: number, args: CreateMessageArgs): Promise<unknown> {
    return this.client.request(this.client.accountPath(`/conversations/${conversationId}/messages`), {
      method: "POST",
      body: {
        content: args.content,
        message_type: args.messageType ?? "outgoing",
        private: args.private ?? false,
        ...(args.contentType ? { content_type: args.contentType } : {}),
        ...(args.contentAttributes ? { content_attributes: args.contentAttributes } : {}),
      },
    });
  }

  setConversationStatus(conversationId: number, status: "open" | "resolved" | "pending" | "snoozed", snoozedUntil?: number): Promise<unknown> {
    return this.client.request(this.client.accountPath(`/conversations/${conversationId}/toggle_status`), {
      method: "POST",
      body: snoozedUntil !== undefined ? { status, snoozed_until: snoozedUntil } : { status },
    });
  }

  listConversationLabels(conversationId: number): Promise<unknown> {
    return this.client.request(this.client.accountPath(`/conversations/${conversationId}/labels`));
  }

  setConversationLabels(conversationId: number, labels: string[]): Promise<unknown> {
    return this.client.request(this.client.accountPath(`/conversations/${conversationId}/labels`), {
      method: "POST",
      body: { labels },
    });
  }

  assignConversation(conversationId: number, args: { assigneeId?: number; teamId?: number }): Promise<unknown> {
    const body: Record<string, number> = {};
    if (args.assigneeId !== undefined) body.assignee_id = args.assigneeId;
    else if (args.teamId !== undefined) body.team_id = args.teamId;
    return this.client.request(this.client.accountPath(`/conversations/${conversationId}/assignments`), {
      method: "POST",
      body,
    });
  }

  listContacts(page?: number): Promise<unknown> {
    return this.client.request(this.client.accountPath("/contacts"), { query: { page } });
  }

  searchContacts(q: string, page?: number): Promise<unknown> {
    return this.client.request(this.client.accountPath("/contacts/search"), { query: { q, page } });
  }

  createContact(args: ContactFields): Promise<unknown> {
    return this.client.request(this.client.accountPath("/contacts"), {
      method: "POST",
      body: {
        ...(args.name !== undefined ? { name: args.name } : {}),
        ...(args.email !== undefined ? { email: args.email } : {}),
        ...(args.phoneNumber !== undefined ? { phone_number: args.phoneNumber } : {}),
        ...(args.identifier !== undefined ? { identifier: args.identifier } : {}),
        ...(args.inboxId !== undefined ? { inbox_id: args.inboxId } : {}),
        ...(args.additionalAttributes ? { additional_attributes: args.additionalAttributes } : {}),
        ...(args.customAttributes ? { custom_attributes: args.customAttributes } : {}),
      },
    });
  }

  updateContact(contactId: number, args: ContactFields): Promise<unknown> {
    return this.client.request(this.client.accountPath(`/contacts/${contactId}`), {
      method: "PUT",
      body: {
        ...(args.name !== undefined ? { name: args.name } : {}),
        ...(args.email !== undefined ? { email: args.email } : {}),
        ...(args.phoneNumber !== undefined ? { phone_number: args.phoneNumber } : {}),
        ...(args.identifier !== undefined ? { identifier: args.identifier } : {}),
        ...(args.additionalAttributes ? { additional_attributes: args.additionalAttributes } : {}),
        ...(args.customAttributes ? { custom_attributes: args.customAttributes } : {}),
      },
    });
  }

  listInboxes(): Promise<unknown> {
    return this.client.request(this.client.accountPath("/inboxes"));
  }

  listAgents(): Promise<unknown> {
    return this.client.request(this.client.accountPath("/agents"));
  }

  listTeams(): Promise<unknown> {
    return this.client.request(this.client.accountPath("/teams"));
  }

  updateAgent(agentId: number, args: AgentUpdateArgs): Promise<unknown> {
    // 官方源码 params.require(:agent)：请求体必须带 agent 根键（agents_controller.rb:67）
    const agent: Record<string, unknown> = {};
    if (args.role !== undefined) agent.role = args.role;
    if (args.availability !== undefined) agent.availability = args.availability;
    if (args.autoOffline !== undefined) agent.auto_offline = args.autoOffline;
    return this.client.request(this.client.accountPath(`/agents/${agentId}`), {
      method: "PATCH",
      body: { agent },
    });
  }

  rawRequest(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
    body?: unknown
  ): Promise<unknown> {
    return this.client.request(path, { method, query, body });
  }
}
