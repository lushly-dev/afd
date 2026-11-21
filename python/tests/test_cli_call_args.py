"""``afd call``, ``tools``, ``validate``, ``connect`` and ``shell`` take TypeScript's
``key=value`` arguments and ``-H``/``AFD_HEADERS`` request headers (#1822), as
``packages/cli/src/args.ts`` and ``credentials.ts``."""

import sys
from unittest.mock import AsyncMock, MagicMock

import pytest
from click.testing import CliRunner

import afd.cli.main  # noqa: F401
from afd.cli.main import cli
from afd.transports import ToolInfo

_cli_main = sys.modules["afd.cli.main"]


@pytest.fixture
def transport(monkeypatch, tmp_path):
    monkeypatch.setattr(_cli_main, "STATE_FILE", tmp_path / ".afd" / "state.json")
    monkeypatch.delenv("AFD_HEADERS", raising=False)
    fake = MagicMock()
    fake.connect = AsyncMock()
    fake.disconnect = AsyncMock()
    fake.list_tools = AsyncMock(return_value=[ToolInfo(name="todo-create", description="Create")])
    fake.call_tool = AsyncMock(return_value={"success": True, "data": {"ok": True}})
    fake.calls = []

    def get_transport(server=None, **options):
        fake.calls.append({"server": server, **options})
        return fake

    monkeypatch.setattr(_cli_main, "_get_transport", get_transport)
    return fake


def test_call_takes_key_value_pairs(transport):
    outcome = CliRunner().invoke(
        cli, ["call", "todo-create", 'title="Buy milk" count=2 done=false', "-s", "http://x/mcp"]
    )
    assert outcome.exit_code == 0, outcome.output
    transport.call_tool.assert_awaited_once_with(
        "todo-create", {"title": "Buy milk", "count": 2, "done": False}
    )


def test_call_still_takes_a_json_object(transport):
    outcome = CliRunner().invoke(cli, ["call", "todo-create", '{"title": "Buy  milk"}', "-s", "http://x/mcp"])
    assert outcome.exit_code == 0, outcome.output
    transport.call_tool.assert_awaited_once_with("todo-create", {"title": "Buy  milk"})


def test_call_refuses_a_json_value_that_is_not_an_object(transport):
    outcome = CliRunner().invoke(cli, ["call", "todo-create", "[1]", "-s", "http://x/mcp"])
    assert outcome.exit_code == 1
    assert "Use a JSON object or key=value pairs." in outcome.output
    transport.connect.assert_not_awaited()


def test_call_sends_headers_from_the_flags_and_the_environment(transport, monkeypatch):
    monkeypatch.setenv("AFD_HEADERS", "Authorization: Bearer env\nX-Trace: 1")
    outcome = CliRunner().invoke(
        cli, ["call", "todo-create", "-s", "http://x/mcp", "-H", "authorization: Bearer flag"]
    )
    assert outcome.exit_code == 0, outcome.output
    assert transport.calls[-1]["headers"] == {"authorization": "Bearer flag", "X-Trace": "1"}


def test_call_refuses_headers_for_an_in_process_module(transport, tmp_path):
    module = tmp_path / "commands.py"
    module.write_text("registry = None\n")
    outcome = CliRunner().invoke(cli, ["call", "todo-create", "--module", str(module), "-H", "A: b"])
    assert outcome.exit_code == 2
    assert "--header needs a server" in outcome.output


def test_a_malformed_header_is_a_usage_error(transport):
    outcome = CliRunner().invoke(cli, ["call", "todo-create", "-s", "http://x/mcp", "-H", "Bad Name: x"])
    assert outcome.exit_code == 2
    assert 'Invalid header "Bad Name: x"' in outcome.output
    transport.connect.assert_not_awaited()


@pytest.mark.parametrize(
    "command",
    [
        ["tools", "-s", "http://x/mcp"],
        ["validate", "-s", "http://x/mcp"],
        ["connect", "http://x/mcp"],
    ],
)
def test_other_commands_send_headers_too(transport, command):
    outcome = CliRunner().invoke(cli, [*command, "-H", "X-Api-Key: k"])
    assert outcome.exit_code == 0, outcome.output
    assert transport.calls[-1]["headers"] == {"X-Api-Key": "k"}


def test_connect_does_not_save_headers(transport):
    CliRunner().invoke(cli, ["connect", "http://x/mcp", "-H", "Authorization: Bearer secret"])
    assert "secret" not in _cli_main.STATE_FILE.read_text()


def test_a_call_error_prints_server_text_without_escapes_or_markup(transport):
    transport.call_tool.side_effect = RuntimeError("bad \x1b]0;owned\x07[/x] input")
    outcome = CliRunner().invoke(cli, ["call", "todo-create", "-s", "http://x/mcp"])
    assert outcome.exit_code == 1
    assert "bad [/x] input" in outcome.output
    assert "\x1b" not in outcome.output


def test_the_shell_takes_key_value_pairs_and_survives_bad_arguments(transport, monkeypatch):
    _cli_main._save_state({"server": "http://x/mcp"})
    lines = iter(["call todo-create {bad", "call todo-create title=milk", "exit"])
    monkeypatch.setattr("rich.prompt.Prompt.ask", lambda *args, **kwargs: next(lines))
    outcome = CliRunner().invoke(cli, ["shell", "-H", "X-Api-Key: k"])
    assert outcome.exit_code == 0, outcome.output
    assert "Use a JSON object or key=value pairs." in outcome.output
    transport.call_tool.assert_awaited_once_with("todo-create", {"title": "milk"})
    assert transport.calls[-1]["headers"] == {"X-Api-Key": "k"}
