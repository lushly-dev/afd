---
"afd-python": minor
---

### Added

- **`CommandError.recovery`** (`spec/recovery.md`): the step a suggestion describes, as an `afd.Recovery` with `kind` `call`, `fix-input`, `retry`, `external` or `stop`, and `command`, `input`, `needs`, `then_retry` and `after_ms` (camelCase on the wire). `error()` and `create_error()` take `recovery=`. A `Recovery` built in Python refuses what the specification forbids: a field on the wrong kind, an unknown field, a value of the wrong type (no string or boolean coerced to a number), an empty `input` or one with `confirm`, empty or repeated `needs`, and a `fix-input` that sets neither `input` nor `needs`. An error read from the wire whose recovery breaks those rules, or has a `null` member, gets `recovery=None` and keeps everything else (rule 7); so does a `CommandError` given such a recovery as a plain dict. A `Recovery` changed after it was built so that it breaks them raises when given to a `CommandError`. `afd.is_command_recovery()` says whether a value is a recovery a reader keeps, the same test as TypeScript's `isCommandRecovery`; it checks a `Recovery` in its wire form. `tests/test_recovery_vectors.py` runs `spec/vectors/recovery.json`.

### Changed

- **`CommandError.model_dump()`** now includes `"recovery": None` when no recovery is set. Results still omit an unset `recovery`, as they omit an unset `cause`, now on a nested `cause` too.
- **Context-hook refusals keep `recovery`** beside `code`, `message`, `suggestion` and `retryable`, as Rust's do: a refused caller needs it.
