---
'@lushly-dev/afd-core': patch
---

`isFailure()` now depends only on `success === false`, as `isSuccess()` depends only on `success === true`, so every `CommandResult` is exactly one of the two. A result such as `{ success: false }` without an `error` used to fail both guards; it is now a failure. The narrowed type still declares `error: CommandError` (as `isSuccess` declares `data: T`); results built with `failure()` always carry one, but code reading results from an untrusted peer should use `result.error?.code`.
