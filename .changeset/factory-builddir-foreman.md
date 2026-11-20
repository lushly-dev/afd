---
"lushly-botcore": patch
---

### Fixed

- Factory lane slots build Rust under their own `CARGO_TARGET_DIR`, in the `host.buildDir` dial's directory when set, removed when a slot takes another branch; a validation that fails on a full disk pauses the lane and counts no ejection (#1641).
- Factory foreman commands check the session again inside the change they make, so a wait left open by a superseded session no longer takes its successor's events; `gate-allow` and `lane-drop` take an optional `session` (#1633).
