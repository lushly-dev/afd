---
"lushly-botcore": patch
---

### Fixed

- **The factory gateway no longer calls an unanswered `issue-create` or `issue-comment` without a `dedupe_key` retryable.** GitHub may have made the write it did not answer, so repeating the call could file the issue or post the comment twice. That answer is now `GITHUB_UNAVAILABLE` with `retryable: false` and a suggestion to look for the write first (for a filing, a `gh issue list` read, and with a `parent` the `issue-set` that attaches it); with a `dedupe_key`, a repeat still finds the first write. An outage GitHub cannot have acted on (a connection that never opened, no installation token, a rate limit) stays retryable: `GitHubUnavailable` carries `sent` (#2850).
