---
"@lushly-dev/afd-view-state": minor
---

`ViewStateRegistry.flush()` resolves with `{ failed }`, the IDs whose write failed, instead of nothing, and a failed write is kept and written again by the next flush, unless a newer state for its ID replaced it. Before, a failed write was logged and dropped, so a caller that awaited `flush()` could not tell its state was not stored. `flush()` still never rejects. The new `ViewStateFlushResult` type is exported.
