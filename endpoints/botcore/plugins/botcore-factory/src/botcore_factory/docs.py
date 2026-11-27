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
`lane_wait(consumer="foreman")`, `dial_set`, `ejection_excuse`, `gate_allow` and `lane_drop`:
the first takes the lane's lease and each renews it for `foreman.leaseMinutes` (waiting renews
it too). Each checks the session again inside the change it makes, and a wait checks it again
before it is given events, so a session that lost the lane meanwhile changes nothing and its
open wait leaves the events to its successor. Another session is refused
`FOREMAN_BUSY` (naming the holder and when its lease runs out): stop, and leave the lane to it.
A session another one took the lane from (after its lease ran out, or a `foreman_handoff`) is
superseded: its foreman commands are refused `FOREMAN_STALE` (naming the newer session and
when), since its brief may be out of date. Stop and report; a foreman that should run again
starts in a new session. A session whose lease was handed over or ran out between the check
and the change (a wait without `timeout_ms` keeps no lease) is refused `FOREMAN_LOST` and changes
nothing: read `lane_status`, then call again if no other session holds the lane.
`gate_allow` and `ejection_excuse` are the live foreman's alone: they never take the lane, and a
call that names no session, another session's, or comes while no session holds the lane, is
refused `FOREMAN_REQUIRED`, which names neither the holder nor a way to take the lane. A cell's
`lane_status` shows whether a foreman holds the lane (`foreman.held`) and until when, not its
session. The session is not a secret from `factory call`: this keeps these records from a cell
that follows the factory's answers, not from one set on taking them, and `measure_approve`
checks no session at all. An owner who takes the lane (`lane_wait` with their own session) while
no lease is live supersedes the last foreman, whose next call is `FOREMAN_STALE`; while that
foreman still runs, pass its session (from the factory host's `lane_status`) instead.

1. `lane_status()`: when `canStartCell`, it names the `plan` and `nextIssue`; otherwise `reason`
   (and `nextReset` when every plan is at its ceiling). Pass any `diskWarnings` (too many idle
   worktrees, Cargo output nothing removes) on to the owner before starting cells; they never
   stop one.
2. `cell_register(issues=[nextIssue], branch, route, session)`: claims the issue on GitHub
   (`status:in-progress` plus a claim comment with the lease) and assigns the plan. Call it
   before starting the cell, so a refusal costs nothing; then `cell_attach(branch, thread)`.
3. `lane_wait(consumer="foreman", session)`: open events not yet given to you, each with a
   compact `status`. Answer each one; reading resolves nothing.
4. `issue_check()` when triage has run or a claim may have expired.

A cell, done and reviewed, calls `lane_enqueue(worktree)` once and ends its turn.

## Events

`ejected` (`reason`: `conflict`, `entry-invalid`, `final-failed`, `push-failed`, `pr-failed`,
`pr-closed`, `ci-failed` (the required check failed on the pull request's head or, behind a
merge queue, on the commit the queue built for it: `detail` names that commit, and a
`Co-authored-by:` line that commit carries when there is one: the branch's own under a queue
that rebases, or one a squashing queue adds for every commit author who is not the pull
request's), `merge-failed` (GitHub
refused the merge, or the pull request left the merge queue unmerged for another reason, which
`detail` gives when GitHub does), `review-unverified`, `node-missing` (the branch's own
`.nvmrc` names a Node the lane host lacks, or an alias, or the branch deletes or blanks
`.nvmrc`; `detail` starts `NODE_MISSING`: keep the base's `.nvmrc`, or the owner installs that
Node on the lane host); with `detail`, `lines`
and `logPath`, and `excused` when it does not count; answered by a re-enqueue or
`lane_drop`), `ejection-limit` (the branch's own failures reached `cells.maxEjections`, so the
cell waits on the owner and frees its seat, with a `queue-room` when that opens one:
`conflict`, `push-failed`, `pr-failed` and `merge-failed` never count, nor one
`ejection_excuse` excused; answered as `ejected` is, or by the excuse that brings it under the
limit), `lane-error`
(the lane's own trouble: the network, a timeout, a cancelled check, a required check still
running after `lane.checkTimeoutMinutes` with its PR left open, a pull request still in the
merge queue after as long, left there; free disk at the lane's slots below
`host.minFreeDiskGb` before a validation starts (the paused lane merges nothing either, and
pauses again on resuming while the disk is still short), or a validation or coverage run that
failed on a full disk (`ENOSPC`, "No space left on device", read from the whole log, never
from a test's own row or name): the validation runs again on resuming (`rerun` `disk-full`)
and counts no ejection, once per attempt, and coverage stays owed; it paused and ejected nothing;
`lane_resume`), `queue-room` (`cell_register`),
`merged` (`detail` ends `through the merge queue` when it went through one),
`merged-without-check`, `main-broken` (coverage on main failed, `suspects` the PRs
since the last green run; or, with `reason` `unchecked-merge`, a check on main's merge commit
failed after a merge that advanced past a moved base without a new validation, `suspects` the
PRs merged so; the lane paused), `queue-empty` (a drained move happens here) and
`lane-stopped` (the lane process is gone; `lane_start`) and `gate-change-held` (an
`area:factory` or improvement branch stopped checking something, or a repair after a failing
check edits `gate_paths` by the lane's own check, held for the owner with `holdReason`
`gate-change`; answered by `measure_approve`, `lane_enqueue` once clean,
`lane_drop`, or `event_resolve`). Any open event can be answered with `event_resolve(id, note)`.
`openEvents` in `lane_status` lists what is open.

## The lane

`lane_host_probe()` on each machine publishes its readiness; `lane_host_list()` reads them;
`lane_host_set(id)` chooses the host. On the host, `lane_start()` starts the lane detached. It
queues held branches when there is room, validates in `lane.slots` slots (reserved until pushed;
`slots.busy` includes those waiting to push, except that a validated branch behind the front
gives its slot to a front branch that needs one and keeps its validation, its checkout moved
aside to `kept-<branch>-<hash>` with its record, a `slot-released` record; each merges the
base branch's origin head in, folds the result into one commit on that head with the same tree,
authored (with the newest one's author date) and committed as the branch's own commits were,
their messages folded with no `Co-authored-by:` line and with a `Factory-session:` trailer for
each thread `cell_register` or `cell_attach` recorded (none for a cell registered before they
were kept), which botcore's `skill_usage_triggers` judges the change by where a queue that
rebases lands the commit as written (lushly-dev/afd#1887) (a rebase merge lands each of a branch's
own commits and drops its merges, lushly-dev/afd#1809; a branch with no commit of its own, whose
own commits have more than one author address, or whose message folds to nothing is ejected as
`entry-invalid` with a `detail` starting `FOLD_REFUSED`), and validates that commit: it runs the
adapter's `install`, bounded by a timeout, and `validate` in the background, with
`CARGO_TARGET_DIR` at the slot's own build directory,
`<host.buildDir>/<slots directory's name>-build/<slot>` or `.build/<slot>` in the slots'
directory, over any `CARGO_TARGET_DIR` the lane host sets, removed along with any configured
`slot_clean_paths` inside the slot checkout when the slot takes another
branch, is parked, the dial moves, the slot is free and its branch has left the queue, or a
coverage run starts or finishes), merges serially in
queue order (the base is read again before the push and just before the merge; when it moved,
the branch advances to it without a new validation, a `base-advanced` record, only if main's
changes touch no `shared_paths` or `gate_paths`, merge cleanly with the validated head, and
share no unit with the branch's, as the adapter's `units` command names them, run in a clean
`units` slot checked out at the new base; otherwise it is validated again, `rerun` `main-moved`;
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
GitHub's queue holds none of the lane's pull requests. The queue merges by its own method:
AFD's rebases (lushly-dev/afd#1809), landing each of the pull request's own commits as it is,
and a squashing queue kept a single commit's message in the trials. The lane's fold makes every
branch it pushes one commit, so the folded message lands either way, authored as the branch's
own author (its newest own commit's), whatever the host's git identity is; the lane's merges of
the base before it are authored so too, since a squashing queue adds `Co-authored-by:` for
every commit author who is not the pull request's.
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
  order: `VALIDATION_ERROR` for an empty `session`, `FOREMAN_STALE` (a newer session took the
  lane from this one), `FOREMAN_BUSY` (another session holds the
  lane; the lease is taken before the checks below), `VALIDATION_ERROR`,
  `TOO_MANY_ISSUES` (over `cells.issuesMax`, or a package without `related_because`),
  `ALREADY_EXISTS` (the branch has a cell), `CELLS_FULL`
  (`cells.max`; a cell holds a seat from registration until it merges, is dropped or parks,
  and an ejected cell keeps it while its foreman repairs it, but not once its own failures
  reach `cells.maxEjections` and it waits on the owner: an excuse that brings it under the
  limit seats it again, even past `cells.max`, which then refuses until enough seats free),
  `PLAN_ABOVE_CEILING` (every plan a cell may take at or above
  `plans.ceiling`; names the next reset), `NO_CLAUDE_PLAN` (no Claude plan while
  `cells.claudeOnly` is on),
  `PLANS_UNREADABLE`, `HOST_LOADED` (free memory below `host.minFreeGb`), `DISK_LOW` (free
  disk where the lane's slots or, with `host.buildDir`, their build output are below
  `host.minFreeDiskGb`; names that directory),
  `DISK_UNREADABLE` (that free disk could not be read; 0 turns the check off),
  `ALREADY_CLAIMED` (names the holding branch), `NOT_DISPATCHABLE` (triage has not planned it,
  or a rule holds it),
  `WRITE_FAILED` (a claim write failed; the claims it wrote are put back, and it names any it
  could not). A refusal writes nothing.
- `lane_status(limit?, cursor?)` -> `runId`, `host {id, isLaneHost, laneHost}`, `running`,
  `paused`, `pauseReason`, `waitingOnHostLock` (deterministic holder or head waiter summary when
  another lane owns or leads the shared host validation lock), `hostLock {version, owner,
  waiters[]}`, `foreman {session, since, until}` (on `factory-cell`, `{held, until}` only),
  `foremanHeld` (whether that lease is live), `draining`, `slots {total, busy}`, `queue[]`,
  `held[]`,
  `cells[] {branch, issue, issues, relatedBecause?, state, plan, route, ejections, excused,
  countedEjections, lastEjection, testChanges?}`, `openEvents[]`,
  (a `queue[]` entry's `state` is `queued`, `validating`, `validated`, `merging`, its pull
  request open and its check awaited, or `merge-queued`, in GitHub's merge queue, with
  `mergeQueue {since, queuedAt, state, position, groupHead}` and the lane's own notes:
  `queue` and `seen` (GitHub showed a queue, and this entry in it), `removedBefore` (the
  last removal before the request) and `leftAt` (when it was first read out of the queue)),
  `waitingOnOwner` (owner-decision issues, parked cells and ejected cells at the limit, and
  events that need the owner), `dials`, `diskWarnings[]` (botcore `disk-status` warnings on
  this machine; empty without disk hygiene), `canStartCell` with `plan` (with its `pace`) and
  `nextIssue`, or `reason`. `slots.busy` leaves out a validated branch that gave its slot up.
- `lane_enqueue(worktree, title?, body_file?)` -> `state` (`queued` or `held`), `position`,
  `head`, `attempt`, `prequeue {stages[]}`, `answered[]`, `holdReason` when held (`queue-full`,
  or `gate-change` with `holdReasons` and `holdDetail` when an `area:factory` branch edits
  `gate_paths` or reports test-change findings), `testChanges` when the adapter configures
  `test_changes`. A repaired
  (ejected) branch goes to the front; a full queue (`lane.queueMax`) holds the branch, and a
  `gate-change` hold stays held for the owner even when queue space opens. The head
  is pushed to `refs/factory/queue/<branch>` on origin. Refusals, in this order: `NOT_FOUND` (no
  worktree), `IGNORED_BRANCH` (`ignore_branches`), `BODY_FILE_OUTSIDE` (`body_file` must be a
  relative path inside the worktree), `NOT_FOUND` (no cell for its branch), `NOT_LANE_HOST`,
  `DIRTY_WORKTREE` (names the files), `NOT_CONFIGURED` (no `review_evidence`), `REVIEW_MISSING`
  (no review recorded for the exact head; advisory, since it runs the branch's own verifier: the
  lane checks again with the base's before each validation and ejects as `review-unverified`),
  `GATE_EDIT_IN_REPAIR` (a repair after a failing check edits `gate_paths`; names them; only the
  branch's own changes count, against a base the lane fetches, so main's gate changes a rebase or
  merge brings in do not; no label exempts it, only the live foreman's `gate_allow` for that
  head, which its details name; the check holds from the cell's latest failing-check ejection
  (`checkFailed`), so a later ejection for another cause does not end it; advisory, since it
  runs the cell's copy: the lane checks again with its own before each validation, before main
  is merged in, and holds such a repair as `gate-change`; a repair enqueued again after that hold
  goes to the back of the queue),
  `GATE_CHECK_FAILED` (those edits could not be read; the repair waits), `PREQUEUE_FAILED`
  (names the stage, with its first lines, and the adapter's `install` command for a new or
  rebased worktree not installed since), `TEST_CHANGES_FAILED` (the adapter's `test_changes`
  command failed or printed invalid JSON), `MERGE_QUEUED` (the branch's pull request is in
  GitHub's merge queue, which locks the branch), `HEAD_MOVED` (the worktree changed while the checks
  ran; they run outside the state lock), `WRITE_FAILED`. A refusal writes nothing.
- `lane_wait(consumer, timeout_ms?, session?)` -> `events[] {id, type, branch?, reason?,
  detail?, logPath?, status}` or `{events: [], timedOut: true}`. No limit without `timeout_ms`;
  over MCP pass at most 300000. As `foreman`, refuses `FOREMAN_STALE` for a superseded session
  and `FOREMAN_BUSY` while another session holds the lane, and `FOREMAN_LOST` when its session
  lost the lease before events were given to it; with `session` it takes the lease,
  and keeps it while waiting when `timeout_ms` is given.
- `foreman_handoff(session)` -> `released` (the lease, or null when none was held): frees the
  lane for another foreman; the owner's call when a session has ended. It names the holder's
  session, or any once the lease ran out; otherwise `NOT_FOREMAN`.
- `event_resolve(id, note)` -> `resolved`. Refuses `NOT_FOUND`.
- `lane_pause(reason?)`, `lane_resume(reason?)` -> `paused`; resuming answers `lane-error`.
- `cell_attach(branch, thread)` -> `cell`, whose `threads` lists every thread attached to it.
  Refuses `NOT_FOUND`.
- `gate_allow(branch, reason, head, session)` -> `allowed`, `branch`, `head`: a diagnosis found
  the gate edit to be the right repair, for that head only (`GATE_EDIT_IN_REPAIR` names it). A
  later commit needs a new `gate_allow`.
  `session` must hold the lane's live lease. Refuses `VALIDATION_ERROR`, `FOREMAN_REQUIRED`,
  `FOREMAN_STALE`, `FOREMAN_LOST` and `NOT_FOUND`.
- `measure_approve(branch, reason)` -> `approved`, `branch`, `head`, `state` (`queued`, or `held`
  with `holdReason` `queue-full` when the queue is full), `answered[]`: releases a branch held for
  `gate-change` or `measure-change` to the queue and approves that exact head (a later commit
  re-triggers the hold). Served on `factory` only, never `factory-cell`. Refuses
  `VALIDATION_ERROR` and `NOT_FOUND`.
- `lane_drop(branch, reason, session?)` -> `dropped`, `released[]`: dequeues the branch, releases
  each issue with one comment and forgets the cell. A released issue goes back to
  `status:planned` unless another branch's live claim still holds it. A foreman names its
  `session`; the owner names none. For a `merging` entry, reads the pull request's merge progress
  on GitHub first so a queued, auto-merge or already-merged pull request is never dropped. Refuses
  `VALIDATION_ERROR`, `FOREMAN_STALE`, `FOREMAN_BUSY`, `FOREMAN_LOST`, `NOT_FOUND`, `READ_FAILED`
  and `MERGE_QUEUED` (the branch is in GitHub's merge queue, has auto-merge enabled or has already
  merged, where dropping it would lose its landing record: wait, or remove it from the queue /
  disable auto-merge on GitHub, `lane_resume` a paused lane and wait for its `ejected` event
  first).
- `plan_list()` -> `plans[] {id, provider, used, elapsed, room, left, pace, daysToReset,
  aboveCeiling, resetsAt}`, every weekly window but Claude's Fable window, which only Fable
  draws on; `ceiling`; `next` (the plan `cell_register` assigns: among Claude's plans while
  `cells.claudeOnly` is on, since cells implement on Opus, the highest `pace`, `left`, the room
  below `plans.ceiling`, over the days to its reset, so each plan is spent by its own reset;
  null when no plan can take a cell). Refuses `PLANS_UNREADABLE`.
- `ejection_excuse(branch, reason, session)` -> `branch`, `attempt`, `cause`, `ejections`,
  `excused`, `counted`, `limit`, `answered[]`: the cell's latest ejection was not its branch's
  fault (a known flake), so it stops counting toward `cells.maxEjections`; under the limit again,
  it answers the open `ejection-limit`. `session` must hold the lane's live lease. Refuses
  `VALIDATION_ERROR`, `FOREMAN_REQUIRED`, `FOREMAN_STALE`, `FOREMAN_LOST`, `NOT_FOUND`
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
  required check stood in), `provenanceRerecorded` (provenance-only merges resolved by
  `regenerate`), `ejections`, `excusedEjections` (by cause or `ejection_excuse`),
  `foreman {wakes, wakesPerMerge}`, `byPlan[]`,
  `byRoute[]`, `prs[]`, `experiences[]`, `digest`; with `compare`, `delta`. Refuses `NOT_FOUND`.
- `dial_get(key?)` -> `key`, `value`, `default`, or `dials[]`. Refuses `NOT_FOUND`.
- `dial_set(key, value, session?)` -> `key`, `value`, `previous`, `default`. A foreman names
  its `session` (the owner, setting a dial by hand, names none). Refuses `FOREMAN_STALE`,
  `FOREMAN_BUSY`,
  `NOT_FOUND`,
  `DIAL_OUT_OF_RANGE` (`lane.slots` up to the lane host's `suggestedSlots`; `host.buildDir`
  an absolute directory, or empty) and
  `CONFIRMATION_REQUIRED` for the owner's `review.*` dials.

## Dials

`lane.slots` 1, `cells.max` 3, `cells.issuesMax` 1, `host.minFreeGb` 8, `host.minFreeDiskGb` 20
(at the lane's slots and their build output), `host.buildDir` empty (where the slots' Rust
build output goes, such as a data volume, which must exist: a missing one, an unmounted
volume, pauses the lane; empty keeps it in the slots' directory),
`lane.queueTarget` 2,
`lane.queueMax` 10, `plans.ceiling` 85, `fable.ceiling` 50, `cells.claudeOnly` true,
`lane.coverageEvery` 5, `lane.checkTimeoutMinutes` 90 (the required check on a pull request,
and then the wait in a merge queue), `lane.maxBaseReruns` 2 (100 all but
turns the guard off), `claims.leaseHours` 24, `foreman.leaseMinutes` 30, `cells.maxEjections` 3,
`experience.hold` false, `lane.autostart` true, `logs.keepDays` 30, and the owner's
`review.*` dials.

## State and claims

Claims live on GitHub. The lane's own state (cells, queue, events, dials) is in the per-user
data directory, keyed by repository (`BOTCORE_FACTORY_DATA_DIR` overrides the base), behind
one lock and written atomically (temp file and directory fsynced before and after rename; closed
events and finished runs trimmed to bounded history while open events and active runs stay);
every change is appended to `log.jsonl`. The measurement records (`records.jsonl`, append-only)
hold the facts the report and the improvement loop compute from: cell registered, enqueued
(queued or held), and, from the lane loop, validated, ejected and merged, each with its attempt,
plan, route and execution profile, with incremental branch and run summaries cached in
`records-summary.json`.

## Adapter

`[plugins.factory]` in `botcore.toml` (`[tool.botcore.plugins.factory]` in `pyproject.toml`):
`labels` (the label definitions intake reads), `prequeue` (named stages:
`{ name, run }`), `review_evidence` (`{head}` stands for the head being enqueued, `{worktree}`
for the cell's worktree, which the lane's own run needs: it runs from a clean `review` slot at the
base, so a change to the verifier binds only once it is on the base and the lane restarts; it
exits 0 to accept and 3 to refuse, and any other exit is the lane's trouble), `test_changes`
(`{base}`, `{head}` and `{worktree}` substituted; prints `report-test-changes.mjs --json`; the
lane runs it from the clean `review` slot at the base on the folded commit before validation,
attaches the report to the cell and attempt records, and holds `area:factory` branches with
`holdReason` `gate-change` when it reports findings),
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
`ignore_branches`, `slot_clean_paths` (literal relative paths inside a slot checkout whose ignored
build output is moved aside into the slots parent directory and deleted when a slot is recycled or
swept), `measure_paths`, `trend_issue`. Commands are argument lists, never shell strings.
"""
