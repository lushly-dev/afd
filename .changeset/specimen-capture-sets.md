---
"@lushly-dev/specimen": minor
"@lushly-dev/specimen-afd": minor
"@lushly-dev/specimen-cli": minor
---

Add Design Decisions Phase 1 content-addressed capture sets (`specimen-capture` with per-capture content hashes, local pointer labels under `.specimen/`, axe enabled by default with orthogonal `incomplete` counts, default job/gate skipping, and compact ids/counts output) and typed set-backed `specimen-diff` (`{ set, id }` references with `CAPTURES_INCOMPARABLE`, `CAPTURE_SET_NOT_FOUND`, and `SPECIMEN_NOT_FOUND` errors) (#2209).
