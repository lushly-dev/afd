---
"lushly-botcore": minor
---

### Added

- **`disk-reclaim`** (CLI and `disk_reclaim` over MCP) carries out what `disk-report` plans, as a dry run unless `--apply`: tier 0 prunes tool caches with their own commands (`uv cache prune`, and `pnpm store prune` only where pnpm uses hard links, since with clones it would empty the store) and clears aged cache folders from the machine settings; tier 1 strips build output from idle worktrees. Right before each deletion it checks again that the worktree is idle and unused and the path is still ignored and untracked; it never follows a link or junction, and under low space it also strips `when = "pressure"` patterns and lowers the idle threshold in steps. One run per machine, with a receipt and a status file for each (#1689).
