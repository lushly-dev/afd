---
"lushly-botcore": patch
---

### Changed

- **The `disk-hygiene` skill** says that an ignored path no `[disk]` pattern names keeps tier 2 from removing its worktree, and that a build-info file goes with its output (`**/*.tsbuildinfo` with `**/dist`), since `tsc` emits nothing when its build info survives a stripped `dist`, and that `tsBuildInfoFile` belongs outside `node_modules` (#1693).
