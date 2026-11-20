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
- **Hero** is surveyed in a separate run; its findings get their own section here.

## Phase 0. Relief and facts

- Free space on the Air and settle the facts (#1685): relief, T3 Code and pnpm done; Hero survey in progress.

- T3 Code's storage cleanup on each machine (#1686): waiting for the owner.

- The old cleanup agent's archives (#1687): waiting for the owner's decision.

## Phase 1. Report and the safe tiers

- `disk-report`, discovery, idle signals and config (#1688): built on branch `lush/disk-hygiene-plan`, with this status file and the proposal. Tested on macOS; Linux in CI; Windows on Hero.

- `disk-reclaim` tiers 0 and 1 (#1689): built on branch `lush/disk-reclaim`, stacked on #1688's branch. Tested on macOS; Linux in CI; Windows on Hero.

## Phase 2. Schedule, skill and rollout

- `disk-setup`, `disk-status` and the schedulers (#1690): not started.

- The `disk-hygiene` skill and adoption in afd (#1691): not started.

- Publishing a botcore release with the commands (#1692): the owner's step, after the pieces above.

- Adoption in Lushly ([lushly#2697](https://github.com/lushly-dev/lushly/issues/2697)): after the release.

- Rollout to the Air, Random and Hero, and retiring the cleanup agent (#1693): not started.

## Phase 3. Removing finished worktrees

- Tier 2, `disk-keep` and `disk-restore` (#1694): not started.

## Phase 4. Prevention

- One Rust build arrangement, the idle-worktree warning, one T3 Code worktree folder (#1695): not started.
