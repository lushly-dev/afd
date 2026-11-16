# Software Factory: status

Read this before the [proposal](software-factory.proposal.md). It moved from `proposed/` to
`active/` on 2026-11-14, because Phase 1's implementation had started on `main`. Reconciled that
day against `main` at `ee1b5827`, from merged history; this reconciliation did not rerun the
plugin's tests.

## Lane-loop worktree checkpoint, 2026-11-15

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
| 1. The plugin, one slot | In progress | Botcore's host changes, plugin policies, input schemas in the catalog and named refusals (#1181); `botcore-factory`'s foundation and intake: the world, the state store, the intake rules, `issue-check`, `cell-register`, `lane-status`, `dial-get`/`dial-set` and job 14 (#1183); the queue, events and records: `lane-enqueue`, `lane-wait`, `event-resolve`, `lane-pause`/`lane-resume`, the record log, `cell-attach`, `lane-drop`, `plan-list`, `gate-allow`, and jobs 03 to 09 (#1185). Remaining as the proposal lists it: host probing and selection, the webhook wake, Windows and macOS process control, experience review, `prepare-pr`'s lane mode and `run-fleet`, then one AFD fleet run on the workstation with its numbers reported |
| 2. Concurrency | Not started | After Phase 1's measured run |
| 3. Cells on other machines | Not started | After Phase 2 |
| 4. Lushly moves on | Not started | A Lushly adapter at parity with Lushly's `scripts/merge-lane.mjs` |
| 5. The improvement loop | Not started | First in Lushly's lane; in the plugin once AFD's lane has a week of runs after Phase 2 |

The plugin lives in `endpoints/botcore/plugins/botcore-factory/`, and its jobs run from this
folder's [`scenarios/`](scenarios/) through AFD's scenario runner, in the `botcore-factory`
workflow.
