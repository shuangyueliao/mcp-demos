/**
 * Chatwoot Application API（应用接口）HTTP 客户端。⚠️ 演示项目，非客户案例。
 *
 * 所有端点形态均对照官方材料核实（2026-10-30 实抓）：
 * - 官方 OpenAPI 规范 https://raw.githubusercontent.com/chatwoot/chatwoot/develop/swagger/tag_groups/application_swagger.json
 *   （developers.chatwoot.com 各 API 页内嵌的同一份规范）：
 *   · 鉴权 securitySchemes：`api_access_token` 请求头（官方注明"仍支持、未来弃用"）与
 *     `Authorization: Bearer <token>`（官方注明 v4.19.0 起可用）两种并存；
 *   · 路径：/api/v1/accounts/{account_id}/conversations[...]、/contacts[...]、/agents[...]、
 *     /inboxes、/teams，均在本文件对应方法处逐一标注。
 * - 源码（chatwoot/chatwoot develop 分支，2026-10-30 抓取）：
 *   · app/controllers/api/v1/accounts/agents_controller.rb:25-27,67 —— PATCH agents/{id} 的
 *     请求体必须带 `agent` 根键（params.require(:agent)），role/availability/auto_offline 落在
 *     account_user（:58 account_user_attributes）；
 *   · app/controllers/api/v1/accounts/conversations_controller.rb:83-89 —— toggle_status 按
 *     params[:status] 显式置状态（open/resolved/pending/snoozed，枚举见 swagger）；
 *   · app/controllers/api/v1/accounts/conversations/assignments_controller.rb:6-16 ——
 *     assignments 传 assignee_id 时优先指派座席，否则按 team_id 指派团队；
 *   · app/controllers/api/v1/accounts/contacts_controller.rb:85-93,165-175 —— create 时
 *     inbox_id 可缺省（build_contact_inbox 在 blank 时返回 nil），新建联系人 contact_type 置 lead；
 *     :12 RESULTS_PER_PAGE = 15（联系人分页每页 15 条）；search 对 name/email/phone_number/
 *     identifier 做 ILIKE 模糊匹配；
 * - 响应信封（同一批 jbuilder 实抓）：
 *   · 会话列表 {data:{meta:{mine_count,assigned_count,unassigned_count,all_count}, payload:[…]}}
 *     （app/views/api/v1/accounts/conversations/index.json.jbuilder）
 *   · 消息列表 {meta:{labels,contact,assignee,…}, payload:[…]}
 *     （app/views/api/v1/accounts/conversations/messages/index.json.jbuilder）
 *   · 联系人列表 {meta:{count,current_page}, payload:[…]}
 *     （app/views/api/v1/accounts/contacts/index.json.jbuilder）
 *   · 收件箱列表 {payload:[…]}；座席/团队列表为裸数组
 *     （各自 index.json.jbuilder）
 * 与 JeecgBoot 的 Result 信封不同：Chatwoot 各资源信封形状不一，本客户端不做统一解包，原样返回 JSON。
 */

export class ChatwootError extends Error {
  /** HTTP 状态码（如 401 token 失效、403 角色不足、404 资源不存在） */
  httpStatus?: number;
  hint?: string;

  constructor(message: string, opts: { httpStatus?: number; hint?: string } = {}) {
    super(message);
    this.name = "ChatwootError";
    this.httpStatus = opts.httpStatus;
    this.hint = opts.hint;
  }
}

export interface ChatwootRequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}

export class ChatwootClient {
  constructor(
    private readonly baseUrl: string,
    private readonly accountId: string,
    private readonly token: string,
    private readonly authStyle: "header" | "bearer" = "header"
  ) {}

  /** 统一拼接 /api/v1/accounts/{accountId}/… 下的相对路径 */
  accountPath(suffix: string): string {
    return `/api/v1/accounts/${encodeURIComponent(this.accountId)}${suffix}`;
  }

  private buildUrl(path: string, query?: ChatwootRequestOptions["query"]): URL {
    // 只允许相对路径，始终打到配置好的 Chatwoot 主机
    const url = new URL(path.startsWith("/") ? path : `/${path}`, this.baseUrl.endsWith("/") ? this.baseUrl : this.baseUrl + "/");
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
      }
    }
    return url;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = {
      Accept: "application/json",
      ...extra,
    };
    if (this.authStyle === "bearer") h["Authorization"] = `Bearer ${this.token}`;
    else h["api_access_token"] = this.token;
    return h;
  }

  /** 发起请求。Chatwoot 各资源信封形状不一，原样返回解析后的 JSON。 */
  async request<T = unknown>(path: string, opts: ChatwootRequestOptions = {}): Promise<T> {
    const method = opts.method ?? "GET";
    const url = this.buildUrl(path, opts.query);
    // 同源防线：无论 path 怎么构造（协议相对路径 //evil.com、.. 回溯等），只允许打到配置的 Chatwoot 主机
    if (url.origin !== new URL(this.baseUrl).origin) {
      throw new ChatwootError(`拒绝请求：路径 ${path} 解析后离开了配置的 Chatwoot 主机（防 SSRF）`, {
        hint: "chatwoot_api 只接受相对路径",
      });
    }
    const headers = this.headers(opts.body !== undefined ? { "Content-Type": "application/json" } : undefined);

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
    } catch (e) {
      throw new ChatwootError(`无法连接 Chatwoot：${(e as Error).message}`, {
        hint: `请确认 CHATWOOT_BASE_URL=${this.baseUrl} 正确且服务可达（可先在浏览器打开 ${this.baseUrl}/api/v1/profile 看是否返回 401 而非超时）`,
      });
    }

    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      throw new ChatwootError(`Chatwoot 返回了非 JSON 响应（HTTP ${res.status}）：${text.slice(0, 300)}`, {
        httpStatus: res.status,
        hint: "检查 CHATWOOT_BASE_URL 是否指向 Chatwoot 根地址（不应包含 /api/v1 后缀）",
      });
    }

    if (res.status === 401) {
      throw new ChatwootError("鉴权失败（HTTP 401）", {
        httpStatus: 401,
        hint: "检查 CHATWOOT_API_ACCESS_TOKEN：登录 Chatwoot → 个人资料设置（Profile Settings）→ 复制 API token；或确认 CHATWOOT_AUTH 鉴权头格式（bearer 需 Chatwoot v4.19.0+）",
      });
    }
    if (res.status === 403) {
      throw new ChatwootError("访问被拒绝（HTTP 403）", {
        httpStatus: 403,
        hint: "token 所属用户的角色权限不足：部分操作（如修改座席角色/可用性）与界面一致，需要 administrator（管理员）角色的 token",
      });
    }
    if (res.status === 404) {
      throw new ChatwootError(`资源不存在（HTTP 404）：${method} ${path}`, {
        httpStatus: 404,
        hint: "检查 ID 是否正确、CHATWOOT_ACCOUNT_ID 是否为该 token 可见的账号",
      });
    }
    if (!res.ok) {
      const detail = typeof json === "object" && json !== null ? JSON.stringify(json).slice(0, 300) : text.slice(0, 300);
      throw new ChatwootError(`Chatwoot 返回错误（HTTP ${res.status}）：${detail}`, { httpStatus: res.status });
    }
    return json as T;
  }
}
