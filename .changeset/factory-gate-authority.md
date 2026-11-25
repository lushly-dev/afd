---
"lushly-botcore": minor
---

### Changed

- **`botcore-factory` foreman-only records:** `gate-allow` and `ejection-excuse` now need the session that holds the lane's live lease. Any other call is refused with `FOREMAN_REQUIRED`, which names neither the holder nor a way to take the lane, and neither command takes the lane. The owner passes the running foreman's session from `factory call lane-status`; taking the lane with `lane-wait` while none is live supersedes the last foreman's session.
- **`botcore-factory` `gate-allow` covers one head:** it now requires `head`, the commit diagnosed, which `GATE_EDIT_IN_REPAIR` now names, and returns it. A later commit needs a new `gate-allow`.
- **`botcore-factory` repairs that edit gate paths:** before it validates a repair, and before merging `main` in, the lane checks its gate edits again with its own code and `gate_paths` and holds what it finds as `gate-change` for the owner. A cell keeps its latest failing-check ejection, so a later ejection for another cause no longer ends the check. `lane-enqueue`'s `GATE_EDIT_IN_REPAIR` sends the cell to its foreman, and an `area:ci` label no longer exempts a repair.
- **`botcore-factory` cell status:** a cell's `lane-status` shows whether a foreman's lease is live (`foreman.held`) and until when, not its session. The factory host's `lane-status` adds `foremanHeld`.
