# Screens from Jobs: status

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

- **State:** draft. The scaffold was filled in on 2026-11-13 against `main` at `f7ecbd43`. On
  the same day one fresh reader walked it, an independent review of the three drafts followed,
  and it was revised after each. It is not approved.
- **Epic:** [#1109](https://github.com/lushly-dev/afd/issues/1109). Its checklist mirrors the
  steps below; this file stays the source of truth.
- **Done:**
  - The design, with a recommendation for who drives: one render per run, with
    `afd-testing`'s step loop inside the page.
  - Two new commands and six extended ones. It also uses Design Decisions' `specimen-review` and
    `decision-record` unchanged.
  - Eleven jobs as scenario files, seven of them tagged as a tentative slice.
  - Baselines and review moved onto Design Decisions' capture sets, under the coordinator's
    shared conventions, which the owner has yet to confirm.
  - The three scenario checks.
  - One walk, covering all three seats, and the revision it led to.
  - One independent review, and the revision it led to.
  - A recommended answer to each open question.
- **Not done:**
  - The owner's confirmation of the shared conventions (proposal, section 12).
  - The owner's ranking of the jobs and decisions on [For the owner](screens-from-jobs.proposal.md#12-for-the-owner).
  - Any implementation.
- **Order:** these proposals were scaffolded so that the owner could rank the jobs first. The
  owner chose on 2026-11-13 to have them filled in as drafts first. That is the order of the
  [jobs-first guide](../../../../.claude/skills/afd/references/jobs-first.md): draft, scenarios,
  walks, then the owner's ranking.
- **Last verified:** 2026-11-13, the checks below, with the tools built in this worktree at
  `f7ecbd43` on Node 26.
- **Follow-ups:** the [table below](#follow-ups-not-yet-issues).

## Steps

| Step | State | Evidence |
| --- | --- | --- |
| Scaffold: problem, what exists, draft jobs | Done 2026-11-13 | [`screens-from-jobs.proposal.md`](screens-from-jobs.proposal.md) |
| Open the epic | Done 2026-11-13 | Epic [#1109](https://github.com/lushly-dev/afd/issues/1109) |
| Verify section 2 first-hand | Done 2026-11-13, at `f7ecbd43` | Proposal, section 2 |
| Draft the design and the commands | Done 2026-11-13, uncommitted; revised after the walk | Proposal, sections 5 and 6 |
| Write each job as a scenario | Done 2026-11-13, uncommitted | [`scenarios/`](scenarios/): eleven files, 39 steps, after the review |
| Check the scenarios | Done 2026-11-13 | [How the jobs were checked](#how-the-jobs-were-checked) |
| Decide how this relates to Specimen's T11 | Recommended: this becomes T11's design; the owner decides | Proposal, section 12, question 2 |
| Walk the paths with readers who did not write them | Done 2026-11-13: one fresh reader, all three seats, verdict "revise"; every finding fixed | [The walk](#the-walk); proposal, section 4 |
| Rerun the checks after the walk | Done 2026-11-13 | [How the jobs were checked](#how-the-jobs-were-checked) |
| Independent review of the draft | Done 2026-11-13: one review of the three drafts; every finding fixed | [The review](#the-review); proposal, section 4 |
| Rerun the checks after the review | Done 2026-11-13 | [How the jobs were checked](#how-the-jobs-were-checked) |
| The owner confirms the shared conventions | Not started | Proposal, section 12 |
| The owner cuts, adds and ranks the jobs and answers section 12 | Not started | Proposal, section 12 |
| Phases 1 to 6 | Not started; needs the owner’s go | Proposal, section 9 |

## How the jobs were checked

Run on 2026-11-13 on the `.nvmrc` Node, as [jobs first](../../../../.claude/skills/afd/references/jobs-first.md#checking-without-a-server)
describes.

This is the rerun after the review.

- **Earlier runs, all clean:**
  - the first draft: 8 files and 17 steps;
  - after the walk: 11 files, 38 steps, 10 commands and 5 errors.
- **Commands:** `specimen-job-create`, `specimen-job-run`, `specimen-list`, `specimen-validate`,
  `specimen-render`, `specimen-a11y`, `specimen-coverage`, `specimen-capture`,
  `specimen-review`, `decision-record` and `scenario-evaluate`.
- **Error codes:** `NOT_A_JOB`, `JOB_NEEDS_RUN`, `CAPTURE_STEP_UNKNOWN`,
  `STEP_HAS_NO_DESCRIPTION`, `BROWSER_UNAVAILABLE` and `REVIEW_ITEM_NOT_FOUND`.
- **Step references:** every `${{ steps[N] }}` was checked to sit under `input`, since the
  runner resolves none in `expect`.

Parse:

```text
$ node packages/cli/dist/bin.js scenario validate docs/features/proposed/screens-from-jobs/scenarios
✓ All 11 scenario(s) are valid!
```

The dry run with `checkFixtures: true` reported no errors for any file. Coverage:

```text
{"totalScenarios":11,"totalSteps":39,"commands":{"tested":11,"known":11,"untested":[],"coverage":100},"errors":{"tested":6,"known":6,"untested":[],"coverage":100},"jobs":{"count":11,"names":["accept-a-steps-screen","build-a-state-once","check-a-state-where-it-occurs","find-what-no-job-reaches","pin-the-clock","refuse-a-capture-from-the-wrong-state","run-without-a-browser","see-a-jobs-states","see-what-changed-since-accepted","sort-a-bulk-change","stay-quiet-about-what-was-accepted"]}}
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
    today. Committed records live under `specimens/`.
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
| 2026-11-13 | Scaffold survey | `onStepComplete` in `packages/testing` is synchronous, not awaited, and fires for skipped steps | Addressed in the draft: phase 1 adds awaited `beforeStep` and `afterStep` hooks and leaves `onStepComplete` as it is |
| 2026-11-13 | Review | Add `.specimen/` to the root `.gitignore`. Shared with Design Decisions, whose phase 1 adds it | Open; Design Decisions' phase 1 |
| 2026-11-13 | Draft | If the owner agrees that this is T11's design, link it from T11's row in the [Specimens status](../../active/specimens/STATUS.md). That file is provenance-tracked, so run its provenance script | Open; waits on the owner |

## Session log

| Date | Session | What changed |
| --- | --- | --- |
| 2026-11-13 | Scaffold | After the [Patterns](../patterns/patterns.proposal.md) proposal, the owner agreed to four follow-on proposals from the same discussion: Design Decisions, Screens from Jobs, Pointing and Scales. This scaffold was written from a survey of the code, reviewed once by an independent reader, and committed with its epic |
| 2026-11-13 | Scaffold | Correction: the discussion of 2026-11-12, and the Patterns follow-up above, said Loam's scenario files assert the same commands its screen specimens stub. Loam has no scenario files; its job tests are Vitest. The proposal's section 2 states it correctly |
| 2026-11-13 | Review | An independent review of the three drafts. The coordinator set shared conventions, which the owner has yet to confirm:<br>- runs save Design Decisions capture sets keyed `<job>/<step>`;<br>- seeing what changed and accepting go through `specimen-review` and `decision-record`;<br>- `specimen-job-diff`, `specimen-job-accept` and the committed baseline are dropped;<br>- `.specimen/` is to be ignored;<br>- the MCP host is Design Decisions' phase 5.<br>Also fixed: the person-action limit is stated, `specimen-render` takes `id`, `STEP_HAS_NO_DESCRIPTION`, references in `input` only. Eight commands new or extended; checks rerun clean |
| 2026-11-13 | Walk | One fresh reader walked the draft, taking all three seats; verdict "revise". Every finding was fixed:<br>- the step loop moved into the page;<br>- runs keep their captures;<br>- list assertions became dotted paths;<br>- `specimen-list` and the parser were extended;<br>- four jobs were added and three folded into job 1, for eleven in all;<br>- `specimen-job-create`, `-diff` and `-accept` were drafted;<br>- `specimen-cli` joined the units touched.<br>The checks were rerun clean |
| 2026-11-13 | Draft | The owner asked for the proposals to be filled in and kept as drafts. Section 2 was verified first-hand. The design, five commands (one new) and eight jobs as scenarios were added, with the checks clean. Writing the jobs changed four things: capture points name a step by its description, person actions joined the design, no check command was needed, and job 5 was narrowed |
