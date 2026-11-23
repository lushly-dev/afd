---
"lushly-botcore": patch
---

### Fixed

- **`disk-*` volume verification uses `APFSVolumeGroupID` for macOS APFS boot snapshots** (lushly-dev/afd#2267). On macOS, `/` is mounted from a sealed APFS snapshot whose `VolumeUUID` changes on every OS update, causing `disk-status` to report `/` unverified and `disk-reclaim` to block every repository with checkouts on `/`. `_darwin_volume_id` now prefers persistent `APFSVolumeGroupID` on APFS snapshots, `volume_state` accepts the current snapshot UUID from the same `diskutil` read until `disk-setup` reruns, and `disk-setup` migrates an internal `/` volume to `APFSVolumeGroupID` (reporting the change in `updated_volumes`) without modifying external drives.
