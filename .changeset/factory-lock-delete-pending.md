---
"lushly-botcore": patch
---

### Fixed

- **`botcore-factory` locks on Windows**: taking `state.lock`, `lane.lock` or a stale-lock break guard no longer fails with `PermissionError` when the previous lock file is still being deleted. Windows refuses that create with access denied, and the lock now counts as held for that moment, so the taker waits or retries as it would for any held lock (#1793).
