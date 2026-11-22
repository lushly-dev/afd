---
"afd-spec": patch
---

[`authorization.md`](./authorization.md), "TypeScript", and [`error-codes.md`](./error-codes.md):
an HTTP session can be displaced only by its own owner's `initialize`. At the session cap the
owner's least recently used session is evicted, and an owner with none is refused with HTTP 503
and JSON-RPC `-32000` (`REQUEST_REJECTED` in the client) rather than another owner's session being
evicted. Additive, so the version stays.
