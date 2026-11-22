---
"@lushly-dev/specimen": patch
---

Retry component-pack example remount captures once on transient capture failure or settle race (matching the two-pass case retry), use the configured story timeout budget for remount captures, and wait one extra animation frame after `settle()` when remounting example markup so deferred component writes settle consistently on Windows (#1404).
