# Software Factory: status

Read this before the [proposal](software-factory.proposal.md). It moved from `proposed/` to
`active/` on 2026-11-14, because Phase 1's implementation had started on `main`. Reconciled that
day against `main` at `ee1b5827`, from merged history; this reconciliation did not rerun the
plugin's tests.

## The `.nvmrc` Node at `lane-start`, nvm-windows, and `node-missing` ejections, 2026-11-17

The three gaps [#1351](https://github.com/lushly-dev/afd/pull/1351) left on purpose, closed by
[#1352](https://github.com/lushly-dev/afd/issues/1352)'s owner decisions, in
[#1502](https://github.com/lushly-dev/afd/pull/1502). Not yet seen in a fleet run.

- **`lane-start` checks the Node validation uses.** `TOOLCHAIN_MISMATCH` read `engines.node` and
  `pnpm` from the host's default `PATH`. It now resolves the `.nvmrc` Node as validation does and
  reads both with that Node's bin directory first on `PATH`, so `pnpm` is the one beside that Node
  when there is one, else the host's. `lane-host-probe` names a missing `.nvmrc` Node in `missing`.
- **nvm-windows is searched** (`NVM_HOME`, the directory `NVM_SYMLINK` points into, and
  `%APPDATA%\nvm`, each version in `v<version>\`), after the fnm and nvm roots.
- **A branch's own `.nvmrc` bump ejects only that branch.** When the merged slot's `.nvmrc` names a
  Node the host lacks (or an alias) and the branch changed `.nvmrc` against the base, it is ejected
  as `node-missing` (counted; its detail starts `NODE_MISSING`: keep the base's `.nvmrc`, or have the
  owner install that Node on the lane host). The base's own `.nvmrc` missing its Node still pauses
  the lane, as do coverage runs. The run-fleet runbook says how the foreman answers it.

## Ejections that count, gate files past the rerun limit, plan pacing and kept validations, 2026-11-17

Four owner-approved fixes from the second fleet (run-4), fixed by hand since they change the lane
that would merge them, in [#1470](https://github.com/lushly-dev/afd/pull/1470). None is yet seen
in a fleet run.

- **Only a branch's own failures count toward `cells.maxEjections`.** #499 and #503 were released at
  the limit after ejections their own changes did not cause (#503: three `conflict`s, two in
  provenance records alone; #499: `final-failed`, `conflict`, `ci-failed`). A `conflict` and the
  push, PR and merge plumbing (`push-failed`, `pr-failed`, `merge-failed`) now eject without
  counting (the record's `counted` is false, with its `excuse`). The foreman's new `ejection-excuse
  {branch, reason}` stops the latest ejection counting when a diagnosis finds a known flake (such as
  #1408), records `ejection-excused`, and answers an open `ejection-limit` once under it.
  `lane-status` shows `excused` and `countedEjections`; `lane-report` counts `ejections` and
  `excusedEjections`. Records `SCHEMA` is 3.
- **Gate files past the rerun limit.** #1391's guard refused to let the PR's `ci-ok` stand in when
  main's move touched any `gate_paths`. Past `lane.maxBaseReruns`, it now refuses only main's
  changes to the adapter's new `revalidate_paths` (AFD: `pnpm-lock.yaml`, `pnpm-workspace.yaml`,
  `package.json`, `.npmrc`, `.nvmrc`, `Cargo.lock`, `uv.lock`, `rust-toolchain.toml`, `.cargo/`),
  since `ci-ok` runs on the merge ref with main's own workflows and gates. A lockfile change on
  main, which the guard let through before as a `shared_paths` entry that is no gate path, now
  validates again too. The watch on `main_checks` after the merge is unchanged.
- **Plan pacing (the owner's rule).** The lane assigned the plan with the most room (elapsed minus
  used). It now assigns the highest pace: room below `plans.ceiling` over the days to the plan's
  reset (a plan without `resetsAt` reads it from its share elapsed of a seven-day window), so every
  plan tracks to its ceiling around its own reset. `plan-list` shows `left` (room below the
  ceiling), `pace`, `daysToReset` and `next`; `lane-status`'s `plan` carries its `pace`. The ceiling
  and its refusals stand.
- **[#1452](https://github.com/lushly-dev/afd/issues/1452): a finished validation is kept when its
  slot goes to the front.** #503's passed validation was discarded (`rerun`, `slot-needed`) so #506
  could validate. The validated branch now keeps state `validated` and its base; its checkout moves
  aside (`git worktree move` to `<checkout>.factory-slots/kept-<branch>-<hash>`), keeping the git
  directory where `pnpm verify`'s record lives, so the real pre-push decision still accepts its push
  (tested against `scripts/pre-push.mjs`). The base checks at the front decide whether it runs
  again. A `slot-released` record names it; the kept checkout is removed once no validated entry
  needs it: renamed aside at once and removed by `git worktree remove --force` in a detached
  process, which unregisters only that checkout (never `git worktree prune`). The slot checks out
  afresh, so the front branch's validation installs from nothing. A checkout that cannot move falls
  back to the old `slot-needed` rerun.

## Provenance conflicts, one foreman, and the lane's own review check, 2026-11-17

[#1410](https://github.com/lushly-dev/afd/issues/1410): three of round 2's ejections were merge
conflicts in provenance records alone. When a merge of `main` conflicts only in files the
adapter's new `regenerate` entries name, the lane now runs the entry's command in the slot while
the merge is open and commits it. AFD's runs `scripts/provenance-merge.mjs`, which merges each
unit's records three ways and recomputes the manifest hashes; a value both sides changed
differently still ejects as `conflict`.
[#1432](https://github.com/lushly-dev/afd/issues/1432): a second foreman took a seat on the same
lane. The foreman now names its session on `cell-register`, `lane-wait` and `dial-set`, which
takes a lease (`foreman.leaseMinutes`, 30); another session is refused `FOREMAN_BUSY`, and
`foreman-handoff` frees the lane.
[#1308](https://github.com/lushly-dev/afd/issues/1308) (#1444): the lane checks each review
itself with `main`'s verifier before validating, ejecting as `review-unverified`. Fixed by hand,
not by a cell, since the changes are to the lane that would merge them. Not yet seen in a fleet
run.

## Repairs, ejection details and the units checkout, 2026-11-17

Three faults the second fleet (run-3) found. [#1374](https://github.com/lushly-dev/afd/issues/1374):
a repair that rebased onto `main` was refused with `GATE_EDIT_IN_REPAIR` for gate files `main` had
changed, because the guard diffed from the ejected head; it now counts a gate path only when the
branch's own change to it differs from its own change at the ejected head (`git patch-id
--verbatim`), or the repair takes back a gate change it had made. Both are measured from a base
the lane fetches, not the worktree's `origin/HEAD`, which a branch could repoint; renames count
by both paths; and edits it cannot read refuse with `GATE_CHECK_FAILED`.
[#1373](https://github.com/lushly-dev/afd/issues/1373): an ejection's detail quoted a passing test
whose name said "failed"; `first_lines` now leads with the first test a runner marked failed and
`pnpm verify`'s `FAIL` summary rows, and never takes a line marked passed.
[#1354](https://github.com/lushly-dev/afd/issues/1354): the `units` command ran in the lane host's
own checkout; it now runs in a clean `units` slot (`<checkout>.factory-slots/units`) at the new
base. Fixed by hand, not by a cell, since the change is to the lane that would merge it.

## A branch that affects every unit is no longer validated again for ever, 2026-11-17 (#1391)

[#1369](https://github.com/lushly-dev/afd/issues/1369): in the second fleet (run-3), the #424
branch adds a workspace package, so it changes `pnpm-lock.yaml` and maps to `*`, and every move
of `main` overlapped it. Its validations passed five times in two attempts (35 to 40 minutes
each) and each was discarded by an unrelated merge outside the lane: two `a change affects every
unit`, three `main changed a shared input` (workflow files among them). The lane now counts an
attempt's main-moved reruns (`baseReruns` on its queue entry). Once they reach the new dial
`lane.maxBaseReruns` (default 2), the next move is not validated again locally when the validated
head merges onto the new `main` without a conflict and `main`'s changes touch none of the
adapter's `gate_paths`: the branch advances (`base-advanced` with `reason` `rerun-limit`, `detail`
saying why it would have rerun), is pushed at its validated head, and the PR's `ci-ok`, which
runs on the pull request's merge ref, stands in. It merges on green bound to that head and is
watched on `main` like any advance, so a red `main` afterwards pauses the lane and names it. A
conflict or a gate path still validates again (a `gate_paths` change on `main` keeps the
coverage rules as they were). `lane-report` counts `rerunLimitAdvances` (part of
`baseAdvances`), and the merged record carries `checkStoodIn`. The PR body says the check stood
in when the lane opens the PR; an already open PR keeps its body. The check runs on a `main` no
older than the one at the push (`checkBase`): past the limit, a move of `main` after the push (while `ci-ok` runs
or after it passed) that merges cleanly and touches no gate path does not trigger it again, so
the branch merges on that check of the older `main`, as any pull request here does (`main`'s
protection does not require an up-to-date branch). Only the watch on `main` covers that move, and
the `base-advanced` and `merged` records name `checkBase`; a fresh check on such a move is
[#1390](https://github.com/lushly-dev/afd/issues/1390). Not yet seen in a fleet run.

## A moved `main` no longer always means validating again, 2026-11-16

[#1350](https://github.com/lushly-dev/afd/issues/1350): in the first fleet, every move of `main`
before a merge sent the validated branch back to be validated again (`requeue(entry,
"main-moved")` in `lane_merge.py`), which tripled the validations per merge. The lane now reads
what `main` changed since the branch's validated base and advances the branch to the new base,
with no new validation, when `main`'s changes touch none of the adapter's `shared_paths` or
`gate_paths`, the validated head merges onto the new base without a conflict (`git merge-tree`),
and the units `main`'s changes affect share none with the branch's. The adapter's `units` command
names them; AFD's is `scripts/factory-units.mjs` (packages with their dependents, workflows a path
triggers, directories, or `*` for a global input, a manifest or the lockfile). Otherwise it validates again as before; the
`rerun` record's `detail` says why. An advance is a `base-advanced` record, and `lane-report`
counts `baseAdvances`. A merge after one is watched on `main`: a check run `main_checks` selects
failing on its merge commit raises `main-broken` (`reason` `unchecked-merge`, `suspects` the PRs
merged without a re-check) and pauses the lane; checks still unfinished after
`lane.checkTimeoutMinutes` are one `lane-error`, and that merge is no longer watched. `ci-ok` runs on pull requests only, so AFD's
`main_checks` takes every check run on the merge commit except publishing and deploying. Not yet
seen in a fleet run.

## The first fleet, 2026-11-16

The first fleet runs on the MacBook Air: one slot, one cell (`cells.max` 1; `host.minFreeGb`
lowered to 4 while `fseventsd` holds 5 GB), on the Claude week the lane chose. Its cell for #386
(Opus 5.5 `high`) implemented, reviewed and recorded the review, then was held at enqueue: the
push of the queue ref ran AFD's full pre-push checks, which outlast the plugin's 60-second
subprocess limit (#1331). `pre-push.mjs` now accepts a push that only updates the lane's refs
(`refs/factory/queue/*`, and `refs/factory/hosts/*`, which holds host records): a queue ref is a
hand-off, and the lane validates the head and pushes the branch under its own record, through the
same hook. Also found: a cell that ends its turn to wait
for a background reviewer reads to the foreman as finished, so the brief now has the cell wait in
its turn and the runbook checks for a run in progress before dropping one; and `delegate_task`'s
worktree isolation worked.

Queued, the branch was ejected at the lane's final validation: Loam's kernel failed its typecheck
(TS2883 on zod's types) and Loam's CLI and apps failed their tests, in code the branch never
touched.
The cause was the slot's place, `.git/factory/slots/1`: TypeScript refuses those declarations in a
project whose path has a `.git` segment (the same checkout, copied elsewhere, passed). The lane's
slots are now `<checkout>.factory-slots/<n>`, beside the repository; a slot left at the old place
is removed with `git worktree remove --force .git/factory/slots/<n>` while the lane is stopped.

The second attempt passed `pnpm verify`, then `main` moved (#1338) and the lane validated again,
as it should; that run failed the Better Auth hosted harness's second sign-in with no message. A
diagnosis on Fable `medium` found a harness flake under load, not the branch. The cell hardened
the harness on its branch (a redacted reason line on failure, a stable signed-out read before each
sign-in, 8-second local operations) and fixed #1334 on the way. The third attempt merged:
[#1343](https://github.com/lushly-dev/afd/pull/1343), closing #386 and #1334. `lane-report` for
`run-2`: 1 merged in 2.0 hours, 3 validations per merge, a productive share of 0.32, 2 foreman
wakes. Its `byPlan` was empty, because a merge recorded the cell's route but not its plan; it now
records both. The cell brief now says a new or rebased worktree needs an install and a build before
its checks pass. Open from the run: #1341 (the lane validates on the host's default Node, 24.21,
not `.nvmrc`'s 26) and #1330. The run was stopped after the one cell, as the owner asked.

## The fleet's command lines and `run-fleet`, 2026-11-15

`factory` and `factory-cell`, the plugin's command lines (`botcore_factory.cli`), serve the two
hosts over the real world for the checkout they run in, so a cell can call `lane-enqueue` and the
foreman can leave a background `lane-wait`. Before this, only the fixture harness and the detached
lane process could call the real host. `run-fleet`, the foreman's procedure, is the verb-noun skill
in Botcore's format that replaces Lushly's `do-run-fleet` when Lushly moves onto the plugin
(Phase 4); its rules are `do-run-fleet`'s, over the plugin's commands. It says what to do where a
command is still missing (`cell-park`, `lane-revert`, `lane-handoff`), and that cells run on the
lane host until `lane-handoff` exists. The skill listing budget rose to 6,600 under the owner's
standing rule. The command line reads JSON from `--args-file` for Windows PowerShell and makes a
relative `worktree` absolute, so the lane later reads the cell's PR body (`.factory/pr-body.md`,
git-ignored) from the cell's worktree; `prepare-pr lane` now passes a title and body. PR: [#1310](https://github.com/lushly-dev/afd/pull/1310).

Review (Opus 5.5; it reported low effort though high was asked) found four blockers, fixed: the
foreman could hang at the finish (an open `queue-empty` is not repeated and the wait had no
timeout), a fresh foreman ignored events its predecessor had read (`openEvents`), enqueue stored
`.` as the worktree and passed no title or body, and JSON arguments break under Windows
PowerShell. Recorded, not fixed here: a cell runs its own branch's copy of the plugin and
adapter, and the lane does not re-verify the review, so a branch that edits them could skip the
review check (Lushly's lane has the same shape); and the plugin's host lock cannot see Lushly's
script lane on a shared host. A focused re-check closed all four and found one more, fixed: a
handled `main-broken` was never resolved, so the next foreman would file it again. Follow-ups:
[#1308](https://github.com/lushly-dev/afd/issues/1308) and
[#1309](https://github.com/lushly-dev/afd/issues/1309).

Known before the first run: on `random`, Lushly's script lane and this lane share the cores and
the plugin's host lock cannot see Lushly's, so AFD's lane runs only while Lushly's is idle
([#1309](https://github.com/lushly-dev/afd/issues/1309)). A read-only probe of the real host on the MacBook Air (2026-11-15) found no
lane host set, no machine probed, and `canStartCell` false there (7.1 GB free against
`host.minFreeGb` 8).

## Review evidence and `prepare-pr`'s lane mode, 2026-11-15

AFD's adapter now names `review_evidence`, so `lane-enqueue` no longer refuses AFD branches with
`NOT_CONFIGURED`. `prepare-pr lane` runs full mode's base sync, review, docs and commit, then
records the review with `scripts/review-record.mjs write` and calls `lane-enqueue`; it never runs
the full `pnpm verify`, pushes or opens the PR. The record keeps one entry per review lane in the
factory gateway's `review-record` shape (lane, model, effort, verdict, fixed, deferred) and lives
in the worktree's git directory, bound to the commit and tree reviewed. `verify --head <sha>`, the
adapter's command, accepts only a passing review of that exact, checked-out, clean commit with an
independent lane; any later commit needs the review recorded again. As with the gateway, the
verdicts are the cell's report of its reviewers, typed and bound to the head but not proven.
`REVIEW_MISSING` now carries the verifier's first line (for example, which commit the recorded
review covers), and a verifier that cannot run or runs past 120 seconds is `REVIEW_MISSING` with
its reason rather than `READ_FAILED`. The verifier, `verify-record.mjs` and `pre-push.mjs` joined
`gate_paths`, so a repair cannot change the rule it is judged by without `gate-allow`.

Review: one independent pass (Opus 5.5; the reviewer reported low effort though high was asked)
found one blocker, fixed: started through a symlink or Windows junction, the script's entry check
failed and `verify` exited 0 without checking. It now compares real paths and refuses when it
cannot confirm itself, with a symlinked-invocation test that fails on the earlier code. Also
fixed from that pass: crashes print one `review-record:` line, lane names `Self`/`self-review`
count as self-review, `--lanes-file` for Windows shells, and the proposal's lane-mode order.
Deferred: the script repeats about 35 lines of `verify-record.mjs`'s identity and file helpers
so it stands alone in the plugin's fixture (a test pins the shared base list).
A focused re-check by the same reviewer approved the fixes with no blocker open; its two nits
(the command-line test now strips `GIT_*`, and a doubled blank line) are fixed.

Evidence: `scripts/review-record.test.mjs` (37 tests, including a real repository, a linked
worktree and a symlinked start) and the plugin's `test_lane_git.py`, which runs AFD's adapter command through the
plugin's real process runner against the real script. PR: [#1305](https://github.com/lushly-dev/afd/pull/1305).

Phase 1 still needs, as the proposal lists it: the webhook wake, experience review (`pr-preview`
and the before-and-after screens), `run-fleet`, and one measured AFD fleet run on the
workstation.

## Lane-loop repair on the MacBook Air, 2026-11-15

**Merged:** [PR #1295](https://github.com/lushly-dev/afd/pull/1295) merged on 2026-11-15
(Pacific) as `a8a1f0f9`, with all ten checks green including `ci-ok`. The account below was written
before the merge; its "no lane-loop PR has merged" and "the final receipt belongs to the PR" are
superseded by it.

The initial draft [PR #1294](https://github.com/lushly-dev/afd/pull/1294) exposed a historical
agent co-author trailer in checkpoint commit `1ba67bb3`, which the current commit-credit gate
refuses. The checkpoint and original delivery history remain preserved. The same reviewed
changes are carried by the owner-authored `lush/factory-lane-delivery-1280` branch over
`origin/main` at `c3884d85` (the intervening main change concerns Specimen's Windows host).
The replacement is draft [PR #1295](https://github.com/lushly-dev/afd/pull/1295); #1294 is
closed as superseded. No lane-loop PR has merged.

The recovery bundle was verified and imported at `94ad8bb7` into
`lush/factory-lane-air-handoff`. This branch now includes `origin/main` at
`7cdd534e`. The four regressions tracked by [AFD #1280](https://github.com/lushly-dev/afd/issues/1280)
have regression fixtures and repairs:

- Push from the validated checkout with an explicit commit refspec and lease. Reserve its
  slot until pushed; release a later reservation if an earlier entry needs revalidation.
- Read the job's timeout boolean separately from install diagnostics.
- After a GitHub merge refusal, fetch the base again; a policy refusal on the same base
  ejects with its diagnostics rather than repeatedly requeuing.
- Retain bounded opening and closing diagnostics from both git streams.

A local git integration fixture exercises the real AFD pre-push decision with synthetic
verify-record data, proving the correct checkout is used and a reused slot is refused. It is
test data, not a validation receipt. macOS testing also found and repaired zombie liveness
after killing a detached process; start-time identity checks remain in place.

The independent review (GPT-6.1 Sol, high) also found three blockers: POSIX job steps in
separate sessions surviving cancellation, PR creation/reuse ignoring `base_branch`, and
terminal queue refs surviving to interfere with host moves and recovery. The repairs kill
the captured descendant tree, bind PR lookup and creation to the configured base, and retire
queue refs with a lease on the enqueued head at merge, ejection and drop. A failed cleanup
pauses the lane; a newer queue ref is preserved. `lane-stop` and `lane-drop` declare their
subprocess effects and git capabilities.

Validation: frozen installs, Ruff lint/format and all 500 plugin tests passed on both Python
3.11 and 3.12 on the Air. All 24 scenario files parse and validate with fixtures; coverage is
35 of 36 drafted commands across 110 steps (`lane-run` is retained for debugging). The
plugin suite executes the implemented factory and gateway scenarios, not every later-phase job.
The focused independent re-check (GPT-6.1 Sol, high) approved the fixes with no remaining
blockers. Its optional improvement is deferred: a failed queue-ref cleanup conservatively
revalidates on resume rather than persisting the completed failure; ownership is retained and
the extra run is recorded. The final `pnpm verify` receipt and remote checks belong to the PR.
Phase 1 remains in progress: this branch is not a measured live factory run, and the adapter's
review-evidence integration and the other remaining work in the phase table are still open.

## Preserved Windows checkpoint, 2026-11-15

`feat/factory-lane-loop` in `AFD-worktrees/factory-loop` now includes `origin/main`
at `6d7c505a` (merge `a5c6dbcd`). Its previously uncommitted review fixes are
preserved in `4ec35e7e`. The merge kept the lane adapter settings and followed
the proposal's move to this active folder. Nothing from this branch has been
pushed during this refresh, and it has no pull request.

Validation after the update: frozen pnpm install and Python 3.12 uv sync passed;
Ruff lint and format checks passed; all 441 plugin tests passed on Python 3.12;
the merge's pre-commit and commit-message hooks passed after building the
workspace dependencies. Python 3.11 and the full `pnpm verify` gate were not run
in this refresh.

The last independent review still has four open regressions, to fix before
opening the lane-loop pull request:

- Push the validated commit from the checkout whose `pnpm verify` record the
  pre-push hook accepts, while retaining the binding to that exact commit.
- Do not classify a normal install failure as a timeout merely because its job
  status marker contains `timedOut`.
- Distinguish a merge refused by GitHub policy from a base that moved; a policy
  refusal must not requeue forever.
- Retain enough git error output to recognize a refused push after its first
  error line, with fixtures matching real git and gh output.

The passing suite does not close these review findings. Add regression coverage
for the real output and re-check the fixes before shipping the branch.

## Phases

| Phase | State | Evidence / next gate |
| --- | --- | --- |
| 0. Prerequisites | Done 2026-11-13 | The proposal's [Phases](software-factory.proposal.md#phases): intake (#1100), `ci-ok` (#1123, #1136), the pre-push `pnpm verify` record (#1127), the Windows workstation (#1115, #1121, #1130, #1134) |
| 1. The plugin, one slot | In progress | Botcore's host changes, plugin policies, input schemas in the catalog and named refusals (#1181); `botcore-factory`'s foundation and intake: the world, the state store, the intake rules, `issue-check`, `cell-register`, `lane-status`, `dial-get`/`dial-set` and job 14 (#1183); the queue, events and records: `lane-enqueue`, `lane-wait`, `event-resolve`, `lane-pause`/`lane-resume`, the record log, `cell-attach`, `lane-drop`, `plan-list`, `gate-allow`, and jobs 03 to 09 (#1185); the lane loop: validation, exact-head push, serial merge, Windows and macOS process control, host probing and selection (`lane-host-probe`, `lane-host-list`, `lane-host-set`) and `lane-report` (#1295); review evidence and `prepare-pr`'s lane mode (#1305); the `factory` and `factory-cell` command lines and `run-fleet` (#1310). Remaining as the proposal lists it: the webhook wake and experience review, then one AFD fleet run on the workstation with its numbers reported |
| 2. Concurrency | Not started | After Phase 1's measured run |
| 3. Cells on other machines | Not started | After Phase 2 |
| 4. Lushly moves on | Not started | A Lushly adapter at parity with Lushly's `scripts/merge-lane.mjs` |
| 5. The improvement loop | Not started | First in Lushly's lane; in the plugin once AFD's lane has a week of runs after Phase 2 |

The plugin lives in `endpoints/botcore/plugins/botcore-factory/`, and its jobs run from this
folder's [`scenarios/`](scenarios/) through AFD's scenario runner, in the `botcore-factory`
workflow.
