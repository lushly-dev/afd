"""Quality gate commands — check-size, check-coverage, check-deps, check-lockfile.

Dependency discovery and PyPI checks live in dependencies.py and the lockfile check in
lockfile.py; both are re-exported here.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

from afd import CommandResult, error, success

from botcore.commands.dev.dependencies import (
    _check_pkg_version as _check_pkg_version,
)
from botcore.commands.dev.dependencies import (
    _check_pypi_deps as _check_pypi_deps,
)
from botcore.commands.dev.dependencies import (
    _collect_all_deps as _collect_all_deps,
)
from botcore.commands.dev.dependencies import (
    _collect_staged_deps as _collect_staged_deps,
)
from botcore.commands.dev.dependencies import (
    _parse_version as _parse_version,
)
from botcore.commands.dev.lockfile import dev_check_lockfile as dev_check_lockfile
from botcore.config import load_config
from botcore.utils.runner import run_external_tool, run_python_module
from botcore.utils.workspace import (
    display_path,
    find_workspace,
    resolve_language,
    resolve_path,
)

_LANG_EXTENSIONS: dict[str, list[str]] = {
    "python": [".py"],
    "typescript": [".ts", ".tsx", ".js", ".jsx"],
    "rust": [".rs"],
}

# Directory names never scanned for size — dependency trees and build output
_SKIP_DIRS = {"node_modules", "__pycache__", "dist", "build", "target", ".venv", ".git", "coverage"}


async def dev_check_size(
    path: str | None = None,
    warn_threshold: int | None = None,
    error_threshold: int | None = None,
    language: str | None = None,
    staged_only: bool = False,
) -> CommandResult[dict]:
    """Check file sizes for agent-friendly limits.

    Scans files matching the configured language extensions.
    Uses warn/error thresholds from config if not explicitly provided.
    When staged_only=True, only checks files staged in git.
    """
    ws = find_workspace()
    config = load_config(workspace=ws)
    warn_threshold = warn_threshold if warn_threshold is not None else config.file_size_warn
    error_threshold = error_threshold if error_threshold is not None else config.file_size_error

    check_path = resolve_path(path, ws)

    if not check_path.exists():
        return error(
            "PATH_NOT_FOUND",
            f"Path not found: {check_path}",
            suggestion="Verify the path exists or omit to use default src/",
        )

    # If staged_only, filter to only staged files
    if staged_only:
        result = subprocess.run(
            ["git", "-c", "core.quotePath=false", "diff", "--cached", "--name-only", "--relative"],
            cwd=ws or Path.cwd(),
            capture_output=True,
            text=True,
        )
        if result.returncode == 0:
            staged_files = set(
                str(((ws or Path.cwd()) / f.strip()).resolve())
                for f in result.stdout.strip().split("\n")
                if f.strip()
            )
        else:
            staged_files = None  # Fall back to scanning all
    else:
        staged_files = None

    # Determine which extensions to scan
    lang = (
        resolve_language(
            check_path if path else None,
            config,
            ws,
            language_override=language,
        )
        if ws
        else (language or config.language)
    )
    if lang and lang in _LANG_EXTENSIONS:
        extensions = set(_LANG_EXTENSIONS[lang])
    else:
        # Scan all known extensions
        extensions = {ext for exts in _LANG_EXTENSIONS.values() for ext in exts}

    results: dict = {"files_checked": 0, "warnings": [], "errors": [], "ok": []}

    for source_file in check_path.rglob("*"):
        if not source_file.is_file():
            continue
        if staged_files is not None and str(source_file) not in staged_files:
            continue
        if source_file.suffix not in extensions:
            continue
        if any(part in _SKIP_DIRS for part in source_file.parts):
            continue
        if "test_" in source_file.name or ".test." in source_file.name:
            continue

        try:
            lines = len(source_file.read_text(encoding="utf-8").splitlines())
        except Exception:
            continue

        results["files_checked"] += 1
        relative_path = display_path(source_file, ws)

        if lines >= error_threshold:
            results["errors"].append({"file": relative_path, "lines": lines})
        elif lines >= warn_threshold:
            results["warnings"].append({"file": relative_path, "lines": lines})
        else:
            results["ok"].append({"file": relative_path, "lines": lines})

    results["errors"].sort(key=lambda x: x["lines"], reverse=True)
    results["warnings"].sort(key=lambda x: x["lines"], reverse=True)

    has_errors = len(results["errors"]) > 0

    if has_errors:
        file_list = ", ".join(f"{e['file']} ({e['lines']})" for e in results["errors"])
        return error(
            "FILES_TOO_LARGE",
            f"Files exceeding {error_threshold} lines: {file_list}",
            suggestion="Refactor large files into smaller modules",
        )

    return success(
        data=results,
        reasoning=f"Checked {results['files_checked']} files, {len(results['warnings'])} warnings",
    )


async def _check_python_coverage(
    ws: Path,
    coverage_paths: list[str],
) -> dict | None:
    """Run pytest --cov and return coverage data, or None on failure."""
    cov_args = [f"--cov={p}" for p in coverage_paths]
    await run_python_module(
        "pytest",
        [*cov_args, "--cov-report=json", "-q", "--tb=no"],
        cwd=ws,
    )
    coverage_file = ws / "coverage.json"
    if not coverage_file.exists():
        return None
    try:
        data = json.loads(coverage_file.read_text())
        return {"coverage": data.get("totals", {}).get("percent_covered", 0)}
    except Exception:
        return None


async def _check_ts_coverage(ws: Path) -> dict | None:
    """Run vitest --coverage and return coverage data."""
    result = await run_external_tool(
        "npx",
        ["vitest", "run", "--coverage", "--reporter=json"],
        install_hint="npm i -D vitest @vitest/coverage-v8",
        cwd=ws,
    )
    if result is None:
        return None
    return {"coverage": 0, "raw_output": result.get("output", ""), "tool": "vitest"}


async def _check_rust_coverage(ws: Path) -> dict | None:
    """Run cargo-tarpaulin and return coverage data."""
    result = await run_external_tool(
        "cargo",
        ["tarpaulin", "--out", "Json"],
        install_hint="cargo install cargo-tarpaulin",
        cwd=ws,
    )
    if result is None:
        return None
    return {"coverage": 0, "raw_output": result.get("output", ""), "tool": "tarpaulin"}


async def dev_check_coverage(language: str | None = None) -> CommandResult[dict]:
    """Check test coverage against configured thresholds."""
    ws = find_workspace()
    if not ws:
        return error(
            "NO_WORKSPACE",
            "Could not find workspace root",
            suggestion="Run from within a Git repository",
        )

    config = load_config(workspace=ws)
    threshold = config.coverage_threshold
    warn_threshold = config.coverage_warn_threshold
    coverage_paths = config.coverage_paths

    lang = resolve_language(
        None,
        config,
        ws,
        language_override=language,
    )

    if lang == "typescript":
        cov = await _check_ts_coverage(ws)
        if cov is None:
            return error(
                "NO_COVERAGE_DATA",
                "Could not collect TypeScript coverage",
                suggestion="Install with: npm i -D vitest @vitest/coverage-v8",
            )
        total_coverage = cov.get("coverage", 0)
    elif lang == "rust":
        cov = await _check_rust_coverage(ws)
        if cov is None:
            return error(
                "NO_COVERAGE_DATA",
                "Could not collect Rust coverage",
                suggestion="Install with: cargo install cargo-tarpaulin",
            )
        total_coverage = cov.get("coverage", 0)
    else:
        # Default: Python coverage
        cov = await _check_python_coverage(ws, coverage_paths)
        if cov is None:
            cov_source = ",".join(coverage_paths)
            return error(
                "NO_COVERAGE_DATA",
                "No coverage.json found. Run pytest with --cov first.",
                suggestion=f"Run 'pytest --cov={cov_source} --cov-report=json'",
            )
        total_coverage = cov.get("coverage", 0)

    config_source = "config" if threshold != 80 else "default"

    result_data = {
        "coverage": round(total_coverage, 1),
        "threshold": threshold,
        "warn_threshold": warn_threshold,
        "config_source": config_source,
    }

    if total_coverage < threshold:
        return error(
            "COVERAGE_TOO_LOW",
            f"Coverage {total_coverage:.1f}% is below threshold {threshold}%",
            suggestion=f"Add tests to reach {threshold}% coverage",
        )

    if total_coverage < warn_threshold:
        return success(
            data={**result_data, "status": "warning"},
            reasoning=f"Coverage {total_coverage:.1f}% is below target {warn_threshold}%",
        )

    return success(
        data={**result_data, "status": "passing"},
        reasoning=f"Coverage {total_coverage:.1f}% meets threshold {threshold}%",
    )


async def _check_npm_deps(ws: Path) -> CommandResult[dict]:
    """Check npm dependencies via 'npm outdated --json'."""
    result = await run_external_tool(
        "npm",
        ["outdated", "--json"],
        install_hint="Install Node.js from https://nodejs.org",
        cwd=ws,
    )
    if result is None:
        return error(
            "NPM_NOT_FOUND",
            "npm not found",
            suggestion="Install Node.js from https://nodejs.org",
        )

    try:
        outdated = json.loads(result.get("output", "{}"))
    except (json.JSONDecodeError, TypeError):
        outdated = {}

    result_data = {
        "checked": len(outdated),
        "outdated": list(outdated.keys()),
        "details": outdated,
    }

    if outdated:
        pkg_list = ", ".join(outdated.keys())
        return success(
            data=result_data,
            reasoning=f"{len(outdated)} npm package(s) outdated: {pkg_list}",
        )

    return success(
        data=result_data,
        reasoning="All npm packages are up-to-date",
    )


async def _check_cargo_deps(ws: Path) -> CommandResult[dict]:
    """Check Cargo dependencies via 'cargo outdated'."""
    result = await run_external_tool(
        "cargo",
        ["outdated", "-R", "--format", "json"],
        install_hint="cargo install cargo-outdated",
        cwd=ws,
    )
    if result is None:
        return error(
            "CARGO_OUTDATED_NOT_FOUND",
            "cargo-outdated not found",
            suggestion="Install with: cargo install cargo-outdated",
        )

    try:
        data = json.loads(result.get("output", "{}"))
        dependencies = data.get("dependencies", [])
    except (json.JSONDecodeError, TypeError):
        dependencies = []

    result_data = {
        "checked": len(dependencies),
        "outdated": [d.get("name", "") for d in dependencies],
        "details": dependencies,
    }

    if dependencies:
        pkg_list = ", ".join(d.get("name", "") for d in dependencies[:5])
        return success(
            data=result_data,
            reasoning=f"{len(dependencies)} crate(s) outdated: {pkg_list}",
        )

    return success(
        data=result_data,
        reasoning="All crate dependencies are up-to-date",
    )


async def _check_deps_for_language(
    lang: str,
    ws: Path,
    config: object,
    staged_only: bool,
) -> CommandResult[dict]:
    """Check deps for a single language."""
    if lang == "typescript":
        return await _check_npm_deps(ws)
    elif lang == "rust":
        return await _check_cargo_deps(ws)
    else:
        return await _check_pypi_deps(ws, config, staged_only)


async def dev_check_deps(
    staged_only: bool = True,
    language: str | None = None,
) -> CommandResult[dict]:
    """Check that dependencies are up-to-date.

    Dispatches to PyPI (Python), npm (TypeScript), or cargo-outdated (Rust).
    When multiple languages are configured and no --language is given,
    checks all ecosystems.
    Requires httpx for Python: pip install botcore[quality]
    """
    from botcore.commands.dev.core import _aggregate_results, _should_run_all

    ws = find_workspace()
    if not ws:
        return error(
            "NO_WORKSPACE",
            "Could not find workspace root",
            suggestion="Run from within a Git repository",
        )

    config = load_config(workspace=ws)

    if _should_run_all(language, None, config):
        results: dict[str, CommandResult[dict]] = {}
        for lang in config.languages:
            results[lang] = await _check_deps_for_language(lang, ws, config, staged_only)
        return _aggregate_results(results, "check-deps")

    lang = resolve_language(
        None,
        config,
        ws,
        language_override=language,
    )

    return await _check_deps_for_language(lang or "python", ws, config, staged_only)
