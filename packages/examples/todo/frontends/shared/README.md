# The to-do frontends' shared modules

Plain TypeScript, no framework, used by both frontends so they differ only in how they render:

| Module | What it is |
|--------|------------|
| `src/client.ts` | MCP over Streamable HTTP on `/mcp`, reading each command's structured `CommandResult`, and answering the server's form elicitations (approvals and confirmations) through the page |
| `src/session.ts` | The page's state and actions: the list, the deleted list, history, the command log, the trust summary, undo offers, approvals, errors with retry, and other clients' changes |
| `src/view-state.ts` | The `todo-filter` view state, and the `view-state-*` commands that serve it in the page, so an agent can narrow the view (job 6) |
| `src/trust.ts` | A result's confidence, reasoning, warnings, sources, alternatives and undo |

`pnpm test` runs the view-state job and the session against a real TypeScript backend over HTTP
(build `../../backends/typescript` first). `scenarios/` holds job 6.
