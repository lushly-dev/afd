---
"@lushly-dev/afd-server": minor
"@lushly-dev/afd-client": minor
"@lushly-dev/afd-cli": minor
---

Enforce `confirmPrompt` (`spec/command-metadata.md`, "Confirmations").

- **Server:** `createMcpServer` and `createMcpHandler` take `confirmations` (`'off'` by default, `'enforce'` or `'require-human'`) and `confirmationKey`. A call that reaches a command with `confirmPrompt` runs only after the user accepts an MCP elicitation, through an `input_required` result on `/mcp` or a server-side elicitation on a 2025 stdio connection. Under `'enforce'` the caller can instead acknowledge: `confirm: true` on the tool, `afd-call` or a grouped tool, `confirm: [names]` on `afd-batch` and `afd-pipe`, `_meta["dev.afd/confirm"]`, or the `Afd-Confirm` header on `/rpc`, `/batch` and `/stream`. Otherwise the call fails with `CONFIRMATION_REQUIRED` or `CONFIRMATION_DECLINED` before the handler runs. Gated tools advertise the optional `confirm` argument.
- **Client:** `McpClient` takes `onElicitation` to answer servers' form elicitations on the `streamable-http` transport. Without it, an `input_required` result becomes an `INPUT_REQUIRED` failure carrying the server's `inputRequests`.
- **CLI:** at a terminal, the CLI asks a server's yes/no elicitation (`[y/N]`) on stderr; otherwise it declares no elicitation, so the server's error explains how to acknowledge.
