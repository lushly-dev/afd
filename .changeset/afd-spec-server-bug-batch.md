---
"afd-spec": patch
---

[`mcp-resources.md`](./mcp-resources.md), "Implementation status", and
[`mcp-resources.json`](./mcp-resources.json), `catalogFailures`: record that TypeScript's
`SkillCatalog` enforces the S2 RFC 3986 §6.2.2 manifest boundary alongside Rust (`rmcp`), and add
the `%2e%2e/x.md`, `refs/%2E`, and `%41.md` beside `A.md` cases to `catalogFailures` (#1984).

[`journal.md`](./journal.md), "Replay", and [`error-codes.md`](./error-codes.md), "Middleware and
telemetry": document `JOURNAL_RESULT_UNSERIALIZABLE` for TypeScript journal entries whose live
result could not be serialized to JSON and how `replayJournal` reports them (#865). Additive, so
the version stays.
