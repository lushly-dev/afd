---
"lushly-botcore": patch
---

### Fixed

- **`disk-*` handles rapid multi-worktree Cargo build bloat and low-space `[[aged]]` pressure** (lushly-dev/afd#2373). `cargo.py` / `disk-setup` now suggests `max_age_days = 2` together with a volume-scaled `max_gb` cap (20% of volume size, clamped to 40–150 GB) for per-workspace Cargo build directories, and `_cargo_only` recognizes non-hash Cargo build directories (`.cargo-lock`, `.rustc_info.json`, `CACHEDIR.TAG`, `<profile>/.fingerprint`) while still refusing unrelated content. `caches.py` descends automatically into Cargo's `<2-hex>/<hash>` `{workspace-path-hash}` buckets (and supports explicit `/*/*` patterns) so aging, sizing, and eviction operate per workspace directory without breaking non-bucketed `[[aged]]` folders, and `reclaim.py` prunes empty 2-hex buckets afterward. Under low-space pressure, `disk-reclaim` now escalates `[[aged]]` folders oldest-first across the 1-day, 6-hour, and 1-hour-floor recovery steps (stopping per volume as soon as free space recovers), and `_recheck_aged` scopes Rust build protection to busy processes, held `.cargo-lock` files, and recently modified entries instead of globally blocking unrelated stale folders whenever `cargo`/`rustc` runs.
