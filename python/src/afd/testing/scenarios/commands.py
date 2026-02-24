"""
Scenario command entry points.

These are the high-level command functions that the MCP tools invoke.
Each returns a structured CommandResult dict with data, reasoning,
and confidence fields.
"""

from __future__ import annotations

import os
from typing import Any

from afd.testing.scenarios.coverage import scenario_coverage
from afd.testing.scenarios.parser import parse_scenario_dir, parse_scenario_file


async def scenario_list_command(input: dict[str, Any]) -> dict[str, Any]:
    """List JTBD scenarios with optional filtering.

    Args:
        input: Dict with optional 'directory', 'tags', 'job' fields.

    Returns:
        CommandResult dict with scenario list data.
    """
    directory = input.get('directory', './scenarios')
    tag_filter = input.get('tags')
    job_filter = input.get('job')

    if not os.path.isdir(directory):
        return {
            'success': False,
            'error': {
                'code': 'DIRECTORY_NOT_FOUND',
                'message': f"Scenario directory '{directory}' does not exist",
                'suggestion': f"Create the directory or specify a valid path with 'directory'",
            },
        }

    results = parse_scenario_dir(directory)
    scenarios: list[dict[str, Any]] = []

    for result in results:
        if not result.success:
            continue

        scenario = result.scenario  # type: ignore[union-attr]

        # Apply tag filter
        if tag_filter:
            scenario_tags = set(scenario.tags or [])
            if not scenario_tags.intersection(tag_filter):
                continue

        # Apply job filter
        if job_filter and job_filter.lower() not in scenario.job.lower():
            continue

        scenarios.append({
            'name': scenario.name,
            'description': scenario.description,
            'job': scenario.job,
            'tags': scenario.tags or [],
            'step_count': len(scenario.steps or []),
        })

    return {
        'success': True,
        'data': {
            'scenarios': scenarios,
            'total': len(scenarios),
            'directory': directory,
        },
        'reasoning': f'Found {len(scenarios)} scenario(s) in {directory}',
        'confidence': 0.95,
    }


async def scenario_evaluate_command(input: dict[str, Any]) -> dict[str, Any]:
    """Execute scenarios and return test results.

    Args:
        input: Dict with 'handler', 'directory', 'scenarios', etc.

    Returns:
        CommandResult dict with test report data.
    """
    handler = input.get('handler')
    directory = input.get('directory', './scenarios')
    scenario_files = input.get('scenarios')
    tag_filter = input.get('tags')
    job_filter = input.get('job')
    stop_on_failure = input.get('stop_on_failure', False)

    if not handler:
        return {
            'success': False,
            'error': {
                'code': 'HANDLER_NOT_CONFIGURED',
                'message': 'No command handler configured for scenario evaluation',
                'suggestion': 'Provide a commandHandler in the MCP server context',
            },
        }

    # Collect scenarios
    if scenario_files:
        results = [parse_scenario_file(f) for f in scenario_files]
    elif os.path.isdir(directory):
        results = parse_scenario_dir(directory)
    else:
        return {
            'success': False,
            'error': {
                'code': 'DIRECTORY_NOT_FOUND',
                'message': f"Scenario directory '{directory}' does not exist",
                'suggestion': f"Create the directory or specify scenario files with 'scenarios'",
            },
        }

    # Filter and validate
    valid_scenarios = []
    parse_errors = []

    for result in results:
        if not result.success:
            parse_errors.append(str(getattr(result, 'error', 'Unknown parse error')))
            continue

        scenario = result.scenario  # type: ignore[union-attr]

        if tag_filter:
            scenario_tags = set(scenario.tags or [])
            if not scenario_tags.intersection(tag_filter):
                continue

        if job_filter and job_filter.lower() not in scenario.job.lower():
            continue

        valid_scenarios.append(scenario)

    if not valid_scenarios:
        return {
            'success': True,
            'data': {
                'report': {
                    'title': 'Scenario Evaluation',
                    'scenarios': [],
                    'summary': {
                        'total_scenarios': 0,
                        'passed_scenarios': 0,
                        'failed_scenarios': 0,
                        'pass_rate': 1.0,
                    },
                },
                'parse_errors': parse_errors,
            },
            'reasoning': 'No scenarios matched the filter criteria',
            'confidence': 0.9,
        }

    # Execute scenarios using InProcessExecutor
    from afd.testing.scenarios.executor import InProcessExecutor, InProcessExecutorConfig

    config = InProcessExecutorConfig(
        handler=handler,
        stop_on_failure=stop_on_failure,
    )
    executor = InProcessExecutor(config)

    scenario_results = []
    for scenario in valid_scenarios:
        result = await executor.execute(scenario)
        scenario_results.append(result)

    # Build summary
    passed = sum(1 for r in scenario_results if r.outcome == 'pass')
    failed = sum(1 for r in scenario_results if r.outcome in ('fail', 'error'))
    total = len(scenario_results)

    report = {
        'title': 'Scenario Evaluation',
        'scenarios': [
            {
                'scenario_path': r.scenario_path,
                'job_name': r.job_name,
                'outcome': r.outcome,
                'duration_ms': r.duration_ms,
                'passed_steps': r.passed_steps,
                'failed_steps': r.failed_steps,
                'step_results': [
                    {
                        'step_id': sr.step_id,
                        'command': sr.command,
                        'outcome': sr.outcome,
                        'duration_ms': sr.duration_ms,
                    }
                    for sr in r.step_results
                ],
            }
            for r in scenario_results
        ],
        'summary': {
            'total_scenarios': total,
            'passed_scenarios': passed,
            'failed_scenarios': failed,
            'pass_rate': passed / total if total > 0 else 1.0,
        },
    }

    return {
        'success': True,
        'data': {'report': report, 'exit_code': 0 if failed == 0 else 1},
        'reasoning': f'{passed}/{total} scenarios passed',
        'confidence': 0.95,
    }


async def scenario_coverage_command(input: dict[str, Any]) -> dict[str, Any]:
    """Analyze test coverage of scenarios against known commands.

    Args:
        input: Dict with 'known_commands', 'directory' fields.

    Returns:
        CommandResult dict with coverage report data.
    """
    known_commands = input.get('known_commands', [])
    directory = input.get('directory', './scenarios')

    if not os.path.isdir(directory):
        return {
            'success': False,
            'error': {
                'code': 'DIRECTORY_NOT_FOUND',
                'message': f"Scenario directory '{directory}' does not exist",
                'suggestion': f"Create the directory or specify a valid path",
            },
        }

    results = parse_scenario_dir(directory)
    scenarios_with_paths = []

    for result in results:
        if result.success:
            scenario = result.scenario  # type: ignore[union-attr]
            scenarios_with_paths.append((scenario, directory))

    report = scenario_coverage(
        scenarios_with_paths,
        known_commands=known_commands if known_commands else None,
    )

    coverage_data = {
        'summary': {
            'total_scenarios': report.summary.total_scenarios,
            'total_steps': report.summary.total_steps,
            'commands_tested': report.summary.commands_tested,
            'commands_known': report.summary.commands_known,
            'commands_coverage': report.summary.commands_coverage,
            'commands_untested': report.summary.commands_untested,
        },
        'command_coverage': [
            {
                'command': cc.command,
                'scenario_count': cc.scenario_count,
                'step_count': cc.step_count,
            }
            for cc in report.command_coverage
        ],
    }

    coverage_pct = report.summary.commands_coverage or 0

    return {
        'success': True,
        'data': coverage_data,
        'reasoning': f'{report.summary.commands_tested} commands tested ({coverage_pct:.0f}% coverage)',
        'confidence': 0.95,
    }


async def scenario_create_command(input: dict[str, Any]) -> dict[str, Any]:
    """Generate a new scenario file from a template.

    Args:
        input: Dict with 'name', 'job', 'template', 'directory', etc.

    Returns:
        CommandResult dict with created file path.
    """
    name = input.get('name', '')
    job = input.get('job', '')
    template = input.get('template', 'basic')
    directory = input.get('directory', './scenarios')
    commands_list = input.get('commands', [])
    tags = input.get('tags', [])

    if not name:
        return {
            'success': False,
            'error': {
                'code': 'VALIDATION_ERROR',
                'message': "Scenario 'name' is required",
                'suggestion': "Provide a name for the scenario file",
            },
        }

    if not job:
        return {
            'success': False,
            'error': {
                'code': 'VALIDATION_ERROR',
                'message': "Scenario 'job' is required",
                'suggestion': "Provide a job-to-be-done description",
            },
        }

    # Generate YAML content
    steps = _generate_template_steps(template, commands_list)
    tags_line = f'\ntags: [{", ".join(tags)}]' if tags else ''

    yaml_content = f"""name: {name}
description: Auto-generated {template} scenario for {job}
job: {job}{tags_line}

steps:
{steps}"""

    # Write file
    os.makedirs(directory, exist_ok=True)
    filename = f'{name.lower().replace(" ", "-")}.scenario.yaml'
    filepath = os.path.join(directory, filename)

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(yaml_content)

    return {
        'success': True,
        'data': {
            'file': filepath,
            'template': template,
            'name': name,
            'job': job,
        },
        'reasoning': f'Created {template} scenario at {filepath}',
        'confidence': 0.95,
    }


async def scenario_suggest_command(input: dict[str, Any]) -> dict[str, Any]:
    """Suggest new scenarios based on context.

    Args:
        input: Dict with 'context', 'files', 'command', 'query', etc.

    Returns:
        CommandResult dict with suggestions.
    """
    context = input.get('context', 'uncovered')
    known_commands = input.get('known_commands', [])
    directory = input.get('directory', './scenarios')
    limit = input.get('limit', 5)

    suggestions: list[dict[str, Any]] = []

    if context == 'uncovered' and known_commands:
        # Find untested commands
        tested: set[str] = set()
        if os.path.isdir(directory):
            results = parse_scenario_dir(directory)
            for result in results:
                if result.success:
                    scenario = result.scenario  # type: ignore[union-attr]
                    for step in scenario.steps or []:
                        tested.add(step.command)

        untested = [cmd for cmd in known_commands if cmd not in tested]
        for cmd in untested[:limit]:
            suggestions.append({
                'type': 'untested-command',
                'command': cmd,
                'description': f'Add test coverage for {cmd}',
                'template': 'basic',
            })

    elif context == 'command':
        cmd = input.get('command', '')
        if cmd:
            suggestions.append({
                'type': 'command-scenario',
                'command': cmd,
                'description': f'Create scenario testing {cmd} with success and error cases',
                'template': 'crud' if any(kw in cmd for kw in ('create', 'delete', 'update')) else 'basic',
            })

    elif context == 'failed':
        suggestions.append({
            'type': 'failure-investigation',
            'description': 'Review and fix failing scenarios before adding new ones',
            'template': 'validation',
        })

    elif context == 'changed-files':
        files = input.get('files', [])
        for f in files[:limit]:
            basename = os.path.basename(f)
            suggestions.append({
                'type': 'changed-file',
                'file': f,
                'description': f'Add scenario for changes in {basename}',
                'template': 'basic',
            })

    elif context == 'natural':
        query = input.get('query', '')
        suggestions.append({
            'type': 'natural-query',
            'query': query,
            'description': f'Scenario based on: {query}',
            'template': 'workflow',
        })

    return {
        'success': True,
        'data': {
            'suggestions': suggestions[:limit],
            'context': context,
            'total': len(suggestions),
        },
        'reasoning': f'Generated {len(suggestions)} suggestion(s) for context: {context}',
        'confidence': 0.85,
    }


def _generate_template_steps(template: str, commands: list[str]) -> str:
    """Generate YAML steps for a template type."""
    if template == 'crud' and commands:
        steps = []
        for cmd in commands:
            steps.append(f'  - command: {cmd}\n    input: {{}}\n    expect:\n      success: true')
        return '\n'.join(steps)

    if template == 'workflow' and commands:
        steps = []
        for i, cmd in enumerate(commands):
            desc = f'Step {i + 1}: Execute {cmd}'
            steps.append(f'  - command: {cmd}\n    description: "{desc}"\n    input: {{}}\n    expect:\n      success: true')
        return '\n'.join(steps)

    if template == 'validation':
        return '  - command: example-validate\n    input: {}\n    expect:\n      success: false\n      error:\n        code: VALIDATION_ERROR'

    # basic template
    if commands:
        cmd = commands[0]
        return f'  - command: {cmd}\n    input: {{}}\n    expect:\n      success: true'

    return '  - command: example-command\n    input: {}\n    expect:\n      success: true'
