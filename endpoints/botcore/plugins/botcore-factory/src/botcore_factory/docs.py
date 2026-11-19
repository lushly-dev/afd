"""The ``factory`` docs topic: inputs, results, refusals and the order of calls."""

DOCS = """\
# Software factory

Cells implement, one lane validates and merges, a stateless foreman starts cells and reacts to
events. The foreman's memory is `lane_status`. Two hosts serve the commands: `factory` (every
command; the foreman and the owner) and `factory-cell` (what a cell calls). Names are AFD's
kebab-case as snake_case functions; inputs are snake_case. Every list takes `limit` (1-500,
default 100) and `cursor` (the `nextCursor` of the previous page); `total` counts each list.
From a shell, `factory` and `factory-cell` are the two hosts' command lines for the checkout
they run in: `factory call lane-status`, `factory-cell call lane-enqueue '{"worktree": "."}'`,
and `catalog` for the inputs. They have no time limit, and exit 1 on a refusal.

## Order of calls (foreman)

One foreman per lane. Pass your own `session` (your T3 Code thread id) to `cell_register`,
`lane_wait(consumer="foreman")` and `dial_set`: the first takes the lane's lease and each renews
it for `foreman.leaseMinutes` (waiting renews it too). Another session is refused
`FOREMAN_BUSY` (naming the holder and when its lease runs out): stop, and leave the lane to it.

1. `lane_status()`: when `canStartCell`, it names the `plan` and `nextIssue`; otherwise `reason`
   (and `nextReset` when every plan is at its ceiling).
2. `cell_register(issues=[nextIssue], branch, route, session)`: claims the issue on GitHub
   (`status:in-progress` plus a claim comment with the lease) and assigns the plan. Call it
   before starting the cell, so a refusal costs nothing; then `cell_attach(branch, thread)`.
3. `lane_wait(consumer="foreman", session)`: the events not yet given to you, each with a compact
   `status`. Answer each one; reading resolves nothing.
4. `issue_check()` when triage has run or a claim may have expired.

A cell, done and reviewed, calls `lane_enqueue(worktree)` once and ends its turn.

## Events

`ejected` (`reason`: `conflict`, `entry-invalid`, `final-failed`, `push-failed`, `pr-failed`,
`pr-closed`, `ci-failed` (the required check failed on the pull request's head or, behind a
merge queue, on the commit the queue built for it: `detail` names that commit, and a
`Co-authored-by:` line in the squash the queue wrote when there is one, which GitHub adds for
every commit author who is not the pull request's), `merge-failed` (GitHub
refused the merge, or the pull request left the merge queue unmerged for another reason, which
`detail` gives when GitHub does), `review-unverified`, `node-missing` (the branch's own
`.nvmrc` names a Node the lane host lacks, or an alias, or the branch deletes or blanks
`.nvmrc`; `detail` starts `NODE_MISSING`: keep the base's `.nvmrc`, or the owner installs that
Node on the lane host); with `detail`, `lines`
and `logPath`, and `excused` when it does not count; answered by a re-enqueue or
`lane_drop`), `ejection-limit` (the branch's own failures reached `cells.maxEjections`:
`conflict`, `push-failed`, `pr-failed` and `merge-failed` never count, nor one
`ejection_excuse` excused; answered as `ejected` is, or by the excuse that brings it under the
limit), `lane-error`
(the lane's own trouble: the network, a timeout, a cancelled check, a required check still
running after `lane.checkTimeoutMinutes` with its PR left open, a pull request still in the
merge queue after as long, left there; it paused and ejected nothing;
`lane_resume`), `queue-room` (`cell_register`),
`merged` (`detail` ends `through the merge queue` when it went through one),
`merged-without-check`, `main-broken` (coverage on main failed, `suspects` the PRs
since the last green run; or, with `reason` `unchecked-merge`, a check on main's merge commit
failed after a merge that advanced past a moved base without a new validation, `suspects` the
PRs merged so; the lane paused), `queue-empty` (a drained move happens here) and
`lane-stopped` (the lane process is gone; `lane_start`). Any open event can be answered with
`event_resolve(id, note)`. `openEvents` in `lane_status` lists what is open.

## The lane

`lane_host_probe()` on each machine publishes its readiness; `lane_host_list()` reads them;
`lane_host_set(id)` chooses the host. On the host, `lane_start()` starts the lane detached. It
queues held branches when there is room, validates in `lane.slots` slots (reserved until pushed;
`slots.busy` includes those waiting to push, except that a validated branch behind the front
gives its slot to a front branch that needs one and keeps its validation, its checkout moved
aside to `kept-<branch>-<hash>` with its record, a `slot-released` record; each merges the
base branch's origin head in, then runs the adapter's `install`, bounded by a timeout, and
`validate` in the background), merges serially in queue order (the base is read again before
the push and just before the merge; when it moved, the branch advances to it without a new
validation, a `base-advanced` record, only if main's changes touch no `shared_paths` or
`gate_paths`, merge cleanly with the validated head, and share no unit with the branch's, as the
adapter's `units` command names them, run in a clean `units` slot checked out at the new
base; otherwise it is validated again, `rerun` `main-moved`;
after `lane.maxBaseReruns` of those, a move that merges cleanly and touches no
`revalidate_paths` (`gate_paths` when unset) advances it anyway, a `base-advanced` record with
`reason` `rerun-limit`, and the PR's
`required_check`, run on the pull request's merge ref, stands in; a move after the push merges
on that check of the older main, `checkBase` in the record), pushes the validated commit
(with a lease on its own last push), opens the PR, waits for `required_check` on that commit and
squash-merges bound to it. Where the base takes merges only through a merge queue (GitHub says
so on the pull request; the lane reads that, never a setting), the lane adds the pull request to
the queue bound to the same head (`enqueuePullRequest`) and reads what GitHub did: the entry
waits at the front in state `merge-queued` (its `mergeQueue` holds GitHub's `state`, `position`
and the commit the queue built, `groupHead`), nothing behind it is pushed or merged, and the
base is not followed: GitHub locks a queued pull request's branch, and its queue runs the
required check on exactly what lands. It lands when GitHub says `MERGED`. Out of the queue
and still open, it is read again and ejected a minute after the first such read (three when
GitHub never showed it queued); while GitHub's reason for the removal is `merged`, which it logs
a second before the pull request reads as merged, it is never ejected, and still open five
minutes on it is a `lane-error`. Past `lane.checkTimeoutMinutes` in the queue the lane pauses
with a `lane-error` and leaves it there. A stopped lane picks the wait up where it was; one
that finds its pull request queued at a head it did not validate pauses, and a pull request
that merged at another head lands with `headMoved` and a `merged-without-check` event. Two
limits: a lane killed between its request and the record of it asks once more for the same
head if the queue has let that head go meanwhile (queued, merged or about to read as merged,
it is taken up instead), and `lane_host_set(recover)` rebuilds every queue ref as `queued`, so
a pull request in GitHub's queue is validated again and its push refused by the branch lock,
and one the queue already merged is never recorded as landed: recover a host only once
GitHub's queue holds none of the lane's pull requests. The queue writes the
squash message itself: in the trials a pull request of one commit kept that commit's message,
and any other (every branch the lane merged the base into) gets the pull request's title,
so `lane_enqueue`'s `title`, as its subject and each commit's message below. It adds
`Co-authored-by:` for every commit author who is not the pull request's, so the lane authors
its merges of the base as the branch's own author (its newest own commit's), whatever the
host's git identity is.
Coverage runs on the base every `lane.coverageEvery` merges and at
once after a merge touching `gate_paths`, which the front of the queue waits for. After a merge
that advanced without a new validation (either way) the lane watches the check runs and
workflow runs (`workflow: <name>`) `main_checks` selects on its merge commit; one failing is
`main-broken`, and checks still unfinished after `lane.checkTimeoutMinutes` are one `lane-error`,
the watch dropped.
The lane never edits code, and nothing is killed unless its pid and start time both match.

## Commands

- `issue_check(numbers?, limit?, cursor?)` -> `untriaged[]`, `violations[] {number, rule}`,
  `dispatchable[]` (priority:0, priority:1, then the rest, oldest first), `related[]` (empty
  until related issues are computed), `staleClaims[] {number, branch, machine, leaseUntil}`
  (expired leases, or a claim label with no claim comment), `held[] {number, reasons}`.
  Refuses `READ_FAILED`: a failed GitHub read is never an empty answer.
- `cell_register(issues, branch, route, thread?, session?, related_because?)` -> `cell {branch,
  issues, route, thread, plan, state, ejections, registeredAt, leaseUntil, machine,
  relatedBecause?}`. More than one issue is a package the foreman names: up to
  `cells.issuesMax` dispatchable issues that share files, with `related_because` saying what
  they share; one PR then replaces cells that would conflict in the queue. Refusals, checked in this
  order: `VALIDATION_ERROR` for an empty `session`, `FOREMAN_BUSY` (another session holds the
  lane; the lease is taken before the checks below), `VALIDATION_ERROR`,
  `TOO_MANY_ISSUES` (over `cells.issuesMax`, or a package without `related_because`),
  `ALREADY_EXISTS` (the branch has a cell), `ALREADY_CLAIMED` (names the holding branch),
  `NOT_DISPATCHABLE` (triage has not planned it, or a rule holds it), `CELLS_FULL`
  (`cells.max`), `PLAN_ABOVE_CEILING` (every plan a cell may take at or above `plans.ceiling`;
  names the next reset), `NO_CLAUDE_PLAN` (no Claude plan while `cells.claudeOnly` is on),
  `PLANS_UNREADABLE`, `HOST_LOADED` (free memory below `host.minFreeGb`),
  `WRITE_FAILED` (a claim write failed; the claims it wrote are put back, and it names any it
  could not). A refusal writes nothing.
- `lane_status(limit?, cursor?)` -> `runId`, `host {id, isLaneHost, laneHost}`, `running`,
  `paused`, `pauseReason`, `draining`, `slots {total, busy}`, `queue[]`, `held[]`,
  `cells[] {branch, issue, issues, relatedBecause?, state, plan, route, ejections, excused,
  countedEjections, lastEjection}`, `openEvents[]`,
  (a `queue[]` entry's `state` is `queued`, `validating`, `validated`, `merging`, its pull
  request open and its check awaited, or `merge-queued`, in GitHub's merge queue, with
  `mergeQueue {since, queuedAt, state, position, groupHead}` and the lane's own notes:
  `queue` and `seen` (GitHub showed a queue, and this entry in it), `removedBefore` (the
  last removal before the request) and `leftAt` (when it was first read out of the queue)),
  `waitingOnOwner`, `dials`, `canStartCell` with `plan` (with its `pace`) and `nextIssue`, or
  `reason`. `slots.busy` leaves out a validated branch that gave its slot up.
- `lane_enqueue(worktree, title?, body_file?)` -> `state` (`queued` or `held`), `position`,
  `head`, `attempt`, `prequeue {stages[]}`, `answered[]`, `holdReason` when held. A repaired
  (ejected) branch goes to the front; a full queue (`lane.queueMax`) holds the branch. The head
  is pushed to `refs/factory/queue/<branch>` on origin. Refusals, in this order: `NOT_FOUND` (no
  worktree), `IGNORED_BRANCH` (`ignore_branches`), `BODY_FILE_OUTSIDE` (`body_file` must be a
  relative path inside the worktree), `NOT_FOUND` (no cell for its branch), `NOT_LANE_HOST`,
  `DIRTY_WORKTREE` (names the files), `NOT_CONFIGURED` (no `review_evidence`), `REVIEW_MISSING`
  (no review recorded for the exact head; advisory, since it runs the branch's own verifier: the
  lane checks again with the base's before each validation and ejects as `review-unverified`),
  `GATE_EDIT_IN_REPAIR` (a repair after a failing check edits `gate_paths`; names them; only the
  branch's own changes count, against a base the lane fetches, so main's gate changes a rebase or
  merge brings in do not),
  `GATE_CHECK_FAILED` (those edits could not be read; the repair waits), `PREQUEUE_FAILED`
  (names the stage, with its first lines), `MERGE_QUEUED` (the branch's pull request is in
  GitHub's merge queue, which locks the branch), `HEAD_MOVED` (the worktree changed while the checks
  ran; they run outside the state lock), `WRITE_FAILED`. A refusal writes nothing.
- `lane_wait(consumer, timeout_ms?, session?)` -> `events[] {id, type, branch?, reason?,
  detail?, logPath?, status}` or `{events: [], timedOut: true}`. No limit without `timeout_ms`;
  over MCP pass at most 300000. As `foreman`, refuses `FOREMAN_BUSY` while another session holds
  the lane; with `session` it takes the lease, and keeps it while waiting when `timeout_ms` is
  given.
- `foreman_handoff(session)` -> `released` (the lease, or null when none was held): frees the
  lane for another foreman; the owner's call when a session has ended. It names the holder's
  session, or any once the lease ran out; otherwise `NOT_FOREMAN`.
- `event_resolve(id, note)` -> `resolved`. Refuses `NOT_FOUND`.
- `lane_pause(reason?)`, `lane_resume(reason?)` -> `paused`; resuming answers `lane-error`.
- `cell_attach(branch, thread)` -> `cell`. Refuses `NOT_FOUND`.
- `gate_allow(branch, reason)` -> `allowed`: a diagnosis found the gate edit to be the right
  repair. Refuses `NOT_FOUND`.
- `lane_drop(branch, reason)` -> `dropped`, `released[]`: dequeues the branch, puts each issue
  back to `status:planned` with one comment and forgets the cell. Refuses `NOT_FOUND` and
  `MERGE_QUEUED` (the branch is in GitHub's merge queue, where it would merge after the lane
  forgot it: wait, or remove it from the queue on GitHub, `lane_resume` a paused lane and
  wait for its `ejected` event first).
- `plan_list()` -> `plans[] {id, provider, used, elapsed, room, left, pace, daysToReset,
  aboveCeiling, resetsAt}`, every weekly window but Claude's Fable window, which only Fable
  draws on; `ceiling`; `next` (the plan `cell_register` assigns: among Claude's plans while
  `cells.claudeOnly` is on, since cells implement on Opus, the highest `pace`, `left`, the room
  below `plans.ceiling`, over the days to its reset, so each plan is spent by its own reset;
  null when no plan can take a cell). Refuses `PLANS_UNREADABLE`.
- `ejection_excuse(branch, reason, session?)` -> `branch`, `attempt`, `cause`, `ejections`,
  `excused`, `counted`, `limit`, `answered[]`: the cell's latest ejection was not its branch's
  fault (a known flake), so it stops counting toward `cells.maxEjections`; under the limit again,
  it answers the open `ejection-limit`. Refuses `VALIDATION_ERROR`, `FOREMAN_BUSY`, `NOT_FOUND`
  (no cell, or no ejection) and `ALREADY_EXCUSED`.
- `lane_start()` -> `running`, `runId`, `pid`. Refuses `HOST_NOT_SET`, `NOT_LANE_HOST`,
  `LANE_LOCKED` (one lane per machine), `REQUIRED_CHECK_MISSING`, `NODE_MISSING` (the Node
  `.nvmrc` names is not installed under fnm, nvm or nvm-windows; validation and coverage run
  on it), `NODE_UNPINNED` (`.nvmrc` holds an alias such as `lts/*`, not a version number),
  `TOOLCHAIN_MISMATCH` (`packageManager` exactly, `engines.node` at least, read on the
  `.nvmrc` Node with its bin directory first on `PATH`, as validation runs them). Once
  running, a branch whose own `.nvmrc` names a Node the host lacks, or that deletes or blanks
  `.nvmrc`, is ejected as `node-missing`; main's own pauses the lane.
- `lane_stop(force?)` -> `running`; a running validation finishes first unless `force` (then it
  goes back to the front of the queue): `{running: true, stopping: true, finishing[]}`. Stops
  only this repository's lane, and refuses `LANE_LOCKED` when the lock's process cannot be
  confirmed by its start time.
- `lane_run(steps?)` -> the loop in the foreground, for debugging the lane itself. Refuses as
  `lane_start` does.
- `lane_host_probe()` -> `record {id, name, cores, memoryGb, freeDiskGb, missing[], measured,
  suggestedSlots, probedAt}`, published to `refs/factory/hosts/<id>` on origin.
- `lane_host_list()` -> `machines[]` (the records, with `reachable`: probed in the last 24
  hours, and `ready`: reachable and missing nothing).
- `lane_host_set(id, drain?, recover?)` -> `host`, `previous`; with `drain`, `draining` and
  `moveTo`; with `recover`, `rebuilt {queue, claims}` from origin's queue refs and GitHub's
  claims (a person confirms recovery). Refuses `NOT_FOUND`, `HOST_NOT_READY`, `LANE_BUSY`.
- `lane_report(run?, compare?)` -> `run`, `mergedPerHour`, `validationsPerMerge`,
  `productiveShare`, `staleRuns`, `reruns`, `baseAdvances`, `rerunLimitAdvances` (those whose
  required check stood in), `ejections`, `excusedEjections` (by cause or `ejection_excuse`),
  `foreman {wakes, wakesPerMerge}`, `byPlan[]`,
  `byRoute[]`, `prs[]`, `experiences[]`, `digest`; with `compare`, `delta`. Refuses `NOT_FOUND`.
- `dial_get(key?)` -> `key`, `value`, `default`, or `dials[]`. Refuses `NOT_FOUND`.
- `dial_set(key, value, session?)` -> `key`, `value`, `previous`, `default`. A foreman names
  its `session` (the owner, setting a dial by hand, names none). Refuses `FOREMAN_BUSY`,
  `NOT_FOUND`,
  `DIAL_OUT_OF_RANGE` (`lane.slots` up to the lane host's `suggestedSlots`) and
  `CONFIRMATION_REQUIRED` for the owner's `review.*` dials.

## Dials

`lane.slots` 1, `cells.max` 3, `cells.issuesMax` 1, `host.minFreeGb` 8, `lane.queueTarget` 2,
`lane.queueMax` 10, `plans.ceiling` 85, `fable.ceiling` 50, `cells.claudeOnly` true,
`lane.coverageEvery` 5, `lane.checkTimeoutMinutes` 90 (the required check on a pull request,
and then the wait in a merge queue), `lane.maxBaseReruns` 2 (100 all but
turns the guard off), `claims.leaseHours` 24, `foreman.leaseMinutes` 30, `cells.maxEjections` 3,
`experience.hold` false, `lane.autostart` true, `logs.keepDays` 30, and the owner's
`review.*` dials.

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
`{ name, run }`), `review_evidence` (`{head}` stands for the head being enqueued, `{worktree}`
for the cell's worktree, which the lane's own run needs: it runs from a clean `review` slot at the
base, so a change to the verifier binds only once it is on the base and the lane restarts; it
exits 0 to accept and 3 to refuse, and any other exit is the lane's trouble),
`gate_paths`, `regenerate` (`[[plugins.factory.regenerate]]`: `name`, `paths` globs and
`run`; when a merge of the base conflicts only in those paths, the lane runs `run` in the slot
while the merge is open, and it writes and stages them, then the lane commits the merge; a `run`
that exits non-zero ejects as `conflict`, one that cannot run is the lane's trouble), and the
lane's later keys: `validate`, `coverage`, `install`,
`required_check`, `base_branch` (default `main`), `units` (an argument list the lane runs with
changed paths appended; it prints a JSON list of unit names, `"*"` for all), `shared_paths` (globs
every unit reads), `revalidate_paths` (lockfiles, dependency manifests and toolchain pins main
may not change for the required check to stand in past `lane.maxBaseReruns`; unset,
`gate_paths`), `main_checks` (check-run names on main, globs, `!` excludes; empty: all),
`receipt`, `ui_paths`, `screens`, `preview`,
`ignore_branches`, `measure_paths`, `trend_issue`. Commands are argument lists, never shell strings.
"""
