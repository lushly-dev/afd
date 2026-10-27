---
'@lushly-dev/afd-cli': minor
---

`afd call` approval flow (#417). New `--module <path>` (with `--export`) runs a call in-process on the registry a module exports. When such a call fails with `APPROVAL_REQUIRED`, the CLI prints the summary and expiry, asks `Approve? [y/N]` on a terminal, and on yes retries the same command and input with the server's `details.approvalToken` as `context.approval`. `--approve` approves without asking, once, and only with a token the server returned for this call; the CLI never makes one. With no terminal and no `--approve`, the `APPROVAL_REQUIRED` result is printed unchanged with exit code 1. Over MCP the CLI cannot deliver approval evidence (tool arguments never carry it and MCP has no trusted channel yet), so `--approve` is rejected there and the result is returned unchanged.
