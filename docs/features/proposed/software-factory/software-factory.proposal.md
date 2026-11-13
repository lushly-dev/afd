# Software Factory: the merge lane as a botcore plugin

**Status:** Proposed, 2026-11-12; revised the same day after three independent readers
walked the jobs. Revised 2026-11-13: [the improvement loop](#the-improvement-loop) added, and
Phase 0 done. **Author:** Claude Code session with Jason.
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
| Self-improvement (2026-11-13) | A closed loop: every 12 hours at most, check the factory's health, find what is wrong, change it, and keep the change only if the next check shows it helped. Merges per hour is an indicator to explain, never a finding | [The improvement loop](#the-improvement-loop): five commands, a `health-review` event, seven jobs, guardrails so it cannot improve its numbers by changing its measures or checking less. Lushly's lane gets it first |

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
follows approval. Every refusal carries a `suggestion` naming the way forward. The
improvement loop's five commands are in [its section](#the-improvement-loop).

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
| `health-review` | A review the lane opened has something to answer | `factory-health`; answer every anomaly with `health-explain` or `improvement-propose`; `lane-revert` any experiment judged `revert`. Answered when the review closes ([the improvement loop](#the-improvement-loop)) |

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
| `measure_paths` | The plugin's records, cause map, health and judging modules and their fixed-records test, and the adapter's `review` keys and this key | Its `merge-lane` report, health and flake-rule code |
| `trend_issue` | A new issue, as `[sweep]`'s #1098 | A new Lushly issue |

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
  left out until AFD has a cloud lane. The improvement loop adds `area:factory` for the
  issues it files.
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

Things AFD and the workstation lacked that the lane needs, all done in Phase 0
(2026-11-13); the fifth was solved by moving `origin` to HTTPS through `gh`:

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
| `review.enabled` | on | The improvement loop at all |
| `review.minHours` | 12 | How often the factory checks itself, at most |
| `review.baselineDays` | 7 | A baseline that follows the factory against one that ignores a bad week |
| `review.minMerges` | 10 | Judging sooner against judging noise |
| `review.minLaneHours` | 4 | The same, for numbers per lane-hour |
| `review.maxChecks` | 4 | Reviews an experiment may stay inconclusive before it expires |
| `review.memoryDays` | 30 | How long a failed change may not be tried again |
| `review.maxBadVerdicts` | 3 | Failed experiments in a row before the loop turns itself off |
| `review.cellsMax` | 1 | Cells improving the factory against cells on the backlog |
| `review.issuesMax` | 3 | Improvement issues open at once |
| `review.dials` | `lane.slots`, `lane.queueTarget`; `cells.max` and `lane.queueMax` upward | Which dials the loop may step on its own |

The `review.*` dials are Jason's: the loop may not change them (`MEASURE_CHANGE`), and
`dial-set` on one needs a person's confirmation.

The lane host itself is the `FACTORY_LANE_HOST` variable, set by `lane-host-set`.

## Measurement

The lane writes a record for every attempt and every merge: when the branch was first
enqueued, held, validated and merged; the outcome and its cause; the plan, the route and the
issue's execution profile; the checks and tests the validation ran. `lane-report` and
`factory-health` compute everything from those records, and agents write no bookkeeping.

Numbers come in three kinds, because some measure the factory and some measure the work it
was given:

- **Findings** are the factory's own cost and quality. They should not move with how hard
  the work is, so a lasting change beyond their normal range is the factory's problem.
- **Indicators** describe the work: throughput, cycle time from claim to merge, plan share
  per merge. A day of three deep issues is slower, and that is not a regression. An indicator
  never starts a change, and throughput is judged only after adjusting for the work mix: each
  merge counts its profile's baseline cycle minutes (a `deep` merge weighs as much as several
  `bounded` ones), and `adjustedThroughput` is the window's weighted minutes per lane-hour over
  the baseline's. Raw merges per lane-hour is reported, never judged. What the mix does not
  account for is flagged, and asks for an explanation, not a fix.
- **Guards and reports** are never targets. `checksRun` must not fall, so no change wins by
  checking less; `ownerWaitHours` is Jason's response time, reported but not judged, since the
  loop cannot change it.

Every finding is also paired with `checksRun`, the guard, so no change wins by checking less.

| Metric | Kind | Better | Unit and source | Spread floor | Paired: must not get worse |
|---|---|---|---|---|---|
| `queueWaitMinutes` | finding | down | Per merge, from the first `lane-enqueue` to validation; held time counts, except time held for Jason | 2 | `mainMovedRerunsPerMerge`, `revertsPerMerge`, `adjustedThroughput` |
| `validationMinutesPerMerge` | finding | down | Per merge | 2 | `revertsPerMerge`, `mainBroken` |
| `validationsPerMerge` | finding | down | Per merge | 0.1 | `revertsPerMerge` |
| `flakyRerunsPerMerge` | finding | down | Per merge; a retry inside `validate` counts | 0.1 | `validationMinutesPerMerge` |
| `mainMovedRerunsPerMerge` | finding | down | Per merge | 0.1 | `queueWaitMinutes` |
| `toolingEjectionsPerMerge` | finding | down | Per merge, ejections the cause map assigns to the factory or the repository's tooling | 0.1 | `validationMinutesPerMerge` |
| `idleSeatHours` | finding | down | Per lane-hour: seats empty while dispatchable work waited | 0.1 | `mainMovedRerunsPerMerge`, `revertsPerMerge` |
| `idleWakesPerMerge` | finding | down | Per merge: foreman wakes that ended with no action | 0.1 | — |
| `revertsPerMerge`, `experiencesRejected` | finding | down | Per merge | 0.1 | — |
| `mainBroken` | finding | down | Per lane-hour | 0.1 | — |
| `checksRun` | guard | not down | Checks and tests per validation | 5% of the median | — |
| `adjustedThroughput` | indicator | up | Weighted minutes per lane-hour over the baseline's (above) | 0.1 | — |
| `cycleMinutes` | indicator | down | Claim to merge, per execution profile | 10% of the median | — |
| `planSharePerMerge` | indicator | down | Per merge | 0.1 | — |
| `mergedPerLaneHour`, `ownerWaitHours` | report | — | Raw throughput; hours items waited in `owner-queue` | — | — |

"Lane-hours" are hours the lane ran, not clock hours. A per-merge floor of 0.1 is one event
in `review.minMerges` merges, so a single event never decides anything; a `main-broken` is
handled at once anyway. Concurrency adds peak memory and CPU per slot. `lane-report --compare
<run>` gives each number's change between two runs.

## The improvement loop

Jason's direction of 2026-11-13: the factory checks its own health on a schedule, finds
what is wrong, proposes a change, makes it, and judges it at the next check. A loop that
changes itself can make itself worse while reporting progress, so most of this section is
about how a change proves it helped and how one that did not is undone.

### When it runs

The lane opens a review at the end of a run and, in a longer run, every `review.minHours`
(12), never more often. A lane restart that hands over to new lane code does not end a run.
A review due while one is still open folds its window into it; one left open past the next
due time is raised to Jason as a `loop` item in `owner-queue`, so a stalled loop is never
silent. When the lane opens a review it does every deterministic part itself, before waking
anyone: it computes the window and its anomalies, judges the experiments that have come due
and restores the dials of those it reverts. `factory-health` then only reads the review, and
the `health-review` event wakes a fresh foreman session only if something needs an answer.

### The rules

- **Baseline.** Each metric's values over the reviews of the last `review.baselineDays` (7):
  their median, and their spread as the median absolute deviation scaled to a standard
  deviation (`1.4826 × MAD`), never below the metric's floor.
- **Enough data.** A per-merge metric needs `review.minMerges` (10) merges in the window; a
  per-lane-hour metric needs `review.minLaneHours` (4). Below that it is `insufficient`, and
  time-based findings are still judged, so a lane that merged little while work waited is a
  finding, not silence (job 23).
- **Anomaly.** A value strictly beyond `median ± 2 × spread` in the worse direction. A number
  seen there once is `watching` and needs no answer; it becomes an anomaly to answer only when
  it persists into the next review. This holds for findings and indicators alike. Persistence
  keeps the loop from treating one unusual window as a level, and from claiming credit when
  such a window returns to normal by itself.
- **Indicators.** Throughput is judged on `adjustedThroughput` only. A window whose raw
  throughput fell but whose adjusted throughput is normal is recorded as `work-mix` with the
  per-profile numbers, and the review closes without anyone being woken (job 19).
- **Evidence.** Each anomaly carries what a diagnosis needs: the records that moved it most,
  their causes and `logPath`s, the window's and the baseline's mix and per-profile values, and
  for capacity metrics the slots' occupancy and `suggestedSlots`.

### Answering a review

Every anomaly in `review.unanswered` gets one answer:

- `improvement-propose`, for a finding the factory can change (below);
- `health-explain` with a `cause`: `work-mix`, `outside` (a GitHub outage, a plan reset,
  naming the event), `follows` (it follows from another anomaly, named in `refs`), or `watch`
  (not understood yet: carry it to the next review). A finding explained as `outside` in three
  reviews in a row goes to Jason as a `decision` item.

Owed reverts are answers too: a code change judged `revert` stays in `unanswered` until the
foreman's `lane-revert` of its PRs. When nothing is unanswered the review closes. The lane comments on
the repository's trend issue (`trend_issue`, as the bloat sweep does on #1098) only when an
experiment started or was judged or something went to Jason, and posts one roll-up a week.
Quiet reviews stay in `factory-health`'s history.

### Experiments

`improvement-propose` takes the anomaly and a change, and the lane fills in the rest: the
direction comes from the metric, the paired metrics from its table row, and the `before`
from the windows the anomaly persisted over, frozen. The change is one of:

- **A dial, one step**: `{ kind: dial, key, step: up | down }`, applied at once by the lane.
  Only `review.dials` may be stepped: `lane.slots` (up to `suggestedSlots`), `lane.queueTarget`
  and, upward only, `cells.max` and `lane.queueMax`. Lowering capacity, `lane.coverageEvery`
  (it decides how often `main-broken` can be seen) and Jason's dials (`plans.ceiling`,
  `fable.ceiling`, `experience.hold`) are refused with `DIAL_NOT_DELEGATED`; the lane files the
  question in `owner-queue` itself, once per dial and direction, and remembers his answer.
- **An issue**: `{ kind: issue, title, body_file }`, filed with `area:factory` and
  `status:triage`, the hypothesis and the experiment in its body. Triage plans it and a cell
  builds it through the lane like any other work, so the factory improves itself with its own
  process and behind its own gates. The experiment starts when its PR merges and expires if
  it has not after `review.maxChecks` reviews.

Refused, checked in this order: a change to the loop's own measures (`MEASURE_CHANGE`); one of
Jason's dials (`DIAL_NOT_DELEGATED`); a metric that is not an unanswered finding in the open
review (`NOT_ANOMALY`); the same change for the same metric reverted or expired in the last
`review.memoryDays` (30) (`ALREADY_TRIED`); a second dial experiment, or one that overlaps an
open experiment (`EXPERIMENT_OPEN`, naming it); and beyond the budget (`IMPROVEMENT_BUDGET`).
Two experiments overlap when either one's metric is the other's metric or one of its paired
metrics; the guard, `checksRun`, is paired with everything and does not count.

**Verdicts**, made by the lane at the first review with `review.minMerges` merges since the
change:

Here "better" and "worse" are measured against the frozen `before` for the metric, in units
of its baseline spread, and against each paired metric's own baseline for the pairs.

- **kept**: the metric is better by more than `2 × spread`, no paired metric is worse by
  more than `2 × spread`, and `checksRun` did not fall. The metric's baseline then restarts
  from the change, so the new level is the new normal.
- **trade-off**: the metric is better by more than `2 × spread` but a paired metric is worse
  by more than that. A dial is restored and a code change is held as it is; either way Jason
  gets a `decision` showing both numbers, since a trade is his to make.
- **reverted**: a dial whose metric is worse by more than `1 × spread`. The lane restores the
  previous value itself.
- **revert**: a code change whose metric is worse by more than `1 × spread`. The foreman
  reverts its PRs with `lane-revert`.
- **inconclusive**: anything else: too few merges, a change within the band, or
  `confounded` because a merge touching `gate_paths` or an overlapping factory change landed
  in its window. It carries to the next review.
- **expired**: inconclusive for `review.maxChecks` (4) reviews. A dial is restored; a code
  change goes to Jason as a `decision` (keep or revert), because reverting a sound fix as
  "unproven" only churns.

Verdicts in one review are taken in the order the changes were made.

### Guardrails

- **It never changes how it is measured.** The loop's settings (`review.*`), the records,
  the cause map, the flake rule, the computation, the judging, the adapter's `measure_paths`
  key and a fixed-records test that recomputes every number are `measure_paths`. A branch
  that edits them is held (`holdReason: measure-change`) as an `approve` item in
  `owner-queue`. The item shows Jason the last `review.baselineDays` of numbers computed with
  the old code and the new, so he judges an effect, not code. `measure-approve`, which a
  person confirms, releases it; experiments on the affected metrics end inconclusive and
  their baselines restart. Held branches are not queued by `queue-room`.
- **It never improves by checking less.** An `area:factory` branch that touches `gate_paths`,
  or whose validation runs fewer checks than `main`'s, or that deletes or skips a test, is
  held the same way (`holdReason: gate-change`), its item saying in plain words what it stops
  checking. Adding tests holds nothing. Every experiment is paired with `checksRun`.
- **One dial at a time, and no overlap**, so every change can be told apart from the others.
- **A budget.** At most `review.cellsMax` (1) cells work on the factory at once and at most
  `review.issuesMax` (3) improvement issues are open; `issue-check` and `canStartCell` skip
  `area:factory` issues while the budget is full, so they never block the backlog.
- **It stops on harm.** A `main-broken`, or a `lane-revert` that no verdict owed, while an
  experiment is running ends the experiments whose change preceded it: dials are restored at
  once, code is judged `revert`, and the event names the experiments it ended. Counting
  `reverted`, `revert` and `expired` verdicts in the order they were made, after
  `review.maxBadVerdicts` (3) in a row without a `kept` the lane turns the loop off
  (`review.enabled`) and leaves Jason one `loop` item saying what failed and that the break
  itself may have had another cause (job 24).
- **It can be turned off.** With `review.enabled` off, no review opens, running experiments
  end as `stopped` with the dials they set listed (left as they are, for Jason to keep or
  reset), and held branches stay held. Turning it on needs a person's confirmation.
- **It judges itself.** `factory-health`'s `loop` and the weekly roll-up compare every finding
  with a baseline frozen before the loop's first change, and count kept, reverted and expired
  verdicts, the harm it caused (reverts, `main-broken`) and its own cost (review sessions and
  their plan share). Jason reads in one place whether the loop is earning its keep.

### Commands

| Command | Input | Result `data` | Refusals |
|---|---|---|---|
| `factory-health` | `review?` (default the latest) | `review { id, state, unanswered[], note?, trendComment? }`; `window { from, to, merges, laneHours, byProfile }`; `metrics { <key>: { kind, value, baseline { median, spread }, state } }` with `state` one of `normal`, `watching`, `high`, `low`, `insufficient`; `anomalies[] { metric, kind, state, persisted, evidence }`; `verdicts { <experiment>: { verdict, because, restored?, prs? } }`; `loop { enabled, sinceStart { <finding>: change }, kept, reverted, expired, harm, reviews, planShare }`. A read: the lane computed it | `NOT_FOUND` |
| `health-explain` | `review`, `metric`, `cause` (`work-mix`, `outside`, `follows`, `watch`), `note`, `refs?` | `review { state, unanswered[], trendComment? }` | `NOT_FOUND`, `NOT_ANOMALY` |
| `improvement-propose` | `review`, `metric`, `hypothesis`, `change` | `experiment { id, state, before, paired[] }`; for a dial `applied { key, value, previous }`; for an issue `issue { number, labels }`; `review { state, unanswered[], trendComment? }` | `NOT_ANOMALY`, `MEASURE_CHANGE`, `DIAL_NOT_DELEGATED`, `EXPERIMENT_OPEN`, `ALREADY_TRIED`, `IMPROVEMENT_BUDGET`, `DIAL_OUT_OF_RANGE` |
| `improvement-list` | `state?` (`proposed`, `running`, `kept`, `trade-off`, `reverted`, `expired`, `stopped`), `limit?`, `cursor?` | `experiments[] { id, metric, change, state, before, after, checks, verdict? }` | — |
| `measure-approve` | `branch`, `reason` | `approved`, `state`: a branch held for `measure-change` or `gate-change` joins the queue. A person confirms | `NOT_FOUND` |

`factory-health` and `improvement-list` are reads (`inspect`); the others write state
(`history-write`), and `improvement-propose` also writes to GitHub (`service`).
`lane-enqueue`'s result gains `holdReason`, `owner-queue`'s kinds gain `approve` and `loop`,
`cell-register` gains `IMPROVEMENT_BUDGET`, and `main-broken` carries `endedExperiments`.

### Lushly's lane first

Lushly has run its lane since 2026-11-11, so it can judge on real numbers now, while AFD's
lane will need a week of runs after Phase 2 for a baseline. The loop goes into Lushly's
`scripts/merge-lane*.mjs` first, and the plugin ports rules that have been judged. The rules
(baseline, anomaly, verdict) are small and pure and written to port; the records and commands
are each lane's own.

What Lushly already has: its `report` computes merges per hour, finals per merge, the share
of final time that merged, killed and outside-stale runs and per-route ejections; its issues
carry the same execution profiles (`frontier` included); its dials are re-read at each step
from `~/.config/lushly/factory.json`.

What it has to add:

- **Records it does not keep yet.** The issue's execution profile on `merged`; when a cell
  started (no event records it, and merged cells leave `state.json`), so cycle time can be
  computed; flakes as events (today they are only in receipts); foreman wakes; idle seats
  while work waited; time items waited on Jason; plan use per merge (it is read only at a
  run's start and stop).
- **Its own definitions.** `flakyRerunsPerMerge` is finals with a recorded flake
  (`passed-with-flake`, the flake rule's single re-run of at most two tests) per merge; a
  flake-cap failure is a tooling ejection. Review lanes run in the cell, not the lane, so
  they are not measured. The cause map uses Lushly's names: `lane-error`, `main-suspect`,
  `merged-without-ci-ok` and `lane-stopped-unexpectedly` are the factory's; `stale-external`
  is not; `install-failed`, `pr-closing-issues`, `pr-closed`, `pr-head-changed` and the
  retired `ci-timeout` are classified one by one. Merges made outside the lane are left out.
- **Its own commands**: `merge-lane health`, `explain`, `improve`, `experiments` and
  `approve`; `health-review` through `wait` and `foreman.webhook`. `wait` marks an event seen
  when read, so an open review stays visible in `health`, not only in the event. A handover
  restart (`run-stopped` with `handover: true`) does not end a run.
- **A measure hold it does not have.** Lushly's lane has no held state and no owner queue,
  and its gate paths merge with no one holding them. So `enqueue` refuses a branch that
  touches the measure paths, or an `area:factory` branch touching gate paths or tests, until
  `merge-lane approve <branch>` records Jason's approval. That matters more there, because the
  lane restarts itself onto merged lane code.
- **Its dials and records in a place that lasts**: the experiments and baselines in a data
  directory, not `~/.cache/lushly/merge-lane/`; the delegated dials without `lane.slots`,
  which Lushly does not have; a trend issue in Lushly.

## Phases

- [x] **Phase 0: prerequisites.** Done 2026-11-13. Intake: the label file, `issue-labels.mjs`
  and `triage-issues` (#1100), with the backlog triaged. `ci-ok`, one verdict for every pull
  request (#1123), required on `main`, with the release pull request opened by the release
  App so it gets one (#1136). Pre-push accepts a `pnpm verify` record for the exact commit
  pushed (#1127). The workstation: Developer Mode and symlinks, pnpm, Python through uv, `gh`
  signed in, a pnpm store it owns, `origin` over HTTPS through `gh` instead of the SSH alias;
  and the tooling, alfred and workspace tests passing on Windows (#1115, #1121, #1130, #1134),
  so the full pre-push hook runs there with nothing skipped.
- [ ] **Phase 1: the plugin, one slot.** botcore's host changes (`add_policy`, input
  schemas and descriptions in the catalog, wrong-case refusals, confirmations); then
  `botcore-factory` with its two hosts and bounded output; the adapter; host probing and
  selection; the webhook wake; Windows and macOS process control; experience review; tests
  against a fixture repository. `prepare-pr` lane
  mode and `run-fleet` in AFD. Run one AFD fleet on the workstation and report the
  numbers. The lane records every number [Measurement](#measurement) names from its first
  run, so the improvement loop has a baseline when it arrives.
- [ ] **Phase 2: concurrency.** `lane.slots` above 1, the shared host lock, the
  re-validate-on-moved-main rule; measure against Phase 1.
- [ ] **Phase 3: cells on other machines.** `lane-handoff` from the Mac mini and the
  MacBook Air, so their plans feed the workstation's lane.
- [ ] **Phase 4: Lushly moves on.** A Lushly adapter (receipts, review lanes, flake rule,
  its pre-queue check) reaches parity with `scripts/merge-lane.mjs`; Lushly's lane retires.
- [ ] **Phase 5: the improvement loop.** First in Lushly's lane, which has the history to
  judge on now; then in the plugin, once AFD's lane has a week of runs after Phase 2. It can
  run beside Phases 3 and 4.

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
| 18 | 23 | Stay quiet when there is too little to judge | improvement |
| 19 | 19 | Treat a hard day as a hard day | improvement |
| 20 | 18 | Spot a real regression in the factory's own overhead | improvement |
| 21 | 21 | Never improve the numbers by changing how they are measured or checking less | improvement |
| 22 | 20 | Keep a change only if it helped | improvement |
| 23 | 24 | Stop when the loop does harm | improvement |
| 24 | 22 | Turn a finding into work the factory does on itself, within a budget | improvement |

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

The improvement loop's jobs (18 to 24) were written on 2026-11-13 and walked the same day by
two readers who had not written them: one as Jason and the foreman, drafting its own job list
from Jason's words before reading; one as the calling agent with only the catalog, checking
the rules and the Lushly section against Lushly's runbook. What changed:

- **No credit for chance.** A finding is acted on only when it persists into a second review;
  an experiment is judged against a `before` frozen over those windows; the baseline restarts
  at a kept change. One unusual window returning to normal was being scored as a kept change.
- **The rules are specified:** a table of every metric's kind, direction, unit and paired
  metrics; spread as scaled MAD with a floor; anomalies only in the worse direction; per
  lane-hour numbers judged on few merges; an `expired` verdict, and expired code going to
  Jason instead of being reverted.
- **Indicators are adjusted for the work mix** by the lane, so a hard day closes its review
  without waking anyone (job 19, reframed from "explain a slow day").
- **More ways it could look better without being better are closed:** `checksRun` paired with
  everything; `area:factory` branches touching gates or tests held like measure changes;
  queue wait counted from the first enqueue; `lane.coverageEvery` and capacity cuts taken from
  the delegated dials; one dial experiment at a time and no overlapping metrics; `NOT_ANOMALY`
  and `ALREADY_TRIED`.
- **It stops on harm and can be turned off** (job 24): a `main-broken` or revert ends the
  experiments before it at once, and three failed verdicts in a row turn the loop off.
- **The lane does the deterministic work:** it computes the review, judges the experiments and
  restores dials when it opens a review; `factory-health` is a read; a dial change is a step,
  not a value; the event wakes the foreman only when something needs an answer.
- **The foreman can diagnose:** anomalies carry their evidence; `health-explain` takes a
  structured cause (`work-mix`, `outside`, `follows`, `watch`), not prose.
- **Fewer interruptions:** the trend issue gets a comment only when something happened, and a
  weekly roll-up; a stalled review or a repeated "outside" becomes one item for Jason.
- **Lushly's section corrected:** the records it lacks (profile on `merged`, cell start,
  flakes as events, foreman wakes, idle seats, plan use per merge), its own cause names and
  flake definition, no review-lane measures, a refusal in place of a hold it does not have, and
  state outside its cache directory.

Declined: switching a kept dial off for one window as a control. Persistence and the frozen
`before` answer most of what it would, at a cost of a deliberately worse window each time;
it can be added if the loop's own score shows kept changes fading.

A third reader walked that revision in all three seats and recomputed every expected value
from the stated rules and the fixtures. What changed:

- **Experiments stop confounding each other:** only an overlapping factory change or a merge
  touching `gate_paths` confounds; overlap is defined, with the guard left out; refusals are
  checked in a stated order; `checksRun` is paired with every finding.
- **The loop's own work is not harm:** a revert a verdict owes does not end experiments, and
  the bad-verdict count is `reverted`, `revert` and `expired`, in the order changes were made.
- **Noise cannot drive it:** persistence always, indicators included, with the one-window
  exception gone; spread floors stated; a paired metric fails only past `2 × spread`; an
  improved metric with a worse pair is a `trade-off` for Jason, not a failure; every case has a
  verdict.
- **Throughput has an exact formula** (profile-weighted minutes per lane-hour), and raw merges
  per lane-hour is reported only.
- **Jason is asked less and told more:** a factory branch is held only when it checks less,
  not for adding tests; his own response time is left out of queue wait; `factory-health`
  carries the loop's comparison with its pre-loop baseline; Phase 5's exit is four roll-ups.
- **The fixtures share one timeline** (exp-1 to exp-9, 2030-01-09 to 01-25), each loaded
  through the lane's review-open step, and every expected value follows from the rules.

### What scenarios cannot show

The lane's loop (validation, merging, CI waits, screens) runs between commands, so jobs
08, 12, 15 and 16 start from fixture state the loop would have written, and the improvement
jobs (18 to 24) from the review the lane computed when it opened it. Every step runs as
the same test actor, so the effect rules (a cell refused an `operate` command) need the
plugin's unit tests. Throughput, re-run cost, host load and foreman cost need the
measurements above. Whether the loop's thresholds separate a real regression from noise, and
whether the changes it keeps are real, needs weeks of reviews: the loop's own score on the
trend issue is that measure.

### Checks

Run 2026-11-13 after the loop's revision
([jobs first](../../../../.claude/skills/afd/references/jobs-first.md)): `afd scenario
validate` and the dry-run check pass all 24 files with fixtures resolved. The coverage
report uses 35 of 36 drafted commands (all but `lane-run`, kept for debugging) and 24 of 30
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
- Phase 5: the `improvement` scenarios pass, and on a real lane four weekly roll-ups show the
  loop's verdicts, its harm and its cost, with the kept changes still holding against the
  baseline frozen before the loop began.

## Open questions

1. Should Lushly and AFD share one lane host and lock once Lushly migrates, putting both
   repositories' validation on the workstation?
