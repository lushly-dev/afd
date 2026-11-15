# Software Factory: status

Read this before the [proposal](software-factory.proposal.md). It moved from `proposed/` to
`active/` on 2026-11-14, because Phase 1's implementation had started on `main`. Reconciled that
day against `main` at `ee1b5827`, from merged history; this reconciliation did not rerun the
plugin's tests.

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
