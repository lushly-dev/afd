"""
Scenario Executor.

Executes scenario steps sequentially, evaluates results, and produces a ScenarioResult.
Supports fixture loading and step references.
"""

from __future__ import annotations

import copy
import dataclasses
import inspect
import re
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel

from afd.core.actor import Actor
from afd.core.commands import CommandContext
from afd.core.errors import is_command_recovery
from afd.core.wire import to_wire
from afd.testing.scenarios.evaluator import evaluate_result, get_value_at_path
from afd.testing.scenarios.types import (
    AssertionResult,
    Expectation,
    FollowExpectation,
    Scenario,
    ScenarioOutcome,
    ScenarioResult,
    Step,
    StepError,
    StepOutcome,
    StepResult,
    create_step_error,
)

# ============================================================================
# Types
# ============================================================================

CommandHandler = Callable[..., Any]
"""Async function: (command, input) -> CommandResult dict.

A handler that declares a ``context`` parameter also receives
a :class:`~afd.core.CommandContext` for each step: its ``actor`` is
``Actor(kind="test")`` unless the executor config's ``context`` sets one.
"""


@dataclass
class InProcessExecutorConfig:
    """Configuration for in-process executor."""

    handler: CommandHandler
    """Command handler function."""

    stop_on_failure: bool = True
    """Stop on first failure."""

    dry_run: bool = False
    """Dry run mode - validate scenario structure without executing commands."""

    on_step_complete: Callable[[Step, StepResult], None] | None = None
    """Step completion callback."""

    on_scenario_start: Callable[[Scenario], None] | None = None
    """Scenario start callback."""

    on_scenario_complete: Callable[[ScenarioResult], None] | None = None
    """Scenario complete callback."""

    context: CommandContext | None = None
    """Context for every scenario step, e.g. with ``clock=fixed_clock("2026-01-01")``
    and ``random=seeded_random("abc")``. Its ``actor`` defaults to
    ``Actor(kind="test")``. Passed only to handlers that declare a ``context`` parameter."""


@dataclass
class ScenarioValidationResult:
    """Result from validate_scenario."""

    valid: bool
    """Whether scenario is valid."""

    errors: list[str] = field(default_factory=list)
    """Validation errors."""

    warnings: list[str] = field(default_factory=list)
    """Validation warnings."""

    metadata: dict[str, Any] = field(default_factory=dict)
    """Scenario metadata."""


# ============================================================================
# Helper Functions
# ============================================================================


def _format_assertion_failures(failures: list[AssertionResult]) -> str:
    """Format failed assertions into a human-readable error message."""
    if not failures:
        return "Assertions failed"

    if len(failures) == 1:
        return _format_assertion_failure(failures[0])

    lines = [f"  - {_format_assertion_failure(f)}" for f in failures]
    return f"{len(failures)} assertions failed:\n" + "\n".join(lines)


def _format_assertion_failure(failure: AssertionResult) -> str:
    # An unreadable recovery can look like the expected one, so say why it fails.
    if failure.matcher == "readable" and failure.description:
        return f"{failure.description}; got {_format_value_as_typescript(failure.actual)}"
    return (
        f"{failure.path}: expected {_format_value(failure.expected)}, "
        f"got {_format_value(failure.actual)}"
    )


def _format_value(value: Any) -> str:
    """Format a value for error message display."""
    if value is None:
        return "None"
    if isinstance(value, str):
        truncated = f'"{value[:40]}..."' if len(value) > 40 else f'"{value}"'
        return truncated
    if isinstance(value, (dict, list)):
        import json

        try:
            s = json.dumps(value)
            return s[:60] + "..." if len(s) > 60 else s
        except (TypeError, ValueError):
            return "[object]"
    return str(value)


def _format_value_as_typescript(value: Any) -> str:
    """``value`` as the TypeScript runner's ``formatValue`` prints it, for a message both
    runners word alike: compact JSON, cut at 60 characters, and a string cut at 40."""
    import json

    if value is None:
        return "null"
    if isinstance(value, str):
        return f'"{value[:40]}..."' if len(value) > 40 else f'"{value}"'
    try:
        text = json.dumps(value, separators=(",", ":"), ensure_ascii=False)
    except (TypeError, ValueError):
        return "[object]"
    return text[:60] + "..." if isinstance(value, (dict, list)) and len(text) > 60 else text


_TEST_ACTOR = Actor(kind="test")
"""The default actor of a scenario step."""


def _accepts_context(handler: Callable[..., Any]) -> bool:
    """Whether ``handler`` declares a ``context`` parameter (older handlers take two arguments)."""
    try:
        parameters = inspect.signature(handler).parameters.values()
    except (TypeError, ValueError):
        return False
    # Only a named ``context``: ``**kwargs`` (and mocks) keep the two-argument call.
    return any(
        parameter.name == "context"
        and parameter.kind
        in (inspect.Parameter.POSITIONAL_OR_KEYWORD, inspect.Parameter.KEYWORD_ONLY)
        for parameter in parameters
    )


# ============================================================================
# In-Process Executor
# ============================================================================


class InProcessExecutor:
    """Executor that runs commands in-process (no subprocess).

    Supports:
    - Step references (${{ steps[0].data.id }})
    - Dry run mode for validation without execution
    """

    def __init__(self, config: InProcessExecutorConfig) -> None:
        self._handler = config.handler
        self._context = config.context
        self._pass_context = _accepts_context(config.handler)
        self._stop_on_failure = config.stop_on_failure
        self._dry_run = config.dry_run
        self._on_step_complete = config.on_step_complete
        self._on_scenario_start = config.on_scenario_start
        self._on_scenario_complete = config.on_scenario_complete

    async def execute(self, scenario: Scenario) -> ScenarioResult:
        """Execute a scenario in-process."""
        started_at = datetime.now(UTC)
        start_time = time.monotonic()
        step_results: list[StepResult] = []
        step_outputs: list[dict[str, Any]] = []

        passed_steps = 0
        failed_steps = 0
        skipped_steps = 0
        should_skip_remaining = False

        if self._on_scenario_start:
            self._on_scenario_start(scenario)

        for index, step in enumerate(scenario.steps):
            step_num = index + 1

            if should_skip_remaining:
                skipped_result = StepResult(
                    step_id=f"step-{step_num}",
                    command=step.command,
                    outcome="skip",
                    duration_ms=0,
                    assertions=[],
                    skipped_reason="Previous step failed",
                )
                step_results.append(skipped_result)
                step_outputs.append({"success": False})
                skipped_steps += 1
                if self._on_step_complete:
                    self._on_step_complete(step, skipped_result)
                continue

            # Dry run mode
            if self._dry_run:
                dry_run_result = StepResult(
                    step_id=f"step-{step_num}",
                    command=step.command,
                    outcome="pass",
                    duration_ms=0,
                    assertions=[],
                )
                step_results.append(dry_run_result)
                step_outputs.append({"success": True, "data": {}})
                passed_steps += 1
                if self._on_step_complete:
                    self._on_step_complete(step, dry_run_result)
                continue

            # Resolve step references in input
            resolved_input = resolve_step_references(step.input, step_outputs)

            # Execute the step
            step_result = await self._execute_step(
                Step(
                    command=step.command,
                    expect=step.expect,
                    input=resolved_input,
                    description=step.description,
                    continue_on_failure=step.continue_on_failure,
                    follow=(
                        dataclasses.replace(
                            step.follow,
                            input=resolve_step_references(step.follow.input, step_outputs),
                        )
                        if step.follow is not None and step.follow.input is not None
                        else step.follow
                    ),
                ),
                step_num,
            )
            step_results.append(step_result)
            step_outputs.append(
                step_result.command_result
                if step_result.command_result is not None
                else {"success": step_result.outcome == "pass"}
            )

            if step_result.outcome == "pass":
                passed_steps += 1
            elif step_result.outcome in ("fail", "error"):
                failed_steps += 1
                if self._stop_on_failure and not step.continue_on_failure:
                    should_skip_remaining = True
            elif step_result.outcome == "skip":
                skipped_steps += 1

            if self._on_step_complete:
                self._on_step_complete(step, step_result)

        completed_at = datetime.now(UTC)
        duration_ms = (time.monotonic() - start_time) * 1000

        outcome = _determine_outcome(passed_steps, failed_steps, skipped_steps)

        result = ScenarioResult(
            scenario_path="",
            job_name=scenario.job,
            job_description=scenario.description,
            outcome=outcome,
            duration_ms=duration_ms,
            step_results=step_results,
            passed_steps=passed_steps,
            failed_steps=failed_steps,
            skipped_steps=skipped_steps,
            started_at=started_at,
            completed_at=completed_at,
        )

        if self._on_scenario_complete:
            self._on_scenario_complete(result)

        return result

    def _step_context(self, step_id: str) -> CommandContext:
        """A fresh context for one step: the configured context, with a ``test`` actor by default."""
        base = self._context or CommandContext()
        return dataclasses.replace(
            base,
            trace_id=base.trace_id or step_id,
            extra=dict(base.extra),
            actor=copy.copy(base.actor or _TEST_ACTOR),
        )

    async def _execute_step(self, step: Step, step_num: int) -> StepResult:
        """Execute a single step in-process, and follow its refusal's recovery when asked."""
        step_id = f"step-{step_num}"
        result = await self._run_call(step, step_id)
        # Follow only a refusal the step itself expected: a step whose own expectation failed
        # has already failed, and following it would only add noise.
        if step.follow is not None and result.outcome == "pass":
            result = await follow_recovery(step, step.follow, step_id, result, self._run_call)
        return result

    async def _run_call(self, step: Step, step_id: str) -> StepResult:
        """Call ``step.command`` with ``step.input`` and judge the result by ``step.expect``."""
        start_time = time.monotonic()

        try:
            if self._pass_context:
                command_result = await self._handler(
                    step.command, step.input, context=self._step_context(step_id)
                )
            else:
                command_result = await self._handler(step.command, step.input)
            duration_ms = (time.monotonic() - start_time) * 1000

            # Evaluate the wire form (camelCase keys, unset fields omitted), the
            # JSON a client receives, as the TypeScript runner does.
            if isinstance(command_result, (BaseModel, dict)):
                command_result = to_wire(command_result)
            elif hasattr(command_result, "__dict__"):
                command_result = vars(command_result)

            evaluation = evaluate_result(command_result, step.expect)
            outcome: StepOutcome = "pass" if evaluation.passed else "fail"

            error_info: StepError | None = None
            if not evaluation.passed:
                failed_assertions = [a for a in evaluation.assertions if not a.passed]
                error_message = _format_assertion_failures(failed_assertions)
                error_info = create_step_error("expectation_mismatch", error_message)

            return StepResult(
                step_id=step_id,
                command=step.command,
                outcome=outcome,
                duration_ms=duration_ms,
                command_result=command_result,
                assertions=evaluation.assertions,
                error=error_info,
            )
        except Exception as exc:
            duration_ms = (time.monotonic() - start_time) * 1000
            return StepResult(
                step_id=step_id,
                command=step.command,
                outcome="error",
                duration_ms=duration_ms,
                error=create_step_error("command_failed", str(exc), cause=exc),
                assertions=[],
            )


# ============================================================================
# Following a recovery
# ============================================================================

RunCall = Callable[[Step, str], Awaitable[StepResult]]
"""Runs one call as a step and judges it: ``(step, step_id) -> StepResult``."""

_SUCCEEDS = Expectation(success=True)


def _follow_failed(
    result: StepResult, message: str, follow: list[StepResult] | None = None
) -> StepResult:
    """The refused step's result, failed with ``message`` and the follow calls made so far."""
    return dataclasses.replace(
        result,
        outcome="fail",
        error=create_step_error("expectation_mismatch", f"follow: {message}"),
        follow=follow or None,
    )


def _same_refusal(refused: Step, refusal: dict[str, Any], call: StepResult) -> bool:
    """Whether a followed call came straight back to the refusal it was meant to get past."""
    result = call.command_result
    if call.command != refused.command or not isinstance(result, dict):
        return False
    code = _error_of(result).get("code")
    return (
        result.get("success") is False
        and code is not None
        and code == _error_of(refusal).get("code")
    )


def _error_of(result: dict[str, Any]) -> dict[str, Any]:
    error = result.get("error")
    return error if isinstance(error, dict) else {}


def _dict_or_empty(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


async def follow_recovery(
    step: Step,
    follow: FollowExpectation,
    step_id: str,
    result: StepResult,
    run_call: RunCall,
) -> StepResult:
    """Take the step a refusal's structured recovery describes and judge whether it got further
    (``spec/recovery.md``, "What a test can check").

    The calls run through ``run_call`` like any step, so they change the state later steps see,
    as following the advice would. Returns ``result`` with ``follow`` set to the calls made, or
    failed with a ``follow: ...`` message when the recovery cannot be followed or did not get
    further.
    """
    refusal = result.command_result if isinstance(result.command_result, dict) else {}
    if refusal.get("success") is not False:
        return _follow_failed(result, "the step did not return a refusal to follow")
    code = _error_of(refusal).get("code")
    recovery = _error_of(refusal).get("recovery")
    if recovery is None:
        return _follow_failed(result, f"the {code} refusal carries no recovery to follow")
    if not is_command_recovery(recovery):
        return _follow_failed(result, f"the {code} refusal's recovery is unreadable")
    kind = recovery["kind"]
    if kind in ("external", "stop"):
        return _follow_failed(
            result,
            f"a {kind} recovery has nothing a program can follow; "
            "assert it with expect.error.recovery",
        )
    then_retry = recovery.get("thenRetry") is True
    if follow.retry is not None and not (kind == "call" and then_retry):
        return _follow_failed(result, "'follow.retry' needs a call recovery with thenRetry")
    recovery_input = _dict_or_empty(recovery.get("input"))
    needs: list[str] = recovery.get("needs") or []
    # Rule 3: what the recovery knows goes in input, what the caller chooses in needs, never both.
    both = [field for field in needs if field in recovery_input]
    if both:
        return _follow_failed(
            result, f"the recovery names {', '.join(both)} in both input and needs"
        )
    # The scenario chooses only what the recovery leaves to the caller, so it cannot correct a
    # recovery that is wrong.
    supplied = follow.input or {}
    unneeded = [field for field in supplied if field not in needs]
    if unneeded:
        return _follow_failed(
            result,
            f"follow.input gives {', '.join(unneeded)}, "
            "which the recovery does not leave to the caller",
        )
    missing = [field for field in needs if field not in supplied]
    if missing:
        pronoun = "them" if len(missing) > 1 else "it"
        return _follow_failed(
            result, f"the recovery needs {', '.join(missing)}; give {pronoun} in follow.input"
        )

    calls: list[Step] = []
    if kind == "call":
        calls.append(
            Step(
                command=recovery["command"],
                input={**recovery_input, **supplied},
                expect=follow.expect or _SUCCEEDS,
            )
        )
        if then_retry:
            calls.append(
                Step(command=step.command, input=step.input, expect=follow.retry or _SUCCEEDS)
            )
    elif kind == "fix-input":
        calls.append(
            Step(
                command=step.command,
                input={**(step.input or {}), **recovery_input, **supplied},
                expect=follow.expect or _SUCCEEDS,
            )
        )
    else:
        calls.append(
            Step(command=step.command, input=step.input, expect=follow.expect or _SUCCEEDS)
        )

    made: list[StepResult] = []
    for index, call in enumerate(calls):
        outcome = await run_call(call, f"{step_id}.follow.{index + 1}")
        made.append(outcome)
        if _same_refusal(step, refusal, outcome):
            return _follow_failed(
                result, f"{call.command} came back with the same {code} refusal", made
            )
        if outcome.outcome != "pass":
            why = outcome.error.message if outcome.error else "its expectation did not hold"
            return _follow_failed(result, f"{call.command}: {why}", made)
    return dataclasses.replace(result, follow=made)


# ============================================================================
# Step Reference Resolution
# ============================================================================

_EXACT_REF_PATTERN = re.compile(r"^\$\{\{\s*steps\[(\d+)\]\.(.+?)\s*\}\}$")
_EMBEDDED_REF_PATTERN = re.compile(r"\$\{\{\s*steps\[(\d+)\]\.(.+?)\s*\}\}")


def resolve_step_references(
    input_data: dict[str, Any] | None,
    step_outputs: list[dict[str, Any]],
) -> dict[str, Any] | None:
    """Resolve step references in input values.

    Supports syntax like:
    - ${{ steps[0].data.id }} - Reference data from step 0
    - ${{ steps[1].data.items[0].name }} - Nested path access
    """
    if input_data is None:
        return None

    return {key: _resolve_value(value, step_outputs) for key, value in input_data.items()}


def _resolve_value(value: Any, step_outputs: list[dict[str, Any]]) -> Any:
    """Resolve a single value, recursively handling objects and arrays."""
    if isinstance(value, str):
        return _resolve_string_references(value, step_outputs)

    if isinstance(value, list):
        return [_resolve_value(item, step_outputs) for item in value]

    if isinstance(value, dict):
        return {k: _resolve_value(v, step_outputs) for k, v in value.items()}

    return value


def _resolve_string_references(value: str, step_outputs: list[dict[str, Any]]) -> Any:
    """Resolve step references in a string value.

    Pattern: ${{ steps[N].path.to.value }}
    """
    # Check for exact match (entire string is a reference) - preserves type
    exact_match = _EXACT_REF_PATTERN.match(value)
    if exact_match:
        step_index = int(exact_match.group(1))
        path = exact_match.group(2)
        if step_index < len(step_outputs):
            return get_value_at_path(step_outputs[step_index], path)
        return None

    # Check for embedded references (replace within string) - always returns string
    if _EMBEDDED_REF_PATTERN.search(value):

        def _replacer(m: re.Match[str]) -> str:
            step_index = int(m.group(1))
            path = m.group(2)
            if step_index < len(step_outputs):
                resolved = get_value_at_path(step_outputs[step_index], path)
                return str(resolved) if resolved is not None else ""
            return ""

        return _EMBEDDED_REF_PATTERN.sub(_replacer, value)

    return value


# ============================================================================
# Outcome Determination
# ============================================================================


def _determine_outcome(passed: int, failed: int, skipped: int) -> ScenarioOutcome:
    """Determine overall scenario outcome."""
    if failed == 0 and skipped == 0:
        return "pass"
    if passed == 0:
        return "fail"
    if failed > 0 and passed > 0:
        return "partial"
    return "fail"


# ============================================================================
# Scenario Validation
# ============================================================================


def validate_scenario(
    scenario: Scenario,
    known_commands: list[str] | None = None,
) -> ScenarioValidationResult:
    """Validate a scenario without executing it.

    Useful for CI/CD validation and pre-flight checks.
    """
    errors: list[str] = []
    warnings: list[str] = []

    if not scenario.name:
        errors.append("Missing required field: name")

    if not scenario.job:
        errors.append("Missing required field: job")

    if not scenario.steps:
        errors.append("Scenario must have at least one step")

    # Validate each step
    for index, step in enumerate(scenario.steps or []):
        step_num = index + 1

        if not step.command:
            errors.append(f"Step {step_num}: Missing required field 'command'")

        if step.follow is not None and (step.expect is None or step.expect.success is not False):
            errors.append(
                f"Step {step_num} 'follow' needs a refusal to follow: set 'expect.success' to false"
            )

        # Check for forward references, in the input and in what a follow supplies
        follow_input = step.follow.input if step.follow is not None else None
        if step.input or follow_input:
            import json

            input_str = json.dumps([step.input, follow_input])
            refs = re.findall(r"\$\{\{\s*steps\[(\d+)\]", input_str)
            for ref_idx_str in refs:
                ref_index = int(ref_idx_str)
                if ref_index >= index:
                    errors.append(
                        f"Step {step_num}: Invalid reference to step {ref_index} "
                        f"(can only reference earlier steps)"
                    )

        # Check if command is known
        if known_commands is not None and step.command not in known_commands:
            warnings.append(f"Step {step_num}: Unknown command '{step.command}'")

    return ScenarioValidationResult(
        valid=len(errors) == 0,
        errors=errors,
        warnings=warnings,
        metadata={
            "name": scenario.name,
            "job": scenario.job,
            "step_count": len(scenario.steps) if scenario.steps else 0,
            "has_fixture": scenario.fixture is not None,
            "tags": scenario.tags or [],
        },
    )


# ============================================================================
# Factory Functions
# ============================================================================


def create_in_process_executor(config: InProcessExecutorConfig) -> InProcessExecutor:
    """Create an in-process scenario executor."""
    return InProcessExecutor(config)
