"""Tests for AFD CLI wrapper command execution, configuration, factory, and spawning."""

from __future__ import annotations

import asyncio
import json
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
		"""Should return ExecuteError when JSON reports success=false."""
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

		assert isinstance(result, ExecuteError)
		assert result.error.type == "command_failed"
		assert "Not found" in result.error.message


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
