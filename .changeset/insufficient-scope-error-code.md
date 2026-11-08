---
"@lushly-dev/afd-core": minor
---

Add `ErrorCodes.INSUFFICIENT_SCOPE` (`spec/authorization.md`, M6), the shared catalog's 47th code: a call whose token lacks a scope it needs, found after routing, with `details.scopes`. MCP authorization is specified for every language and implemented in Rust first; TypeScript does not implement it yet, so nothing in TypeScript emits the code today.
