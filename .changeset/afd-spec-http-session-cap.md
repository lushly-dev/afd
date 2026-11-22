---
"afd-spec": patch
---

[`authorization.md`](./authorization.md), "TypeScript", and [`error-codes.md`](./error-codes.md):
an HTTP session can be displaced only by the same subject's `initialize`. One issuer and subject,
across its clients, holds at most `maxSessionsPerOwner` sessions (default 100); at that quota or the
session cap its least recently used session is evicted, and a subject with none is refused while the
store is full, with HTTP 503, `Retry-After` and JSON-RPC `-32000` carrying the request's `id` and
`data.code: "SESSION_LIMIT_REACHED"`. The MCP client reports that as the retryable
`SESSION_LIMIT_REACHED`, from that status and `data.code` only. Additive, so the version stays.
