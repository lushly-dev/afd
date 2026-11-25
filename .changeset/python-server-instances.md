---
"afd-python": minor
---

### Added

- **`instances` server option (`"single" | "multiple"`) and `confirmation_key` validation ([#2242](https://github.com/lushly-dev/afd/issues/2242)).** `create_server(..., instances="multiple")` raises `ValueError` when confirmations, `relay="mcp-elicitation"`, or single-use approval middleware (directly or inside `compose_middleware`) rely on per-process defaults without a shared `confirmation_key` or `nonce_store`. When omitted, serving over HTTP logs one warning per process to stderr (`instances="single"` silences it; stdio logs nothing). `confirmation_key` (at least 32 bytes) is validated and copied at server creation.
