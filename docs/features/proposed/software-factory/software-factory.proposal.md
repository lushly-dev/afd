# Software Factory: the merge lane as a botcore plugin

**Status:** Proposed, 2026-11-12. **Author:** Claude Code session with Jason.
**Origin:** Lushly's [software factory plan](https://github.com/lushly-dev/lushly/blob/main/Docs/features/active/software-factory.plan.md)
(fleet v2, Lushly #2164 and #2187) and its
[merge lane runbook](https://github.com/lushly-dev/lushly/blob/main/Docs/operations/merge-lane.md).
This is that plan's Phase 6 ("generalize"), brought forward so AFD can run a fleet.
**Replaces:** nothing in AFD. AFD has never had a fleet skill; the closest thing,
`manage-projects/references/wave-orchestration.md`, was retired in #757.

## Decisions

Jason's answers of 2026-11-12.

| Question | Decision | What it changes |
|---|---|---|
| Where the lane lives | A botcore plugin, shared by every lushly-dev repository | One implementation in Python as AFD commands; each repository supplies an adapter. Lushly moves onto it once it matches Lushly's lane |
| Lane host | Chosen from the connected machines, never hard-coded. AFD's first host is the Windows workstation | Host identity, process control, locks and hand-off must work on Windows and macOS |
| Capacity | The workstation (Ryzen 9 7950X3D, 16 cores / 32 threads, 64 GB) has far more room than the Mac mini (M4, 10 cores, 24 GB) | Validation concurrency is a dial sized per host, not Lushly's fixed "one final at a time" |
| Jobs | Keep every job; the build order is left to the implementer | The order in [Jobs](#jobs) is the build order |
| Intake | AFD needs Lushly's triage | An AFD `do-triage` skill, a label file and the label and claim checks in the plugin ([Intake](#intake)) |

## Goal

Turn AFD's backlog into merged, correct PRs with the least process and no routine work
for Jason, using the shape Lushly has been running since 2026-11-11: cells implement, one
lane validates and merges, a stateless foreman starts cells and reacts to events.

## What carries over unchanged from Lushly

- **Three parts.** A *cell* is one agent with one work package in its own worktree; it
  implements, gets its review, commits, enqueues and ends its turn. The *lane* is a
  script, the only thing that validates a fleet branch, pushes, opens the PR and merges.
  The *foreman* forms packages, picks each cell's plan and route, starts cells, resumes an
  ejected cell and asks Jason for decisions. It keeps no state; state is `lane-status`.
- **Agents never wait on a deterministic step.** A cell ends its turn after enqueueing and
  is resumed only if its branch is ejected.
- **Ejection, not repair.** A failing branch goes back to its cell with its log and
  receipt. The lane never resolves conflicts or edits code. The lane's own trouble
  (network, sign-in, a killed run) is a `lane-error` that pauses the lane and ejects nothing.
- **Allocation by plan room.** Start each cell on the plan with the most room (share of
  the weekly window elapsed minus share used), skipping plans above `plans.ceiling`.
- **Control points.** Jason is asked only for product decisions (`needs:decision`) and
  operator work: production, paid providers, secrets and sign-ins. Gate and CI changes
  merge like any other diff, behind the protections in [Gate changes](#gate-changes).
- **No bureaucracy.** No status narration, checkpoints written by agents, phase approvals,
  attempt counts or coordinators that re-review a cell's work.

## Design

```
Intake ──► Cells ──► Queue ──► Lane (on the chosen host) ──► main ──► coverage
(issues)   (agents)  (state     validate in N slots, merge in order,
                      file)     push, PR, required check, squash-merge, clean up
               ▲                          │
               └──── ejected with log ────┘
       Foreman: one agent, woken by a cell ending, a lane event, an empty queue or Jason
```

### The plugin

`endpoints/botcore/plugins/botcore-factory`, entry point `factory`, built like
`botcore-agents`: `BotCorePlugin`, AFD commands returning `CommandResult`, exposed through
botcore's CLI namespace and MCP server. The draft below is enough to write the
[jobs](#jobs) against; the exact specification follows approval.

| Command | Input | Result `data` | Refusals |
|---|---|---|---|
| `lane-status` | — | `host { id, isLaneHost }`, `running`, `paused`, `slots { total, busy }`, `queue[]`, `cells[]`, `dials`, `canStartCell`, `plan` (the one with most room) or `reason` and `nextReset` | — |
| `lane-start`, `lane-stop` | — | `running` | `HOST_NOT_SET`, `NOT_LANE_HOST` |
| `lane-run` | — | Runs the loop in the foreground; for debugging the lane itself, so no job uses it | As `lane-start` |
| `lane-host-list` | — | `machines[] { id, name, reachable, cores, memoryGb, ready, missing[], suggestedSlots }` | — |
| `lane-host-set` | `id` | `host` | `HOST_NOT_READY`, `LANE_BUSY`, `NOT_FOUND` |
| `cell-register` | `branch`, `issues[]`, `thread`, `plan`, `route` | `cell` | `ALREADY_EXISTS` |
| `lane-enqueue` | `branch`, `title`, `bodyFile`, `reviewers[]`, `issues[]`, `gateRepair?` | `position`, `head`, `prequeue { stages[] }` | `DIRTY_WORKTREE`, `REVIEW_MISSING`, `PREQUEUE_FAILED`, `QUEUE_FULL`, `GATE_EDIT_IN_REPAIR` |
| `lane-handoff` | As `lane-enqueue`, or `status: true` | As `lane-enqueue`; with `status`, `queue[]`, `seatsTaken`, `cells[]` of this machine | As `lane-enqueue` |
| `lane-wait` | `timeoutMs?` | `event { type, branch, reason, detail, logPath }` or `{ type: timeout }` | — |
| `lane-pause`, `lane-resume` | `reason?` | `paused` | — |
| `lane-drop` | `branch` | `dropped` | `NOT_FOUND` |
| `lane-revert` | `pr`, `reason` | `revertPr` | `NOT_FOUND` |
| `plan-list` | — | `plans[] { id, provider, used, elapsed, room, aboveCeiling }` | — |
| `dial-get`, `dial-set` | `key`, `value` | `key`, `value`, `default` | `DIAL_OUT_OF_RANGE`, `NOT_FOUND` |
| `lane-report` | `run?` | `mergedPerHour`, `validationsPerMerge`, `productiveShare`, `staleRuns`, `reruns`, `byPlan[]`, `byRoute[]` | — |
| `issue-check` | `numbers?`, `labels?` | `untriaged[]`, `violations[] { number, rule }`, `dispatchable[]` (planned, one execution label, no claim or open PR) | `READ_FAILED` (never reported as "nothing to do") |
| `issue-claim` | `number`, `branch` | `claim { number, branch, since }` | `ALREADY_CLAIMED`, `NOT_DISPATCHABLE` |

Every refusal carries a `suggestion` naming the way forward.

State, the event log and attempt logs live in a per-user cache directory
(`platformdirs`), keyed by repository, so one host can serve several repositories.

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
| `gate_paths` | `lefthook.yml`, `.github/workflows/**`, `scripts/check-*.mjs`, `scripts/affected*`, `biome.json`, root `package.json` | Lushly's list |
| `review_evidence` | The reviewer and head recorded by `do-prepare-pr` | `pnpm review:lanes --verify-handoff` |
| `receipt` | Optional. A command that confirms an existing validation of this head, so it is reused | `validate:final --verify` |

The lane's own record of a validation (head, base, tree, command, result, duration) is
written for every repository, so the PR's Verification section and the report do not
depend on the adapter having receipts.

### Choosing the host

- `lane.host` is a dial naming a machine by a stable id: the T3 Code environment id
  where there is one, otherwise the machine's own name (`COMPUTERNAME` on Windows,
  `scutil --get LocalHostName` on macOS). It has no default; `lane-start` refuses until it
  is set, and refuses on any other machine.
- `lane-host-list` reads the connected machines from T3 Code's environment links and
  reports, for each, whether it answers, its cores and memory, free disk, and whether the
  repository's pinned toolchains, `gh` sign-in and the repository checkout are present.
- `lane-host-set <id>` takes effect only with an empty queue and no running lane, so a
  move never strands a branch. The foreman on another machine delegates to the lane host
  through T3 Code as Lushly's does, and cells elsewhere use `lane-handoff`.
- AFD's first host is this workstation. Moving it is a dial change, not a code change.

### Concurrency

Lushly runs one final at a time because one final saturates the Mac mini. On a larger
host the lane can validate several branches at once while still merging one at a time:

- **`lane.slots`** (default 1) is the number of validations that may run at once.
  `lane-host-list` suggests a value from the host's cores and memory and the measured
  peak of one `validate` run; the first runs on the workstation measure it.
- **Merges stay serial and in queue order.** Each slot merges `origin/main` into its
  branch before validating. When a branch is ready to merge and `main` has moved since
  its validation started, the lane merges `main` in again and re-runs `validate`. Because
  `pnpm verify` runs only what the diff affects, a re-run after an unrelated merge is
  short. The lane logs every re-run, so the report shows what parallel validation saves
  and what it wastes.
- **One lock per host, not per repository.** A host-wide lock with `lane.slots` seats
  covers every repository's lane, so two lanes on one machine share its capacity instead
  of competing for it.
- **`cells.max`** scales with the host as well: more slots need more ready branches.

### Cells, foreman and skills

- `do-prepare-pr` gains a **lane mode**: base sync, review, docs and changeset, commit,
  then `lane-enqueue`. It never runs `pnpm verify`'s full pass, pushes or opens the PR.
- A new **`do-run-fleet`** skill is the foreman's procedure, adapted from Lushly's: start
  or pick up a run, pick work, start a cell, wake only for judgment (the same event table),
  finish with `lane-report`. Under 500 words; the runbook holds the detail.
- Cells are T3 Code `delegate_task` children with `isolation: "worktree"`. A cell runs
  wholly on one plan; only the foreman crosses providers. Routes come from
  [model routing](../../../operations/model-routing.md).
- A cell claims its issues with `issue-claim`; the foreman never claims, and skips
  anything `issue-check` does not list as dispatchable.

### Intake

Lushly's foreman dispatches only issues that triage has planned. AFD gets the same three
parts, the rules shared through the plugin:

- **`.github/labels.yml`**, adapted from Lushly's: `status:*` (`triage`, `planned`,
  `in-progress`, `deferred`, `blocked`), `priority:p0`/`p1`, one `execution:*` profile
  (`bounded`, `integrative`, `deep`, `frontier`, `expert-escalation`), `risk:*`,
  `needs:decision`/`operator`/`approach`/`repro`/`ux`, `type:*`, and `area:*` for AFD's
  units (`core`, `server`, `client`, `cli`, `testing`, `auth`, `adapters`, `view-state`,
  `local-db`, `python`, `rust`, `cpp`, `spec`, `botcore`, `umbel`, `loam`, `specimen`,
  `violet`, `fast-af`, `site`, `ci`, `docs`). Lushly's `runs:local` and
  `needs:local-validation` are left out until AFD has a cloud lane.
- **`issue-check` and `issue-claim`** in the plugin, reading the label file's rules, so
  both repositories run the same checks. A failed read is an error, never "0 untriaged".
- **`do-triage`**, adapted from Lushly's: the seven questions in order (consequence,
  can an agent finish it now, where it runs, what would catch a wrong choice, blast
  radius, execution profile, whether Jason must be in the loop), writes limited to labels,
  an assignee and one deferral comment, and a report built from the readback.

### Gate changes

As in Lushly: a merge that touches `gate_paths` triggers the `coverage` command on `main`
at once and is reverted if it fails; a branch ejected for a failing check may not return
with new gate-path edits unless its issue is a CI issue; such a branch gets a Fable `high`
diagnosis instead of going to Jason.

## AFD prerequisites

Things AFD lacks that the lane needs. Each is ordinary work for the factory's first run,
except the first two, which the lane cannot run without.

1. **One required aggregate check.** AFD has 20 path-filtered workflows and no single
   check that says "everything that ran passed". Auto-merge bound to a head is safe only
   when such a check is required on `main`. Add one (Lushly's `ci-ok` pattern) and make it
   required.
2. **A pre-push hook that accepts the lane's validation.** AFD's pre-push runs the full
   lint, test and typecheck. The lane may not skip hooks, so the hook must recognize the
   lane's record for the exact head being pushed and skip work already done.
3. **The workstation's toolchain.** `pnpm`, `cargo` and `cmake` are not on `PATH` and
   `gh` is not signed in. `pnpm verify` needs every toolchain its affected suites use, and
   the lane needs `gh`. `lane-host-list` reports these as not ready.
4. **GitHub access over SSH on this machine.** `origin` uses the host alias
   `github.com-personal`, which does not resolve here, so `git fetch` fails. Add the alias
   to `~/.ssh/config` or switch the lane's remote.

## Windows

Lushly's lane assumes macOS. The plugin must not:

- Detached start: `subprocess` with `DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP` on
  Windows and `start_new_session` on POSIX.
- Locks: an exclusive-create lock file holding the process id and start time, checked for
  liveness, instead of `flock`.
- Hand-off: Windows OpenSSH server with the same `mkdir`/`mv` rename protocol, built only
  from generated ids. If that proves fragile, a pluggable transport that publishes the
  bundle to a private ref (`refs/factory/inbox/<id>`) on `origin`.
- Paths: no shell strings; every command runs as an argument list.

## Dials

| Dial | Default | What it trades |
|---|---|---|
| `lane.host` | unset | Where validation runs |
| `lane.slots` | 1 | Validation concurrency against re-runs when `main` moves |
| `cells.max` | 3 | Ready branches against host load and allowance |
| `lane.queueTarget` | 2 | When the foreman starts another cell |
| `lane.queueMax` | 10 | The longest the queue may grow |
| `plans.ceiling` | 85% | Factory use of a plan's week against Jason's own sessions |
| `fable.ceiling` | 50% | Ordinary Fable routes against keeping Fable for hard cases |
| `lane.coverageEvery` | 5 | Merges between coverage runs on `main` |

## Measurement

The same five numbers as Lushly (merged PRs per hour, validations per merged PR, share
of validation time that produced a merge, stale or killed runs, plan share per merged PR),
plus two for concurrency: re-runs caused by `main` moving, and the host's peak memory and
CPU per slot.

## Phases

- [ ] **Phase 0: prerequisites.** Intake (the label file, `do-triage`, and `issue-check` and
  `issue-claim` ahead of the rest of the plugin), the aggregate required check, the pre-push hook that
  accepts the lane's record, the workstation's toolchain and SSH alias.
- [ ] **Phase 1: the plugin, one slot.** `botcore-factory` with the commands above,
  the adapter, host selection, Windows and macOS process control, tests against a
  fixture repository. `do-prepare-pr` lane mode and `do-run-fleet` in AFD. Run one AFD
  fleet on the workstation and report the numbers.
- [ ] **Phase 2: concurrency.** `lane.slots` above 1, the shared host lock, the
  re-validate-on-moved-main rule; measure against Phase 1.
- [ ] **Phase 3: cells on other machines.** `lane-handoff` from the Mac mini and the
  MacBook Air, so their plans feed the workstation's lane.
- [ ] **Phase 4: Lushly moves on.** A Lushly adapter (receipts, review lanes, flake rule,
  its pre-queue check) reaches parity with `scripts/merge-lane.mjs`; Lushly's lane retires.
  Its host becomes a dial too, so Lushly could validate on the workstation.

## Jobs

Each job is a scenario in [`scenarios/`](./scenarios/), on invented fixture data
(`scenarios/fixtures/`).

All are kept. The order is the build order: the `slice` jobs are what one AFD fleet on
the workstation needs; the rest follow in the order listed.

| Order | File | Job | Tags |
|---|---|---|---|
| 1 | 14 | Triage the backlog so the foreman has work | slice |
| 2 | 05 | Hand over a reviewed branch and end the turn | slice |
| 3 | 08 | Get an ejected branch back with its reason and log, and return to the front | slice |
| 4 | 01 | Choose the lane host from the connected machines | slice |
| 5 | 03 | Start a cell on the plan with the most room | slice |
| 6 | 06 | Be refused early when the cheap checks fail | slice |
| 7 | 09 | Never pass a failing check by loosening it | slice |
| 8 | 11 | Step in as the operator: pause, resume, revert, drop | slice |
| 9 | 12 | Finish a run and see its numbers | slice |
| 10 | 10 | Validate several branches at once on a larger host | concurrency |
| 11 | 04 | Stop starting cells when every plan is at its ceiling | |
| 12 | 07 | Hold a finished branch while the queue is full | |
| 13 | 02 | Move the lane to another machine without stranding a branch | |
| 14 | 13 | Hand over a branch from another machine | handoff |

What writing them changed: `lane-host-list` gained `suggestedSlots` and `missing[]`
(jobs 01 and 10 had no way to show readiness or a sensible slot count), `lane-host-set`
gained `LANE_BUSY` (job 02), and `lane-status` gained `nextReset` (job 04 ended at "no
room" with no way to say when).

What scenarios cannot show: the lane's own loop (validation, merging, CI waits) runs
between commands, so jobs 08 and 12 start from fixture state the loop would have
written. Throughput, the cost of re-runs and host load need the measurements above.

Checks run 2026-11-12 ([jobs first](../../../../.claude/skills/afd/references/jobs-first.md)):
`afd scenario validate` passes all 14 files with fixtures resolved; coverage uses 19 of 20
drafted commands (all but `lane-run`, kept for debugging) and 14 of 15 error codes; no
scenario calls an undrafted command. `READ_FAILED` is unshown: a fixture cannot make the
GitHub read fail, so `issue-check`'s unit tests cover it.

Not yet done: the walk by readers who did not write the jobs.

## Exit criteria

- Phase 1: every scenario tagged `slice` passes against the plugin, and one AFD fleet has
  run on the workstation with its numbers reported.
- Phase 2: the `concurrency` scenarios pass and the measured re-run cost is reported.
- Phase 3: the `handoff` scenarios pass.

## Open questions

1. Should Lushly and AFD share one lane host and lock once Lushly migrates, putting both
   repositories' validation on the workstation?
2. Is the SSH hand-off acceptable on Windows, or should the private-ref transport be the
   default?
