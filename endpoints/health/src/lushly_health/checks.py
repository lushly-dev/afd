"""Allowlisted local configuration heuristics from Health; all are explicit opt-ins.

These checks inspect declarations, not their execution or semantic correctness.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path


def _result(
    status: str, message: str, suggestion: str | None = None, metric: str | None = None
) -> dict[str, str | None]:
    return {"status": status, "message": message, "suggestion": suggestion, "metric": metric}


def _extract_first_major_version(value: str) -> int | None:
    """Extract the first major version mentioned in a version-ish string."""
    match = re.search(r"(?<![A-Za-z])(\d+)", value)
    if not match:
        return None
    return int(match.group(1))


def _read_local_node_majors(path: Path) -> dict[str, int]:
    """Read Node major versions declared in local version files."""
    majors: dict[str, int] = {}
    for rel_path in (".nvmrc", ".node-version"):
        version_file = path / rel_path
        if not version_file.exists():
            continue
        major = _extract_first_major_version(version_file.read_text().strip())
        if major is not None:
            majors[rel_path] = major
    return majors


def _resolve_workflow_version_reference(content: str, ref_value: str) -> set[int]:
    """Resolve GitHub Actions env or matrix node-version references to major versions."""
    env_match = re.search(r"\${{\s*env\.([A-Za-z_][A-Za-z0-9_]*)\s*}}", ref_value)
    if env_match:
        var_name = env_match.group(1)
        matches = re.findall(rf"^\s*{re.escape(var_name)}:\s*(.+)$", content, re.MULTILINE)
        return {int(major) for match in matches for major in re.findall(r"\d+", match)}

    matrix_match = re.search(r"\${{\s*matrix\.([A-Za-z_][A-Za-z0-9_-]*)\s*}}", ref_value)
    if matrix_match:
        var_name = matrix_match.group(1)
        matches = re.findall(rf"^\s*{re.escape(var_name)}:\s*(.+)$", content, re.MULTILINE)
        return {int(major) for match in matches for major in re.findall(r"\d+", match)}

    return set()


def _read_ci_node_majors(path: Path) -> set[int]:
    """Collect Node major versions referenced by GitHub Actions workflows."""
    workflows = path / ".github" / "workflows"
    if not workflows.is_dir():
        return set()

    majors: set[int] = set()
    for workflow_file in [*workflows.glob("*.yml"), *workflows.glob("*.yaml")]:
        content = workflow_file.read_text()
        for raw_value in re.findall(r"^\s*node-version:\s*(.+)$", content, re.MULTILINE):
            raw_value = raw_value.strip()
            direct_majors = {int(major) for major in re.findall(r"\d+", raw_value)}
            if direct_majors:
                majors.update(direct_majors)
                continue
            majors.update(_resolve_workflow_version_reference(content, raw_value))

    return majors


def _read_package_engines_node_major(path: Path) -> int | None:
    """Read the minimum Node major from package.json engines.node when present."""
    package_json = path / "package.json"
    if not package_json.exists():
        return None

    try:
        data = json.loads(package_json.read_text())
    except json.JSONDecodeError:
        return None

    engines_node = data.get("engines", {}).get("node")
    if not isinstance(engines_node, str):
        return None

    return _extract_first_major_version(engines_node)


def check_node_version_alignment(path: Path, lang: str) -> dict[str, str | None]:
    """Check that local Node version files align with CI and package metadata."""
    if lang != "typescript":
        return _result("pass", "N/A for non-TypeScript repos", metric="n/a")

    local_majors = _read_local_node_majors(path)
    if not local_majors:
        return _result(
            "fail",
            "No local Node version file found (.nvmrc or .node-version)",
            suggestion="Add .nvmrc or .node-version and align it with CI's Node version",
        )

    unique_local_majors = set(local_majors.values())
    if len(unique_local_majors) > 1:
        details = ", ".join(f"{name}={major}" for name, major in sorted(local_majors.items()))
        return _result(
            "fail",
            f"Local Node version files disagree: {details}",
            suggestion="Keep .nvmrc and .node-version on the same major version",
        )

    declared_major = next(iter(unique_local_majors))
    ci_majors = _read_ci_node_majors(path)
    if ci_majors and declared_major not in ci_majors:
        return _result(
            "fail",
            f"Local Node version {declared_major} does not match CI versions {sorted(ci_majors)}",
            suggestion="Align .nvmrc/.node-version with the Node version used in GitHub Actions",
        )

    engines_major = _read_package_engines_node_major(path)
    if engines_major is not None and declared_major < engines_major:
        return _result(
            "fail",
            (
                f"Local Node version {declared_major} "
                f"is below package.json engines minimum {engines_major}"
            ),
            suggestion="Raise .nvmrc/.node-version to satisfy package.json engines.node",
        )

    sources = ", ".join(f"{name}={major}" for name, major in sorted(local_majors.items()))
    ci_note = f", CI={sorted(ci_majors)}" if ci_majors else ""
    engines_note = f", engines>={engines_major}" if engines_major is not None else ""
    return _result(
        "pass",
        f"Node version declarations aligned ({sources}{ci_note}{engines_note})",
        metric=str(declared_major),
    )


def _sorted_relative_paths(root: Path) -> list[Path]:
    """Return all descendant paths relative to root, excluding the root itself."""
    paths: list[Path] = []
    for item in sorted(root.rglob("*")):
        try:
            paths.append(item.relative_to(root))
        except ValueError:
            continue
    return paths


def _summarize_skill_tree_drift(claude_skills: Path, codex_skills: Path) -> list[str]:
    """Describe Codex-only or divergent items that would be lost when replacing with a mirror."""
    issues: list[str] = []

    claude_items = set(_sorted_relative_paths(claude_skills))
    codex_items = set(_sorted_relative_paths(codex_skills))

    codex_only = sorted(str(path) for path in codex_items - claude_items)
    if codex_only:
        sample = ", ".join(codex_only[:3])
        more = f" (+{len(codex_only) - 3} more)" if len(codex_only) > 3 else ""
        issues.append(f"Codex-only items: {sample}{more}")

    shared_files = sorted(
        rel_path
        for rel_path in claude_items & codex_items
        if (claude_skills / rel_path).is_file() and (codex_skills / rel_path).is_file()
    )
    divergent: list[str] = []
    for rel_path in shared_files:
        try:
            if (claude_skills / rel_path).read_bytes() != (codex_skills / rel_path).read_bytes():
                divergent.append(str(rel_path))
        except OSError:
            continue

    if divergent:
        sample = ", ".join(divergent[:3])
        more = f" (+{len(divergent) - 3} more)" if len(divergent) > 3 else ""
        issues.append(f"Divergent items: {sample}{more}")

    return issues


def check_codex_skills_mirror(path: Path, lang: str) -> dict[str, str | None]:
    """Check that .codex/skills mirrors .claude/skills in every managed repo."""
    claude_skills = path / ".claude" / "skills"
    codex_skills = path / ".codex" / "skills"

    if not claude_skills.is_dir():
        return _result(
            "fail",
            ".claude/skills/ directory not found",
            suggestion="Run 'botcore skill-seed' before creating the Codex mirror",
        )

    if not codex_skills.exists():
        return _result(
            "fail",
            ".codex/skills mirror not found",
            suggestion="Create .codex/skills as a symlink or junction to .claude/skills",
        )

    try:
        if os.path.samefile(codex_skills, claude_skills):
            return _result(
                "pass",
                ".codex/skills mirrors .claude/skills",
                metric="mirrored",
            )
    except OSError:
        pass

    if not codex_skills.is_dir():
        return _result(
            "fail",
            ".codex/skills exists but is not a directory mirror",
            suggestion="Replace .codex/skills with a symlink or junction to .claude/skills",
        )

    drift = _summarize_skill_tree_drift(claude_skills, codex_skills)
    if drift:
        return _result(
            "fail",
            ".codex/skills is a standalone copy and has content to migrate: " + "; ".join(drift),
            suggestion=(
                "Move Codex-only changes into .claude/skills, "
                "then replace .codex/skills with a symlink or junction"
            ),
        )

    return _result(
        "fail",
        ".codex/skills exists separately and is not a live mirror of .claude/skills",
        suggestion="Replace .codex/skills with a symlink or junction to .claude/skills",
    )


def check_lefthook_configured(path: Path, lang: str) -> dict[str, str | None]:
    """Check lefthook.yml has pre-commit and pre-push sections."""
    lefthook = path / "lefthook.yml"
    if not lefthook.exists():
        return _result(
            "fail",
            "lefthook.yml not found",
            metric="0/2",
            suggestion="Run 'lefthook install' and add lefthook.yml",
        )
    content = lefthook.read_text()
    has_pre_commit = "pre-commit:" in content
    has_pre_push = "pre-push:" in content
    hooks_found = sum([has_pre_commit, has_pre_push])
    if has_pre_commit and has_pre_push:
        return _result("pass", "lefthook.yml has pre-commit and pre-push hooks", metric="2/2")
    missing = []
    if not has_pre_commit:
        missing.append("pre-commit")
    if not has_pre_push:
        missing.append("pre-push")
    return _result(
        "fail",
        f"lefthook.yml missing sections: {', '.join(missing)}",
        suggestion="Add missing hook sections to lefthook.yml",
        metric=f"{hooks_found}/2",
    )


def check_linter_strict(path: Path, lang: str) -> dict[str, str | None]:
    """Check linter is configured with strict rules."""
    if lang == "typescript":
        biome = path / "biome.json"
        if not biome.exists():
            return _result(
                "fail",
                "biome.json not found",
                suggestion="Run 'pnpm biome init' to create biome.json",
            )
        content = biome.read_text()
        has_unused = "noUnusedImports" in content
        has_no_any = "noExplicitAny" in content
        rules_found = sum([has_unused, has_no_any])
        if has_unused and has_no_any:
            return _result("pass", "biome.json has noUnusedImports and noExplicitAny", metric="2/2")
        missing = []
        if not has_unused:
            missing.append("noUnusedImports")
        if not has_no_any:
            missing.append("noExplicitAny")
        return _result(
            "fail",
            f"biome.json missing rules: {', '.join(missing)}",
            suggestion="Add missing rules to biome.json linter config",
            metric=f"{rules_found}/2",
        )
    if lang == "python":
        pyproject = path / "pyproject.toml"
        if not pyproject.exists():
            return _result(
                "fail",
                "pyproject.toml not found",
                suggestion="Create pyproject.toml with [tool.ruff] section",
            )
        if "[tool.ruff]" in pyproject.read_text():
            return _result("pass", "pyproject.toml has [tool.ruff] configured", metric="ruff")
        return _result(
            "fail",
            "pyproject.toml missing [tool.ruff] section",
            suggestion="Add [tool.ruff] configuration to pyproject.toml",
        )
    return _result("warn", f"No linter check defined for language: {lang}")


def check_ci_present(path: Path, lang: str) -> dict[str, str | None]:
    """Check .github/workflows/ has a CI file with test and build."""
    workflows = path / ".github" / "workflows"
    if not workflows.is_dir():
        return _result(
            "fail",
            ".github/workflows/ not found",
            suggestion="Create a GitHub Actions workflow for CI",
        )
    for yml_file in workflows.glob("*.yml"):
        content = yml_file.read_text().lower()
        if "test" in content and "build" in content:
            # Count workflow files
            wf_count = len(list(workflows.glob("*.yml"))) + len(list(workflows.glob("*.yaml")))
            return _result("pass", f"CI workflow found: {yml_file.name}", metric=f"{wf_count} wf")
    # Also check .yaml extension
    for yaml_file in workflows.glob("*.yaml"):
        content = yaml_file.read_text().lower()
        if "test" in content and "build" in content:
            wf_count = len(list(workflows.glob("*.yml"))) + len(list(workflows.glob("*.yaml")))
            return _result("pass", f"CI workflow found: {yaml_file.name}", metric=f"{wf_count} wf")
    return _result(
        "fail",
        "No workflow with both 'test' and 'build' found",
        suggestion="Add a CI workflow with test and build steps",
    )


def check_dependabot_configured(path: Path, lang: str) -> dict[str, str | None]:
    """Check .github/dependabot.yml exists."""
    if (path / ".github" / "dependabot.yml").exists():
        return _result("pass", "dependabot.yml configured", metric="yes")
    return _result(
        "fail",
        ".github/dependabot.yml not found",
        metric="no",
        suggestion="Create .github/dependabot.yml for automated dependency updates",
    )


def check_commitlint_configured(path: Path, lang: str) -> dict[str, str | None]:
    """Check commitlint config exists (TS only)."""
    if lang == "python":
        return _result("pass", "N/A for Python", metric="n/a")
    if (path / "commitlint.config.mjs").exists():
        return _result("pass", "commitlint.config.mjs found", metric="yes")
    if (path / "commitlint.config.js").exists():
        return _result("pass", "commitlint.config.js found", metric="yes")
    return _result(
        "fail",
        "No commitlint config found",
        metric="no",
        suggestion="Create commitlint.config.mjs with conventional commit rules",
    )


def check_coverage_thresholds(path: Path, lang: str) -> dict[str, str | None]:
    """Check test coverage thresholds are configured."""
    if lang == "typescript":
        # Check root vitest.config.ts first
        vitest = path / "vitest.config.ts"
        if vitest.exists() and "thresholds" in vitest.read_text():
            return _result("pass", "vitest.config.ts has coverage thresholds", metric="yes")
        # Check monorepo: packages/*/vitest.config.ts
        pkg_configs = list(path.glob("packages/*/vitest.config.ts"))
        if pkg_configs:
            with_thresholds = [c for c in pkg_configs if "thresholds" in c.read_text()]
            if with_thresholds:
                return _result(
                    "pass",
                    f"{len(with_thresholds)}/{len(pkg_configs)} package configs have thresholds",
                    metric=f"{len(with_thresholds)}/{len(pkg_configs)}",
                )
            return _result(
                "fail",
                f"{len(pkg_configs)} package vitest configs but none have thresholds",
                suggestion="Add coverage.thresholds to package vitest configs",
            )
        # Also check botcore.toml coverage_threshold as fallback
        botcore_toml = path / "botcore.toml"
        if botcore_toml.exists() and "coverage_threshold" in botcore_toml.read_text():
            return _result("pass", "botcore.toml has coverage_threshold", metric="yes")
        return _result(
            "fail",
            "No vitest.config.ts found (root or packages/)",
            suggestion="Add vitest.config.ts with coverage thresholds",
        )
    if lang == "python":
        botcore_toml = path / "botcore.toml"
        if not botcore_toml.exists():
            return _result(
                "fail",
                "botcore.toml not found",
                suggestion="Create botcore.toml with coverage_threshold setting",
            )
        if "coverage_threshold" in botcore_toml.read_text():
            return _result("pass", "botcore.toml has coverage_threshold configured", metric="yes")
        return _result(
            "fail",
            "botcore.toml missing coverage_threshold",
            suggestion="Add coverage_threshold to botcore.toml",
        )
    return _result("warn", f"No coverage check defined for language: {lang}")


def check_dead_code_tool(path: Path, lang: str) -> dict[str, str | None]:
    """Check a dead code detection tool is configured."""
    if lang == "typescript":
        pkg_json = path / "package.json"
        if not pkg_json.exists():
            return _result(
                "fail",
                "package.json not found",
                suggestion="Initialize with 'pnpm init'",
            )
        if '"knip"' in pkg_json.read_text():
            return _result("pass", "knip found in package.json", metric="knip")
        return _result(
            "fail",
            "knip not found in package.json",
            suggestion="Install knip: 'pnpm add -D knip'",
        )
    if lang == "python":
        pyproject = path / "pyproject.toml"
        if pyproject.exists() and "vulture" in pyproject.read_text():
            return _result("pass", "vulture found in pyproject.toml", metric="vulture")
        return _result(
            "fail",
            "vulture not found in pyproject.toml",
            suggestion="Add vulture to dev dependencies in pyproject.toml",
        )
    return _result("warn", f"No dead code check defined for language: {lang}")


def check_gitattributes_lf(path: Path, lang: str) -> dict[str, str | None]:
    """Check .gitattributes enforces LF line endings."""
    gitattributes = path / ".gitattributes"
    if not gitattributes.exists():
        return _result(
            "fail",
            ".gitattributes not found",
            metric="no",
            suggestion="Create .gitattributes with '* text=auto eol=lf'",
        )
    if "eol=lf" in gitattributes.read_text():
        return _result("pass", ".gitattributes enforces LF line endings", metric="LF")
    return _result(
        "fail",
        ".gitattributes missing eol=lf",
        metric="no",
        suggestion="Add '* text=auto eol=lf' to .gitattributes",
    )


def check_changesets_configured(path: Path, lang: str) -> dict[str, str | None]:
    """Check changesets is set up for release management."""
    changeset_dir = path / ".changeset"
    if not changeset_dir.is_dir():
        return _result(
            "fail",
            ".changeset/ directory not found",
            metric="no",
            suggestion="Run 'pnpm changeset init' (TS) or 'botcore changeset-create' (Python)",
        )
    # JS changesets: config.json + @changesets/cli dep
    config = changeset_dir / "config.json"
    if config.exists():
        pkg = path / "package.json"
        if pkg.exists() and "@changesets/cli" in pkg.read_text():
            return _result("pass", "changesets configured", metric="yes")
        return _result(
            "warn",
            ".changeset/config.json exists but @changesets/cli not in deps",
            metric="partial",
        )
    # Python/botcore changesets: .changeset/ dir exists (botcore manages it)
    if lang == "python":
        return _result("pass", "botcore changesets configured", metric="yes")
    return _result(
        "fail",
        ".changeset/ exists but no config.json",
        metric="no",
        suggestion="Run 'pnpm changeset init' to configure",
    )
