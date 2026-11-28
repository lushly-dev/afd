---
"lushly-botcore": patch
---

### Fixed

- **The factory gateway's search for an unanswered filing no longer puts the title in a command line.** When GitHub does not answer an `issue-create` without a `dedupe_key`, the refusal's `details.search` now holds the search (`in:title "<title>"`, matching the title as one phrase), and the suggestion says to pass it as one argument to `gh issue list --repo <repo> --state open --search`. It had put the title raw inside single quotes: an apostrophe broke the command, a crafted title could run one, and the search named no repository (#2907).
