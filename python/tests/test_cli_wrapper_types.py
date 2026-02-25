"""Tests for AFD CLI wrapper data types, initialization, argument building, and output parsing."""

from __future__ import annotations

import json
import os

from afd.testing.cli_wrapper import (
	CliConfig,
	CliWrapper,
	ExecuteError,
	ExecuteOptions,
	ExecuteSuccess,
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
