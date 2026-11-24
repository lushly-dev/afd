---
"@lushly-dev/specimen": minor
"@lushly-dev/specimen-afd": minor
"@lushly-dev/specimen-cli": minor
---

Implement Screens from Jobs Phase 4 ([#2038](https://github.com/lushly-dev/afd/issues/2038)):

- **`@lushly-dev/specimen`:** Add `bench.createJob()` (`buildJobCaptures`, `slugifyStepDescription`, `jobCreateRequestSchema`, `jobCreateResultSchema`) to write and reload job specimens in `specimen.config.json` from bare step numbers or `{ step, name?, before? }` selections; add set-backed `bench.render({ id, set, checkpoint? })` (`readObservationFromSet`) and `bench.a11y({ set })` (`readA11yFromSet`) that read recorded observations and axe outcomes without launching a browser or replaying steps (reporting `not-run` with reason for untaken captures and refusing live job render without `set` via `JOB_NEEDS_RUN`); extend `bench.captureSet()` / `runCaptureSet()` to execute job specimens through the configured runner into `<id>/<step>` captures or skip them with an actionable reason; tag missing/failed browser launches with `BROWSER_UNAVAILABLE` and missing job runner plugins with `RUNNER_MISSING`.
- **`@lushly-dev/specimen-afd`:** Expose `specimen-job-create` and `specimen-job-run` (`mutation: true`, references-only output), extend `specimen-list`, `specimen-validate`, `specimen-render`, `specimen-a11y`, and `specimen-capture` for job specimens, and surface all 8 job error/validation codes (`NOT_A_JOB`, `JOB_NEEDS_RUN`, `CAPTURE_STEP_UNKNOWN`, `CAPTURE_STEP_AMBIGUOUS`, `STEP_HAS_NO_DESCRIPTION`, `JOB_SCENARIO_INVALID`, `RUNNER_MISSING`, `BROWSER_UNAVAILABLE` suggesting `afd scenario run`).
- **`@lushly-dev/specimen-cli`:** Add `job-create` and `job-run` verbs and `--set` support on `render` and `a11y`, exiting non-zero when a job run fails (`status: 'failed'`).
