# Factory Gateway: status

Read this before the [proposal](factory-gateway.proposal.md). It records exactly what is done and
what is not, so an agent never has to scan the code to learn what is current. It follows the shape
of the [Umbel status](../../../../endpoints/umbel/docs/STATUS.md).

## How to keep this file

- "Done" means merged to `main` with evidence linked. Anything else is "in progress" or "open",
  with what remains spelled out.
- Record how you verified it, the command or check, and the absolute date.
- A milestone is done only when its process files have changed too, in both repositories, and the
  two process checks pass
  ([Keeping the process current](factory-gateway.proposal.md#keeping-the-process-current)). Record
  each file and the pull request that changed it in the milestone's row, and mark the milestone
  `landed` in [`process.json`](process.json) in the same pull request.
- Write down follow-ups that are not yet issues, with the date and who raised them. Link the issue
  when one exists.
- Never delete history. Mark an entry superseded and point to what replaced it.

## Status block

- **State:** active by the owner's direction of 2026-11-14; the proposal is in review, and the
  owner's ranking of the jobs is next. Nothing is built.
- **Last verified:** 2026-11-14 against `main` at `dd080235`: the fifteen scenarios pass
  `afd scenario validate` and the dry-run check with fixtures resolved; the coverage report uses
  19 of 20 drafted commands and 17 of 24 error codes
  ([Checks](factory-gateway.proposal.md#checks)). Every path in `process.json` exists in its
  repository except the files a milestone creates (G0's runbook,
  `docs/operations/factory-gateway.md`). No code was built or run.
- **Done:** nothing yet.
- **Not done:** every milestone below.

## Milestones

| Milestone | State | Jobs | Process files changed |
|---|---|---|---|
| G0: stand it up | Open; needs the owner to create and install the App | — | — |
| G1: one writer (MVP) | Open | `mvp` (01–11, 15) | — |
| G2: review as a record | Open | `records` (12) | — |
| G3: events, not polling | Open | `events` (13–14) | — |
| G4: no credential outside the door | Open | unit tests and the exit | — |
| G5: sessions through the door | Not specified; specified when G4 exits unless the owner ranks it earlier | — | — |

## Owner decisions

| Date | Decision |
|---|---|
| 2026-11-14 | The gateway lives in `botcore-factory`; it runs on the always-on machine, `random`; it is built as an MVP and then milestones, each updating the skills, tools and `AGENTS.md` that use it as it lands; the proposal goes in `active/` |
| Open | The six questions in [For the owner](factory-gateway.proposal.md#for-the-owner), the ranking of the jobs first |

## Session log

- 2026-11-14: proposal, fifteen jobs and fixtures written and checked. Three readers walked them
  (the people, the job list, the calling agent, each with Opus 5.5 at medium effort); the revision
  that followed is recorded in the proposal's
  [Walking the paths](factory-gateway.proposal.md#walking-the-paths). Checks rerun after it.
- 2026-11-14: one independent review (Opus 5.5, high effort): 3 blockers, 9 improvements and 6
  nits, all fixed in the same pull request except one nit declined: a scenario for
  `VARIABLE_NOT_ALLOWED`, since `variable-set` belongs to the factory's job 02 and has no job here.
  A focused pass by a second fresh reviewer (Opus 5.5, high effort) then verified the fixes: eight resolved, four partly, with
  four new improvements and five nits; all were fixed. See the proposal's
  [Review](factory-gateway.proposal.md#review). Checks rerun after it: 15 files, 70 steps.

## Follow-ups not yet issues

| Raised | By | Follow-up |
|---|---|---|
| 2026-11-14 | Proposal session | A Lushly issue tracking Lushly's side of G1 (claim script, lane steps, flake filer, process files and checks), filed when G1 starts |
| 2026-11-14 | Proposal session | botcore's host changes ([What botcore needs](factory-gateway.proposal.md#what-botcore-needs)) overlap the factory's Phase 1 host changes; whichever starts first does them once for both |
