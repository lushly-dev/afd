"""
CLI Wrapper for executing AFD commands via subprocess.

Port of packages/testing/src/runner/cli-wrapper.ts
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import time
from dataclasses import dataclass, field
from typing import Any

from afd.testing.scenarios.types import StepError, create_step_error


@dataclass
class CliConfig:
	"""Configuration for the CLI wrapper."""

	cli_path: str = "afd"
	cwd: str | None = None
	env: dict[str, str] | None = None
	timeout: int = 30000
	server_url: str | None = None
	verbose: bool = False


@dataclass
class ExecuteOptions:
	"""Per-execution option overrides."""

	timeout: int | None = None
	env: dict[str, str] | None = None


@dataclass
class ExecuteSuccess:
	"""Successful CLI execution result."""

	success: bool  # Always True
	result: dict[str, Any]
	duration_ms: int
	stdout: str
	stderr: str


@dataclass
class ExecuteError:
	"""Failed CLI execution result."""

	success: bool  # Always False
	error: StepError
	duration_ms: int
	stdout: str
	stderr: str
	exit_code: int | None = None


ExecuteResult = ExecuteSuccess | ExecuteError


class CliWrapper:
	"""Wrapper for executing AFD CLI commands.

	Example:
		cli = CliWrapper(CliConfig(server_url="http://localhost:3000/mcp"))
		result = await cli.execute("todo-create", {"title": "Buy groceries"})
		if result.success:
			print(result.result["data"])
	"""

	def __init__(self, config: CliConfig | None = None) -> None:
		cfg = config or CliConfig()
		self._cli_path = cfg.cli_path
		self._cwd = cfg.cwd or os.getcwd()
		self._env: dict[str, str] = cfg.env or {}
		self._timeout = cfg.timeout
		self._server_url = cfg.server_url
		self._verbose = cfg.verbose

	async def execute(
		self,
		command: str,
		input: dict[str, Any] | None = None,
		options: ExecuteOptions | None = None,
	) -> ExecuteResult:
		"""Execute a command via the AFD CLI."""
		timeout = (options.timeout if options and options.timeout else None) or self._timeout
		start = time.monotonic()

		args = self._build_args(command, input)

		if self._verbose:
			print(f"[CLI] {self._cli_path} {' '.join(args)}")

		try:
			stdout, stderr, exit_code = await self._spawn(
				args, timeout, options.env if options else None
			)
			duration_ms = int((time.monotonic() - start) * 1000)

			if self._verbose:
				print(f"[CLI] exit={exit_code} duration={duration_ms}ms")
				if stderr:
					print(f"[CLI] stderr: {stderr}")

			parse_result = self._parse_output(stdout, stderr, exit_code)

			if parse_result[0]:
				return ExecuteSuccess(
					success=True,
					result=parse_result[1],
					duration_ms=duration_ms,
					stdout=stdout,
					stderr=stderr,
				)
			else:
				return ExecuteError(
					success=False,
					error=parse_result[1],
					duration_ms=duration_ms,
					stdout=stdout,
					stderr=stderr,
					exit_code=exit_code,
				)
		except Exception as err:
			duration_ms = int((time.monotonic() - start) * 1000)
			message = str(err)
			return ExecuteError(
				success=False,
				error=create_step_error("unknown", f"CLI execution failed: {message}"),
				duration_ms=duration_ms,
				stdout="",
				stderr=message,
			)

	def configure(self, **kwargs: Any) -> None:
		"""Update configuration."""
		if "cli_path" in kwargs:
			self._cli_path = kwargs["cli_path"]
		if "cwd" in kwargs:
			self._cwd = kwargs["cwd"]
		if "env" in kwargs:
			self._env = kwargs["env"]
		if "timeout" in kwargs:
			self._timeout = kwargs["timeout"]
		if "server_url" in kwargs:
			self._server_url = kwargs["server_url"]
		if "verbose" in kwargs:
			self._verbose = kwargs["verbose"]

	def _build_args(self, command: str, input: dict[str, Any] | None = None) -> list[str]:
		"""Build CLI arguments for a command."""
		args = ["call", command]

		if self._server_url:
			args.extend(["--connect", self._server_url])

		args.append("--json")

		if input and len(input) > 0:
			args.extend(["--input", json.dumps(input)])

		return args

	async def _spawn(
		self,
		args: list[str],
		timeout_ms: int,
		extra_env: dict[str, str] | None = None,
	) -> tuple[str, str, int]:
		"""Spawn CLI process and capture output."""
		env = {**os.environ, **self._env}
		if extra_env:
			env.update(extra_env)

		proc = await asyncio.create_subprocess_exec(
			self._cli_path,
			*args,
			cwd=self._cwd,
			env=env,
			stdout=asyncio.subprocess.PIPE,
			stderr=asyncio.subprocess.PIPE,
		)

		try:
			stdout_bytes, stderr_bytes = await asyncio.wait_for(
				proc.communicate(), timeout=timeout_ms / 1000
			)
		except asyncio.TimeoutError:
			proc.kill()
			await proc.wait()
			raise TimeoutError(f"Command timed out after {timeout_ms}ms") from None

		stdout = stdout_bytes.decode("utf-8", errors="replace") if stdout_bytes else ""
		stderr = stderr_bytes.decode("utf-8", errors="replace") if stderr_bytes else ""
		exit_code = proc.returncode or 0

		return stdout, stderr, exit_code

	def _parse_output(
		self, stdout: str, stderr: str, exit_code: int
	) -> tuple[bool, Any]:
		"""Parse CLI output into a CommandResult or StepError.

		Returns (True, result_dict) on success, (False, StepError) on failure.
		"""
		trimmed = stdout.strip()

		json_match = re.search(r"\{[\s\S]*\}", trimmed)
		if not json_match:
			if exit_code == 0:
				return (True, {"success": True, "data": trimmed or None})
			return (
				False,
				create_step_error("parse_error", stderr or stdout or "Command failed with no output"),
			)

		try:
			parsed = json.loads(json_match.group(0))

			if isinstance(parsed, dict) and "success" in parsed:
				return (True, parsed)

			return (True, {"success": exit_code == 0, "data": parsed})
		except json.JSONDecodeError as err:
			return (
				False,
				create_step_error("parse_error", f"Failed to parse JSON output: {err}"),
			)


def create_cli_wrapper(config: CliConfig | None = None) -> CliWrapper:
	"""Create a CLI wrapper with the given configuration."""
	return CliWrapper(config)
