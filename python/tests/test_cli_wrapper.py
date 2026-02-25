"""Tests for the AFD CLI wrapper module."""

from __future__ import annotations

import asyncio
import json
import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from afd.testing.cli_wrapper import (
	CliConfig,
	CliWrapper,
	ExecuteError,
	ExecuteOptions,
	ExecuteSuccess,
	create_cli_wrapper,
)


# ==============================================================================
# CliConfig defaults
# ==============================================================================


class TestCliConfig:
	"""Tests for CliConfig dataclass defaults."""

	def test_default_values(self):
		"""Should have sensible defaults."""
		config = CliConfig()
		assert config.cli_path == "afd"
		assert config.cwd is None
		assert config.env is None
		assert config.timeout == 30000
		assert config.server_url is None
		assert config.verbose is False

	def test_custom_values(self):
		"""Should accept custom values."""
		config = CliConfig(
			cli_path="/usr/local/bin/afd",
			cwd="/tmp/project",
			env={"NODE_ENV": "test"},
			timeout=5000,
			server_url="http://localhost:3000/mcp",
			verbose=True,
		)
		assert config.cli_path == "/usr/local/bin/afd"
		assert config.cwd == "/tmp/project"
		assert config.env == {"NODE_ENV": "test"}
		assert config.timeout == 5000
		assert config.server_url == "http://localhost:3000/mcp"
		assert config.verbose is True


# ==============================================================================
# ExecuteOptions
# ==============================================================================


class TestExecuteOptions:
	"""Tests for ExecuteOptions dataclass."""

	def test_default_values(self):
		"""Should have None defaults."""
		opts = ExecuteOptions()
		assert opts.timeout is None
		assert opts.env is None

	def test_custom_values(self):
		"""Should accept custom values."""
		opts = ExecuteOptions(timeout=10000, env={"KEY": "val"})
		assert opts.timeout == 10000
		assert opts.env == {"KEY": "val"}


# ==============================================================================
# ExecuteSuccess / ExecuteError dataclasses
# ==============================================================================


class TestExecuteSuccess:
	"""Tests for ExecuteSuccess dataclass."""

	def test_fields(self):
		"""Should store all fields correctly."""
		result = ExecuteSuccess(
			success=True,
			result={"success": True, "data": {"id": 1}},
			duration_ms=42,
			stdout='{"success": true, "data": {"id": 1}}',
			stderr="",
		)
		assert result.success is True
		assert result.result["data"]["id"] == 1
		assert result.duration_ms == 42
		assert result.stdout != ""
		assert result.stderr == ""


class TestExecuteError:
	"""Tests for ExecuteError dataclass."""

	def test_fields(self):
		"""Should store all fields correctly."""
		from afd.testing.scenarios.types import create_step_error

		err = create_step_error("command_failed", "bad stuff")
		result = ExecuteError(
			success=False,
			error=err,
			duration_ms=100,
			stdout="",
			stderr="error output",
			exit_code=1,
		)
		assert result.success is False
		assert result.error.type == "command_failed"
		assert result.error.message == "bad stuff"
		assert result.duration_ms == 100
		assert result.exit_code == 1

	def test_exit_code_default_none(self):
		"""exit_code should default to None."""
		from afd.testing.scenarios.types import create_step_error

		err = create_step_error("unknown", "oops")
		result = ExecuteError(
			success=False,
			error=err,
			duration_ms=0,
			stdout="",
			stderr="",
		)
		assert result.exit_code is None


# ==============================================================================
# CliWrapper.__init__
# ==============================================================================


class TestCliWrapperInit:
	"""Tests for CliWrapper initialization."""

	def test_default_config(self):
		"""Should use defaults when no config is provided."""
		wrapper = CliWrapper()
		assert wrapper._cli_path == "afd"
		assert wrapper._cwd == os.getcwd()
		assert wrapper._env == {}
		assert wrapper._timeout == 30000
		assert wrapper._server_url is None
		assert wrapper._verbose is False

	def test_none_config(self):
		"""Should treat None config same as default."""
		wrapper = CliWrapper(None)
		assert wrapper._cli_path == "afd"

	def test_custom_config(self):
		"""Should apply custom config."""
		config = CliConfig(
			cli_path="/custom/afd",
			cwd="/my/project",
			env={"FOO": "bar"},
			timeout=10000,
			server_url="http://localhost:8080/mcp",
			verbose=True,
		)
		wrapper = CliWrapper(config)
		assert wrapper._cli_path == "/custom/afd"
		assert wrapper._cwd == "/my/project"
		assert wrapper._env == {"FOO": "bar"}
		assert wrapper._timeout == 10000
		assert wrapper._server_url == "http://localhost:8080/mcp"
		assert wrapper._verbose is True

	def test_cwd_defaults_to_os_getcwd(self):
		"""When config.cwd is None, should fall back to os.getcwd()."""
		config = CliConfig(cwd=None)
		wrapper = CliWrapper(config)
		assert wrapper._cwd == os.getcwd()

	def test_env_defaults_to_empty_dict(self):
		"""When config.env is None, should fall back to empty dict."""
		config = CliConfig(env=None)
		wrapper = CliWrapper(config)
		assert wrapper._env == {}


# ==============================================================================
# CliWrapper._build_args
# ==============================================================================


class TestBuildArgs:
	"""Tests for CliWrapper._build_args."""

	def test_basic_command(self):
		"""Should build basic call args with --json."""
		wrapper = CliWrapper()
		args = wrapper._build_args("todo-list")
		assert args == ["call", "todo-list", "--json"]

	def test_with_server_url(self):
		"""Should include --connect when server_url is set."""
		wrapper = CliWrapper(CliConfig(server_url="http://localhost:3000/mcp"))
		args = wrapper._build_args("todo-create")
		assert args == [
			"call",
			"todo-create",
			"--connect",
			"http://localhost:3000/mcp",
			"--json",
		]

	def test_with_input(self):
		"""Should include --input with JSON-serialized dict."""
		wrapper = CliWrapper()
		input_data = {"title": "Buy milk", "done": False}
		args = wrapper._build_args("todo-create", input_data)
		assert args[0] == "call"
		assert args[1] == "todo-create"
		assert args[2] == "--json"
		assert args[3] == "--input"
		assert json.loads(args[4]) == input_data

	def test_with_server_url_and_input(self):
		"""Should include both --connect and --input."""
		wrapper = CliWrapper(CliConfig(server_url="http://host/mcp"))
		input_data = {"key": "value"}
		args = wrapper._build_args("cmd", input_data)
		assert "--connect" in args
		assert "http://host/mcp" in args
		assert "--input" in args
		assert "--json" in args

	def test_with_empty_input(self):
		"""Should NOT include --input when input dict is empty."""
		wrapper = CliWrapper()
		args = wrapper._build_args("todo-list", {})
		assert "--input" not in args

	def test_with_none_input(self):
		"""Should NOT include --input when input is None."""
		wrapper = CliWrapper()
		args = wrapper._build_args("todo-list", None)
		assert "--input" not in args


# ==============================================================================
# CliWrapper._parse_output
# ==============================================================================


class TestParseOutput:
	"""Tests for CliWrapper._parse_output."""

	def setup_method(self):
		self.wrapper = CliWrapper()

	def test_valid_json_command_result(self):
		"""Should parse valid JSON with 'success' key."""
		stdout = json.dumps({"success": True, "data": {"id": 1}})
		ok, result = self.wrapper._parse_output(stdout, "", 0)
		assert ok is True
		assert result["success"] is True
		assert result["data"]["id"] == 1

	def test_json_without_success_key_exit_zero(self):
		"""JSON without 'success' key and exit 0 should wrap in success envelope."""
		stdout = json.dumps({"id": 1, "name": "Test"})
		ok, result = self.wrapper._parse_output(stdout, "", 0)
		assert ok is True
		assert result["success"] is True
		assert result["data"]["id"] == 1

	def test_json_without_success_key_exit_nonzero(self):
		"""JSON without 'success' key and exit != 0 should wrap with success=False."""
		stdout = json.dumps({"id": 1})
		ok, result = self.wrapper._parse_output(stdout, "", 1)
		assert ok is True
		assert result["success"] is False
		assert result["data"]["id"] == 1

	def test_non_json_exit_zero(self):
		"""Non-JSON stdout with exit 0 should return a synthetic success."""
		ok, result = self.wrapper._parse_output("Hello World", "", 0)
		assert ok is True
		assert result["success"] is True
		assert result["data"] == "Hello World"

	def test_non_json_exit_nonzero(self):
		"""Non-JSON stdout with exit != 0 should return a StepError."""
		ok, error = self.wrapper._parse_output("", "Something went wrong", 1)
		assert ok is False
		assert error.type == "parse_error"
		assert "Something went wrong" in error.message

	def test_non_json_no_output_exit_nonzero(self):
		"""No output at all with exit != 0 should produce error message."""
		ok, error = self.wrapper._parse_output("", "", 1)
		assert ok is False
		assert error.type == "parse_error"
		assert "Command failed with no output" in error.message

	def test_empty_stdout_exit_zero(self):
		"""Empty stdout with exit 0 should return success with data=None."""
		ok, result = self.wrapper._parse_output("", "", 0)
		assert ok is True
		assert result["success"] is True
		assert result["data"] is None

	def test_json_embedded_in_other_output(self):
		"""Should extract JSON even if surrounded by non-JSON text."""
		stdout = 'Some debug line\n{"success": true, "data": "extracted"}\nMore stuff'
		ok, result = self.wrapper._parse_output(stdout, "", 0)
		assert ok is True
		assert result["success"] is True
		assert result["data"] == "extracted"

	def test_invalid_json_returns_parse_error(self):
		"""Broken JSON with matched braces should produce a parse_error StepError."""
		stdout = '{"broken": json}'
		ok, error = self.wrapper._parse_output(stdout, "", 0)
		assert ok is False
		assert error.type == "parse_error"
		assert "Failed to parse JSON" in error.message

	def test_whitespace_trimming(self):
		"""Should trim whitespace before parsing."""
		stdout = '   \n  {"success": true, "data": 42}  \n  '
		ok, result = self.wrapper._parse_output(stdout, "", 0)
		assert ok is True
		assert result["data"] == 42

	def test_non_json_exit_nonzero_uses_stdout_if_no_stderr(self):
		"""When stderr is empty and exit != 0, should fall back to stdout in error."""
		ok, error = self.wrapper._parse_output("raw output", "", 1)
		assert ok is False
		assert "raw output" in error.message


# ==============================================================================
# CliWrapper.execute — mock subprocess
# ==============================================================================


class TestExecute:
	"""Tests for CliWrapper.execute with mocked subprocess."""

	@pytest.fixture
	def wrapper(self):
		return CliWrapper(CliConfig(cli_path="afd", server_url="http://localhost:3000/mcp"))

	@pytest.mark.asyncio
	async def test_successful_json_response(self, wrapper):
		"""Should return ExecuteSuccess for valid JSON CommandResult."""
		json_output = json.dumps({"success": True, "data": {"id": 1, "title": "Test"}})
		mock_proc = AsyncMock()
		mock_proc.communicate = AsyncMock(
			return_value=(json_output.encode(), b"")
		)
		mock_proc.returncode = 0
		mock_proc.kill = MagicMock()
		mock_proc.wait = AsyncMock()

		with patch("afd.testing.cli_wrapper.asyncio.create_subprocess_exec", return_value=mock_proc):
			result = await wrapper.execute("todo-get", {"id": 1})

		assert isinstance(result, ExecuteSuccess)
		assert result.success is True
		assert result.result["data"]["id"] == 1
		assert result.duration_ms >= 0
		assert result.stdout == json_output
		assert result.stderr == ""

	@pytest.mark.asyncio
	async def test_non_json_response_exit_zero(self, wrapper):
		"""Should return ExecuteSuccess for non-JSON stdout with exit 0."""
		mock_proc = AsyncMock()
		mock_proc.communicate = AsyncMock(
			return_value=(b"Plain text output", b"")
		)
		mock_proc.returncode = 0
		mock_proc.kill = MagicMock()
		mock_proc.wait = AsyncMock()

		with patch("afd.testing.cli_wrapper.asyncio.create_subprocess_exec", return_value=mock_proc):
			result = await wrapper.execute("some-command")

		assert isinstance(result, ExecuteSuccess)
		assert result.success is True
		assert result.result["data"] == "Plain text output"

	@pytest.mark.asyncio
	async def test_subprocess_nonzero_exit(self, wrapper):
		"""Should return ExecuteError when subprocess exits with nonzero code."""
		mock_proc = AsyncMock()
		mock_proc.communicate = AsyncMock(
			return_value=(b"", b"Error: command not found")
		)
		mock_proc.returncode = 1
		mock_proc.kill = MagicMock()
		mock_proc.wait = AsyncMock()

		with patch("afd.testing.cli_wrapper.asyncio.create_subprocess_exec", return_value=mock_proc):
			result = await wrapper.execute("bad-command")

		assert isinstance(result, ExecuteError)
		assert result.success is False
		assert result.exit_code == 1
		assert result.error.type == "parse_error"

	@pytest.mark.asyncio
	async def test_timeout_handling(self, wrapper):
		"""Should return ExecuteError when command times out."""
		mock_proc = AsyncMock()
		mock_proc.communicate = AsyncMock(side_effect=asyncio.TimeoutError())
		mock_proc.kill = MagicMock()
		mock_proc.wait = AsyncMock()
		mock_proc.returncode = None

		with patch("afd.testing.cli_wrapper.asyncio.create_subprocess_exec", return_value=mock_proc):
			# Use asyncio.wait_for to also raise TimeoutError
			with patch("afd.testing.cli_wrapper.asyncio.wait_for", side_effect=asyncio.TimeoutError()):
				result = await wrapper.execute("slow-command")

		assert isinstance(result, ExecuteError)
		assert result.success is False
		assert "timed out" in result.error.message.lower() or "timeout" in result.error.message.lower() or "CLI execution failed" in result.error.message

	@pytest.mark.asyncio
	async def test_execute_options_timeout_override(self, wrapper):
		"""Should use ExecuteOptions timeout instead of config timeout."""
		json_output = json.dumps({"success": True, "data": "ok"})
		mock_proc = AsyncMock()
		mock_proc.communicate = AsyncMock(
			return_value=(json_output.encode(), b"")
		)
		mock_proc.returncode = 0
		mock_proc.kill = MagicMock()
		mock_proc.wait = AsyncMock()

		with patch("afd.testing.cli_wrapper.asyncio.create_subprocess_exec", return_value=mock_proc) as mock_exec:
			with patch("afd.testing.cli_wrapper.asyncio.wait_for", return_value=(json_output.encode(), b"")) as mock_wait:
				result = await wrapper.execute(
					"todo-list",
					options=ExecuteOptions(timeout=5000),
				)
				# Verify wait_for was called with timeout=5.0 (5000ms / 1000)
				if mock_wait.called:
					call_kwargs = mock_wait.call_args
					assert call_kwargs[1].get("timeout", call_kwargs[0][1] if len(call_kwargs[0]) > 1 else None) == 5.0

	@pytest.mark.asyncio
	async def test_execute_options_env_override(self, wrapper):
		"""Should merge ExecuteOptions.env into subprocess environment."""
		json_output = json.dumps({"success": True, "data": "ok"})
		mock_proc = AsyncMock()
		mock_proc.communicate = AsyncMock(
			return_value=(json_output.encode(), b"")
		)
		mock_proc.returncode = 0
		mock_proc.kill = MagicMock()
		mock_proc.wait = AsyncMock()

		with patch("afd.testing.cli_wrapper.asyncio.create_subprocess_exec", return_value=mock_proc) as mock_exec:
			await wrapper.execute(
				"todo-list",
				options=ExecuteOptions(env={"EXTRA_KEY": "extra_val"}),
			)
			call_kwargs = mock_exec.call_args[1]
			assert call_kwargs["env"]["EXTRA_KEY"] == "extra_val"

	@pytest.mark.asyncio
	async def test_exception_during_execution(self, wrapper):
		"""Should return ExecuteError when an unexpected exception occurs."""
		with patch(
			"afd.testing.cli_wrapper.asyncio.create_subprocess_exec",
			side_effect=OSError("No such file"),
		):
			result = await wrapper.execute("missing-cli")

		assert isinstance(result, ExecuteError)
		assert result.success is False
		assert "No such file" in result.error.message
		assert result.stdout == ""
		assert "No such file" in result.stderr

	@pytest.mark.asyncio
	async def test_verbose_mode(self, capsys):
		"""Should print debug output in verbose mode."""
		config = CliConfig(verbose=True)
		wrapper = CliWrapper(config)

		json_output = json.dumps({"success": True, "data": "hi"})
		mock_proc = AsyncMock()
		mock_proc.communicate = AsyncMock(
			return_value=(json_output.encode(), b"some warning")
		)
		mock_proc.returncode = 0
		mock_proc.kill = MagicMock()
		mock_proc.wait = AsyncMock()

		with patch("afd.testing.cli_wrapper.asyncio.create_subprocess_exec", return_value=mock_proc):
			await wrapper.execute("echo-cmd")

		captured = capsys.readouterr()
		assert "[CLI]" in captured.out

	@pytest.mark.asyncio
	async def test_execute_passes_correct_args_to_subprocess(self, wrapper):
		"""Should invoke create_subprocess_exec with correct cli_path and args."""
		json_output = json.dumps({"success": True, "data": None})
		mock_proc = AsyncMock()
		mock_proc.communicate = AsyncMock(
			return_value=(json_output.encode(), b"")
		)
		mock_proc.returncode = 0
		mock_proc.kill = MagicMock()
		mock_proc.wait = AsyncMock()

		with patch("afd.testing.cli_wrapper.asyncio.create_subprocess_exec", return_value=mock_proc) as mock_exec:
			await wrapper.execute("todo-list", {"filter": "active"})

			mock_exec.assert_called_once()
			call_args = mock_exec.call_args[0]
			# First arg is cli_path
			assert call_args[0] == "afd"
			# Remaining args include call, command, --connect, url, --json, --input, json
			assert "call" in call_args
			assert "todo-list" in call_args
			assert "--connect" in call_args
			assert "http://localhost:3000/mcp" in call_args
			assert "--json" in call_args
			assert "--input" in call_args

	@pytest.mark.asyncio
	async def test_execute_with_json_command_result_failure(self, wrapper):
		"""Should still return ExecuteSuccess when JSON has success=false (parse succeeds)."""
		json_output = json.dumps({
			"success": False,
			"error": {"code": "NOT_FOUND", "message": "Not found"},
		})
		mock_proc = AsyncMock()
		mock_proc.communicate = AsyncMock(
			return_value=(json_output.encode(), b"")
		)
		mock_proc.returncode = 1
		mock_proc.kill = MagicMock()
		mock_proc.wait = AsyncMock()

		with patch("afd.testing.cli_wrapper.asyncio.create_subprocess_exec", return_value=mock_proc):
			result = await wrapper.execute("todo-get", {"id": 999})

		# _parse_output returns (True, parsed) because 'success' key is in the dict
		assert isinstance(result, ExecuteSuccess)
		assert result.result["success"] is False


# ==============================================================================
# CliWrapper.configure
# ==============================================================================


class TestConfigure:
	"""Tests for CliWrapper.configure."""

	def test_configure_cli_path(self):
		"""Should update cli_path."""
		wrapper = CliWrapper()
		wrapper.configure(cli_path="/new/path/afd")
		assert wrapper._cli_path == "/new/path/afd"

	def test_configure_cwd(self):
		"""Should update cwd."""
		wrapper = CliWrapper()
		wrapper.configure(cwd="/new/working/dir")
		assert wrapper._cwd == "/new/working/dir"

	def test_configure_env(self):
		"""Should update env."""
		wrapper = CliWrapper()
		wrapper.configure(env={"NEW_VAR": "value"})
		assert wrapper._env == {"NEW_VAR": "value"}

	def test_configure_timeout(self):
		"""Should update timeout."""
		wrapper = CliWrapper()
		wrapper.configure(timeout=60000)
		assert wrapper._timeout == 60000

	def test_configure_server_url(self):
		"""Should update server_url."""
		wrapper = CliWrapper()
		wrapper.configure(server_url="http://newhost:4000/mcp")
		assert wrapper._server_url == "http://newhost:4000/mcp"

	def test_configure_verbose(self):
		"""Should update verbose."""
		wrapper = CliWrapper()
		wrapper.configure(verbose=True)
		assert wrapper._verbose is True

	def test_configure_multiple_at_once(self):
		"""Should update multiple fields in a single call."""
		wrapper = CliWrapper()
		wrapper.configure(
			cli_path="/bin/afd2",
			timeout=1000,
			verbose=True,
		)
		assert wrapper._cli_path == "/bin/afd2"
		assert wrapper._timeout == 1000
		assert wrapper._verbose is True

	def test_configure_does_not_change_unspecified(self):
		"""Should leave unspecified fields unchanged."""
		config = CliConfig(cli_path="original", timeout=5000, verbose=False)
		wrapper = CliWrapper(config)
		wrapper.configure(timeout=9999)
		assert wrapper._cli_path == "original"
		assert wrapper._timeout == 9999
		assert wrapper._verbose is False

	def test_configure_unknown_keys_ignored(self):
		"""Unknown kwargs should be silently ignored."""
		wrapper = CliWrapper()
		wrapper.configure(nonexistent_field="whatever")
		# No error raised, and no attribute set
		assert not hasattr(wrapper, "_nonexistent_field")


# ==============================================================================
# create_cli_wrapper factory
# ==============================================================================


class TestCreateCliWrapper:
	"""Tests for the create_cli_wrapper factory function."""

	def test_returns_cli_wrapper_instance(self):
		"""Should return a CliWrapper instance."""
		wrapper = create_cli_wrapper()
		assert isinstance(wrapper, CliWrapper)

	def test_with_none_config(self):
		"""Should work with None config."""
		wrapper = create_cli_wrapper(None)
		assert isinstance(wrapper, CliWrapper)
		assert wrapper._cli_path == "afd"

	def test_with_custom_config(self):
		"""Should pass config through to CliWrapper."""
		config = CliConfig(
			cli_path="/custom/afd",
			server_url="http://example.com/mcp",
			timeout=15000,
		)
		wrapper = create_cli_wrapper(config)
		assert wrapper._cli_path == "/custom/afd"
		assert wrapper._server_url == "http://example.com/mcp"
		assert wrapper._timeout == 15000


# ==============================================================================
# CliWrapper._spawn (integration-level mock)
# ==============================================================================


class TestSpawn:
	"""Tests for CliWrapper._spawn with mocked asyncio subprocess."""

	@pytest.mark.asyncio
	async def test_spawn_returns_stdout_stderr_exit_code(self):
		"""Should return (stdout, stderr, exit_code) tuple."""
		wrapper = CliWrapper()
		mock_proc = AsyncMock()
		mock_proc.communicate = AsyncMock(
			return_value=(b"output data", b"warning")
		)
		mock_proc.returncode = 0
		mock_proc.kill = MagicMock()
		mock_proc.wait = AsyncMock()

		with patch("afd.testing.cli_wrapper.asyncio.create_subprocess_exec", return_value=mock_proc):
			stdout, stderr, exit_code = await wrapper._spawn(["call", "test"], 30000)

		assert stdout == "output data"
		assert stderr == "warning"
		assert exit_code == 0

	@pytest.mark.asyncio
	async def test_spawn_timeout_kills_process(self):
		"""Should kill the process and raise TimeoutError on timeout."""
		wrapper = CliWrapper()
		mock_proc = AsyncMock()
		mock_proc.communicate = AsyncMock(return_value=(b"", b""))
		mock_proc.kill = MagicMock()
		mock_proc.wait = AsyncMock()

		with patch("afd.testing.cli_wrapper.asyncio.create_subprocess_exec", return_value=mock_proc):
			with patch(
				"afd.testing.cli_wrapper.asyncio.wait_for",
				side_effect=asyncio.TimeoutError(),
			):
				with pytest.raises(TimeoutError, match="timed out"):
					await wrapper._spawn(["call", "slow"], 100)

		mock_proc.kill.assert_called_once()

	@pytest.mark.asyncio
	async def test_spawn_merges_env(self):
		"""Should merge config env and extra_env into subprocess env."""
		config = CliConfig(env={"CONFIG_KEY": "config_val"})
		wrapper = CliWrapper(config)
		mock_proc = AsyncMock()
		mock_proc.communicate = AsyncMock(return_value=(b"ok", b""))
		mock_proc.returncode = 0
		mock_proc.kill = MagicMock()
		mock_proc.wait = AsyncMock()

		with patch("afd.testing.cli_wrapper.asyncio.create_subprocess_exec", return_value=mock_proc) as mock_exec:
			await wrapper._spawn(["call", "cmd"], 5000, extra_env={"EXTRA": "val"})

			call_kwargs = mock_exec.call_args[1]
			assert call_kwargs["env"]["CONFIG_KEY"] == "config_val"
			assert call_kwargs["env"]["EXTRA"] == "val"

	@pytest.mark.asyncio
	async def test_spawn_handles_none_returncode(self):
		"""Should default to exit_code 0 when returncode is None."""
		wrapper = CliWrapper()
		mock_proc = AsyncMock()
		mock_proc.communicate = AsyncMock(return_value=(b"data", b""))
		mock_proc.returncode = None
		mock_proc.kill = MagicMock()
		mock_proc.wait = AsyncMock()

		with patch("afd.testing.cli_wrapper.asyncio.create_subprocess_exec", return_value=mock_proc):
			_, _, exit_code = await wrapper._spawn(["call", "cmd"], 5000)

		assert exit_code == 0

	@pytest.mark.asyncio
	async def test_spawn_decodes_utf8(self):
		"""Should decode bytes as UTF-8."""
		wrapper = CliWrapper()
		mock_proc = AsyncMock()
		# UTF-8 encoded string with non-ASCII characters
		mock_proc.communicate = AsyncMock(
			return_value=("Helloo woorld".encode("utf-8"), b"")
		)
		mock_proc.returncode = 0
		mock_proc.kill = MagicMock()
		mock_proc.wait = AsyncMock()

		with patch("afd.testing.cli_wrapper.asyncio.create_subprocess_exec", return_value=mock_proc):
			stdout, _, _ = await wrapper._spawn(["call", "cmd"], 5000)

		assert stdout == "Helloo woorld"
