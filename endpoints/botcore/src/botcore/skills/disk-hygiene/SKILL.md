---
name: disk-hygiene
description: >
  Frees disk space with botcore's disk-* commands, never by hand. Use when a disk is
  full, a build fails for space, or a worktree, cache or build folder needs removing.
metadata:
  source: botcore
  version: 1.3.0
  portable: true
---

# Disk hygiene

Development machines fill up with worktrees, Rust `target/` folders, `node_modules` and
caches. An hourly job (`botcore disk-run`) keeps them in check; when space is short anyway,
use the same commands it uses. `disk-report` and `disk-status` only read; `disk-keep`, `disk-unkeep` and `disk-restore`
change one worktree each. `disk-reclaim`
without `--apply` deletes nothing but writes a receipt. `disk-reclaim --apply`, `disk-run`
(which applies a reclaim when one is due) and `disk-setup` make changes.

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

- **`rm -rf` a worktree, `git worktree remove --force` one, or delete inside one by hand.** `disk-reclaim` checks that the path is
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
  settled for some days). The report marks them `managed_by: "t3-code"`; Botcore Factory's lane
  slots are `managed_by: "factory"`, and Factory removes those itself.
- `disk-status` `warnings` (also in `disk-report`) name a repository with more idle worktrees
  than the machine's `idle_worktree_limit`. Tell the owner: the fix is T3 Code's storage
  cleanup rules, or tier 2 for the rest, never removing them by hand.
- To keep a parked worktree from being stripped or removed: `botcore disk-keep <path> --reason
  "<why>"` (14 days, or `--until YYYY-MM-DD`). `botcore disk-unkeep <path>` when you resume.
- Tier 2 removes worktrees T3 Code does not manage once nothing unique is in them (no changes,
  hidden ones included; no operation in progress; the commit on a branch, remote or tag; no
  per-worktree refs, config or sparse rules; no ignored file that is not rebuildable or an
  unchanged declared copy) and their work has landed. `git worktree remove` only: the branch
  stays, and the commit is pinned under `refs/botcore/removed/` first. The hourly job does it
  only after `disk-setup --remove-landed`. `botcore disk-restore <path>` brings a removed
  worktree back at the same commit.
- A stripped worktree has a `botcore-disk-strip.json` in its git folder
  (`git rev-parse --absolute-git-dir`). Install and build again before running anything.

## Configuration

- **Repository**: a `[disk]` section in `botcore.toml`. `regenerable` lists paths inside a
  worktree that a build or install recreates; `{ path = "node_modules", when = "pressure" }`
  only goes under low space; `after_days` overrides the idle threshold; `copies` names
  ignored files copied in at setup, such as `.env`: a folder that is or may hold one is never
  stripped. Patterns are read from origin's default branch (or `main`), so a change takes
  effect once it merges, never from a branch under review.
- **Machine**: `disk.toml` in the user config folder (`disk-status` prints its path), written
  by `disk-setup`: the repositories, watched volumes with their identifier and low-space
  threshold, and aged cache folders outside worktrees (`[[aged]] path = ".../*"`). The same
  file names the machine for skill usage (`skill_usage_machine`, `skill_usage_shared`), which
  the hourly job also collects: `botcore docs skill`. It can name checkouts the job collects
  gate outcomes for (`gate_outcome_checkouts`; none by default, since GitHub's allowance is the
  account's): `botcore docs gate-outcome`. That step fetches each checkout's default branch
  into `refs/botcore/gate-outcome/default` only, and never fails or holds the job.
- **Rust**: Cargo's default keeps `target/` inside each worktree, where tier 1 and worktree
  removal reach it. A machine that moves it (`CARGO_TARGET_DIR`, or Cargo's `build-dir` on a
  bigger drive) needs an `[[aged]]` folder covering it; `disk-setup` names the entry to add.
- `disk-report --unclassified` lists ignored paths no pattern covers: the way to finish a
  repository's list. Such a path keeps tier 2 from removing its worktree, so name build output
  and leave state unnamed. Name a build-info file with its output (`**/*.tsbuildinfo` with
  `**/dist`): `tsc` emits nothing when its build info survives the output it describes. Keep
  `tsBuildInfoFile` out of `node_modules`, where no pattern reaches.

## Setting up a machine

1. `uv tool install 'lushly-botcore==<version>'`. Not `uvx`: its copy lives in the cache the
   job prunes.
2. From inside each repository: `botcore disk-setup`. It registers the repository, records the
   volumes and installs the job (macOS LaunchAgent, Windows Task Scheduler as the user, Linux
   systemd user timer or crontab), then starts one run: approve any permission prompt then.
   macOS asks before a scheduled program reads an external volume or a cloud drive's folder.
   A run waits a few minutes for the answer, goes on without that step, and asks again the
   next hour; after such a run `disk-status` names the folder and the program to allow.
3. `botcore disk-status` after the first run. `botcore disk-setup --uninstall` removes the job.
