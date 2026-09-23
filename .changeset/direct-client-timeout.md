---
'@lushly-dev/afd-client': minor
---

Enforce `DirectCallContext.timeout`, which was documented but ignored. When it passes, the signal the command receives (the caller's `signal` combined with `AbortSignal.timeout`) aborts and the call resolves to a structured `TIMEOUT` failure, even if the command ignores the signal. In `pipe()` the timeout applies per step. Values that are not positive finite numbers are ignored.

Export an `isUnknownToolError(result)` type guard. `call<T>()` returns `CommandResult<T> | CommandResult<UnknownToolError>`, so the documented `if (result.success) result.data.id` never narrowed; after `isUnknownToolError(result)` is false, `result` is `CommandResult<T>`.

Minor: a new export; callers that passed `timeout` now get the documented behaviour.
