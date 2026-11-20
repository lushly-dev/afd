---
name: disk-hygiene
description: >
  Frees disk space with botcore's disk-* commands, never by hand. Use when a disk is
  full, a build fails for space, or a worktree, cache or build folder needs removing.
metadata:
  source: botcore
  version: 1.0.0
  portable: true
---

# Disk hygiene

Development machines fill up with worktrees, Rust `target/` folders, `node_modules` and
caches. An hourly job (`botcore disk-run`) keeps them in check; when space is short anyway,
use the same commands it uses. Every one of them except `disk-reclaim --apply` and
`disk-setup` only reads.

## When space is short

1. `botcore disk-status`: is the job installed and has it run in the last 48 hours? Its
   `problems` list says what is wrong.
2. `botcore disk-report`: every worktree with its tier, idle days, whether a process uses it
   and what stripping it would free; plus caches, aged cache folders and free space.
3. `botcore disk-reclaim`: the same plan as a dry run. Read it, then `--apply`. Add
   `--pressure` to also strip `node_modules` and younger output when a volume is nearly full.
4. Still short: report the largest folders the report does not manage to the owner. Do not
   pick something else to delete.

## Never

- **`rm -rf` a worktree, or delete inside one by hand.** `disk-reclaim` checks that the path is
  ignored and untracked, that nothing is using the worktree and that it is still idle,
  immediately before deleting, and never follows a link or junction. A hand delete does none of
  that.
- **`git worktree prune` by hand.** A worktree on an unplugged external drive looks deleted to
  git, and pruning erases its record. The commands check the volume first.
- **Archive or copy build output "for safety".** It can be rebuilt; a copy only moves the
  problem to another disk.
- **`pnpm store prune` where pnpm clones packages** (APFS on macOS): it deletes every store file
  with one link, which is every file there. The commands only prune a hard-linked store.
- **Delete agent transcripts or memory** (`~/.claude`, `~/.codex`, `~/.t3`). They cannot be
  rebuilt.

## Worktrees

- T3 Code removes the worktrees it creates once its storage cleanup rules are on (Settings,
  storage cleanup: when the pull request merged, when the thread was deleted, after it has been
  settled for some days). The report marks them `managed_by: "t3-code"`.
- To keep a parked worktree from being stripped: `git worktree lock --reason "<why>" <path>`.
  Unlock it when you resume.
- A stripped worktree has a `botcore-disk-strip.json` in its git folder
  (`git rev-parse --absolute-git-dir`). Install and build again before running anything.

## Configuration

- **Repository**: a `[disk]` section in `botcore.toml`. `regenerable` lists paths inside a
  worktree that a build or install recreates; `{ path = "node_modules", when = "pressure" }`
  only goes under low space; `after_days` overrides the idle threshold; `copies` names
  ignored files copied in at setup, such as `.env`. Patterns are read from origin's HEAD, so a
  change takes effect once it merges, never from a branch under review.
- **Machine**: `disk.toml` in the user config folder (`disk-status` prints its path), written
  by `disk-setup`: the repositories, watched volumes with their identifier and low-space
  threshold, and aged cache folders outside worktrees (`[[aged]] path = ".../*"`).
- `disk-report --unclassified` lists ignored paths no pattern covers: the way to finish a
  repository's list.

## Setting up a machine

1. `uv tool install 'lushly-botcore==<version>'`. Not `uvx`: its copy lives in the cache the
   job prunes.
2. From inside each repository: `botcore disk-setup`. It registers the repository, records the
   volumes and installs the job (macOS LaunchAgent, Windows Task Scheduler as the user, Linux
   systemd user timer or crontab), then starts one run: approve any permission prompt then.
3. `botcore disk-status` after the first run. `botcore disk-setup --uninstall` removes the job.
