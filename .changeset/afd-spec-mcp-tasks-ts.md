---
"afd-spec": patch
---

[`command-metadata.md`](./command-metadata.md), "Implementation status", and
[`error-codes.md`](./error-codes.md), "MCP client": record the TypeScript MCP Tasks implementation
(`TaskSupport`, `TaskStore`, `tasks/*`, client polling, and the shared todo `--suite tasks`
acceptance suite across TypeScript and Rust) and add `MISSING_CLIENT_CAPABILITY` (`-32021`,
non-retryable) for servers requiring an undeclared client capability such as
`io.modelcontextprotocol/tasks`. Additive, so the version stays.
