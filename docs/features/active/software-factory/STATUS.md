# Software Factory: status

Read this before the [proposal](software-factory.proposal.md). It moved from `proposed/` to
`active/` on 2026-11-14, because Phase 1's implementation had started on `main`. Reconciled that
day against `main` at `ee1b5827`, from merged history; this reconciliation did not rerun the
plugin's tests.

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
git-ignored) from the cell's worktree; `prepare-pr lane` now passes a title and body. PR: this
branch, `lush/factory-run-fleet`.

Review (Opus 5.5; it reported low effort though high was asked) found four blockers, fixed: the
foreman could hang at the finish (an open `queue-empty` is not repeated and the wait had no
timeout), a fresh foreman ignored events its predecessor had read (`openEvents`), enqueue stored
`.` as the worktree and passed no title or body, and JSON arguments break under Windows
PowerShell. Recorded, not fixed here: a cell runs its own branch's copy of the plugin and
adapter, and the lane does not re-verify the review, so a branch that edits them could skip the
review check (Lushly's lane has the same shape); and the plugin's host lock cannot see Lushly's
script lane on a shared host. Follow-ups:
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
| 1. The plugin, one slot | In progress | Botcore's host changes, plugin policies, input schemas in the catalog and named refusals (#1181); `botcore-factory`'s foundation and intake: the world, the state store, the intake rules, `issue-check`, `cell-register`, `lane-status`, `dial-get`/`dial-set` and job 14 (#1183); the queue, events and records: `lane-enqueue`, `lane-wait`, `event-resolve`, `lane-pause`/`lane-resume`, the record log, `cell-attach`, `lane-drop`, `plan-list`, `gate-allow`, and jobs 03 to 09 (#1185); the lane loop: validation, exact-head push, serial merge, Windows and macOS process control, host probing and selection (`lane-host-probe`, `lane-host-list`, `lane-host-set`) and `lane-report` (#1295); review evidence and `prepare-pr`'s lane mode (#1305); the `factory` and `factory-cell` command lines and `run-fleet` (this branch). Remaining as the proposal lists it: the webhook wake and experience review, then one AFD fleet run on the workstation with its numbers reported |
| 2. Concurrency | Not started | After Phase 1's measured run |
| 3. Cells on other machines | Not started | After Phase 2 |
| 4. Lushly moves on | Not started | A Lushly adapter at parity with Lushly's `scripts/merge-lane.mjs` |
| 5. The improvement loop | Not started | First in Lushly's lane; in the plugin once AFD's lane has a week of runs after Phase 2 |

The plugin lives in `endpoints/botcore/plugins/botcore-factory/`, and its jobs run from this
folder's [`scenarios/`](scenarios/) through AFD's scenario runner, in the `botcore-factory`
workflow.
