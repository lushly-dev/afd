---
"lushly-botcore": minor
---

### Changed

- **The factory gateway's `pr-merge` with `cancel` says whether it took the pull request out of the merge queue.** Turning auto-merge off leaves a pull request the queue already holds in the queue, so a cancel dequeues it too, as before; its answer now carries `dequeued`, its reasoning names each step it took, and the journal keeps `dequeued` and the input's `cancel`, so the audit shows which a cancel did (#2809).
