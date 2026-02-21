"""Tests for the AFD CLI module."""

import json
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch, MagicMock

import pytest
from click.testing import CliRunner

# Import to ensure module is loaded
import afd.cli.main  # noqa: F401
from afd.cli.main import cli, _load_state, _save_state
from afd.cli.output import (
    print_error,
    print_result,
    print_success,
    print_tools,
    print_warning,
    _create_confidence_bar,
)
from afd.transports import ToolInfo

# Get the actual module from sys.modules (avoids shadowing by __init__.py)
_cli_main_module = sys.modules["afd.cli.main"]


# ==============================================================================
# Fixtures
# ==============================================================================

@pytest.fixture
def runner():
    """Create a CLI test runner."""
    return CliRunner()


@pytest.fixture
def temp_state_file(tmp_path, monkeypatch):
    """Use a temporary state file."""
    state_file = tmp_path / ".afd" / "state.json"
    # Use sys.modules to get the actual module object
    monkeypatch.setattr(_cli_main_module, "STATE_FILE", state_file)
    return state_file


@pytest.fixture
def mock_transport():
    """Create a mock transport."""
    transport = MagicMock()
    transport.connect = AsyncMock()
    transport.disconnect = AsyncMock()
    transport.list_tools = AsyncMock(return_value=[
        ToolInfo(name="user-create", description="Create a user"),
        ToolInfo(name="user-list", description="List users"),
        ToolInfo(name="doc-get", description="Get a document"),
    ])
    transport.call_tool = AsyncMock(return_value={
        "success": True,
        "data": {"id": "123", "name": "Test"},
    })
    return transport


# ==============================================================================
# State Management Tests
# ==============================================================================

class TestStateManagement:
    """Tests for CLI state persistence."""

    def test_load_state_empty(self, temp_state_file):
        """Should return empty dict when no state file exists."""
        state = _load_state()
        assert state == {}

    def test_save_and_load_state(self, temp_state_file):
        """Should persist state to disk."""
        _save_state({"server": "test-server"})
        state = _load_state()
        assert state == {"server": "test-server"}

    def test_load_state_invalid_json(self, temp_state_file):
        """Should return empty dict for invalid JSON."""
        temp_state_file.parent.mkdir(parents=True, exist_ok=True)
        temp_state_file.write_text("not valid json")
        state = _load_state()
        assert state == {}


# ==============================================================================
# CLI Command Tests
# ==============================================================================

class TestConnectCommand:
    """Tests for the connect command."""

    def test_connect_mock_server(self, runner, temp_state_file):
        """Should connect to mock server."""
        result = runner.invoke(cli, ["connect", "mock"])
        assert result.exit_code == 0
        assert "Connected" in result.output

    def test_connect_saves_state(self, runner, temp_state_file):
        """Should save server to state file."""
        runner.invoke(cli, ["connect", "mock"])
        state = _load_state()
        assert state.get("server") == "mock"

    def test_connect_quiet_mode(self, runner, temp_state_file):
        """Should suppress output in quiet mode."""
        result = runner.invoke(cli, ["-q", "connect", "mock"])
        assert result.exit_code == 0
        assert result.output == ""


class TestDisconnectCommand:
    """Tests for the disconnect command."""

    def test_disconnect_clears_state(self, runner, temp_state_file):
        """Should clear saved connection state."""
        _save_state({"server": "test-server"})
        result = runner.invoke(cli, ["disconnect"])
        assert result.exit_code == 0
        state = _load_state()
        assert state.get("server") is None

    def test_disconnect_no_connection(self, runner, temp_state_file):
        """Should handle no active connection gracefully."""
        result = runner.invoke(cli, ["disconnect"])
        assert result.exit_code == 0
        assert "No active connection" in result.output


class TestStatusCommand:
    """Tests for the status command."""

    def test_status_connected(self, runner, temp_state_file):
        """Should show connected server."""
        _save_state({"server": "test-server"})
        result = runner.invoke(cli, ["status"])
        assert result.exit_code == 0
        assert "test-server" in result.output

    def test_status_not_connected(self, runner, temp_state_file):
        """Should indicate no connection."""
        result = runner.invoke(cli, ["status"])
        assert result.exit_code == 0
        assert "Not connected" in result.output

    def test_status_json_output(self, runner, temp_state_file):
        """Should output JSON when --json flag is used."""
        _save_state({"server": "test-server"})
        result = runner.invoke(cli, ["--json", "status"])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert data["connected"] is True
        assert data["server"] == "test-server"


class TestToolsCommand:
    """Tests for the tools command."""

    def test_tools_list(self, runner, temp_state_file):
        """Should list available tools."""
        _save_state({"server": "mock"})
        
        # Create a pre-configured mock transport with tools
        mock_transport = MagicMock()
        mock_transport.connect = AsyncMock()
        mock_transport.disconnect = AsyncMock()
        mock_transport.list_tools = AsyncMock(return_value=[
            ToolInfo(name="user-create", description="Create a user"),
            ToolInfo(name="user-list", description="List all users"),
        ])
        
        with patch.object(_cli_main_module, "_get_transport", return_value=mock_transport):
            result = runner.invoke(cli, ["tools", "-s", "mock"])
        
        assert result.exit_code == 0
        assert "Available Tools" in result.output
        assert "user-create" in result.output

    def test_tools_no_connection(self, runner, temp_state_file):
        """Should error when not connected."""
        result = runner.invoke(cli, ["tools"])
        assert result.exit_code == 1
        assert "No server connected" in result.output


class TestCallCommand:
    """Tests for the call command."""

    def test_call_with_server(self, runner, temp_state_file, mock_transport):
        """Should call tool on specified server."""
        with patch("afd.cli.main._get_transport", return_value=mock_transport):
            result = runner.invoke(cli, ["call", "user-create", '{"name": "Alice"}', "-s", "mock"])
            assert result.exit_code == 0
            mock_transport.call_tool.assert_called_once()

    def test_call_invalid_json(self, runner, temp_state_file):
        """Should error on invalid JSON args."""
        _save_state({"server": "mock"})
        result = runner.invoke(cli, ["call", "user-create", "not json"])
        assert result.exit_code == 1
        assert "Invalid JSON" in result.output

    def test_call_default_empty_args(self, runner, temp_state_file, mock_transport):
        """Should use empty object for missing args."""
        with patch("afd.cli.main._get_transport", return_value=mock_transport):
            result = runner.invoke(cli, ["call", "user-list", "-s", "mock"])
            assert result.exit_code == 0
            mock_transport.call_tool.assert_called_once_with("user-list", {})


class TestValidateCommand:
    """Tests for the validate command."""

    def test_validate_mock_server(self, runner, temp_state_file):
        """Should validate mock server connection."""
        _save_state({"server": "mock"})
        result = runner.invoke(cli, ["validate", "-s", "mock"])
        assert result.exit_code == 0
        assert "OK" in result.output or "passed" in result.output


# ==============================================================================
# Output Formatting Tests
# ==============================================================================

class TestOutputFormatting:
    """Tests for Rich output formatting."""

    def test_confidence_bar_high(self):
        """Should show green for high confidence."""
        bar = _create_confidence_bar(0.9)
        assert "green" in bar
        assert "█" in bar

    def test_confidence_bar_medium(self):
        """Should show yellow for medium confidence."""
        bar = _create_confidence_bar(0.6)
        assert "yellow" in bar

    def test_confidence_bar_low(self):
        """Should show red for low confidence."""
        bar = _create_confidence_bar(0.3)
        assert "red" in bar

    def test_print_tools_empty(self, capsys):
        """Should handle empty tool list."""
        # This test just ensures no crash
        print_tools([])
        # Output goes to Rich console, not stdout


class TestPrintResult:
    """Tests for print_result function."""

    def test_print_success_result(self, capsys):
        """Should print successful result."""
        result = {
            "success": True,
            "data": {"id": "123"},
        }
        print_result(result)
        # Rich output - just verify no crash

    def test_print_error_result(self, capsys):
        """Should print error result."""
        result = {
            "success": False,
            "error": {
                "code": "NOT_FOUND",
                "message": "Item not found",
                "suggestion": "Check the ID",
            },
        }
        print_result(result)
        # Rich output - just verify no crash

    def test_print_result_json_mode(self, capsys):
        """Should output raw JSON in json mode."""
        result = {
            "success": True,
            "data": {"id": "123"},
        }
        print_result(result, json_output=True)
        # JSON output goes to console


# ==============================================================================
# Integration Tests
# ==============================================================================

class TestCLIIntegration:
    """Integration tests for CLI workflows."""

    def test_full_workflow(self, runner, temp_state_file):
        """Should support full connect->tools->disconnect workflow."""
        # Connect
        result = runner.invoke(cli, ["connect", "mock"])
        assert result.exit_code == 0

        # Check status
        result = runner.invoke(cli, ["status"])
        assert "mock" in result.output

        # List tools
        result = runner.invoke(cli, ["tools", "-s", "mock"])
        assert result.exit_code == 0

        # Disconnect
        result = runner.invoke(cli, ["disconnect"])
        assert result.exit_code == 0

        # Status should show disconnected
        result = runner.invoke(cli, ["status"])
        assert "Not connected" in result.output

    def test_version_flag(self, runner):
        """Should show version."""
        result = runner.invoke(cli, ["--version"])
        assert result.exit_code == 0
        assert "0.1.0" in result.output or "version" in result.output.lower()

    def test_help_flag(self, runner):
        """Should show help."""
        result = runner.invoke(cli, ["--help"])
        assert result.exit_code == 0
        assert "AFD" in result.output
        assert "connect" in result.output
        assert "tools" in result.output
        assert "call" in result.output


class TestCLIErrorHandling:
    """Tests for CLI error handling."""

    def test_call_without_connection(self, runner, temp_state_file):
        """Should error when calling without connection."""
        result = runner.invoke(cli, ["call", "user-create", "{}"])
        assert result.exit_code == 1
        assert "No server connected" in result.output

    def test_unknown_command(self, runner):
        """Should error on unknown command."""
        result = runner.invoke(cli, ["unknown"])
        assert result.exit_code == 2  # Click's "no such command" code
