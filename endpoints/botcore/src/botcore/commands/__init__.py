"""Botcore command re-exports."""

# Dev commands re-exported from subpackage
from botcore.commands.changeset import (
    changeset_consume,
    changeset_create,
    changeset_delete,
    changeset_status,
)
from botcore.commands.dev import (
    dev_build,
    dev_check_coverage,
    dev_check_deps,
    dev_check_paths,
    dev_check_size,
    dev_circular_imports,
    dev_dead_code,
    dev_dep_graph,
    dev_lint,
    dev_skill_lint,
    dev_test,
    dev_unused_deps,
)
from botcore.commands.docs import docs_check_agents, docs_check_changelog, docs_lint, docs_preflight
from botcore.commands.info import info_env, info_scripts, info_workspace
from botcore.commands.research import research_query, research_stream
from botcore.commands.skill import (
    skill_adopt,
    skill_index,
    skill_lint,
    skill_list,
    skill_seed,
    skill_status,
    skill_unadopt,
)
from botcore.commands.skill_lint import skill_lint_spec
from botcore.commands.spec import spec_create, spec_delete, spec_status, spec_validate
from botcore.commands.undo import undo_clear, undo_status

__all__ = [
    # Info
    "info_workspace",
    "info_env",
    "info_scripts",
    # Dev
    "dev_lint",
    "dev_test",
    "dev_build",
    "dev_skill_lint",
    "dev_check_size",
    "dev_check_coverage",
    "dev_check_deps",
    "dev_dead_code",
    "dev_circular_imports",
    "dev_unused_deps",
    "dev_dep_graph",
    "dev_check_paths",
    # Skill registry
    "skill_seed",
    "skill_list",
    "skill_status",
    "skill_lint",
    "skill_lint_spec",
    "skill_adopt",
    "skill_unadopt",
    "skill_index",
    # Changeset
    "changeset_create",
    "changeset_delete",
    "changeset_status",
    "changeset_consume",
    # Docs
    "docs_lint",
    "docs_check_changelog",
    "docs_check_agents",
    "docs_preflight",
    # Research
    "research_query",
    "research_stream",
    # Spec
    "spec_create",
    "spec_delete",
    "spec_status",
    "spec_validate",
    # Undo
    "undo_status",
    "undo_clear",
]
