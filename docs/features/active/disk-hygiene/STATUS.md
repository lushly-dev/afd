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

### Hero's view and its first week of receipts, 2026-11-26 (#1693)

- **`--unclassified` on Hero** (botcore 0.8.0, `C:\Users\falki\afd`, 129 worktrees, 132 s,
  `complete: True`, no list truncated or incomplete): Specimen's staged `host-win32-x64/bin/`
  (23), `.specimen/` (16: 14 under `endpoints/loam/apps/notes/specimens/`, one under
  `endpoints/loam/packages/chrome/specimens/`, one at the root), Tauri's `gen/` (8),
  `packages/rust/Cargo.lock` (5), `.umbel/` (3), `.claude/worktrees/` (1) and Loam desktop's
  `dist-installers/` (1). Only the last was new and rebuildable: `build:installers` stages it
  and `clean` removes it, so it is now named. Botcore's `scan_unclassified`, run on that
  worktree with this branch's `botcore.toml` (`disk-report` reads `[disk]` only from
  `origin/main`), found nothing unclassified. `.specimen/` stays unnamed on purpose: it keeps
  capture sets, labels and evidence a decision has not yet recorded under `specimens/`.
- **Dry run** (`disk-reclaim`, tier 1; `disk-setup` has no dry-run mode and was not rerun, so
  `disk.toml` and the scheduled task are as verified on 2026-11-24): 2,505 strips and `uv cache
  prune`, 77.45 GB planned (botcore's GB, 2^30 bytes), no failures. Ten entries were checked by
  hand, the four largest `**/target` (20.5, 12.4, 8.1 and 3.8 GB, each with `CACHEDIR.TAG`,
  idle 1.1 to 1.6 days against a 1-day limit) and one each of `dist`, `*.tsbuildinfo`,
  `coverage`, `health-dashboard/test-results`, `*.egg-info` and `__pycache__` (idle 3.3 to 3.9
  days against 3): all ignored, no tracked file, no reparse point, no `.git` inside, inside
  their worktree.
- **Receipts.** Six applies, 2026-11-20 to 2026-11-25: the rollout's at 23:43Z on 2026-11-20,
  then the scheduled daily run (23:03Z, then 22:02Z to 22:15Z). 627, 598, 1,654, 921, 131 and
  106 actions, all `done`, no failures, 1,728.8 GB in all on `D:\` and a net 164.4 GB on `C:\`.
  Neither volume went below its 100 GB threshold (C: 2,650 GB and D: 2,588 GB free today).
- **Idle worktrees.** Today's dry run counted 64 idle afd worktrees (59 T3 Code's) and 23 in
  Lushly (all T3 Code's), up from 23 and 21 at the 2026-11-25 apply.
- **Lushly has no `[disk]` list yet**, so every ignored path in its 60 worktrees is
  unclassified (13 lists hit the 50-path limit): per-package `node_modules/`, `.turbo/` and
  `dist/`, `coverage/`, `custom-elements.json`, `artifacts/`, `apps/web/public/field-notes/` and
  `apps/web/public/site/theme/`, `.env` copies and a few one-offs. Naming them is
  [lushly#2697](https://github.com/lushly-dev/lushly/issues/2697).

### The Air reads unhealthy from test fixtures in a temp root, 2026-11-26 (#1693, #2625)

- **The Air's applied reclaim of 2026-11-25 21:47Z had 679 failures,** and `disk-status` turned
  unhealthy the day before the tier-2 check. Each was an `[[aged]]` entry under
  `/Volumes/Dev/tmp/*` whose folder held a git checkout, which the reclaim leaves in place and
  scores as `partial`. Its other 2,646 actions were done, 115.61 GB on `/Volumes/Dev`.
- **677 were git fixtures that three script tests never removed** (`check-doc-lines` and the
  release `changeset` and `fragments` tests). One more was a session's own temp folder holding
  203 of the same. Those 880 (97 MB) were removed by hand once every commit in each was shown
  to be a fixture's (`t@example.invalid` or `fixture@example.invalid`). Those three tests, and
  three that leaked plain folders (`check-versions`, release `language` and `control`), now
  remove their fixtures when the file's tests finish.
- **The last is pytest's own `pytest-of-<user>`,** which keeps three runs, some holding a git
  repository from `tmp_path`. It was left in place. A kept checkout still scores as a failure,
  so a temp root a test suite writes to keeps a machine unhealthy: #2625.

### Hero verification checklist and in-tree Umbel/Rust disk guards, 2026-11-24 (#1693, #2241)

- **Hero checklist verified (#1693):** `lushly-botcore` v0.8.0 (`87d0a184e`) is healthy on Hero
  with Task Scheduler active, `last_apply` `2026-11-24T22:03:38Z` (`ok: true`, `271.25 GB`
  reclaimed on `D:\`), `C:\` at `2,911.64 GB` free and `D:\` at `2,590.06 GB` free (both verified),
  and `skill_usage` healthy (+13). `disk-report --repo C:\Users\falki\afd --unclassified --budget 600`
  completed across all 115 afd worktrees (`complete: True`); the top 3 planned tier-1 strips
  (15.7, 4.39 and 3.18 GB `**/target` dirs) all verified `ignored=True`, `tracked=0`,
  `LinkType=''`, and `disk-setup` produced an empty diff (`remove_landed: false`, `[tools]`
  unchanged). The only unnamed rebuildable cache was `.mypy_cache/` (26 copies across five Python
  units), now added to `.gitignore` and `botcore.toml`'s `[disk].regenerable`.
- **In-tree Rust target disk guards (#2241):** Added `scripts/cargo-target.mjs` so
  `scripts/umbel-components.mjs`, `scripts/build-site-umbel.mjs` and `scripts/rust-sweep.mjs`
  resolve external Cargo target directories (`UMBEL_TARGET_DIR`, `CARGO_TARGET_DIR`,
  `CARGO_BUILD_TARGET_DIR`, `.cargo/config[.toml]` `[build] target-dir`) instead of relying on
  in-tree `endpoints/umbel/target` (Umbel's Rust test helpers already gained `build.build-dir` and
  `CARGO_TARGET_DIR` support in #2425). `pnpm verify` (`scripts/affected.mjs`) now checks free
  space on every planned Rust step's target/build volume via `fs.statfsSync` after `rust-sweep`
  and refuses to start below `AFD_VERIFY_MIN_DISK_GB` (default `15` GiB). `botcore disk-reclaim`
  now runs a largest-first `pressure-large` tier-1 pass on still-low volumes for `when = "idle"`
  build directories `>= 5 GiB` in strippable worktrees idle at least `1 hour` (pairing ancestor
  build-info file strips first and stopping per volume as soon as it recovers), and `_recheck_strip`
  now guards directories whose `.cargo-lock` is held.

### Cargo build-dir bloat and aged-folder pressure escalation, 2026-11-23 (#2373)

- **Random's `/Volumes/Dev` filled to 100% (163 MB free) with ~555 GB in `/Volumes/Dev/cargo-build`**
  while `botcore disk-run` was running hourly and detecting `below_threshold`, because `disk-setup`
  suggested `max_age_days = 7` with no `max_gb` cap, low-space pressure only escalated tier-1
  worktree strips and never `[[aged]]` folders, `cargo-build/*` aged/evicted at the 2-hex bucket
  level instead of per `{workspace-path-hash}` workspace dir, `_recheck_aged` globally blocked all
  aged deletions whenever any `cargo`/`rustc` process ran anywhere on the machine, and manual
  Cargo folders without `CACHEDIR.TAG` (such as `afd-p4`) caused `_cargo_only` to return `False`.
- **Fixes landed in #2373:** `cargo.py` now suggests `max_age_days = 2` with a volume-scaled
  `max_gb` cap (40–150 GB) and recognizes non-hash Cargo build dirs in `_cargo_only`; `caches.py`
  descends into `<2-hex>/<hash>` buckets per workspace dir (preserving non-bucketed folders) and
  `reclaim.py` prunes empty 2-hex buckets afterward; `disk-reclaim` escalates `[[aged]]` entries
  oldest-first under low space (1 day, 6 hours, then oldest-first down to a 1-hour safety floor,
  stopping as soon as the volume recovers); and `_recheck_aged` scopes Rust build protection to
  matching processes, held `.cargo-lock` files, and recently modified entries (1-hour window).

### Air check and macOS boot-snapshot volume IDs, 2026-11-23 (#1693, #2267)

- **macOS updates change `/`’s `VolumeUUID` and stop `disk-reclaim`.** After the MacBook Air
  rebooted into macOS 27.2.1 (`26B131`), `diskutil info -plist /` reported a new
  `APFSSnapshotUUID` as `VolumeUUID` (`A1C60873-3A07-4715-9EBE-706397D96C4E` →
  `4A1CF365-F960-4F6F-8FE0-69F82179D917`), while `APFSVolumeGroupID` stayed
  `C900986E-2973-4757-BA84-0844B6A9EED8` (matching `/System/Volumes/Data`). Because `disk.toml`
  recorded `VolumeUUID`, `disk-status` went unhealthy and `disk-reclaim` blocked both `afd` and
  `lushly`, reclaiming `0.00 GB` while `/` sat at 32.46 GB free (< 46 GB threshold).
  `_darwin_volume_id` now prefers `APFSVolumeGroupID` for APFS snapshots, `volume_state` still
  accepts the current snapshot UUID from the same `diskutil` read until `disk-setup` reruns,
  and `disk-setup` migrates an internal `/` without ever overwriting external volumes (#2267).
- **Air `--unclassified` check (102 afd worktrees, `complete: True`):** only intentionally
  unnamed or one-off entries remained: `foundations/specimen/packages/host-darwin-arm64/bin/`
  (13), `endpoints/loam/packages/desktop/src-tauri/gen/` (7), `packages/rust/Cargo.lock` (6),
  `.umbel/` (5), `.factory/` (3), `.claude/worktrees/` (1), `.playwright-mcp/` (1),
  `python/.mypy_cache/` (1) and `.claude/*.DS_Store` (2).

### afd's `regenerable` list finished, 2026-11-22 (#1693, #1686)

- **T3 Code's storage cleanup is on** on Random, the Air and Hero, as the owner confirmed
  (#1686 closed). The idle-worktree warnings should fade as its rules remove settled and
  merged worktrees.
- **`--unclassified` on Random** (31 afd worktrees, 22 s, complete, nothing due for tier 1): it
  lists at most 50 paths per worktree, and three worktrees hit that limit, so the full list
  came from botcore's own functions with the limit lifted. Grouped: `__pycache__` (211),
  `*.tsbuildinfo` (46), `.ruff_cache` (25), `.pytest_cache` (22), FAST-AF's api-extractor
  `temp` (17), `test-results` below the root (14), Specimen's staged host `bin` (6),
  `*.egg-info` (6), the todo example's CMake `build`, Tauri's generated `gen` and
  `permissions/autogenerated`. All of what Random's report found is named now, except
  Specimen's host `bin` and Tauri's `gen/` beyond `schemas` (see below), plus `.vitest/` and
  two FAST-AF outputs the reviewers found by reading the ignore files. A sample of three per new pattern was checked by hand: ignored, no
  tracked file, not a link, inside the worktree, no `.git`.
- **A stripped `dist` did not come back.** `tsc` 7.0.2 with `incremental` emits nothing when
  `tsconfig.tsbuildinfo` survives and `dist` is gone, so a TypeScript package tier 1 stripped
  could not be rebuilt until its build info was deleted by hand. `**/*.tsbuildinfo` now goes
  with `**/dist`, and the bundled `disk-hygiene` skill says so for every adopting repository.
- **`.pytest_cache` and `.ruff_cache` ignore themselves** with a `*` inside, so to
  `git check-ignore` the folder itself is not ignored and tier 1 refused it. The root
  `.gitignore` now names both. Tier 1 reads each worktree's own `.gitignore`, so a worktree cut
  before this change still refuses them; tier 2 already counts them as rebuildable.
- **Left unnamed on purpose:** `.umbel/` (an Umbel workspace with keys and a journal),
  `docs/features/proposed/component-briefs/held/` (excluded locally in the main checkout),
  Specimen's staged host `bin` (one staged from CI with `--binary` cannot be rebuilt locally),
  `test-results` other than the four test-output folders the config names (Specimen's
  experiment driver keeps evidence in one) and all of Tauri's `gen/` but `gen/schemas` (it
  also holds Android version state).
  An unnamed ignored path keeps tier 2 from removing its worktree, which is what they need.
- **`dist` and its build info go as two actions.** A run interrupted between them, or a build
  info file Windows has locked, still leaves stale build info (#1939).
- **A folder holding only ignored content** (`frontends/vanilla/` with only `node_modules`) is
  reported as one collapsed entry that no pattern matches, so it shows as unclassified and
  blocks tier 2 although every file in it is covered (#1933).
- **`disk-setup` on Random** changed no repository, volume, `[[aged]]` folder or tier 2
  setting and reinstalled the LaunchAgent, but rewrote `[tools]` from the agent shell's PATH
  (Node 26 to 24, Homebrew's `pnpm` to corepack's inside a Node version folder). The old values
  were restored by hand (#1934).

### The scheduled job and macOS consent, 2026-11-21 (#1902)

- **The first reclaim the schedule ran alone never ended**, on the Air and on Random. On the
  Air it began when `/` fell below its threshold and waited in a folder listing for 2 hours
  22 minutes, until the process was ended. A scheduler starts no run while one is alive, so
  there was no check and no reclaim in that time, and the volume went under 2 GB free. On
  Random the same run came 23 hours after the reclaim run by hand.
- **Cause.** macOS asks at the screen before a scheduled program reads a removable volume,
  and holds the read for the answer (`tccd` logs `AUTHREQ_PROMPTING` for
  `kTCCServiceSystemPolicyRemovableVolumes` and the job's Python). Both machines keep
  worktrees on an external volume. Every reclaim before had been run from a terminal, which
  has its own consent, and the run setup starts only checked free space: a reclaim had just
  been run by hand, so none was due.
- **What changed.** On macOS a run reads every folder it will need first, so the question
  comes in the run setup starts. The disk work and the collection are steps: the scheduler's
  run waits for the disk work while it says it is working, leaves it after five minutes of
  silence, and `disk-status` names the folder it waited for and the program to allow.
- **What review changed.** The first design kept a run waiting until it was 50 minutes old,
  to keep the question on the screen. Both reviewers found what that cost: a reclaim still
  working at that minute was recorded as waiting, a busy collection could hold the run, and
  a host that called the command kept a thread running after it returned. A waiting step is
  now left after five minutes, a working one is never cut short, and only the scheduler's
  own process leaves anything behind. The second pass found that a step left in a read
  could go on to remove things once the read came back, after the run had reported it as
  waiting. A step that is left is now told so, right before each thing it would remove and
  before it writes a receipt or a record, and starts nothing more. What a step says and
  whether it was left belong to the step: they were kept by thread number at first, which
  the next thread is given.
- **Tried on Random with the question still open**, as a scheduled program with shortened
  waits and a reclaim that removes nothing: 20 seconds in, the status named `/Volumes/Dev`
  and what to allow; the collection ran and was shared; the run ended by itself. The first
  try blamed the git command that had just returned, since a command's allowance outlived
  it, and Cargo's settings were read from the worktrees before the worktrees were named.
- **Once the owner had answered on Random**, the run that had waited three hours finished,
  and the next scheduled run stripped 13 folders, some of them on the external volume. The
  final code, started the same way with a reclaim that removes nothing, ran the folder pass,
  the collection and the shared copy in 51 seconds.
- **A dry run's `planned_gb` has no figure for `node_modules` and `.venv`.** On the Air a dry
  run planned 0.05 GB, and the scheduled run a quarter of an hour later removed 646 folders
  and freed 1.29 GB.

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

- T3 Code's storage cleanup on each machine (#1686): turned on on all three machines, as the
  owner confirmed on 2026-11-22.

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

- Rollout to the Air, Random and Hero, and retiring the cleanup agent (#1693): rolled out 2026-11-20; afd's `regenerable` list finished and Random set up again 2026-11-22, Air verified 2026-11-23, Hero verified 2026-11-24, Hero's list and dry run rechecked 2026-11-26 (see Findings); the Air and Random rechecked against the new list (Hero's cell cannot reach them), a week of receipts on each, then the cleanup agent is retired.

- A scheduled run that waits for ever (#1902): merged in #1923.

- Stable APFS volume-group ID on macOS `/` snapshots (#2267): merged in #2285.

- A git checkout kept inside an `[[aged]]` folder is a warning, not a failure (#2625): merged in #2761.

## Phase 3. Removing finished worktrees

- Tier 2, `disk-keep` and `disk-restore` (#1694): merged in #1723 on 2026-11-20; off on every machine until `disk-setup --remove-landed`.

## Phase 4. Prevention

- One Rust build arrangement, the idle-worktree warning, one T3 Code worktree folder (#1695): merged in #1728 on 2026-11-21.

- `git gc` no longer makes every worktree look active (#1814): in this pull request.

- Cargo `build-dir` defaults, per-workspace bucket eviction, scoped Rust build protection, and `[[aged]]` low-space pressure escalation (#2373): merged in #2377.

- External Umbel Cargo target resolution, `pnpm verify` Rust disk-floor preflight, and `disk-reclaim` large in-tree output pressure escalation (#2241): merged in #2523.
