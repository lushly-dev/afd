"""Quality gate commands — check-size, check-coverage, check-deps."""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

from afd import CommandResult, error, success

from botcore.config import load_config
from botcore.utils.runner import run_external_tool, run_python_module
from botcore.utils.workspace import find_workspace, resolve_language

_LANG_EXTENSIONS: dict[str, list[str]] = {
    "python": [".py"],
    "typescript": [".ts", ".tsx", ".js", ".jsx"],
    "rust": [".rs"],
}

# Directory names never scanned for size — dependency trees and build output
_SKIP_DIRS = {"node_modules", "__pycache__", "dist", "build", "target", ".venv", ".git", "coverage"}


def _parse_version(version: str) -> tuple[int, int, int]:
    """Parse version string into (major, minor, patch) tuple."""
    match = re.match(r"(\d+)(?:\.(\d+))?(?:\.(\d+))?", version)
    if not match:
        return (0, 0, 0)
    major = int(match.group(1)) if match.group(1) else 0
    minor = int(match.group(2)) if match.group(2) else 0
    patch = int(match.group(3)) if match.group(3) else 0
    return (major, minor, patch)


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

    check_path = Path(path) if path else (ws / "src" if ws else Path("src"))

    if not check_path.exists():
        return error(
            "PATH_NOT_FOUND",
            f"Path not found: {check_path}",
            suggestion="Verify the path exists or omit to use default src/",
        )

    # If staged_only, filter to only staged files
    if staged_only:
        result = subprocess.run(
            ["git", "diff", "--cached", "--name-only"],
            cwd=ws or Path.cwd(), capture_output=True, text=True,
        )
        if result.returncode == 0:
            staged_files = set(
                str((ws or Path.cwd()) / f.strip())
                for f in result.stdout.strip().split("\n")
                if f.strip()
            )
        else:
            staged_files = None  # Fall back to scanning all
    else:
        staged_files = None

    # Determine which extensions to scan
    lang = resolve_language(
        Path(path) if path else None, config, ws, language_override=language,
    ) if ws else (language or config.language)
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
        relative_path = str(source_file.relative_to(ws) if ws else source_file)

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
    ws: Path, coverage_paths: list[str],
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
        "npx", ["vitest", "run", "--coverage", "--reporter=json"],
        install_hint="npm i -D vitest @vitest/coverage-v8",
        cwd=ws,
    )
    if result is None:
        return None
    return {"coverage": 0, "raw_output": result.get("output", ""), "tool": "vitest"}


async def _check_rust_coverage(ws: Path) -> dict | None:
    """Run cargo-tarpaulin and return coverage data."""
    result = await run_external_tool(
        "cargo", ["tarpaulin", "--out", "Json"],
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
        None, config, ws, language_override=language,
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


def _collect_staged_deps(ws: Path) -> list[str]:
    """Collect dependency names from staged git changes."""
    packages: list[str] = []

    result = subprocess.run(
        ["git", "diff", "--cached", "--unified=0", "pyproject.toml"],
        cwd=ws, capture_output=True, text=True,
    )
    if result.returncode == 0:
        for line in result.stdout.splitlines():
            if line.startswith("+") and not line.startswith("+++"):
                matches = re.findall(r'["\']?([a-zA-Z0-9_-]+)(?:[>=<\[].+)?["\']?,?', line)
                for match in matches:
                    if match and not match.startswith("#"):
                        packages.append(match.lower())

    req_file = ws / "requirements.txt"
    if req_file.exists():
        result = subprocess.run(
            ["git", "diff", "--cached", "--unified=0", "requirements.txt"],
            cwd=ws, capture_output=True, text=True,
        )
        if result.returncode == 0:
            for line in result.stdout.splitlines():
                if line.startswith("+") and not line.startswith("+++"):
                    match = re.match(r"\+([a-zA-Z0-9_-]+)", line)
                    if match:
                        packages.append(match.group(1).lower())

    return packages


def _collect_all_deps(ws: Path) -> list[str]:
    """Collect all declared dependency names from pyproject.toml."""
    import tomllib

    packages: list[str] = []
    pyproject = ws / "pyproject.toml"
    if pyproject.exists():
        data = tomllib.loads(pyproject.read_text(encoding="utf-8"))
        deps = data.get("project", {}).get("dependencies", [])
        for dep in deps:
            match = re.match(r"([a-zA-Z0-9_-]+)", dep)
            if match:
                packages.append(match.group(1).lower())
    return packages


async def _check_pkg_version(
    pkg: str,
    client: object,
    max_major: int,
    max_minor: int,
    outdated: list[str],
    errors: list[dict],
    warnings: list[dict],
) -> None:
    """Check a single package against PyPI and classify staleness."""
    result = subprocess.run(["pip", "show", pkg], capture_output=True, text=True)
    if result.returncode != 0:
        return

    installed_version = None
    for line in result.stdout.splitlines():
        if line.startswith("Version:"):
            installed_version = line.split(":", 1)[1].strip()
            break
    if not installed_version:
        return

    response = await client.get(f"https://pypi.org/pypi/{pkg}/json")  # type: ignore[union-attr]
    if response.status_code != 200:
        return

    latest_version = response.json().get("info", {}).get("version", "")
    if not latest_version:
        return

    installed_parts = _parse_version(installed_version)
    latest_parts = _parse_version(latest_version)
    major_behind = latest_parts[0] - installed_parts[0]
    minor_behind = latest_parts[1] - installed_parts[1] if major_behind == 0 else 0

    if major_behind > max_major:
        errors.append({
            "package": pkg, "installed": installed_version,
            "latest": latest_version, "major_behind": major_behind,
        })
        outdated.append(pkg)
    elif major_behind > 0 or minor_behind > max_minor:
        warnings.append({
            "package": pkg, "installed": installed_version,
            "latest": latest_version, "major_behind": major_behind,
            "minor_behind": minor_behind,
        })
        outdated.append(pkg)


async def _check_pypi_deps(
    ws: Path, config: object, staged_only: bool,
) -> CommandResult[dict]:
    """Check Python dependencies against PyPI."""
    try:
        import httpx
    except ImportError:
        return error(
            "MISSING_HTTPX",
            "httpx package required for dependency checking",
            suggestion="Install with: pip install botcore[quality]",
        )

    packages_to_check = _collect_staged_deps(ws) if staged_only else _collect_all_deps(ws)

    if not packages_to_check:
        return success(
            data={"checked": 0, "outdated": [], "errors": [], "warnings": []},
            reasoning="No new Python dependencies to check",
        )

    packages_to_check = list(set(packages_to_check))
    outdated: list[str] = []
    errors: list[dict] = []
    warnings: list[dict] = []

    async with httpx.AsyncClient(timeout=10.0) as client:
        for pkg in packages_to_check:
            try:
                await _check_pkg_version(
                    pkg, client, config.deps_max_major_behind,  # type: ignore[attr-defined]
                    config.deps_max_minor_behind,  # type: ignore[attr-defined]
                    outdated, errors, warnings,
                )
            except Exception:
                continue

    result_data = {
        "checked": len(packages_to_check), "packages": packages_to_check,
        "outdated": outdated, "errors": errors, "warnings": warnings,
    }

    if errors:
        pkg_list = ", ".join(
            f"{e['package']} ({e['installed']} → {e['latest']})" for e in errors
        )
        return error(
            "DEPS_TOO_OLD",
            f"Packages significantly outdated: {pkg_list}",
            suggestion="Update with: pip install --upgrade "
            + " ".join(e["package"] for e in errors),
        )

    if warnings:
        pkg_list = ", ".join(w["package"] for w in warnings)
        return success(
            data=result_data,
            reasoning=f"{len(warnings)} package(s) behind latest: {pkg_list}",
        )

    return success(
        data=result_data,
        reasoning=f"All {len(packages_to_check)} checked packages are up-to-date",
    )


async def _check_npm_deps(ws: Path) -> CommandResult[dict]:
    """Check npm dependencies via 'npm outdated --json'."""
    result = await run_external_tool(
        "npm", ["outdated", "--json"],
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
        "cargo", ["outdated", "-R", "--format", "json"],
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
    lang: str, ws: Path, config: object, staged_only: bool,
) -> CommandResult[dict]:
    """Check deps for a single language."""
    if lang == "typescript":
        return await _check_npm_deps(ws)
    elif lang == "rust":
        return await _check_cargo_deps(ws)
    else:
        return await _check_pypi_deps(ws, config, staged_only)


async def dev_check_deps(
    staged_only: bool = True, language: str | None = None,
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
        None, config, ws, language_override=language,
    )

    return await _check_deps_for_language(lang or "python", ws, config, staged_only)


async def dev_check_lockfile(
    path: str | None = None,
    language: str | None = None,
) -> CommandResult[dict]:
    """Check for lockfile drift — lockfile changed without manifest change.

    Detects when a lockfile is staged for commit without a corresponding
    manifest file change, which usually indicates accidental drift from
    running install commands.

    Warning-only: always returns success, but includes a warning message.
    """
    ws = find_workspace()
    if not ws:
        return error(
            "NO_WORKSPACE",
            "Could not find workspace root",
            suggestion="Run from within a Git repository",
        )

    config = load_config(workspace=ws)
    lang = resolve_language(
        Path(path) if path else None, config, ws, language_override=language,
    ) if ws else (language or config.language)

    # Language-specific lockfile -> manifest mappings
    lockfile_pairs: dict[str, list[tuple[str, list[str]]]] = {
        "typescript": [
            ("pnpm-lock.yaml", ["package.json", "packages/*/package.json"]),
            ("package-lock.json", ["package.json", "packages/*/package.json"]),
            ("yarn.lock", ["package.json", "packages/*/package.json"]),
        ],
        "python": [
            ("poetry.lock", ["pyproject.toml"]),
            ("uv.lock", ["pyproject.toml"]),
            ("Pipfile.lock", ["Pipfile"]),
        ],
        "rust": [
            ("Cargo.lock", ["Cargo.toml"]),
        ],
    }

    # Get staged files
    result = subprocess.run(
        ["git", "diff", "--cached", "--name-only"],
        cwd=ws, capture_output=True, text=True,
    )
    if result.returncode != 0:
        return success(
            data={"checked": False, "reason": "git diff failed"},
            reasoning="Could not check staged files",
        )

    staged = set(result.stdout.strip().split("\n")) if result.stdout.strip() else set()

    if not staged:
        return success(
            data={"checked": True, "drift": False},
            reasoning="No staged files",
        )

    # Check pairs for the detected language (or all if unknown)
    pairs_to_check = lockfile_pairs.get(lang, []) if lang else [
        pair for pairs in lockfile_pairs.values() for pair in pairs
    ]

    warnings = []
    for lockfile, manifests in pairs_to_check:
        if lockfile not in staged:
            continue

        # Check if any manifest file is also staged
        # Support glob patterns like "packages/*/package.json"
        manifest_staged = False
        for manifest in manifests:
            if "*" in manifest:
                # Glob pattern -- check if any matching file is staged
                import fnmatch
                manifest_staged = any(fnmatch.fnmatch(f, manifest) for f in staged)
            else:
                manifest_staged = manifest in staged
            if manifest_staged:
                break

        if not manifest_staged:
            warnings.append({
                "lockfile": lockfile,
                "expected_manifests": manifests,
                "message": f"{lockfile} changed without a manifest file change"
                " -- accidental install drift?",
            })

    return success(
        data={
            "checked": True,
            "drift": len(warnings) > 0,
            "warnings": warnings,
        },
        reasoning=f"{len(warnings)} lockfile drift warning(s)" if warnings
        else "No lockfile drift detected",
    )
