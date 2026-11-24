"""Quality gate commands — check-size, check-coverage, check-deps, check-lockfile.

Dependency discovery and PyPI checks live in dependencies.py and the lockfile check in
lockfile.py; both are re-exported here.
"""

from __future__ import annotations

import json
import math
import re
import subprocess
import tempfile
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


def _valid_pct(value: object) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return float(value) if 0 <= value <= 100 else None
    if isinstance(value, float):
        return value if math.isfinite(value) and 0.0 <= value <= 100.0 else None
    return None


def _nonneg_number(value: object) -> int | float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value >= 0 else None
    if isinstance(value, float):
        return value if math.isfinite(value) and value >= 0.0 else None
    return None


def _safe_ratio_pct(covered: int | float, total: int | float) -> float | None:
    if total <= 0 or covered < 0 or covered > total:
        return None
    try:
        return _valid_pct((covered * 100) / total)
    except OverflowError:
        return None


def _try_parse_json(raw: str) -> tuple[bool, object]:
    try:
        return True, json.loads(raw)
    except Exception:
        return False, None


def _pct_from_ts_summary(data: object) -> float | None:
    if not isinstance(data, dict):
        return None
    total = data.get("total")
    if isinstance(total, dict):
        for metric in ("lines", "statements", "branches", "functions"):
            entry = total.get(metric)
            pct = _valid_pct(entry.get("pct") if isinstance(entry, dict) else None)
            if pct is not None:
                return pct
    totals = data.get("totals")
    if isinstance(totals, dict):
        return _valid_pct(totals.get("percent_covered"))
    return None


def _pct_from_istanbul_final(data: object) -> float | None:
    if not isinstance(data, dict):
        return None
    covered = 0
    total_stmts = 0
    for entry in data.values():
        stmts = entry.get("s") if isinstance(entry, dict) else None
        if not isinstance(stmts, dict):
            continue
        for raw_count in stmts.values():
            count = _nonneg_number(raw_count)
            if count is not None:
                total_stmts += 1
                if count > 0:
                    covered += 1
    return _safe_ratio_pct(covered, total_stmts)


def _load_json_safe(path: Path) -> object | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


_VITEST_TABLE_ROW_RE = re.compile(
    r"[ \t]*All files[ \t]*\|[ \t]*([0-9]+(?:\.[0-9]+)?)[ \t]*\|"
    r"[ \t]*[0-9]+(?:\.[0-9]+)?[ \t]*\|[ \t]*[0-9]+(?:\.[0-9]+)?[ \t]*\|"
    r"[ \t]*[0-9]+(?:\.[0-9]+)?[ \t]*(?:\|[ \t]*[0-9,\- \t]*)?"
)
_VITEST_TEXT_SUMMARY_RE = re.compile(
    r"[ \t]*(?:Lines|Statements)[ \t]*:[ \t]*([0-9]+(?:\.[0-9]+)?)%"
    r"[ \t]*\([ \t]*\d+/\d+[ \t]*\)[ \t]*"
)
_TARPAULIN_SUMMARY_RE = re.compile(
    r"[ \t]*([0-9]+(?:\.[0-9]+)?)%[ \t]+coverage,[ \t]+\d+/\d+[ \t]+lines[ \t]+covered"
    r"(?:,[ \t]+[+-]?[0-9]+(?:\.[0-9]+)?%[ \t]+change[ \t]+in[ \t]+coverage)?[ \t]*"
)
_MISSING_TARPAULIN_RE = re.compile(
    r"no such (?:sub)?command:[ \t]*(?:`tarpaulin`|tarpaulin(?=$|[\s.,;:!?]))"
)


def _match_line_pct(raw_output: str, patterns: tuple[re.Pattern[str], ...]) -> float | None:
    for line in raw_output.splitlines():
        for pattern in patterns:
            match = pattern.fullmatch(line)
            if match:
                pct = _valid_pct(float(match.group(1)))
                if pct is not None:
                    return pct
    return None


def _extract_ts_coverage_pct(report_dir: Path, raw_output: str) -> float | None:
    """Extract a coverage percentage from an isolated Vitest report dir or stdout."""
    pct = _pct_from_ts_summary(_load_json_safe(report_dir / "coverage-summary.json"))
    if pct is not None:
        return pct
    pct = _pct_from_istanbul_final(_load_json_safe(report_dir / "coverage-final.json"))
    if pct is not None:
        return pct
    if not raw_output:
        return None
    is_json, parsed = _try_parse_json(raw_output)
    if is_json:
        pct = _pct_from_ts_summary(parsed)
        return pct if pct is not None else _pct_from_istanbul_final(parsed)
    return _match_line_pct(raw_output, (_VITEST_TABLE_ROW_RE, _VITEST_TEXT_SUMMARY_RE))


def _extract_tarpaulin_pct(data: object) -> float | None:
    if not isinstance(data, dict):
        return None
    pct = _valid_pct(data.get("coverage"))
    if pct is not None:
        return pct
    covered = _nonneg_number(data.get("covered"))
    coverable = _nonneg_number(data.get("coverable"))
    if covered is not None and coverable is not None:
        return _safe_ratio_pct(covered, coverable)
    files = data.get("files")
    if isinstance(files, list):
        total_cov: int | float = 0
        total_coverable: int | float = 0
        for item in files:
            if not isinstance(item, dict):
                continue
            fc = _nonneg_number(item.get("covered"))
            ft = _nonneg_number(item.get("coverable"))
            if fc is not None and ft is not None:
                try:
                    total_cov += fc
                    total_coverable += ft
                except OverflowError:
                    return None
        return _safe_ratio_pct(total_cov, total_coverable)
    return None


def _extract_rust_coverage_pct(report_dir: Path, raw_output: str) -> float | None:
    """Extract a coverage percentage from an isolated tarpaulin report dir or stdout."""
    pct = _extract_tarpaulin_pct(_load_json_safe(report_dir / "tarpaulin-report.json"))
    if pct is not None:
        return pct
    if not raw_output:
        return None
    is_json, parsed = _try_parse_json(raw_output)
    if is_json:
        return _extract_tarpaulin_pct(parsed)
    return _match_line_pct(raw_output, (_TARPAULIN_SUMMARY_RE,))


async def _check_ts_coverage(ws: Path) -> dict | None:
    """Run vitest --coverage into an isolated report dir and return coverage data."""
    with tempfile.TemporaryDirectory(prefix="botcore-vitest-cov-") as report_dir:
        result = await run_external_tool(
            "npx",
            [
                "vitest",
                "run",
                "--coverage",
                "--coverage.reporter=json-summary",
                "--coverage.reporter=text-summary",
                f"--coverage.reportsDirectory={report_dir}",
                "--reporter=json",
            ],
            install_hint="npm i -D vitest @vitest/coverage-v8",
            cwd=ws,
        )
        if result is None:
            return None
        raw_output = result.get("output", "") or ""
        if not result.get("success"):
            return {"error": "run_failed", "raw_output": raw_output, "tool": "vitest"}
        pct = _extract_ts_coverage_pct(Path(report_dir), raw_output)
        if pct is None:
            return {"error": "no_metrics", "raw_output": raw_output, "tool": "vitest"}
        return {"coverage": pct, "raw_output": raw_output, "tool": "vitest"}


async def _check_rust_coverage(ws: Path) -> dict | None:
    """Run cargo-tarpaulin into an isolated output dir and return coverage data."""
    with tempfile.TemporaryDirectory(prefix="botcore-tarpaulin-") as report_dir:
        result = await run_external_tool(
            "cargo",
            ["tarpaulin", "--out", "Json", "--output-dir", report_dir],
            install_hint="cargo install cargo-tarpaulin",
            cwd=ws,
        )
        if result is None:
            return None
        raw_output = result.get("output", "") or ""
        if not result.get("success"):
            combined = f"{raw_output}\n{result.get('error') or ''}".lower()
            if _MISSING_TARPAULIN_RE.search(combined):
                return None
            return {"error": "run_failed", "raw_output": raw_output, "tool": "tarpaulin"}
        pct = _extract_rust_coverage_pct(Path(report_dir), raw_output)
        if pct is None:
            return {"error": "no_metrics", "raw_output": raw_output, "tool": "tarpaulin"}
        return {"coverage": pct, "raw_output": raw_output, "tool": "tarpaulin"}


def _coverage_tool_error(
    lang_label: str, install_hint: str, cov: dict | None
) -> CommandResult[dict]:
    if cov is None:
        return error(
            "NO_COVERAGE_DATA",
            f"Could not collect {lang_label} coverage",
            suggestion=f"Install with: {install_hint}",
        )
    if cov.get("error") == "run_failed":
        return error(
            "NO_COVERAGE_DATA",
            f"{lang_label} coverage run failed",
            suggestion="Fix failing tests or coverage tool errors and re-run",
        )
    return error(
        "NO_COVERAGE_DATA",
        f"{lang_label} coverage run produced no parseable coverage metrics",
        suggestion="Ensure the coverage reporter is enabled and writes a valid report",
    )


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
        if cov is None or "error" in cov:
            return _coverage_tool_error("TypeScript", "npm i -D vitest @vitest/coverage-v8", cov)
        total_coverage = cov.get("coverage", 0)
    elif lang == "rust":
        cov = await _check_rust_coverage(ws)
        if cov is None or "error" in cov:
            return _coverage_tool_error("Rust", "cargo install cargo-tarpaulin", cov)
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
        for item_lang in config.languages:
            results[item_lang] = await _check_deps_for_language(item_lang, ws, config, staged_only)
        return _aggregate_results(results, "check-deps")

    lang = resolve_language(
        None,
        config,
        ws,
        language_override=language,
    )

    return await _check_deps_for_language(lang or "python", ws, config, staged_only)
