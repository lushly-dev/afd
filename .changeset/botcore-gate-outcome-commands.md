---
"lushly-botcore": minor
---

### Added

- **`gate-outcome-collect` reads a repository's workflow runs from GitHub into a record every machine shares.** Called from a checkout, it lists the Actions runs of the last `since_days` whole UTC days for every event, splitting any span GitHub caps at 1,000 runs, then reads the earlier attempts of runs that have them, then each attempt's jobs and steps (those that did not pass first). It stops at `requests` (1,000 unless given) or when the account's hourly allowance is down to half, says how far it got (`partly`, `reached`), and the next collection goes on from there; collecting the same window again, here or on another machine, adds nothing. The record holds paths, digests, names, durations and counts only, and is shared through the folder skill usage uses. Only the `ci` source is built; `main`, `reviews` and `runs` are refused.
- **`gate-outcome-report` gives each workflow's runs by event.** One row for each workflow and event over a window of whole UTC days (`days`, `ending_days_ago`): runs that passed, failed, were cancelled, ended `action_required` or were skipped, counted apart; runs that passed on a later attempt; wall hours; for the merge queue its groups and how many had a failure; and a failure rate only on 20 runs or more (`too-few` otherwise). `coverage` says how much of the window was listed and what share of runs have their steps, and `warnings` names runs still going. Only `by: workflow` is built. Both commands have a `gate-outcome` docs topic.
