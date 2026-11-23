---
"@lushly-dev/specimen": minor
"@lushly-dev/specimen-afd": minor
"@lushly-dev/specimen-cli": minor
---

Add Specimen Phase 2 support for Screens from Jobs (#2037):

- Keep multiple named checkpoints from a single fresh render as a content-addressed capture set (`set-<12hex>`) keyed `<id>/<step>` with axe and a screenshot per capture (`bench.captureCheckpoints()`).
- Add strict ISO-8601 `pin.clock` pinning `Date` and positive-delay timers alongside seeded `Math.random` (while keeping Specimen's own settle/axe waits on real timers) and reporting `pinned` in capture results so consecutive runs of clock-dependent screens produce identical sets.
- Extend configuration parsing and `specimen-list` (plus CLI `--kind`) to accept `job` entries and `kind` (`'job' | 'component'`) without failing schema validation.
- Record `unchanged` (compared against the previous marked capture in the same run) and `not-taken` / `unavailable` capture states, refusing captures after any failed step (including under `continueOnFailure`).
- Expose AFD-free plugin points for Node-side scenario parsing/validation (`JobSource` / `defineJobSource`) and in-page driving (`JobDriver` on `SpecimenPlugin` via `bench.runJob()`).
