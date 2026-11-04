"""Bundled skill renames and retirements: map old names to replacements or to none."""

from __future__ import annotations

from pathlib import PurePosixPath

# Old name -> new name for bundled skills. v0.4.0 (d17dcee) renamed every
# bundled skill from verb-noun to noun-first. When a skill is renamed again,
# add an entry for its current name; resolve_rename() follows the chain.
SKILL_RENAMES: dict[str, str] = {
    "audit-security": "security-auditor",
    "automate-browsers": "browser-automation",
    "build-botcore-plugins": "plugin-builder",
    "build-mcp-servers": "mcp-builder",
    "configure-agents": "agent-config",
    "configure-botcore": "botcore-config",
    "content-humanizer": "docs-manager",
    "do-documentation-update": "docs-update",
    "do-review": "review",
    "docs-update": "docs-manager",
    "humanize-content": "content-humanizer",
    "manage-documentation": "docs-manager",
    "manage-skills": "skill-manager",
    "review": "code-reviewer",
    "review-code": "code-reviewer",
}

# Bundled skills retired without a replacement, under their current and earlier names.
# skill-seed removes copies botcore owns and reports locally owned ones; it never
# deletes a skill another source still ships under the same name.
RETIRED_SKILLS: frozenset[str] = frozenset(
    {
        "accessibility-learn",
        "api-designer",
        "architect-systems",
        "audit-licenses",
        "authentication-learn",
        "build-stories",
        "caching-learn",
        "code-standards-learn",
        "commands-learn",
        "commit",
        "commit-writer",
        "component-tester",
        "concurrency-learn",
        "content-designer",
        "create-personas",
        "create-prompts",
        "css-learn",
        "data-modeling-learn",
        "dependency-manager",
        "deploy-infrastructure",
        "deployment-learn",
        "design-apis",
        "design-content",
        "design-implementer",
        "dev-checks",
        "dev-environment-learn",
        "do-clean-repo",
        "do-commit",
        "do-hotfix",
        "do-pr",
        "do-release",
        "duplication-finder",
        "enforce-standards",
        "ensure-accessibility",
        "error-handling-learn",
        "explore-css",
        "feature-flags-learn",
        "find-duplicates",
        "git-manager",
        "handle-authentication",
        "handle-errors",
        "hotfix",
        "i18n-learn",
        "implement-caching",
        "implement-designs",
        "implement-i18n",
        "implement-observability",
        "integrate-llms",
        "license-auditor",
        "llm-integration-learn",
        "manage-commands",
        "manage-concurrency",
        "manage-dependencies",
        "manage-environment",
        "manage-feature-flags",
        "manage-git",
        "manage-projects",
        "manage-state",
        "migrate-systems",
        "migration-learn",
        "model-data",
        "observability-learn",
        "optimize-performance",
        "performance-learn",
        "persona-creator",
        "pr",
        "problem-solver",
        "project-manager",
        "prompt-creator",
        "refactor-code",
        "refactoring-learn",
        "release",
        "repo-cleanup",
        "research",
        "research-topics",
        "run-dev-checks",
        "solve-problems",
        "spec-writer",
        "state-learn",
        "storybook-builder",
        "systems-architect",
        "test-components",
        "test-writer",
        "write-commits",
        "write-specifications",
        "write-tests",
    }
)


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


def seed_manages_retired(name: str, include: list[str] | None, skip: list[str]) -> bool:
    """Whether skill-seed may remove a botcore-owned copy of a retired skill.

    An include list names what the project wants, so a retired name on it is kept, and
    one off it is outside seed's scope; skip keeps seed away from a name entirely.
    """
    return include is None and name not in skip


def retired_suggestion(
    name: str, source_dir: str, owner: str | None = None, managed: bool = True
) -> str:
    """Explain how to resolve a local copy of a skill botcore no longer ships."""
    path = PurePosixPath(source_dir, name)
    if owner == "botcore" and managed:
        return f"botcore no longer ships '{name}'; run skill-seed to remove its managed copy."
    if owner == "botcore":
        return (
            f"botcore no longer ships '{name}', and [skills] include/skip keeps skill-seed "
            f"from removing it. Delete {path} if you no longer use it."
        )
    if owner is None:
        return (
            f"botcore no longer ships '{name}'. If it is an unmodified copy, delete "
            f"{path}. To keep it, run skill_adopt('{name}') to mark it yours."
        )
    return (
        f"'{name}' shares a name botcore retired, but its source: {owner} field marks it "
        f"as yours, so skill-seed keeps it. No action is needed."
    )
