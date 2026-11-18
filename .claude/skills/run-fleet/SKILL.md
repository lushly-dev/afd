---
name: run-fleet
description: >
  Runs a software factory fleet as its foreman: starts cells on the plan the lane
  assigns, leaves validation and merging to the lane, and acts only on lane events.
  Use when running the backlog, or starting, resuming or closing out a fleet.
metadata:
  source: afd
  version: 0.1.0
  portable: true
---

# Run fleet

Three parts, and you are the third ([software factory](../../../docs/features/active/software-factory/software-factory.proposal.md)):

- **The lane** (`botcore-factory`, detached on the lane host) alone validates a fleet branch, pushes it, opens its PR and merges, in queue order.
- **A cell** is one agent, one package of issues, one worktree. It implements, gets its review, runs `prepare-pr lane` (which records the review and enqueues) and ends its turn.
- **The foreman** (you) starts cells, resumes an ejected one and asks the owner for decisions. You keep no state and write no status updates: state is `lane-status`, so any fresh session can pick a run up.

One foreman per lane. Pass your thread id as `session` to `cell-register`, `lane-wait` and `dial-set`; it holds the lane while you work and wait. `FOREMAN_BUSY` means another session holds it (`lane-status` shows `foreman`): stop and tell the owner, never work around it, and never hand the lane over yourself. A session that has ended frees the lane once its last `lane-wait` times out and its lease runs out; the owner can free it at once with `foreman-handoff {"session": "<its id>"}`.

`factory` below is `uv run --frozen --project endpoints/botcore/plugins/botcore-factory factory call <command> '<json>'` from the repository root; on Windows PowerShell put the JSON in a file and pass `--args-file <path>`.

## Start or pick up a run

Run from the primary checkout on current `main`, on the lane host; cells run there too until `lane-handoff` exists. Then `lane-status`:

- **No lane host:** `lane-host-probe`, then `lane-host-list`. Set only the ready host the owner named (`lane-host-set`); otherwise ask. A foreman elsewhere starts one there through T3 Code (`delegate_task` with its `environmentId`).
- **Not running:** `lane-start`. Paused by its own trouble: fix what `pauseReason` names, then `lane-resume`. Never resume a pause the owner made.
- **Open events first:** act on every `openEvents` entry, as [the runbook](references/runbook.md#events) says, before starting anything. A foreman that died may have read them.
- Read the runbook's [host notes](references/runbook.md#host-notes) for the machine.

## Pick work and start a cell

Run `triage-issues` first, then take work in `issue-check`'s `dispatchable` order. Batch issues that share code into one package; never split work to fill seats. Start a cell only when `lane-status` says `canStartCell`, on its `plan` and `nextIssue`:

1. `cell-register {"issues": [n], "branch": "<branch>", "route": "<model/effort>", "session": "<your thread id>"}`. The lane claims the issues and assigns the plan; a refusal costs nothing.
2. `delegate_task` on that plan with `isolation: "worktree"` and [the cell brief](references/runbook.md#the-cell-brief).
3. `cell-attach {"branch": "<branch>", "thread": "<childThreadId>"}`.

Take the route from [model routing](../../../docs/operations/model-routing.md). A cell runs wholly on its plan's provider; only you cross providers.

## Wake only for judgment

After acting, leave one background `factory call lane-wait '{"consumer": "foreman", "timeout_ms": 7200000, "session": "<your thread id>"}'` and end your turn. T3 Code wakes you when it exits or a cell ends; on `timedOut`, read `lane-status` and wait again. Never poll a cell or the lane. Ask the owner only for a product decision or operator work (sign-ins, secrets, publishing).

## Finish

`lane-drop` any cell that will not come back, then wait for `queue-empty`: the lane may still be running `main`'s coverage. Then `event-resolve` it, `lane-report` and `lane-stop`. Relay the merged PRs, what was ejected and why, the report's numbers, and what remains. Never delete a worktree or lock you did not make, or report dropped work as shipped.
