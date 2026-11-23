---
"lushly-botcore": patch
---

### Fixed

- **Windows disk removal says what it does as the POSIX walk does** (lushly-dev/afd#2173). The path walk Windows uses now says `clearing` for each folder it opens and `looking at` for each entry before reading it, so a watcher follows either walk, and a step left during that read stops before anything is removed.
- **The skill usage record keeps `\n` line endings on Windows** (lushly-dev/afd#2173). A rewritten record file no longer gets `\r\n` from text mode, so its bytes match the lines `append_events` writes and the shared copy.
- **A skill usage record path that is a file is `RECORD_UNAVAILABLE` on Windows too** (lushly-dev/afd#2173). Windows reads a file under a file as missing, so the report said `NOT_COLLECTED`; the record folder is now checked first.
- **Teams status messages reach `task_status` with its `task_id`** (lushly-dev/afd#2174). The botcore-teams plugin read "status of task-001" as `{"query": "of task-001"}`, which botcore-agents' `task_status` does not take; it now passes `task_id`, and a status message without an id gets `MISSING_TASK_ID` with a suggestion instead of a failed call.
