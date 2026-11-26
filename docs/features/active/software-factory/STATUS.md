# Software Factory: status

Epic: [#1549](https://github.com/lushly-dev/afd/issues/1549). File new work for this area as its sub-issue.

Read this before the [proposal](software-factory.proposal.md). It moved from `proposed/` to
`active/` on 2026-11-14, because Phase 1's implementation had started on `main`. Reconciled that
day against `main` at `ee1b5827`, from merged history; this reconciliation did not rerun the
plugin's tests.

## How to keep this file

- A change adds its own dated section under its area in [Changes](#changes), at the top of that
  area, as a `####` heading. Two pull requests from different areas then insert at different
  places. Two from the same area still insert at the same place: the one that merges second
  keeps both sections.
- A piece of a phase has its own line under that phase's heading at the end of this file, made when
  the phase starts, with a blank line between pieces, because git reports a conflict when two
  branches change adjacent lines. A pull request edits the line of the piece it builds and no other.
- No sentence or cell says which pieces are done, not done, next or latest: read the piece
  lines. Such a summary is one line every pull request rewrites, so every open branch
  conflicts on it though nothing disagrees.
- A line stays within the limit in `scripts/policy/doc-line-limits.json`, which
  `scripts/check-doc-lines.mjs` enforces.
- Never delete a dated section. Mark it superseded and point to what replaced it.

## Changes

### The lane: validating, merging and ejecting

The queue, validation, base moves, merges, ejections and repairs.

#### Configured in-slot build directories cleaned on recycle and sweep, 2026-11-23

Pull request [#2304](https://github.com/lushly-dev/afd/pull/2304), for
[#1659](https://github.com/lushly-dev/afd/issues/1659) (attached as a sub-issue of
[#1549](https://github.com/lushly-dev/afd/issues/1549)). Supersedes the `#1659` note in the
2026-11-19 build-directory entry below:

- **Adapter key:** `[plugins.factory]` gains `slot_clean_paths`, a list of literal relative paths
  inside a slot checkout (rejecting absolute paths, `..`, `.`, `.git` case-insensitively including
  trailing dots/spaces, NUL bytes, drive letters and glob wildcards). AFD's `botcore.toml` sets
  `slot_clean_paths = ["foundations/specimen/host/target"]`, keeping Specimen's deliberate
  `3ee8c66b` worktree-isolation pin and foundation boundary intact.
- **Safe non-blocking cleanup:** `Git.clean_slot_paths` verifies each path is an ignored directory
  with no tracked files (`git ls-files` and `git check-ignore`), walks it with `O_NOFOLLOW`
  directory fds on POSIX (and `lstat` reparse-point + identity checks on Windows, including Python
  3.11 junctions), skips symlinks/junctions/mount crossings, renames existing directories aside
  into the slots parent directory (never inside the worktree, so git and linters never see
  `.removing-*`), and removes them in a detached background process.
- **Lifecycle:** `sweep_builds` cleans `slot_clean_paths` on free numeric slots with no queued
  owner and on an inactive `coverage` slot (retrying any deferred or interrupted coverage cleanup)
  before `disk_short` reads free disk; `release_slot` cleans `slot_clean_paths` before parking a
  validated checkout to `kept-*`; `slot_build` cleans them on first use, branch change,
  `host.buildDir` move, or coverage start (deduplicated per step); `poll_coverage` cleans the
  coverage slot once finished. Same-branch re-validation keeps both `CARGO_TARGET_DIR` and in-slot
  build output.

#### Test-change reports attached to cell records and Phase 5 `gate-change` hold, 2026-11-22

Step 5 of [#1387](https://github.com/lushly-dev/afd/issues/1387), pull request
[#2161](https://github.com/lushly-dev/afd/pull/2161):

- **Adapter and trusted run:** `[plugins.factory]` gains `test_changes` (`botcore.toml` points it
  at `.claude/skills/maintain-gates/scripts/report-test-changes.mjs --root {worktree} --base
  {base} --head {head} --json`). `lane-enqueue` runs it in the cell's worktree as fast feedback
  (refusing `TEST_CHANGES_FAILED` on a failure, mismatched `base`/`head` or malformed JSON), and
  `Step.start_validation` runs both the script and its commit-to-commit git reads from the base's
  clean `review` slot (`cwd` and `{worktree}` both bound to that slot, requiring `{base}` and
  `{head}` placeholders) so neither a tampered script nor branch `.gitattributes` can silence the
  diff (`LaneTrouble` on failure).
- **Records and cell view:** `botcore_factory.change_report.parse_report` validates and bounds the
  JSON report (`MAX_FINDINGS = 200`, keeping the true `findingCount`). The lane attaches
  `testChanges` to the cell (`lane-status` exposes it in `cells[]`) and to the attempt's records
  (`enqueued`, `held`, `validated`, `ejected`, `merged`; `records.SCHEMA` raised to 5 for `held`),
  folded into `records.attempts` and readable via `records.test_changes_for`.
- **Phase 5 "never improves by checking less" hold:** `check_less_reasons` turns `testChanges`
  findings and `gate_paths` edits into bounded plain-English reasons (adding tests produces no
  findings and holds nothing; `checks_run_delta` is accepted by the helper for Phase 5 once
  validations report `checksRun`, and is not yet wired in production). On an `area:factory` (or
  improvement-experiment) branch without a head-matched approval, both `lane-enqueue` (fetching
  `base_branch`, never `origin/HEAD`, even when `test_changes` is unset) and
  `Step.start_validation` hold the branch (`holdReason: "gate-change"`), write the `held` record
  and emit `gate-change-held` (`needsOwner: "gate-change"`). `Step.queue_held` promotes only
  `queue-full` holds so owner-held branches stay held while later `queue-full` entries advance.
  `measure-approve` (`factory` host only, never `factory-cell`) approves that exact head and
  releases the held entry to the queue (or to a `queue-full` hold when the queue is full).

#### Provenance-only merge covers Health, Violet and `lane-report`, 2026-11-22

Pull request [#2028](https://github.com/lushly-dev/afd/pull/2028), for
[#1472](https://github.com/lushly-dev/afd/issues/1472). Closes the three remaining gaps from
[#1458](https://github.com/lushly-dev/afd/pull/1458):

- **Health:** `scripts/provenance-merge.mjs` and `botcore.toml`'s `regenerate` now cover
  `endpoints/health/provenance/provenance.json` (`files` by `path`, `adapted_functions` by `name`;
  derived/license rows still refuse) and `endpoints/health/tests/test_provenance.py`, updating
  `RECORD_SHA256` only when both sides' pins matched their own records and no conflict lies outside
  that line. `scripts/base-sync.mjs` names Health's provenance test and checks staged pin files for
  conflict markers.
- **Violet and manifest shapes:** `scripts/release/provenance.mjs` exports zero-dependency
  `violetBeforeRelease` (shared with `scripts/violet-provenance.test.mjs`), so
  `scripts/provenance-merge.mjs` merges Violet files edited on both sides (including released
  `package.json` and `CHANGELOG.md`) and recomputes `manifest_shape_sha256` where present.
- **Visible record:** the lane emits a `provenance-rerecorded` measurement record (`SCHEMA` raised
  to 4; `branch`, `attempt`, `base`, `names`, `paths`) whenever `regenerate` resolves a conflict,
  folded per attempt and counted by `lane-report` as `provenanceRerecorded` (including comparison
  `delta`).

#### Native paths in the build-directory tests, 2026-11-20

Five Windows failures in the tests for [#1641](https://github.com/lushly-dev/afd/issues/1641) came
from comparing native paths with Unix path strings. The low-disk fixture also keyed its 5 GB reading
with a Unix path, so Windows got the 200 GB fallback. The tests now use native paths in both the
expectations and fixture data. All five passed on Windows 11 after the change.
The fix is in [#1697](https://github.com/lushly-dev/afd/pull/1697).

#### Slots build Rust off the system disk, and a full disk counts no ejection, 2026-11-19

Branch `fleet/lane-builddir-foreman-1641-1633`, for
[#1641](https://github.com/lushly-dev/afd/issues/1641). On the lane host one slot's Cargo
`target` folders reached 51 GB and took free disk to 135 MiB in run-8.

- Each slot's jobs run with `CARGO_TARGET_DIR` at the slot's own build directory: under the new
  `host.buildDir` dial (an absolute path, such as a data volume) in `<slots folder>-build/`, or
  `.build/` in the slots' directory. A slot that takes another branch, a moved dial, or a free
  slot whose branch left the queue removes it. A missing `host.buildDir` pauses the lane.
- A validation, install or coverage run whose whole log says `ENOSPC` or "No space left on
  device" (a test's own row or name never counts) is the lane's trouble: it pauses, the branch
  is validated again on resuming (`rerun` `disk-full`, once per attempt) and no ejection is
  counted. `host.minFreeDiskGb` also reads `host.buildDir`.
- Not done: a slot above a lowered `lane.slots` keeps its build directory until it is used again,
  and Specimen's `build:host` pins `--target-dir target`, so its output stays in the slot (#1659).

#### An ejection lists every failing test, 2026-11-19

Branch `fleet/lane-full-failures-1607`, for
[#1607](https://github.com/lushly-dev/afd/issues/1607). In fleet run-8, #546 broke three Umbel
tests with one cause and the lane found one per ejection, so the branch used all three and was
dropped.

- The lane validates with `pnpm verify --keep-going`; every local `cargo test` step runs with
  `--no-fail-fast` and each multi-package test step with `pnpm --no-bail` (a tooling test keeps
  both), so one run reaches every failure.
- The lane reads failing tests from the job's whole log, not the 200-line tail: cargo, vitest,
  pytest, node:test, TAP, CTest and Playwright. The `ejected` event's `lines` end with a count
  and up to 50; the `ejected` record keeps up to 5,000 as `failures`, the total as `failureCount`.
- Not done: `prepare-pr lane` still runs no suites before enqueue (the issue's second option),
  and `pnpm test:specimen` chains two browser suites with `&&`, so the second waits on the first.

#### The lane works behind a merge queue, 2026-11-19

Pull request #1627, for the merge-conflicts plan's item 5
([#1598](https://github.com/lushly-dev/afd/issues/1598)). The owner will require GitHub's merge
queue on `main`. A required queue answers the lane's `gh pr merge` by queueing the pull request
and exiting 0, and the lane took that for a merge: it recorded the landing, removed the cell and
deleted the queue ref while the pull request was still open.

- The lane reads the pull request before and after asking (`merge_progress`, one GraphQL
  read). Where its base has a queue it asks with `enqueuePullRequest` bound to the validated head,
  never `gh pr merge`, which sets auto-merge there when a check has not finished. Merged: it
  lands, as before. Queued: the entry waits at the front as `merge-queued` and is read again each
  step until GitHub says `MERGED` or it left the queue.
- A pull request out of the queue and still open a minute after it was first read so is ejected:
  `ci-failed` (counted) when GitHub's reason is `failed_checks` or the required check failed on
  the commit the queue built, `merge-failed` (excused) otherwise. A `Co-authored-by:` line in the
  queue's squash is quoted, read from the removal event's `beforeCommit`, which is that squash
  (read on #1621). GitHub logs a merge as a removal too, a second before the pull request reads
  as merged: one whose reason is `merged` is never ejected, and still open five minutes on it
  pauses the lane.
- A read that fails after the request leaves the entry `merge-queued`, never `merging`, so the
  same head is not asked for twice. A pull request found queued at a head the lane did not
  validate pauses the lane. Auto-merge set by someone else changes nothing until the lane asks.
- While queued: GitHub locks the branch, so nothing is pushed and the base is not followed (the
  queue checks what lands); nothing behind it is pushed; the wait is bounded by
  `lane.checkTimeoutMinutes`; `lane-drop` and `lane-enqueue` refuse `MERGE_QUEUED`; a restart
  resumes the wait.
- The lane authors its merges of the base as the branch's own author, the author of its newest
  commit that is not a merge (it still commits them as `botcore-factory <factory@localhost>`),
  with `--author`, so neither `GIT_AUTHOR_*` nor the host's git configuration decides it. A
  branch that already holds a merge an older lane authored is still ejected for it: its cell
  rebuilds the branch. The queue's squash credits every commit author who is
  not the pull request's as a co-author, and `ci-ok` then fails the group: the second trial
  (#1621) saw exactly that. A cell whose own commits are not authored as the account that opens
  the pull request (the lane host's `gh` sign-in) is ejected the same way, as `ci-failed` naming
  the line.
- A pull request that merged at a head other than the one the lane validated lands with
  `headMoved` and `mergedHead`, counted as merged without the check (`merged-without-check`).
- An open pull request whose last removal from a queue says `merged` is in the second before it
  reads as merged, whatever the entry's state: the lane waits for `MERGED` and never asks again.
- Limit, host recovery: `lane-host-set` with `recover` rebuilds every queue ref as `queued`. A
  pull request in GitHub's queue is then validated again and its push refused by the branch lock;
  one the queue already merged is never recorded as landed. Recover only with none queued.
- Limit, a lane killed between its request and the record of it: it asks once more for the same
  head, and only if the queue has let that head go for a reason other than a merge. Queued,
  merged or about to read as merged, the pull request is taken up instead.
- The queue is found in GitHub's answer, never in configuration, so the lane host takes this
  change before the queue is turned on. Not run against a live queue. Not established by any
  trial: what `mergeQueueEntry.headCommit` names (used only when a removal names no commit), and
  what a cell's git identity is on the lane host.

### Cells, plans and the foreman

What a cell may take, which plan it runs on, the foreman's commands and `run-fleet`.

#### Who may let a repair edit its gate, 2026-11-24

Merged 2026-11-24 as [#2485](https://github.com/lushly-dev/afd/pull/2485). Recording a gate
exemption or an excused ejection is the live foreman's alone, and the lane now decides a repair's
gate edits with its own code.

- `gate-allow` and `ejection-excuse` need the session that holds the lane's lease now. Any other
  call is refused `FOREMAN_REQUIRED`, which names neither the holder nor a way to take the lane,
  and neither takes the lane. `lane-drop` and `dial-set` keep the owner's call without a session.
- `gate-allow` takes the `head` it covers, which `GATE_EDIT_IN_REPAIR` names: a later commit needs
  a new one.
- The cell keeps its latest failing-check ejection (`checkFailed`), so a later conflict or
  unverified review does not end the repair's gate check. A cell ejected before this landed has
  no `checkFailed` and is still read from its last ejection.
- A cell's `lane-status` (`factory-cell`) shows whether a foreman holds the lane and until when,
  not its session.
- `GATE_EDIT_IN_REPAIR` sends the cell to its foreman rather than naming `gate-allow`, and no
  label exempts a repair: the `area:ci` exemption is gone.
- Before validating, the lane checks a repair's gate edits again with its own code and
  `gate_paths`, at the queued head before `main` is merged in, against its own fetch of `main`.
  An ejected head the checkout no longer has counts every gate edit. It holds what it finds
  as `gate-change` for the owner (`measure-approve`), or until the foreman's `gate-allow` and a
  new `lane-enqueue`. Edits it cannot read hold the repair too.
- `gate_paths` now includes the factory plugin's own source.

#### Competing issue claims, 2026-11-24

Merged 2026-11-24 as [#2422](https://github.com/lushly-dev/afd/pull/2422), for the
[formal verification pilot](../formal-verification/STATUS.md). The factory named the latest claim
on an issue where the issue-claim CLI named the earliest live one, and a release took the label
off an issue another branch's live claim still held.

- `cell-register` names the earliest still-standing live claimant and directs the foreman to
  available work. A renewal shows the holder's current lease.
- `issue-check` no longer lists a live claim as stale because a later claim lapsed.
- `lane-drop`, and a `cell-register` whose writes failed, leave `status:in-progress` on an issue
  another branch's live claim holds, so it is not dispatched a second time; a lapsed claim whose
  branch has an open PR counts, as the CLI reads it. The cell's own claim is still released, and
  `lane-drop` posts that release before it changes the label.
- The issue-claim CLI and the
  [triage scenario](scenarios/14b-identify-the-standing-claimant.scenario.yaml) read the same
  [fixture](scenarios/fixtures/claim-histories.json) of fifteen histories, including release by
  either contender and three of the four known differences between the two, in four rows.
- Not changed: the factory does not read back after it claims, so a cell that raced a session
  keeps running after both name the session. The gateway's single writer ends that.

#### The foreman's session is checked where it acts, 2026-11-19

Branch `fleet/lane-builddir-foreman-1641-1633`, for
[#1633](https://github.com/lushly-dev/afd/issues/1633). A wait left open by a session that had
handed over could take its successor's events.

- `lane-wait` checks the foreman's session again in the transaction that marks events delivered,
  and `cell-register`, `dial-set`, `ejection-excuse`, `gate-allow` and `lane-drop` check it in
  their own transaction: a session that lost the lane meanwhile changes nothing.
- `gate-allow` and `lane-drop` take an optional `session`, guarded as `ejection-excuse` is; the
  owner's call names none.
- The check inside the change never takes the lane: a session whose lease was handed over or ran
  out since is refused `FOREMAN_LOST`.

#### Answered events no longer wake a new foreman, 2026-11-19

Run 8 woke the foreman for two events an earlier session had resolved (#1608).
PR #1632 checks that each event is open when `lane-wait` records delivery. The runbook shows
how to record a decision with `event-resolve` and its `note` argument.

### Hosts and toolchains

The lane host, its slots, Node and the other toolchains.

#### Shared host validation lock checked across both lanes (Phase C), 2026-11-26

Pull request [#2697](https://github.com/lushly-dev/afd/pull/2697), for
[#1309](https://github.com/lushly-dev/afd/issues/1309), after Phase B landed in Lushly
(lushly-dev/lushly#2956). Covers the `#1309` remainder in the Phase A entry below, short of a full AFD lane run on `random`:

- **Both directions, one machine:** on the MacBook Air, AFD's `ValidationLock` and Lushly's
  `createHostValidationLock` ran as separate processes over one `LUSHLY_FACTORY_HOST_LOCK_DIR`.
  Lushly's `acquire` waited behind AFD's hold (blocker `botcore-factory`) and took the lock
  4.1 s later, as AFD released; AFD's `try_acquire` waited behind Lushly's (blocker
  `lushly-merge-lane`) and took it 4.3 s later. The file ended with no owner and no waiters.
- **On `random`, against the live lane:** with Lushly's lane holding the real lock for
  `pnpm validate:coverage`, AFD's code (Python 3.12, `check_available` with no waiter
  registered) named that hold, its PID and `acquiredAt` as its blocker, so the two languages
  agree on process identity there.
- **On `random`, the other way (later that day, after #2697 merged):** while Lushly's lane was between validations,
  AFD's code took the real lock for a probe hold, and Lushly's `tryAcquire`, from a separate
  process, named that hold (`botcore-factory`, `lushly-dev/afd`, its PID) as its blocker. The
  probe then withdrew Lushly's waiter and released AFD's hold, and the file ended with no owner
  and no waiters. A full AFD lane run beside Lushly's on `random` has not been made.
- Replaced `run-fleet`'s manual `random` host note (start AFD's lane only while Lushly's is idle)
  with how the shared lock shows: the lanes now wait for each other (`waitingOnHostLock`).

#### Shared host validation lock (Phase A: AFD), 2026-11-22

Branch `t3/host-validation-lock-1309`, for
[#1309](https://github.com/lushly-dev/afd/issues/1309) (after the owner approved both open
decisions on 2026-11-22: auto-clearing dead holds once both lane PID and job PIDs exit, and
keeping Lushly's non-lane `pnpm validate:final` runs on `final-validation-lock.mjs` alone):

- Added `botcore_factory.validation_lock.ValidationLock` over `~/.cache/lushly-factory/`
  (`validation-lock.json` schema `version: 1` + short-lived `validation-lock.mutex` with nonce
  release and rename-aside stale breaking; override `LUSHLY_FACTORY_HOST_LOCK_DIR`), plus an
  in-memory `FixtureValidationLock` (`hostLock` fixture key) so tests never touch the home cache.
- Updated `real_system._darwin_start_time` to run `ps` under `TZ=UTC LC_ALL=C` and parse with
  `calendar.timegm` so Python and Node agree on integer UTC Unix epoch seconds (`startedAtEpoch`).
- Wired the host validation lock into `Step.start_validations()` (pre-checking before
  `review_verified` and `release_slot`), `Step.start_validation()`, `Coverage.start_coverage()`
  (with rollback on pre-`start_job` ejections/`LaneTrouble` and `set_job` for child PIDs),
  `poll_validations()`, `poll_coverage()`, `requeue()`, `eject()`, `cells.drop()` (using the lane
  daemon's PID, never the CLI PID), `lane_pause()`, and end-of-step `reconcile`/`withdraw_waiter`.
- Extended `lane_stop`, `_end_run(kill=True)`, `resume()`, `run_loop` `busy`, and `stopRequested`
  gating to include `lane.coverage`; exposed deterministic `waitingOnHostLock` and `hostLock` in
  `lane_status`.
- Remaining for `#1309`: Phase B in `lushly-dev/lushly` (`scripts/host-validation-lock.mjs` wired
  into `merge-lane-worker.mjs:final()` and `merge-lane-operations.mjs:coverage()`), then Phase C
  live two-lane check on `random` and removal of the manual host note in `runbook.md`.

#### Shared host validation lock approach proposed for #1309, 2026-11-22

Posted and independently reviewed the cross-repository approach on
[#1309](https://github.com/lushly-dev/afd/issues/1309): keep each lane's own daemon `lane.lock`,
coordinate heavy validations and coverage runs through one shared `~/.cache/lushly-factory/`
validation lock (`validation-lock.json` + short-lived `validation-lock.mutex`, override
`LUSHLY_FACTORY_HOST_LOCK_DIR`) using UTC epoch seconds (`startedAtEpoch`) for cross-language
liveness and a FIFO `waiters` queue to prevent starvation. Implementation spans `lushly-dev/afd`
and `lushly-dev/lushly` and awaits owner decisions on stale-hold recovery and non-lane local runs.

### Reviews and commit credit

Review evidence, `prepare-pr`'s lane mode and who a merge credits.

### Fleet runs

What a run of the fleet found, with its numbers.

### Every other area

Anything the areas above do not cover.

## Changes to 2026-11-18, every area

Newest first, as they were written. No new section goes here.

### Cells start only on a Claude plan, 2026-11-18

AFD's model routing of 2026-11-17 puts every cell on Opus 5.5 `medium` and spends the ChatGPT
allowance on review, but the lane chose among every plan, so a roomier ChatGPT plan won and the
fleet could not start cells ([#1498](https://github.com/lushly-dev/afd/issues/1498)). The
`cells.claudeOnly` dial, on by default, limits `cell-register`, `lane-status` and `plan-list`'s
`next` to Claude's plans. With none signed in, `cell-register` refuses `NO_CLAUDE_PLAN`,
`lane-status` gives `canStartCell: false` with that reason, and `plan-list` lists the plans with
`next: null`. An empty plan list is `PLANS_UNREADABLE` from every reader. Claude's
`seven_day_fable` window is no longer read as a plan, since only Fable draws on it. The scenario
fixtures' two plans are now both Claude's, one per Mac. Not yet seen in a fleet run.

### Squash merges credit no co-author, 2026-11-18

[#1515](https://github.com/lushly-dev/afd/issues/1515): about half of the recent squashes on `main`
carried a `Co-authored-by:` line, many for `botcore-factory`, the identity a cell's base merges are
committed under. GitHub's default squash message adds one for every commit author whose address
isn't the merging account's. Every squash the plugin makes now passes the branch's own messages as
the body: the lane's `gh pr merge`, and the gateway's merge and pinned auto-merge. Merge commits and
`Co-authored-by:` lines are left out, and each commit keeps its `Assisted-by:` trailer
(`botcore_factory/squash.py`). Fixed by hand, since it changes how the lane merges. It hasn't been
seen in a fleet run yet. A session's own merges follow `prepare-pr` step 9 (#1517).

### A cell can take a package of related issues, 2026-11-18

`cell-register` takes more than one issue when the foreman names the package: up to
`cells.issuesMax` dispatchable issues, with `related_because` saying what they share. The cell and
its `cell-registered` record keep that reason as `relatedBecause`, and `lane-status` shows it. A
claim write that fails partway now puts back the claims it wrote. Before this, any second issue
was refused as unrelated whatever the dial said, because `issue-check` never computes `related`;
it still does not, and suggesting packages from it is later work (lushly-dev/afd#1431).

### The `.nvmrc` Node at `lane-start`, nvm-windows, and `node-missing` ejections, 2026-11-17

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
- **A branch that deletes `.nvmrc` is ejected too** ([#1505](https://github.com/lushly-dev/afd/issues/1505),
  on `lush/fleet-1505-nvmrc-deleted-node-missing`). Without `.nvmrc` its slot validated on the
  host's default Node; when `.nvmrc` is among its changes against the base and the slot has none,
  it is ejected as `node-missing`, its detail saying the repository pins its Node there. A
  branch that leaves `.nvmrc` blank is ejected the same way and told to pin a version number.

### Ejections that count, gate files past the rerun limit, plan pacing and kept validations, 2026-11-17

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

### Provenance conflicts, one foreman, and the lane's own review check, 2026-11-17

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

### Repairs, ejection details and the units checkout, 2026-11-17

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

### A branch that affects every unit is no longer validated again for ever, 2026-11-17 (#1391)

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

### A moved `main` no longer always means validating again, 2026-11-16

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

### The first fleet, 2026-11-16

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

### The fleet's command lines and `run-fleet`, 2026-11-15

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
([#1309](https://github.com/lushly-dev/afd/issues/1309); superseded: both lanes now take one host
validation lock, see the 2026-11-26 Phase C entry under Hosts and toolchains). A read-only probe of the real host on the MacBook Air (2026-11-15) found no
lane host set, no machine probed, and `canStartCell` false there (7.1 GB free against
`host.minFreeGb` 8).

### Review evidence and `prepare-pr`'s lane mode, 2026-11-15

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
workstation. (Superseded: `run-fleet` merged in #1310, and each piece now has its own line under
[Phase 1](#phase-1-the-plugin-one-slot).)

### Lane-loop repair on the MacBook Air, 2026-11-15

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

### Preserved Windows checkpoint, 2026-11-15

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
| 1. The plugin, one slot | In progress | One line per piece under [Phase 1](#phase-1-the-plugin-one-slot) |
| 2. Concurrency | Not started | After Phase 1's measured run |
| 3. Cells on other machines | Not started | After Phase 2 |
| 4. Lushly moves on | Not started | A Lushly adapter at parity with Lushly's `scripts/merge-lane.mjs` |
| 5. The improvement loop | In progress (guardrail prerequisite) | One line per piece under [Phase 5](#phase-5-the-improvement-loop); loop itself starts after Phase 2 |

The plugin lives in `endpoints/botcore/plugins/botcore-factory/`, and its jobs run from this
folder's [`scenarios/`](scenarios/) through AFD's scenario runner, in the `botcore-factory`
workflow.

## Phase 1. The plugin, one slot

One line per piece, as the [proposal](software-factory.proposal.md#phases) lists them. A pull
request edits the line of the piece it builds. A blank line parts them, because git reports a
conflict when two branches change adjacent lines.

- Botcore's host changes, plugin policies, input schemas in the catalog and named refusals: merged in #1181.

- `botcore-factory`'s foundation and intake: the world, the state store, the intake rules, `issue-check`, `cell-register`, `lane-status`, `dial-get`/`dial-set` and job 14: merged in #1183.

- The queue, events and records: `lane-enqueue`, `lane-wait`, `event-resolve`, `lane-pause`/`lane-resume`, the record log, `cell-attach`, `lane-drop`, `plan-list`, `gate-allow`, and jobs 03 to 09: merged in #1185.

- The lane loop: validation, exact-head push, serial merge, Windows and macOS process control, host probing and selection (`lane-host-probe`, `lane-host-list`, `lane-host-set`) and `lane-report`: merged in #1295.

- Review evidence and `prepare-pr`'s lane mode: merged in #1305.

- The `factory` and `factory-cell` command lines and `run-fleet`: merged in #1310.

- The webhook wake: not done.

- Experience review (`pr-preview` and the before-and-after screens): not done.

- One measured AFD fleet run on the workstation, with its numbers reported, after the webhook wake and experience review: not done.

## Phase 5. The improvement loop

- Test-change reports attached to cell/attempt records and the `gate-change` hold with `measure-approve` (`#1387` step 5; `checksRun` comparison waits on check-count reporting): merged in #2161.

- Scheduled health reviews, anomalies, `factory-health`, `health-explain`, `improvement-propose`, `improvement-list`, `measure-change` holds and `checksRun` comparison: not done.
