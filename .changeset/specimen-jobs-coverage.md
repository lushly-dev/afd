---
"@lushly-dev/specimen": minor
"@lushly-dev/specimen-afd": minor
"@lushly-dev/specimen-cli": minor
---

Implement Screens from Jobs Phase 6 ([#2041](https://github.com/lushly-dev/afd/issues/2041)):

- **`@lushly-dev/specimen`:** Add the `jobs@1` component coverage obligation set (`JOBS_COVERAGE_OBLIGATIONS`, `UNREACHED_PREFIX`, `computeJobCoverage`, `readJobCoverageFromSet`) to `bench.coverage()` (`obligations: 'jobs@1'`, `captures: <set-id|label>`), reading recorded job captures from a named capture set with zero browser launch, refusing unknown sets with `CAPTURE_SET_NOT_FOUND`, returning `components[].jobs` with `reachedBy` (`{ key, name, step }[]`), `unreached` partitions, and `reason` when no job renders a component, and applying `unreached:<partition>` coverage waivers while leaving `schema-partitions@1` and `guides@1` behavior and outputs unchanged.
- **`@lushly-dev/specimen-afd`:** Extend `specimen-coverage`'s schema and description with `obligations: 'jobs@1'` and `captures` (propagating `CAPTURE_SET_NOT_FOUND` with suggestion) and expose the extended schema through `endpoints/specimen-server`.
- **`@lushly-dev/specimen-cli`:** Add `--obligations` and `--captures` options to `specimen coverage`.
