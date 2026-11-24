# @lushly-dev/specimen-afd

## 2.2.0-preview.7

### Minor Changes

- [#2289](https://github.com/lushly-dev/afd/pull/2289) [`46cc092`](https://github.com/lushly-dev/afd/commit/46cc0929a6a95f79f3ec2d12e5e65c7aa6e938e2) Thanks [@Falkicon](https://github.com/Falkicon)! - Add Design Decisions Phase 1 content-addressed capture sets (`specimen-capture` with per-capture content hashes, local pointer labels under `.specimen/`, axe enabled by default with orthogonal `incomplete` counts, default job/gate skipping, and compact ids/counts output) and typed set-backed `specimen-diff` (`{ set, id }` references with `CAPTURES_INCOMPARABLE`, `CAPTURE_SET_NOT_FOUND`, and `SPECIMEN_NOT_FOUND` errors) ([#2209](https://github.com/lushly-dev/afd/issues/2209)).

- [#2340](https://github.com/lushly-dev/afd/pull/2340) [`841511f`](https://github.com/lushly-dev/afd/commit/841511f230c35cf5721ecfd9092cca51be21649d) Thanks [@Falkicon](https://github.com/Falkicon)! - Add Design Decisions Phase 2 side-by-side variant comparison (`specimen-compare` capturing 2–8 variants with axe into a `compare` set, diffing each against the first, refusing unknown ids with `SPECIMEN_NOT_FOUND` and theme-excluded variants with `VARIANT_UNAVAILABLE`, plus the self-contained `compare.html?set=` viewer across CLI, MCP server, dev server, and static builds) ([#2210](https://github.com/lushly-dev/afd/issues/2210)).

- [#2376](https://github.com/lushly-dev/afd/pull/2376) [`a3fa421`](https://github.com/lushly-dev/afd/commit/a3fa4215af37fc5ea49a55b1bf0fb8409b9ce4d4) Thanks [@Falkicon](https://github.com/Falkicon)! - Implement Screens from Jobs Phase 4 ([#2038](https://github.com/lushly-dev/afd/issues/2038)):

  - **`@lushly-dev/specimen`:** Add `bench.createJob()` (`buildJobCaptures`, `slugifyStepDescription`, `jobCreateRequestSchema`, `jobCreateResultSchema`) to write and reload job specimens in `specimen.config.json` from bare step numbers or `{ step, name?, before? }` selections; add set-backed `bench.render({ id, set, checkpoint? })` (`readObservationFromSet`) and `bench.a11y({ set })` (`readA11yFromSet`) that read recorded observations and axe outcomes without launching a browser or replaying steps (reporting `not-run` with reason for untaken captures and refusing live job render without `set` via `JOB_NEEDS_RUN`); extend `bench.captureSet()` / `runCaptureSet()` to execute job specimens through the configured runner into `<id>/<step>` captures or skip them with an actionable reason; tag missing/failed browser launches with `BROWSER_UNAVAILABLE` and missing job runner plugins with `RUNNER_MISSING`.
  - **`@lushly-dev/specimen-afd`:** Expose `specimen-job-create` and `specimen-job-run` (`mutation: true`, references-only output), extend `specimen-list`, `specimen-validate`, `specimen-render`, `specimen-a11y`, and `specimen-capture` for job specimens, and surface all 8 job error/validation codes (`NOT_A_JOB`, `JOB_NEEDS_RUN`, `CAPTURE_STEP_UNKNOWN`, `CAPTURE_STEP_AMBIGUOUS`, `STEP_HAS_NO_DESCRIPTION`, `JOB_SCENARIO_INVALID`, `RUNNER_MISSING`, `BROWSER_UNAVAILABLE` suggesting `afd scenario run`).
  - **`@lushly-dev/specimen-cli`:** Add `job-create` and `job-run` verbs and `--set` support on `render` and `a11y`, exiting non-zero when a job run fails (`status: 'failed'`).

- [#2388](https://github.com/lushly-dev/afd/pull/2388) [`41ee564`](https://github.com/lushly-dev/afd/commit/41ee564db1b41cde5be8497d8c7d3657c57b11c2) Thanks [@Falkicon](https://github.com/Falkicon)! - Implement Screens from Jobs Phase 6 ([#2041](https://github.com/lushly-dev/afd/issues/2041)):

  - **`@lushly-dev/specimen`:** Add the `jobs@1` component coverage obligation set (`JOBS_COVERAGE_OBLIGATIONS`, `UNREACHED_PREFIX`, `computeJobCoverage`, `readJobCoverageFromSet`) to `bench.coverage()` (`obligations: 'jobs@1'`, `captures: <set-id|label>`), reading recorded job captures from a named capture set with zero browser launch, refusing unknown sets with `CAPTURE_SET_NOT_FOUND`, returning `components[].jobs` with `reachedBy` (`{ key, name, step }[]`), `unreached` partitions, and `reason` when no job renders a component, and applying `unreached:<partition>` coverage waivers while leaving `schema-partitions@1` and `guides@1` behavior and outputs unchanged.
  - **`@lushly-dev/specimen-afd`:** Extend `specimen-coverage`'s schema and description with `obligations: 'jobs@1'` and `captures` (propagating `CAPTURE_SET_NOT_FOUND` with suggestion) and expose the extended schema through `endpoints/specimen-server`.
  - **`@lushly-dev/specimen-cli`:** Add `--obligations` and `--captures` options to `specimen coverage`.

- [#2326](https://github.com/lushly-dev/afd/pull/2326) [`9582383`](https://github.com/lushly-dev/afd/commit/9582383fbb1ef44bb1f84ec77858967cbc67af15) Thanks [@Falkicon](https://github.com/Falkicon)! - Add Specimen Phase 2 support for Screens from Jobs ([#2037](https://github.com/lushly-dev/afd/issues/2037)):

  - Keep multiple named checkpoints from a single fresh render as a content-addressed capture set (`set-<12hex>`) keyed `<id>/<step>` with axe and a screenshot per capture (`bench.captureCheckpoints()`).
  - Add strict ISO-8601 `pin.clock` pinning `Date` and positive-delay timers alongside seeded `Math.random` (while keeping Specimen's own settle/axe waits on real timers) and reporting `pinned` in capture results so consecutive runs of clock-dependent screens produce identical sets.
  - Extend configuration parsing and `specimen-list` (plus CLI `--kind`) to accept `job` entries and `kind` (`'job' | 'component'`) without failing schema validation.
  - Record `unchanged` (compared against the previous marked capture in the same run) and `not-taken` / `unavailable` capture states, refusing captures after any failed step (including under `continueOnFailure`).
  - Expose AFD-free plugin points for Node-side scenario parsing/validation (`JobSource` / `defineJobSource`) and in-page driving (`JobDriver` on `SpecimenPlugin` via `bench.runJob()`).

- [#2353](https://github.com/lushly-dev/afd/pull/2353) [`9935976`](https://github.com/lushly-dev/afd/commit/99359760a6aee0ff07f8733626d38e8c59d16b69) Thanks [@Falkicon](https://github.com/Falkicon)! - Add `specimen-point`, `specimen-point-move`, and `specimen-point-check` (and matching `SpecimenBench` methods, CLI subcommands `point` / `point-move` / `point-check`, and warm-bench MCP tools in `endpoints/specimen-server`) to resolve `specimen:` pointer URIs or named targets through the shared two-step climb, persist bounded point records in `.specimen/points/pt-<12>.json` with zero-build CEM component/source info and loaded-file digests, move across relative levels (`parent`, `child`, `next`, `previous`, `component`), and detect stale references (`POINT_STALE`, `NO_SUCH_LEVEL`, `POINT_NOT_FOUND`, nearest-id `SPECIMEN_NOT_FOUND`) ([#2043](https://github.com/lushly-dev/afd/issues/2043)).

### Patch Changes

- [#2203](https://github.com/lushly-dev/afd/pull/2203) [`9dcf903`](https://github.com/lushly-dev/afd/commit/9dcf9038ebe57186ea429851d840eec24f6022e9) Thanks [@Falkicon](https://github.com/Falkicon)! - Add static pattern files (`pattern.json` Zod and draft 2020-12 JSON Schema exported at `@lushly-dev/specimen/pattern.schema.json`), the 9 ASCII format-2 identifier forms, `PatternTarget` role sets and mutually exclusive name matchers, `BenchConfig` `patterns`/`patternSources` (offline local pack directory and `./pack` package resolution) and manifest-less app `pack` configuration (`dependencies`, `localElements`, `themeStylesheet`), `guideComponentSchema` `implements`/`contexts`, static `parameters.specimen.{patternSetup,contexts}` extraction in `specimen-host`, and browserless `specimen-validate` portability and cross-reference checks ([#2144](https://github.com/lushly-dev/afd/issues/2144)).

## 2.2.0-preview.6

### Minor Changes

- [#2132](https://github.com/lushly-dev/afd/pull/2132) [`dae40a9`](https://github.com/lushly-dev/afd/commit/dae40a946d681e00fa3cec077f1e3e05dae1b45d) Thanks [@Falkicon](https://github.com/Falkicon)! - Split Specimen host target resolution failures into typed `TARGET_NOT_FOUND` and `TARGET_AMBIGUOUS` errors carrying actionable suggestions and match counts (`details.count`), and plumb structured `code`, `suggestion`, and `details` through the TypeScript host client, process worker IPC, and `specimen-afd` commands ([#2046](https://github.com/lushly-dev/afd/issues/2046)).

## 2.2.0-preview.5

### Patch Changes

- [#1919](https://github.com/lushly-dev/afd/pull/1919) [`3a7c1c5`](https://github.com/lushly-dev/afd/commit/3a7c1c5bb3a34e7c49f85cbf17926380e82a0ba6) Thanks [@Falkicon](https://github.com/Falkicon)! - Allow the `events` channel in `specimen-diff`'s output schema, constrained to `ChannelDifference['channel']`, so comparing two observations whose recorded event histories differ returns `status: 'changed'` instead of failing with `SPECIMEN_OUTPUT_INVALID` ([#1131](https://github.com/lushly-dev/afd/issues/1131)).

## 2.2.0-preview.4

### Patch Changes

- [#1079](https://github.com/lushly-dev/afd/pull/1079) [`f485589`](https://github.com/lushly-dev/afd/commit/f485589495d4a08b371609c0066e43c81cd6f677) Thanks [@Falkicon](https://github.com/Falkicon)! - Each integration's peer on `@lushly-dev/specimen` (and, for `specimen-fast-af`, on `@lushly-dev/fast-element`) now requires at least the version it was built against, instead of any preview of that line. A consumer who updated only an integration used to install an older Specimen cleanly and then hit missing commands at runtime: `specimen-themes` and `specimen-pack*` in `specimen-afd`, and guide sources in `specimen-fast-af`. The install now asks for the Specimen it needs. Update Specimen with the integration.

## 2.2.0-preview.3

### Minor Changes

- [#1028](https://github.com/lushly-dev/afd/pull/1028) [`6ca6fa7`](https://github.com/lushly-dev/afd/commit/6ca6fa7bb8d6c4c6efe5b13ccc576aa76fbb0947) Thanks [@Falkicon](https://github.com/Falkicon)! - Build component packs: a `pack` configuration key names the library, and `bench.pack()`, `bench.packCheck()` and `bench.packExport()` build its committed form from two passes over every case, compare a build with the committed records, and write the exported form with no browser. A case that fails, after one retry, or shows something different in each pass contributes nothing; an example is kept only when its markup, mounted on its own, shows the same. Export refuses, naming the record, when the manifest or a guide file says something the committed records do not, and keeps other libraries and a deployment's `pack.toml`. Guide files take `roles` for states a capture does not show. The example pack's records changed: a boolean attribute no longer lists `true` and `false`, and `example-option`'s `value` is observed.

  The commands are `specimen-pack`, `specimen-pack-check` and `specimen-pack-export` in `@lushly-dev/specimen-afd`, and `specimen pack [TAG]`, `pack-check [TAG]` and `pack-export DIR` in the CLI. With a component, a build rebuilds that one record from the cases the last full build indexed (a cache under `node_modules/.cache/specimen/`), when the bench bundle is unchanged since; otherwise every case runs and the report says why. `pack-check` exits 1 when a committed record differs or a case failed.

- [#1037](https://github.com/lushly-dev/afd/pull/1037) [`fec06cf`](https://github.com/lushly-dev/afd/commit/fec06cf06494e48d2bddb9d6e7b0994c42b3066f) Thanks [@Falkicon](https://github.com/Falkicon)! - Declared and observed theme support. A story declares the themes it supports with a `light-only`, `dark-only` or `high-contrast-only` tag on itself or its meta, and a native specimen with `themes: { supported, reason? }` in the configuration; the entry carries it as `themes`. The review page tags a declared entry on the index and the preview, and when the selected theme is one it does not support, says so above the frame instead of looking like a broken switch. `bench.themes()`, `specimen-themes` and `specimen themes [ID]` render entries in each theme and compare the screenshots, reporting each as `follows`, `declared`, `pinned`, `undeclared`, `contradicted` or `unavailable`; `valid` is false, and the CLI exits 1, when one is `undeclared`. A component pack record can carry an optional `themes` fact, `declared` or `observed`, and a pack build writes a declared one when every case about a component declares the same themes; a reader from before this change refuses a record that carries it. The review page's shell ceiling moves from 50,000 to 52,000 bytes, since the shell's own code is 49,793.

## 2.2.0-preview.2

### Patch Changes

- [#915](https://github.com/lushly-dev/afd/pull/915) [`86ae222`](https://github.com/lushly-dev/afd/commit/86ae22229c67c7b97d6a6f3b3dfac60998e4945f) Thanks [@Falkicon](https://github.com/Falkicon)! - Specimen waits on each custom element's own registry, so a story with an element defined only in a scoped registry no longer hangs to its deadline ([#707](https://github.com/lushly-dev/afd/issues/707)). While a modal dialog is open, the ARIA snapshot is the dialog's, which is what stays exposed, instead of empty ([#662](https://github.com/lushly-dev/afd/issues/662)). A missing Chromium headless shell names the Playwright version it belongs to and the command that installs it, and each package's README now has its npm install section.

## 2.2.0-preview.1

### Patch Changes

- [#803](https://github.com/lushly-dev/afd/pull/803) [`feb7052`](https://github.com/lushly-dev/afd/commit/feb70527a3c28534d9baf8404f80047e175baf5c) Thanks [@Falkicon](https://github.com/Falkicon)! - Publishes the preview with its built code. The first preview, `2.2.0-preview.0` (`0.1.0-preview.0` for the FAST-AF plugin, `3.0.1-preview.0` for `fast-element`), went to npm without it: the release's build step did not run, so each package held only its manifest, readme and license, and installing it failed with `ERR_MODULE_NOT_FOUND`. The prebuilt hosts were complete. Install `@lushly-dev/<name>@preview`.

## 2.2.0-preview.0

### Patch Changes

- [#789](https://github.com/lushly-dev/afd/pull/789) [`4f2bed7`](https://github.com/lushly-dev/afd/commit/4f2bed76178dd5826e583d5725448dbd01f0307b) Thanks [@Falkicon](https://github.com/Falkicon)! - First preview on npm, under the `preview` tag: Specimen, the native component observation bench, with prebuilt hosts for Linux (x64 and arm64, glibc) and macOS (arm64 and x64); the `specimen` JSON CLI; its AFD command bindings; the FAST-AF plugin; and the FAST-AF runtime the plugin renders with. Install a package as `@lushly-dev/<name>@preview`. Its API can still change before the stable release.
