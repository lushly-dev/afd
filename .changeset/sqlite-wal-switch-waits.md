---
"@lushly-dev/local-db": patch
---

`SqliteAdapter` waits for another connection's write lock when it switches a database to WAL, instead of failing at once as `SQLite failed to open the database: database is locked` (#2250). SQLite refuses that switch without calling its busy handler while another connection holds a write lock, so two processes opening one new file together could fail; the switch now retries until `busyTimeoutMs`.
