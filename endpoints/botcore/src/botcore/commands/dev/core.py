"""Core dev commands — lint, test, build, skill-lint (language-aware dispatch)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from afd import CommandResult, error, success

from botcore.config import BotCoreConfig, load_config
from botcore.utils.runner import run_command, run_python_module
from botcore.utils.workspace import find_workspace, resolve_language


def _infrastructure_failure(result: dict) -> CommandResult | None:
    kind = result.get("failure_kind")
    if kind not in {"unavailable", "error"}:
        return None
    return error(
        "TOOL_UNAVAILABLE" if kind == "unavailable" else "TOOL_EXECUTION_ERROR",
        result.get("error") or "Native tool infrastructure failed",
        suggestion="Install the configured tool or inspect its execution environment and retry",
    )


# ── Single-language helpers ──────────────────────────────────────────────


async def _lint_single_language(
    lang: str,
    ws: Path,
    config: BotCoreConfig,
    package: str | None,
    fix: bool,
) -> CommandResult[dict]:
    """Run linting for a single language."""
    tools = config.get_tools_for(lang)
    linter = tools.get("linter") or config.linter

    if not linter:
        return error(
            "NO_LINTER",
            f"No linter configured for {lang}",
            suggestion="Set 'language' in [tool.botcore] config",
        )

    if linter == "ruff":
        args = ["check", "."]
        if fix:
            args.append("--fix")
        result = await run_python_module("ruff", args, cwd=ws)
        fix_cmd = "ruff check . --fix"
    elif linter == "biome":
        args = ["npx", "biome", "check", "."]
        if fix:
            args.append("--write")
        result = await run_command(args, cwd=ws)
        fix_cmd = "npx biome check . --write"
    elif linter == "clippy":
        args = ["cargo", "clippy"]
        if fix:
            args.extend(["--fix", "--allow-dirty"])
        result = await run_command(args, cwd=ws)
        fix_cmd = "cargo clippy --fix"
    else:
        return error("UNKNOWN_LINTER", f"Unknown linter: {linter}")

    infrastructure = _infrastructure_failure(result)
    if infrastructure is not None:
        return infrastructure
    if result.get("success"):
        return success(data=result, reasoning=f"[{lang}] All checks passed")
    output = result.get("output", "")
    error_msg = result.get("error") or output or "Lint failed"
    return error("LINT_FAILED", error_msg, suggestion=f"Run '{fix_cmd}' to auto-fix issues")


async def _test_single_language(
    lang: str,
    ws: Path,
    config: BotCoreConfig,
    package: str | None,
    coverage: bool,
) -> CommandResult[dict]:
    """Run tests for a single language."""
    tools = config.get_tools_for(lang)
    test_runner = tools.get("test_runner") or config.test_runner

    if not test_runner:
        return error(
            "NO_TEST_RUNNER",
            f"No test runner configured for {lang}",
            suggestion="Set 'language' in [tool.botcore] config",
        )

    if test_runner == "pytest":
        args = []
        if package:
            args.append(f"packages/{package}")
        if coverage:
            args.extend(["--cov", "--cov-report=term-missing"])
        result = await run_python_module("pytest", args, cwd=ws)
        run_cmd = "pytest -v"
    elif test_runner == "vitest":
        args = ["npx", "vitest", "run"]
        if package:
            args.extend(["--project", package])
        result = await run_command(args, cwd=ws)
        run_cmd = "npx vitest run"
    elif test_runner == "cargo-test":
        args = ["cargo", "test"]
        if package:
            args.extend(["-p", package])
        result = await run_command(args, cwd=ws)
        run_cmd = "cargo test"
    else:
        return error("UNKNOWN_TEST_RUNNER", f"Unknown test runner: {test_runner}")

    infrastructure = _infrastructure_failure(result)
    if infrastructure is not None:
        return infrastructure
    if result.get("success"):
        return success(data=result, reasoning=f"[{lang}] All tests passed")
    output = result.get("output", "")
    error_msg = result.get("error") or output or "Tests failed"
    return error("TEST_FAILED", error_msg, suggestion=f"Run '{run_cmd}' locally for details")


async def _build_single_language(
    lang: str,
    ws: Path,
    config: BotCoreConfig,
    package: str | None,
) -> CommandResult[dict]:
    """Build for a single language."""
    if lang == "python":
        if not package:
            return error(
                "PACKAGE_REQUIRED",
                "Package name required for Python build",
                suggestion="Specify a package: botcore dev build <package>",
            )
        pkg_path = ws / "packages" / package if ws else Path(package)
        result = await run_python_module("hatch", ["build"], cwd=pkg_path)
    elif lang == "typescript":
        args = ["npx", "turbo", "build"]
        if package:
            args.extend(["--filter", package])
        result = await run_command(args, cwd=ws)
    elif lang == "rust":
        args = ["cargo", "build"]
        if package:
            args.extend(["-p", package])
        result = await run_command(args, cwd=ws)
    else:
        return error(
            "NO_LANGUAGE",
            f"No build configuration for language: {lang}",
            suggestion="Set 'language' in [tool.botcore] config",
        )

    infrastructure = _infrastructure_failure(result)
    if infrastructure is not None:
        return infrastructure
    if result.get("success"):
        return success(data=result, reasoning=f"[{lang}] Build succeeded")
    return error(
        "BUILD_FAILED",
        result.get("error", "Build failed"),
        suggestion="Check build logs and ensure dependencies are installed",
    )


# ── Multi-language aggregation ───────────────────────────────────────────


def _aggregate_results(
    results: dict[str, CommandResult[dict]],
    command_name: str,
) -> CommandResult[dict]:
    """Aggregate per-language results into a single CommandResult."""
    if not results:
        return error(
            "EMPTY_QUALITY_PLAN",
            "No native checks were selected",
            suggestion="Select at least one configured language",
        )
    languages: dict[str, Any] = {}
    passed = 0
    failed = 0

    for lang, result in results.items():
        languages[lang] = {
            "success": result.success,
            "data": result.data,
        }
        if result.success:
            passed += 1
        else:
            failed += 1

    summary = {"passed": passed, "failed": failed, "total": passed + failed}
    data = {"languages": languages, "summary": summary}

    if failed:
        failed_langs = [lang for lang, r in results.items() if not r.success]
        codes = {result.error.code for result in results.values() if result.error}
        code = (
            "TOOL_EXECUTION_ERROR"
            if "TOOL_EXECUTION_ERROR" in codes
            else (
                "TOOL_UNAVAILABLE"
                if "TOOL_UNAVAILABLE" in codes
                else f"{command_name.upper()}_FAILED"
            )
        )
        return error(
            code,
            f"{command_name} failed for: {', '.join(failed_langs)}",
            suggestion="Run with --language <lang> to debug individual failures",
        )

    return success(
        data=data,
        reasoning=f"All {passed} language(s) passed {command_name}",
    )


def _should_run_all(
    language: str | None,
    path: str | None,
    config: BotCoreConfig,
) -> bool:
    """Check if we should iterate all configured languages."""
    return language is None and path is None and len(config.languages) > 1


# ── Public commands ──────────────────────────────────────────────────────


async def dev_lint(
    package: str | None = None,
    fix: bool = False,
    language: str | None = None,
    path: str | None = None,
) -> CommandResult[dict]:
    """Run linting using the configured linter.

    Dispatches to ruff (Python), biome (TypeScript), or clippy (Rust)
    based on the workspace language configuration.
    When multiple languages are configured and no --language is given,
    runs all sequentially.
    """
    ws = find_workspace()
    config = load_config(workspace=ws)

    if _should_run_all(language, path, config):
        results: dict[str, CommandResult[dict]] = {}
        for lang in config.languages:
            results[lang] = await _lint_single_language(lang, ws, config, package, fix)
        return _aggregate_results(results, "lint")

    lang = (
        resolve_language(
            Path(path) if path else None,
            config,
            ws,
            language_override=language,
        )
        if ws
        else config.language
    )

    if not lang:
        return error(
            "NO_LINTER",
            "No linter configured and language could not be detected",
            suggestion="Set 'language' in [tool.botcore] config",
        )

    return await _lint_single_language(lang, ws, config, package, fix)


async def dev_test(
    package: str | None = None,
    coverage: bool = False,
    language: str | None = None,
    path: str | None = None,
) -> CommandResult[dict]:
    """Run tests using the configured test runner.

    Dispatches to pytest (Python), vitest (TypeScript), or cargo test (Rust).
    When multiple languages are configured and no --language is given,
    runs all sequentially.
    """
    ws = find_workspace()
    config = load_config(workspace=ws)

    if _should_run_all(language, path, config):
        results: dict[str, CommandResult[dict]] = {}
        for lang in config.languages:
            results[lang] = await _test_single_language(lang, ws, config, package, coverage)
        return _aggregate_results(results, "test")

    lang = (
        resolve_language(
            Path(path) if path else None,
            config,
            ws,
            language_override=language,
        )
        if ws
        else config.language
    )

    if not lang:
        return error(
            "NO_TEST_RUNNER",
            "No test runner configured and language could not be detected",
            suggestion="Set 'language' in [tool.botcore] config",
        )

    return await _test_single_language(lang, ws, config, package, coverage)


async def dev_build(
    package: str | None = None,
    language: str | None = None,
    path: str | None = None,
) -> CommandResult[dict]:
    """Build a package using the language-appropriate build tool.

    When multiple languages are configured and no --language is given,
    runs all sequentially.
    """
    ws = find_workspace()
    config = load_config(workspace=ws)

    if _should_run_all(language, path, config):
        results: dict[str, CommandResult[dict]] = {}
        for lang in config.languages:
            results[lang] = await _build_single_language(lang, ws, config, package)
        return _aggregate_results(results, "build")

    lang = (
        resolve_language(
            Path(path) if path else None,
            config,
            ws,
            language_override=language,
        )
        if ws
        else config.language
    )

    if not lang:
        return error(
            "NO_LANGUAGE",
            "No language detected for build",
            suggestion="Set 'language' in [tool.botcore] config",
        )

    return await _build_single_language(lang, ws, config, package)


async def dev_skill_lint() -> CommandResult[dict]:
    """Lint Claude skills for common issues.

    Delegates to the full skill_lint command in botcore.commands.skill.lint.
    """
    from botcore.commands.skill.lint import skill_lint

    return await skill_lint()
