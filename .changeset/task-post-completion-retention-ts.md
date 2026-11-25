---
"@lushly-dev/afd-server": minor
---

Separate MCP task execution run budget (`maxRunMs`, default 1 hour via `DEFAULT_TASK_MAX_RUN_MS`) from post-completion retention (`ttlMs`, default 1 hour). A new task starts with `ttlMs = maxRunMs + ttlMs` (2 hours by default) and atomically tightens `ttlMs` on terminal transition to `(finishedAt - createdAt) + ttlMs` (capped at `tokenExpiryGraceMs` when configured), so results remain readable for a full hour after completion even when a task finishes near the end of its run budget. Tasks still working when `maxRunMs` elapses stop and complete with `TIMEOUT` (`retryable: true` for reads, `false` for started mutations), retained for `ttlMs`.
