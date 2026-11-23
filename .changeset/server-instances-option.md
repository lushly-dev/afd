---
'@lushly-dev/afd-server': minor
---

`createMcpServer` and `createMcpHandler` take `instances: 'single' | 'multiple'`, which says how many processes serve the server's URL. Two things are per process unless the host shares them: the key that signs elicitation `requestState` (`confirmationKey`, else a random key per process) and the spent single-use tokens of each `createApprovalMiddleware` (`nonceStore`, else memory).

- `instances: 'multiple'`: creating the server throws, naming what to supply, when `confirmations` is on or an approval middleware has `relay: 'mcp-elicitation'` without a `confirmationKey`, or when a single-use approval middleware has no `nonceStore`.
- Left out, a server served over HTTP (`start()` on the HTTP transport, or `createMcpHandler`) logs one warning to stderr, once per process, when it relies on either default; stdio logs nothing. `instances: 'single'` silences it and still validates a supplied `confirmationKey`.
- `confirmationKey` is checked when the server is created: a string or `Uint8Array` of at least 32 bytes, as approval secrets, and a copy is kept. A shorter key used to fail only on the first elicitation.

An approval middleware is seen in `middleware` directly or inside `composeMiddleware`, including one made by another installed copy of the package from this version on (older copies do not mark theirs); one inside another wrapper is not. The default key is random per server or handler, so two handlers in one process do not share it either. The server README's new "Several instances" section has the details.

The check is TypeScript only for now: the Python and Rust servers have the same two defaults (a random `requestState` key and in-memory approval nonces) and no `instances` option yet.
