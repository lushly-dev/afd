---
"lushly-botcore": patch
---

### Fixed

- **`botcore-factory` `lane-drop`:** read the pull request's merge progress on GitHub for entries in `merging` state and refuse `MERGE_QUEUED` when GitHub already holds the pull request (in the merge queue, auto-merge enabled, already merged, or settling as merged) or `READ_FAILED` when GitHub cannot be read, preventing lost landing records (#1628).
- **`disk-reclaim` and `disk-report` build info ordering:** strip file candidates (such as `*.tsbuildinfo`) before folder candidates (such as `dist`) within a worktree, skip a folder strip when build info in its directory or an ancestor inside the worktree could not be removed, and count file candidates toward worktree last activity in `disk-report` and tier-2 `removal.py` to match `disk-reclaim`'s recheck (#1939).
- **`disk-report --unclassified`:** collapse each uncovered ignored folder (such as self-ignoring `.pytest_cache/`) to one entry, mark truncated or budget-limited lists with `unclassified_truncated`, `unclassified_omitted` and `unclassified_incomplete`, and print a grouped plain-text summary across worktrees with incomplete scans instead of raw JSON (#1955).
- **Scheduled skill usage collection (`disk-run`):** wait for `skill-usage-collect` while it reports progress (via a SQLite progress handler while reading T3 Code's store and per-transcript/per-line progress words for Claude Code) instead of cutting it off at a flat five-minute wall-clock limit, leaving it only after five minutes of silence; also avoid full-table counts in `t3.check_schema` and pre-filter `_native_ids` rows by `nativeItemRef` (#2160).
