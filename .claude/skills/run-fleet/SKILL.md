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
- **A cell** is one agent, one package of issues, one worktree. It implements, gets its review, runs `prepare-pr lane` (which records the review and calls `lane-enqueue`) and ends its turn.
- **The foreman** (you) starts cells, resumes an ejected one and asks the owner for decisions. You keep no state and write no status updates: state is `lane-status`, so any fresh session can pick a run up.

`factory` below means, from the repository root:

```bash
uv run --frozen --project endpoints/botcore/plugins/botcore-factory factory call <command> '<json>'
```

## Start or pick up a run

Run from the primary checkout on current `main`, on the lane host: cells must run there too until `lane-handoff` exists. Then `lane-status`:

- **No lane host:** `lane-host-probe`, then `lane-host-set {"id": "<this machine>"}`. On another machine, start the foreman there through T3 Code (`t3_environment_links`, then `delegate_task` with its `environmentId`).
- **Not running:** `lane-start`. Paused: fix what `pauseReason` names, then `lane-resume`.
- **Shared host:** on `random`, Lushly's script lane uses the same cores and the plugin's lock cannot see it. Start AFD's lane only while `node scripts/merge-lane.mjs status` in Lushly shows it idle.

## Pick work and start a cell

Run `triage-issues` first, then take work in `issue-check`'s `dispatchable` order. Batch issues that share code into one package; never split work to fill seats. Start a cell only when `lane-status` says `canStartCell`, on its `plan` and `nextIssue`:

1. `cell-register {"issues": [n], "branch": "<branch>", "route": "<model/effort>"}`. The lane claims the issues and assigns the plan; a refusal costs nothing.
2. `delegate_task` on that plan with `isolation: "worktree"` and the cell brief in [the runbook](references/runbook.md#the-cell-brief).
3. `cell-attach {"branch": "<branch>", "thread": "<childThreadId>"}`.

Routes come from [model routing](../../../docs/operations/model-routing.md): Sol `high` on Codex for volume work. A cell runs wholly on its plan's provider; only you cross providers.

## Wake only for judgment

After acting, leave one background `factory call lane-wait '{"consumer": "foreman"}'` (the command line has no time limit) and end your turn. T3 Code wakes you when it exits or a cell ends. Never poll a cell or the lane. What to do for each event is in [the runbook](references/runbook.md#events). Ask the owner only for a product decision or operator work (sign-ins, secrets, publishing).

## Finish

Wait for `queue-empty`: the lane may still be running `main`'s coverage. Then run `lane-report` and `lane-stop`. Relay the merged PRs, what was ejected and why, the report's numbers, and what remains. Never delete a worktree or lock you did not make, or report dropped work as shipped.
