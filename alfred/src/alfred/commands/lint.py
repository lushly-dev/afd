"""alfred_lint — AFD architecture compliance validation.

Wraps the existing AFDLinter from afd.lushx_ext.linters to provide
deterministic lint checks as a CommandResult-returning command.
"""

from pathlib import Path
from typing import Any

from afd.core.result import CommandResult, error, success
from afd.lushx_ext.linters import AFDLinter


async def alfred_lint(
    path: str | None = None,
    exclude_story_test_files: bool | None = None,
    rule_path_excludes: dict[str, list[str]] | None = None,
    rule_severity_overrides: dict[str, str] | None = None,
) -> CommandResult[dict]:
    """Run AFD architecture compliance validation.

    Scans Python, TypeScript, and Rust files for AFD pattern violations
    including missing CommandResult returns, non-actionable errors,
    direct API calls in UI, non-kebab command names, and layer import violations.

    Args:
        path: Directory to lint. Defaults to current working directory.
        exclude_story_test_files: Skip the UI-directory rules on story and
            unit/spec test files. Defaults to the linter's default (True).
        rule_path_excludes: Rule id to path substrings whose findings for
            that rule are suppressed.
        rule_severity_overrides: Rule id to "error", "warning" or "off".
            "off" counts the rule's findings as suppressed (severity-off).

    Returns:
        CommandResult with lint summary, per-file issues and the suppressed
        summary (total, by_rule, by_reason), so "0 errors" from a clean tree
        can be told apart from "0 errors" because findings were suppressed.
    """
    target = Path(path) if path else Path(".")

    if not target.exists():
        return error(
            "NOT_FOUND",
            f"Directory '{target}' not found",
            suggestion=f"Check the path exists: {target.resolve()}",
        )

    # Pass only the options the caller set, so the defaults stay the linter's.
    options: dict[str, Any] = {}
    if exclude_story_test_files is not None:
        options["exclude_story_test_files"] = exclude_story_test_files
    if rule_path_excludes is not None:
        options["rule_path_excludes"] = rule_path_excludes
    if rule_severity_overrides is not None:
        options["rule_severity_overrides"] = rule_severity_overrides

    try:
        linter = AFDLinter(**options)
    except ValueError as exc:
        return error(
            "INVALID_INPUT",
            str(exc),
            suggestion="Use a known rule id and one of 'error', 'warning' or 'off'",
        )
    result = linter.lint(target)
    suppressed = result.suppressed_summary()

    reasoning = (
        f"Checked {result.files_checked} files: "
        f"{result.error_count} errors, {result.warning_count} warnings"
    )
    if suppressed["total"]:
        reasoning += f" ({suppressed['total']} suppressed)"

    return success(
        data={
            "passed": result.passed,
            "files_checked": result.files_checked,
            "error_count": result.error_count,
            "warning_count": result.warning_count,
            "issues": [issue.to_dict() for issue in result.issues],
            "suppressed": suppressed,
        },
        confidence=1.0,
        reasoning=reasoning,
    )
