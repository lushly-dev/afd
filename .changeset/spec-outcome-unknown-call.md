---
"afd-spec": patch
---

`spec/error-codes.md` updates the TypeScript MCP client `OUTCOME_UNKNOWN` entry to cover single `call()` requests not positively declared read-only (`_meta.mutation: false`), in addition to `batch` and `pipeline` (#1750).
