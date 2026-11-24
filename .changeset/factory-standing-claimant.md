---
"lushly-botcore": patch
---

### Fixed

- **`botcore-factory` competing claims:** `cell-register` now names the earliest still-standing live claimant when two branches claim the same issue, matching the issue-claim CLI, and shows a renewed holder's current lease.
- **`botcore-factory` stale claims:** `issue-check` no longer lists an issue as stale, and `cell-register` no longer calls its claim expired, when a live claim is followed by a later one that lapsed.
- **`botcore-factory` releases:** `lane-drop` and a `cell-register` whose writes failed leave `status:in-progress` on an issue another branch's live claim still holds. A lapsed claim whose branch has an open pull request counts, as the issue-claim CLI reads it. Taking the label off hid that claim, and the issue could be dispatched a second time. `lane-drop` now posts its release comment before changing the label, so a failed comment leaves the issue held.
