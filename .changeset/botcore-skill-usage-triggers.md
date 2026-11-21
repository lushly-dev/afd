---
"lushly-botcore": minor
---

### Added

- **`skill-usage-triggers`** reports, for each skill a repository requires, the changes merged to its default branch that touched the skill's paths and whether the session that opened each one's pull request had loaded the skill by then, naming the pull request and session of each miss. It judges only from what is recorded outright (git's merged changes, which session opened a pull request and when, and that session's loads); a change it cannot judge is counted as unknown with the reason, never as a miss. A change whose pull request a script opened, as a fleet's merge lane does, is unknown (#1887). A repository declares its required skills as `[[skills.required]]` in its botcore configuration, with `skill` and `paths` (#1817).
- **`skill-usage-collect`** also records, for each session, the session it came from (the one that delegated it, or the one it was forked from), and for each pull request linked to it or its subagents, when and whether the session opened it. Collect again after upgrading, so that the record says so.

### Changed

- **`skill-usage-report`** counts only the kinds of event it knows as loads, so a record a newer botcore wrote to is not misread.
