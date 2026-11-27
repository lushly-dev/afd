---
"lushly-botcore": minor
---

### Added

- **The factory gateway sets an issue's type and parent.** `issue-create` takes `type` (an issue type the organization defines, by name) and `parent` (an issue in the same repository, which the new issue is filed under as a sub-issue) and answers both; a retry its `dedupe_key` matches sets whichever the issue still lacks, and an attach GitHub refuses or does not answer names the issue already filed (that `GITHUB_UNAVAILABLE` is retryable only with a `dedupe_key`, since repeating a filing without one files a second issue). The new `issue-set`, on the foreman's and owner's routes, changes or clears either on an existing issue (`null` clears the type or detaches the parent, a new parent replaces the old, a field left out is kept) and answers `type`, `parent`, `previous` and `changed`. Both check first, so `TYPE_UNKNOWN`, `PARENT_NOT_FOUND`, `NOT_FOUND`, `VALIDATION_ERROR` and `PARENT_IN_OTHER_REPO` write nothing. `issue-get` gives `type`, `parent` and `subIssues { total }`. The App adapter writes types over REST and sub-issues through GitHub's sub-issue endpoints (#2729).

### Changed

- **A `STILL_QUEUED` refusal from the factory gateway's `pr-merge` with `cancel` keeps GitHub's refusal in its details** whenever GitHub refused to turn auto-merge off, and blames that refusal only while auto-merge is still what is set.
