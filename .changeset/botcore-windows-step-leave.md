---
"lushly-botcore": patch
---

### Fixed

- **On Windows, `disk-run` keeps waiting when a step reports fresh progress within the same clock tick** (lushly-dev/afd#2258). `Step.leave` now compares a monotonic word sequence count instead of `time.monotonic()`, which advances in coarse ticks on Windows and could otherwise mistake a working step for stalled.
