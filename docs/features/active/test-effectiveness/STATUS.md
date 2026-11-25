# Test effectiveness: status

Epic: [#1387](https://github.com/lushly-dev/afd/issues/1387). File new work for this area as its sub-issue.

Read this before the [proposal](test-effectiveness.proposal.md). Active since 2026-11-24.

## How to keep this file

- A pull request edits the line of the piece it builds and no other. Pieces sit under their
  phase, with a blank line between them, so two branches don't conflict on adjacent lines.
- No sentence says which pieces are done or next: read the piece lines.
- Findings get a dated section under [Findings](#findings), newest first. Never delete one; mark it
  superseded and point to what replaced it.

## The owner's decisions

The proposal lists six under "For the owner to decide". Each has its own line here.

- The jobs (1): on 2026-11-24 the owner told the session to go on with the recommended tasks and
  changed nothing in the list, so the twelve jobs are built in the order of the phases. He can
  still cut or reorder the later ones.

- Retiring a test (2): open. Needed before phase 4.

- Who approves a narrower trigger or a move to daily (3): open. Needed before phase 4.

- What every session does that it does not do today (4): open. Needed before phase 2.

- Whether the report may point (5): open. Either answer keeps the listing #2482 builds; a rule
  that names checks to move would be added to it.

- Whether to give reviewers a failing state to test them (6): open. Asked again after phase 3.

## Findings

### 2026-11-24: the first collection of 17 to 23 Nov (#2481)

- The report by workflow on pull requests gives the nine rows of the proposal's table: runs and
  failures exactly, wall hours to the tenth (Loam 895 runs, 205.9 h, 50 failed). The figures the
  proposal gives over all workflows "but the verdict" come out of the record too (8,237 runs; in
  the queue 25 failed runs in 23 of 363 groups; 30 passes on a later attempt, 26 after failing
  and 4 after being cancelled), but the report's own `totals` count `CI verdict` like any other
  workflow: 9,542 runs on pull requests, and 30 of 363 queue groups with a failed run, since in 7
  groups only the verdict failed. Nothing in a run says that a workflow judges the others. A
  botcore setting could name it, but every section of botcore's configuration refuses a key it
  does not know, so a new key in the repository's `botcore.toml` would stop each machine's older
  botcore from reading the file. Deciding how the verdict is left out is open; until then a
  reader takes its row off.
- GitHub drops a pull-request run's link to its pull request once the pull request is closed:
  of the 11,529 pull-request runs listed from 17 to 25 Nov, 11,208 (97%) had no pull request
  and so no base revision. A merge-queue run's base comes from its branch name and was there for
  all 9,240. The pieces that need a pull-request run's base (#2482, #2483) must read it another
  way, such as the pull request of the head revision.
- The week had 754 runs of events the report does not give rows for: 346 `workflow_run`, 327
  `issues` and 81 `dynamic`. `coverage` names them.
- The run lines of 17 to 25 Nov (25,113 lines, every run and earlier attempt, no steps) took
  10.8 MB, about 430 bytes a line. #2484 measures the record with steps and decides its folding.

## Phase 1. What ran and what merged

- The record, `gate-outcome-collect` for CI runs, and `gate-outcome-report` by workflow (#2481): built
  and in review in #2517. On 17 to 23 Nov it gives the nine rows of the
  proposal's table exactly; see the finding of 2026-11-24 for the verdict and the base revision.

- The checks known, the report by check with quiet and not-observed checks, and a group step's
  failing command (#2482): not started; follows #2481.

- The fix commits and the escapes they close, and the report by area (#2483): not started; follows
  #2481.

- The hourly job's step, the record's folding and measured sizes (#2484): not started; follows
  #2481.

- A docs topic the command line can print (#2479): not started.

- The Botcore release that carries the commands, installed on each machine (the maintainer's): not
  started; follows #2484.

## Phase 2. Findings to checks

- Not broken into pieces yet. Waits on the owner's decision 4.

## Phase 3. What changed after a failure, and what review did

- Not broken into pieces yet.

## Phase 4. Replay and decisions

- Not broken into pieces yet. Waits on the owner's decisions 2 and 3.

## Phase 5. Two periods and the models

- Not broken into pieces yet.

## Phase 6. Every added test

- Not broken into pieces yet.
