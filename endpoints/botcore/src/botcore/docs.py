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
Lint skill files for structure issues.
""",
    "skill": """\
# Skill Registry Commands

## skill_list(show_source=False, plugin_dirs=None)
List available and installed skills with version and source info.

## skill_seed(update=False, dry_run=False, plugin_dirs=None)
Copy skills from botcore/plugin sources into project's .claude/skills/.
Injects `source:` frontmatter for ownership tracking.
Skills installed under a retired name (e.g. `manage-documentation`, renamed to
`docs-manager` in 0.4.0) are migrated when `source: botcore`; otherwise they are
left in place, listed in `renamed_locally_owned`, and the new name is not seeded.
- `update`: Also update stale skills (default: only new)
- `dry_run`: Preview changes without writing

## skill_status(plugin_dirs=None)
Detect version drift between installed and available skills.
Reports: ok, stale, missing, unmanaged, conflict, renamed.

## skill_lint(path=None, strict=False)
Run 15 quality rules (SK001-SK015) on skill files.
- `path`: Lint a specific skill path (default: all in skills dir)
- `strict`: Treat warnings as errors

## skill_adopt(name, source="local")
Claim an unmanaged skill by adding `source:` frontmatter.

## skill_unadopt(name)
Remove `source:` frontmatter from a skill.

## skill_index(write=True)
Generate `_index.md` table of all installed skills.
- `write`: Write file (default: True). False for preview.
""",
    "docs": """\
# Docs Commands

## docs_lint()
Run markdown linting.

## docs_check_changelog()
Verify CHANGELOG.md structure and freshness.

## docs_check_agents()
Validate AGENTS.md exists and has content.

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
}
