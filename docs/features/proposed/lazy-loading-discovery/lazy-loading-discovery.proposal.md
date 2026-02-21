# Feature Proposal: Lazy-Loading Discovery

## 1. Summary
Implement a lazy-loading documentation pattern for AFD MCP servers to defer context loading until the agent needs it, solving context scaling problems for large command sets.

## 2. Motivation
AFD's individual tool strategy loads every command schema into the agent context at enumeration time. While the grouped strategy reduces this, it loses per-command schemas. As the number of commands grows, this consumes a significant portion of the agent's context window.

## 3. Proposed Solution
Adapt the three-tool pattern (start → docs → run) from Botcore for public servers:
- Add a `discover` tool that returns command names and one-line summaries (lightweight).
- Add a `detail` tool that returns the full schema and documentation for a specific command on demand.
- Retain individual tools for direct invocation with validation.
- Ensure `discover` and `detail` return proper `CommandResult` objects with reasoning and confidence.

This allows agents to choose their own strategy: context-efficient discovery (discover → detail → call) or direct typed tools for simple integrations.

## 4. Breaking Changes
**None.** This adds `discover` and `detail` tools alongside existing ones. The current tools and `createMcpServer` contract remain unchanged.

## 5. Alternatives Considered
- Forcing all agents to use grouped tools, which degrades the developer experience for simple integrations.

## 6. Full spec
See [lazy-loading-discovery.spec.md](lazy-loading-discovery.spec.md).
