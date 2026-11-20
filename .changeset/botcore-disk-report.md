---
"lushly-botcore": minor
---

### Added

- **`disk-report`** (CLI and `disk_report` over MCP) lists every worktree of the repositories a machine registers, with how long each has been idle, whether a process is using it, and the build output its `[disk].regenerable` patterns name and could free; plus watched volumes, tool caches and aged cache folders. It is read-only. A repository's patterns come from a new `[disk]` section in `botcore.toml`, read from its main checkout's commit rather than a worktree's branch, and a machine's settings from its own `disk.toml` (#1688).
