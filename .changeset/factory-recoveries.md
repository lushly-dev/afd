---
"lushly-botcore": minor
---

### Added

- **`botcore-factory` refusals carry a structured recovery** (`spec/recovery.md`): every refusal names the step its suggestion describes, as `call` (for example `ALREADY_CLAIMED` and `NOT_DISPATCHABLE` call `issue-check`, `CELLS_FULL` calls `lane-status`), `fix-input` (with the fields to change, or `drain: true` for a busy lane host), `external` or `stop`. `STATE_LOCKED` is now `retryable` with a `retry` recovery, and `READ_FAILED` and `STATE_UNAVAILABLE` are `external`. The executed jobs assert each refusal's recovery and follow the ones a program can take, `fix-input` included; `tests/test_recoveries.py` requires every refusal to carry one, every `call` to name a served command that each of its suggestion's wordings names, and shows a planted wrong recovery failing the job.
