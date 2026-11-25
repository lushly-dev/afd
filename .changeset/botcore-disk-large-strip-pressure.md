---
"lushly-botcore": patch
---

### Fixed

- **`disk-reclaim` escalates oversized idle in-tree outputs under low-space pressure and guards `.cargo-lock`** (lushly-dev/afd#2241). When a watched volume remains below its `low_space_gb` threshold after the 6-hour pressure step and aged-folder escalation, tier 1 now runs a largest-first `pressure-large` pass over `when = "idle"` directory candidates of at least 5 GiB in strippable worktrees idle for at least 1 hour (such as in-tree `endpoints/umbel/target` directories), pairing any ancestor build-info file strips first (#1939) and stopping per volume as soon as free space recovers. `_recheck_strip` now also skips any directory whose `.cargo-lock` is held by a running Rust build.
