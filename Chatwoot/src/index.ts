/**
 * 入口。⚠️ 演示项目，非客户案例。
 *
 *   node dist/index.js          → stdio 模式（Claude Desktop / Claude Code）
 *   node dist/index.js --http   → Streamable HTTP 会话模式（扣子等需要 URL 的客户端）
 *
 * HTTP 模式采用会话（session）方式：每个会话独立一套 McpServer + transport
 * （与 mcp-demos/JeecgBoot 同构）。mock 模式下每个会话共享同一份内置演示数据；
 * API 模式下每个会话各自持有客户端实例，token 来自环境变量。
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { randomUUID } from "node:crypto";
import { loadConfig, type Config } from "./config.js";
import { ChatwootClient } from "./chatwoot.js";
import { ApiStore, type ChatwootStore } from "./store.js";
import { MockChatwootStore } from "./mock.js";
import { registerTools } from "./tools.js";

function buildStore(cfg: Config): ChatwootStore {
  if (cfg.mock) {
    return new MockChatwootStore(cfg.accountId);
  }
  const client = new ChatwootClient(cfg.baseUrl!, cfg.accountId, cfg.apiAccessToken!, cfg.authStyle);
  return new ApiStore(client);
}

function buildServer(cfg: Config): McpServer {
  const store = buildStore(cfg);
  const server = new McpServer(
    {
      name: "chatwoot-mcp-bridge",
      version: "0.1.0",
    },
    {
      instructions: cfg.mock
        ? "这是某台 Chatwoot 客服系统的 MCP 桥，当前运行在内置 mock 演示数据上（CHATWOOT_MOCK 默认 true，非真实客户数据）。" +
          "典型流程：先 chatwoot_list_conversations 看待处理会话 → chatwoot_get_conversation / chatwoot_list_messages 看详情 → " +
          "回复/改状态/打标签/指派等写操作请向用户逐项确认（对外回复会真实触达客户）。"
        : "这是某台 Chatwoot 客服系统的 MCP 桥（已连真实实例，CHATWOOT_MOCK=false）。" +
          "写操作（发消息、改状态、打标签、指派、改联系人/座席）会真实生效且对外回复会真实触达客户，执行前务必与用户逐项确认。",
    }
  );
  registerTools(server, store, { whitelist: cfg.apiWhitelist, accountId: cfg.accountId });
  return server;
}

async function runStdio(cfg: Config): Promise<void> {
  const server = buildServer(cfg);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  const mode = cfg.mock ? `mock 演示数据（CHATWOOT_MOCK=true，账号 ID ${cfg.accountId}）` : `真实实例 ${cfg.baseUrl}（账号 ID ${cfg.accountId}）`;
  console.error(`[chatwoot-mcp-bridge] stdio 模式已启动，数据层：${mode}。⚠️ 演示项目，非客户案例`);
}

async function runHttp(cfg: Config): Promise<void> {
  const app = express();
  app.use(express.json());

  // 会话模式：每个 MCP 会话一套 server+transport（与 JeecgBoot demo 同构）
  const sessions = new Map<string, { server: McpServer; transport: StreamableHTTPServerTransport }>();

  app.post("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const existing = sessionId ? sessions.get(sessionId) : undefined;
    if (existing) {
      await existing.transport.handleRequest(req, res, req.body);
      return;
    }
    const server = buildServer(cfg);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
      void server.close();
    };
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    if (transport.sessionId) sessions.set(transport.sessionId, { server, transport });
  });

  app.get("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const existing = sessionId ? sessions.get(sessionId) : undefined;
    if (!existing) {
      res.status(400).json({ error: "无有效会话（需先 POST initialize）" });
      return;
    }
    await existing.transport.handleRequest(req, res, req.body);
  });

  app.delete("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const existing = sessionId ? sessions.get(sessionId) : undefined;
    if (!existing) {
      res.status(400).json({ error: "无有效会话" });
      return;
    }
    await existing.transport.close();
    res.status(204).end();
  });

  app.listen(cfg.httpPort, () => {
    const mode = cfg.mock ? "mock 演示数据" : `真实实例 ${cfg.baseUrl}`;
    console.error(
      `[chatwoot-mcp-bridge] HTTP 模式已启动：http://localhost:${cfg.httpPort}/mcp （扣子等 URL 型客户端用这个地址；数据层：${mode}）。⚠️ 演示项目，非客户案例`
    );
  });
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  if (cfg.httpMode) {
    await runHttp(cfg);
  } else {
    await runStdio(cfg);
  }
}

main().catch((e) => {
  console.error("[chatwoot-mcp-bridge] 启动失败：", e);
  process.exit(1);
});
