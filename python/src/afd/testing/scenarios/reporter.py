"""
Terminal Reporter.

Formats scenario execution results for terminal output.
Supports both human-readable and CI/agent-friendly formats.
"""

from __future__ import annotations

import json
import sys
from typing import Any, TextIO

from afd.testing.scenarios.types import (
    ScenarioResult,
    Step,
    StepResult,
    TestReport,
    TestSummary,
)

# ============================================================================
# Color Utilities
# ============================================================================

_COLORS = {
    'reset': '\x1b[0m',
    'bold': '\x1b[1m',
    'dim': '\x1b[2m',
    'green': '\x1b[32m',
    'red': '\x1b[31m',
    'yellow': '\x1b[33m',
    'blue': '\x1b[34m',
    'cyan': '\x1b[36m',
    'gray': '\x1b[90m',
}


def _colorize(text: str, color: str, use_colors: bool) -> str:
    if not use_colors or color not in _COLORS:
        return text
    return f'{_COLORS[color]}{text}{_COLORS["reset"]}'


# ============================================================================
# Terminal Reporter
# ============================================================================


class TerminalReporter:
    """Reporter for outputting scenario results to the terminal."""

    def __init__(
        self,
        format: str = 'human',
        verbose: bool = False,
        colors: bool | None = None,
        output: TextIO | None = None,
    ) -> None:
        self._format = format
        self._verbose = verbose
        self._colors = colors if colors is not None else (format != 'json')
        self._output = output or sys.stdout

    def report_scenario(self, result: ScenarioResult) -> None:
        """Report a single scenario result."""
        if self._format == 'json':
            self._write(self._to_json(result))
            return
        self._report_scenario_human(result)

    def report_all(self, results: list[ScenarioResult]) -> None:
        """Report multiple scenario results."""
        if self._format == 'json':
            self._write(json.dumps([self._result_to_dict(r) for r in results], indent=2, default=str))
            return

        for result in results:
            self._report_scenario_human(result)
            self._write('')

        self._report_summary_human(results)

    def report_test_report(self, report: TestReport) -> None:
        """Report a test report with summary."""
        if self._format == 'json':
            self._write(json.dumps(self._report_to_dict(report), indent=2, default=str))
            return

        self._write(_colorize(f'\n{report.title}', 'bold', self._colors))
        self._write(_colorize('\u2500' * 60, 'dim', self._colors))

        for result in report.scenarios:
            self._report_scenario_human(result)
            self._write('')

        self._report_summary_from_report(report.summary, report.duration_ms)

    def report_step_progress(
        self, step: Step, result: StepResult, step_index: int, total_steps: int
    ) -> None:
        """Report step progress (for live updates)."""
        if self._format == 'json':
            return

        icon = self._get_outcome_icon(result.outcome)
        step_num = f'[{step_index + 1}/{total_steps}]'
        duration = f'{result.duration_ms:.0f}ms'

        self._write(
            f'  {icon} {_colorize(step_num, "dim", self._colors)} '
            f'{step.command} {_colorize(duration, "gray", self._colors)}'
        )

        if self._verbose and result.assertions:
            for assertion in result.assertions:
                assert_icon = '\u2713' if assertion.passed else '\u2717'
                assert_color = 'green' if assertion.passed else 'red'
                self._write(
                    f'      {_colorize(assert_icon, assert_color, self._colors)} '
                    f'{assertion.description or assertion.path}'
                )

        if result.outcome in ('fail', 'error'):
            if result.error:
                self._write(
                    f'      {_colorize(f"Error: {result.error.message}", "red", self._colors)}'
                )
            if not self._verbose:
                for assertion in result.assertions:
                    if not assertion.passed:
                        self._write(
                            f'      {_colorize(chr(0x2717), "red", self._colors)} '
                            f'{assertion.description or assertion.path}'
                        )

    def report_scenario_start(self, job_name: str, description: str | None = None) -> None:
        """Report scenario start (for live updates)."""
        if self._format == 'json':
            return
        self._write('')
        self._write(_colorize(f'\u25b8 {job_name}', 'bold', self._colors))
        if description:
            self._write(_colorize(f'  {description}', 'dim', self._colors))

    # ========================================================================
    # Private Methods
    # ========================================================================

    def _report_scenario_human(self, result: ScenarioResult) -> None:
        icon = self._get_outcome_icon(result.outcome)
        outcome_color = self._get_outcome_color(result.outcome)
        duration = self._format_duration(result.duration_ms)

        self._write('')
        self._write(
            f'{icon} {_colorize(result.job_name, "bold", self._colors)} '
            f'{_colorize(f"({duration})", "dim", self._colors)}'
        )

        if result.job_description:
            self._write(_colorize(f'  {result.job_description}', 'dim', self._colors))

        step_summary = (
            f'  {result.passed_steps} passed, '
            f'{result.failed_steps} failed, '
            f'{result.skipped_steps} skipped'
        )
        self._write(_colorize(step_summary, outcome_color, self._colors))

        if self._verbose:
            self._write('')
            for step_result in result.step_results:
                step_icon = self._get_outcome_icon(step_result.outcome)
                step_duration = f'{step_result.duration_ms:.0f}ms'
                self._write(
                    f'  {step_icon} {step_result.command} '
                    f'{_colorize(step_duration, "gray", self._colors)}'
                )
                for assertion in step_result.assertions:
                    if not assertion.passed or self._verbose:
                        assert_icon = '\u2713' if assertion.passed else '\u2717'
                        assert_color = 'green' if assertion.passed else 'red'
                        self._write(
                            f'      {_colorize(assert_icon, assert_color, self._colors)} '
                            f'{assertion.description or assertion.path}'
                        )

        if not self._verbose and result.failed_steps > 0:
            self._write('')
            self._write(_colorize('  Failed steps:', 'red', self._colors))
            for step_result in result.step_results:
                if step_result.outcome in ('fail', 'error'):
                    self._write(
                        f'    {self._get_outcome_icon(step_result.outcome)} {step_result.command}'
                    )
                    if step_result.error:
                        self._write(
                            _colorize(f'      {step_result.error.message}', 'red', self._colors)
                        )
                    for assertion in step_result.assertions:
                        if not assertion.passed:
                            self._write(
                                f'      {_colorize(chr(0x2717), "red", self._colors)} '
                                f'{assertion.description or assertion.path}'
                            )

    def _report_summary_human(self, results: list[ScenarioResult]) -> None:
        passed = sum(1 for r in results if r.outcome == 'pass')
        failed = sum(1 for r in results if r.outcome in ('fail', 'error', 'partial'))
        total_duration = sum(r.duration_ms for r in results)

        separator = '\u2500' * 60
        self._write(_colorize(f'\n{separator}', 'dim', self._colors))
        self._write(_colorize('Summary', 'bold', self._colors))

        pass_color = 'green' if passed > 0 else 'dim'
        fail_color = 'red' if failed > 0 else 'dim'

        self._write(
            f'  {_colorize(f"{passed} passed", pass_color, self._colors)}, '
            f'{_colorize(f"{failed} failed", fail_color, self._colors)}'
        )
        self._write(
            f'  {_colorize(f"Total time: {self._format_duration(total_duration)}", "dim", self._colors)}'
        )

        if failed == 0:
            self._write(_colorize('\n\u2713 All scenarios passed!', 'green', self._colors))
        else:
            self._write(
                _colorize(f'\n\u2717 {failed} scenario(s) failed', 'red', self._colors)
            )

    def _report_summary_from_report(self, summary: TestSummary, duration_ms: float) -> None:
        separator = '\u2500' * 60
        self._write(_colorize(f'\n{separator}', 'dim', self._colors))
        self._write(_colorize('Summary', 'bold', self._colors))

        pass_color = 'green' if summary.passed_scenarios > 0 else 'dim'
        fail_color = 'red' if summary.failed_scenarios > 0 else 'dim'

        self._write(
            f'  Scenarios: '
            f'{_colorize(f"{summary.passed_scenarios} passed", pass_color, self._colors)}, '
            f'{_colorize(f"{summary.failed_scenarios} failed", fail_color, self._colors)}'
        )
        self._write(
            f'  Steps: {summary.passed_steps} passed, '
            f'{summary.failed_steps} failed, '
            f'{summary.skipped_steps} skipped'
        )
        self._write(f'  Pass rate: {summary.pass_rate * 100:.1f}%')
        self._write(f'  Duration: {self._format_duration(duration_ms)}')

        if summary.failed_scenarios == 0:
            self._write(_colorize('\n\u2713 All scenarios passed!', 'green', self._colors))
        else:
            self._write(
                _colorize(
                    f'\n\u2717 {summary.failed_scenarios} scenario(s) failed',
                    'red',
                    self._colors,
                )
            )

    def _get_outcome_icon(self, outcome: str) -> str:
        icons = {
            'pass': _colorize('\u2713', 'green', self._colors),
            'fail': _colorize('\u2717', 'red', self._colors),
            'error': _colorize('\u26a0', 'yellow', self._colors),
            'skip': _colorize('\u25cb', 'gray', self._colors),
            'partial': _colorize('\u25d0', 'yellow', self._colors),
        }
        return icons.get(outcome, '?')

    def _get_outcome_color(self, outcome: str) -> str:
        if outcome == 'pass':
            return 'green'
        if outcome in ('fail', 'error'):
            return 'red'
        if outcome == 'partial':
            return 'yellow'
        return 'gray'

    def _format_duration(self, ms: float) -> str:
        if ms < 1000:
            return f'{ms:.0f}ms'
        if ms < 60000:
            return f'{ms / 1000:.1f}s'
        return f'{ms / 60000:.1f}m'

    def _write(self, text: str) -> None:
        self._output.write(f'{text}\n')

    def _to_json(self, result: ScenarioResult) -> str:
        return json.dumps(self._result_to_dict(result), indent=2, default=str)

    def _result_to_dict(self, result: ScenarioResult) -> dict[str, Any]:
        return {
            'scenario_path': result.scenario_path,
            'job_name': result.job_name,
            'job_description': result.job_description,
            'outcome': result.outcome,
            'duration_ms': result.duration_ms,
            'passed_steps': result.passed_steps,
            'failed_steps': result.failed_steps,
            'skipped_steps': result.skipped_steps,
            'started_at': str(result.started_at),
            'completed_at': str(result.completed_at),
            'step_results': [
                {
                    'step_id': sr.step_id,
                    'command': sr.command,
                    'outcome': sr.outcome,
                    'duration_ms': sr.duration_ms,
                    'assertions': [
                        {
                            'path': a.path,
                            'matcher': a.matcher,
                            'passed': a.passed,
                            'expected': a.expected,
                            'actual': a.actual,
                            'description': a.description,
                        }
                        for a in sr.assertions
                    ],
                }
                for sr in result.step_results
            ],
        }

    def _report_to_dict(self, report: TestReport) -> dict[str, Any]:
        return {
            'title': report.title,
            'duration_ms': report.duration_ms,
            'generated_at': str(report.generated_at),
            'summary': {
                'total_scenarios': report.summary.total_scenarios,
                'passed_scenarios': report.summary.passed_scenarios,
                'failed_scenarios': report.summary.failed_scenarios,
                'error_scenarios': report.summary.error_scenarios,
                'total_steps': report.summary.total_steps,
                'passed_steps': report.summary.passed_steps,
                'failed_steps': report.summary.failed_steps,
                'skipped_steps': report.summary.skipped_steps,
                'pass_rate': report.summary.pass_rate,
            },
            'scenarios': [self._result_to_dict(s) for s in report.scenarios],
        }


# ============================================================================
# Factory Functions
# ============================================================================


def create_reporter(
    format: str = 'human',
    verbose: bool = False,
    colors: bool | None = None,
    output: TextIO | None = None,
) -> TerminalReporter:
    """Create a terminal reporter with the given configuration."""
    return TerminalReporter(format=format, verbose=verbose, colors=colors, output=output)


def create_json_reporter(output: TextIO | None = None) -> TerminalReporter:
    """Create a JSON reporter for CI/agent output."""
    return TerminalReporter(format='json', colors=False, output=output)


def create_verbose_reporter(output: TextIO | None = None) -> TerminalReporter:
    """Create a verbose reporter for debugging."""
    return TerminalReporter(format='human', verbose=True, output=output)
