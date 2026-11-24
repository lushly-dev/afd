---
"@lushly-dev/afd-core": minor
"@lushly-dev/afd-client": minor
---

Add `CommandError.recovery` (`spec/recovery.md`): the step a suggestion describes, as a `Recovery` union of `call`, `fix-input`, `retry`, `external` and `stop`, so a program can follow it and a test can check it. `error()` takes `recovery`. `isCommandRecovery()` accepts exactly what the schema's `$defs/recovery` does, and `withReadableRecovery()` returns an error as a reader sees it, with every recovery that fails that check removed (rule 7). `RECOVERY_KINDS` lists the kinds. `McpClient` drops a recovery that fails that check from the results, batch items and pipeline steps it returns, since the wire is untrusted.
