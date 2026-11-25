# Screens from Jobs: status

Epic: [#1109](https://github.com/lushly-dev/afd/issues/1109). File new work for this area as its sub-issue.

Read this before the [proposal](screens-from-jobs.proposal.md). It records exactly what is done
and what is not, so an agent never has to scan the code to learn what is current. It follows
the shape of the [Patterns status](../patterns/STATUS.md).

## How to keep this file

- "Done" means merged to `main` with evidence linked. Anything else is "in progress" or "open",
  with what remains spelled out.
- Record how you verified it, the command or check, and the absolute date.
- Write down follow-ups that are not yet issues, with the date and who raised them. Link the
  issue when one exists.
- Never delete history. Mark an entry superseded and point to what replaced it.

## Status block

- **State:** active (approved 2026-11-22). Promoted from `proposed/` after a three-pass owner
  walkthrough (Q1–Q16) against `main` at `9e2aff93`.
- **Epic:** [#1109](https://github.com/lushly-dev/afd/issues/1109). Work happens in its phased
  sub-issues under [Phases](#phases); each phase owns its own line there so parallel pull
  requests never conflict.
- **Proposal design approved:**
  - Architecture: one fresh render per run with `afd-testing`'s step loop inside the page,
    private `integrations/specimen-afd-runner` (Specimen T11, [#1212](https://github.com/lushly-dev/afd/issues/1212)),
    and person actions kept in Specimen `before` entries.
  - Command design: two new commands and six extended ones (with `endpoints/specimen-server`
    wiring designed for Phase 4), plus Design Decisions' `specimen-diff`, `specimen-review` and
    `decision-record` unchanged.
  - Scenarios: eleven jobs ranked into `slice-1` (Jobs 1, 2, 3, 6 via `specimen-diff`, 8, 9),
    `slice-2` (Jobs 4, 5, 7, 10), and `slice-3` (Job 11).
  - Shared conventions with Design Decisions confirmed (including `<id>/<step>` capture keys and
    extending `endpoints/specimen-server` with `confirmations: 'require-human'`).
  - Verification history: one fresh-reader walk (all three seats), one independent review across
    the three drafts, owner walkthrough (Q1–Q16), and pre-PR independent review.
- **Follow-ups:** the [table below](#follow-ups-not-yet-issues).

## Phases

Each phase owns one blank-separated line so concurrent pull requests never edit adjacent lines.

- **Phase 1 ([#2036](https://github.com/lushly-dev/afd/issues/2036)) — `afd-testing` browser-safe entry and awaited hooks:** Done 2026-11-22 ([#2167](https://github.com/lushly-dev/afd/pull/2167)). Added `@lushly-dev/afd-testing/browser` (`runScenario`, `evaluateResult`, `evaluateStep`, `applyFixture`, `resolveStepReferences`, types and adapters with no Node built-ins) and awaited `beforeStep`/`afterStep` hooks on `RunConfig` (leaving synchronous `onStepComplete` unchanged). Verified 2026-11-22 with `pnpm -F @lushly-dev/afd-testing test --coverage` (610/610, including `browser.test.ts` esbuild browser bundle + ESM smoke test and `scenario-runner.test.ts` hook/cancellation/skip tests), `alfred`, `botcore-factory`, `todo` conformance/scenarios, and PR #2167 CI.

- **Phase 2 ([#2037](https://github.com/lushly-dev/afd/issues/2037)) — Specimen multi-checkpoint sets (`<id>/<step>`), `pin.clock`, job config entries:** Done 2026-11-23 ([#2326](https://github.com/lushly-dev/afd/pull/2326); Design Decisions Phase 1 [#2209](https://github.com/lushly-dev/afd/issues/2209) merged via [#2289](https://github.com/lushly-dev/afd/pull/2289)). Added single-render multi-checkpoint capture sets keyed `<id>/<step>` with per-checkpoint axe, console snapshots, and screenshots (`bench.captureCheckpoints()`), strict calendar-valid ISO-8601 `pin.clock` (`Date` + deterministic timer pinning with isolated real timers for Specimen waits and `pinned` baseline reporting), `job` config entries and `specimen-list` `kind` (`job` | `component`) filtering, `unchanged` and `not-taken`/`unavailable` capture states (refusing captures after any failed step including under `continueOnFailure`), and AFD-free plugin points (`JobSource` / `defineJobSource` on Node, `JobDriver` on `SpecimenPlugin` in-page via authenticated CDP `__specimenJob` bridge, `bench.runJob()`). Verified 2026-11-23 with `pnpm check` (18/18 gates), Rust host checks (`cargo fmt --check`, `cargo clippy --locked --all-targets -- -D warnings`, `cargo test --locked`), Specimen Vitest suite (57/57 files, 654 tests including real Chromium `jobs-bench.test.ts` and `sets-bench.test.ts`), `specimen-fast-af` portable gates (6/6), provenance (3/3), and PR #2326 CI.

- **Phase 3 ([#1212](https://github.com/lushly-dev/afd/issues/1212)) — Private `integrations/specimen-afd-runner` (Specimen T11, incl. minimal consuming scenario for dispatch/cancellation):** Done 2026-11-23 ([#2354](https://github.com/lushly-dev/afd/pull/2354)). Added private quarantined workspace package `@lushly-dev/specimen-afd-runner` (`integrations/specimen-afd-runner`, separate from `integrations/specimen-afd`, keeping `foundations/specimen` AFD-free) with browser-safe `'afd'` `CommandRunner` (`element.call(name, input)` returning structured `CommandResult`), in-page `JobDriver` running `@lushly-dev/afd-testing/browser` (`runScenario`, `evaluateStep`, `applyFixture`) with awaited `beforeStep` (`host.runActions`) / `afterStep` (`host.captureStep`, refusing captures after any failed step including under `continueOnFailure`) and `AbortSignal` cancellation (`host.signal`), Node-side `JobSource` (`afdJobSource` / `defineJobSource`) parsing `.scenario.yaml` + sandbox-contained fixture inheritance and surfacing `CAPTURE_STEP_UNKNOWN`, `CAPTURE_STEP_AMBIGUOUS`, `JOB_SCENARIO_INVALID`, and `STEP_HAS_NO_DESCRIPTION` in `specimen-validate` and `bench.runJob()`, plus a minimal consuming notes scenario verified both headless (`InProcessExecutor`) and in real Chromium (`runner.browser.test.ts`). Back-linked T11 in `docs/features/complete/specimens/STATUS.md` with its provenance record. Verified 2026-11-23 with `pnpm check` (18/18 gates across all 61 packages), `@lushly-dev/specimen-afd-runner` unit/browser-bundle/headless tests (4/4 files, 28/28) and Chromium bench tests (8/8), `@lushly-dev/specimen` Chromium tests (57/57 files, 654 passed + 18 reference-driver), `@lushly-dev/specimen-fast-af` Chromium tests (6/6), and `scripts/specimen-provenance.test.mjs` (3/3).

- **Phase 4 ([#2038](https://github.com/lushly-dev/afd/issues/2038)) — Job commands, CLI verbs, and `endpoints/specimen-server` wiring:** Done 2026-11-23 ([#2376](https://github.com/lushly-dev/afd/pull/2376)). Added `specimen-job-create` and `specimen-job-run` (`mutation: true`; bare step numbers or `{ step, name?, before? }`, deterministic description slugs, `<id>/<step>` capture sets, references-only output), extended `specimen-list` (`kind: 'job' | 'component'`), `specimen-validate`, `specimen-render` (refusing live job render with `JOB_NEEDS_RUN`; reading saved observations with `manifest.job` and `manifest.set` from sets with no browser), `specimen-a11y` (reading recorded axe from sets with zero step replay, reporting `not-run` with reason for untaken captures), and `specimen-capture` (running job specimens through the configured runner or skipping with reason), surfaced all 8 job error/validation codes (`NOT_A_JOB`, `JOB_NEEDS_RUN`, `CAPTURE_STEP_UNKNOWN`, `CAPTURE_STEP_AMBIGUOUS`, `STEP_HAS_NO_DESCRIPTION`, `JOB_SCENARIO_INVALID`, `RUNNER_MISSING`, `BROWSER_UNAVAILABLE`), wired CLI verbs/flags (`job-create`, `job-run`, `render --set`, `a11y --set`) in `endpoints/specimen-cli`, and exposed all 26 commands with accurate mutation annotations in `endpoints/specimen-server` while keeping `foundations/specimen` AFD-free. Verified 2026-11-23 against all 6 literal Slice 1 scenarios (`01`, `02`, `03`, `06` via `specimen-diff`, `08`, `09`: 25/25 steps), `slice1.browser.test.ts` + `runner.browser.test.ts` (13/13 Chromium), Specimen unit/Chromium/CLI/AFD/server suites, packed consumer artifacts, and provenance checks.

- **Phase 5 ([#2039](https://github.com/lushly-dev/afd/issues/2039)) — Loam notes-conflict scenario, comfortable + compact job specimens, Slice 1 exit & measurement:** Done 2026-11-23 ([#2386](https://github.com/lushly-dev/afd/pull/2386)). Authored `endpoints/loam/apps/notes/specimens/scenarios/notes-conflict.scenario.yaml` (single command definition: `document-create`, `document-open`, `document-open` beside, `notes-content-set`), exposed mount-level `call` on `loam-shell` in `notes.specimens.ts` with browser-safe `NOTES_MANIFEST` parity-checked against `loam-app.toml`, wired `@lushly-dev/specimen-afd-runner` plugin + job source, replaced hand-built `EditorConflict`/`EditorConflictCompact` stubs with `notes-conflict` and `notes-conflict-compact` job specimens (`pin.clock: 2026-03-02T09:00:00Z`, `before` draft fill), verified headless execution in TypeScript (`notes-conflict.scenario.test.ts` + replay) and Python `afd.testing` (4/4 steps), verified `CAPTURE_STEP_UNKNOWN` on step rename and zero-replay browserless `specimen-a11y`/`specimen-render` across light/dark/high-contrast, and captured local `main` set `set-8712c350b6e8` (10 captures, 0 skipped jobs). **Slice 1 exit measurement (§10.5):** **(a) `specimen-a11y`:** `0` Loam/Notes application faults across all 12 job captures (3 themes × 2 densities × 2 checkpoints; 6 isolated notes specimens also `0`), plus `5` Specimen bench-harness landmark faults per capture (`landmark-banner-is-top-level`, `landmark-contentinfo-is-top-level`, `landmark-main-is-top-level`, `landmark-no-duplicate-main`, `landmark-unique`) from `<main id="specimen-root">` wrapping `loam-shell`'s top-level landmarks (identical to `chrome/specimens`'s `shell` fixture; isolated notes specimens do not mount `loam-shell`). **(b) Step-order visual inspection:** approved by owner 2026-11-23 (0 blocking faults across the four `set-8712c350b6e8` captures; minor note: tight inline gap between warning text and `Keep mine` in compact step 4). Follow-up [#2384](https://github.com/lushly-dev/afd/issues/2384) (`foundations/specimen/src/browser/instrumentation.ts` throwing on `motion: 'settled'` for multi-document scoped-registry shadow roots) fixed 2026-11-24 ([#2415](https://github.com/lushly-dev/afd/pull/2415)), restoring `motion: 'settled'` in Loam's `notes-conflict` job specimen tests.

- **Phase 5b ([#2040](https://github.com/lushly-dev/afd/issues/2040)) — Verify Slice 2 job review/acceptance scenarios against Design Decisions:** Open (blocked on [#2039](https://github.com/lushly-dev/afd/issues/2039), Design Decisions Phase 4 [#1108](https://github.com/lushly-dev/afd/issues/1108), `specimen-server` `require-human`).

- **Phase 6 ([#2041](https://github.com/lushly-dev/afd/issues/2041)) — `jobs@1` coverage obligation set (Slice 3 exit):** Done 2026-11-23 (merged in #2388). Added the `jobs@1` component coverage obligation set (`obligations: 'jobs@1'`, `captures: <set-id|label>`, refusing unknown sets with `CAPTURE_SET_NOT_FOUND`) to `specimen-coverage` across `foundations/specimen` (`job-coverage.ts`, AFD-free), `integrations/specimen-afd`, `endpoints/specimen-cli` (`--obligations`, `--captures`), and `endpoints/specimen-server` (MCP schema exposure). Reports `components[].jobs` (`reachedBy` as `{ key, name, step }[]`, `unreached` partitions, and `reason` when no job capture renders a component), applies existing coverage waivers with `unreached:<partition>` without altering `schema-partitions@1` or `guides@1`, and reads saved job captures with zero browser launch. Verified 2026-11-23 against the literal Slice 3 scenario (`11-find-what-no-job-reaches.scenario.yaml`, 3/3 steps) and Specimen unit, Chromium, CLI, AFD, server, and provenance suites.

- **Amendment — Agent-First Design Phase A (approved 2026-11-24, Epic [#2544](https://github.com/lushly-dev/afd/issues/2544)):** Applied in [`screens-from-jobs.proposal.md` §10](screens-from-jobs.proposal.md#10-measurement-and-exit-criteria): extends "The limit" with `panel-walk` (enforced-modality walks + blind pairwise report comparison), `design-observe` (post-release journal observation against scenario steps and `releasedAt`), and capture sets supplying before/after artifact paths for `design-card-list` cards. Implementation follows under [#2544](https://github.com/lushly-dev/afd/issues/2544).

## Pre-approval steps (historical)

| Step | State | Evidence |
| --- | --- | --- |
| Scaffold: problem, what exists, draft jobs | Done 2026-11-13 | [`screens-from-jobs.proposal.md`](screens-from-jobs.proposal.md) |
| Open the epic | Done 2026-11-13 | Epic [#1109](https://github.com/lushly-dev/afd/issues/1109) |
| Verify section 2 first-hand | Done 2026-11-13 at `f7ecbd43`; re-checked 2026-11-22 at `9e2aff93` | Proposal, section 2 |
| Draft the design and the commands | Done 2026-11-13; revised after walk, review and 2026-11-22 walkthrough | Proposal, sections 5 and 6 |
| Write each job as a scenario | Done 2026-11-13; revised 2026-11-22 | [`scenarios/`](scenarios/): eleven files, 44 steps, split across `slice-1`/`slice-2`/`slice-3` |
| Check the scenarios | Done 2026-11-13; rerun 2026-11-22 | [How the jobs were checked](#how-the-jobs-were-checked) |
| Decide how this relates to Specimen's T11 | Done 2026-11-22: adopted as T11's design; [#1212](https://github.com/lushly-dev/afd/issues/1212) reparented under [#1109](https://github.com/lushly-dev/afd/issues/1109) as Phase 3 | Proposal, section 12 |
| Walk the paths with readers who did not write them | Done 2026-11-13: one fresh reader, all three seats, verdict "revise"; every finding fixed | [The walk](#the-walk); proposal, section 4 |
| Rerun the checks after the walk | Done 2026-11-13 | [How the jobs were checked](#how-the-jobs-were-checked) |
| Independent review of the draft | Done 2026-11-13: one review of the three drafts; every finding fixed | [The review](#the-review); proposal, section 4 |
| Rerun the checks after the review | Done 2026-11-13 | [How the jobs were checked](#how-the-jobs-were-checked) |
| Owner confirms shared conventions, ranks jobs, and answers section 12 | Done 2026-11-22 (Q1–Q16 walkthrough); promoted to `active/` | Proposal, section 12 |

## How the jobs were checked

Rerun on 2026-11-22 at `9e2aff93` on Node `v26.13.1` (`.nvmrc` `26`) after the three-pass owner
walkthrough and promotion to `active/`, as
[jobs first](../../../../.claude/skills/afd/references/jobs-first.md#checking-without-a-server)
describes.

- **Earlier runs, all clean:**
  - 2026-11-13 first draft: 8 files and 17 steps;
  - 2026-11-13 after the walk: 11 files, 38 steps, 10 commands and 5 errors;
  - 2026-11-13 after the review: 11 files, 39 steps, 11 commands and 6 errors.
- **Commands:** `specimen-job-create`, `specimen-job-run`, `specimen-list`, `specimen-validate`,
  `specimen-render`, `specimen-a11y`, `specimen-coverage`, `specimen-capture`, `specimen-diff`,
  `specimen-review`, `decision-record` and `scenario-evaluate`.
- **Error codes (9 declared):** `NOT_A_JOB`, `JOB_NEEDS_RUN`, `CAPTURE_STEP_UNKNOWN`,
  `CAPTURE_STEP_AMBIGUOUS`, `STEP_HAS_NO_DESCRIPTION`, `JOB_SCENARIO_INVALID`, `RUNNER_MISSING`,
  `BROWSER_UNAVAILABLE` and `REVIEW_ITEM_NOT_FOUND` (6 tested; 3 static validation/refusal codes
  explicitly deferred as "Errors no job shows yet" in proposal §6).
- **Step references:** every `${{ steps[N] }}` was checked to sit under `input`, since the
  runner resolves none in `expect`.

Parse:

```text
$ node packages/cli/dist/bin.js scenario validate docs/features/active/screens-from-jobs/scenarios
✓ All 11 scenario(s) are valid!
```

The dry run with `checkFixtures: true` reported no errors for any file. Coverage:

```text
{"totalScenarios":11,"totalSteps":44,"commands":{"tested":12,"known":12,"untested":[],"coverage":100},"errors":{"tested":6,"known":9,"untested":["CAPTURE_STEP_AMBIGUOUS","JOB_SCENARIO_INVALID","RUNNER_MISSING"],"coverage":66.66666666666666},"jobs":{"count":11,"names":["accept-a-steps-screen","build-a-state-once","check-a-state-where-it-occurs","find-what-no-job-reaches","pin-the-clock","refuse-a-capture-from-the-wrong-state","run-without-a-browser","see-a-jobs-states","see-what-changed-since-accepted","sort-a-bulk-change","stay-quiet-about-what-was-accepted"]}}
not drafted: []
```

These checks show that the drafted commands can express each job once. They do not show that
these are the right jobs, and they parse expectations without running them. The walk showed
that the first draft's partial lists would have failed when run: a list under `data` must match
exactly. Every list is now asserted by a dotted index path.

## The walk

- **When and who:** 2026-11-13, one fresh reader taking all three seats (the person, the job
  list, the calling agent), on the first draft. Verdict: revise.
- **Checked first-hand before acting:**
  - `bench-worker.ts:47-59` and `bench-runtime.ts:236-250` and 491 to 505;
  - `evaluator.ts:432`, and `scenario-runner.ts:366` and 403;
  - `validate.ts:445-452` and `bench.ts:300`;
  - `schema.ts:582-589`, `cli.ts:549` and `testing/src/mcp/tools.ts:178`;
  - `.mcp.json`;
  - and, beyond the reader, Specimen's seeded `Math.random` (`src/browser/index.ts:100-125`).
- **Blockers:**
  1. No live page to send commands into.
  2. Captures thrown away after each run.
  3. Slice scenarios that could not pass, because of partial lists.
  4. `specimen-list` breaking on a `job` key.
- **Improvements:**
  - Five missing jobs; jobs 5 to 8 that read as properties of job 1; the coverage job's place.
  - A measure that axe cannot meet.
  - Waivers; `continueOnFailure`; pinning time; scaffolding.
  - Hosts and output size; `scenario-evaluate`'s handler.
  - Layering; step numbering; command descriptions.
- **What changed:** every finding was fixed and none was declined. Proposal, section 4, lists
  each change.

## What was read to write it

- **The scaffold:** surveyed on 2026-11-13 at `e5d683a8` by another agent, read-only. First-hand
  then: Python's `afd.testing` reads scenario files (`python/tests/test_scenario_*.py`).
- **The draft:** on 2026-11-13 at `f7ecbd43`, every other claim in section 2 was read
  first-hand.
  - `packages/testing`: the parser's key lists, the step type, the unsupported fields, the runner
    and its hooks, the exports and the MCP tool names.
  - Specimen's native step kinds, runner contract, runner registry, the a11y and coverage
    schemas, and line 272 of `coverage.ts`.
  - The `specimen-afd` command list (19) and the shape of a `specimen-validate` issue.
  - `architecture.json`'s layers.
  - T11's rows in the Specimens plan and status, and lines 58, 93 and 396 of the Specimens
    proposal.
  - Loam: the specimen counts (115 and 8), `shellFixture`, the notes specimens, the P2-D7
    browser test and the kernel's `call`.
- **Corrections made while verifying:**
  - `shellFixture` is at `support.ts:61-90` at `f7ecbd43`.
  - The browser test starts at line 2496.
  - The proposal no longer quotes `runner: 'afd'`: the Specimens proposal names only an `afd`
    runner id.

## The review

- **When and who:** 2026-11-13, one independent review of the three drafts (Design Decisions,
  Screens from Jobs, Pointing). The coordinator applied it across them.
- **Shared conventions,** decided by the coordinator for the owner to confirm:
  - Design Decisions owns the one baseline and review system. A job run saves a capture set,
    `set-` and twelve hex digits, keyed `<job>/<step>`. `specimen-job-accept`,
    `specimen-job-diff` and the committed baseline are dropped. Seeing what changed and accepting
    it go through `specimen-review` and `decision-record`, which a person confirms. Groups are by
    cause.
  - Local data lives under `.specimen/`, which must be added to `.gitignore`; it is not ignored
    today. Committed records live under `specimens/`. (Superseded 2026-11-21: the owner
    confirmed this convention and [#1132](https://github.com/lushly-dev/afd/issues/1132) added
    `.specimen/` to `.gitignore`.)
  - `specimen-capture` skips job specimens until the runner exists, then runs them through it.
  - The MCP host is Design Decisions' phase 5.
  - A command that writes files is a mutation, so `specimen-job-run` is now one.
- **Fixes to this draft:**
  1. The person's typing lives outside the scenario. The limit is now stated, job 2 claims one
     definition of the commands only, and exit criterion 3 is corrected.
  2. `specimen-render` is called with its required `id`. The clashing `screenshot: true` input
     is gone, and a set keeps a screenshot per capture.
  3. `STEP_HAS_NO_DESCRIPTION` gives the refusal of an undescribed step a code and a
     suggestion.
  4. Step references now appear only in `input`.
  5. How a capture with several causes splits is stated: one item per cause, and the capture
     stays in the review while any cause is open.
- **Checked first-hand:**
  - `foundations/specimen/src/schema.ts:33-39`;
  - `scenario-runner.ts:308`;
  - the root `.gitignore`;
  - Design Decisions' sections 5 (shared conventions), 6.2, 6.5 and 7, and its phases 1, 4
    and 5.
- **Count for the README:** this proposal adds two commands and extends six, eight new or
  extended in all. It uses Design Decisions' `specimen-review` and `decision-record` unchanged.

## Follow-ups not yet issues

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-11-12 | First Patterns draft | Raised in the [Patterns status](../patterns/STATUS.md#follow-ups-not-yet-issues) as Specimen's application-command runner (T11) letting one scenario drive a screen to a state; this proposal is where it is now tracked | Moved here |
| 2026-11-13 | Scaffold survey | `onStepComplete` in `packages/testing` is synchronous, not awaited, and fires for skipped steps | Addressed in the draft: Phase 1 ([#2036](https://github.com/lushly-dev/afd/issues/2036)) adds awaited `beforeStep` and `afterStep` hooks and leaves `onStepComplete` as it is |
| 2026-11-13 | Review | Add `.specimen/` to the root `.gitignore`. Shared with Design Decisions, whose phase 1 adds it | Done 2026-11-21 ([#1132](https://github.com/lushly-dev/afd/issues/1132)), after the owner confirmed the convention |
| 2026-11-13 | Draft | Link Screens from Jobs from T11's row in the [Specimens status](../../complete/specimens/STATUS.md). That file is provenance-tracked, so run its provenance script | Done 2026-11-23 in Phase 3 ([#1212](https://github.com/lushly-dev/afd/issues/1212)) with provenance recorded |
| 2026-11-22 | Walkthrough (Q10) | Align Design Decisions §6.5 (`specimen-review` ordering) to sort cause groups largest-first with specimen id as tie-breaker, matching Job 7 | Done 2026-11-22 in `docs/features/proposed/design-decisions/design-decisions.proposal.md` |

## Session log

| Date | Session | What changed |
| --- | --- | --- |
| 2026-11-13 | Scaffold | After the [Patterns](../patterns/patterns.proposal.md) proposal, the owner agreed to four follow-on proposals from the same discussion: Design Decisions, Screens from Jobs, Pointing and Scales. This scaffold was written from a survey of the code, reviewed once by an independent reader, and committed with its epic |
| 2026-11-13 | Scaffold | Correction: the discussion of 2026-11-12, and the Patterns follow-up above, said Loam's scenario files assert the same commands its screen specimens stub. Loam has no scenario files; its job tests are Vitest. The proposal's section 2 states it correctly |
| 2026-11-13 | Review | An independent review of the three drafts. The coordinator set shared conventions, which the owner has yet to confirm:<br>- runs save Design Decisions capture sets keyed `<job>/<step>`;<br>- seeing what changed and accepting go through `specimen-review` and `decision-record`;<br>- `specimen-job-diff`, `specimen-job-accept` and the committed baseline are dropped;<br>- `.specimen/` is to be ignored;<br>- the MCP host is Design Decisions' phase 5.<br>Also fixed: the person-action limit is stated, `specimen-render` takes `id`, `STEP_HAS_NO_DESCRIPTION`, references in `input` only. Eight commands new or extended; checks rerun clean |
| 2026-11-13 | Walk | One fresh reader walked the draft, taking all three seats; verdict "revise". Every finding was fixed:<br>- the step loop moved into the page;<br>- runs keep their captures;<br>- list assertions became dotted paths;<br>- `specimen-list` and the parser were extended;<br>- four jobs were added and three folded into job 1, for eleven in all;<br>- `specimen-job-create`, `-diff` and `-accept` were drafted;<br>- `specimen-cli` joined the units touched.<br>The checks were rerun clean |
| 2026-11-13 | Draft | The owner asked for the proposals to be filled in and kept as drafts. Section 2 was verified first-hand. The design, five commands (one new) and eight jobs as scenarios were added, with the checks clean. Writing the jobs changed four things: capture points name a step by its description, person actions joined the design, no check command was needed, and job 5 was narrowed |
| 2026-11-21 | Owner call | The owner confirmed `.specimen/` as the local data folder kept out of git, and [#1132](https://github.com/lushly-dev/afd/issues/1132) added it to the root `.gitignore`. The proposal's storage statements and the follow-up row now say so. The other shared conventions still wait on the owner. Checked with `git check-ignore -v` on a file under `.specimen/` |
| 2026-11-22 | Owner walkthrough & promotion | Three-pass walkthrough (Q1–Q16) approved the proposal and promoted `docs/features/proposed/screens-from-jobs/` to `docs/features/active/screens-from-jobs/`. Confirmed all shared conventions (amending the MCP host convention to extend existing `endpoints/specimen-server`, #1320), adopted as Specimen T11's design (reparented #1212 as Phase 3 with a minimal consuming scenario for T11 exit), split the 11 jobs into `slice-1` (Jobs 1, 2, 3, 6 via `specimen-diff` on both captures, 8, 9), `slice-2` (Jobs 4, 5, 7, 10 with already-answered step), and `slice-3` (Job 11 with `{ key, name, step }` `reachedBy`), keyed job captures `<id>/<step>` so density variants on one scenario stay addressable, updated `docs/features/README.md` and sibling proposals (`design-decisions`, `pointing`, `agent-first-design`, `patterns`), moved editable phase entries to blank-separated list lines, and opened phased sub-issues #2036–#2041 under #1109 |
| 2026-11-22 | Phase 1 (#2036) | Extracted browser-safe `applyFixture` (`fixture-applier.ts`), added `@lushly-dev/afd-testing/browser` export (`src/browser.ts`) with no Node built-ins, added awaited `beforeStep` and `afterStep` hooks on `RunConfig` (forwarded through `InProcessExecutor` and `ScenarioExecutor`, never firing for skipped steps, respecting `AbortSignal`, leaving `onStepComplete` unchanged), added `browser.test.ts` (esbuild browser bundle + runtime smoke) and hook tests in `scenario-runner.test.ts`, and updated `packages/testing/README.md` and changeset |
| 2026-11-23 | Phase 2 (#2037) | After landing Design Decisions Phase 1 (#2209 via PR #2289), implemented Specimen Phase 2: single-render multi-checkpoint capture sets keyed `<id>/<step>` in `specimen-host` (`browser.rs`, `page.rs`, `main.rs`) and `bench.captureCheckpoints()`, deterministic `pin.clock` (`clock.ts`) with `Date` and positive-delay timer pinning and `pinned` baseline reporting, `job` config entries and `specimen-list` `kind` (`job` \| `component`) schema/CLI filtering, `unchanged` and `not-taken`/`unavailable` capture states (refusing captures after any failed step including under `continueOnFailure`), and AFD-free `JobSource` + `JobDriver` plugin points (`job-source.ts`, `jobs.ts`, `plugin.ts`, `bench.runJob()`) with unit, CLI, AFD, and real Chromium tests (`jobs.test.ts`, `jobs-bench.test.ts`) |
| 2026-11-23 | Phase 3 (#1212) | Implemented private quarantined integration `integrations/specimen-afd-runner` (`@lushly-dev/specimen-afd-runner`, Specimen T11) separate from `integrations/specimen-afd` while keeping `foundations/specimen` AFD-free: browser-safe `'afd'` `CommandRunner`, in-page `JobDriver` on `@lushly-dev/afd-testing/browser` (`runScenario`, `evaluateStep`, `applyFixture`, awaited `beforeStep`/`afterStep`, `AbortSignal` cancellation), Node `JobSource` (`afdJobSource` / `defineJobSource`, `.scenario.yaml` + fixture merge, `CAPTURE_STEP_UNKNOWN`/`CAPTURE_STEP_AMBIGUOUS`/`JOB_SCENARIO_INVALID`/`STEP_HAS_NO_DESCRIPTION`), minimal consuming notes scenario + unit/browser-bundle/Chromium suites, workspace/CI/`architecture.json`/release-inventory wiring, and T11 back-link + provenance record in `docs/features/complete/specimens/STATUS.md` |
| 2026-11-23 | Phase 4 (#2038) | Implemented job commands (`specimen-job-create`, `specimen-job-run`), extended `specimen-list`, `specimen-validate`, `specimen-render`, `specimen-a11y`, and `specimen-capture`, surfaced all 8 job error/validation codes (`NOT_A_JOB`, `JOB_NEEDS_RUN`, `CAPTURE_STEP_UNKNOWN`, `CAPTURE_STEP_AMBIGUOUS`, `STEP_HAS_NO_DESCRIPTION`, `JOB_SCENARIO_INVALID`, `RUNNER_MISSING`, `BROWSER_UNAVAILABLE`), added CLI verbs/flags (`job-create`, `job-run`, `render --set`, `a11y --set`), exposed all 26 commands with mutation annotations over MCP in `endpoints/specimen-server`, and verified all 6 Slice 1 scenarios (`01`, `02`, `03`, `06` via `specimen-diff`, `08`, `09`) plus zero-step-replay `specimen-a11y` and `specimen-render` |
