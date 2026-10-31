# MCP Bridges — Showcase: Chatwoot (17 tools, stdio + HTTP, e2e-tested)

TypeScript MCP (Model Context Protocol) bridges that let AI agents operate real
open-source business systems through typed, guarded tools.

This public repo contains the **Chatwoot bridge** as a fully runnable sample.
Commercial builds for **JeecgBoot / jshERP / RuoYi-Vue / FastAdmin** are
delivered via license (see bottom).

## What's in this repo

`chatwoot-mcp-bridge` — 17 tools covering conversations, messages, contacts,
inboxes, agents, teams, labels and a guarded passthrough `chatwoot_api`.
Runs against a real Chatwoot Application API, or `CHATWOOT_MOCK=true` for a
zero-dependency demo data layer.

```bash
cd Chatwoot && npm install && npm run build && npm run smoke   # smoke: PASS
npm run e2e                                                     # 50 assertions, 0 failures
```

- Transports: stdio (Claude Desktop / any MCP client) and HTTP (`--http`, for URL-based clients such as 扣子/Coze)
- Guardrails: path allowlist for the passthrough tool, credential isolation, clean JSON-RPC errors with actionable diagnostics
- Verified by three independent layers: built-in smoke (official MCP SDK client), e2e (mock backend, login + tool round-trips + HTTP mode), and a raw JSON-RPC probe

## Commercial builds (license)

| Bridge | Tools | e2e assertions | Delivered as |
|---|---|---|---|
| JeecgBoot | 10 | 24 | source + dist + docs, license per org |
| jshERP（管伊佳ERP） | 10 | 27 | same |
| RuoYi-Vue（若依） | 13 | 31 | same |
| FastAdmin | 11 | 36 | same |

License: single-organization use, no redistribution/resale, 12 months of bugfix
updates, full refund within 7 days if it doesn't run in your environment per
the docs. Custom integration into your private system (real auth, extra tool
surface): from ¥3,000.

These are self-developed standardized builds (demos, not client case studies).
Contact: open a GitHub issue or reach the author directly.
