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
# Skill Registry Commands

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

Tiers: 0 tool caches and aged folders; 1 build output in an idle worktree; 3 report only
(missing worktrees, orphan folders). Worktrees under T3 Code's worktree folders are marked
`managed_by: "t3-code"`: T3 Code's storage cleanup removes them.

## disk_reclaim(tier=1, apply=False, repo=None, pressure=False, budget_seconds=300)
A dry run unless `apply=True`. Tier 0 prunes tool caches with their own commands (`uv cache
prune`; `pnpm store prune` only where pnpm uses hard links, since with clones it would empty the
store) and clears aged cache folders from the machine settings. Tier 1 also strips the build
output disk_report marks ready in idle worktrees. Before each deletion it checks again that the
worktree is idle and unused and the path is still ignored and untracked. When a watched volume
is below its threshold (or `pressure=True`) it also strips `when = "pressure"` patterns and
lowers the idle threshold to 1 day, then 6 hours. Never follows links or junctions. One run per
machine; every run writes a receipt (the response's `receipt`) and updates status.json in the
state folder (`BOTCORE_DISK_STATE` overrides it). It never removes a worktree.

## disk_setup(uninstall=False, repos=None, install_schedule=True)
Registers the repository holding the working directory (and `repos`) in the machine settings,
records each volume holding their worktrees or T3 Code's worktree folders with its identifier
and a low-space threshold, and installs the hourly job: a LaunchAgent on macOS, a Task
Scheduler task on Windows, a systemd user timer (or crontab) on Linux. Needs botcore installed
as a tool (`uv tool install lushly-botcore==<version>`), not run through uvx. Safe to run
again. `uninstall=True` removes the job and keeps settings and receipts.

## disk_status()
The job's state, the last applied run and its age, free space on watched volumes, and
`problems` (stale for over 48 hours, failures, low or unverified volumes). `healthy` is true
when there are none. Session preflights read this.

## disk_run(force=False)
What the job runs: checks free space and exits, unless a watched volume is low or the last
applied run is a day old; then disk_reclaim(apply=True). Notifies once a day while space stays
low.

Settings: the repository's `[disk]` in botcore.toml, read from origin's HEAD (never from a
worktree's branch), and the machine's disk.toml (`BOTCORE_DISK_SETTINGS` overrides its path).
""",
}
