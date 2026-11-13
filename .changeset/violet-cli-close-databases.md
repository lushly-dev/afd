---
'@lushly-dev/violet-cli': patch
---

Each command now closes the SQLite database it opened when it finishes, so the database file and its `-wal` and `-shm` files are released and can be moved or deleted, which Windows refuses while a process holds them open. `closeDatabases()` is exported for a host that embeds the CLI, or a test that stubs `process.exit`: a command that exits through `process.exit` skips the automatic close.
