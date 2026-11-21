---
"lushly-botcore": minor
---

### Added

- **`disk-report` warns when a repository has too many idle worktrees** (lushly-dev/afd#1695). Each repository gets `idle_worktrees` (linked worktrees idle `strip_after_days` or longer, kept ones aside) and, past the machine's new `idle_worktree_limit` (20; 0 turns it off), a `warning`, also in the report's `warnings`. The last reclaim that covered every repository keeps them in status.json, `disk-status` lists them under `warnings` (they never make it unhealthy), and Factory's `lane-status` shows them to the foreman as `diskWarnings` before it starts cells.
- **`disk-setup` and `disk-status` check where Cargo puts build output.** Inside each worktree is the default; a `target-dir` or `build-dir` moved out of the worktrees (the user's Cargo config, `CARGO_TARGET_DIR`, `CARGO_BUILD_TARGET_DIR`, `CARGO_BUILD_BUILD_DIR`) needs an `[[aged]]` folder covering it, and the warning names the entry to add. `disk-setup` also watches that folder's volume.

### Fixed

- **Tier 2 never removes Botcore Factory's lane slots.** Worktrees under `<repository>.factory-slots/` are `managed_by: "factory"`, as T3 Code's are `managed_by: "t3-code"`: an idle slot could otherwise have counted as finished, and a parked slot holds its validation record.
