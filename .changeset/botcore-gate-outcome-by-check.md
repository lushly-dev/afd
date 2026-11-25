---
"lushly-botcore": minor
---

### Added

- **`gate-outcome-report` reports by check.** With `by: check`, one row for each check and event: a step of a job as GitHub names it (a matrix leg is its own check, a job that calls a workflow is `<caller> / <called job>`), and inside a step that runs a hook group (a command that comes down through the root `package.json` to `lefthook run <group>`), each command of the group. A row counts runs that passed, failed and were cancelled, and steps that did not run (`not-run`) apart, with passes on a later attempt, minutes, a rate only on 20 runs or more, `quiet` for a check that passed and never failed, and `local: absent` until local runs are collected. The checks known are read through git from the default branch's tip, never from the working tree; one the record has not seen is listed under `not_observed` with why, never as a row of zeros, and one that is not known is refused with the closest ids and how many are known. The `check` filter takes an id as written and gives the runs it failed in; every filter the plan names is taken, and one that does not go with `by` is refused with those that do.
- **A failed hook group step has its failing command named.** When a collection reads the jobs of an attempt whose group step failed, it reads that job's log once (one counted request) for Lefthook's closing summary, and keeps each command's name, result and seconds, and nothing else of the log; a name is kept only when the group has it at the default branch's tip. The logs of group steps that passed are read last, as the limit permits, and `coverage.commands_share` gives the share read. A summary that cannot be read is said so, and its commands' results are `result_unknown`, never guessed.
- **Verdict workflows are left out of the totals.** A repository names the workflows that judge the others in `botcore.toml` (`[gate_outcome] verdict_workflows`, by file or name). A named one keeps its row, marked `verdict`, and the report's totals and the queue's failed groups leave it out and say so. With none named the report is as it was.

### Changed

- **The record's rules are version 2.** A passed attempt keeps its jobs' and steps' conclusions where one did not succeed, so a skipped step is told from one that passed, and a steps line made by the older rules is read again.
