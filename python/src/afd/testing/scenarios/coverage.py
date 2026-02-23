"""
Scenario Coverage Analysis.

Generate coverage metrics for scenarios across multiple dimensions:
- Commands: Which commands are being tested
- Errors: Which error codes are being tested
- Jobs: What user jobs are covered
"""

from __future__ import annotations

from dataclasses import dataclass, field

from afd.testing.scenarios.types import Scenario, Step

# ============================================================================
# Types
# ============================================================================


@dataclass
class CommandCoverage:
    """Coverage metrics for a single command."""

    command: str
    scenario_count: int = 0
    step_count: int = 0
    used_in: list[str] = field(default_factory=list)
    has_error_tests: bool = False


@dataclass
class ErrorCoverage:
    """Coverage metrics for a single error code."""

    error_code: str
    scenario_count: int = 0
    tested_in: list[str] = field(default_factory=list)


@dataclass
class JobCoverage:
    """Coverage metrics for a job (user goal)."""

    job: str
    scenario_count: int = 0
    tags: list[str] = field(default_factory=list)
    avg_steps: int = 0


@dataclass
class CoverageSummary:
    """Overall coverage summary."""

    total_scenarios: int = 0
    total_steps: int = 0
    commands_tested: int = 0
    commands_known: int | None = None
    commands_coverage: float | None = None
    commands_untested: list[str] | None = None
    errors_tested: int = 0
    errors_known: int | None = None
    errors_coverage: float | None = None
    errors_untested: list[str] | None = None
    jobs_count: int = 0
    jobs_names: list[str] = field(default_factory=list)


@dataclass
class CoverageReport:
    """Full coverage report output."""

    summary: CoverageSummary
    command_coverage: list[CommandCoverage]
    error_coverage: list[ErrorCoverage]
    job_coverage: list[JobCoverage]


# ============================================================================
# Implementation
# ============================================================================


def _extract_commands(steps: list[Step]) -> list[str]:
    """Extract command names from steps."""
    return [step.command for step in steps]


def _extract_expected_errors(steps: list[Step]) -> list[str]:
    """Extract expected error codes from steps."""
    errors: list[str] = []
    for step in steps:
        if step.expect and step.expect.error:
            code = step.expect.error.get('code')
            if code:
                errors.append(code)
    return errors


def scenario_coverage(
    scenarios: list[tuple[Scenario, str]],
    known_commands: list[str] | None = None,
    known_errors: list[str] | None = None,
) -> CoverageReport:
    """Calculate coverage metrics for scenarios.

    Args:
        scenarios: List of (scenario, path) tuples to analyze.
        known_commands: Known commands to measure coverage against.
        known_errors: Known error codes to measure coverage against.

    Returns:
        CoverageReport with summary and per-dimension coverage.
    """
    command_map: dict[str, CommandCoverage] = {}
    error_map: dict[str, ErrorCoverage] = {}
    job_map: dict[str, JobCoverage] = {}
    total_steps = 0

    for scenario, path in scenarios:
        steps = scenario.steps or []
        total_steps += len(steps)

        # Track commands
        scenario_commands = _extract_commands(steps)
        unique_commands = set(scenario_commands)
        scenario_errors = _extract_expected_errors(steps)

        for cmd in unique_commands:
            if cmd not in command_map:
                command_map[cmd] = CommandCoverage(command=cmd)
            cov = command_map[cmd]
            cov.scenario_count += 1
            cov.used_in.append(path)

        # Count step occurrences
        for cmd in scenario_commands:
            if cmd in command_map:
                command_map[cmd].step_count += 1

        # Track error handling tests
        for step in steps:
            if step.expect and step.expect.success is False and step.command in command_map:
                command_map[step.command].has_error_tests = True

        # Track error codes
        for error_code in scenario_errors:
            if error_code not in error_map:
                error_map[error_code] = ErrorCoverage(error_code=error_code)
            ecov = error_map[error_code]
            ecov.scenario_count += 1
            ecov.tested_in.append(path)

        # Track jobs
        job = scenario.job
        if job not in job_map:
            job_map[job] = JobCoverage(job=job)
        jcov = job_map[job]
        jcov.scenario_count += 1
        for tag in scenario.tags or []:
            if tag not in jcov.tags:
                jcov.tags.append(tag)

    # Calculate average steps per job
    for job_name, jcov in job_map.items():
        job_scenarios = [(s, p) for s, p in scenarios if s.job == job_name]
        if job_scenarios:
            total_job_steps = sum(len(s.steps or []) for s, _ in job_scenarios)
            jcov.avg_steps = round(total_job_steps / len(job_scenarios))

    # Sort by usage
    command_coverage = sorted(command_map.values(), key=lambda c: c.step_count, reverse=True)
    error_coverage = sorted(error_map.values(), key=lambda e: e.scenario_count, reverse=True)
    job_coverage = sorted(job_map.values(), key=lambda j: j.scenario_count, reverse=True)

    # Build summary
    tested_commands = set(command_map.keys())
    tested_errors = set(error_map.keys())

    summary = CoverageSummary(
        total_scenarios=len(scenarios),
        total_steps=total_steps,
        commands_tested=len(tested_commands),
        errors_tested=len(tested_errors),
        jobs_count=len(job_map),
        jobs_names=list(job_map.keys()),
    )

    # Calculate coverage against known values
    if known_commands:
        summary.commands_known = len(known_commands)
        summary.commands_untested = [cmd for cmd in known_commands if cmd not in tested_commands]
        summary.commands_coverage = (summary.commands_tested / len(known_commands)) * 100

    if known_errors:
        summary.errors_known = len(known_errors)
        summary.errors_untested = [err for err in known_errors if err not in tested_errors]
        summary.errors_coverage = (summary.errors_tested / len(known_errors)) * 100

    return CoverageReport(
        summary=summary,
        command_coverage=command_coverage,
        error_coverage=error_coverage,
        job_coverage=job_coverage,
    )
