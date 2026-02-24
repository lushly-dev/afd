"""
Agent hints system for AFD testing.

Provides structured hints to help AI agents interpret command results
and determine next actions. Hints are deterministic for testing.

Example:
    >>> from afd.testing.mcp.hints import generate_agent_hints
    >>> from afd import success
    >>>
    >>> result = success({"count": 5}, reasoning="Found items")
    >>> hints = generate_agent_hints("scenario-list", result)
    >>> hints.next_steps
    ['Run scenario-evaluate to execute listed scenarios']
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class AgentHints:
    """Hints to help AI agents interpret results and decide next actions.

    Attributes:
        should_retry: Whether the agent should retry this operation.
        related_commands: Related commands to consider.
        next_steps: Suggested next actions.
        interpretation_confidence: Confidence in result interpretation (0-1).
        low_confidence_steps: Steps with low confidence that may need human review.
        untested_commands: Commands that have no test coverage.
        error_codes: Error codes encountered.
    """

    should_retry: bool = False
    related_commands: list[str] = field(default_factory=list)
    next_steps: list[str] = field(default_factory=list)
    interpretation_confidence: float = 0.9
    low_confidence_steps: list[int] | None = None
    untested_commands: list[str] | None = None
    error_codes: list[str] | None = None


@dataclass
class AgentEnhancedResult:
    """Command result with agent hints added.

    Wraps a CommandResult dict with additional _agent_hints metadata.

    Attributes:
        result: The original command result dict.
        agent_hints: Agent hints for interpreting the result.
    """

    result: dict[str, Any]
    agent_hints: AgentHints


# ============================================================================
# Hint Generation
# ============================================================================


def generate_agent_hints(command_name: str, result: dict[str, Any]) -> AgentHints:
    """Generate agent hints for a command result.

    Args:
        command_name: The command that was executed.
        result: The CommandResult dict.

    Returns:
        AgentHints with retry, related commands, and next steps.
    """
    hints = AgentHints(
        should_retry=_should_retry_command(result),
        related_commands=_get_related_commands(command_name, result),
        next_steps=_suggest_next_steps(command_name, result),
        interpretation_confidence=_calculate_interpretation_confidence(result),
    )

    if not result.get('success') and result.get('error'):
        error = result['error']
        code = error.get('code') if isinstance(error, dict) else getattr(error, 'code', None)
        if code:
            hints.error_codes = [code]

    return hints


def generate_test_report_hints(report: dict[str, Any]) -> AgentHints:
    """Generate agent hints specific to test reports.

    Args:
        report: A TestReport-like dict with summary and scenarios.

    Returns:
        AgentHints with test-specific guidance.
    """
    summary = report.get('summary', {})
    scenarios = report.get('scenarios', [])
    pass_rate = summary.get('pass_rate', 0.0)

    hints = AgentHints(
        should_retry=False,
        related_commands=[],
        next_steps=[],
        interpretation_confidence=pass_rate,
    )

    failed_scenarios = [
        s for s in scenarios
        if s.get('outcome') in ('fail', 'error')
    ]

    if failed_scenarios:
        hints.next_steps.append(
            f'Review {len(failed_scenarios)} failed scenario(s)'
        )
        hints.next_steps.append('Run with --verbose for detailed step output')
        hints.related_commands.append('scenario-suggest --context failed')

        error_types: set[str] = set()
        for scenario in failed_scenarios:
            for step in scenario.get('step_results', []):
                error = step.get('error')
                if error:
                    etype = error.get('type') if isinstance(error, dict) else getattr(error, 'type', None)
                    if etype:
                        error_types.add(etype)
        if error_types:
            hints.error_codes = sorted(error_types)

    mismatch_steps: list[int] = []
    step_index = 0
    for scenario in scenarios:
        for step in scenario.get('step_results', []):
            error = step.get('error')
            if error:
                etype = error.get('type') if isinstance(error, dict) else getattr(error, 'type', None)
                if etype == 'expectation_mismatch':
                    mismatch_steps.append(step_index)
            step_index += 1

    if mismatch_steps:
        hints.low_confidence_steps = mismatch_steps
        hints.next_steps.append(
            f'{len(mismatch_steps)} step(s) have expectation mismatches - '
            'consider reviewing assertions'
        )

    if pass_rate >= 0.95:
        hints.next_steps.append('All tests passing - safe to proceed')
    elif pass_rate >= 0.8:
        hints.next_steps.append('Most tests passing - review failures before proceeding')
    else:
        hints.should_retry = True
        hints.next_steps.append('Significant failures detected - fix issues before continuing')

    return hints


def generate_coverage_hints(
    tested_commands: list[str],
    untested_commands: list[str],
    coverage_percent: float,
) -> AgentHints:
    """Generate agent hints for coverage results.

    Args:
        tested_commands: Commands with test coverage.
        untested_commands: Commands without test coverage.
        coverage_percent: Coverage percentage (0-100).

    Returns:
        AgentHints with coverage-specific guidance.
    """
    hints = AgentHints(
        should_retry=False,
        related_commands=[],
        next_steps=[],
        interpretation_confidence=0.95,
    )

    if untested_commands:
        hints.untested_commands = untested_commands
        hints.related_commands.append('scenario-create --template crud')
        hints.next_steps.append(
            f'{len(untested_commands)} command(s) have no test coverage'
        )
        hints.next_steps.append(
            'Consider using scenario-create to generate test templates'
        )

        priority_commands = [
            cmd for cmd in untested_commands
            if '-create' in cmd or '-delete' in cmd
        ]
        if priority_commands:
            hints.next_steps.append(
                f'Priority: Test {", ".join(priority_commands)} (mutation commands)'
            )

    if coverage_percent >= 90:
        hints.next_steps.append('Excellent coverage - focus on edge cases')
    elif coverage_percent >= 70:
        hints.next_steps.append('Good coverage - add tests for remaining commands')
    else:
        hints.next_steps.append('Low coverage - prioritize adding test scenarios')

    return hints


def enhance_with_agent_hints(
    command_name: str,
    result: dict[str, Any],
) -> AgentEnhancedResult:
    """Enhance a command result with agent hints.

    Args:
        command_name: The command that was executed.
        result: The CommandResult dict.

    Returns:
        AgentEnhancedResult wrapping the result with hints.
    """
    return AgentEnhancedResult(
        result=result,
        agent_hints=generate_agent_hints(command_name, result),
    )


# ============================================================================
# Helper Functions
# ============================================================================

_TRANSIENT_CODES = frozenset({
    'TIMEOUT', 'CONNECTION_ERROR', 'RATE_LIMITED', 'SERVICE_UNAVAILABLE',
})


def _should_retry_command(result: dict[str, Any]) -> bool:
    """Determine if a command should be retried based on result."""
    if result.get('success'):
        return False

    error = result.get('error')
    if not error:
        return False

    if isinstance(error, dict):
        retryable = error.get('retryable')
        suggestion = (error.get('suggestion') or '').lower()
        code = error.get('code', '')
    else:
        retryable = getattr(error, 'retryable', None)
        suggestion = (getattr(error, 'suggestion', '') or '').lower()
        code = getattr(error, 'code', '')

    if retryable is True:
        return True
    if retryable is False:
        return False

    if any(kw in suggestion for kw in ('try again', 'retry', 'temporary')):
        return True

    if code in _TRANSIENT_CODES:
        return True

    return False


def _get_related_commands(command_name: str, result: dict[str, Any]) -> list[str]:
    """Get related commands based on the executed command."""
    related: list[str] = []

    category = command_name.split('-')[0] if '-' in command_name else command_name

    if category == 'scenario':
        relations: dict[str, list[str]] = {
            'scenario-list': ['scenario-evaluate', 'scenario-coverage'],
            'scenario-evaluate': ['scenario-coverage', 'scenario-suggest'],
            'scenario-coverage': ['scenario-suggest', 'scenario-create'],
            'scenario-create': ['scenario-evaluate'],
        }
        related.extend(relations.get(command_name, []))

    if not result.get('success'):
        if 'scenario-suggest --context failed' not in related:
            related.append('scenario-suggest --context failed')

    return related


def _suggest_next_steps(command_name: str, result: dict[str, Any]) -> list[str]:
    """Suggest next steps based on command result."""
    steps: list[str] = []

    if result.get('success'):
        suggestions: dict[str, list[str]] = {
            'scenario-list': ['Run scenario-evaluate to execute listed scenarios'],
            'scenario-create': [
                'Edit the generated scenario to add specific test cases',
                'Run scenario-evaluate to test the new scenario',
            ],
            'scenario-evaluate': ['Run scenario-coverage to check test coverage'],
            'scenario-coverage': [
                'Use scenario-suggest to find gaps',
                'Create scenarios for untested commands',
            ],
        }
        steps.extend(suggestions.get(command_name, []))
    else:
        error = result.get('error')
        if error:
            suggestion = error.get('suggestion') if isinstance(error, dict) else getattr(error, 'suggestion', None)
            if suggestion:
                steps.append(suggestion)

            code = error.get('code') if isinstance(error, dict) else getattr(error, 'code', None)
            code_suggestions: dict[str, str] = {
                'PARSE_ERROR': 'Check scenario YAML syntax',
                'FILE_NOT_FOUND': 'Verify the scenario file path exists',
                'VALIDATION_ERROR': 'Review the scenario schema requirements',
            }
            if code and code in code_suggestions:
                steps.append(code_suggestions[code])

    return steps


def _calculate_interpretation_confidence(result: dict[str, Any]) -> float:
    """Calculate confidence in how accurately we can interpret the result."""
    confidence = 0.9

    if not result.get('success'):
        error = result.get('error')
        if error:
            code = error.get('code') if isinstance(error, dict) else getattr(error, 'code', None)
            if not code:
                confidence -= 0.2

    if result.get('reasoning'):
        confidence += 0.05

    sources = result.get('sources')
    if sources and len(sources) > 0:
        confidence += 0.05

    return max(0.0, min(1.0, confidence))
