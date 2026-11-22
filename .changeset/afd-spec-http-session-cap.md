---
"afd-spec": patch
---

[`authorization.md`](./authorization.md), "TypeScript", and [`error-codes.md`](./error-codes.md):
an HTTP session can be displaced only by its own owner's `initialize`. One owner holds at most
`maxSessionsPerOwner` sessions (default 100); at that quota or the session cap its least recently
used session is evicted, and an owner with none is refused while the store is full, with HTTP 503,
`Retry-After` and JSON-RPC `-32002` carrying the request's `id`. The MCP client reports that as the
retryable `SESSION_LIMIT_REACHED`. Additive, so the version stays.
