---
"lushly-botcore": patch
---

### Fixed

- **`disk-reclaim`** no longer counts a git checkout it keeps inside an `[[aged]]` folder as a failure. Such a folder is scored `kept`, the receipt and `status.json` list it under `kept`, and `disk-status` stays healthy and names it in `warnings`. Before, a temp folder a test suite writes git fixtures to made every run fail and `disk-status` unhealthy. A checkout inside a worktree's build output still leaves that strip `partial`, and the Windows path walk no longer reports each parent of a kept folder as a failed removal (#2625).
