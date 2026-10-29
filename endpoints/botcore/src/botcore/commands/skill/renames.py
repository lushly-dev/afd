"""Bundled skill renames — map retired skill names to their replacements."""

from __future__ import annotations

from pathlib import PurePosixPath

# Old name -> new name for bundled skills. v0.4.0 (d17dcee) renamed every
# bundled skill from verb-noun to noun-first. When a skill is renamed again,
# add an entry for its current name; resolve_rename() follows the chain.
SKILL_RENAMES: dict[str, str] = {
    "architect-systems": "systems-architect",
    "audit-licenses": "license-auditor",
    "audit-security": "security-auditor",
    "automate-browsers": "browser-automation",
    "build-botcore-plugins": "plugin-builder",
    "build-mcp-servers": "mcp-builder",
    "build-stories": "storybook-builder",
    "configure-agents": "agent-config",
    "configure-botcore": "botcore-config",
    "create-personas": "persona-creator",
    "create-prompts": "prompt-creator",
    "deploy-infrastructure": "deployment-learn",
    "design-apis": "api-designer",
    "design-content": "content-designer",
    "do-clean-repo": "repo-cleanup",
    "do-commit": "commit",
    "do-documentation-update": "docs-update",
    "do-hotfix": "hotfix",
    "do-pr": "pr",
    "do-release": "release",
    "do-review": "review",
    "enforce-standards": "code-standards-learn",
    "ensure-accessibility": "accessibility-learn",
    "explore-css": "css-learn",
    "find-duplicates": "duplication-finder",
    "handle-authentication": "authentication-learn",
    "handle-errors": "error-handling-learn",
    "humanize-content": "content-humanizer",
    "implement-caching": "caching-learn",
    "implement-designs": "design-implementer",
    "implement-i18n": "i18n-learn",
    "implement-observability": "observability-learn",
    "integrate-llms": "llm-integration-learn",
    "manage-commands": "commands-learn",
    "manage-concurrency": "concurrency-learn",
    "manage-dependencies": "dependency-manager",
    "manage-documentation": "docs-manager",
    "manage-environment": "dev-environment-learn",
    "manage-feature-flags": "feature-flags-learn",
    "manage-git": "git-manager",
    "manage-projects": "project-manager",
    "manage-skills": "skill-manager",
    "manage-state": "state-learn",
    "migrate-systems": "migration-learn",
    "model-data": "data-modeling-learn",
    "optimize-performance": "performance-learn",
    "refactor-code": "refactoring-learn",
    "research-topics": "research",
    "review-code": "code-reviewer",
    "run-dev-checks": "dev-checks",
    "solve-problems": "problem-solver",
    "test-components": "component-tester",
    "write-commits": "commit-writer",
    "write-specifications": "spec-writer",
    "write-tests": "test-writer",
}


def resolve_rename(name: str) -> str | None:
    """Return the current name for a retired skill name, or None if it was never renamed."""
    if name not in SKILL_RENAMES:
        return None
    seen = {name}
    while name in SKILL_RENAMES:
        name = SKILL_RENAMES[name]
        if name in seen:
            raise ValueError(f"Skill rename cycle at '{name}'")
        seen.add(name)
    return name


def locally_owned_rename_suggestion(
    old_name: str, new_name: str, source_dir: str, owner: str | None = None
) -> str:
    """Explain how to resolve a renamed skill that botcore does not own."""
    old_path = PurePosixPath(source_dir, old_name)
    # A skill with no source: needs adopting so seed won't treat the renamed copy as botcore's
    keep = (
        f"then run skill_adopt('{new_name}') to keep your version"
        if owner is None
        else f"keeping its source: {owner} field so seed leaves it alone"
    )
    return (
        f"'{old_name}' was renamed to '{new_name}' but is not managed by botcore, so it "
        f"was left in place. If it is an unmodified copy, delete {old_path} and run "
        f"skill-seed to install '{new_name}'. If you customized it, rename it to "
        f"'{new_name}' (directory and name: field), {keep}."
    )
