---
"lushly-botcore": minor
---

### Added

- **`skill-usage-triggers`** reports, for each skill a repository requires, the changes merged to its default branch that touched the skill's paths and whether a session that published each had loaded the skill by then, naming the pull request and sessions of each miss. It judges only from what is recorded outright (git's merged changes, the pull requests linked to a session and when, and the session's loads); a change it cannot judge is counted as unknown with the reason, never as a miss. A repository declares its required skills as `[[skills.required]]` in its botcore configuration, with `skill` and `paths` (#1817).
- **`skill-usage-collect`** also records when each pull request was linked to a session, and the branch a session works on and a pull request came from, as hashes.

### Changed

- **`skill-usage-report`** counts only the kinds of event it knows as loads, so a record a newer botcore wrote to is not misread.
