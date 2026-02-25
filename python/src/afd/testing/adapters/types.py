"""
App adapter type definitions.

Port of packages/testing/src/adapters/types.ts
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Protocol


@dataclass
class AdapterCliConfig:
	"""CLI execution configuration for an app."""

	command: str
	default_args: list[str] | None = None
	input_format: str = "json-arg"  # json-arg | json-stdin | flags
	output_format: str = "json"  # json | text
	env: dict[str, str] | None = None


@dataclass
class AppliedCommand:
	"""A command that was applied from a fixture."""

	command: str
	input: dict[str, Any] | None = None
	result: dict[str, Any] | None = None


@dataclass
class ApplyFixtureResult:
	"""Result of applying a fixture."""

	applied_commands: list[AppliedCommand] = field(default_factory=list)
	warnings: list[str] | None = None


@dataclass
class FixtureValidationResult:
	"""Result of fixture validation."""

	valid: bool
	errors: list[str] | None = None


@dataclass
class AdapterContext:
	"""Context passed to adapter functions."""

	cli: str
	handler: Callable[[str, dict[str, Any]], Any] | None = None
	cwd: str | None = None
	env: dict[str, str] | None = None


@dataclass
class FixtureConfig:
	"""Fixture handling for an app."""

	apply: Callable[[Any, AdapterContext], Awaitable[ApplyFixtureResult]]
	reset: Callable[[AdapterContext], Awaitable[None]]
	schema: object | None = None
	validate: Callable[[Any], Awaitable[FixtureValidationResult]] | None = None


@dataclass
class CommandsConfig:
	"""Commands metadata for an app."""

	list: Callable[[], list[str]]
	get_schema: Callable[[str], object] | None = None
	get_description: Callable[[str], str] | None = None
	map_file_to_commands: Callable[[str], list[str]] | None = None


@dataclass
class ErrorsConfig:
	"""Error codes metadata for an app."""

	list: Callable[[], list[str]]
	get_description: Callable[[str], str] | None = None
	is_retryable: Callable[[str], bool] | None = None


@dataclass
class JobsConfig:
	"""Jobs (user goals) metadata for an app."""

	list: Callable[[], list[str]]
	get_description: Callable[[str], str] | None = None
	get_related_commands: Callable[[str], list[str]] | None = None


@dataclass
class AppAdapter:
	"""App adapter interface for AFD applications."""

	name: str
	version: str
	cli: AdapterCliConfig
	fixture: FixtureConfig
	commands: CommandsConfig
	errors: ErrorsConfig
	jobs: JobsConfig


@dataclass
class AdapterRegistryOptions:
	"""Options for creating an adapter registry."""

	adapters: list[AppAdapter] | None = None
	default_adapter: str | None = None


class AdapterRegistry(Protocol):
	"""Adapter registry protocol."""

	def register(self, adapter: AppAdapter) -> None: ...
	def get(self, name: str) -> AppAdapter | None: ...
	def list(self) -> list[AppAdapter]: ...
	def detect(self, fixture: Any) -> AppAdapter | None: ...
	def has(self, name: str) -> bool: ...
