---
"lushly-botcore": minor
---

### Added

- **Factory gateway `journal.keepDays` setting** (default `365`, `0` disables pruning), pruning older UTC day journal files at startup and on UTC day rollover (#2413).

### Changed

- **Factory gateway journals write commands only (with their failures):** pure reads (`gateway-status`, `issue-get`, `comment-list`, `claim-list`, `pr-status`, `review-get`, `gateway-audit`), `gateway-wait`, and `lane-heartbeat` stay out of the journal (#2413).

### Fixed

- **`record_provenance.py` refuses CRLF line endings in tracked LF text files**, preventing Windows checkouts from recording SHA-256 digests that fail Linux CI verification (#2390).
- **`skill-usage-collect` resolves `owner/name` from `.git/config` (including worktree `gitdir`/`commondir` pointers) when `git remote get-url origin` fails** (such as on Windows dubious ownership), so clones of the same repository merge under one project instead of splitting (#2370).
- **Scoped factory gateway journal reads:** `read_journal` and `gateway-audit` skip day files older than `since`, `outside_writes` skips reading the journal when no bot PR is open, and `gateway-wait` skips `outside_writes` when `kinds` excludes `outside-write` (#2413).
