"""alfred_lint — AFD architecture compliance validation.

Wraps the existing AFDLinter from afd.lushx_ext.linters to provide
deterministic lint checks as a CommandResult-returning command.
"""

from pathlib import Path

from afd.core.result import CommandResult, success, error
from afd.lushx_ext.linters import AFDLinter


async def alfred_lint(path: str | None = None) -> CommandResult[dict]:
    """Run AFD architecture compliance validation.

    Scans Python, TypeScript, and Rust files for AFD pattern violations
    including missing CommandResult returns, non-actionable errors,
    direct API calls in UI, non-kebab command names, and layer import violations.

    Args:
        path: Directory to lint. Defaults to current working directory.

    Returns:
        CommandResult with lint summary and per-file issues.
    """
    target = Path(path) if path else Path(".")

    if not target.exists():
        return error(
            "NOT_FOUND",
            f"Directory '{target}' not found",
            suggestion=f"Check the path exists: {target.resolve()}",
        )

    linter = AFDLinter()
    result = linter.lint(target)

    return success(
        data={
            "passed": result.passed,
            "files_checked": result.files_checked,
            "error_count": result.error_count,
            "warning_count": result.warning_count,
            "issues": [issue.to_dict() for issue in result.issues],
        },
        confidence=1.0,
        reasoning=(
            f"Checked {result.files_checked} files: "
            f"{result.error_count} errors, {result.warning_count} warnings"
        ),
    )
