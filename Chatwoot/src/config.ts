/**
 * 环境变量配置。⚠️ 演示项目，非客户案例。
 *
 * 全部通过进程环境变量传入（Claude Desktop / Claude Code 的 mcpServers.env、
 * 或启动命令前 export），不读取 .env 文件，避免 demo 引入额外依赖。
 *
 * 数据层双模式：
 * - CHATWOOT_MOCK=true（默认）：使用 src/mock.ts 内置演示数据，不需要任何真实 Chatwoot 实例；
 * - CHATWOOT_MOCK=false：走真实 Chatwoot Application API（应用接口），需 CHATWOOT_BASE_URL。
 */
export interface Config {
  /** 数据层是否用内置 mock */
  mock: boolean;
  /** Chatwoot 根地址（真实模式必填），如 https://support.yourcompany.com */
  baseUrl?: string;
  /** 用户 API token（Profile Settings 里生成） */
  apiAccessToken?: string;
  /** Chatwoot 账号 ID，URL /app/accounts/<数字>/ 可见，单账号自托管通常为 1 */
  accountId: string;
  /** 鉴权头：header = api_access_token（默认，全版本可用）；bearer = Authorization: Bearer（v4.19.0+） */
  authStyle: "header" | "bearer";
  /** 通用桥接白名单（METHOD:路径前缀）。空 = 默认只读白名单；"none" = 禁用桥接 */
  apiWhitelist: string[] | "none";
  /** --http 模式的监听端口 */
  httpPort: number;
  /** 是否 HTTP 模式 */
  httpMode: boolean;
}

export function loadConfig(argv: string[] = process.argv.slice(2)): Config {
  const mockEnv = (process.env.CHATWOOT_MOCK ?? "true").toLowerCase();
  const mock = mockEnv !== "false" && mockEnv !== "0" && mockEnv !== "no";
  const baseUrl = (process.env.CHATWOOT_BASE_URL ?? "").replace(/\/+$/, "") || undefined;
  const authEnv = (process.env.CHATWOOT_AUTH ?? "header").toLowerCase();
  const authStyle: "header" | "bearer" = authEnv === "bearer" ? "bearer" : "header";

  if (!mock && !baseUrl) {
    // stdio 模式下写 stderr，不会污染 stdout 的 JSON-RPC 通道
    console.error(
      "[chatwoot-mcp-bridge] CHATWOOT_MOCK=false 时必须提供 CHATWOOT_BASE_URL（Chatwoot 根地址，如 https://support.yourcompany.com）；" +
        "如只想跑通演示，请设 CHATWOOT_MOCK=true 或不设（默认 mock）"
    );
    process.exit(1);
  }
  if (!mock && !process.env.CHATWOOT_API_ACCESS_TOKEN) {
    console.error(
      "[chatwoot-mcp-bridge] 真实模式缺少 CHATWOOT_API_ACCESS_TOKEN：登录 Chatwoot → 个人资料设置（Profile Settings）→ 复制 API token"
    );
    process.exit(1);
  }

  // 白名单：空 = 默认只读白名单（tools.ts DEFAULT_WHITELIST 同步维护）；none = 禁用
  const wlRaw = (process.env.CHATWOOT_API_WHITELIST ?? "").trim();
  const apiWhitelist: string[] | "none" = wlRaw.toLowerCase() === "none" ? "none" : wlRaw ? wlRaw.split(",").map((s) => s.trim()).filter(Boolean) : [];

  return {
    mock,
    baseUrl,
    apiAccessToken: process.env.CHATWOOT_API_ACCESS_TOKEN || undefined,
    accountId: process.env.CHATWOOT_ACCOUNT_ID ?? "1",
    authStyle,
    apiWhitelist,
    httpMode: argv.includes("--http"),
    httpPort: Number(process.env.CHATWOOT_MCP_HTTP_PORT ?? 3002),
  };
}
