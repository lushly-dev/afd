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

### After prevention, 2026-11-21 (#1693, #1687, #1814)

- **Upgrade.** All three machines run main `cf8d067c5` (still reported as 0.7.0 until the release, #1692),
  all healthy, with tier 2 off. Idle worktrees: Air Lushly 120 (118 T3 Code's) and afd 29;
  Random Lushly 38 and afd 20; Hero Lushly 9 and afd 20. The warning fires on the Air for both
  and on Random for Lushly, until #1686's rules are on. Hero's dry run planned 216 GB in 546
  strips for its next daily run. No Cargo warning anywhere.
- **`git gc` made every worktree look active.** A gc in the Air's Lushly repository rewrote all
  154 worktrees' `logs/HEAD` (`git reflog expire --all` does that even when nothing expires), and
  the idle count dropped from 120 to 0. Their `HEAD` and `index` were untouched. The same reset
  held back tier 1 and tier 2 wherever gc runs more often than their limits. A reflog's time is
  now the earlier of the file's time and its last entry's timestamp, and a reflog that gc
  emptied (every entry older than 90 days) counts for nothing (#1814).
- **The old cleanup agent's archives (#1687).** Deleted 23 full payload tars from
  `20261120T082739Z-air-refresh` (140 GiB freed; `/Volumes/Dev` at 719 GiB free): 4 whose
  verified compact archives exist, and 19 whose original worktrees are still on disk, so the
  tar was a second copy. Kept `t3-d567fd3e`'s full tar (0.9 GiB; its original is gone and it has
  no compact archive), all manifests, receipts and git-admin tars, and both bundles (verified
  with `git bundle verify`). `DELETION-20261121.json` in that folder lists each deleted tar and its
  SHA-256. The three 2026-11-20 run folders are `[[aged]]` folders on the Air at 30 days, so the
  hourly job clears them around 2026-12-21. The 2026-11-13 and 2026-11-16 runs (~53 GiB) wait
  for the owner.

### The machines before prevention, 2026-11-20 (#1695)

- **T3 Code's worktree folder** is the same on both Macs, since its settings match: `~/dev` on
  the internal disk, with `/Volumes/Dev/worktrees` and `D:\Github\worktrees` kept as previous
  folders, so T3 Code still manages the worktrees there. Storage cleanup: only "when the thread
  is deleted" on the Air, nothing on Random (#1686).
- **Idle worktrees** (3 days or more): Air Lushly 120 of 148, afd 29 of 46; Random Lushly 37 of
  55, afd 20 of 28. Most are T3 Code's. With the limit at 20 the warning fires for three of the
  four until #1686's rules are on.
- **Cargo:** the Air sets nothing, so output stays inside each worktree. Random's `build-dir` is
  `/Volumes/Dev/cargo-build/{workspace-path-hash}`, which its `[[aged]]` folder covers; its
  192 GiB were all under 7 days old (the largest, `afd-p4`, 85 GB at two days). Hero could not
  be reached to check.
- **Factory's lane slots** (`<repository>.factory-slots/`) are detached worktrees that git
  lists. Tier 2 could have removed an idle one, a parked slot's validation record with it; they
  are now `managed_by: "factory"`.

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

- The old cleanup agent's archives (#1687): the full payloads deleted 2026-11-21, the rest
  kept 30 days (see Findings); the two older runs wait for the owner.

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

- Tier 2, `disk-keep` and `disk-restore` (#1694): merged in #1723 on 2026-11-20; off on every machine until `disk-setup --remove-landed`.

## Phase 4. Prevention

- One Rust build arrangement, the idle-worktree warning, one T3 Code worktree folder (#1695): merged in #1728 on 2026-11-21.

- `git gc` no longer makes every worktree look active (#1814): in this pull request.
