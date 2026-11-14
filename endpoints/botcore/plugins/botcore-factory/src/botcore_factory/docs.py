"""The ``factory`` docs topic: inputs, results, refusals and the order of calls."""

DOCS = """\
# Software factory

Cells implement, one lane validates and merges, a stateless foreman starts cells and reacts to
events. The foreman's memory is `lane_status`. Two hosts serve the commands: `factory` (every
command; the foreman and the owner) and `factory-cell` (what a cell calls). Names are AFD's
kebab-case as snake_case functions; inputs are snake_case. Every list takes `limit` (1-500,
default 100) and `cursor` (the `nextCursor` of the previous page); `total` counts each list.

## Order of calls (foreman)

1. `lane_status()`: when `canStartCell`, it names the `plan` and `nextIssue`; otherwise `reason`
   (and `nextReset` when every plan is at its ceiling).
2. `cell_register(issues=[nextIssue], branch, route)`: claims the issue on GitHub
   (`status:in-progress` plus a claim comment with the lease) and assigns the plan. Call it
   before starting the cell, so a refusal costs nothing; then `cell_attach(branch, thread)`.
3. `lane_wait(consumer="foreman")`: the events not yet given to you, each with a compact
   `status`. Answer each one; reading resolves nothing.
4. `issue_check()` when triage has run or a claim may have expired.

A cell, done and reviewed, calls `lane_enqueue(worktree)` once and ends its turn.

## Events

`ejected` (answered by a re-enqueue or `lane_drop`), `ejection-limit` (the same), `lane-error`
(`lane_resume`), `queue-room` (`cell_register`), and the lane loop's others. Any open event can
be answered with `event_resolve(id, note)`. `openEvents` in `lane_status` lists what is open.

## Commands

- `issue_check(numbers?, limit?, cursor?)` -> `untriaged[]`, `violations[] {number, rule}`,
  `dispatchable[]` (priority:0, priority:1, then the rest, oldest first), `related[]` (empty
  until related issues are computed), `staleClaims[] {number, branch, machine, leaseUntil}`
  (expired leases, or a claim label with no claim comment), `held[] {number, reasons}`.
  Refuses `READ_FAILED`: a failed GitHub read is never an empty answer.
- `cell_register(issues, branch, route, thread?)` -> `cell {branch, issues, route, thread,
  plan, state, ejections, registeredAt, leaseUntil, machine}`. Refusals, checked in this order:
  `VALIDATION_ERROR`, `TOO_MANY_ISSUES` (over `cells.issuesMax`, or unrelated issues),
  `ALREADY_EXISTS` (the branch has a cell), `ALREADY_CLAIMED` (names the holding branch),
  `NOT_DISPATCHABLE` (triage has not planned it, or a rule holds it), `CELLS_FULL`
  (`cells.max`), `PLAN_ABOVE_CEILING` (every plan at or above `plans.ceiling`; names the next
  reset), `PLANS_UNREADABLE`, `HOST_LOADED` (free memory below `host.minFreeGb`),
  `WRITE_FAILED`. A refusal writes nothing.
- `lane_status(limit?, cursor?)` -> `runId`, `host {id, isLaneHost, laneHost}`, `running`,
  `paused`, `pauseReason`, `draining`, `slots {total, busy}`, `queue[]`, `held[]`,
  `cells[] {branch, issue, issues, state, plan, route, ejections}`, `openEvents[]`,
  `waitingOnOwner`, `dials`, `canStartCell` with `plan` and `nextIssue`, or `reason`.
- `lane_enqueue(worktree, title?, body_file?)` -> `state` (`queued` or `held`), `position`,
  `head`, `attempt`, `prequeue {stages[]}`, `answered[]`, `holdReason` when held. A repaired
  (ejected) branch goes to the front; a full queue (`lane.queueMax`) holds the branch. The head
  is pushed to `refs/factory/queue/<branch>` on origin. Refusals, in this order: `NOT_FOUND` (no
  worktree, or no cell for its branch), `NOT_LANE_HOST`, `DIRTY_WORKTREE` (names the files),
  `NOT_CONFIGURED` (no `review_evidence`), `REVIEW_MISSING` (no review recorded for the exact
  head), `GATE_EDIT_IN_REPAIR` (a repair after a failing check edits `gate_paths`; names
  them), `PREQUEUE_FAILED` (names the stage, with its first lines), `WRITE_FAILED`. A refusal
  writes nothing.
- `lane_wait(consumer, timeout_ms?)` -> `events[] {id, type, branch?, reason?, detail?,
  logPath?, status}` or `{events: [], timedOut: true}`. No limit without `timeout_ms`; over MCP
  pass at most 300000.
- `event_resolve(id, note)` -> `resolved`. Refuses `NOT_FOUND`.
- `lane_pause(reason?)`, `lane_resume(reason?)` -> `paused`; resuming answers `lane-error`.
- `cell_attach(branch, thread)` -> `cell`. Refuses `NOT_FOUND`.
- `gate_allow(branch, reason)` -> `allowed`: a diagnosis found the gate edit to be the right
  repair. Refuses `NOT_FOUND`.
- `lane_drop(branch, reason)` -> `dropped`, `released[]`: dequeues the branch, puts each issue
  back to `status:planned` with one comment and forgets the cell. Refuses `NOT_FOUND`.
- `plan_list()` -> `plans[] {id, provider, used, elapsed, room, aboveCeiling, resetsAt}`.
  Refuses `PLANS_UNREADABLE`.
- `dial_get(key?)` -> `key`, `value`, `default`, or `dials[]`. Refuses `NOT_FOUND`.
- `dial_set(key, value)` -> `key`, `value`, `previous`, `default`. Refuses `NOT_FOUND`,
  `DIAL_OUT_OF_RANGE` (`lane.slots` up to the lane host's `suggestedSlots`) and
  `CONFIRMATION_REQUIRED` for the owner's `review.*` dials.

## Dials

`lane.slots` 1, `cells.max` 3, `cells.issuesMax` 1, `host.minFreeGb` 8, `lane.queueTarget` 2,
`lane.queueMax` 10, `plans.ceiling` 85, `fable.ceiling` 50, `lane.coverageEvery` 5,
`claims.leaseHours` 24, `cells.maxEjections` 3, `experience.hold` false, `lane.autostart`
true, `logs.keepDays` 30, and the owner's `review.*` dials.

## State and claims

Claims live on GitHub. The lane's own state (cells, queue, events, dials) is in the per-user
data directory, keyed by repository (`BOTCORE_FACTORY_DATA_DIR` overrides the base), behind
one lock and written atomically; every change is appended to `log.jsonl`. The measurement
records (`records.jsonl`, append-only) hold the facts the report and the improvement loop
compute from: cell registered, enqueued (queued or held), and, from the lane loop, validated,
ejected and merged, each with its attempt, plan, route and execution profile.

## Adapter

`[plugins.factory]` in `botcore.toml` (`[tool.botcore.plugins.factory]` in `pyproject.toml`):
`labels` (the label definitions intake reads), `prequeue` (named stages:
`{ name, run }`), `review_evidence` (`{head}` stands for the head being enqueued),
`gate_paths`, and the lane's later keys: `validate`, `coverage`, `install`,
`required_check`, `receipt`, `ui_paths`, `screens`, `preview`, `ignore_branches`,
`measure_paths`, `trend_issue`. Commands are argument lists, never shell strings.
"""
