# Design Decisions: status

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

## Status block

- **State:** draft. Filled in 2026-11-13 against `main` at `f7ecbd43`, walked once, reviewed
  once, and revised after each the same day. Not approved.
- **Epic:** [#1108](https://github.com/lushly-dev/afd/issues/1108). Its checklist mirrors the
  steps below; this file stays the source of truth.
- **Done:**
  - The problem, with what exists today re-read first-hand.
  - Ten jobs, each written as a scenario.
  - A design and the drafted commands.
  - The three checks, and a recommended answer to each open question.
  - One walk by a fresh reader covering all three seats, with every finding applied.
  - One independent review of the three drafts together, with every finding applied.
- **Not done:**
  - A second walk of the revision.
  - The owner's confirmation of the shared conventions (proposal section 5).
  - The owner's ranking of the jobs and the owner's answers.
  - Anything built.
- **Order:** the [jobs-first guide](../../../../.claude/skills/afd/references/jobs-first.md) puts
  the reader walks before the owner ranks the jobs. The owner may rank first; the walks still
  follow either way.
- **Follow-ups:** the [table below](#follow-ups-not-yet-issues).

## Steps

| Step | State | Evidence |
| --- | --- | --- |
| Scaffold: problem, what exists, draft jobs | Done 2026-11-13 | [`design-decisions.proposal.md`](design-decisions.proposal.md) |
| Open the epic | Done 2026-11-13 | Epic [#1108](https://github.com/lushly-dev/afd/issues/1108) |
| Draft the design and the commands | Done 2026-11-13, not merged | Proposal, sections 6 and 7 |
| Write each job as a scenario and run the checks | Done 2026-11-13, not merged | [`scenarios/`](scenarios/), ten files, 39 steps; [How the jobs were checked](#how-the-jobs-were-checked) |
| Recommend an answer to each open question | Done 2026-11-13, not merged | Proposal, section 12 |
| Walk the paths with readers who did not write them | First walk done 2026-11-13, findings applied; the revision not walked | [The walk](#the-walk), proposal section 4 |
| Independent review | Scaffold reviewed 2026-11-13; the draft reviewed 2026-11-13 with the other two drafts, findings applied | [The review](#the-review) |
| The owner cuts, adds and ranks the jobs and answers section 12 | Not started | Proposal, section 12 |
| Build the slice (phases 1 to 5) | Not started; needs the owner's go | Proposal, section 8 |

## How the jobs were checked

Run on 2026-11-13 at `f7ecbd43` on Node 26.13.0 (`.nvmrc`), with the tools built in this
worktree.

Parse: `node packages/cli/dist/bin.js scenario validate docs/features/proposed/design-decisions/scenarios`

```text
✓ All 10 scenario(s) are valid!
```

The dry run with `checkFixtures: true` and the coverage report, from `packages/testing`, as the
[jobs-first guide](../../../../.claude/skills/afd/references/jobs-first.md#checking-without-a-server)
gives them:
- `knownCommands`: the ten commands in section 6.
- `knownErrors`: the twelve codes in section 6.

The dry run printed no errors. Coverage:

```text
{"totalScenarios":10,"totalSteps":39,"commands":{"tested":10,"known":10,"untested":[],"coverage":100},"errors":{"tested":12,"known":12,"untested":[],"coverage":100},"jobs":{"count":10,"names":["be-told-before-undoing","capture-a-baseline","compare-like-with-like","reverse-a-decision","keep-what-was-not-chosen","record-the-choice","refuse-a-misleading-comparison","review-only-what-needs-eyes","stay-quiet-about-what-is-settled","turn-a-check-into-a-question"]}}
not drafted: []
```

Scenarios tagged `slice`: 01, 03, 04, 05, 07 and 10. Tagged `refuse`: 07. Tagged `quiet`: 08.

Lists under `expect.data` are compared whole (`packages/testing/src/runner/evaluator.ts:432`), so
every assertion on part of a list uses a dotted index path, such as `open.0.kind`. The checks
above do not evaluate expectations; this was checked by reading each scenario.

The runner resolves step references in `input` only (`packages/testing/src/runner/scenario-runner.ts:308`).
The dry-run script above also prints `REF IN EXPECT` for any step whose `expect` contains
`${{`, and printed nothing.

## The review

| Date | Reader | Scope | Findings |
| --- | --- | --- | --- |
| 2026-11-13 | One independent reader, briefed by the coordinator, who wrote none of the drafts | Design Decisions, Screens from Jobs and Pointing together, with scenarios run against the runner | One blocker, four improvements, plus conventions the coordinator set across the three |

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
  `decision-check`.
- **Conventions, the owner's to confirm** (proposal section 5):
  - content-addressed set ids, with the hashed fields listed;
  - random `dec-` ids;
  - `specimens/decisions/<id>.json` and `specimens/evidence/<set id>/`, written and never
    committed by a command;
  - `.specimen/` to be added to `.gitignore`;
  - one review system for job sets too;
  - job specimens skipped by `specimen-capture` until the runner exists;
  - one MCP host;
  - every command that writes files a mutation.

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
  - Violet's operation `reason` and the `experiment` node type, and Loam's null `reason`.
  - Loam's decisions, now D1 to D115, and the component checklist.
  - `CommandResult.alternatives`.

## Follow-ups not yet issues

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-11-13 | Scaffold survey | `specimen-diff`'s command output schema allows only the channels `dom`, `a11y`, `layout`, `styles` and `state` (`integrations/specimen-afd/src/commands.ts:152`). But `diff.ts:267` can report an `events` difference (`ChannelDifference`, `foundations/specimen/src/types.ts:670`), and the command parses its result against that schema (`commands.ts:197`). So a diff with an events difference fails as `SPECIMEN_OUTPUT_INVALID`. Checked by reading; not run | Open; worth an issue. Phase 1 of the proposal fixes it |
| 2026-11-13 | First walk | Specimen has no MCP host, and `executeSpecimenCommand` runs every call as `{ kind: 'script' }` (`integrations/specimen-afd/src/commands.ts:570`). So no Specimen command can record a person's answer today | Open; proposal phase 5 and question 8 |
| 2026-11-13 | Scaffold survey | Violet's `changes.impact` change schema has no `reason`, so the apply commands it returns drop one | Open; proposal section 8, Later |
| 2026-11-13 | Scaffold survey | `incompleteChecks` from `specimen-a11y` never affect a status and are sent nowhere | Answered in the draft by job 6 and `specimen-review` |

## Session log

| Date | Session | What changed |
| --- | --- | --- |
| 2026-11-13 | Scaffold | After the [Patterns](../patterns/patterns.proposal.md) proposal, the owner agreed to four follow-on proposals from the same discussion: Design Decisions, Screens from Jobs, Pointing and Scales. This scaffold was written from a survey of the code, reviewed once by an independent reader, and committed with its epic |
| 2026-11-13 | Draft | The owner asked for the proposals to be filled in and kept as drafts. Jobs tightened, eight scenarios written, commands drafted, the three checks run clean. Writing the scenarios added saved captures, a typed refusal for incompatible captures, review answers kept as decisions and a decision named on review items, and cut `decision-open`. Section 2 re-read first-hand |
| 2026-11-13 | Walk and revision | One fresh reader walked the draft from three seats, with the verdict revise. All four blockers and ten improvements were applied, as the proposal's section 4 records. The jobs grew from eight to ten, the commands from eight to ten and the errors from nine to twelve. Partial-list assertions became dotted paths. The three checks were rerun clean |
| 2026-11-13 | Review and revision | One independent reader reviewed the three drafts together and ran scenarios. Applied: no step references in `expect`, answers as their own kind, superseding by acceptance writes a choice, default subjects stated, and the coordinator's shared conventions (random decision ids, `specimens/` paths, the hashed fields, `.specimen/` to be ignored, one review system, the job-specimen skip, one host). The three checks were rerun clean, with a scan for references in `expect` |
