---
'@lushly-dev/afd-core': minor
'@lushly-dev/afd-server': minor
---

Add a command journal with replay (#273).

- **Core:** `JournalEntry` (`seq`, `timestamp`, `traceId`, `command`, `input`, `actor`, `contextDigest`, `result`, `durationMs` and a `tape` of the clock and random values the handler read), the `JournalSink` interface (append, read a `seq` range), `MemoryJournalSink`, `createContextDigest()` and the JSON Lines helpers `serializeJournal()` and `parseJournal()`. `FileJournalSink` writes JSON Lines and is in the new Node-only subpath `@lushly-dev/afd-core/journal-file`; the root entry stays browser-safe. A journal keeps only the actor, the interface and the trace ID from the context, plus a SHA-256 hash over those and the names (never the values) of the other context keys.
- **Server:** `createJournalMiddleware(sink, options)` records each call that passed validation (failures only with `recordFailures: true`; `auth-*` commands are skipped by default; `filter` and `redact` keep other secret inputs and results out, and `redact` should drop the tape when a secret comes from `context.random`). `replayJournal(registry, entries, options)` re-executes entries in `seq` order with each entry's trace ID, actor, interface and tape-restored clock and random source, and reports each as `same`, `different` (with a structural diff) or `error`. It reports divergence; it does not make handlers deterministic beyond the clock and random source.

The format is specified in `spec/journal.md`, with the fixture `spec/wire/journal.jsonl`.
