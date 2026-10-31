/**
 * 工具注册：17 个工具，覆盖「会话 / 消息 / 标签 / 指派 / 联系人 / 收件箱 / 座席 / 团队 / 白名单桥接」。
 * ⚠️ 演示项目，非客户案例。
 *
 * 每个端点都对照过官方材料核实（2026-10-30 实抓）：
 * - OpenAPI 规范：chatwoot/chatwoot develop 分支 swagger/tag_groups/application_swagger.json
 *   （developers.chatwoot.com 各 API 页内嵌同一份规范）
 * - Rails 源码：chatwoot/chatwoot develop 分支（下述行号为当时抓取版本的行号）
 * - GET  /api/v1/accounts/{account_id}/conversations                    会话列表，query: status(默认 open)/
 *        assignee_type(me|unassigned|all|assigned)/q/inbox_id/team_id/labels/page
 *        信封 {data:{meta:{mine_count,…},payload:[…]}}（conversations/index.json.jbuilder）
 * - GET  /api/v1/accounts/{account_id}/conversations/{id}               会话详情（含最新一条消息与 labels）
 * - GET  /api/v1/accounts/{account_id}/conversations/{id}/messages      消息历史，query: after(≤100 条)/
 *        before(≤20 条)（swagger 参数描述）；信封 {meta,…,payload:[…]}
 *        （conversations/messages/index.json.jbuilder）
 * - POST /api/v1/accounts/{account_id}/conversations/{id}/messages      发消息（写）。
 *        content 必填，message_type outgoing/incoming（源码 MessageBuilder 默认 outgoing）、
 *        private=true 为内部备注不触达客户（messages_controller.rb:8-13）
 * - POST /api/v1/accounts/{account_id}/conversations/{id}/toggle_status 状态变更（写）。
 *        status 必填 open|resolved|pending|snoozed（conversations_controller.rb:83-89；
 *        枚举见 swagger toggle_status；snoozed 可带 snoozed_until Unix 秒）
 * - GET/POST /api/v1/accounts/{account_id}/conversations/{id}/labels    标签读/写。
 *        POST 语义为整表覆盖（LabelConcern → model.update_labels；官方文档原注
 *        "this API would overwrite the existing list of labels"）；信封 {payload:[名称]}
 *        （conversations/labels/index.json.jbuilder）
 * - POST /api/v1/accounts/{account_id}/conversations/{id}/assignments   指派（写）。
 *        {assignee_id} 优先于 {team_id}（assignments_controller.rb:6-16）
 * - GET  /api/v1/accounts/{account_id}/contacts                         联系人列表，每页 15 条
 *        （contacts_controller.rb:12 RESULTS_PER_PAGE=15）；信封 {meta:{count,current_page},payload}
 * - GET  /api/v1/accounts/{account_id}/contacts/search?q=               联系人搜索
 *        （contacts_controller.rb:39-46，name/email/phone_number/identifier ILIKE）
 * - POST /api/v1/accounts/{account_id}/contacts                         创建联系人（写）。
 *        源码中 inbox_id 可缺省（build_contact_inbox 对 blank 返回 nil，contacts_controller.rb:87,165-175），
 *        新建联系人 contact_type 置 lead（:87）
 * - PUT  /api/v1/accounts/{account_id}/contacts/{id}                    更新联系人（写）
 * - GET  /api/v1/accounts/{account_id}/inboxes                          收件箱列表；信封 {payload}
 * - GET  /api/v1/accounts/{account_id}/agents                           座席列表（裸数组）
 * - PATCH /api/v1/accounts/{account_id}/agents/{id}                     座席角色/可用性（写）。
 *        请求体必须带 agent 根键（agents_controller.rb:67 params.require(:agent)），
 *        availability 枚举 online|busy|offline，role 必填（agents_controller.rb:25-27,58）
 * - GET  /api/v1/accounts/{account_id}/teams                            团队列表（裸数组）
 * - 通用桥接：白名单转发的相对路径（默认只读白名单，见 DEFAULT_WHITELIST）
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ChatwootError } from "./chatwoot.js";
import type { ChatwootStore } from "./store.js";

/** chatwoot_api 白名单默认项：只读查询路径（{account_id} 会被替换为配置的账号 ID） */
export const DEFAULT_WHITELIST = [
  "GET:/api/v1/accounts/{account_id}/conversations",
  "GET:/api/v1/accounts/{account_id}/contacts",
  "GET:/api/v1/accounts/{account_id}/contacts/search",
  "GET:/api/v1/accounts/{account_id}/inboxes",
  "GET:/api/v1/accounts/{account_id}/agents",
  "GET:/api/v1/accounts/{account_id}/teams",
  "GET:/api/v1/profile",
];

const GENERIC_PATH_RE = /^\/(?!\/)[A-Za-z0-9\-._~/{}]*$/;

/** 白名单校验：返回 true 表示放行。规则 METHOD:路径前缀，前缀相等或路径位于前缀目录下均放行。 */
export function isWhitelisted(
  method: string,
  path: string,
  whitelist: string[] | "none",
  accountId: string
): { ok: boolean; reason?: string } {
  if (whitelist === "none") return { ok: false, reason: "CHATWOOT_API_WHITELIST=none，chatwoot_api 通用桥接已被配置禁用" };
  const rules = whitelist.length > 0 ? whitelist : DEFAULT_WHITELIST;
  for (const raw of rules) {
    const rule = raw.replace(/\{account_id\}/g, accountId);
    const sep = rule.indexOf(":");
    if (sep <= 0) continue;
    const m = rule.slice(0, sep).toUpperCase();
    const prefix = rule.slice(sep + 1);
    if (m !== method.toUpperCase()) continue;
    if (path === prefix || path.startsWith(prefix.endsWith("/") ? prefix : prefix + "/")) return { ok: true };
  }
  return {
    ok: false,
    reason:
      `路径不在白名单内（method=${method}）。默认白名单只放行只读查询：${rules.join("、")}。` +
      `要开放写路径，请在环境变量 CHATWOOT_API_WHITELIST 中追加 METHOD:路径前缀（例如 POST:/api/v1/accounts/${accountId}/conversations/{conversation_id}/messages）`,
  };
}

function textResult(payload: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2) }],
    isError,
  };
}

function errResult(e: unknown) {
  if (e instanceof ChatwootError) {
    const parts = [`Chatwoot 调用失败：${e.message}`];
    if (e.httpStatus !== undefined) parts.push(`HTTP ${e.httpStatus}`);
    if (e.hint) parts.push(`提示：${e.hint}`);
    return textResult(parts.join("；"), true);
  }
  return textResult(`工具执行异常：${(e as Error).message ?? String(e)}`, true);
}

/** 注册全部工具。依赖注入 ChatwootStore（ApiStore 或 MockChatwootStore），便于测试替换。 */
export function registerTools(server: McpServer, store: ChatwootStore, opts: { whitelist: string[] | "none"; accountId: string }): void {
  // ── 1. 会话查询 ─────────────────────────────────────────────────────────
  server.registerTool(
    "chatwoot_list_conversations",
    {
      title: "查询会话列表",
      description:
        "分页查询 Chatwoot 客服会话（GET /api/v1/accounts/{account_id}/conversations）。" +
        "status 默认 open（与真实接口一致），返回 {data:{meta:{各状态计数}, payload:[会话…]}}；" +
        "每条会话含状态、标签、指派、最新一条消息等。",
      inputSchema: {
        status: z.enum(["all", "open", "resolved", "pending", "snoozed"]).optional().describe("会话状态，默认 open"),
        assigneeType: z.enum(["me", "unassigned", "all", "assigned"]).optional().describe("按指派过滤，默认 all"),
        q: z.string().optional().describe("模糊搜索（联系人姓名/邮箱、标签等）"),
        inboxId: z.number().int().optional().describe("按收件箱 ID 过滤"),
        teamId: z.number().int().optional().describe("按团队 ID 过滤"),
        labels: z.string().optional().describe("按标签过滤，英文逗号分隔"),
        page: z.number().int().min(1).optional().describe("页码，默认 1"),
      },
    },
    async (args) => {
      try {
        return textResult(await store.listConversations(args));
      } catch (e) {
        return errResult(e);
      }
    }
  );

  // ── 2. 会话详情 ─────────────────────────────────────────────────────────
  server.registerTool(
    "chatwoot_get_conversation",
    {
      title: "查询会话详情",
      description:
        "查询单个会话的全部详情（GET /api/v1/accounts/{account_id}/conversations/{conversation_id}），" +
        "含联系人、指派、标签、自定义属性与最新一条消息。",
      inputSchema: {
        conversationId: z.number().int().positive().describe("会话 ID（列表里每条会话的 id 字段）"),
      },
    },
    async ({ conversationId }) => {
      try {
        return textResult(await store.getConversation(conversationId));
      } catch (e) {
        return errResult(e);
      }
    }
  );

  // ── 3. 消息历史 ─────────────────────────────────────────────────────────
  server.registerTool(
    "chatwoot_list_messages",
    {
      title: "查询会话消息历史",
      description:
        "查询会话内全部消息（GET /api/v1/accounts/{account_id}/conversations/{conversation_id}/messages）。" +
        "message_type：0=客户发来，1=座席回复，2=系统动态；private=true 的消息是内部备注。" +
        "真实接口限制：after 返回之后最多 100 条，before 返回之前最多 20 条。",
      inputSchema: {
        conversationId: z.number().int().positive().describe("会话 ID"),
        after: z.number().int().optional().describe("只取该消息 ID 之后的消息（增量拉取）"),
        before: z.number().int().optional().describe("只取该消息 ID 之前的消息（向前翻页）"),
      },
    },
    async ({ conversationId, after, before }) => {
      try {
        return textResult(await store.listMessages(conversationId, { after, before }));
      } catch (e) {
        return errResult(e);
      }
    }
  );

  // ── 4. 发送消息（写）────────────────────────────────────────────────────
  server.registerTool(
    "chatwoot_send_message",
    {
      title: "发送消息/回复（写操作）",
      description:
        "在会话中发送一条消息（POST /api/v1/accounts/{account_id}/conversations/{conversation_id}/messages，写操作）。" +
        "注意：message_type=outgoing（默认）会真实触达客户；private=true 只作为内部备注，客户看不到——" +
        "拿不准时先用 private=true 写内部备注。仅当会话状态不是 resolved 时才可对外回复。",
      inputSchema: {
        conversationId: z.number().int().positive().describe("会话 ID"),
        content: z.string().min(1).describe("消息内容"),
        messageType: z.enum(["outgoing", "incoming"]).optional().describe("outgoing=回复客户（默认），incoming=以客户视角录入（用于 API 渠道）"),
        private: z.boolean().optional().describe("true=内部备注（客户不可见），默认 false"),
        contentType: z.enum(["text", "input_email", "cards", "input_select", "form", "article"]).optional().describe("消息内容类型，默认 text"),
        contentAttributes: z.record(z.unknown()).optional().describe("随消息附带的属性对象"),
      },
    },
    async ({ conversationId, content, messageType, private: isPrivate, contentType, contentAttributes }) => {
      try {
        const res = await store.createMessage(conversationId, {
          content,
          messageType,
          private: isPrivate,
          contentType,
          contentAttributes,
        });
        return textResult({
          sent: true,
          note: isPrivate ? "已作为内部备注保存（客户不可见）" : "已作为对外回复发送（演示：写入演示数据；连真实实例时将真实触达客户）",
          message: res,
        });
      } catch (e) {
        return errResult(e);
      }
    }
  );

  // ── 5. 会话状态变更（写）────────────────────────────────────────────────
  server.registerTool(
    "chatwoot_set_conversation_status",
    {
      title: "变更会话状态（写操作）",
      description:
        "设置会话状态（POST /api/v1/accounts/{account_id}/conversations/{conversation_id}/toggle_status，写操作）。" +
        "open=重新打开，resolved=已解决，pending=待处理（如机器人应答中），snoozed=暂缓（可带 snoozedUntil，Unix 秒）。",
      inputSchema: {
        conversationId: z.number().int().positive().describe("会话 ID"),
        status: z.enum(["open", "resolved", "pending", "snoozed"]).describe("目标状态"),
        snoozedUntil: z.number().int().optional().describe("仅 status=snoozed 时有效：暂缓到该 Unix 时间戳（秒），缺省=客户下次回复时自动恢复"),
      },
    },
    async ({ conversationId, status, snoozedUntil }) => {
      try {
        const res = await store.setConversationStatus(conversationId, status, snoozedUntil);
        return textResult({ updated: true, status, conversation: res });
      } catch (e) {
        return errResult(e);
      }
    }
  );

  // ── 6. 会话标签：读 ─────────────────────────────────────────────────────
  server.registerTool(
    "chatwoot_list_conversation_labels",
    {
      title: "查询会话标签",
      description: "查询会话当前的全部标签（GET /api/v1/accounts/{account_id}/conversations/{conversation_id}/labels）。" +
        "写标签（chatwoot_set_conversation_labels）是整表覆盖语义，建议先读后写。",
      inputSchema: {
        conversationId: z.number().int().positive().describe("会话 ID"),
      },
    },
    async ({ conversationId }) => {
      try {
        return textResult(await store.listConversationLabels(conversationId));
      } catch (e) {
        return errResult(e);
      }
    }
  );

  // ── 7. 会话标签：写 ─────────────────────────────────────────────────────
  server.registerTool(
    "chatwoot_set_conversation_labels",
    {
      title: "设置会话标签（写操作）",
      description:
        "设置会话标签（POST /api/v1/accounts/{account_id}/conversations/{conversation_id}/labels，写操作）。" +
        "官方语义为整表覆盖：提交的列表会替换会话现有的全部标签——要追加请先用 chatwoot_list_conversation_labels 读出再合并提交。",
      inputSchema: {
        conversationId: z.number().int().positive().describe("会话 ID"),
        labels: z.array(z.string().min(1)).min(1).describe("标签列表（完整列表，将覆盖现有标签）"),
      },
    },
    async ({ conversationId, labels }) => {
      try {
        const res = await store.setConversationLabels(conversationId, labels);
        return textResult({ updated: true, overwrite_warning: "本操作已整表覆盖会话标签", labels: res });
      } catch (e) {
        return errResult(e);
      }
    }
  );

  // ── 8. 指派座席或团队（写）──────────────────────────────────────────────
  server.registerTool(
    "chatwoot_assign_conversation",
    {
      title: "指派会话给座席或团队（写操作）",
      description:
        "把会话指派给某个座席或某个团队（POST /api/v1/accounts/{account_id}/conversations/{conversation_id}/assignments，写操作）。" +
        "官方语义：assigneeId 与 teamId 同时提供时，座席指派优先生效（团队被忽略）。座席/团队 ID 可先查 chatwoot_list_agents / chatwoot_list_teams。",
      inputSchema: {
        conversationId: z.number().int().positive().describe("会话 ID"),
        assigneeId: z.number().int().optional().describe("座席（用户）ID"),
        teamId: z.number().int().optional().describe("团队 ID（同时给 assigneeId 时会被忽略）"),
      },
    },
    async ({ conversationId, assigneeId, teamId }) => {
      try {
        if (assigneeId === undefined && teamId === undefined) {
          return textResult("参数错误：assigneeId 与 teamId 至少提供一个", true);
        }
        const res = await store.assignConversation(conversationId, { assigneeId, teamId });
        return textResult({ updated: true, assigned: res });
      } catch (e) {
        return errResult(e);
      }
    }
  );

  // ── 9. 联系人列表 ───────────────────────────────────────────────────────
  server.registerTool(
    "chatwoot_list_contacts",
    {
      title: "查询联系人列表",
      description:
        "分页查询联系人（GET /api/v1/accounts/{account_id}/contacts）。" +
        "真实接口只返回「可解析联系人」（identifier/email/phone_number 至少有一项）且每页固定 15 条。",
      inputSchema: {
        page: z.number().int().min(1).optional().describe("页码，默认 1"),
      },
    },
    async ({ page }) => {
      try {
        return textResult(await store.listContacts(page));
      } catch (e) {
        return errResult(e);
      }
    }
  );

  // ── 10. 联系人搜索 ──────────────────────────────────────────────────────
  server.registerTool(
    "chatwoot_search_contacts",
    {
      title: "搜索联系人",
      description:
        "按关键词搜索联系人（GET /api/v1/accounts/{account_id}/contacts/search?q=）。" +
        "真实接口对姓名、邮箱、电话号码、外部标识符做模糊匹配。",
      inputSchema: {
        q: z.string().min(1).describe("搜索关键词（姓名/邮箱/电话/标识符片段）"),
        page: z.number().int().min(1).optional().describe("页码，默认 1"),
      },
    },
    async ({ q, page }) => {
      try {
        return textResult(await store.searchContacts(q, page));
      } catch (e) {
        return errResult(e);
      }
    }
  );

  // ── 11. 创建联系人（写）─────────────────────────────────────────────────
  server.registerTool(
    "chatwoot_create_contact",
    {
      title: "创建联系人（写操作）",
      description:
        "创建联系人（POST /api/v1/accounts/{account_id}/contacts，写操作）。" +
        "至少提供 name/email/phone_number 之一；inboxId 可选——提供后会在该收件箱下生成 contact_inbox（真实源码：缺省时新建的联系人标记为 lead）。",
      inputSchema: {
        name: z.string().optional().describe("姓名"),
        email: z.string().email().optional().describe("邮箱"),
        phoneNumber: z.string().optional().describe("电话（E.164 格式，如 +8613800000000）"),
        identifier: z.string().optional().describe("外部系统唯一标识符（如客户在自家系统里的用户 ID）"),
        inboxId: z.number().int().optional().describe("收件箱 ID（可选，提供后同时生成该收件箱的 contact_inbox）"),
        additionalAttributes: z.record(z.unknown()).optional().describe("附加属性对象（自由键值）"),
        customAttributes: z.record(z.unknown()).optional().describe("自定义属性对象（需与账号内自定义属性定义匹配）"),
      },
    },
    async ({ name, email, phoneNumber, identifier, inboxId, additionalAttributes, customAttributes }) => {
      try {
        if (!name && !email && !phoneNumber) {
          return textResult("参数错误：name / email / phoneNumber 至少提供一个", true);
        }
        const res = await store.createContact({ name, email, phoneNumber, identifier, inboxId, additionalAttributes, customAttributes });
        return textResult({ created: true, contact: res });
      } catch (e) {
        return errResult(e);
      }
    }
  );

  // ── 12. 更新联系人（写）─────────────────────────────────────────────────
  server.registerTool(
    "chatwoot_update_contact",
    {
      title: "更新联系人（写操作）",
      description: "更新联系人字段（PUT /api/v1/accounts/{account_id}/contacts/{id}，写操作）。至少提供一个要修改的字段。",
      inputSchema: {
        contactId: z.number().int().positive().describe("联系人 ID"),
        name: z.string().optional().describe("姓名"),
        email: z.string().email().optional().describe("邮箱"),
        phoneNumber: z.string().optional().describe("电话（E.164 格式）"),
        identifier: z.string().optional().describe("外部系统唯一标识符"),
        additionalAttributes: z.record(z.unknown()).optional().describe("附加属性对象（合并更新）"),
        customAttributes: z.record(z.unknown()).optional().describe("自定义属性对象（合并更新）"),
      },
    },
    async ({ contactId, name, email, phoneNumber, identifier, additionalAttributes, customAttributes }) => {
      try {
        const args = { name, email, phoneNumber, identifier, additionalAttributes, customAttributes };
        if (Object.values(args).every((v) => v === undefined)) {
          return textResult("参数错误：至少提供一个要修改的字段", true);
        }
        const res = await store.updateContact(contactId, args);
        return textResult({ updated: true, contact: res });
      } catch (e) {
        return errResult(e);
      }
    }
  );

  // ── 13. 收件箱列表 ──────────────────────────────────────────────────────
  server.registerTool(
    "chatwoot_list_inboxes",
    {
      title: "查询收件箱列表",
      description:
        "查询账号下全部收件箱（GET /api/v1/accounts/{account_id}/inboxes）。" +
        "收件箱 = 接入渠道（网站聊天/邮件/WhatsApp 等），会话都归属于某个收件箱。",
      inputSchema: {},
    },
    async () => {
      try {
        return textResult(await store.listInboxes());
      } catch (e) {
        return errResult(e);
      }
    }
  );

  // ── 14. 座席列表 ────────────────────────────────────────────────────────
  server.registerTool(
    "chatwoot_list_agents",
    {
      title: "查询座席列表",
      description:
        "查询账号下全部座席（GET /api/v1/accounts/{account_id}/agents）。" +
        "每个座席含 id、role（agent/administrator）、availability_status（online/busy/offline）、email 等，" +
        "用于指派会话或修改可用性前查 ID。",
      inputSchema: {},
    },
    async () => {
      try {
        return textResult(await store.listAgents());
      } catch (e) {
        return errResult(e);
      }
    }
  );

  // ── 15. 团队列表 ────────────────────────────────────────────────────────
  server.registerTool(
    "chatwoot_list_teams",
    {
      title: "查询团队列表",
      description: "查询账号下全部团队（GET /api/v1/accounts/{account_id}/teams），用于指派会话前查团队 ID。",
      inputSchema: {},
    },
    async () => {
      try {
        return textResult(await store.listTeams());
      } catch (e) {
        return errResult(e);
      }
    }
  );

  // ── 16. 座席可用性变更（写）─────────────────────────────────────────────
  server.registerTool(
    "chatwoot_set_agent_availability",
    {
      title: "修改座席可用性（写操作）",
      description:
        "修改座席的角色/可用性/自动离线（PATCH /api/v1/accounts/{account_id}/agents/{id}，写操作）。" +
        "availability：online=在线 busy=忙碌 offline=离线。真实接口要求请求体带 agent 根键且 role 必填——" +
        "不提供 role 时本工具会先查座席列表取其现有角色再提交（与界面一致：修改座席需要 administrator 角色的 token）。",
      inputSchema: {
        agentId: z.number().int().positive().describe("座席（用户）ID"),
        availability: z.enum(["online", "busy", "offline"]).describe("目标可用性状态"),
        role: z.enum(["agent", "administrator"]).optional().describe("角色（缺省时自动沿用该座席现有角色）"),
        autoOffline: z.boolean().optional().describe("离开时自动置为离线"),
      },
    },
    async ({ agentId, availability, role, autoOffline }) => {
      try {
        let effectiveRole = role;
        if (effectiveRole === undefined) {
          const agents = (await store.listAgents()) as Array<{ id: number; role: "agent" | "administrator" }>;
          const found = Array.isArray(agents) ? agents.find((a) => a.id === agentId) : undefined;
          if (!found) {
            return textResult(`座席 ${agentId} 不存在（已查 chatwoot_list_agents）`, true);
          }
          effectiveRole = found.role;
        }
        const res = await store.updateAgent(agentId, { role: effectiveRole, availability, autoOffline });
        return textResult({ updated: true, agent: res });
      } catch (e) {
        return errResult(e);
      }
    }
  );

  // ── 17. 通用桥接（白名单转发）───────────────────────────────────────────
  server.registerTool(
    "chatwoot_api",
    {
      title: "通用 API 桥接（白名单内）",
      description:
        "转发任意 Chatwoot Application API 请求到 <CHATWOOT_BASE_URL> 下的相对路径（自动带鉴权头与账号路径）。" +
        "用于接入本项目未内置的端点（如 /teams/{id}、报表、工作时间等）。安全护栏：只接受 / 开头的相对路径，" +
        "且必须命中 CHATWOOT_API_WHITELIST 白名单（默认只放行只读查询，见 README）；路径里的 {account_id} 会替换为配置的账号 ID。",
      inputSchema: {
        method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).describe("HTTP 方法"),
        path: z
          .string()
          .regex(GENERIC_PATH_RE, "必须是 / 开头的相对路径，只允许字母数字与 -._~/{} 字符")
          .describe("相对路径，如 /api/v1/accounts/{account_id}/teams/1 或 /api/v1/profile"),
        query: z.record(z.union([z.string(), z.number(), z.boolean()])).optional().describe("URL 查询参数"),
        body: z.unknown().optional().describe("请求体 JSON（POST/PUT/PATCH 时使用）"),
      },
    },
    async ({ method, path, query, body }) => {
      try {
        if (opts.whitelist === "none") {
          return textResult(`Chatwoot 调用失败：${isWhitelisted(method, path, opts.whitelist, opts.accountId).reason}`, true);
        }
        const effective = path.replace(/\{account_id\}/g, opts.accountId);
        const check = isWhitelisted(method, effective, opts.whitelist, opts.accountId);
        if (!check.ok) {
          return textResult(`Chatwoot 调用失败：${check.reason}`, true);
        }
        const res = await store.rawRequest(method, effective, query, body);
        return textResult(res);
      } catch (e) {
        return errResult(e);
      }
    }
  );
}
