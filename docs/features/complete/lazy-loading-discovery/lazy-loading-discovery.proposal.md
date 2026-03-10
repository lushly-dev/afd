# Feature Proposal: Lazy-Loading Discovery

> Proposal: A third tool strategy (`'lazy'`) that defers schema loading until the agent requests it

---
status: complete
created: 2026-01-15
origin: Context window pressure — individual strategy loads every command schema at enumeration, consuming agent context. Grouped strategy reduces this but loses per-command schemas.
effort: M (3-5 days)
package: "@lushly-dev/afd-server"
depends-on: none
---

## 1. Summary
Implement a lazy-loading documentation pattern for AFD MCP servers to defer context loading until the agent needs it, solving context scaling problems for large command sets.

## 2. Motivation
AFD's individual tool strategy loads every command schema into the agent context at enumeration time. While the grouped strategy reduces this, it loses per-command schemas. As the number of commands grows, this consumes a significant portion of the agent's context window.

## 3. Proposed Solution
Adapt the three-tool pattern (start → docs → run) from Botcore for public servers:
- Add a `discover` tool that returns command names and one-line summaries (lightweight).
- Add a `detail` tool that returns the full schema and documentation for a specific command on demand.
- Add a universal `afd-call` dispatcher available in all strategies.
- Ensure `discover` and `detail` return proper `CommandResult` objects with reasoning and confidence.

This allows agents to choose their own strategy: context-efficient discovery (discover → detail → call) or direct typed tools for simple integrations.

## 4. Breaking Changes
**None.** This adds `discover`, `detail`, and `afd-call` tools alongside existing ones. The current tools and `createMcpServer` contract remain unchanged.

## 5. Alternatives Considered
- Forcing all agents to use grouped tools, which degrades the developer experience for simple integrations.

## 6. Current Codebase Notes

The following are already implemented and provide foundation:
- `afd-batch` and `afd-pipe` built-in tools (in `tools.ts` and `tool-router.ts`)
- `afd-help`, `afd-schema`, `afd-docs` bootstrap commands (opt-in, not built-in tools)
- `toolStrategy: 'individual' | 'grouped'` in `McpServerOptions` (needs `'lazy'` added)
- Tool list generation in `tools.ts` with `getToolsList()` (needs lazy strategy branch)
- Tool routing in `tool-router.ts` with `createToolRouter()` (needs `afd-call` handler)
- Similarity matching exists in `packages/client/src/direct.ts` (needs extraction to core for reuse)

## 7. Full spec
See [lazy-loading-discovery.spec.md](lazy-loading-discovery.spec.md).
