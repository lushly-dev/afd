---
"lushly-botcore": minor
---

### Added

- **`skill-usage-triggers`** reports, for each skill a repository requires, the changes merged to its default branch that touched the skill's paths and whether the session that made each had loaded the skill first, naming the pull request and sessions of each miss. Wherever the record cannot establish who made a change or in which order, the change is counted as unknown with the reason, never as a miss. A repository declares its required skills as `[[skills.required]]` in its botcore configuration, with `skill` and `paths` (#1817).
- **`skill-usage-collect`** also records, in a file of its own (`triggers.jsonl`), each turn in which a session changed a path its repository requires a skill for (the skill, never the file), and when each pull request was linked to a session. A turn that moved the checkout to other commits is not read as the session's own changes. Run it with `--rebuild` after declaring or changing required skills.

### Changed

- **`skill-usage-report`** counts only the kinds of event it knows as loads, so a record a newer botcore wrote to is not misread.
