---
"lushly-botcore": patch
---

### Fixed

- **botcore-factory no longer assigns a plan from a stale usage cache, and counts every Claude instance as Claude.** A weekly window whose `resetsAt` has passed since its T3 Code cache was checked, or whose cache was checked longer ago than the window lasts (a removed instance leaves its file behind), is never chosen. `plan-list` marks it `stale`, `lane-status` lists it under `stalePlans`, and `cell-register` refuses `PLANS_STALE` when every plan a cell may take is stale. A cache's provider is now its `driver`, so a second Claude instance (`claudeAgent_2`) is a Claude plan while `cells.claudeOnly` is on (#2691).
- **botcore-factory's lane on Windows survives a console Ctrl+C or Ctrl+Break, and `lane-stopped` names the log the lane wrote.** A step it runs, or the host, sending one to its whole console killed the lane mid-merge. The lane and every process it starts now ignore Ctrl+C, and a handler answers Ctrl+Break, writing `ignored console control event 1 (Ctrl+Break)` to its log to help find the sender; `lane-stop` still stops it, and a console that closes still ends it. `python -m botcore_factory.lane_main --log <file>` appends the lane's output, and its steps', to that file and records it; `lane-start` passes its `lane.log`, and `lane-stopped`'s `logPath` is the recorded file, or none when the launcher named none, instead of always `lane.log` (#2836).
