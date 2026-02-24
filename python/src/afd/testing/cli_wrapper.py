"""
CLI Wrapper for subprocess command execution.

Executes AFD CLI commands (afd call <command>) and captures structured
JSON output. Supports configurable timeouts, environment variables,
and server URL targeting.

Example:
    >>> from afd.testing.cli_wrapper import CliWrapper, create_cli_wrapper
    >>>
    >>> cli = create_cli_wrapper(server_url="http://localhost:3000/mcp")
    >>> result = await cli.execute("todo-create", {"title": "Buy groceries"})
    >>> if result["success"]:
    ...     print(result["result"]["data"])
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from dataclasses import dataclass, field
from typing import Any

from afd.testing.scenarios.types import StepError, create_step_error


@dataclass
class CliConfig:
    """Configuration for the CLI wrapper.

    Attributes:
        cli_path: Path to the AFD CLI executable (default: "afd").
        cwd: Working directory for CLI execution.
        env: Environment variables to pass to CLI.
        timeout: Default timeout in seconds (default: 30).
        server_url: MCP server URL for --connect option.
        verbose: Whether to output verbose logging.
    """

    cli_path: str = 'afd'
    cwd: str | None = None
    env: dict[str, str] = field(default_factory=dict)
    timeout: float = 30.0
    server_url: str | None = None
    verbose: bool = False


@dataclass
class ExecuteOptions:
    """Options for a single execution.

    Attributes:
        timeout: Override timeout for this command.
        env: Additional environment variables.
    """

    timeout: float | None = None
    env: dict[str, str] | None = None


@dataclass
class ExecuteSuccess:
    """Successful execution result.

    Attributes:
        success: Always True.
        result: Parsed CommandResult dict.
        duration_ms: Execution time in milliseconds.
        stdout: Raw stdout output.
        stderr: Raw stderr output.
    """

    success: bool  # always True
    result: dict[str, Any]
    duration_ms: float
    stdout: str
    stderr: str


@dataclass
class ExecuteError:
    """Failed execution result.

    Attributes:
        success: Always False.
        error: Step error with details.
        duration_ms: Execution time in milliseconds.
        stdout: Raw stdout output.
        stderr: Raw stderr output.
        exit_code: Process exit code if available.
    """

    success: bool  # always False
    error: StepError
    duration_ms: float
    stdout: str
    stderr: str
    exit_code: int | None = None


ExecuteResult = ExecuteSuccess | ExecuteError


class CliWrapper:
    """Wrapper for executing AFD CLI commands via subprocess.

    Example:
        >>> cli = CliWrapper(CliConfig(server_url="http://localhost:3000/mcp"))
        >>> result = await cli.execute("todo-create", {"title": "Test"})
        >>> if result.success:
        ...     print(result.result)
    """

    def __init__(self, config: CliConfig | None = None) -> None:
        self._config = config or CliConfig()
        if self._config.cwd is None:
            self._config.cwd = os.getcwd()

    async def execute(
        self,
        command: str,
        input: dict[str, Any] | None = None,
        options: ExecuteOptions | None = None,
    ) -> ExecuteResult:
        """Execute a command via the AFD CLI.

        Args:
            command: Command name (e.g., "todo-create").
            input: Input parameters as a dict.
            options: Per-execution options overrides.

        Returns:
            ExecuteSuccess or ExecuteError with timing and output.
        """
        timeout = (options.timeout if options and options.timeout else None) or self._config.timeout
        start_time = time.monotonic()

        args = self._build_args(command, input)

        if self._config.verbose:
            print(f'[CLI] {self._config.cli_path} {" ".join(args)}')

        try:
            stdout, stderr, exit_code = await self._spawn(args, timeout, options)
            duration_ms = (time.monotonic() - start_time) * 1000

            if self._config.verbose:
                print(f'[CLI] exit={exit_code} duration={duration_ms:.0f}ms')
                if stderr:
                    print(f'[CLI] stderr: {stderr}')

            parse_result = self._parse_output(stdout, stderr, exit_code)

            if parse_result['success']:
                return ExecuteSuccess(
                    success=True,
                    result=parse_result['result'],
                    duration_ms=duration_ms,
                    stdout=stdout,
                    stderr=stderr,
                )
            else:
                return ExecuteError(
                    success=False,
                    error=parse_result['error'],
                    duration_ms=duration_ms,
                    stdout=stdout,
                    stderr=stderr,
                    exit_code=exit_code,
                )

        except Exception as exc:
            duration_ms = (time.monotonic() - start_time) * 1000
            message = str(exc)
            return ExecuteError(
                success=False,
                error=create_step_error('unknown', f'CLI execution failed: {message}'),
                duration_ms=duration_ms,
                stdout='',
                stderr=message,
            )

    def configure(self, **kwargs: Any) -> None:
        """Update configuration fields.

        Args:
            **kwargs: Fields to update (cli_path, cwd, env, timeout, server_url, verbose).
        """
        for key, value in kwargs.items():
            if hasattr(self._config, key):
                setattr(self._config, key, value)

    def _build_args(self, command: str, input: dict[str, Any] | None) -> list[str]:
        """Build CLI arguments for a command."""
        args: list[str] = ['call', command]

        if self._config.server_url:
            args.extend(['--connect', self._config.server_url])

        args.append('--json')

        if input and len(input) > 0:
            args.extend(['--input', json.dumps(input)])

        return args

    async def _spawn(
        self,
        args: list[str],
        timeout: float,
        options: ExecuteOptions | None,
    ) -> tuple[str, str, int]:
        """Spawn CLI process and capture output."""
        env = {**os.environ, **self._config.env}
        if options and options.env:
            env.update(options.env)

        proc = await asyncio.create_subprocess_exec(
            self._config.cli_path,
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=self._config.cwd,
            env=env,
        )

        try:
            stdout_bytes, stderr_bytes = await asyncio.wait_for(
                proc.communicate(),
                timeout=timeout,
            )
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            raise TimeoutError(f'Command timed out after {timeout}s')

        stdout = stdout_bytes.decode('utf-8', errors='replace') if stdout_bytes else ''
        stderr = stderr_bytes.decode('utf-8', errors='replace') if stderr_bytes else ''
        exit_code = proc.returncode or 0

        return stdout, stderr, exit_code

    def _parse_output(
        self, stdout: str, stderr: str, exit_code: int
    ) -> dict[str, Any]:
        """Parse CLI output into a CommandResult-like dict."""
        import re

        trimmed = stdout.strip()

        # Look for JSON object in output
        json_match = re.search(r'\{[\s\S]*\}', trimmed)
        if not json_match:
            if exit_code == 0:
                return {
                    'success': True,
                    'result': {'success': True, 'data': trimmed or None},
                }
            return {
                'success': False,
                'error': create_step_error(
                    'parse_error', stderr or stdout or 'Command failed with no output'
                ),
            }

        try:
            parsed = json.loads(json_match.group(0))

            if isinstance(parsed, dict) and 'success' in parsed:
                return {'success': True, 'result': parsed}

            return {
                'success': True,
                'result': {'success': exit_code == 0, 'data': parsed},
            }
        except (json.JSONDecodeError, ValueError) as exc:
            return {
                'success': False,
                'error': create_step_error(
                    'parse_error', f'Failed to parse JSON output: {exc}'
                ),
            }


def create_cli_wrapper(config: CliConfig | None = None, **kwargs: Any) -> CliWrapper:
    """Create a CLI wrapper with the given configuration.

    Args:
        config: Full CliConfig object.
        **kwargs: Individual config fields (cli_path, cwd, env, timeout, server_url, verbose).

    Returns:
        A configured CliWrapper instance.
    """
    if config is None:
        config = CliConfig(**kwargs)
    return CliWrapper(config)
