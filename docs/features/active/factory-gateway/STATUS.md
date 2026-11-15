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

- **State:** active by the owner's direction of 2026-11-14. The proposal merged on 2026-11-14 as
  [#1222](https://github.com/lushly-dev/afd/pull/1222) (merge commit `57397cdb`), so it is no
  longer in review. Work started on 2026-11-14 in a session on `random`, the machine the gateway
  will run on: botcore's host changes and G1's command skeleton against a fake GitHub, which need
  no GitHub App. The owner's ranking of the jobs, the six questions in
  [For the owner](factory-gateway.proposal.md#for-the-owner) and the App (G0) are still his.
- **Last verified:** 2026-11-14 (dates in this file are Pacific time) against `main` at
  `57397cdb`: `gh pr view 1222 --json state,mergeCommit` reads `MERGED` at `57397cdb`, and
  `git ls-tree origin/main docs/features/active/factory-gateway/` lists the proposal,
  `process.json` and `scenarios/` with its fixtures. The scenario checks
  were last run by the proposal session against `dd080235` (15 files, 70 steps; 19 of 20 drafted
  commands and 17 of 24 error codes covered,
  [Checks](factory-gateway.proposal.md#checks)). No gateway code is on `main` yet.
- **Done:** the proposal, jobs and manifest (#1222).
- **In progress:** botcore's host changes ([What botcore needs](factory-gateway.proposal.md#what-botcore-needs))
  and the G1 command skeleton; their pull requests are linked in the session log as they open.
- **Not done:** every milestone below.

## Milestones

| Milestone | State | Jobs | Process files changed |
|---|---|---|---|
| G0: stand it up | Open; needs the owner to create and install the App | — | — |
| G1: one writer (MVP) | In progress since 2026-11-14: botcore host changes and the command skeleton against a fake GitHub; Lushly side tracked in [lushly#2392](https://github.com/lushly-dev/lushly/issues/2392) | `mvp` (01–11, 15) | — |
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

- 2026-11-14: proposal merged as #1222 (`57397cdb`). A new session on `random` took the work over
  from the proposal session on Hero. Overlap check against open AFD pull requests and the four
  branches in flight on Hero, read 2026-11-14:
  - `feat/botcore-host-catalog` merged as #1181 (plugin policies, input schemas in the catalog,
    named refusals), `feat/factory-plugin-intake` as #1183 and `feat/factory-plugin-queue` as
    #1185. These are on `main`; the host changes build on them.
  - `feat/factory-lane-loop` (`1ba67bb3`, 2026-11-13) is pushed with no pull request. It changes
    `botcore-factory` (the lane process, loop, hosts and report, and a rewrite of
    `real_world.py`), the root `botcore.toml`'s `[plugins.factory]` keys, and the software
    factory's scenario 10 with two new fixtures; it does not touch botcore's host. The gateway is added as new modules so the two do not
    collide; its claims, queue push and lane steps move onto the gateway after it lands.
  - No open pull request touches `endpoints/botcore/`.
  - So this work does the host changes once, for the gateway and the factory's Phase 1 together
    (the follow-up below).
- 2026-11-14: filed [lushly#2392](https://github.com/lushly-dev/lushly/issues/2392), Lushly's side
  of G1 (claim script, lane steps, flake filer, process files and checks), as G1 started.

## Follow-ups not yet issues

| Raised | By | Follow-up |
|---|---|---|
| 2026-11-14 | Proposal session | ~~A Lushly issue tracking Lushly's side of G1 (claim script, lane steps, flake filer, process files and checks), filed when G1 starts~~. Superseded: filed as [lushly#2392](https://github.com/lushly-dev/lushly/issues/2392) on 2026-11-14 |
| 2026-11-14 | Proposal session | botcore's host changes ([What botcore needs](factory-gateway.proposal.md#what-botcore-needs)) overlap the factory's Phase 1 host changes; whichever starts first does them once for both. Superseded: taken 2026-11-14 by the gateway's G1 session on `random`: the gateway's host changes are done once, for both |
