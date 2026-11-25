---
"@lushly-dev/specimen": minor
"@lushly-dev/specimen-afd": minor
"@lushly-dev/specimen-cli": minor
---

Add Design Decisions Phase 3 decision records, evidence storage, and pre-edit checks: random lowercase Crockford base-32 `dec-<12>` records under `specimens/decisions/` (two-kind `choice` / `answer` model), committed screenshots and manifests under `specimens/evidence/<set>/`, `decision-record` (three input modes with `confirmPrompt`, one successor choice per superseded id on multi-choice `supersedes`, and old→new `chosen` swap in `subjects.specimens`), `decision-get`, `decision-list` (ascending id order, stale subject globs, undecided comparison sets), and `decision-check` across `@lushly-dev/specimen`, `@lushly-dev/specimen-afd`, `@lushly-dev/specimen-cli`, and `endpoints/specimen-server` (#2211).
