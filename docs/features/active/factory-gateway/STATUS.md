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
- **Last verified:** 2026-11-15 (dates in this file are Pacific time) against `main` at
  `a81e8d44`: `gh pr view` reads #1230, #1232, #1265, #1267 and #1271 as `MERGED`, and
  `uv run --frozen pytest tests/test_gateway_scenarios.py` in `botcore-factory` ran all fifteen
  jobs against the fake GitHub before #1232 merged. No gateway runs as a service yet, and no
  real GitHub write has been made through it.
- **Done:** the proposal, jobs and manifest (#1222); botcore's host changes 1, 2, 5 and 6
  ([#1230](https://github.com/lushly-dev/afd/pull/1230), merged 2026-11-15); the G1 command
  skeleton in `botcore-factory` against a fake GitHub, all fifteen jobs passing
  ([#1232](https://github.com/lushly-dev/afd/pull/1232), merged 2026-11-15); the commit-credit
  check in both repositories' `ci-ok` ([afd#1250](https://github.com/lushly-dev/afd/pull/1250),
  [lushly#2403](https://github.com/lushly-dev/lushly/pull/2403)).
- **Reviewed and merged in #1265:** `COMMIT_AUTHOR_NOT_OWNER` (a push adding a commit the owner did not author,
  checked only for commits GitHub does not already have), each repository's merge method
  (`mergeMethods`, a merge commit by default; `MERGE_METHOD_NOT_ALLOWED` when GitHub refuses
  it) and the `/session` route's push to its queue ref; job 15 gained the author step
  ([#1265](https://github.com/lushly-dev/afd/pull/1265)). An independent review (Opus 5.5) found
  three blockers, all fixed: an upload without a commit list passed the check (now
  `UPLOAD_INCOMPLETE`), "GitHub already has it" exempted agent commits on any branch (now only
  commits on `main` are exempt, through the port's `on_main`), and the auto-merge path's method
  was untested. Its upload route (botcore change 4) must read commits and authors from the bundle,
  never from the caller. Open: a session or cell can overwrite another branch's queue ref, since
  the fast-forward rule covers only `refs/heads/`.
- **Done since:** the credit and handoff rules (`COMMIT_AUTHOR_NOT_OWNER`, each repository's
  merge method, the `/session` queue push;
  [#1265](https://github.com/lushly-dev/afd/pull/1265)); botcore's changes 4 and 7, the HTTP
  surface with per-caller tokens and its client
  ([#1267](https://github.com/lushly-dev/afd/pull/1267), merged 2026-11-15 as `b5d175fe`); the
  gateway as a server (`factory-gateway-admin serve`, `token issue|list|revoke`;
  `factory-gateway` for callers) with bundle uploads read by git into a bare mirror per
  repository ([#1271](https://github.com/lushly-dev/afd/pull/1271), merged 2026-11-15 as
  `270f4450`). Security passes (Opus 5.5) found three blockers across #1267 and #1271, all fixed
  with tests. `serve` still runs only against a fake GitHub.
- **The App (G0):** created and installed by the owner on 2026-11-15: `lushly-factory-gateway`,
  App ID `5777732`, installation `182417554` on `lushly-dev`, limited to `lushly-dev/afd` and
  `lushly-dev/lushly`, with the proposal's permissions (actions and metadata read; actions
  variables, checks, contents, issues, pull requests and workflows read and write). No private
  key or client secret exists yet; the key is generated when the adapter is ready to run on
  `random` and goes straight to the service user, never through chat.
- **Next, in order:** the App-backed adapter; the fix for queue refs (a session or cell can
  overwrite another branch's queue ref, since the fast-forward rule covers only `refs/heads/`);
  change 3 redesigned so the host is the only validator (held on
  `lush/botcore-command-tools`); the lane on `random`
  with its health in `gateway-status`; the factory plugin on the gateway (after
  `feat/factory-lane-loop` lands); Lushly's side ([lushly#2392](https://github.com/lushly-dev/lushly/issues/2392));
  the process files and the two process checks.
- **Not done:** every milestone below.

## Milestones

| Milestone | State | Jobs | Process files changed |
|---|---|---|---|
| G0: stand it up | In progress: the App created and installed 2026-11-15; open: the adapter, the key on `random`, the service user, start on boot, the runbook, the test writes and squash-credit check | — | — |
| G1: one writer (MVP) | In progress since 2026-11-14: botcore host changes ([#1230](https://github.com/lushly-dev/afd/pull/1230)) and the command skeleton against a fake GitHub ([#1232](https://github.com/lushly-dev/afd/pull/1232)), all fifteen jobs passing, both merged 2026-11-15; Lushly side tracked in [lushly#2392](https://github.com/lushly-dev/lushly/issues/2392) | `mvp` (01–11, 15) | — |
| G2: review as a record | Open | `records` (12) | — |
| G3: events, not polling | Open | `events` (13–14) | — |
| G4: no credential outside the door | Open | unit tests and the exit | — |
| G5: sessions through the door | Not specified; specified when G4 exits unless the owner ranks it earlier | — | — |

## Owner decisions

| Date | Decision |
|---|---|
| 2026-11-14 | The gateway lives in `botcore-factory`; it runs on the always-on machine, `random`; it is built as an MVP and then milestones, each updating the skills, tools and `AGENTS.md` that use it as it lands; the proposal goes in `active/` |
| 2026-11-15 | Work that reaches GitHub is credited to the owner as its main contributor: the commits the gateway pushes and merges carry his authorship, whichever account opens or merges the pull request. The gateway refuses a commit he did not author and merges by each repository's method; G0 tests how an App's squash merge is credited in Lushly. Agents are listed with an email-free `Assisted-by:` trailer, enforced in both repositories' `ci-ok` |
| 2026-11-15 | Setup for other people waits until there are other people: the project has one developer and no second account to test with. G4 stays the last milestone |
| 2026-11-15 | Interactive sessions hand their branches to the lane through the gateway (the `/session` route's queue push, in G1) instead of merging them themselves; documentation-only pull requests may still merge directly. Prompted by `main` moving under running validations in Lushly |
| 2026-11-15 | The lane runs on `random` beside the gateway: the Mac is not always on. `gateway-status` reports the lane |
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
- 2026-11-14: [#1230](https://github.com/lushly-dev/afd/pull/1230) opened with botcore's host
  changes 1, 2, 5 and 6. `pnpm verify` caught that a default kebab-case rename broke Alfred's
  host (56 tests), so names became opt-in; two independent reviews (Opus 5.5, high) found a
  crash on unresolvable type hints and Alfred choosing targets by the spelling called, both
  fixed. Its gates pass (botcore 782 tests, the factory plugin 229, Alfred 130, Health).
- 2026-11-14: the G1 skeleton, [#1232](https://github.com/lushly-dev/afd/pull/1232), stacked on #1230. Verified with
  `uv run --frozen pytest tests/test_gateway_scenarios.py` in `botcore-factory`: all fifteen
  jobs pass through AFD's TypeScript scenario runner (`scenarios/run.mjs`, now shared with the
  factory's jobs: `FACTORY_HARNESS` picks the harness and `FACTORY_SCENARIO_ENV` each job's
  route), each on the route its header names. Job 13 runs on the foreman's route throughout,
  since a file runs against one route; its third step's consumer is the lane by name. Unit
  tests (`tests/test_gateway_routes.py`) cover the route boundaries, the owner's `force`, the
  write budget, `GITHUB_UNAVAILABLE`, `CHECK_NOT_REQUIRED`, `NOT_MERGEABLE`,
  `NOT_FAST_FORWARD`, `VARIABLE_NOT_ALLOWED`, the built-in secret rules, the cutover window and
  the journal. One job changed: 09's `expect` referenced an earlier step, which AFD's runner
  resolves only in `input`, so it now asserts issue 105, as job 04 does; the checks the
  proposal session ran (`validate`, dry run) do not execute steps and could not catch it.
  Refusals added beyond the draft: `UPLOAD_NOT_FOUND` (no live upload for `branch-push`),
  `BODY_TOO_LARGE` (text over `body.maxBytes`), `RESERVED_MARKER` (caller text holding a
  claim, release or dedupe marker, which would otherwise forge one as the bot),
  `CLOSING_KEYWORD_IN_BODY` (`pr-open` writes the closing lines itself), `NOT_GATEWAY_PR`
  (`pr-open` updates only pull requests the gateway opened) and `PR_CLOSED` (`pr-merge` of a
  pull request closed without merging). `issue-release` takes `force` only on the owner's
  route, so elsewhere it is refused as an input the command does not take. The proposal's
  tables are not yet updated for these.
- 2026-11-14: one independent review of the skeleton (Opus 5.5, high): 5 blockers, 9
  improvements and 2 nits. All blockers fixed, each with a test: claim and release markers
  forged through `issue-comment` (now `RESERVED_MARKER`), a multi-issue claim left partial by
  the write budget (now spent before the first write; a retry after an outage completes it),
  `pr-merge` queuing a closed pull request (`PR_CLOSED`), holders, dedupe keys, refs and
  branch names reaching GitHub unchecked, and concurrent writes racing (one lock on the shared
  state, with a concurrency test). Improvements fixed: the GitHub port gained `merge_pull`,
  `enable_auto_merge`, `disable_auto_merge` and `create_revert` in place of the fake's field
  updates; `pr-open`'s two refusals above; ref format checks; release by branch and machine;
  `VALIDATION_ERROR` for a bad `cursor` or `since`; `cancel` before the head check; event
  reads off the event loop; Lushly's legacy lease counts the account's latest activity, not
  only its start. Deferred: claims are released when the gateway merges at once; a queued
  auto-merge that lands later is released from G3's merge events. A focused second pass verified
  every fix and approved, with four small improvements: three fixed (a merge racing a push is
  `HEAD_MOVED`, closing keywords with issue URLs are refused, legacy activity counts only
  before the cutover) and one left to the App adapter (it runs `git check-ref-format` rather
  than the skeleton's pattern).
- 2026-11-14: botcore's change 3 (each command as its own MCP tool) is written on
  `lush/botcore-command-tools` but held back: its review found that the MCP SDK's own argument
  model, which validates before the host, rejects `**kwargs` handlers, can stop the server
  from being built on an unresolvable hint, and answers bad input outside AFD's error shape
  while dropping unknown keys. The fix is to publish the catalog's schema and pass arguments
  through so the host is the only validator, which needs a different hook into the SDK.
- 2026-11-14: filed [lushly#2392](https://github.com/lushly-dev/lushly/issues/2392), Lushly's side
  of G1 (claim script, lane steps, flake filer, process files and checks), as G1 started.

## Follow-ups not yet issues

| Raised | By | Follow-up |
|---|---|---|
| 2026-11-14 | Proposal session | ~~A Lushly issue tracking Lushly's side of G1 (claim script, lane steps, flake filer, process files and checks), filed when G1 starts~~. Superseded: filed as [lushly#2392](https://github.com/lushly-dev/lushly/issues/2392) on 2026-11-14 |
| 2026-11-14 | Proposal session | botcore's host changes ([What botcore needs](factory-gateway.proposal.md#what-botcore-needs)) overlap the factory's Phase 1 host changes; whichever starts first does them once for both. Superseded: taken 2026-11-14 by the gateway's G1 session on `random`: the gateway's host changes are done once, for both |
