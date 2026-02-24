"""
App Adapter types for AFD testing.

Defines the interface for adapting the JTBD testing framework
to different AFD applications (Todo, Violet, etc.).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Literal


@dataclass
class CliConfig:
    """CLI execution configuration for an app.

    Attributes:
        command: CLI executable command.
        default_args: Default arguments to include with every command.
        input_format: How to pass JSON input to the CLI.
        output_format: Expected output format from CLI.
        env: Environment variables to set.
    """

    command: str
    input_format: Literal['json-arg', 'json-stdin', 'flags'] = 'json-arg'
    output_format: Literal['json', 'text'] = 'json'
    default_args: list[str] = field(default_factory=list)
    env: dict[str, str] = field(default_factory=dict)


@dataclass
class AppliedCommand:
    """A command that was applied from a fixture.

    Attributes:
        command: Command name.
        input: Input passed to command.
        result: Result of command execution.
    """

    command: str
    input: dict[str, Any] | None = None
    result: dict[str, Any] | None = None


@dataclass
class ApplyFixtureResult:
    """Result of applying a fixture.

    Attributes:
        applied_commands: Commands that were executed.
        warnings: Any warnings during application.
    """

    applied_commands: list[AppliedCommand] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


@dataclass
class FixtureValidationResult:
    """Result of fixture validation.

    Attributes:
        valid: Whether the fixture is valid.
        errors: Validation error messages.
    """

    valid: bool = True
    errors: list[str] = field(default_factory=list)


@dataclass
class AdapterContext:
    """Context passed to adapter functions.

    Attributes:
        cli: CLI command to use.
        handler: Command handler for in-process execution.
        cwd: Working directory.
        env: Environment variables.
    """

    cli: str = ''
    handler: Callable[..., Any] | None = None
    cwd: str | None = None
    env: dict[str, str] = field(default_factory=dict)


@dataclass
class FixtureConfig:
    """Fixture handling configuration for an app.

    Attributes:
        apply: Async function to apply fixture data.
        reset: Async function to reset app state.
        validate: Optional async function to validate fixture data.
        schema: Optional JSON Schema for fixture validation.
    """

    apply: Callable[..., Any]  # async (fixture, context) -> ApplyFixtureResult
    reset: Callable[..., Any]  # async (context) -> None
    validate: Callable[..., Any] | None = None  # async (fixture) -> FixtureValidationResult
    schema: dict[str, Any] | None = None


@dataclass
class CommandsConfig:
    """Commands metadata for an app.

    Attributes:
        list_commands: Function returning available command names.
        get_schema: Optional function returning JSON Schema for a command.
        get_description: Optional function returning command description.
        map_file_to_commands: Optional function mapping file paths to commands.
    """

    list_commands: Callable[[], list[str]]
    get_schema: Callable[[str], dict[str, Any]] | None = None
    get_description: Callable[[str], str] | None = None
    map_file_to_commands: Callable[[str], list[str]] | None = None


@dataclass
class ErrorsConfig:
    """Error codes metadata for an app.

    Attributes:
        list_errors: Function returning known error codes.
        get_description: Optional function returning error description.
        is_retryable: Optional function checking if error is retryable.
    """

    list_errors: Callable[[], list[str]]
    get_description: Callable[[str], str] | None = None
    is_retryable: Callable[[str], bool] | None = None


@dataclass
class JobsConfig:
    """Jobs (user goals) metadata for an app.

    Attributes:
        list_jobs: Function returning defined job names.
        get_description: Optional function returning job description.
        get_related_commands: Optional function returning commands for a job.
    """

    list_jobs: Callable[[], list[str]]
    get_description: Callable[[str], str] | None = None
    get_related_commands: Callable[[str], list[str]] | None = None


@dataclass
class AppAdapter:
    """App adapter interface for AFD applications.

    Each app provides an adapter to enable JTBD testing.

    Attributes:
        name: Unique app identifier (e.g., 'todo', 'violet').
        version: App version for compatibility checking.
        cli: CLI configuration.
        fixture: Fixture handling configuration.
        commands: Commands metadata.
        errors: Error codes metadata.
        jobs: Jobs/user-goals metadata.
    """

    name: str
    version: str
    cli: CliConfig
    fixture: FixtureConfig
    commands: CommandsConfig
    errors: ErrorsConfig
    jobs: JobsConfig
