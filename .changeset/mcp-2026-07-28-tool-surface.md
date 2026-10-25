---
"@lushly-dev/afd-core": minor
"@lushly-dev/afd-server": minor
---

Report standard MCP tool fields from command metadata (`spec/command-metadata.md`, "MCP tool fields").

- Individual command tools carry MCP `annotations`: `mutation: false` gives `readOnlyHint: true`; `mutation: true` gives `readOnlyHint: false` and `destructiveHint` from `destructive`. An unset `mutation` claims nothing.
- Every `tools/call` result for a command, batch or pipeline carries the result as `structuredContent` as well as text.
- Individual command tools with an `output` schema advertise a top-level `outputSchema`: the CommandResult envelope with `data` typed by that schema. MCP clients validate `structuredContent` against it, so a handler whose data does not match its declared output schema now fails on the client; `advertiseOutputSchema: false` switches it off. `_meta.outputSchema` is unchanged.
- Core: `commandToolAnnotations` and `commandResultOutputSchema` helpers, `annotations`/`outputSchema` on `McpTool`, `structuredContent` on `McpToolCallResult`, and the MCP 2026-07-28 error codes `HEADER_MISMATCH`, `MISSING_REQUIRED_CLIENT_CAPABILITY` and `UNSUPPORTED_PROTOCOL_VERSION`. `SERVER_NOT_INITIALIZED` is deprecated.
