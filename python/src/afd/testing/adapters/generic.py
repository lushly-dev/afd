"""
Generic adapter implementation.

Fallback adapter for apps that don't have a specific adapter.
Provides basic functionality using convention over configuration.

Port of packages/testing/src/adapters/generic.ts
"""

from __future__ import annotations

from typing import Any

from afd.testing.adapters.types import (
	AdapterCliConfig,
	AdapterContext,
	AppAdapter,
	AppliedCommand,
	ApplyFixtureResult,
	CommandsConfig,
	ErrorsConfig,
	FixtureConfig,
	FixtureValidationResult,
	JobsConfig,
)


def create_generic_adapter(
	name: str = "generic",
	version: str = "1.0.0",
	*,
	cli_command: str | None = None,
	default_args: list[str] | None = None,
	input_format: str = "json-arg",
	output_format: str = "json",
	commands: list[str] | None = None,
	errors: list[str] | None = None,
	jobs: list[str] | None = None,
) -> AppAdapter:
	"""Create a generic adapter for an app."""
	cmd_list = commands or []
	err_list = errors or []
	job_list = jobs or []

	async def apply_fixture(fixture: Any, context: AdapterContext) -> ApplyFixtureResult:
		return await _generic_fixture_applicator(fixture, context)

	async def reset_fixture(_context: AdapterContext) -> None:
		pass

	async def validate_fixture(fixture: Any) -> FixtureValidationResult:
		return await _generic_fixture_validator(fixture)

	return AppAdapter(
		name=name,
		version=version,
		cli=AdapterCliConfig(
			command=cli_command or name,
			default_args=default_args,
			input_format=input_format,
			output_format=output_format,
		),
		fixture=FixtureConfig(
			apply=apply_fixture,
			reset=reset_fixture,
			validate=validate_fixture,
		),
		commands=CommandsConfig(
			list=lambda: cmd_list,
			get_description=lambda cmd: f"Execute {cmd} command",
		),
		errors=ErrorsConfig(
			list=lambda: err_list,
			get_description=lambda code: f"Error: {code}",
			is_retryable=lambda code: code in {"TIMEOUT", "NETWORK_ERROR", "RATE_LIMITED"},
		),
		jobs=JobsConfig(
			list=lambda: job_list,
			get_description=lambda job: f"Job: {job}",
		),
	)


async def _generic_fixture_applicator(
	fixture: Any, context: AdapterContext
) -> ApplyFixtureResult:
	"""Generic fixture applicator that handles common patterns."""
	applied_commands: list[AppliedCommand] = []
	warnings: list[str] = []

	if not _is_generic_fixture(fixture):
		warnings.append("Fixture does not match expected generic format")
		return ApplyFixtureResult(applied_commands=applied_commands, warnings=warnings)

	handler = context.handler
	if not handler:
		warnings.append("No command handler provided, fixture not applied")
		return ApplyFixtureResult(applied_commands=applied_commands, warnings=warnings)

	for array_key in ("data", "setup"):
		items = fixture.get(array_key)
		if items and isinstance(items, list):
			for item in items:
				if _is_data_item(item):
					try:
						result = await handler(item["command"], item.get("input", {}))
						applied_commands.append(
							AppliedCommand(
								command=item["command"],
								input=item.get("input"),
								result=result,
							)
						)
					except Exception as err:
						warnings.append(
							f"Failed to apply {item['command']}: {err}"
						)

	return ApplyFixtureResult(applied_commands=applied_commands, warnings=warnings)


async def _generic_fixture_validator(fixture: Any) -> FixtureValidationResult:
	"""Generic fixture validator."""
	errors: list[str] = []

	if not isinstance(fixture, dict):
		errors.append("Fixture must be an object")
		return FixtureValidationResult(valid=False, errors=errors)

	if not fixture.get("app") or not isinstance(fixture.get("app"), str):
		errors.append("Fixture should have an 'app' field identifying the target app")

	for array_key in ("data", "setup"):
		if array_key in fixture:
			arr = fixture[array_key]
			if not isinstance(arr, list):
				errors.append(f"Fixture '{array_key}' must be an array")
			else:
				for i, item in enumerate(arr):
					if not _is_data_item(item):
						errors.append(f"{array_key}[{i}] must have a 'command' field")

	return FixtureValidationResult(
		valid=len(errors) == 0,
		errors=errors if errors else None,
	)


def _is_generic_fixture(value: Any) -> bool:
	return isinstance(value, dict)


def _is_data_item(value: Any) -> bool:
	return isinstance(value, dict) and isinstance(value.get("command"), str)
