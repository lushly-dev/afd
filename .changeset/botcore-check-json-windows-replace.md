---
"lushly-botcore": patch
---

### Fixed

- **`disk-run`** no longer loses an update to `check.json` on Windows when a reader, such as `disk-status`, has the file open as it is replaced: the write is tried again for up to two seconds (#2538).
