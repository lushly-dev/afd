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

### 2026-11-25: multi-unit area counting and records-vs-source on 17 to 23 Nov (#2551)

- With records excluded from unit attribution and `last_edit`, and each commit counted in every
  unit it touches (no `several` row), 17 to 23 Nov keeps the same totals: 449 merged, 124 fix
  commits (54 touching more than one unit, down from 74; 1 records-only), 0 reverts, 196
  escapes, 25 unconfirmed, 118 with a test path.
- The top areas over 50 rows are `endpoints/loam/packages/web` (22 fix commits, 22 also other
  units, 67 escapes), `endpoints/botcore` (21, 8, 37), `endpoints/botcore/plugins/botcore-factory`
  (19, 3, 29), `foundations/fast-af/packages/violet-elements` (18, 7, 33), and `packages/server`
  (16, 15, 25).
- `last_edit` over non-record lines is read for 119 of 124 fix commits with a median of 0.7
  days (up from 0.2 days over 111 commits when records were blamed).

### 2026-11-25: the record's sizes on a whole day, and the fold on real data (#2484)

- 20 Nov, the quietest day of 16 to 24 Nov (1,063 runs listed; 22 to 24 Nov list 2,500 or
  more, as many as GitHub counts), was read whole by two collections at the default limit:
  1,000 and 186 requests. Every run's steps and every hook group step's summary are on record
  (`steps_share` and `commands_share` 1.0), so the figures below rest on all of that day's
  runs. In the five events, 1,044 finished runs: 952 passed, 34 failed, 42 cancelled, 16
  `action_required`, 75.7 wall hours, and 25 queue groups of which 6 had a failed run.
- The day's record is 1,158,673 bytes in 2,317 lines: 1,068 `run` lines (attempts) of 426
  bytes on average (470 at most), 1,052 `steps` lines of 472 (2,059), 104 `group` lines of 616
  (1,569) and 93 `shape` lines of 1,544 (6,805). Shapes are kept once for each version of a
  workflow, so a later day adds fewer. The finding on the report by check (#2482) put a day at
  2,800 to 9,000 requests for its jobs alone; this one cost 1,186 in all, about one an attempt.
- The fold, run on a copy of that record as if the day were 180 days old, gives the same
  answer to all 27 reports of the day compared (by workflow and by check, every event and each
  of the five, both sorts, and the three checks that failed most, at the largest limit). It
  makes 66 `folded-workflow` lines (1,064 bytes on average, 2,134 at most) and 1,845
  `folded-check` lines (568, 1,062): 1,262,198 bytes with the shapes, more than the day's runs.
  A check line is kept for each check and event that ran, so a folded day costs about the same
  whatever its runs, and the fold saves space only on a day busier than this one: on the 8,955
  runs listed on 23 Nov, about seven times by this day's bytes a run. At these sizes a record of 180 days of runs is
  hundreds of megabytes (about 1.2 MB a day on a quiet day), which every report reads whole.
  How much to fold, and when, is for a later piece; see "Not yet known".
- A day folds only when it is wholly collected, every machine's record was read, the checks
  known could be read and each of its lines can be made; otherwise the collection's
  `folded.not_folded` names it, why, and what mends it where something can. The hourly job
  reads seven days, so a day it left unfinished (a machine off for a week, collections stopped
  at their limit hour after hour) waits for a collection reaching it, and one 365 days old or
  more can never be read again and stays as runs. A span listed while a run was still going
  counts as listed, so such a run folds as still going, which reports warn of. Whether such
  days should fold anyway, marked as partial, is open.
- The widest answers, as the command line prints them with `--json` (and without), and as the
  local server's run tool would return the command's result dumped as JSON: by workflow,
  14,519 (13,194) and 14,725 characters at the default limit of 25, and 33,559 (30,642) and
  33,765 at 200; by check, 28,253 (26,432) and 28,459 at 25, and 200,775 (188,608) and 200,981
  at 200, twice the server's cut of 100,000. By check, 100 rows give 103,058 and 90 give
  93,631. The largest limit is now 75, where the widest answer is 79,201: room for a week's
  longer lists of checks and warnings, which this day cannot show.
- The hourly job, run once by hand (`botcore disk-run`) with scratch settings naming this
  checkout and scratch state folders, and no shared folder: skill usage `ok` (2,618 events, a
  first collection), then the gate outcome step `ok`, having fetched the default branch into
  `refs/botcore/gate-outcome/default` and collected seven days `partly`, stopped at the default
  1,000 requests. `disk-status` showed both lines and called the machine healthy. Whether the
  job collects for a week without a session asking follows the release.

### 2026-11-25: the fix-commit inventory on real data (#2483)

- A collection of 17 to 25 Nov read 148 fix commits in 8 GitHub requests and about a minute.
  For 17 to 23 Nov the inventory holds 124 fix commits of 449 commits merged, and no revert.
- 67 of the 124 carry no closing word of their own, not 68: one writes its issue as
  `lushly-dev/afd#2267`, which GitHub closes too. 8 have no number at the end of their subject,
  so their pull request cannot be read through it; GitHub names the pull request each of the 8
  merged, and through it 2 of them close issues that the subject would have missed. The
  collection reads that pull request for a subject with no number.
- 118 touch a test path, as the proposal counted. The Rust rule adds no commit: the 12 commits
  that change lines inside a Rust test module all touch a named test path too.
- Areas: with the manifests the boundary check discovers, 4 fix commits are `repository`; with
  only the units `architecture.json` lists, 21 would be, most of them Loam's, whose packages
  are units by discovery only. 74 of the 124 are `several`, and 18 of those only because they
  also edit a parent unit's provenance records or changelog (a Botcore factory fix recording
  its provenance in `endpoints/botcore`). The three areas with the most fix commits are
  `several` (74), `endpoints/botcore` (13) and `foundations/fast-af/packages/violet-elements`
  (11).
- 196 escapes and 25 unconfirmed commits; the issues ten commits close, their states and labels
  were checked by hand against GitHub and agree. Every commit's `Found-by:` is `absent`.
- The age of the last edit has a median of 0.2 days over 111 of the 124 (12 replace lines in
  more than 20 files, 1 only adds). The newest replaced line is mostly a status file,
  changelog or provenance record that every change edits: over source lines only (no Markdown,
  JSON, YAML, provenance records or test paths), the median is 1.0 day over 119 commits.
  Whether to blame source lines only is a later piece's to decide.

### 2026-11-25: the report by check on real data (#2482)

- With `ci-ok.yml` named as the verdict in a scratch configuration, the totals for 17 to 23 Nov
  are the proposal's: on pull requests 8,237 runs, 313 failed (5,680 passed, 1,315 cancelled,
  929 `action_required`, 30 passed on a later attempt), and in the queue 23 of 363 groups with
  a failed run. Without it they are 9,542 and 437, as the finding of 2026-11-24 says.
- A failed `Quality gate` step has its failing command named: in run 45393856666, a
  pull request's `ci.yml` run on 24 Nov, attempt 1's summary gives `test` failed after 194
  seconds and 18 commands passed. `process` is absent because it joined the group (#2453) after
  that run, so it counts as not run there. The run passed on attempt 2, and a run counts as its
  latest attempt, so the failure shows in the check's `examples` and not in its row until
  attempt 2's steps are read.
- A collection of 17 to 25 Nov held to 1,000 requests spent about 460 on the lists and earlier
  attempts of 25,915 runs, then read the jobs of 528 attempts that did not pass, newest first,
  and one log. Every run of 25 Nov (listed to 04:45) that did not pass has its steps, but
  `steps_share` for that day is 0.18: a passed run's steps come after every run in the window
  that did not pass. Until passed runs are read, rows by check count mostly failed and cancelled
  runs. At one request an attempt, a day here costs 2,800 to 9,000 requests for its jobs alone,
  which #2484's hourly step has to fit into the allowance.
- A deleted workflow (path `BuildFailed`, no name, created 23 Nov) keeps starting `workflow_run`
  runs, triggered by the release tags app, that fail at startup: 1,406 on 23 Nov, 4,036 on
  24 Nov and 1,388 on 25 Nov to 04:45. #2481's collection refused their nameless lines and
  dropped them; a run with no name now goes by its path and counts among other events, so the
  754 runs of other events in the finding of 2026-11-24 leave out about 1,400 of these. Why
  they start is not this plan's to answer.
- 22 and 23 Nov listed 5,150 and 8,955 runs, three to five times the other days of the week,
  and 23 Nov had 1,130 runs that did not pass, most of them cancelled.
- The generated local suites are not among the checks known yet: a local step maps to a check
  only once the generator names its origin (phase 2), so until then they would be checks of
  their own that no collected run can observe.

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
  reader takes its row off. (Superseded: decided and built, see the finding of 2026-11-25.)
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

- The record, `gate-outcome-collect` for CI runs, and `gate-outcome-report` by workflow (#2481): merged
  in #2517. On 17 to 23 Nov it gives the nine rows of the
  proposal's table exactly; see the finding of 2026-11-24 for the verdict and the base revision.

- The checks known, the report by check with quiet and not-observed checks, and a group step's
  failing command (#2482): merged in #2535; scenarios 01 and 03 run in Botcore's
  core tests, 03's steps 3, 4 and 6 waiting on #2483. See the finding of 2026-11-25.

- The fix commits and the escapes they close, and the report by area (#2483): merged in
  #2547; scenario 02 and the three held steps of 03 pass. See the finding of 2026-11-25
  on the inventory.

- Counting fix commits in every unit they touch, and telling records from source (#2551): merged
  in #2570; see the finding of 2026-11-25.

- The hourly job's step, the record's folding and measured sizes (#2484): merged in #2568;
  the sizes of a whole day are in the finding of 2026-11-25. Open: the hourly job
  collecting on one machine for a week without a session asking, which follows the release
  and a machine's settings naming a checkout.

- A docs topic the command line can print (#2479): merged in #2533. `botcore docs <topic>` prints
  what the server's docs tool returns, from the same function; `botcore docs` lists the topics.

- The Botcore release that carries the commands, installed on each machine (the maintainer's): not
  started; follows #2484.

- Naming the verdict in this repository's `botcore.toml` (the maintainer's): not started; follows
  the release. Once that Botcore is installed on every machine, add `[gate_outcome]
  verdict_workflows = ["ci-ok.yml"]`; an older Botcore refuses a key it does not know, so it
  cannot go in before.

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
