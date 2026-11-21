---
"lushly-botcore": minor
---

### Added

- **`disk-report` warns when a repository has too many idle worktrees** (lushly-dev/afd#1695). Each repository gets `idle_worktrees` (linked worktrees idle `strip_after_days` or longer; kept ones and Factory's slots aside) and, past the machine's new `idle_worktree_limit` (20; 0 turns it off), a `warning`, also in the report's `warnings`. Each reclaim stores every repository it counted fully, after taking off what it removed, so a run that ran out of time or covered one repository leaves the others' as they were. `disk-status` lists them under `warnings`, never as a problem, and Factory's `lane-status` shows them to the foreman as `diskWarnings` before it starts cells.
- **`disk-setup` and `disk-status` check where Cargo puts build output.** Cargo's config files are read as Cargo reads them for each registered worktree (every `.cargo/config` or `config.toml` from the worktree up, then `$CARGO_HOME`'s, with includes; values taken literally), plus `CARGO_TARGET_DIR`, `CARGO_BUILD_TARGET_DIR` and `CARGO_BUILD_BUILD_DIR`. Output moved out of the worktrees needs an `[[aged]]` folder that clears it: the warning gives the exact entry only for a per-workspace folder that holds nothing but Cargo output, and asks for a `max_gb` cap on one folder shared by every workspace. `disk-setup` also watches that folder's volume.

### Fixed

- **Tier 2 never removes Botcore Factory's lane slots.** Worktrees directly in the repository's own `<repository>.factory-slots/` are `managed_by: "factory"`: an idle slot could otherwise have counted as finished, and a parked slot holds its validation record.
- **An `[[aged]]` entry's age is read three folders deep**, not only from its first level: builds write deep inside (Cargo's build-dir is `<2 hex>/<hash>/<profile>/deps/...`), so a folder still in use could look a week old and be cleared, forcing a full rebuild.
- **A settings file written by `disk-setup` stays readable by an older botcore.** `remove_landed` and `idle_worktree_limit` are left out while at their defaults, since a botcore from before them refuses unknown keys.
