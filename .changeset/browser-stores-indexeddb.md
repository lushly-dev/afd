---
"@lushly-dev/local-db": minor
"@lushly-dev/afd-core": minor
---

Add browser stores over IndexedDB, each at its own subpath so the root entries are unchanged.

`@lushly-dev/local-db/indexeddb` exports `IndexedDbAdapter` (and `createIndexedDbAdapter`), a `DataAdapter` that owns one database: an object store `records` keyed by `[table, id]` with an index on `table`, so any table name works. Each call is one transaction, so `batch()` is atomic. It takes an optional `indexedDB` factory (for `fake-indexeddb` in Node.js), has `close()` and `destroy()`, closes itself when another connection upgrades or deletes the database, and rejects with `STORAGE_UNAVAILABLE` or `STORAGE_ERROR` when IndexedDB is missing or fails.

`@lushly-dev/local-db/testing` exports the adapter contract suite as `runDataAdapterContract(name, create)`, which every built-in adapter passes. It imports its test functions from `vitest` (a new optional peer dependency) and no Node.js builtin, so it runs in Node.js and in Vitest's browser mode.

`@lushly-dev/afd-core/journal-indexeddb` exports `IndexedDbJournalSink`, a `JournalSink` with an object store `entries` keyed by `seq`, and `IndexedDbJournalError`. Before its first `append` (or on `lock()`) the sink takes the Web Lock `<name>:writer` and holds it until `close()`; while another context holds it, `append` and `lock()` reject with `JOURNAL_LOCKED` and a suggestion, as `FileJournalSink` allows one process per file.
