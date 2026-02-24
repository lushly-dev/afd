"""
Generic App Adapter.

Provides a fallback adapter for applications that don't have a
specialized adapter. Handles generic fixture formats with setup
and data arrays.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from afd.testing.adapters.types import (
    AdapterContext,
    AppAdapter,
    AppliedCommand,
    ApplyFixtureResult,
    CliConfig,
    CommandsConfig,
    ErrorsConfig,
    FixtureConfig,
    FixtureValidationResult,
    JobsConfig,
)


@dataclass
class GenericAdapterOptions:
    """Options for creating a generic adapter.

    Attributes:
        version: Adapter version string.
        cli_command: CLI executable command.
        default_args: Default CLI arguments.
        input_format: How to pass JSON input.
        output_format: Expected output format.
        commands: List of available command names.
        errors: List of known error codes.
        jobs: List of defined job names.
    """

    version: str = '0.1.0'
    cli_command: str = 'afd'
    default_args: list[str] = field(default_factory=list)
    input_format: str = 'json-arg'
    output_format: str = 'json'
    commands: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    jobs: list[str] = field(default_factory=list)


async def _generic_apply(fixture: Any, context: AdapterContext) -> ApplyFixtureResult:
    """Apply a generic fixture by executing setup and data commands."""
    applied: list[AppliedCommand] = []
    warnings: list[str] = []

    if not isinstance(fixture, dict):
        return ApplyFixtureResult(
            applied_commands=applied,
            warnings=['Fixture is not a dict; skipping'],
        )

    # Execute setup commands
    setup_commands = fixture.get('setup', [])
    if isinstance(setup_commands, list):
        for cmd_spec in setup_commands:
            if not isinstance(cmd_spec, dict) or 'command' not in cmd_spec:
                warnings.append(f'Invalid setup command: {cmd_spec}')
                continue

            command_name = cmd_spec['command']
            command_input = cmd_spec.get('input', {})
            result = None

            if context.handler:
                try:
                    result = await context.handler(command_name, command_input)
                    if isinstance(result, dict):
                        pass
                    elif hasattr(result, 'model_dump'):
                        result = result.model_dump()
                except Exception as exc:
                    warnings.append(f'Setup command {command_name} failed: {exc}')

            applied.append(AppliedCommand(
                command=command_name,
                input=command_input,
                result=result,
            ))

    # Execute data commands
    data_commands = fixture.get('data', [])
    if isinstance(data_commands, list):
        for cmd_spec in data_commands:
            if not isinstance(cmd_spec, dict) or 'command' not in cmd_spec:
                warnings.append(f'Invalid data command: {cmd_spec}')
                continue

            command_name = cmd_spec['command']
            command_input = cmd_spec.get('input', {})
            result = None

            if context.handler:
                try:
                    result = await context.handler(command_name, command_input)
                    if hasattr(result, 'model_dump'):
                        result = result.model_dump()
                except Exception as exc:
                    warnings.append(f'Data command {command_name} failed: {exc}')

            applied.append(AppliedCommand(
                command=command_name,
                input=command_input,
                result=result,
            ))

    return ApplyFixtureResult(applied_commands=applied, warnings=warnings)


async def _generic_reset(context: AdapterContext) -> None:
    """Reset generic app state (no-op for generic adapter)."""


async def _generic_validate(fixture: Any) -> FixtureValidationResult:
    """Validate a generic fixture."""
    errors: list[str] = []

    if not isinstance(fixture, dict):
        return FixtureValidationResult(valid=False, errors=['Fixture must be a dict'])

    for key in ('setup', 'data'):
        items = fixture.get(key)
        if items is not None and not isinstance(items, list):
            errors.append(f"'{key}' must be a list")
        elif isinstance(items, list):
            for i, item in enumerate(items):
                if not isinstance(item, dict):
                    errors.append(f'{key}[{i}] must be an object')
                elif 'command' not in item:
                    errors.append(f"{key}[{i}] must have a 'command' field")

    return FixtureValidationResult(valid=len(errors) == 0, errors=errors)


def create_generic_adapter(
    name: str,
    options: GenericAdapterOptions | None = None,
) -> AppAdapter:
    """Create a generic adapter with configurable metadata.

    Args:
        name: Adapter name (e.g., 'my-app').
        options: Configuration options.

    Returns:
        An AppAdapter with generic fixture handling.
    """
    opts = options or GenericAdapterOptions()

    return AppAdapter(
        name=name,
        version=opts.version,
        cli=CliConfig(
            command=opts.cli_command,
            default_args=opts.default_args,
            input_format=opts.input_format,  # type: ignore[arg-type]
            output_format=opts.output_format,  # type: ignore[arg-type]
        ),
        fixture=FixtureConfig(
            apply=_generic_apply,
            reset=_generic_reset,
            validate=_generic_validate,
        ),
        commands=CommandsConfig(
            list_commands=lambda: list(opts.commands),
        ),
        errors=ErrorsConfig(
            list_errors=lambda: list(opts.errors),
        ),
        jobs=JobsConfig(
            list_jobs=lambda: list(opts.jobs),
        ),
    )


# Default generic adapter instance
generic_adapter = create_generic_adapter('generic')
