---
"lushly-botcore": minor
---

### Added

- Factory's `host.buildDir` dial names where the lane's slots build Rust: each slot's jobs get their own `CARGO_TARGET_DIR`, removed when the slot takes another branch or its branch leaves the queue (#1641).
- Factory's `gate-allow` and `lane-drop` take an optional `session`, guarded as `ejection-excuse` is (#1633).

### Fixed

- Factory's lane treats a validation or coverage run that fails on a full disk as its own trouble: it pauses and counts no ejection (#1641).
- Factory foreman commands check the session again inside the change they make, refusing `FOREMAN_LOST` once its lease is gone, so a wait left open by a superseded session no longer takes its successor's events (#1633).
