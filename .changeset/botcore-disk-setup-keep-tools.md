---
"lushly-botcore": patch
---

### Fixed

- **`disk-setup` keeps usable `[tools]` entries on rerun** (lushly-dev/afd#1934). Rerunning `disk-setup` from another shell's `PATH` no longer overwrites existing `[tools]` entries whose executable file still exists and lasts; only missing or broken entries are filled in or cleared, and `disk-setup` now reports every added, replaced or removed entry in `changed_tools`.
