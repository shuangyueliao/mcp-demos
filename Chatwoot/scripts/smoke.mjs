/**
 * 冒烟测试（任务要求的最小验证）：用真实 MCP 客户端经 stdio 连接本 server，
 * 完成 initialize 握手并列出 tools，断言 17 个工具齐全。⚠️ 演示项目，非客户案例。
 *
 * 运行：npm run smoke（内置 mock 数据层，不需要任何 Chatwoot 实例）
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXPECTED = [
  "chatwoot_list_conversations",
  "chatwoot_get_conversation",
  "chatwoot_list_messages",
  "chatwoot_send_message",
  "chatwoot_set_conversation_status",
  "chatwoot_list_conversation_labels",
  "chatwoot_set_conversation_labels",
  "chatwoot_assign_conversation",
  "chatwoot_list_contacts",
  "chatwoot_search_contacts",
  "chatwoot_create_contact",
  "chatwoot_update_contact",
  "chatwoot_list_inboxes",
  "chatwoot_list_agents",
  "chatwoot_list_teams",
  "chatwoot_set_agent_availability",
  "chatwoot_api",
];

const transport = new StdioClientTransport({
  command: "node",
  args: [join(root, "dist", "index.js")],
  env: {
    ...process.env,
    CHATWOOT_MOCK: process.env.CHATWOOT_MOCK ?? "true",
  },
});

const client = new Client({ name: "smoke-test", version: "0.0.1" });
await client.connect(transport);

const { tools } = await client.listTools();
const names = tools.map((t) => t.name).sort();
const missing = EXPECTED.filter((n) => !names.includes(n));

console.log(`tools/list 返回 ${tools.length} 个工具：`);
for (const t of tools) console.log(`  - ${t.name}: ${(t.description ?? "").slice(0, 60)}...`);

if (missing.length > 0 || tools.length !== EXPECTED.length) {
  console.error(`FAIL：缺少工具 [${missing.join(", ")}]`);
  process.exit(1);
}
console.log("PASS：initialize + tools/list 正常，17 个工具齐全");
await client.close();
process.exit(0);
