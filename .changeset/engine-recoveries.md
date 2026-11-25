---
"@lushly-dev/afd-core": minor
"@lushly-dev/afd-server": minor
"@lushly-dev/afd-client": minor
---

The errors the engines emit carry a structured `recovery` beside their `suggestion` (`spec/recovery.md`, "Engine errors"), and a suggestion names `afd-discover`, `afd-help` or `afd-context-list` only where the caller can call it:
- `COMMAND_NOT_FOUND` recovers with `afd-discover` over MCP, or `afd-help` in process when it is callable; the in-process `server.execute` and the HTTP `/rpc`, `/batch` and `/stream` lanes no longer suggest `afd-discover`, which they do not serve. The core registry's is `external`.
- `COMMAND_NOT_IN_CONTEXT` and `CONTEXT_NOT_FOUND` recover with `afd-context-list`, and `CONTEXT_DEPTH_EXCEEDED` with `afd-context-exit` then a retry, each only when the caller can call it.
- `COMMAND_NOT_EXPOSED`, `CALL_NOT_GRANTED`, `CONFIRMATION_REQUIRED`, an approval a person must give, and `APPROVAL_UNAVAILABLE`'s `no-approval-step` and `admission-mismatch` are `external`.
- `CONFIRMATION_DECLINED` and a declined approval are `stop`, a DirectClient's `onApprovalNeeded` that answers `false` included, whose suggestion now says not to retry. A hook that throws, rejects or gives no boolean is not a decline: the call stays held, `external`, with its own suggestion.
- `RATE_LIMITED` from the middleware and the task limit is `retry`, with `afterMs` when the window's end is known; `rateLimitError()` sets the same, rounding the wait up to a whole millisecond.
- The default MCP instructions say what `error.recovery` is beside the prose.
