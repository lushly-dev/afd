"""Core command documentation for botcore.

Each key is a topic name shown by the {name}-docs MCP tool.
Plugin-specific docs are registered via ``PluginRegistry.add_docs()``.
"""

from __future__ import annotations

CORE_DOCS: dict[str, str] = {
    "dev": """\
# Dev Commands

## dev_lint(package=None, fix=False)
Run linter (ruff for Python, biome for TypeScript).

## dev_test(package=None, coverage=False)
Run tests (pytest for Python, vitest for TypeScript).

## dev_build(package=None)
Build package.

## dev_check_size(paths=None)
Check file sizes against thresholds (warn: 500, error: 1000 lines).

## dev_check_coverage(paths=None)
Check test coverage against threshold.

## dev_check_deps()
Check dependency freshness.

## dev_dead_code()
Find unused code.

## dev_circular_imports()
Detect circular import chains.

## dev_unused_deps()
Find declared but unused dependencies.

## dev_dep_graph(format=None)
Visualize module dependency graph.

## dev_check_paths()
Detect hardcoded/non-portable paths.

## dev_skill_lint()
Run skill_lint over the configured skills directory.
""",
    "skill": """\
# Skill Commands: registry, lint and usage

Ownership lives in the frontmatter's `metadata:` map (`metadata.source`,
`metadata.version`, `metadata.portable`). A skill without a source is locally owned;
a top-level `source:`, `version:` or `portable:` (older copies) is still read.

## skill_list(show_source=False, plugin_dirs=None)
List available and installed skills with version and source info.

## skill_seed(update=False, dry_run=False, plugin_dirs=None)
Copy skills from botcore/plugin sources into project's .claude/skills/.
Sets `metadata.source` for ownership tracking, moving any top-level ownership fields
under `metadata:`.
Skills installed under a retired name (e.g. `manage-documentation`, renamed to
`docs-manager` in 0.4.0) are migrated when botcore owns them; otherwise they are
left in place, listed in `renamed_locally_owned`, and the new name is not seeded.
Skills botcore retired (`RETIRED_SKILLS`) are removed when botcore owns them, no
`include` list is set and `skip` doesn't name them; other copies are kept and listed
in `retired_locally_owned`. Both lists are in the result as `retired` and
`retired_locally_owned`.
- `update`: Also update stale skills (default: only new)
- `dry_run`: Preview changes without writing

## skill_status(plugin_dirs=None)
Detect version drift between installed and available skills.
Reports: ok, stale, missing, unmanaged, conflict, renamed, retired.

## skill_lint(path=None, strict=False)
Lint skills in the configured skills directory. `botcore skill-lint [path]`
(`skill_lint_spec`) runs the same rules over any directory.
- Errors: SK001 no SKILL.md or frontmatter, SK002 no `name`, SK003 no `description`,
  SK004 name not kebab-case, over 64 characters or unlike its directory, SK005
  description over 1,024 characters, SK008 missing `references/` file, SK015
  duplicate name.
- Warnings: SK009 body over 500 lines, SK010 placeholder text (TODO, FIXME, TBD,
  Lorem ipsum), SK012 `skill.md` instead of `SKILL.md`, SK014 orphan reference file,
  SK016 description over 300 characters, SK017 `triggers` field or "Triggers:" list,
  SK018 field outside the open standard and Claude Code (top-level `source`, `version`
  or `portable` belongs under `metadata:`), SK019 listing over `[skills]
  listing_budget` (default 8000: description plus `when_to_use`, skipping
  `disable-model-invocation: true`).
- Result: per-skill violations plus `listing: {characters, budget}`.
- `path`: Lint a specific skill path (default: all in skills dir)
- `strict`: Report every warning as an error

## skill_adopt(name, source="local")
Claim an unmanaged skill by setting `metadata.source`. A skill already owned by
`source` with top-level ownership fields has them moved under `metadata:`.

## skill_unadopt(name)
Remove `metadata.source` (or a top-level `source:`) from a skill.

## skill_index(write=True)
Generate `_index.md` table of all installed skills.
- `write`: Write file (default: True). False for preview.

## skill_usage_collect(since_days=None, t3_store=None, machine=None, rebuild=False)
Add the skill loads recorded since the last collection to this machine's skill usage record.
Nothing is added to a skill and no agent reports anything: the loads are read, read-only and
from one snapshot, from T3 Code's store, which covers its Claude and Codex threads alike.
- A load is: the Skill tool; a file tool that reads `…/skills/<name>/SKILL.md`; a shell command
  that shows the agent that file (`cat`, `sed`, `head`, `tail`, `nl`, `less`, `more`, `bat`,
  `awk`, `type`, `Get-Content`, `git show <revision>:<path>`); or a message the person wrote
  that opens by naming a skill (`$name`). Only completed calls count. A search, diff, listing
  or edit that names the file is not a load, nor a read sent to a file, a count or a search.
- It also records each session, whether or not it loaded a skill, with the session it came
  from (the one that delegated it, or the one it was forked from) and the pull requests T3
  Code linked to it or its subagents: when, and whether it opened each or attached itself to
  one that existed; and each change a session made to a skill's files (`loads_added` and
  `edits_added` count the two kinds of event). No title and no branch name is kept.
- The record (`events.jsonl` and `sessions.json` in botcore's state folder) holds the skill,
  time, harness, model, project (`owner/name` from the checkout's origin), session and agent.
  It never holds a prompt, a command, arguments, a title or file contents.
- It continues from the last collection and reads everything again once a week. The hourly
  job `disk-setup` installs runs it, so it is run by hand only for a first collection.
- Several machines: each names itself and one shared folder in its machine settings
  (`disk.toml`: `skill_usage_machine = "<name>"`, its hostname when left out, and
  `skill_usage_shared = "<folder every machine can see>"`; `BOTCORE_SKILL_USAGE_MACHINE` and
  `BOTCORE_SKILL_USAGE_SHARED` override them). Collection then also writes this machine's
  record to `<shared>/<machine>/`, and the reports read every machine's. `shared` in the
  result says whether the folder `exists` and was `written`; a folder that is not there
  (`error`) does not undo the collection, and botcore never creates or syncs it. The folder
  holds session ids, project names and pull request numbers: keep it private.
- `since_days`: re-read that many days instead
- `t3_store`, `machine`: read a store copied from another machine, named by `machine`
- `rebuild`: read everything and replace what an older botcore recognised, or the name a
  machine had before it was renamed
- Errors: `SOURCE_SCHEMA_CHANGED` (this botcore cannot read this T3 Code release's store;
  nothing collected before is lost), `SOURCE_UNREADABLE`, `SOURCE_NOT_FOUND`,
  `RECORD_UNAVAILABLE`, `COLLECT_RUNNING`, `MACHINE_SETTINGS_INVALID`, `INVALID_INPUT` (also a
  machine's name that cannot name a folder). A machine with no T3 Code store succeeds with
  `status: absent`.

## skill_usage_report(days=30, project=None, harness=None, ending_days_ago=0, skill=None,
##   agent=None, limit=50)
Read-only. Skill use over `days` days from this machine's record and, where its settings name
a shared folder, every other machine's, each session once; run `skill_usage_collect` first
(`NOT_COLLECTED` otherwise). `record.collected` says when each machine last collected.
- Per skill: `sessions` that used it, `of_sessions` the project had and the `share`; `loads`;
  `typed_sessions` (the person asked for it); `harnesses`, `models`, `machines` (sessions by
  each); `agents` and `paths` (loads by `main`, `delegate` or `subagent`, and by `skill_tool`,
  `file_read`, `shell_read` or `typed`); `last_used`; `also_loaded_as` (earlier names);
  `size_bytes`, `max_context_bytes` (size times loads: a ceiling, since a skill read in parts
  counts whole) and `listing_chars` (what it adds to every session's skill listing).
- A session is a thread a person started or a task delegated to its own agent; a subagent's
  load counts under the session it works for. A skill read three times in one session is one
  use. A typed request is a load unless a tool then loads the skill within ten minutes.
- Not counted as use: a session that changed the skill's files (`authoring_sessions`), and an
  audit, which is one session loading two thirds or more of the skills the project's checkout
  holds (and at least 12 of them) within 30 minutes (`totals.audit_sessions`). Only skills the
  checkout holds count toward that; a checkout that holds fewer than 12, or is not on this
  machine, never has an audit, and an audit that takes longer than about 45 minutes is not
  seen as one.
- `quiet`: skills a project's checkout holds (`.claude/skills`, `.agents/skills`,
  `.codex/skills`) that nothing used in the window.
- `project`: `owner/name` or the name alone. `harness`: `claude` or `codex`. `agent`: `main`,
  `delegate` or `subagent`. `skill`: one skill. `ending_days_ago`: move the window back, to
  compare two periods. `limit`: skills listed, most used first; `more` counts the rest.
- A project, harness or skill the record has never seen is `INVALID_INPUT` with the known
  values, not an empty report. `warnings` says when a machine's record is over a day old,
  when lines of one could not be read, when a machine's copy in the shared folder is not
  whole and was not read (a sync part way through), when the shared folder was not there,
  and when an older botcore recognised events. Also `RECORD_UNAVAILABLE`,
  `MACHINE_SETTINGS_INVALID`.

## skill_usage_triggers(days=30, repo=None)
Read-only. For each skill a repository requires, the changes merged to its default branch in
the last `days` days that touched the skill's paths, and whether the session that opened each
one's pull request had loaded the skill by then. A repository declares them in its botcore
configuration: `[[skills.required]]` with `skill = "<name>"` and `paths = ["<glob>", ...]`
(repository-relative, as git writes them, matched by case; `*` stays in one folder, `**` spans
folders); several tables for one skill are one rule. Nothing is collected for it: a rule
declared today judges the record as it stands.
- It uses three things: which merged changes touched those paths (git); which session opened
  each change's pull request and when (the harness says which, and the record keeps it); and
  when that session loaded the skill, itself or through a subagent (the record). A session
  that attached itself to a pull request to repair, review or merge it is not judged, and
  neither a session's turns nor its branch tie it to a change.
- Per rule: `changes`; `loaded` (the session that opened the pull request had loaded the
  skill by then), of which `loaded_by_subagent` only through a subagent, which may be a
  reviewer; `missed` (that session never loaded the skill before the change merged), with
  `misses` naming each change's pull request and that session; `rate` (loaded out of loaded
  and missed); and `unknown`, with `unknown_why`: `no_pull_request` (the change names none,
  or names one another change on the branch names too), `no_session` (none on a collected
  machine is linked to it), `opened_elsewhere` (no session linked to it is known to have
  opened it: a script, a person or a machine not collected did, or its link does not say),
  `no_link_time` (the record does not place the opening before the merge), `after_opening`
  (the skill was loaded only after the pull request was opened: at review, or for a later
  push) and `possibly_loaded` (the opener
  never loaded it, but a task it delegated or a session it was forked from did, or the record
  holds an event of a kind this botcore does not know). A miss says the opener never loaded
  the skill: an opener that only published another session's work is judged all the same.
- `merged`: the branch that was read and its newest change; fetch the checkout when that is
  old. `warnings` says when links in the record do not say who opened them (collect again)
  and when an older botcore recognised its events (rebuild).
- `repo`: the repository's checkout; the one holding the working directory when left out.
- It reads every machine's record, as the usage report does, so a change opened on another
  machine is judged here. A machine's copy that is not whole is not read, and is named in
  `warnings`: its changes are `no_session` until it is.
- Errors: `NO_REQUIRED_SKILLS`, `NOT_COLLECTED`, `NO_WORKSPACE`, `CONFIG_INVALID`,
  `GIT_FAILED` (also when the checkout does not say which branch is the default),
  `RECORD_DAMAGED` (a line of a machine's record cannot be read: rebuild on that machine, or
  wait for its copy to finish syncing), `RECORD_UNAVAILABLE`, `MACHINE_SETTINGS_INVALID`,
  `INVALID_INPUT`.
""",
    "docs": """\
# Docs Commands

## docs_lint(path=None)
Check markdown under `path` (default `docs/`) for broken internal links and anchors;
missing frontmatter on specs and proposals is a warning. External URLs are skipped.

## docs_check_changelog()
Flag staged source changes that have no CHANGELOG.md update or pending changeset.

## docs_check_agents()
Flag what AGENTS.md owns when it is not staged: a new top-level directory it does not
name, and a path or name it cites that the change removes or renames. New commands,
packages, skills and workflows are reported as advice, not required.

## docs_preflight()
Run changelog and AGENTS.md checks together via a DirectClient pipeline.
""",
    "spec": """\
# Spec Commands

## spec_create(name, template="proposal")
Create a new spec file from template.

## spec_delete(path)
Delete a spec file.

## spec_status()
List specs with metadata.

## spec_validate(path=None)
Validate spec structure.
""",
    "info": """\
# Info Commands

## info_workspace()
Show workspace metadata (root, packages, config).

## info_env()
Show environment info (Python version, platform, installed tools).

## info_scripts()
List available scripts from pyproject.toml / package.json.
""",
    "changeset": """\
# Changeset Commands

## changeset_create(change_type, description)
Create a changeset file for the next release.

## changeset_delete(path)
Delete a pending changeset file.

## changeset_status()
Show pending changeset files.

## changeset_consume(version=None)
Consume pending changesets into CHANGELOG.md.
""",
    "undo": """\
# Undo Commands

## undo_status()
View undo/history status.

## undo_clear()
Clear undo history.
""",
    "disk": """\
# Disk Commands

Keep development machines from filling up with worktree build output and caches. Use these
commands instead of freeing space by hand: never `rm -rf` a worktree or run
`git worktree prune` yourself.

## disk_report(repo=None, unclassified=False, budget_seconds=180)
Read-only. Every worktree of every registered repository (machine settings `repos`, or the
repository holding the working directory) with its tier, idle days, whether a process uses it,
and the build output its `[disk].regenerable` patterns name. Also watched volumes, tool caches
and aged cache folders. `unclassified=True` lists ignored paths no pattern covers.

Tiers: 0 tool caches and aged folders; 1 build output in an idle worktree; 2 a finished
worktree; 3 report only (missing worktrees, orphan folders). Worktrees under T3 Code's worktree
folders are marked `managed_by: "t3-code"` (T3 Code's storage cleanup removes them), and
Botcore Factory's lane slots (`<repository>.factory-slots/`) `managed_by: "factory"`; tier 2
never removes either. Each repository's `idle_worktrees` counts linked worktrees idle
`strip_after_days` or longer (kept ones and Factory's slots aside; `complete` is false when time
ran out first); past the machine's `idle_worktree_limit` (20; 0 turns it off) it gets a
`warning`, also listed in `warnings`. A repository whose `[disk]` cannot be read is not counted.

## disk_reclaim(tier=1, apply=False, repo=None, pressure=False, include_restorable=False)
A dry run unless `apply=True`. Tier 0 prunes tool caches with their own commands (`uv cache
prune`; `pnpm store prune` only where pnpm uses hard links, since with clones it would empty the
store) and clears aged cache folders from the machine settings (an entry's age is its newest
time up to three folders down). Tier 1 also strips the build
output disk_report marks ready in idle worktrees. Before each deletion it checks again that the
worktree is idle and unused and the path is still ignored and untracked. When a watched volume
is below its threshold (or `pressure=True`) it also strips `when = "pressure"` patterns and
lowers the idle threshold to 1 day, then 6 hours. Never follows links or junctions. One run per
machine; every run writes a receipt (the response's `receipt`) and updates status.json in the
state folder (`BOTCORE_DISK_STATE` overrides it). Tier 2 also removes worktrees T3 Code does not
manage that hold nothing unique and whose work has landed (`git worktree remove`, branch kept,
commits pinned under refs/botcore/removed/ first, after the same just-before rechecks);
include_restorable also removes those that hold nothing unique but have not landed. Tier 2 is
off while T3 Code's settings cannot be read. The hourly job uses tier 2 only after
`disk_setup(remove_landed=True)`.

## disk_setup(uninstall=False, repos=None, install_schedule=True)
Registers the repository holding the working directory (and `repos`) in the machine settings,
records each volume holding their worktrees or T3 Code's worktree folders with its identifier
and a low-space threshold, and installs the hourly job: a LaunchAgent on macOS, a Task
Scheduler task on Windows, a systemd user timer (or crontab) on Linux. Needs botcore installed
as a tool (`uv tool install lushly-botcore==<version>`), not run through uvx. Safe to run
again. `uninstall=True` removes the job and keeps settings and receipts. Its `cargo` says where
Cargo puts build output for the registered worktrees, reading Cargo's config files as Cargo
does (each `.cargo/config` or `config.toml` from the worktree up, then `$CARGO_HOME`'s, with
their includes) and this process's `CARGO_TARGET_DIR`, `CARGO_BUILD_TARGET_DIR` and
`CARGO_BUILD_BUILD_DIR`. Inside each worktree is the default. Output moved out of them needs an
`[[aged]]` folder that clears it: one per workspace (`{workspace-path-hash}`) under a folder
that holds only Cargo output gets the exact entry to add; one folder shared by every workspace
needs a `max_gb` cap.

## disk_status()
The job's state, the last applied run and its age, free space on watched volumes, and
`problems` (stale for over 48 hours, failures, low or unverified volumes, skill usage not
collected for over a day). `healthy` is true when there are none. Session preflights read
this. `warnings` do not affect `healthy`: each registered repository's idle-worktree warning
from the last reclaim that counted it fully (older than 48 hours, it says when), Cargo output
no `[[aged]]` folder clears, and a skill usage collection that failed within the last day.
`skill_usage` is the job's last collection: `ok`, `ok_at`, and when it failed `error` and
`failing_since`. Botcore Factory's `lane_status` shows the warnings to the foreman as
`diskWarnings`.

## disk_keep(path, until=None, reason="") / disk_unkeep(path)
Protect a linked worktree from every disk action with a `git worktree lock` whose reason starts
`botcore-keep until=<date>` (14 days by default). Past its date a keep still protects and the
report lists it. disk_unkeep releases only a botcore keep, never another tool's lock.

## disk_restore(path)
Recreate a worktree a tier 2 reclaim removed, at the same path and commit: on its branch if the
branch still points there, on a recreated branch if it was deleted, else detached.

## disk_run(force=False)
What the job runs: collects skill usage (`skill_usage_collect`; a failure there never fails
the job, and `skill_usage_collect = false` in the machine settings turns it off), then checks
free space and exits, unless a watched volume is low or the last applied run is a day old;
then disk_reclaim(apply=True). Notifies once a day while space stays low.

Settings: the repository's `[disk]` in botcore.toml, read from a landing branch (origin's HEAD,
origin/main, then main; never a worktree's branch or the main checkout's HEAD), and the
machine's disk.toml (`BOTCORE_DISK_SETTINGS` overrides its path).
""",
}
