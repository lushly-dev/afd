---
"afd-python": minor
---

### Added

- **`follow` on a scenario step**: a step that expects a refusal can follow the refusal's structured `error.recovery` (`spec/recovery.md`) and fail unless it gets further. `follow: true` or `follow: { input, expect, retry }` (`afd.testing.FollowExpectation`): a `call` recovery runs its command, and with `thenRetry` repeats the refused call; `fix-input` repeats the command with the fixed input; `retry` repeats it unchanged. Each call is judged by `expect` or `retry` (default: it succeeds), and a call that comes back with the refused command's same error code fails the step. `follow.input` gives only the fields the recovery `needs`, so a scenario cannot correct a wrong recovery, and it takes step references; a recovery that names a field in both `input` and `needs`, or that `$defs/recovery` refuses, fails the step. A refusal without a recovery, or with an `external` or `stop` one, fails a `follow`. The calls appear in order on `StepResult.follow`, and run only when the refused step itself passed. The YAML keys and failure messages match the TypeScript runner's.
- **`expect.error.recovery` in scenarios**: assert a refusal's structured recovery like `data`. Each named field must match, others are ignored, and a refusal without a recovery, or with one no reader keeps, fails the assertion.
- **`validate_scenario` checks `follow`**: a `follow` on a step that does not expect a refusal, and a forward step reference in `follow.input`, are errors.
