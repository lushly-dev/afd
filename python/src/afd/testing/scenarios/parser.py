"""
YAML Scenario Parser.

Parses .scenario.yaml files into typed Scenario objects.
Uses PyYAML for parsing with strict validation.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

import yaml

from afd.testing.scenarios.types import (
    Expectation,
    FixtureConfig,
    Scenario,
    Step,
    Verification,
)

# ============================================================================
# Parser Result Types
# ============================================================================


@dataclass
class ParseSuccess:
    success: bool  # always True
    scenario: Scenario


@dataclass
class ParseError:
    success: bool  # always False
    error: str
    path: str | None = None
    line: int | None = None


ParseResult = ParseSuccess | ParseError


# ============================================================================
# YAML Schema Validation
# ============================================================================


def _validate_scenario_yaml(raw: Any, file_path: str) -> ParseResult:
    """Validate and transform raw YAML into a Scenario object."""
    if not isinstance(raw, dict):
        return ParseError(success=False, error='Scenario file must contain a YAML object', path=file_path)

    # Validate required 'name' field
    name = raw.get('name')
    if not isinstance(name, str) or not name.strip():
        return ParseError(
            success=False,
            error="Scenario must have a non-empty 'name' field",
            path=file_path,
        )

    # Validate required 'description' field
    description = raw.get('description')
    if not isinstance(description, str) or not description.strip():
        return ParseError(
            success=False,
            error="Scenario must have a non-empty 'description' field",
            path=file_path,
        )

    # Validate required 'job' field
    job = raw.get('job')
    if not isinstance(job, str) or not job.strip():
        return ParseError(
            success=False,
            error="Scenario must have a non-empty 'job' field (kebab-case identifier)",
            path=file_path,
        )

    # Validate 'steps' array
    raw_steps = raw.get('steps')
    if not isinstance(raw_steps, list) or len(raw_steps) == 0:
        return ParseError(
            success=False,
            error='Scenario must have at least one step',
            path=file_path,
        )

    # Parse tags (optional, defaults to empty list)
    raw_tags = raw.get('tags')
    tags = [t for t in raw_tags if isinstance(t, str)] if isinstance(raw_tags, list) else []

    # Parse steps
    steps_result = _parse_steps(raw_steps, file_path)
    if isinstance(steps_result, ParseError):
        return steps_result
    steps = steps_result

    # Parse optional fixture
    fixture_result = _parse_fixture(raw.get('fixture'))
    if isinstance(fixture_result, ParseError):
        return ParseError(success=False, error=fixture_result.error, path=file_path)
    fixture = fixture_result

    # Parse optional verification
    verify_result = _parse_verification(raw.get('verify'))
    if isinstance(verify_result, ParseError):
        return ParseError(success=False, error=verify_result.error, path=file_path)
    verification = verify_result

    # Build isolation
    isolation = raw.get('isolation')
    if isolation not in ('fresh', 'chained'):
        isolation = None

    # Build depends_on
    raw_depends = raw.get('dependsOn') or raw.get('depends_on')
    depends_on = (
        [d for d in raw_depends if isinstance(d, str)]
        if isinstance(raw_depends, list) else None
    )

    # Build timeout
    timeout = raw.get('timeout')
    timeout = None if not isinstance(timeout, (int, float)) else int(timeout)

    # Build version
    version = raw.get('version')
    if not isinstance(version, str):
        version = None

    scenario = Scenario(
        name=name,
        description=description,
        job=job,
        steps=steps,
        tags=tags,
        version=version,
        fixture=fixture,
        isolation=isolation,
        depends_on=depends_on,
        timeout=timeout,
        verify=verification,
    )

    return ParseSuccess(success=True, scenario=scenario)


def _parse_steps(raw: list[Any], file_path: str) -> list[Step] | ParseError:
    """Parse steps array from YAML."""
    steps: list[Step] = []

    for i, item in enumerate(raw):
        step_num = i + 1

        if not isinstance(item, dict):
            return ParseError(
                success=False,
                error=f'Step {step_num} must be an object',
                path=file_path,
            )

        # Command (required)
        command = item.get('command')
        if not isinstance(command, str) or not command.strip():
            return ParseError(
                success=False,
                error=f"Step {step_num} must have a non-empty 'command' field",
                path=file_path,
            )

        # Parse expect (required)
        expect_result = _parse_expectation(item.get('expect'), step_num, file_path)
        if expect_result is None:
            return ParseError(
                success=False,
                error=f"Step {step_num} must have an 'expect' block",
                path=file_path,
            )
        if isinstance(expect_result, ParseError):
            return expect_result

        # Parse input (optional)
        raw_input = item.get('input')
        step_input = raw_input if isinstance(raw_input, dict) else None

        # Description
        desc = item.get('description')
        description = desc if isinstance(desc, str) else None

        # continueOnFailure / continue_on_failure
        continue_on_failure = bool(
            item.get('continueOnFailure') or item.get('continue_on_failure')
        )

        steps.append(Step(
            command=command,
            expect=expect_result,
            input=step_input,
            description=description,
            continue_on_failure=continue_on_failure,
        ))

    return steps


def _parse_expectation(
    raw: Any, step_num: int, file_path: str
) -> Expectation | ParseError | None:
    """Parse expectation from a step."""
    if raw is None:
        return None

    if not isinstance(raw, dict):
        return ParseError(
            success=False,
            error=f"Step {step_num} 'expect' must be an object",
            path=file_path,
        )

    # Check for 'success' field (required)
    if 'success' not in raw or not isinstance(raw['success'], bool):
        return ParseError(
            success=False,
            error=f"Step {step_num} 'expect' must have a boolean 'success' field",
            path=file_path,
        )

    # Parse error block
    error: dict[str, str | None] | None = None
    raw_error = raw.get('error')
    if isinstance(raw_error, dict):
        error = {
            'code': raw_error.get('code') if isinstance(raw_error.get('code'), str) else None,
            'message': raw_error.get('message') if isinstance(raw_error.get('message'), str) else None,
        }

    # Parse data assertions
    raw_data = raw.get('data')
    data = raw_data if isinstance(raw_data, dict) else None

    # Reasoning
    reasoning = raw.get('reasoning')
    if not isinstance(reasoning, str):
        reasoning = None

    # Confidence
    confidence = raw.get('confidence')
    confidence = None if not isinstance(confidence, (int, float)) else float(confidence)

    return Expectation(
        success=raw['success'],
        data=data,
        error=error,
        reasoning=reasoning,
        confidence=confidence,
    )


def _parse_fixture(raw: Any) -> FixtureConfig | ParseError | None:
    """Parse fixture configuration."""
    if raw is None:
        return None

    if not isinstance(raw, dict):
        return ParseError(success=False, error='Fixture must be an object')

    file_val = raw.get('file')
    if not isinstance(file_val, str) or not file_val.strip():
        return ParseError(
            success=False,
            error="Fixture must have a 'file' field (path to fixture JSON)",
        )

    base = raw.get('base')
    overrides = raw.get('overrides')

    return FixtureConfig(
        file=file_val,
        base=base if isinstance(base, str) else None,
        overrides=overrides if isinstance(overrides, dict) else None,
    )


def _parse_verification(raw: Any) -> Verification | ParseError | None:
    """Parse verification configuration."""
    if raw is None:
        return None

    if not isinstance(raw, dict):
        return ParseError(success=False, error='Verification must be an object')

    snapshot = raw.get('snapshot')
    assertions = raw.get('assertions')
    custom = raw.get('custom')

    return Verification(
        snapshot=snapshot if isinstance(snapshot, str) else None,
        assertions=[a for a in assertions if isinstance(a, str)] if isinstance(assertions, list) else None,
        custom=custom if isinstance(custom, str) else None,
    )


# ============================================================================
# Public API
# ============================================================================


def parse_scenario(yaml_str: str, file_path: str = '<string>') -> ParseResult:
    """Parse a scenario from a YAML string."""
    try:
        raw = yaml.safe_load(yaml_str)
        return _validate_scenario_yaml(raw, file_path)
    except yaml.YAMLError as e:
        return ParseError(
            success=False,
            error=f'YAML parse error: {e}',
            path=file_path,
        )


def parse_scenario_file(path: str) -> ParseResult:
    """Parse a scenario from a file path."""
    try:
        with open(path, encoding='utf-8') as f:
            content = f.read()
        return parse_scenario(content, path)
    except OSError as e:
        return ParseError(
            success=False,
            error=f'Failed to read file: {e}',
            path=path,
        )


def parse_scenario_dir(dir_path: str) -> list[ParseResult]:
    """Parse all scenario YAML files in a directory."""
    results: list[ParseResult] = []

    if not os.path.isdir(dir_path):
        return results

    for filename in sorted(os.listdir(dir_path)):
        if filename.endswith(('.yaml', '.yml')):
            filepath = os.path.join(dir_path, filename)
            results.append(parse_scenario_file(filepath))

    return results
