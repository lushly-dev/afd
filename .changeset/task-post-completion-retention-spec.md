---
"afd-spec": patch
---

Clarify MCP task TTL semantics in `spec/command-metadata.md`: separate the execution run budget (default 1 hour, completing with `TIMEOUT` if still working when it elapses) from post-completion retention (default 1 hour after reaching a terminal state), advertising `runBudget + retention` at creation and tightening `ttlMs` to `(finishedAt - createdAt) + retention` on completion while preserving token-expiry grace caps.
