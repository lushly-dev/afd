---
"lushly-botcore": patch
---

### Fixed

- **Botcore disk classification (`disk-report --unclassified` and tier 2):** look inside collapsed ignored folders whose own path matches no `[disk]` pattern and accept them when every child is covered by a regenerable pattern (passing its nested safety checks) or an unchanged declared copy (#1933).
- **Botcore provenance artifact verification (`scripts/verify_provenance.py`):** refuse unexpected members under the provenance records directory (including case collisions, `./` segments, subdirectories and symlinks) and duplicate members in both wheels and sdists (#1671).
- **`botcore-factory` state store durability:** trim closed events and finished runs under a bounded policy while preserving open events, active runs and monotonic IDs; fsync temp files and parent directories before and after rename; verify lock inode and content before breaking stale locks; and maintain incremental branch/run record summaries in `records-summary.json` (#1796).
- **`botcore-teams` command dispatch:** return a failure `CommandResult` with a suggestion when a command is not registered or dispatch fails instead of falling back to fabricated stub successes (#1797).
