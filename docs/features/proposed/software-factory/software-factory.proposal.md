# Software Factory: the merge lane as a botcore plugin

**Status:** Proposed, 2026-11-12; revised the same day after three independent readers
walked the jobs. **Author:** Claude Code session with Jason.
**Origin:** Lushly's [software factory plan](https://github.com/lushly-dev/lushly/blob/main/Docs/features/active/software-factory.plan.md)
(fleet v2, Lushly #2164 and #2187) and its
[merge lane runbook](https://github.com/lushly-dev/lushly/blob/main/Docs/operations/merge-lane.md).
This is that plan's Phase 6 ("generalize"), brought forward so AFD can run a fleet.
**Replaces:** nothing in AFD. Jason confirmed on 2026-11-12 that the fleet skill never came
to AFD; the closest thing, `manage-projects/references/wave-orchestration.md`, was retired
in #757.

## Decisions

Jason's answers of 2026-11-12.

| Question | Decision | What it changes |
|---|---|---|
| Where the lane lives | A botcore plugin, shared by every lushly-dev repository | One implementation in Python as AFD commands; each repository supplies an adapter. Lushly moves onto it once it matches Lushly's lane |
| Lane host | Chosen from the connected machines, never hard-coded. AFD's first host is the Windows workstation | Host identity, process control, locks and hand-off must work on Windows and macOS |
| Capacity | The workstation (Ryzen 9 7950X3D, 16 cores / 32 threads, 64 GB) has far more room than the Mac mini (M4, 10 cores, 24 GB) | Validation concurrency is a dial sized per host, not Lushly's fixed "one final at a time" |
| Jobs | Keep every job; the build order is left to the implementer | The order in [Jobs](#jobs) is the build order |
| Intake | AFD needs Lushly's triage | An AFD `triage-issues` skill, a label file, and the label and claim rules in the plugin ([Intake](#intake)) |

## Goal

Turn AFD's backlog into merged, correct PRs with the least process and no routine work
for Jason, using the shape Lushly has been running since 2026-11-11: cells implement, one
lane validates and merges, a stateless foreman starts cells and reacts to events. Jason
never reviews code; he answers product questions, does operator work and looks at changed
screens side by side.

## What carries over from Lushly

- **Three parts.** A *cell* is one agent with one issue in its own worktree; it
  implements, gets its review, commits, enqueues and ends its turn. The *lane* is a
  process, the only thing that validates a fleet branch, pushes, opens the PR and merges.
  The *foreman* picks work, picks each cell's plan and route, starts cells, resumes an
  ejected cell and brings Jason what only he can answer. It keeps no state; state is
  `lane-status`.
- **Agents never wait on a deterministic step.** A cell ends its turn after enqueueing and
  is resumed only if its branch is ejected.
- **Ejection, not repair.** A failing branch goes back to its cell with its log. The lane
  never resolves conflicts or edits code. The lane's own trouble (network, sign-in, a
  killed run) is a `lane-error` that pauses the lane and ejects nothing.
- **Allocation by plan room.** Start each cell on the plan with the most room (share of
  the weekly window elapsed minus share used), skipping plans above `plans.ceiling`.
- **Control points.** Jason is asked only for product decisions (`needs:decision`) and
  operator work: production, paid providers, secrets and sign-ins. Gate and CI changes
  merge like any other diff, behind the protections in [Gate changes](#gate-changes).
- **No bureaucracy.** No status narration, checkpoints written by agents, phase approvals,
  attempt counts or coordinators that re-review a cell's work. Bookkeeping the lane needs
  is written by the lane, from commands the agents already call.

What changes from Lushly: **one issue per cell by default.** Jason's first complaint about
the old fleet was that each item carried a group of issues and its own large PR. A cell
takes one issue; `cells.issuesMax` allows a small batch only of issues `issue-check` lists
as related (same area and files).

## Design

```
Intake ──► Cells ──► Queue ──► Lane (on the chosen host) ──► main ──► coverage
(triage)   (agents)  (lane      validate in N slots, merge in order,
                      state)    push, PR, required check, squash-merge, screens
               ▲                          │
               └──── ejected with log ────┘
       Foreman: one agent, woken by a cell ending, a lane event or Jason
```

### The plugin and its host

`endpoints/botcore/plugins/botcore-factory`, entry point `factory`, implementing
`BotCorePlugin` with AFD commands that return `CommandResult`, and declaring
`host_context_safe`. It is served through botcore's managed host (`build_host`,
`create_host_cli`, `create_host_mcp_server`, the `trusted-local` profile), not the legacy
`{name}-run` meta-tool, which takes Python source and truncates output by characters.

**Who may call what.** botcore's host gates by profile, not by caller: under
`trusted-local` every registered command is callable. So the separation is by host. One
plugin builds two hosts:

| Host | Commands | Used by |
|---|---|---|
| `factory-cell` | `lane-status`, `issue-check`, `lane-enqueue`, the `lane-handoff` commands | Cells |
| `factory` | Every command | The foreman and Jason |

Each command's `CommandPolicy` uses botcore's existing effect names: `inspect` for reads,
`subprocess` for anything that runs git or the adapter's commands (`lane-enqueue`,
`issue-check`, `pr-preview`, `lane-host-probe`), `service` for the lane process and
GitHub writes, `history-write` for state. botcore gains `PluginRegistry.add_policy`, so a
plugin declares its own policies instead of each host passing them to `build_host`.

**For a model with no skill installed.** Command names below are AFD's kebab-case; the
Python functions and their inputs are snake_case (`lane_status`, `timeout_ms`), and the
scenarios use the snake_case inputs. Three botcore changes in Phase 1: the host's catalog
(`factory-start`) returns each command's input schema and one-line description, not only
its policy; an input key in the wrong case is refused with a suggestion naming the right
one; and the plugin registers a `factory` docs topic with the inputs, the events and the
order of calls.

**Confirmation.** Python AFD's confirmations live in its server factory, which botcore's
host does not use; Phase 1 wires them into the host. Each command states its mode:
agent acknowledgement for `lane-revert`, `lane-drop` and `lane-stop` (the foreman must be
able to revert a broken merge on its own), and a person's confirmation only for
`lane-host-set` with `recover`.

**Bounded output.** Every list takes `limit` and `cursor`, failure messages carry the
first lines and a `logPath`, and no result relies on character truncation. Cells call the
host's CLI surface, which has no client time limit, so `lane-enqueue` can run the cheap
checks (a monorepo typecheck included) in one call.

### Commands

The draft below is enough to write the [jobs](#jobs) against; the exact specification
follows approval. Every refusal carries a `suggestion` naming the way forward.

| Command | Input | Result `data` | Refusals |
|---|---|---|---|
| `lane-status` | `limit?`, `cursor?` | `runId`, `host { id, isLaneHost }`, `running`, `paused` and `pauseReason`, `draining`, `slots { total, busy }`, `queue[]`, `held[]`, active `cells[] { branch, issue, state, plan, route, ejections }`, `openEvents[]`, `waitingOnOwner` (count), `orphans[]`, `dials`, `canStartCell` with `plan` and `nextIssue`, or `reason` and `nextReset` | — |
| `lane-start` | — | `running` | `HOST_NOT_SET`, `NOT_LANE_HOST`, `LANE_LOCKED`, `REQUIRED_CHECK_MISSING`, `TOOLCHAIN_MISMATCH` |
| `lane-stop` | `force?` | `running`; a running validation finishes first unless `force` | — |
| `lane-run` | — | The loop in the foreground, for debugging the lane itself; no job uses it | As `lane-start` |
| `lane-host-probe` | — | `record`: this machine's cores, memory, free disk, toolchains, `gh` sign-in, checkout, `origin` fetch, adapter commands and (Windows) symlink support, published to `refs/factory/hosts/<id>` on `origin` | — |
| `lane-host-list` | — | `machines[] { id, name, reachable, cores, memoryGb, freeDiskGb, ready, missing[], suggestedSlots, measured, probedAt }` from the published records; a record's age decides `reachable` | — |
| `lane-host-set` | `id`; `drain?` or `recover?` | `host`, `previous`; with `drain`, `draining` (no new cells; the move happens at `queue-empty`); with `recover`, `rebuilt { queue, claims }` | `HOST_NOT_READY`, `LANE_BUSY`, `NOT_FOUND` |
| `cell-register` | `issues[]`, `branch`, `route`, `thread?` | `cell` with the `plan` the lane assigned; claims the issues on GitHub. Called **before** `delegate_task`, so a refusal costs nothing | `ALREADY_EXISTS`, `ALREADY_CLAIMED`, `NOT_DISPATCHABLE`, `CELLS_FULL`, `PLAN_ABOVE_CEILING`, `HOST_LOADED`, `TOO_MANY_ISSUES` |
| `cell-attach` | `branch`, `thread` | `cell`: the thread `delegate_task` returned | `NOT_FOUND` |
| `cell-park` | `branch`, `question` | `parked`: the issue gets `needs:decision` and the question as one comment, the seat is freed, the worktree and a long lease are kept; it shows in `owner-queue` until triage plans it again | `NOT_FOUND` |
| `lane-enqueue` | `worktree`; `title?` and `body_file?` (default to the previous attempt's) | `state` (`queued` or `held`), `position`, `head`, `prequeue { stages[] }`; the head is also pushed to `refs/factory/queue/<branch>` on `origin`, so a replacement host can rebuild the queue | `NOT_FOUND` (no cell for the branch), `NOT_LANE_HOST`, `DIRTY_WORKTREE`, `REVIEW_MISSING`, `PREQUEUE_FAILED`, `GATE_EDIT_IN_REPAIR` |
| `lane-handoff` | As `lane-enqueue` | As `lane-enqueue`, from a machine that is not the lane host | As `lane-enqueue` |
| `lane-handoff-status` | — | `queue[]`, `cellsActive`, this machine's `cells[]` | — |
| `lane-handoff-sync` | `worktree` | `head`, `logPath`: the lane's copy of the branch and the ejection's log, fetched into the worktree | `NOT_FOUND` |
| `lane-handoff-watch` | `consumer`, `timeout_ms?` | As `lane-wait`, for this machine's cells | — |
| `lane-wait` | `consumer`, `timeout_ms?` (at most 300000 over MCP; unlimited from the CLI) | `events[] { id, type, branch?, reason?, detail?, logPath? }` not yet delivered to this consumer, each with a compact `status` (`canStartCell`, `plan`, `nextIssue`, queue length, `waitingOnOwner`), or `{ events: [], timedOut: true }` | — |
| `event-resolve` | `id`, `note` | `resolved` | `NOT_FOUND` |
| `lane-pause`, `lane-resume` | `reason?` | `paused`; `lane-resume` resolves an open `lane-error` | — |
| `lane-drop` | `branch`, `reason` | `dropped`, `released[]`: dequeues the branch, releases its claims (issue back to `status:planned` with one comment) and forgets the cell; the worktree is left | `NOT_FOUND` |
| `lane-revert` | `prs[]`, `reason` | `revertPrs[]`, each merged by the lane | `NOT_FOUND`, `NOT_MERGED` |
| `gate-allow` | `branch`, `reason` | `allowed`: the diagnosis found the gate edit to be the right repair | `NOT_FOUND` |
| `plan-list` | — | `plans[] { id, provider, used, elapsed, room, aboveCeiling, resetsAt }` | `PLANS_UNREADABLE` (the foreman then uses the configured order) |
| `dial-get` | `key?` | `key`, `value`, `default`, or every dial | `NOT_FOUND` |
| `dial-set` | `key`, `value` | `key`, `value`, `previous`, `default` | `DIAL_OUT_OF_RANGE`, `NOT_FOUND` |
| `lane-report` | `run?`, `compare?` | `run`, `mergedPerHour`, `validationsPerMerge`, `productiveShare`, `staleRuns`, `reruns`, `foreman { wakes, wakesPerMerge }`, `byPlan[]`, `byRoute[]`, `prs[] { number, branch, route }`, `experiences[] { pr, state, pairs[] { story, width, before, after } }`, `digest` (one HTML page of the pairs); with `compare`, `delta` for each number | `NOT_FOUND` |
| `experience-accept` | `pr` | `accepted`; a PR held by `experience.hold` merges | `NOT_FOUND` |
| `experience-reject` | `pr`, `note` | `rejected`, and `revertPr` for a merged PR or `issue` filed for an open one | `NOT_FOUND` |
| `issue-check` | `numbers?`, `limit?`, `cursor?` | `untriaged[]`, `violations[] { number, rule }`, `dispatchable[]` in dispatch order, `related[]`, `staleClaims[]` | `READ_FAILED` (never reported as "nothing to do") |
| `owner-queue` | — | `items[] { kind, ref, question, since, answered }`: `decision` and `operator` issues, `sign-in` lane errors, `parked` cells, and `look` for UI PRs held by `experience.hold`; `answered` once he has replied, until triage acts | `READ_FAILED` |
| `pr-preview` | `pr` | `before { url }`, `after { url }`, `stopAfter`: the app served from `main` and from the PR's head, for a merged PR or an open lane PR, stopped after `stopAfter` | `NOT_FOUND`, `NO_PREVIEW` (the adapter has no `preview`) |

**Events.** `lane-wait` returns events this consumer has not seen; reading does not
resolve them. An event stays in `openEvents` until the action that answers it happens
(a re-enqueue or drop answers `ejected`, `lane-resume` answers `lane-error`, a new
`cell-register` answers `queue-room`) or `event-resolve` records a decision. A foreman that
dies between reading and acting loses nothing: the next one finds it in `lane-status`.

| Event | Meaning | The foreman's action |
|---|---|---|
| `ejected` | A branch failed: `conflict`, `entry-invalid`, `final-failed`, `push-failed`, `pr-failed`, `ci-failed`, `merge-failed`, `coverage-failed` | Resume the cell with the detail and log; a second ejection gets a diagnosis on the stronger route first |
| `ejection-limit` | A branch reached `cells.maxEjections` (counted by the lane, not an agent) | `cell-park` it with the diagnosis, or `lane-drop` it |
| `merged` | A branch landed | Start another cell if `canStartCell` |
| `queue-room` | A held branch can be queued, or a seat is free | The lane queues held branches itself; the foreman starts a cell if `canStartCell` |
| `lane-error` | The lane paused on its own trouble | Fix what the detail names, then `lane-resume`; sign-ins go to `owner-queue` |
| `main-broken` | Coverage on `main` failed, or two branches failed the same check | If one merge is the cause, `lane-revert` it; file a `priority:1` issue and start a cell on it; `lane-resume` |
| `merged-without-check` | A PR merged without the required check green | Check it; revert it if the check failed; otherwise `event-resolve` |
| `owner-replied` | Jason replied on an issue in `owner-queue` | Run `triage-issues` on it |
| `lane-stopped` | The lane process is gone; produced by `lane-status` and `lane-wait` from the lock's process check, since a dead lane cannot report itself | Read the log, `lane-start` |
| `queue-empty` | Nothing queued, no cell active, owed coverage done | Run `triage-issues`; start cells if work remains; otherwise finish |

A cell that ends its turn without enqueueing calls no command, so the lane cannot see it.
The foreman learns it from T3 Code when `delegate_task` completes, and acts at once:
answer the cell's question, `cell-park` it for Jason, or `lane-drop` it.

**Waking the foreman.** A model must not poll. The lane posts each event to a T3 Code
scheduled task's webhook, which starts a **fresh foreman session** for that event; the
event carries a compact status, so most wakes cost one or two calls and no session's
context grows over a run. Until that is proven on this machine, the foreman leaves one
background `lane_wait` through the CLI (no time limit) and T3 Code wakes it when that
command exits, as Lushly's foreman does with `merge-lane wait`.

### State

- **The lane host is recorded on GitHub**, as the repository variable
  `FACTORY_LANE_HOST`, so every machine reads the same answer and two lanes cannot both
  believe they are the host. `lane-host-set` writes it.
- **Claims are on GitHub**: `status:in-progress` plus one claim comment naming the branch,
  machine and lease expiry, renewed while the cell's branch is active. `issue-check` lists
  expired leases in `staleClaims`. A crashed foreman or a sleeping machine never holds an
  issue for good.
- **Everything else lives on the lane host** (queue, held branches, cells, events, run
  history, attempt logs), in the per-user application data directory (`platformdirs`
  `user_data_dir`, not a cache that the OS may purge), keyed by repository. Writes go
  through one state lock and a write-then-rename, because the lane, the foreman's calls and
  each cell's calls all write it. `logs.keepDays` bounds the logs.
- **Host identity** is the machine's own name (`COMPUTERNAME` on Windows,
  `scutil --get LocalHostName` on macOS), which a recreated T3 Code environment does not
  change. The T3 Code environment id is only how the foreman reaches a machine.

### The repository adapter

Everything Lushly hard-codes becomes configuration under `[tool.botcore.factory]` (or
`botcore.toml`), so each repository states its own contract:

| Key | AFD | Lushly (when it migrates) |
|---|---|---|
| `validate` | `pnpm verify` | `pnpm validate:final` |
| `prequeue` | The cheap stages of `pnpm check` (Biome, typecheck, portability, file size) | `scripts/merge-lane-preflight.mjs` |
| `coverage` | `pnpm check:all` | `pnpm validate:coverage` |
| `install` | `pnpm install --frozen-lockfile` | Same |
| `required_check` | A new aggregate check (see [AFD prerequisites](#afd-prerequisites)) | `ci-ok` |
| `gate_paths` | `lefthook.yml`, `.github/workflows/**`, `.github/labels.json`, `scripts/check-*.mjs`, `scripts/issue-labels.mjs`, `scripts/affected*`, `biome.json`, root `package.json`, and the adapter configuration itself | Lushly's list, plus the adapter configuration |
| `review_evidence` | The record `prepare-pr` writes for the reviewed head | `pnpm review:lanes --verify-handoff` |
| `receipt` | Optional. Confirms an existing validation of this head, so it is reused | `validate:final --verify` |
| `ui_paths` | `endpoints/loam/**`, `foundations/specimen/**`, `foundations/fast-af/**`, `site/**` | Lushly's app paths |
| `screens` | Capture changed stories and routes before and after, desktop and phone | Lushly's capture script |
| `preview` | Serve the app for a given commit | `merge-lane preview` |
| `ignore_branches` | `changeset-release/*` (the release PR is never the lane's) | Same |

The lane's own record of a validation (head, base, tree, command, result, duration) is
written for every repository, so the PR's Verification section and the report never depend
on the adapter having receipts. `REVIEW_MISSING` is decided from `review_evidence` for the
exact head, never from anything the caller passes.

### Choosing the host

- A Python plugin cannot read T3 Code's environment links or measure another machine, so
  each candidate machine runs `lane-host-probe` itself (the foreman can start it there
  through T3 Code). The probe publishes a readiness record to `refs/factory/hosts/<id>` on
  `origin`: cores, memory and free disk; whether the checkout is there and can fetch
  `origin`; the pinned toolchains; `gh` sign-in; the adapter's commands; and, on Windows,
  whether symlinks can be created (AFD keeps `.codex/skills` as a symlink).
  `lane-host-list` reads the records; anything missing is named in `missing[]`, and a
  record's age decides `reachable`.
- `lane-host-set` refuses a machine that is not ready, and refuses an immediate move while
  anything is queued or held, a cell is active or the lane runs (`LANE_BUSY`). A planned
  move uses `drain`: no new cells, and the move happens at `queue-empty`. A host that has
  gone offline is replaced with `recover`, which a person confirms: the new host rebuilds
  the queue from `refs/factory/queue/*` and the claims from GitHub, so nothing depends on
  the dead machine's disk. Moving the host is a variable change, not a code change.
- `lane-start` refuses on any other machine, under another live lane's lock, when the
  toolchains do not match the repository's pins, and when `required_check` is not a
  required check on `main`: auto-merge is safe only while it is.
- A lane host that restarts takes up where it stopped: the branch it was working on goes
  back to the front, and if its PR merged meanwhile it is landed. `lane.autostart`, on by
  default for the chosen host, registers the lane with the OS scheduler (Task Scheduler on
  Windows, launchd on macOS).

### Capacity

Lushly runs one final at a time because one final saturates the Mac mini. On a larger
host the lane validates several branches at once while still merging one at a time:

- **`lane.slots`** (default 1) is the number of validations that may run at once. Until a
  host has been measured, `suggestedSlots` is 1; after its first runs it comes from the
  measured peak memory and CPU of one `validate`. `dial-set` refuses more than the host
  can carry.
- **Merges stay serial and in queue order.** Each slot merges `origin/main` into its
  branch before validating. When a branch is ready to merge and `main` has moved since its
  validation started, the lane merges `main` in again and re-runs `validate`. `pnpm verify`
  runs only what the diff affects, so a re-run after an unrelated merge is short. Every
  re-run is logged, so the report shows what parallel validation saves and what it costs.
- **One lock per host, not per repository.** A host-wide lock with `lane.slots` seats
  covers every repository's lane on that machine.
- **Cells count against the host too.** `cell-register` refuses with `HOST_LOADED` when
  free memory is below `host.minFreeGb`, and with `CELLS_FULL` at `cells.max`, so the limits
  hold whether or not the foreman read `canStartCell` first. A cell parked for Jason frees
  its seat, so questions waiting on him never shrink the fleet.

### Cells, foreman and skills

- `prepare-pr` gains a **lane mode**: base sync, review (recording `review_evidence`),
  docs and changeset, commit, then `lane-enqueue`. It never runs the full `pnpm verify`,
  pushes or opens the PR.
- A new **`run-fleet`** skill is the foreman's procedure: start or pick up a run from
  `lane-status`, take work in `issue-check`'s dispatch order, start a cell, react to the
  events above, finish with `lane-report`. Under 500 words; the runbook holds the detail.
- Cells are T3 Code `delegate_task` children with `isolation: "worktree"`. A cell runs
  wholly on one plan; only the foreman crosses providers. Routes come from
  [model routing](../../../operations/model-routing.md).
- Starting a cell is reserve, then start: `cell-register` claims the issue and assigns the
  plan (from `canStartCell`'s `nextIssue` and `plan`), then `delegate_task` starts the cell
  on that plan, then `cell-attach` records its thread. The plan is the lane's choice, not
  the caller's, so the ceiling holds. A cell never claims.
- The foreman runs `triage-issues` at `queue-empty` and on `owner-replied`, so Jason's answers
  turn into planned work without anyone remembering to.

### Intake

Lushly's foreman dispatches only issues that triage has planned. AFD gets the same three
parts, the rules shared through the plugin:

- **`.github/labels.json`**, adapted from Lushly's `labels.yml` (JSON, so the checker
  needs no YAML dependency) and built on the labels AFD already had: `status:*`
  (`triage`, `planned`, `in-progress`, `deferred`), AFD's existing `priority:0` and
  `priority:1` as the two tiers, one `execution:*` profile (`bounded`, `integrative`,
  `deep`, `frontier`, `expert-escalation`), `risk:*`,
  `needs:decision`/`operator`/`approach`/`repro`/`ux`, `blocked`, `type:*`, and AFD's
  existing `area:*` and `lang:*` labels plus `auth`, `botcore`, `fast-af`, `local-db`,
  `loam`, `site`, `spec`, `specimen`, `umbel`, `view-state` and `violet`.
  `status:accepted`, `status:blocked`, `status:needs-info` and the old priority names are
  legacy: triage replaces them. Lushly's `runs:local` and `needs:local-validation` are
  left out until AFD has a cloud lane.
- **`scripts/issue-labels.mjs`** checks the rules (`check`), compares the file with
  GitHub (`labels`) and lists what a cell may take (`dispatch`), ahead of the plugin.
  `issue-check` will share its rules. `dispatchable` is in dispatch order:
  `priority:0`, then `priority:1`, then the rest, oldest first; it leaves out
  `execution:expert-escalation`, assigned issues, claimed issues, issues breaking a
  rule and issues an open PR would close.
- **`triage-issues`**, adapted from Lushly's: six questions in order (consequence,
  can an agent finish it now, what would catch a wrong choice, blast radius, execution
  profile, whether Jason must be in the loop; Lushly's "where it runs" waits for a cloud
  lane); writes limited to labels, an assignee and one deferral comment; a report built
  from the readback. When Jason answers a deferred question in the issue, the next triage
  pass plans it.

### Experience review

Jason does not read code; what he judges is how a change looks and behaves.

- A branch whose diff touches `ui_paths`, or whose issue carries `needs:ux`, gets
  before-and-after screens from the adapter's `screens` command after its validation passes:
  before from `main`, after from the branch, at desktop and phone widths. The images are
  files on the lane host; the PR body lists them (GitHub has no API for images in a body).
- `lane-report` lists each pair with its `before` and `after` files and writes one HTML
  `digest` per run; the foreman shows it when the run ends. `pr-preview` serves the app
  before and after one PR, merged or open, and stops by itself after `stopAfter`.
- Nothing waits on him by default. `experience.hold` makes UI PRs wait, green, as `look`
  items in `owner-queue`; `experience-accept` merges one, `experience-reject` files an issue
  with his note (or reverts it, if it already merged).

### Gate changes

As in Lushly: a merge that touches `gate_paths` triggers `coverage` on `main` at once and
is reverted if it fails. A branch ejected for a failing check may not come back with new
gate-path edits (`GATE_EDIT_IN_REPAIR`) unless its issue is labelled `area:ci` or the
foreman, after a diagnosis on the stronger route, records with `gate-allow` that the gate
edit is the right repair. There is no caller-supplied bypass.

### Releases

The lane never merges the Changesets release PR (`ignore_branches`), and publishing stays
operator work. Fleet merges carry their changesets like any other PR.

## AFD prerequisites

Things AFD and the workstation lack that the lane needs:

1. **One required aggregate check.** AFD has 20 path-filtered workflows and no single
   check that says "everything that ran passed". Add one (Lushly's `ci-ok` pattern) and
   make it required on `main`.
2. **A pre-push hook that accepts the lane's validation.** AFD's pre-push runs the full
   lint, test and typecheck. The lane may not skip hooks, so the hook must recognize the
   lane's record for the exact head being pushed.
3. **Symlinks on the workstation.** Windows Developer Mode is off, so git checks
   `.codex/skills` out as a text file and the pre-push `skills` and `tooling-tests` checks
   fail on every push from this machine (seen on 2026-11-12). Turn Developer Mode on and
   check the symlinks out again.
4. **The workstation's toolchain.** `pnpm`, `cargo` and `cmake` are not on `PATH` and
   `gh` is not signed in.
5. **GitHub over SSH on this machine.** `origin` uses the host alias
   `github.com-personal`, which does not resolve here.
6. **The shared pnpm store.** `D:\.pnpm-store` holds at least one file pnpm may not copy
   (EPERM), so installs fail until it is repaired or the lane uses its own store.

## Windows

Lushly's lane assumes macOS. The plugin must not:

- Detached start: `subprocess` with `DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP` on
  Windows and `start_new_session` on POSIX.
- Locks: an exclusive-create lock file holding the process id and start time, checked for
  liveness, instead of `flock`.
- Hand-off: a pluggable transport. The default publishes the branch to a private ref
  (`refs/factory/inbox/<id>`) on `origin` and the request beside it, which needs no SSH
  server on Windows; Lushly's SSH rename protocol remains an option.
- Paths: no shell strings; every command runs as an argument list.

## Dials

| Dial | Default | What it trades |
|---|---|---|
| `lane.slots` | 1 | Validation concurrency against re-runs when `main` moves |
| `cells.max` | 3 | Ready branches against host load and allowance |
| `cells.issuesMax` | 1 | Small PRs against fewer cells for closely related issues |
| `host.minFreeGb` | 8 | Room kept free on the host for validation |
| `lane.queueTarget` | 2 | When the foreman starts another cell |
| `lane.queueMax` | 10 | Queued branches before new ones are held |
| `plans.ceiling` | 85% | Factory use of a plan's week against Jason's own sessions |
| `fable.ceiling` | 50% | Ordinary Fable routes against keeping Fable for hard cases |
| `lane.coverageEvery` | 5 | Merges between coverage runs on `main` |
| `claims.leaseHours` | 24 | How long a silent claim holds an issue |
| `cells.maxEjections` | 3 | Repair attempts before a branch is parked or dropped |
| `experience.hold` | off | Merging UI changes at once against seeing them first |
| `lane.autostart` | on | Restarting the lane with the host |
| `logs.keepDays` | 30 | Disk against history |

The lane host itself is the `FACTORY_LANE_HOST` variable, set by `lane-host-set`.

## Measurement

Lushly's five numbers (merged PRs per hour, validations per merged PR, share of validation
time that produced a merge, stale or killed runs, plan share per merged PR), plus:
re-runs caused by `main` moving and peak memory and CPU per slot (concurrency), and foreman
wakes per merged PR (the cost of coordination). `lane-report --compare <run>` gives each
number's change, so a dial change is judged against the run before it.

## Phases

- [ ] **Phase 0: prerequisites.** Intake (the label file, `triage-issues` and `issue-check`
  ahead of the rest of the plugin), the aggregate required check, the pre-push hook that
  accepts the lane's record, and the workstation's symlinks, toolchain, SSH alias and pnpm
  store.
- [ ] **Phase 1: the plugin, one slot.** botcore's host changes (`add_policy`, input
  schemas and descriptions in the catalog, wrong-case refusals, confirmations); then
  `botcore-factory` with its two hosts and bounded output; the adapter; host probing and
  selection; the webhook wake; Windows and macOS process control; experience review; tests
  against a fixture repository. `prepare-pr` lane
  mode and `run-fleet` in AFD. Run one AFD fleet on the workstation and report the
  numbers.
- [ ] **Phase 2: concurrency.** `lane.slots` above 1, the shared host lock, the
  re-validate-on-moved-main rule; measure against Phase 1.
- [ ] **Phase 3: cells on other machines.** `lane-handoff` from the Mac mini and the
  MacBook Air, so their plans feed the workstation's lane.
- [ ] **Phase 4: Lushly moves on.** A Lushly adapter (receipts, review lanes, flake rule,
  its pre-queue check) reaches parity with `scripts/merge-lane.mjs`; Lushly's lane retires.

## Jobs

Each job is a scenario in [`scenarios/`](./scenarios/), on invented fixture data
(`scenarios/fixtures/`). All are kept. The order is the build order: the `slice` jobs are
what one AFD fleet on the workstation needs; the rest follow in the order listed.

| Order | File | Job | Tags |
|---|---|---|---|
| 1 | 14 | Triage the backlog so the foreman takes the most urgent work first | slice |
| 2 | 05 | Hand over a reviewed branch and end the turn | slice |
| 3 | 08 | Get an ejected branch back with its reason and log, and return to the front | slice |
| 4 | 01 | Run the lane where there is capacity, chosen from the connected machines | slice |
| 5 | 03 | Start a cell on the plan and host with room | slice |
| 6 | 06 | Be refused early when the cheap checks fail | slice |
| 7 | 09 | Never pass a failing check by loosening it | slice |
| 8 | 16 | See in one place what is waiting on me | slice |
| 9 | 15 | Judge a changed experience from side-by-side screens, not code | slice |
| 10 | 11 | Take back merges that broke something, and free abandoned work | slice |
| 11 | 12 | Finish a run and judge the dials against the run before | slice |
| 12 | 10 | Merge more per hour on a larger host by validating in parallel | concurrency |
| 13 | 04 | Stop starting cells when every plan is at its ceiling | |
| 14 | 07 | Never lose a finished branch while the queue is full | |
| 15 | 02 | Move the lane to another machine without stranding a branch | |
| 16 | 17 | Replace a lane host that went offline | |
| 17 | 13 | Hand over, repair and watch a branch from another machine | handoff |

### What writing and walking them changed

Writing the scenarios added `suggestedSlots` and `missing[]` to `lane-host-list`,
`LANE_BUSY` to `lane-host-set` and `nextReset` to `lane-status`.

Three readers who had not written them walked them on 2026-11-12: one as the people
(Jason, the foreman, the cells), one drafting its own job list from Jason's words before
reading, one as the calling agent against botcore's code. What changed:

- **Jobs added:** experience review (15) and the owner's queue (16). Jason's only review
  mechanism and his only interruption had no job.
- **One issue per cell** by default (`cells.issuesMax`), the root complaint about the old
  fleet; `cell-register` refuses more (`TOO_MANY_ISSUES`).
- **Nothing lost on a crash:** events stay open until answered; held branches replace
  `QUEUE_FULL` and the lane queues them itself; claims have leases; the host is a GitHub
  variable every machine reads; state is in application data, written atomically.
- **Limits enforced where they apply:** `cell-register` refuses at `cells.max`, above the
  plan ceiling and when the host is loaded; `REVIEW_MISSING` reads the evidence, not the
  caller's list; `gateRepair` is gone in favour of `gate-allow` after a diagnosis.
- **One registration per cell:** `issue-claim` folded into `cell-register`.
- **Ways back:** `lane-drop` releases claims, `lane-revert` takes several PRs and
  `lane-report` lists a run's PRs, `dial-set` returns the previous value, `event-resolve`
  records a decision with no other action.
- **The host as it is:** botcore's managed host with effects per command, confirmations
  and bounded output, snake_case names and a docs topic, instead of the meta-tool.
- **Readiness and restarts:** `lane-start` refuses without the required check or the
  pinned toolchains; readiness checks `origin`, the adapter and Windows symlinks; a
  restarted lane resumes its branch; host identity no longer depends on the T3 Code id.
- **Jobs reframed toward outcomes:** 01 (capacity), 10 (merges per hour), 11 (a merge
  that broke something), 12 (judging dials).

Declined: an `issue-release` command (`lane-drop` and lease expiry cover it) and a command
to record Jason's decisions (he answers in the issue; triage reads it).

A fourth reader walked the revision, covering all three seats and checking it against
botcore's host code. What changed:

- **Callers are separated by host, not effect.** botcore's effects are a fixed set and its
  host gates by profile, not caller; the plugin builds a `factory-cell` host for cells and
  a `factory` host for the foreman, uses existing effect names, and botcore gains
  `add_policy`.
- **The foreman is woken, never polls:** a fresh session per event through a T3 Code
  webhook, each event carrying a compact status; `cell-ended` is the foreman's to see from
  T3 Code, not a lane event.
- **A dead host can be replaced:** queued heads are pushed to `refs/factory/queue/*`;
  `lane-host-set` gains `drain` and `recover`; job 17 added.
- **Host readiness comes from the hosts:** `lane-host-probe` publishes a record per
  machine; `lane-host-list` reads them.
- **Experience review finishes:** pairs carry files, a digest page, `experience-accept`
  and `experience-reject`, `look` items, previews of open PRs that stop by themselves.
- **Questions free their seat:** `cell-park`; `owner-replied` and `queue-empty` run
  `triage-issues`; `owner-queue` marks answered items.
- **Reserve, then start:** `cell-register` before `delegate_task`, the plan assigned by the
  lane, `cell-attach` after; `canStartCell` returns `nextIssue`.
- **Repairs are bounded:** the lane counts ejections; `cells.maxEjections`.
- **No skill needed:** the catalog carries input schemas, wrong-case keys are refused with
  the right name, the scenarios use snake_case inputs, and the hand-off splits into four
  commands.
- **Confirmation modes per command:** agent acknowledgement for revert, drop and stop;
  a person only for recovering a host.
- **Smaller:** `lane-stopped` comes from the lock check, `lane.autostart` is on,
  `seatsTaken` became `cellsActive`.

Declined: an asynchronous pre-queue check. Cells call the host's CLI, which has no client
time limit, and a refusal the cell sees at once is cheaper than one it hears about after
ending its turn.

### What scenarios cannot show

The lane's loop (validation, merging, CI waits, screens) runs between commands, so jobs
08, 12, 15 and 16 start from fixture state the loop would have written. Every step runs as
the same test actor, so the effect rules (a cell refused an `operate` command) need the
plugin's unit tests. Throughput, re-run cost, host load and foreman cost need the
measurements above.

### Checks

Run 2026-11-12 after the second revision
([jobs first](../../../../.claude/skills/afd/references/jobs-first.md)): `afd scenario
validate` and the dry-run check pass all 17 files with fixtures resolved. The coverage
report uses 30 of 31 drafted commands (all but `lane-run`, kept for debugging) and 18 of 24
error codes; no scenario calls an undrafted command.

Six refusals have no scenario. Five depend on the environment, which a fixture cannot
produce: `LANE_LOCKED` (another process holds the lock), `TOOLCHAIN_MISMATCH`,
`PLANS_UNREADABLE`, `READ_FAILED` (a failed GitHub read) and `NO_PREVIEW` (an adapter with
no `preview`). The sixth, `NOT_MERGED` (reverting a PR that never merged), could be written
but is not yet. The plugin's unit tests cover all six.

## Exit criteria

- Phase 1: every scenario tagged `slice` passes against the plugin, and one AFD fleet has
  run on the workstation with its numbers reported.
- Phase 2: the `concurrency` scenarios pass and the measured re-run cost is reported.
- Phase 3: the `handoff` scenarios pass.

## Open questions

1. Should Lushly and AFD share one lane host and lock once Lushly migrates, putting both
   repositories' validation on the workstation?
