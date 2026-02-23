"""Test helpers for executing and validating AFD commands.

These helpers provide convenience functions for testing command handlers
with automatic timing, error wrapping, and result validation.

Example:
    >>> from afd.testing.helpers import test_command, create_mock_command
    >>>
    >>> result = await test_command(my_handler, {"title": "Test"})
    >>> assert result.is_success
    >>> assert result.execution_time_ms >= 0
"""

import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, Generic, List, Optional, TypeVar

from afd.core.commands import CommandContext, CommandDefinition, CommandHandler, CommandParameter
from afd.core.result import CommandError as ResultCommandError
from afd.core.result import CommandResult, failure, is_failure, is_success, success
from afd.core.result import error as result_error
from afd.testing.validators import (
    ResultValidationOptions,
    ValidationResult,
    validate_command_definition,
    validate_result,
)

T = TypeVar("T")


@dataclass
class CommandTestResult(Generic[T]):
    """Result of running a command through test_command().

    Attributes:
        result: The CommandResult returned by the handler.
        validation: Validation result from validate_result().
        execution_time_ms: Wall-clock execution time in milliseconds.
        is_valid: True when validation passed (no errors).
        is_success: True when the command succeeded.
        is_failure: True when the command failed.
    """

    result: CommandResult[T]
    validation: ValidationResult
    execution_time_ms: float
    is_valid: bool
    is_success: bool
    is_failure: bool


def create_test_context(
    overrides: Optional[dict[str, Any]] = None,
) -> CommandContext:
    """Create a CommandContext suitable for testing.

    Generates a unique trace_id and sets a 5-second timeout.
    Override any field via the overrides dict.

    Args:
        overrides: Optional dict of field overrides.

    Returns:
        A CommandContext with sensible test defaults.

    Example:
        >>> ctx = create_test_context({"timeout": 10000})
        >>> assert ctx.timeout == 10000
        >>> assert ctx.trace_id is not None
    """
    defaults: dict[str, Any] = {
        "trace_id": f"test-{uuid.uuid4().hex[:12]}",
        "timeout": 5000,
        "extra": {"environment": "test"},
    }
    if overrides:
        if "extra" in overrides and "extra" in defaults:
            defaults["extra"] = {**defaults["extra"], **overrides.pop("extra")}
        defaults.update(overrides)

    return CommandContext(**defaults)


async def test_command(
    handler: Callable[..., Any],
    input: Any,
    *,
    context: Optional[CommandContext] = None,
    validation: Optional[ResultValidationOptions] = None,
) -> CommandTestResult[Any]:
    """Execute a command handler with timing and validation.

    Wraps exceptions in a failure result, measures wall-clock time,
    and runs validate_result() on the output.

    Args:
        handler: The async handler function to test.
        input: Input to pass to the handler.
        context: Optional CommandContext (created if not provided).
        validation: Optional validation options.

    Returns:
        A CommandTestResult with the result, timing, and validation.

    Example:
        >>> async def my_handler(input, context=None):
        ...     return success({"id": 1})
        >>> tr = await test_command(my_handler, {})
        >>> assert tr.is_success
        >>> assert tr.execution_time_ms >= 0
    """
    ctx = context or create_test_context()
    start = time.perf_counter()

    try:
        result = await handler(input, ctx)
    except Exception as e:
        result = result_error("INTERNAL_ERROR", str(e))

    elapsed_ms = (time.perf_counter() - start) * 1000
    vr = validate_result(result, validation)

    return CommandTestResult(
        result=result,
        validation=vr,
        execution_time_ms=elapsed_ms,
        is_valid=vr.valid,
        is_success=is_success(result),
        is_failure=is_failure(result),
    )


async def test_command_definition(
    command: CommandDefinition,
    input: Any,
    *,
    context: Optional[CommandContext] = None,
    result_validation: Optional[ResultValidationOptions] = None,
) -> dict[str, Any]:
    """Validate a command definition and execute it.

    First validates the definition metadata (name, description,
    parameters, handler), then executes the handler and validates
    the result.

    Args:
        command: The full CommandDefinition to test.
        input: Input to pass to the handler.
        context: Optional CommandContext.
        result_validation: Optional result validation options.

    Returns:
        A dict with keys: definition_validation, result_validation,
        result, execution_time_ms.

    Example:
        >>> r = await test_command_definition(my_cmd, {"title": "Hi"})
        >>> assert r["definition_validation"].valid
        >>> assert r["result"].success
    """
    def_validation = validate_command_definition(command)

    tr = await test_command(
        command.handler,
        input,
        context=context,
        validation=result_validation,
    )

    return {
        "definition_validation": def_validation,
        "result_validation": tr.validation,
        "result": tr.result,
        "execution_time_ms": tr.execution_time_ms,
    }


async def test_command_multiple(
    handler: Callable[..., Any],
    test_cases: List[dict[str, Any]],
    *,
    context: Optional[CommandContext] = None,
    validation: Optional[ResultValidationOptions] = None,
) -> List[dict[str, Any]]:
    """Batch-test a handler against multiple input/expectation pairs.

    Each test case dict may contain:
    - input (required): The handler input.
    - expect_success (bool): Whether success is expected.
    - expect_error (str): Expected error code on failure.
    - description (str): Human label for reporting.

    Args:
        handler: The async handler function to test.
        test_cases: List of test case dicts.
        context: Optional shared CommandContext.
        validation: Optional shared validation options.

    Returns:
        A list of dicts, each containing CommandTestResult fields
        plus input, passed, and description.

    Example:
        >>> cases = [
        ...     {"input": {"title": "OK"}, "expect_success": True},
        ...     {"input": {}, "expect_success": False, "expect_error": "VALIDATION_ERROR"},
        ... ]
        >>> results = await test_command_multiple(my_handler, cases)
        >>> assert all(r["passed"] for r in results)
    """
    results = []

    for tc in test_cases:
        tr = await test_command(
            handler,
            tc["input"],
            context=context,
            validation=validation,
        )

        passed = tr.is_valid

        if "expect_success" in tc:
            passed = passed and (tr.is_success == tc["expect_success"])

        if "expect_error" in tc and tr.is_failure:
            passed = passed and (tr.result.error is not None and tr.result.error.code == tc["expect_error"])

        results.append({
            "result": tr.result,
            "validation": tr.validation,
            "execution_time_ms": tr.execution_time_ms,
            "is_valid": tr.is_valid,
            "is_success": tr.is_success,
            "is_failure": tr.is_failure,
            "input": tc["input"],
            "passed": passed,
            "description": tc.get("description"),
        })

    return results


def create_mock_command(
    name: str,
    mock_handler: Callable[..., Any],
) -> CommandDefinition:
    """Create a mock CommandDefinition wrapping a simple function.

    The mock_handler receives input and should return raw data.
    It is automatically wrapped in success(). If it raises, the
    exception is wrapped in failure().

    Args:
        name: Command name.
        mock_handler: Function that returns data or raises.

    Returns:
        A CommandDefinition with the wrapped handler.

    Example:
        >>> cmd = create_mock_command("user-get", lambda inp: {"id": 1})
        >>> result = await cmd.handler({"id": 1})
        >>> assert result.success
    """
    async def handler(input: Any, context: Optional[CommandContext] = None) -> CommandResult[Any]:
        try:
            data = mock_handler(input)
            # Support async mock handlers
            if hasattr(data, "__await__"):
                data = await data
            return success(data)
        except Exception as e:
            return result_error("INTERNAL_ERROR", str(e))

    return CommandDefinition(
        name=name,
        description=f"Mock command: {name}",
        handler=handler,
        category="mock",
        parameters=[],
    )


def create_success_command(
    name: str,
    data: Any,
) -> CommandDefinition:
    """Create a mock command that always succeeds with fixed data.

    Args:
        name: Command name.
        data: The data to return on every call.

    Returns:
        A CommandDefinition that always returns success(data).

    Example:
        >>> cmd = create_success_command("health-check", {"status": "ok"})
        >>> result = await cmd.handler({})
        >>> assert result.data == {"status": "ok"}
    """
    return create_mock_command(name, lambda _input: data)


def create_failure_command(
    name: str,
    error: dict[str, str],
) -> CommandDefinition:
    """Create a mock command that always fails with a fixed error.

    Args:
        name: Command name.
        error: Dict with "code" and "message" keys.

    Returns:
        A CommandDefinition that always returns failure.

    Example:
        >>> cmd = create_failure_command("broken", {"code": "BROKEN", "message": "Oops"})
        >>> result = await cmd.handler({})
        >>> assert not result.success
        >>> assert result.error.code == "BROKEN"
    """
    async def handler(input: Any, context: Optional[CommandContext] = None) -> CommandResult[Any]:
        return failure(ResultCommandError(code=error["code"], message=error["message"]))

    return CommandDefinition(
        name=name,
        description=f"Mock failing command: {name}",
        handler=handler,
        category="mock",
        parameters=[],
    )
