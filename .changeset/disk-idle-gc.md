---
"lushly-botcore": patch
---

### Fixed

- **`git gc` no longer makes every worktree look active** (lushly-dev/afd#1814). gc runs `git reflog expire --all`, which rewrites every worktree's `logs/HEAD` without adding an entry, and the disk commands read that file's time as the worktree's last activity: after a gc, the idle-worktree count fell to 0 and tier 1 and tier 2 waited again. A reflog's time is now the earlier of the file's time and its last entry's timestamp.
