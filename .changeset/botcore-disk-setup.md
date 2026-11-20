---
"lushly-botcore": minor
---

### Added

- **`disk-setup`, `disk-status` and `disk-run`** schedule disk hygiene on macOS (a LaunchAgent), Windows (a Task Scheduler task for the user, without elevation, hidden, also on battery) and Linux (a systemd user timer, or crontab). `disk-setup` registers the repository and records the volumes that hold its worktrees and T3 Code's worktree folders, with their identifiers and low-space thresholds; `disk-run` checks free space hourly and reclaims daily or as soon as a volume runs low, notifying once a day while space stays low; `disk-status` reports a stale or failing job, which session preflights can read (#1690).
- **The `disk-hygiene` skill** tells agents to free space with these commands rather than by hand, and what never to delete (#1691).
