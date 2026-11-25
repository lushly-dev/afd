# Design Decisions: status

Epic: [#1108](https://github.com/lushly-dev/afd/issues/1108). File new work for this area as its sub-issue.

Read this before the [proposal](design-decisions.proposal.md). It records exactly what is done and
what is not, so that an agent never has to scan the code to learn what is current. It follows the
shape of the [Patterns status](../patterns/STATUS.md).

## How to keep this file

- "Done" means merged to `main` with the evidence linked. Anything else is "in progress" or
  "open", with what remains spelled out.
- Record how it was verified (the command or check) and the absolute date.
- Write down follow-ups that are not yet issues, with the date and who raised them. Link the
  issue once one exists.
- Never delete history. Mark an entry superseded and point to what replaced it.
- Edit only your phase's own line under [Phases](#phases); never add a running summary line of
  which phases are done or next.

## Status block

- **State:** active (approved 2026-11-22). Promoted from `proposed/` after a three-pass owner
  walkthrough (Q1–Q19) against `main` at `dbc84611`.
- **Epic:** [#1108](https://github.com/lushly-dev/afd/issues/1108). Work happens in its phased
  sub-issues under [Phases](#phases); each phase owns its own blank-separated line so parallel
  pull requests never conflict.
- **Approved scope:**
  - Ten jobs ranked into `slice-1` (Jobs 1, 3, 4, 5, 6, 7, 8, 10; Phases 1–5) and `slice-2`
    (Jobs 2, 9; Phase 6).
  - Ten commands (`specimen-capture`, `specimen-compare`, extended `specimen-diff`,
    `specimen-review`, `decision-record`, `decision-get`, `decision-list`, `decision-check`,
    `decision-discard`, `decision-restore`) and twelve error codes. Wire contracts live in
    [design-decisions.proposal.md](design-decisions.proposal.md) and [`scenarios/`](scenarios/)
    (no separate `spec.md`).
  - Shared conventions confirmed across Design Decisions (`#1108`), Screens from Jobs (`#1109`)
    and Pointing (`#1110`), including `.specimen/` gitignored (`#1132`), committed `specimens/`,
    single review system (`<id>/<step>` job sets, largest-first cause sorting), `skipped.jobs` +
    `skipped.gates`, and extending `endpoints/specimen-server` (`#1320`) with
    `confirmations: 'require-human'`.
  - Prior prerequisites already merged: `specimen-diff` `events` channel
    ([#1919](https://github.com/lushly-dev/afd/pull/1919),
    [#1131](https://github.com/lushly-dev/afd/issues/1131)) and `.specimen/` in `.gitignore`
    ([#1132](https://github.com/lushly-dev/afd/issues/1132)).
- **Follow-ups:** the [table below](#follow-ups-not-yet-issues).

## Phases

Each phase owns one blank-separated line so concurrent pull requests never edit adjacent lines.

- **Phase 1 ([#2209](https://github.com/lushly-dev/afd/issues/2209)) — Capture sets, per-capture content hashes, `specimen-capture`, and typed set-backed `specimen-diff` (CLI + `specimen-server`):** Done 2026-11-23 ([#2289](https://github.com/lushly-dev/afd/pull/2289)). Implemented per-capture content hashes (`captureContentHash`), content-addressed `.specimen/sets/<set-12hex>/` store with local labels (`writeCaptureSet`, `readSetCapture`, `resolveCaptureSetId`, `diffCaptures`, `runCaptureSet`), `specimen-capture` (mutation, axe default on with orthogonal `incomplete`, `skipped.jobs` + `skipped.gates`, compact ids/counts output 252 B light / 251 B dark for 142 real Loam entries), and `{ set, id }` `specimen-diff` with typed `CAPTURES_INCOMPARABLE`, `CAPTURE_SET_NOT_FOUND`, and `SPECIMEN_NOT_FOUND` errors across `foundations/specimen`, `integrations/specimen-afd`, `endpoints/specimen-cli`, and `endpoints/specimen-server`; verified with `pnpm check`, `pnpm test:specimen`, `pnpm test:stories`, Scenario 10, Scenario 07 (steps 1–3), and Chromium `sets-bench.test.ts`.

- **Phase 2 ([#2210](https://github.com/lushly-dev/afd/issues/2210)) — Side-by-side comparison (`specimen-compare`, `compare.html` + browser test, CLI + `specimen-server`):** Done 2026-11-23 ([#2340](https://github.com/lushly-dev/afd/pull/2340)). Implemented `specimen-compare` (`runCompare`, `selectCompareEntries`, `readComparePageData`, `compareRequestSchema`, `compareRunSchema`, `parseCompareRequest`), self-contained `compare.html?set=` viewer (`renderComparePageHtml`, dev middleware, static build output, `.specimen/compare.html`), CLI `specimen compare`, and MCP `specimen-compare` across `foundations/specimen`, `integrations/specimen-afd`, `endpoints/specimen-cli`, and `endpoints/specimen-server`; verified with `pnpm check`, `pnpm test:stories`, Scenario 01, Scenario 07 (steps 1, 2, 3, 5), and Chromium `compare-bench.test.ts`.

- **Phase 3 ([#2211](https://github.com/lushly-dev/afd/issues/2211)) — Decision records, evidence storage under `specimens/`, `decision-record`/`-get`/`-list`/`-check` (CLI + `specimen-server`):** Done 2026-11-24 ([#2526](https://github.com/lushly-dev/afd/pull/2526)). Implemented random lowercase Crockford base-32 `dec-<12>` storage under `specimens/decisions/` (`choice` and subject-free `answer` kinds), committed screenshots + manifests under `specimens/evidence/<set>/`, `decision-record` (`confirmPrompt`, three input modes, one successor choice per superseded id on multi-choice `supersedes`, old→new `chosen` swap in `subjects.specimens`, typed `REASON_REQUIRED`/`VARIANT_NOT_FOUND`/`CHOSEN_FAILS_GATE`/`SUPERSEDE_REQUIRED`/`DECISION_NOT_FOUND`/`CAPTURE_SET_NOT_FOUND`/`REVIEW_ITEM_NOT_FOUND`), `decision-get`, `decision-list` (ascending id order, stale subject globs, undecided comparisons), and `decision-check` across `foundations/specimen`, `integrations/specimen-afd`, `endpoints/specimen-cli`, and `endpoints/specimen-server`; verified with Scenario 03, unit/integration tests, `verify-artifacts.mjs`, `pnpm test:stories`, and `pnpm check`.

- **Phase 4 ([#2212](https://github.com/lushly-dev/afd/issues/2212)) — Review of unsettled items (`specimen-review`, `decision-record` `items` mode + fingerprints, `review.html` + browser test, CLI + `specimen-server`):** Deferred (blocked on [#2211](https://github.com/lushly-dev/afd/issues/2211); with [#2213](https://github.com/lushly-dev/afd/issues/2213), unblocks Screens from Jobs Phase 5b [#2040](https://github.com/lushly-dev/afd/issues/2040)).

- **Phase 5 ([#2213](https://github.com/lushly-dev/afd/issues/2213)) — Human-elicited confirmations (`confirmations: 'require-human'` and actor propagation on `endpoints/specimen-server`, `#1320`):** Done 2026-11-24 ([#2540](https://github.com/lushly-dev/afd/pull/2540)). Added `ExecuteSpecimenCommandOptions` (`actor`, `humanConfirmed`, `confirmedBy`) with private symbol-bound confirmation provenance in `integrations/specimen-afd` so `decidedBy: { kind: 'person' }` derives exclusively from accepted human elicitation (never from `actor.kind`), wired `confirmations: 'require-human'` MCP form elicitation on `confirmPrompt` commands in `endpoints/specimen-server` (refusing unelicited clients with `CONFIRMATION_REQUIRED` and declined/cancelled/unchecked responses with `CONFIRMATION_DECLINED` before executing, while preserving CLI `decidedBy: { kind: 'script' }`); verified with end-to-end MCP elicitation tests, `verify-artifacts.mjs`, and `pnpm check`.

- **Phase 6 ([#2214](https://github.com/lushly-dev/afd/issues/2214)) — Slice 2 variant lifecycle (`decision-discard`, `decision-restore`, `confirmPrompt`, CLI + `specimen-server`):** Deferred (blocked on [#2211](https://github.com/lushly-dev/afd/issues/2211), [#2213](https://github.com/lushly-dev/afd/issues/2213)).

## Pre-approval steps (historical)

| Step | State | Evidence |
| --- | --- | --- |
| Scaffold: problem, what exists, draft jobs | Done 2026-11-13 | [`design-decisions.proposal.md`](design-decisions.proposal.md) |
| Open the epic | Done 2026-11-13 | Epic [#1108](https://github.com/lushly-dev/afd/issues/1108) |
| Draft the design and the commands | Done 2026-11-13; revised 2026-11-22 | Proposal, sections 6 and 7 |
| Write each job as a scenario and run the checks | Done 2026-11-13; re-run 2026-11-22 | [`scenarios/`](scenarios/), ten files, 43 steps; [How the jobs were checked](#how-the-jobs-were-checked) |
| Recommend an answer to each open question | Done 2026-11-13 | Proposal, section 12 |
| Walk the paths with readers who did not write them | Done 2026-11-13: one fresh reader, all three seats, findings applied | [The walk](#the-walk), proposal section 4 |
| Independent review of the draft | Done 2026-11-13: cross-draft review, findings applied | [The review](#the-review) |
| Owner walkthrough (Q1–Q19), promotion to `active/`, and phased sub-issues | Done 2026-11-22 ([#2218](https://github.com/lushly-dev/afd/pull/2218)) | Proposal section 12; [#2209](https://github.com/lushly-dev/afd/issues/2209)–[#2214](https://github.com/lushly-dev/afd/issues/2214) |

## How the jobs were checked

Rerun on 2026-11-22 at `dbc84611` on Node `v26.13.1` (`.nvmrc` `26`), with `@lushly-dev/afd-cli`
built in this worktree, after the three-pass owner walkthrough (Q1–Q19) and move to
`docs/features/active/design-decisions/`.

Parse: `node packages/cli/dist/bin.js scenario validate docs/features/active/design-decisions/scenarios`

```text
✓ All 10 scenario(s) are valid!
```

The dry run with `checkFixtures: true`, expect-reference scan, and coverage report, from
`packages/testing`, as the
[jobs-first guide](../../../../.claude/skills/afd/references/jobs-first.md#checking-without-a-server)
gives them:
- `knownCommands`: the ten commands in section 7.
- `knownErrors`: the twelve codes in section 7.

The dry run reported `dryErrors=0 expectRefs=0`. Coverage:

```text
{"totalScenarios":10,"totalSteps":43,"commands":{"tested":10,"known":10,"untested":[],"coverage":100},"errors":{"tested":12,"known":12,"untested":[],"coverage":100},"jobs":{"count":10,"names":["be-told-before-undoing","capture-a-baseline","compare-like-with-like","reverse-a-decision","keep-what-was-not-chosen","record-the-choice","refuse-a-misleading-comparison","review-only-what-needs-eyes","stay-quiet-about-what-is-settled","turn-a-check-into-a-question"]}}
not drafted: []
```

Scenarios tagged `slice-1`: 01, 03, 04, 05, 06, 07, 08 and 10. Tagged `slice-2`: 02 and 09.
Tagged `refuse`: 07. Tagged `quiet`: 08.

Plain arrays under `expect.data` are compared whole and object arrays require exact length
(`packages/testing/src/runner/evaluator.ts:182-184,197-220,459-462`), so every assertion on part
of a list uses a dotted index path, such as `open.0.kind` and `open.0.decisions.0.decision`. The
runner resolves step references in `input` only
(`packages/testing/src/runner/scenario-runner.ts:345`); the scan confirmed zero `${{` references
in `expect`.

*(Earlier clean run: 2026-11-13 at `f7ecbd43` on Node 26.13.0 — 10 files, 39 steps, 10/10
commands, 12/12 errors, 0 dry-run errors, 0 expect refs.)*

## The review

| Date | Reader | Scope | Findings |
| --- | --- | --- | --- |
| 2026-11-13 | One independent reader, briefed by the coordinator, who wrote none of the drafts | Design Decisions, Screens from Jobs and Pointing together, with scenarios run against the runner | One blocker, four improvements, plus conventions the coordinator set across the three |
| 2026-11-22 | Two-model first review: fresh `gemini-4-neon` `high` + cross-provider `gpt-6.2-astra` `high` (read-only) | Promoted `active/design-decisions/`, all 10 scenarios, both fixtures, sibling cross-links, and `#2209`–`#2214` against `dbc84611` | 10 deduplicated blockers (4 shared, 1 unique to Gemini, 5 unique to Astra) + 5 improvements — all applied |
| 2026-11-22 | Focused verification pass: fresh `gemini-4-neon` `high` (read-only) | All 10 resolved blockers across proposal, `STATUS.md`, scenarios, fixtures, and sibling docs | Approve (10/10 blockers resolved, 0 blockers, 1 minor §7 cross-reference improvement applied) |

- **Blocker:** three expectations used step references, which the runner never resolves in
  `expect` (03, 04 and 09). Rewritten with `matches` and fixture literals; every scenario
  rechecked by script.
- **An answer guarded its specimen forever.** Answers are now their own kind, scoped to the item's
  cause or check and fingerprint, with no subjects.
- **Superseding a choice by accepting an item mixed a choice and an answer.** It now writes a
  choice that keeps the variants and lists the items under `answers`.
- **Default subjects:** `subjects.specimens` defaults to the chosen variant, as stated in the
  proposal.
- **Minor:** a section reference in 04, and the review item's `decision` field renamed to match
  `decision-check` (expanded to `decisions[]` in the 2026-11-22 walkthrough).
- **Conventions** (proposal section 5): confirmed by the owner on 2026-11-21 (`.specimen/`,
  `#1132`) and 2026-11-22 (Q1).

## The walk

| Date | Reader | Seats | Verdict | Findings |
| --- | --- | --- | --- | --- |
| 2026-11-13 | One fresh reader, briefed by the coordinator, who did not write the draft | The person, the job list, the calling agent | Revise | Four blockers, ten improvements |

The blockers:
1. Nothing cleared a `changed` item.
2. Set ids were neither unique nor durable, and the evidence was uncommitted.
3. Saved sets had no axe results, because `specimen-render` captures with axe `'not-run'`.
4. Building sets one render at a time flooded the agent's context.

Each finding and its change is in the proposal's [section 4](design-decisions.proposal.md#4-what-the-walk-and-the-review-changed). None was declined.

What changed:
- Jobs 9 (`reverse-a-decision`) and 10 (`capture-a-baseline`) were added.
- `specimen-capture`, `decision-list` and `decision-restore` were added, and `render { save }` was dropped.
- Three refusals were added: `CHOSEN_FAILS_GATE`, `SUPERSEDE_REQUIRED` and `EXPORT_MISSING`.
- Set ids are content-addressed, and decided evidence is committed.
- Changes are grouped by cause, and kept variants are left out of the review.
- Item ids describe themselves.
- The confirmation mode is named, and the CLI's limits are stated.
- Fixtures now record captures made with axe.

A coordinator note added after the walk: lists in scenarios are compared whole. Every partial list was rewritten as a dotted path.

## What was read to write it

- **The scaffold:** surveyed 2026-11-13 at `e5d683a8` by another agent, read-only.
- **The draft:** section 2 re-read first-hand on 2026-11-13 at `f7ecbd43`, and again after the walk for what it cited (`bench-runtime.ts:255,333,678-680`, `cli.ts:298-302,330-331,549`, `commands.ts:244,570`, `server-types.ts:225-241`).
  - `specimen-diff`'s command input and output (`integrations/specimen-afd/src/commands.ts:138-160`)
    and its compatibility checks (`foundations/specimen/src/diff.ts:27-71`).
  - The capture, matrix, a11y and themes schemas (`foundations/specimen/src/schema.ts`).
  - The review page's filter and preview URL.
  - Violet's operation `reason` and the `experiment` node type, and Loam's token tree.
  - Loam's decisions, now D1 to D115, and the component checklist.
  - `CommandResult.alternatives`.
- **Promotion re-check (2026-11-22 at `dbc84611`):**
  - `integrations/specimen-afd/src/commands.ts` (`events` channel in `diffOutput` from `#1919`,
    `{ actor: { kind: 'script' } }` at line 611).
  - `foundations/specimen/src/{bench-runtime.ts,diff.ts}` (`render` 684–687, `matrix` 718–804,
    axe in `specimen-run`/`packBuild` 277/587–596/950, diff channels & completeness 80–275).
  - `endpoints/specimen-server/src/server.ts` and `README.md` (`#1320`, wrapping SDK `McpServer`
    directly without `afd-server` confirmations).
  - `packages/core/src/actor.ts:10`, `packages/server/src/server-types.ts:212,245-261`,
    `packages/testing/src/runner/{evaluator.ts,scenario-runner.ts}`.
  - `endpoints/loam/packages/theme/src/tree/index.ts`, `integrations/violet-afd/src/commands/import/{tree.ts,json.ts}`,
    `endpoints/loam/docs/{design.md,decisions.md,architecture.md}`, and
    `endpoints/loam/{packages/chrome,apps/notes}/specimens/specimen.config.json` (142 entries).

## Follow-ups not yet issues

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-11-13 | Scaffold survey | `specimen-diff`'s command output schema allows only the channels `dom`, `a11y`, `layout`, `styles` and `state` (`integrations/specimen-afd/src/commands.ts:152`). But `diff.ts:267` can report an `events` difference (`ChannelDifference`, `foundations/specimen/src/types.ts:670`), and the command parses its result against that schema (`commands.ts:197`). So a diff with an events difference fails as `SPECIMEN_OUTPUT_INVALID`. Checked by reading; not run | Fixed in [#1919](https://github.com/lushly-dev/afd/pull/1919) ([#1131](https://github.com/lushly-dev/afd/issues/1131)) on 2026-11-21 |
| 2026-11-13 | First walk | Specimen has no MCP host, and `executeSpecimenCommand` runs every call as `{ kind: 'script' }` (`integrations/specimen-afd/src/commands.ts:570`). So no Specimen command can record a person's answer today | Resolved in Phase 5 ([#2213](https://github.com/lushly-dev/afd/issues/2213)): `endpoints/specimen-server` enforces `confirmations: 'require-human'` over MCP form elicitation and `executeSpecimenCommand` records `decidedBy: { kind: 'person' }` only after accepted elicitation |
| 2026-11-13 | Scaffold survey | Violet's `changes.impact` change schema has no `reason`, so the apply commands it returns drop one | Open; proposal section 8, Later |
| 2026-11-13 | Scaffold survey | `incompleteChecks` from `specimen-a11y` never affect a status and are sent nowhere | Tracked in Phase 4 ([#2212](https://github.com/lushly-dev/afd/issues/2212)), job 6 and `specimen-review` |

## Session log

| Date | Session | What changed |
| --- | --- | --- |
| 2026-11-13 | Scaffold | After the [Patterns](../patterns/patterns.proposal.md) proposal, the owner agreed to four follow-on proposals from the same discussion: Design Decisions, Screens from Jobs, Pointing and Scales. This scaffold was written from a survey of the code, reviewed once by an independent reader, and committed with its epic |
| 2026-11-13 | Draft | The owner asked for the proposals to be filled in and kept as drafts. Jobs tightened, eight scenarios written, commands drafted, the three checks run clean. Writing the scenarios added saved captures, a typed refusal for incompatible captures, review answers kept as decisions and a decision named on review items, and cut `decision-open`. Section 2 re-read first-hand |
| 2026-11-13 | Walk and revision | One fresh reader walked the draft from three seats, with the verdict revise. All four blockers and ten improvements were applied, as the proposal's section 4 records. The jobs grew from eight to ten, the commands from eight to ten and the errors from nine to twelve. Partial-list assertions became dotted paths. The three checks were rerun clean |
| 2026-11-13 | Review and revision | One independent reader reviewed the three drafts together and ran scenarios. Applied: no step references in `expect`, answers as their own kind, superseding by acceptance writes a choice, default subjects stated, and the coordinator's shared conventions (random decision ids, `specimens/` paths, the hashed fields, `.specimen/` to be ignored, one review system, the job-specimen skip, one host). The three checks were rerun clean, with a scan for references in `expect` |
| 2026-11-21 | Owner call | The owner confirmed `.specimen/` as the local data folder kept out of git. [#1132](https://github.com/lushly-dev/afd/issues/1132) added it to the root `.gitignore` and updated the three proposals and their status files. The other conventions in section 5 still wait on the owner. Checked with `git check-ignore -v` on a file under `.specimen/` |
| 2026-11-22 | Owner walkthrough & promotion | Three-pass walkthrough (Q1–Q19) and two-model independent review (`gemini-4-neon` + `gpt-6.2-astra` `high`) approved and tightened the proposal, promoting `docs/features/proposed/design-decisions/` to `docs/features/active/design-decisions/`. Confirmed all §5 shared conventions aligned with [#1109](https://github.com/lushly-dev/afd/issues/1109) and [#1110](https://github.com/lushly-dev/afd/issues/1110) (Crockford base-32 `dec-` ids); split the ten jobs into `slice-1` (Jobs 1, 3, 4, 5, 6, 7, 8, 10; Phases 1–5) and `slice-2` (Jobs 2, 9; Phase 6); expanded capture content hashes to all diff/review inputs; locked structured `cause`, member-scoped `changed` item ids, `settled.answered` item units, `kept`-before-`blocking`, `chosen: 'reject'` → `blocking` (`kind: 'rejected'`, verified in Scenario 06), one-successor-per-choice supersession, old→new `chosen` subject swap (verified in Scenario 09), optional `slug`/`question` on Mode 3, and elicitation-derived `decidedBy: { kind: 'person' }`; updated §2 facts against `dbc84611`, `decided.json`, `docs/features/README.md`, and sibling links; re-ran scenario checks clean (10/10 valid, 43 steps, 0 dry-run errors, 0 expect refs, 100% command/error coverage); updated [#1108](https://github.com/lushly-dev/afd/issues/1108) and opened phased sub-issues [#2209](https://github.com/lushly-dev/afd/issues/2209)–[#2214](https://github.com/lushly-dev/afd/issues/2214) |
| 2026-11-23 | Phase 1 (#2209) | Implemented per-capture content hashing (`captureContentHash`), content-addressed capture sets under `.specimen/sets/<set-12hex>/` with `.specimen/labels.json`, `specimen-capture` (mutation, axe default on with orthogonal `incomplete`, default `skipped.jobs` + `skipped.gates`, compact ids/counts output), and set-backed `specimen-diff` (`{ set, id }` with typed `CAPTURES_INCOMPARABLE`, `CAPTURE_SET_NOT_FOUND`, and `SPECIMEN_NOT_FOUND`) across `foundations/specimen`, `integrations/specimen-afd`, `endpoints/specimen-cli`, and `endpoints/specimen-server`; verified Scenario 10 and Scenario 07 steps 1–3, event-only/scroll-only hash uniqueness, 142-entry real Loam manifest response size (252 B light / 251 B dark, < 4 KB), and Chromium `sets-bench.test.ts` (including theme-pinned unavailable and `--no-axe` at `after-run`) |
| 2026-11-23 | Phase 2 (#2210) | Implemented `specimen-compare` (2–8 variants with axe, `SPECIMEN_NOT_FOUND` naming nearest ids, `VARIANT_UNAVAILABLE` naming declared themes, diffs against the first variant, compact response with no observations) and self-contained `compare.html?set=` viewer (side-by-side screenshots, axe status/violations, structured differences, light/dark axe-clean) across `foundations/specimen`, `integrations/specimen-afd`, `endpoints/specimen-cli`, and `endpoints/specimen-server`; verified Scenario 01, Scenario 07 step 5, CLI no-observation stdout, and Chromium/Playwright `compare-bench.test.ts` |
| 2026-11-24 | Phase 3 (#2211) | Implemented random lowercase Crockford base-32 `dec-<12>` decision records under `specimens/decisions/` (two-kind `choice` and subject-free `answer` model), committed screenshots + manifests under `specimens/evidence/<set>/`, `decision-record` (`confirmPrompt`, three input modes, one successor choice per superseded id on multi-choice `supersedes`, old→new `chosen` swap in `subjects.specimens`), `decision-get`, `decision-list` (ascending id order, stale subject globs, undecided comparisons), and `decision-check` across `foundations/specimen`, `integrations/specimen-afd`, `endpoints/specimen-cli`, and `endpoints/specimen-server`; verified Scenario 03, `decision-list`/`DECISION_NOT_FOUND`/old→new swap/two-choice supersession tests, CLI and MCP tests, and `pnpm verify` |
| 2026-11-24 | Phase 5 (#2213) | Enforced `confirmations: 'require-human'` on `endpoints/specimen-server` over MCP form elicitation (with sanitized prompt details, cancellation signal forwarding, and fail-closed `CONFIRMATION_REQUIRED` / `CONFIRMATION_DECLINED` refusals that ignore agent-supplied `confirm: true` and `_meta['dev.afd/confirm']`) and gated `decidedBy: { kind: 'person' }` behind an unforgeable module-private confirmation symbol in `integrations/specimen-afd` (`executeSpecimenCommand` `ExecuteSpecimenCommandOptions`) while preserving CLI `decidedBy: { kind: 'script' }`; verified unit/integration tests, consumer artifacts, and `pnpm check` |
