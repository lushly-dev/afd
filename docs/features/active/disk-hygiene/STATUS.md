# Disk hygiene: status

Epic: [#1684](https://github.com/lushly-dev/afd/issues/1684). File new work for this area as its sub-issue.

Read this before the [proposal](disk-hygiene.proposal.md). Active since 2026-11-20.

## How to keep this file

- A pull request edits the line of the piece it builds and no other. Pieces sit under their
  phase, with a blank line between them, so two branches don't conflict on adjacent lines.
- No sentence says which pieces are done or next: read the piece lines.
- Findings get a dated section under [Findings](#findings), newest first. Never delete one; mark it
  superseded and point to what replaced it.

## Findings

### Rollout, 2026-11-20 (#1693)

- Installed on each machine with `uv tool install` from #1698's merge commit `0f50fb7dc`
  (no release yet, #1692). On each, a dry run came first and the largest planned strips were
  checked by hand (ignored by git, no tracked file, not a link or junction, `CACHEDIR.TAG`).
- **MacBook Air:** 886 strips and `uv cache prune` in 188 s, no failures, 2.6 GiB freed (Wave 0
  had freed 525 GiB by hand). LaunchAgent installed; `/Volumes/Dev/cache/*` aged at 7 days.
- **Random:** its afd worktrees belong to `~/afd`, not `~/github/afd`. 501 strips in 139 s, no
  failures, 19.9 GiB freed. LaunchAgent installed; `/Volumes/Dev/cargo-build/*` (192 GiB in 24
  per-worktree folders, all under six days old then) aged at 7 days.
- **Hero:** 626 strips in 336 s, no failures, 858.8 GB freed (C: 165, D: 693). Task Scheduler
  task installed (hidden, headless conhost, allowed on battery). Every walk was complete.
- Lushly's worktrees only get cache pruning until Lushly adopts `[disk]` (lushly#2697).

### Hero, 2026-11-20 (#1685)

- **Room to spare, same pattern.** C: has 2,754 GB free of 3,725, D: 1,669 of 3,726 and E: 2,347
  of 5,589 (all NTFS). The 84 worktrees hold about 1.4 TB, about 95% of it Rust `target/`
  folders in afd (`endpoints\umbel\target` alone is 83 to 149 GB per copy); 12 afd worktrees are
  over 50 GB. Lushly's 29 worktrees hold 35 GB.
- **Where things live.** T3 Code's `worktreesDirectory` is `D:\Github\worktrees` (77 worktrees).
  Five afd worktrees sit under `C:\Users\falki\afd\.claude\worktrees`, inside the main
  checkout; one of them holds 150 GB. No Cargo `build-dir` or shared target is set.
- **pnpm** keeps its store at `D:\pnpm-store\v10` (1.9 GB) with the default import method, so
  the worktrees on D: hard-link to it and a prune is meaningful there.
- **Windows settings.** `core.longpaths` is on in git but `LongPathsEnabled` is 0, so the
  deletion code's long-path syntax matters. `%TEMP%` holds 32 GB. No scheduled cleanup exists.
- **disk-report ran** read-only in 19 s on 56 afd worktrees, and the botcore suite passed on
  Windows 11 (907 passed). It showed that worktrees on D: were not watched as a volume, now
  fixed.

### Wave 0 on the MacBook Air, 2026-11-20 (#1685)

- **Relief.** Deleted the Rust `target/` folders of the 18 afd worktrees registered in
  `~/github/afd` that had been idle for 3 days or more (git's records for the worktree, and every
  changed or untracked file), with nothing running inside them and no cargo or rustc running. Each
  folder held Cargo's `CACHEDIR.TAG`, was git-ignored and held no tracked file: 37 folders.
  `/Volumes/Dev` went from 53.3 to 577.9 GiB free. Nothing else was touched.
- **T3 Code removes its own worktrees when told to.** Its storage cleanup (read from the 0.1.x
  server bundle) is described in the proposal's [Who removes what](disk-hygiene.proposal.md#who-removes-what).
  Every rule is off by default. The Air had `worktreeOnDelete` on; Random had nothing on. Both
  use `worktreesDirectory = "~/dev"`, with `/Volumes/Dev/worktrees`, `Dev` and
  `D:\Github\worktrees` as previous folders, which T3 Code's cleanup still covers. Turning the
  recommended rules on is [#1686](https://github.com/lushly-dev/afd/issues/1686).
- **`pnpm store prune` empties a cloned store.** pnpm 10.32's prune removes every store file
  with a link count of 1. On APFS pnpm installs packages as clones, whose link count is always 1,
  so a prune deletes the whole store. Tier 0 runs it only where pnpm uses hard links.
- **The old cleanup agent's archives.** `/Volumes/Dev/cleanup-reports` holds full tar copies
  (~142 GiB) of 23 worktrees whose pull requests merged and whose originals were then deleted,
  plus compact archives without build output (~7 GiB), git bundles (~1 GiB per run) and two
  older runs (~26 and ~27 GiB). What to keep is
  [#1687](https://github.com/lushly-dev/afd/issues/1687).
- **Hero** was surveyed the same day; see its section above.

## Phase 0. Relief and facts

- Free space on the Air and settle the facts (#1685): done 2026-11-20; findings above.

- T3 Code's storage cleanup on each machine (#1686): waiting for the owner.

- The old cleanup agent's archives (#1687): waiting for the owner's decision.

## Phase 1. Report and the safe tiers

- `disk-report`, discovery, idle signals and config (#1688): merged in #1698 on 2026-11-20.

- `disk-reclaim` tiers 0 and 1 (#1689): merged in #1698 on 2026-11-20.

## Phase 2. Schedule, skill and rollout

- `disk-setup`, `disk-status` and the schedulers (#1690): merged in #1698 on 2026-11-20.

- The `disk-hygiene` skill and adoption in afd (#1691): merged in #1698 on 2026-11-20.

- Publishing a botcore release with the commands (#1692): the owner's step, after the pieces above.

- Adoption in Lushly ([lushly#2697](https://github.com/lushly-dev/lushly/issues/2697)): after the release.

- Rollout to the Air, Random and Hero, and retiring the cleanup agent (#1693): rolled out 2026-11-20 (see Findings); a week of receipts, then the cleanup agent is retired.

## Phase 3. Removing finished worktrees

- Tier 2, `disk-keep` and `disk-restore` (#1694): in PR #1723.

## Phase 4. Prevention

- One Rust build arrangement, the idle-worktree warning, one T3 Code worktree folder (#1695): not started.
