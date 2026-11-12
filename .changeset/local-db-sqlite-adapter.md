---
'@lushly-dev/local-db': minor
---

`SqliteAdapter` stores records in one SQLite file through Node.js's `node:sqlite`, from a new entry, `@lushly-dev/local-db/sqlite`, which needs Node.js 22.13 or later; the root and browser entries never load it. It passes the same `DataAdapter` contract as the other adapters. The adapter owns its database: one table, `records(tbl, id, value)`, keyed by `(tbl, id)` and `WITHOUT ROWID`, each value the record's JSON, and it refuses a file another program created with `STORAGE_ERROR`. It runs in WAL mode with `synchronous = FULL`, so a committed write survives a power loss, and every write, a batch included, is one `BEGIN IMMEDIATE … COMMIT` transaction, rolled back on any failure. `list()` filters, sorts and paginates through the shared rules, in ID order without `sort`. `busyTimeoutMs` (default 5000) bounds how long a write waits for another connection; without `node:sqlite`, calls reject with `STORAGE_UNAVAILABLE` (503).
