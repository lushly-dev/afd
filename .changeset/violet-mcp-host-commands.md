---
"@lushly-dev/violet-server": patch
---

The MCP server no longer lists or runs `validate` and `doctor`, as the HTTP API already did: `validate` runs `pnpm test` on the server host and `doctor` inspects its environment. The CLI keeps both.
