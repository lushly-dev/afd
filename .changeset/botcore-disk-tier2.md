---
"lushly-botcore": minor
---

### Added

- **Tier 2 of `disk-reclaim`** removes finished worktrees: ones T3 Code does not manage, idle for a week, holding nothing unique (no changes, no operation in progress, the commit on a branch or remote, no ignored file that is not rebuildable or an unchanged declared copy) and whose work has landed on the landing ref (an ancestor, or every changed file matching it). It uses `git worktree remove` without `--force`, keeps the branch, rechecks everything just before, and records each removal; `--include-restorable` also removes those that have not landed. The hourly job does this only after `disk-setup --remove-landed` (#1694).
- **`disk-keep`, `disk-unkeep` and `disk-restore`**: protect a worktree until a date with a `git worktree lock` every disk command honors, release only such keeps, and recreate a removed worktree at the same path and commit (#1694).
