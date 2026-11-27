# Disk hygiene for development machines

> **Goal:** Random, the MacBook Air, Hero and any contributor's machine stop filling up with
> worktrees, build output and tool caches, and nobody has to start a cleanup agent by hand.

| Field | Value |
| --- | --- |
| Status | Active since 2026-11-20. Progress in [STATUS.md](./STATUS.md) |
| Epic | [#1684](https://github.com/lushly-dev/afd/issues/1684) |
| Author | jasfalk (drafted with Claude Code: Opus 5.5, reviewed by Fable 5.2) |
| Origin | A Lushly session on 2026-11-20, after the Air's external drive filled in ten days |
| Packages | `endpoints/botcore` (the `disk-*` commands and the `disk-hygiene` skill); adoption in this repository and in [lushly-dev/lushly#2697](https://github.com/lushly-dev/lushly/issues/2697) |
| Machines | Random (Mac mini), MacBook Air, Hero (Windows x64), contributors |

## The problem

Parallel agent sessions each get a git worktree, build in it and leave it behind. Build
output, test output and tool caches pile up until a drive fills. Until now a cleanup agent was
started by hand, about once a day, after a drive was already full.

Measured on the MacBook Air on 2026-11-20 (GiB, as `df` and `du` report them):

| Location | Before Wave 0 | What it is |
| --- | --- | --- |
| `/Volumes/Dev` (932 GiB external, USB) | 53 GiB free | Filled in ten days: its oldest worktree is from 2026-11-10 |
| `/Volumes/Dev/worktrees/afd` (51 worktrees) | ~611 GiB | Almost all Rust `target/` folders. The largest was 68 GiB, last built eight days earlier |
| `/Volumes/Dev/cleanup-reports` | ~172 GiB | The cleanup agent's own archives: 142 GiB of full worktree copies from one run |
| `/Volumes/Dev/worktrees/lushly` (105 worktrees) | ~92 GiB by `du` | `node_modules`, `dist`, `.turbo`, test output. The real cost is lower (see below) |
| `/Volumes/Dev/cache/umbel-target` | ~44 GiB | A Rust target folder shared between worktrees |
| Internal disk (460 GiB) | 16 GiB free at 00:30, 132 GiB at 12:50 | The cleanup run in between archived worktrees to the external drive, then removed them |
| `~/dev` | 47 Lushly worktrees | Up from 30 twelve hours earlier. T3 Code creates new worktrees here |

Wave 0 deleted the Rust `target/` folders of 18 idle afd worktrees and freed 525 GiB:
`/Volumes/Dev` went from 53 to 578 GiB free. Random has the same layout with more room (42 GiB
free internally, 490 GiB on its Dev volume on 2026-11-20).

### Why it happens

1. **T3 Code's own worktree cleanup is mostly off.** T3 Code creates a worktree per thread and
   has a storage cleanup that removes them (see [Who removes what](#who-removes-what)). Every rule
   is off by default. On 2026-11-20 the Air had only "remove when the thread is deleted" on, and
   Random had nothing on. Lushly's `end-session` deliberately leaves the worktree to the harness,
   so nothing else removes it either.
2. **Idle worktrees keep their Rust output.** This repository already limits Rust output:
   `.cargo/config.toml` turns off incremental builds and `pnpm rust:sweep` evicts stale builds. The
   sweep only runs inside `pnpm verify`, so a worktree nobody returns to keeps everything it built.
3. **The machines are set up differently.** Random's Cargo config sends build output to
   `/Volumes/Dev/cargo-build/<hash of the worktree path>`. The Air has no such setting, so output
   lands inside each worktree. Nothing removes Random's per-path folders when their worktree goes.
4. **The cleanup agent kept what it should delete.** It archived whole worktrees, build output
   included, before removing them. That moved the problem from one disk to the other, and cost
   tokens and supervision on every run.

### Three measurement traps

- **`du` overstates `node_modules`.** pnpm on APFS installs packages as copy-on-write clones of
  its store, so many worktrees share the same blocks. Adding up `du` for the Dev volume gave about
  90 GiB more than the volume used. Deleting `node_modules` frees much less than `du` suggests,
  while a Rust `target/` frees all of it. The tool measures what it reclaimed from the change in
  free space, never from `du`.
- **`pnpm store prune` empties a cloned store.** pnpm 10's prune deletes every store file whose
  link count is 1, which it takes to mean "no project links it". Clones always have a link count
  of 1, so on APFS a prune deletes the whole store and the next install downloads everything
  again. Prune is only meaningful where pnpm links packages with hard links (Windows, Linux).
- **Worktrees live in many places.** On these Macs: `~/dev`, `/Volumes/Dev/worktrees/*`,
  `~/.t3/worktrees`, `~/.codex/worktrees`, `.claude/worktrees` inside checkouts, and the main
  checkouts. A cleanup that works from a list of folders misses some. The tool starts from git's
  own list (`git worktree list`) for each registered repository.

## What other teams do

Published approaches (vendor guides, CleanMyMac's `purge`, `npkill`, `kondo`, `cargo-sweep`,
and the worktree guides written for parallel agents) work in four layers:

1. **Share build output instead of keeping it per worktree.** pnpm's store, Turbo's cache,
   `sccache` or a shared target folder for Rust.
2. **Tie a worktree's life to its branch.** Remove it once the work has merged.
3. **Strip idle projects without deleting them.** Delete rebuildable folders from projects
   untouched for about a week and leave recent work alone.
4. **Prune tool caches with each tool's own command**, never during an install.

All of it runs as a plain scheduled job with a dry-run mode and a low-space trigger. Nobody uses
an agent for the routine part. This proposal follows that pattern and keeps agents for the cases
a script should not decide.

## Goals

- No drive on Random, the Air or Hero fills up with development leftovers, and nobody has to
  start a cleanup agent.
- Nothing that cannot be rebuilt or restored is deleted automatically. When unsure, report and
  leave the files alone.
- One tool for macOS, Windows and Linux, shipped with botcore, installed by one setup command,
  usable by any repository that adopts botcore.
- Agents that need space call the tool. They never run `rm -rf`, `git worktree prune` or a cache
  wipe by hand.
- If the scheduled job stops working, the next agent session says so.

## Non-goals

- Shrinking a repository's source or bundle. That is the bloat sweeps' job.
- Remote or cloud development environments.
- Anything outside developer folders, such as Photos, Mail or iCloud.
- Agent transcripts and memory (`~/.claude`, `~/.codex`, `~/.t3`). They cannot be rebuilt: the
  tool reports their size and never deletes them.

## Who removes what

Two tools act, and each owns a different thing, so they never race for the same folder.

| What | Who | How |
| --- | --- | --- |
| Worktrees T3 Code created, under its worktree folders | T3 Code | Its storage cleanup rules (below) |
| Other worktrees: Codex, Claude Code, a contributor's own, and folders under T3 Code's roots that no thread uses | `botcore disk-*` | Tier 2, opt-in |
| Build output inside any idle worktree | `botcore disk-*` | Tier 1 |
| Tool caches and cache folders outside worktrees | `botcore disk-*` | Tier 0 |

**T3 Code's storage cleanup** (Settings, storage cleanup; per project or for every project)
removes a worktree with `git worktree remove` and keeps its branch. A rule makes a worktree
eligible: its pull request merged with this exact head, its thread deleted, its thread settled
for N days, or N days without activity. It is then still kept while the thread or a subagent is
running or has pending work, a terminal or provider session is open in it, its branch changed,
it has uncommitted changes (including changes hidden with `skip-worktree`), a submodule has
commits on no remote, several unrelated threads share it, or its thread has no branch. It only
acts inside its current and previous worktree folders, and it reports folders no thread uses
without removing them. With "keep worktrees with any local files", ignored files other than
`node_modules` also keep a worktree.

Recommended on every machine that runs T3 Code ([#1686](https://github.com/lushly-dev/afd/issues/1686)):
keep worktrees with uncommitted changes; remove when the pull request is merged, when the thread
is deleted, and after the thread has been settled for 7 days; remove logs and browser artifacts
after 14 days. On macOS, T3 Code's Labs option to clone new worktrees from a cached checkout
also makes each new worktree cheaper.

## Design

### Where it lives

All of it is botcore code in `endpoints/botcore`, published to PyPI as `lushly-botcore`:

- **`disk-*` commands in botcore core.** They follow botcore's existing shape: flat kebab-case
  names like `skill-seed`, CommandResult output, CLI and MCP exposure. They are core, not a
  plugin, because every repository that uses botcore needs them and a plugin adds an install step.
- **No new dependency.** The processes using a worktree come from each platform's own tools:
  `lsof` and `ps` on macOS, `/proc` on Linux, and process command lines on Windows, which does
  not expose another process's working directory (a folder in use there cannot be deleted, so a
  strip reports it as partial).
- **A bundled `disk-hygiene` skill.** `skill-seed --update` copies bundled skills into each
  repository unless its `[skills].skip` lists them.
- **Two settings files.** Repository settings go in a new `[disk]` section of `botcore.toml`.
  Machine settings go in a per-user file, which botcore does not have today and this work adds.

### Commands

| Command | What it does |
| --- | --- |
| `botcore disk-report` | Read-only. Lists every worktree of every registered repository with its tier (below), what it would reclaim, and free space per volume. `--unclassified` lists ignored files no rule covers |
| `botcore disk-reclaim [--tier N] [--apply]` | A dry run unless `--apply` is passed. Carries out actions up to the given tier and writes a JSON receipt |
| `botcore disk-keep <path> [--until DATE] [--reason]` | Protects a worktree from every action with `git worktree lock`, which git itself also honors. A keep lasts 14 days unless `--until` says otherwise; past its date it still protects, and the report lists it so it is renewed or released. `disk-unkeep` releases only a keep it made, never another tool's lock |
| `botcore disk-restore <path>` | Puts back a worktree the tool removed, at the same path and commit, from the removal record: on its branch if the branch still points there, on a recreated branch if it was deleted, else detached at the commit |
| `botcore disk-setup [--uninstall]` | Safe to run again. Writes the machine settings, registers the current repository and installs or removes the schedule |
| `botcore disk-status` | The schedule, the last run and whether it succeeded, free space per volume, and anything waiting for a decision |

### What counts as idle

A folder's own modification time does not change when files deeper inside it change, so it is
not used. A worktree's last activity is the newest of:

- git's record for that worktree (`HEAD`, `index`, `logs/HEAD`, `ORIG_HEAD` and `FETCH_HEAD` in
  the repository's `worktrees/<id>` folder), which changes on checkout, commit, staging, reset,
  merge and fetch. For `logs/HEAD` it is the earlier of the file's time and its last entry's
  timestamp, and nothing for an empty one: `git gc` rewrites every worktree's reflog without
  adding an entry, and empties one whose entries have all expired (#1814);
- the modification time of any file git reports as changed or untracked;
- the top level of each declared build-output folder.

A worktree is busy, whatever its age, while a running process has its working directory inside
it or names its path on the command line.

### Tiers

The tool takes the cheapest action that frees enough space.

| Tier | Action | Conditions (all must hold) |
| --- | --- | --- |
| 0 | Prune tool caches with each tool's own command, and clear machine-listed cache folders past their age or size limit | No install or build for that tool is running. `pnpm store prune` only where pnpm uses hard links |
| 1 | Strip rebuildable output from an idle worktree | Idle for the pattern's threshold (3 days by default, 1 day for Rust `target/`). Every deleted path is git-ignored, holds no tracked file and resolves inside the worktree. Not a main checkout. Not kept. Not busy |
| 2 | Remove a finished worktree with `git worktree remove`; the branch stays | Not under T3 Code's worktree folders, unless no thread uses it. Nothing unique lives in it (below). Its work has landed. Idle for 7 days. Not a main checkout. Not kept. Not busy. Off unless `disk-setup --remove-landed` |
| 3 | Report only | Everything else. Never acted on automatically |

**Tier 1 order.** Patterns are stripped in the order that frees the most. Folders that share
blocks with a package store, such as `node_modules`, are marked `when = "pressure"` and are only
stripped when space is low. Each receipt records what every pattern really freed, so the order can
be corrected from evidence.

A strip leaves a small record in the worktree's git folder (not in the working tree).
`disk-report` and session preflight read it, so the next session knows to install and build
again. A strip that fails part-way, for example on a file Windows has locked, is recorded and
left; the output was rebuildable either way.

**Tier 2: "nothing unique lives here".** Removing a worktree keeps its branch and commits, so the
question is what else would be lost. All of these must hold:

- no modified, staged or untracked files, no edit hidden behind `skip-worktree` or
  `assume-unchanged` (git status does not show those), and no rebase, merge, cherry-pick or
  bisect in progress;
- the checked-out commit is reachable from a branch, a remote or a tag;
- no per-worktree git state removal would delete and a restore could not bring back:
  `refs/worktree/*` or `refs/bisect/*` refs, its own `config.worktree`, its own sparse-checkout
  rules;
- every git-ignored file is either declared rebuildable or is a declared copy identical to the
  same plain file in the main checkout (for example a `.env` copied in at setup), and no
  rebuildable folder hides a git checkout, a registered worktree or a changed declared copy.

Tier 2 is off on a machine whose T3 Code settings cannot be read, since which worktrees T3 Code
manages is then unknown. Before git removes anything, the commit and every commit only the
worktree's HEAD reflog reaches are pinned under `refs/botcore/removed/<name>-<time>/`, and a
pending removal record is written; no later branch deletion, remote prune or gc can take them.

**Landed** means one of these, checked in this order:

1. the commit is an ancestor of the landing ref (`origin/main`);
2. every path any of the branch's commits touched (both sides of renames, reverted paths too)
   matches the landing ref: the content check that survives squash merges;
3. the branch's pull request is merged and its head is this commit (needs `gh`; skipped offline).

An applied tier 2 run fetches only the landing ref's branch from its own remote first, after the
volume checks, without pruning or prompts; if that fetch fails, nothing that relies on landing is
removed from that repository.

Worktrees that pass "nothing unique" but have not landed stay in Tier 3, labeled **restorable**.
An agent or a person can remove them in bulk with `disk-reclaim --include-restorable`. Every
removal is recorded, and `disk-restore` recreates the worktree at the same path.

### Rules for every run

- **Check the volume before touching git's records.** When an external drive is unplugged, git
  sees its worktrees as deleted, and `git worktree prune` would erase their records. Setup records
  each volume's identifier. A run skips a repository entirely unless every volume holding its
  worktrees is mounted and matches. A plain folder left at the mount path while the drive is away
  does not count as mounted, and a permission error does not count as "missing".
- **Stay inside known roots.** Every deleted path must resolve, after following links, inside a
  registered worktree or a cache folder named in the machine settings. Anything else is refused,
  including a home folder or a drive root.
- **Delete links, never what they point to.** Symlinks and Windows junctions are removed as
  links. pnpm's `node_modules` on Windows is made of junctions.
- **Never delete through a checkout.** A folder holding `.git`, such as a Claude Code worktree
  under `.claude/worktrees/`, is its own worktree with its own age and lock: a pattern walk
  never enters it, a folder holding a registered checkout at any depth is refused, and the
  deletion code itself stops at any folder holding `.git`. Inside an `[[aged]]` folder, such
  as a temp folder a test suite writes fixtures to, the checkout it keeps is reported as kept,
  a warning that names it, and not as a failure (#2625).
- **Verify what a folder is.** A registered worktree folder replaced by a link or by another
  repository's checkout is not inspected; a folder that cannot be read is not "missing"; a
  missing folder whose parent is gone too blocks its repository (an unplugged drive).
- **No copies of rebuildable output.** There are no backups or payloads. A worktree holding unique
  work is never touched, so there is nothing to back up.
- **One run at a time per machine**, enforced with a lock file.
- **Receipts are capped** at the last 30 runs and 50 MB, in the platform's state folder.

### When space is low

Each volume has its own threshold, because an internal disk and an external drive differ in size
and in what else lives on them. When a volume falls below its threshold:

1. A full run starts at once, without waiting for the daily one.
2. If that is not enough, the Tier 1 idle threshold drops in steps (3 days, 1 day, then a floor of
   6 hours without activity) and `when = "pressure"` patterns are included. Stripping is always
   recoverable, so this trades rebuild time for space. Tier 2 rules never relax.
3. If the volume is still low, the tool stops. It records the state, raises a system notification
   and lists the largest folders it does not manage. It does not retry every hour.

### Configuration

Repository settings in `botcore.toml`, checked in. This repository would declare:

```toml
[disk]
landing_ref = "origin/main"
regenerable = [
  { path = "**/target", after_days = 1 },
  "**/dist", ".turbo", "**/.turbo", "coverage", "test-results", "playwright-report",
  { path = "node_modules", when = "pressure" },
  { path = "**/node_modules", when = "pressure" },
  { path = "**/.venv", when = "pressure" },
]
```

Machine settings in a per-user file, not checked in:

```toml
repos = ["~/github/lushly", "~/github/afd"]   # main checkouts; worktrees are found from these
strip_after_days = 3
remove_landed_after_days = 7
caches = ["pnpm", "uv", "playwright"]

[[volume]]
mount = "/"
low_space_gb = 30

[[volume]]
mount = "/Volumes/Dev"
id = "…"            # written by setup; a run skips this volume if it does not match
low_space_gb = 80

[[aged]]            # cache folders outside any worktree
path = "/Volumes/Dev/cache/*"
max_age_days = 7
max_gb = 60

[[aged]]
path = "/Volumes/Dev/cargo-build/*"   # Random's per-worktree Cargo output
max_age_days = 7
```

Three rules keep configuration from becoming a way to delete the wrong thing:

- **Repository settings only reach inside that repository's worktrees.** Patterns are relative,
  cannot contain `..`, and are checked again after links are resolved. A path outside a worktree
  can only be named in the machine file, which the machine's owner writes. A repository may
  suggest `[[aged]]` entries; setup shows them and the owner accepts or declines.
- **Settings are read from the landing ref of the main checkout**, never from the branch checked
  out in a worktree. A branch under review cannot change what the scheduled job deletes.
- **Version skew fails loudly for one repository, not the whole run.** Botcore rejects config
  keys it does not know. The scheduled tool is one install per machine, so a repository whose
  `[disk]` section is newer than the tool is skipped and reported as "update the tool". A
  repository adds `[disk]` in the same pull request that raises its botcore pin.

### Scheduling

`disk-setup` registers one job with each platform's own scheduler:

| Platform | Mechanism |
| --- | --- |
| macOS | A LaunchAgent in `~/Library/LaunchAgents`, hourly and at login |
| Windows | Task Scheduler, hourly and at logon, as the current user, without elevation |
| Linux | A systemd user timer, falling back to a crontab line |

The hourly check reads free space and exits (on macOS it first reads each folder the job
needs, see below). A full run happens once a day, or at once when a volume is below its
threshold. The job runs a persistent install
(`uv tool install 'lushly-botcore==<version>'`), not `uvx`, whose environment lives in the
cache the job prunes. Setup records absolute paths to `git`, `pnpm`, `uv` and `gh`, because
scheduled jobs do not inherit a shell's `PATH`.

Platform traps the implementation must handle and test:

- **macOS privacy prompts.** A scheduled program needs the owner's consent to read removable
  and network volumes, files a cloud drive's app manages, and some home folders. macOS asks at
  the screen and holds the read until someone answers. So on macOS every run reads each
  folder it will need once the volumes are checked and before it decides whether to reclaim:
  the question then comes up in the run setup starts, with the owner present, and not in the
  first reclaim the schedule runs alone. No scheduled run waits for ever. The disk work is a
  step: the job waits for it while it says it is working and leaves it once it has said
  nothing for five minutes. A step that is left starts nothing more, and `disk-status` names
  the folder it waited for and the program to allow. A read the owner denied is an answer:
  the hourly check goes on, and the reclaim that needs the folder reports "no permission".
  The status itself gives everything it reads 20 seconds, so it cannot wait at the folder it
  is asked about.
- **Windows deletion.** Paths longer than 260 characters, read-only files (git marks pack files
  read-only) and files held open by another process all make a plain delete fail.
- **Windows scheduling.** Tasks default to not running on battery and flash a console window;
  setup turns both off.
- **Windows package store.** pnpm's store must be on the same drive as the worktrees, or pnpm
  copies every package instead of linking it. Setup checks this.

### Seeing that it works

- `disk-status` and a small status file record the last successful run, per-volume free space and
  anything in Tier 3.
- Session preflight warns when the last successful run is more than 48 hours old, when a volume
  is below its threshold, or when the session's own worktree was stripped.
- Receipts give a free-space history, which is how the acceptance criteria are checked.

### Prevention

- **The same Rust build settings on every machine.** SETUP picks one arrangement: Cargo's
  `target/` inside each worktree, where tier 1 and worktree removal reach it. A machine whose
  worktrees sit on a small disk may move Cargo's `build-dir` to an always-attached drive, with
  an `[[aged]]` folder covering it; `disk-setup` and `disk-status` warn when none does. A shared
  `CARGO_TARGET_DIR` is not used: parallel worktrees would wait on its lock and rebuild each
  other's changes. Specimen's pinned target folder stays as it is: changing it was reviewed and
  withdrawn on 2026-11-15.
- **Sweep outside `pnpm verify`.** `rust:sweep` keeps its per-build eviction for shared target
  folders. The scheduled tool covers what it cannot reach: idle worktrees and aged cache folders.
- **Warn on too many idle worktrees.** `disk-report` says so when a repository passes a set count,
  so the factory foreman sees the cost before starting more cells.
- **Park with a keep.** A session that parks its worktree calls `disk-keep`, so it is protected
  for a stated time, not forever.

### Agents and documentation

- **`disk-hygiene` skill**, bundled in botcore and seeded into repositories: when to use it
  (freeing space, removing a worktree, a failure caused by a full disk), the tiers, the commands,
  `disk-keep` for parked work and `disk-restore`. Its rules: never `rm -rf` a worktree, never run
  `git worktree prune` by hand, never copy build output "for safety". Its description must fit
  each consuming repository's skill-listing budget.
- **AGENTS.md** in each adopting repository: one pointer to the skill.
- **SETUP.md** in each adopting repository: install the pinned tool and run
  `botcore disk-setup`, for macOS, Windows and Linux.

## Phases

| Phase | Scope | Issues |
| --- | --- | --- |
| 0. Relief and facts | Free the Air; T3 Code's cleanup behavior; Hero's layout; pnpm prune; the archives; T3 Code settings on each machine | [#1685](https://github.com/lushly-dev/afd/issues/1685), [#1686](https://github.com/lushly-dev/afd/issues/1686), [#1687](https://github.com/lushly-dev/afd/issues/1687) |
| 1. Report and the safe tiers | Discovery, idle signals, config, `disk-report`, `disk-reclaim` tiers 0 and 1 | [#1688](https://github.com/lushly-dev/afd/issues/1688), [#1689](https://github.com/lushly-dev/afd/issues/1689) |
| 2. Schedule, skill and rollout | `disk-setup`, `disk-status`, schedulers, low-space behavior, the skill, adoption here and in Lushly, release, rollout to three machines | [#1690](https://github.com/lushly-dev/afd/issues/1690), [#1691](https://github.com/lushly-dev/afd/issues/1691), [#1692](https://github.com/lushly-dev/afd/issues/1692), [#1693](https://github.com/lushly-dev/afd/issues/1693), [lushly#2697](https://github.com/lushly-dev/lushly/issues/2697) |
| 3. Removing finished worktrees | Tier 2 for worktrees T3 Code does not manage, `disk-keep`, `disk-restore` | [#1694](https://github.com/lushly-dev/afd/issues/1694) |
| 4. Prevention | One Rust build arrangement, the idle-worktree warning, one T3 Code worktree folder per machine | [#1695](https://github.com/lushly-dev/afd/issues/1695) |

## Exit criteria

- For two weeks after rollout, every volume on all three machines stays above its threshold and
  nobody starts a cleanup agent. Receipts are the evidence.
- Tests on macOS, Linux and Windows show that a strip never deletes a tracked file or a path
  outside the worktree, and that a worktree with modified, staged or untracked files, an operation
  in progress, an unreachable commit or an edited declared copy is never removed.
- A scheduled run with the Dev volume unplugged changes no git worktree record.
- A removed worktree comes back with `disk-restore` at the same path and commit.
- A new contributor on macOS, Windows or Linux gets the schedule from one documented command and
  removes it with one more.
- An agent asked to free space uses the tool through the seeded skill, checked with one replay
  session per harness.
- With the scheduled job disabled for 48 hours, the next session's preflight says so.

The thresholds (3 days, 1 day for Rust output, 7 days, the 6-hour floor, per-volume free space)
are starting values. The rollout tunes them from receipts.
