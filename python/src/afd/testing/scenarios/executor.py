"""
Scenario Executor.

Executes scenario steps sequentially, evaluates results, and produces a ScenarioResult.
Supports fixture loading and step references.
"""

from __future__ import annotations

import re
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from afd.testing.scenarios.evaluator import evaluate_result, get_value_at_path
from afd.testing.scenarios.types import (
    AssertionResult,
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

CommandHandler = Callable[
    [str, dict[str, Any] | None],
    Any,  # Awaitable[dict[str, Any]]
]
"""Async function: (command, input) -> CommandResult dict."""


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
        return 'Assertions failed'

    if len(failures) == 1:
        f = failures[0]
        return f'{f.path}: expected {_format_value(f.expected)}, got {_format_value(f.actual)}'

    lines = [
        f'  - {f.path}: expected {_format_value(f.expected)}, got {_format_value(f.actual)}'
        for f in failures
    ]
    return f'{len(failures)} assertions failed:\n' + '\n'.join(lines)


def _format_value(value: Any) -> str:
    """Format a value for error message display."""
    if value is None:
        return 'None'
    if isinstance(value, str):
        truncated = f'"{value[:40]}..."' if len(value) > 40 else f'"{value}"'
        return truncated
    if isinstance(value, (dict, list)):
        import json
        try:
            s = json.dumps(value)
            return s[:60] + '...' if len(s) > 60 else s
        except (TypeError, ValueError):
            return '[object]'
    return str(value)


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
        self._stop_on_failure = config.stop_on_failure
        self._dry_run = config.dry_run
        self._on_step_complete = config.on_step_complete
        self._on_scenario_start = config.on_scenario_start
        self._on_scenario_complete = config.on_scenario_complete

    async def execute(self, scenario: Scenario) -> ScenarioResult:
        """Execute a scenario in-process."""
        started_at = datetime.now(timezone.utc)
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
                    step_id=f'step-{step_num}',
                    command=step.command,
                    outcome='skip',
                    duration_ms=0,
                    assertions=[],
                    skipped_reason='Previous step failed',
                )
                step_results.append(skipped_result)
                step_outputs.append({'success': False})
                skipped_steps += 1
                if self._on_step_complete:
                    self._on_step_complete(step, skipped_result)
                continue

            # Dry run mode
            if self._dry_run:
                dry_run_result = StepResult(
                    step_id=f'step-{step_num}',
                    command=step.command,
                    outcome='pass',
                    duration_ms=0,
                    assertions=[],
                )
                step_results.append(dry_run_result)
                step_outputs.append({'success': True, 'data': {}})
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
                ),
                step_num,
            )
            step_results.append(step_result)
            step_outputs.append(
                step_result.command_result
                if step_result.command_result is not None
                else {'success': step_result.outcome == 'pass'}
            )

            if step_result.outcome == 'pass':
                passed_steps += 1
            elif step_result.outcome in ('fail', 'error'):
                failed_steps += 1
                if self._stop_on_failure and not step.continue_on_failure:
                    should_skip_remaining = True
            elif step_result.outcome == 'skip':
                skipped_steps += 1

            if self._on_step_complete:
                self._on_step_complete(step, step_result)

        completed_at = datetime.now(timezone.utc)
        duration_ms = (time.monotonic() - start_time) * 1000

        outcome = _determine_outcome(passed_steps, failed_steps, skipped_steps)

        result = ScenarioResult(
            scenario_path='',
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

    async def _execute_step(self, step: Step, step_num: int) -> StepResult:
        """Execute a single step in-process."""
        step_id = f'step-{step_num}'
        start_time = time.monotonic()

        try:
            command_result = await self._handler(step.command, step.input)
            duration_ms = (time.monotonic() - start_time) * 1000

            # Ensure command_result is a dict
            if not isinstance(command_result, dict):
                if hasattr(command_result, 'model_dump'):
                    command_result = command_result.model_dump()
                elif hasattr(command_result, '__dict__'):
                    command_result = vars(command_result)

            evaluation = evaluate_result(command_result, step.expect)
            outcome: StepOutcome = 'pass' if evaluation.passed else 'fail'

            error_info: StepError | None = None
            if not evaluation.passed:
                failed_assertions = [a for a in evaluation.assertions if not a.passed]
                error_message = _format_assertion_failures(failed_assertions)
                error_info = create_step_error('expectation_mismatch', error_message)

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
                outcome='error',
                duration_ms=duration_ms,
                error=create_step_error('command_failed', str(exc), cause=exc),
                assertions=[],
            )


# ============================================================================
# Step Reference Resolution
# ============================================================================

_EXACT_REF_PATTERN = re.compile(r'^\$\{\{\s*steps\[(\d+)\]\.(.+?)\s*\}\}$')
_EMBEDDED_REF_PATTERN = re.compile(r'\$\{\{\s*steps\[(\d+)\]\.(.+?)\s*\}\}')


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


def _resolve_string_references(
    value: str, step_outputs: list[dict[str, Any]]
) -> Any:
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
                return str(resolved) if resolved is not None else ''
            return ''

        return _EMBEDDED_REF_PATTERN.sub(_replacer, value)

    return value


# ============================================================================
# Outcome Determination
# ============================================================================


def _determine_outcome(
    passed: int, failed: int, skipped: int
) -> ScenarioOutcome:
    """Determine overall scenario outcome."""
    if failed == 0 and skipped == 0:
        return 'pass'
    if passed == 0:
        return 'fail'
    if failed > 0 and passed > 0:
        return 'partial'
    return 'fail'


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
        errors.append('Missing required field: name')

    if not scenario.job:
        errors.append('Missing required field: job')

    if not scenario.steps:
        errors.append('Scenario must have at least one step')

    # Validate each step
    for index, step in enumerate(scenario.steps or []):
        step_num = index + 1

        if not step.command:
            errors.append(f"Step {step_num}: Missing required field 'command'")

        # Check for forward references
        if step.input:
            import json
            input_str = json.dumps(step.input)
            refs = re.findall(r'\$\{\{\s*steps\[(\d+)\]', input_str)
            for ref_idx_str in refs:
                ref_index = int(ref_idx_str)
                if ref_index >= index:
                    errors.append(
                        f'Step {step_num}: Invalid reference to step {ref_index} '
                        f'(can only reference earlier steps)'
                    )

        # Check if command is known
        if known_commands is not None and step.command not in known_commands:
            warnings.append(f"Step {step_num}: Unknown command '{step.command}'")

    return ScenarioValidationResult(
        valid=len(errors) == 0,
        errors=errors,
        warnings=warnings,
        metadata={
            'name': scenario.name,
            'job': scenario.job,
            'step_count': len(scenario.steps) if scenario.steps else 0,
            'has_fixture': scenario.fixture is not None,
            'tags': scenario.tags or [],
        },
    )


# ============================================================================
# Factory Functions
# ============================================================================


def create_in_process_executor(config: InProcessExecutorConfig) -> InProcessExecutor:
    """Create an in-process scenario executor."""
    return InProcessExecutor(config)
