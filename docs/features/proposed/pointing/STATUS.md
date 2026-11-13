# Pointing: status

Read this before the [proposal](pointing.proposal.md). It records exactly what is done and what is not, so an
agent never has to scan the code to learn what is current. It follows the shape of the
[Patterns status](../patterns/STATUS.md).

## How to keep this file

- "Done" means merged to `main` with evidence linked. Anything else is "in progress" or "open",
  with what remains spelled out.
- Record how you verified it, the command or check, and the absolute date.
- Write down follow-ups that are not yet issues, with the date and who raised them. Link the issue
  when one exists.
- Never delete history. Mark an entry superseded and point to what replaced it.

## Status block

- **State:** draft. Filled in 2026-11-13 against `main` at `f7ecbd43`. Walked once, reviewed
  once, not approved.
- **Epic:** [#1110](https://github.com/lushly-dev/afd/issues/1110). Its checklist mirrors the steps below; this file
  stays the source of truth.
- **Done:** the problem, what exists today (verified first-hand), nine jobs, a design, ten
  drafted commands and thirteen error codes, nine scenario files, the three checks, recommended
  answers to the six open questions, and one walk by a fresh reader with its findings applied.
- **Not done:** the owner's ranking of the jobs, decisions on the recommendations and confirming
  the shared conventions (proposal 4.0). Nothing is implemented.
- **Order:** this draft follows the
  [jobs-first guide](../../../../.claude/skills/afd/references/jobs-first.md) from step 1 to step 6
  (one walk), and has had one independent review. Step 9, the owner ranking the jobs, is next.
- **Follow-ups:** the [table below](#follow-ups-not-yet-issues).

## Steps

| Step | State | Evidence |
| --- | --- | --- |
| Scaffold: problem, what exists, draft jobs | Done 2026-11-13 | [`pointing.proposal.md`](pointing.proposal.md) |
| Open the epic | Done 2026-11-13 | Epic [#1110](https://github.com/lushly-dev/afd/issues/1110) |
| Draft the design and commands | Done 2026-11-13, uncommitted | Proposal, sections 4 and 5 |
| Write each job as a scenario and run the checks | Done 2026-11-13, uncommitted | [`scenarios/`](scenarios/), nine files, 37 steps; [How the jobs were checked](#how-the-jobs-were-checked) |
| Walk the paths with readers who did not write them | Done 2026-11-13, uncommitted: one fresh reader, three seats; three blockers and nine improvements, all applied | Proposal, [section 7](pointing.proposal.md#7-what-the-walk-changed) |
| Independent review | Scaffold reviewed 2026-11-13 (one pass, findings fixed); the draft reviewed 2026-11-13 (one pass, findings fixed), uncommitted | Proposal, end of [section 7](pointing.proposal.md#7-what-the-walk-changed) |
| The owner cuts, adds and ranks the jobs and decides the recommendations | Not started | Proposal, sections 8 and 9 |

## How the jobs were checked

Run 2026-11-13, after the walk's and the review's fixes, on the `.nvmrc` Node with the tools built in this worktree, as the
[jobs-first guide](../../../../.claude/skills/afd/references/jobs-first.md#checking-without-a-server)
describes.

`node packages/cli/dist/bin.js scenario validate docs/features/proposed/pointing/scenarios`:

```text
✓ All 9 scenario(s) are valid!
```

The dry run with `checkFixtures: true` printed no errors for any file; eight scenarios declare a
fixture in [`scenarios/fixtures/`](scenarios/fixtures/), and none uses a step reference in
`expect`, which the runner resolves only in `input`. Coverage, with the ten
drafted commands and thirteen error codes:

```text
{"totalScenarios":9,"totalSteps":37,"commands":{"tested":10,"known":10,"untested":[],"coverage":100},"errors":{"tested":9,"known":13,"untested":["POINTER_INVALID","SPECIMEN_NOT_FOUND","POINT_NOT_FOUND","NOTE_NOT_FOUND"],"coverage":69.23076923076923},"jobs":{"count":9,"names":["close-a-note-with-a-reason","enough-not-everything","keep-an-orphaned-note","leave-a-note","choose-the-right-level","name-what-else-moves","point-instead-of-describe","refuse-a-stale-reference","see-the-change-first"]}}
not drafted: []
```

The four untested codes are plain lookups; the proposal's section 5 says why they have no job.
Partial list assertions are written as dotted paths (`notes.0.id`), because the evaluator in
`packages/testing/src/runner/evaluator.ts` compares a list under `expect.data` exactly.

## What was read to write it

First-hand on 2026-11-13 at `f7ecbd43`: every file the proposal's section 2 cites, the
`specimen-afd` command list, Violet's `token.override` and `changes.impact` inputs, and the
scenario format in `packages/testing`. The mechanisms in the proposal's section 4 draw on the
owner's earlier editor work, read for ideas only; no text or code was taken from it.

## Follow-ups not yet issues

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-11-13 | Scaffold survey | The Specimen host reports not-found and ambiguous targets as one untyped error (`foundations/specimen/host/src/page.rs:404`). The Patterns proposal drafts `TARGET_NOT_FOUND` and `TARGET_AMBIGUOUS` | Open; recommended for the first slice (proposal question 5) |
| 2026-11-13 | Draft | Where notes live should match where Design Decisions stores decisions | Open; proposal question 3 |
| 2026-11-13 | Walk | Each `specimen-point-check` from the CLI launches a browser, since the CLI creates a bench per call (`endpoints/specimen-cli/src/cli.ts:338`). Checking before every edit costs a launch each time | Open; a long-lived bench for the CLI would remove it |

## Session log

| Date | Session | What changed |
| --- | --- | --- |
| 2026-11-13 | Scaffold | After the [Patterns](../patterns/patterns.proposal.md) proposal, the owner agreed to four follow-on proposals from the same discussion: Design Decisions, Screens from Jobs, Pointing and Scales. This scaffold was written from a survey of the code, reviewed once by an independent reader, and committed with its epic |
| 2026-11-13 | Draft | The owner asked for the proposals to be filled in and kept as draft. Section 2 verified first-hand at `f7ecbd43`; jobs tightened (every job has a "so that"; job 3 and 9 stay quiet, jobs 4 and 8 refuse; the scaffold's "leave the rest alone" became job 6, "name what else moves"); design, eight commands and nine scenarios written; the three checks pass; six recommendations made for the owner |
| 2026-11-13 | Walk | One fresh reader walked the draft as the person, the job list and the calling agent. Blockers: scenarios 01 and 02 disagreed on which element a role resolves to (fixed by one shared climb, 4.1, and a separate `accessible`); job 5 showed the person nothing (screenshots and a preview link added); job 8 ended at detection (`specimen-note-move`, bulk `ids` on resolve). Improvements: token-only correction stated; `specimen-note-add` takes a pointer; `specimen-note-check` reports `unchecked` and `weakened`; `specimen-note-reopen` and `withdrawn`; random note ids; candidate tokens from Violet's `specimen.get`; paging; the check rule in the result and description; the CLI named with its launch cost. Separately, partial list assertions rewritten as dotted paths. Checks rerun clean: ten commands, 37 steps |
| 2026-11-13 | Review | An independent review of the three drafts. Fixed here: step references in `expect` (01, 07) replaced with literal values and patterns; a refusal in 04 given its suggestion; fixtures added for every scenario (stale point, orphaned notes, one note, toolbar, inbox); element refs numbered by tag (`example-button:1` and `:2`); `specimen-impact` takes `point` optionally and is a mutation (it writes screenshots); `pt-` ids defined; `SPECIMEN_NOT_FOUND` names the nearest ids. Shared conventions with the other two proposals recorded in proposal 4.0 for the owner to confirm: random ids, `specimens/` for committed records and `.specimen/` (to be gitignored) for local data, the MCP host from Design Decisions' phase 5. Checks rerun clean |
