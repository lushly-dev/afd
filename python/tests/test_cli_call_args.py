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


def test_a_json_array_is_a_malformed_pair_as_in_typescript(transport):
    # Only text that starts with "{" is read as JSON, so "[1]" is a pair without a key.
    outcome = CliRunner().invoke(cli, ["call", "todo-create", "[1]", "-s", "http://x/mcp"])
    assert outcome.exit_code == 1
    assert 'Invalid arguments (Expected key=value, got "[1]")' in outcome.output
    transport.connect.assert_not_awaited()


@pytest.mark.parametrize("raw", ["", "   "])
def test_an_empty_argument_calls_with_no_input_as_in_typescript(transport, raw):
    outcome = CliRunner().invoke(cli, ["call", "todo-create", raw, "-s", "http://x/mcp"])
    assert outcome.exit_code == 0, outcome.output
    transport.call_tool.assert_awaited_once_with("todo-create", {})


def test_several_pairs_go_in_one_argument(transport):
    outcome = CliRunner().invoke(cli, ["call", "todo-create", 'title="Buy milk"', "priority=2"])
    assert outcome.exit_code == 2  # a second argument is refused, as Commander refuses it
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


@pytest.mark.parametrize(
    ("flags", "env", "source"),
    [
        (["-H", "Authorization Bearer sk-SECRET"], "", "--header 1"),
        (["-H", "X-Ok: 1", "-H", "Bad Name: sk-SECRET"], "", "--header 2"),
        ([], "X-Ok: 1\nAuthorisation Bearer sk-SECRET", "AFD_HEADERS line 2"),
    ],
)
def test_a_malformed_header_exits_1_without_showing_its_value(transport, monkeypatch, flags, env, source):
    monkeypatch.setenv("AFD_HEADERS", env)
    outcome = CliRunner().invoke(cli, ["call", "todo-create", "-s", "http://x/mcp", *flags])
    assert outcome.exit_code == 1
    assert f"{source}: Invalid header" in outcome.output
    assert "SECRET" not in outcome.output
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


def test_connect_does_not_save_headers_and_says_so(transport):
    outcome = CliRunner().invoke(cli, ["connect", "http://x/mcp", "-H", "Authorization: Bearer secret"])
    assert "secret" not in _cli_main.STATE_FILE.read_text()
    assert "Request headers are not saved." in outcome.output
    assert "secret" not in outcome.output


def test_connect_passes_its_timeout_and_refuses_one_that_is_not_positive(transport):
    assert CliRunner().invoke(cli, ["connect", "http://x/mcp", "-t", "2"]).exit_code == 0
    assert transport.calls[-1]["timeout"] == 2.0
    assert CliRunner().invoke(cli, ["connect", "http://x/mcp", "-t", "-1"]).exit_code == 2


def test_environment_headers_never_reach_an_in_process_module(transport, monkeypatch, tmp_path):
    monkeypatch.setenv("AFD_HEADERS", "Authorization: Bearer env-secret")
    module = tmp_path / "commands.py"
    module.write_text(
        "import os\n"
        "from afd import create_direct_registry, success\n"
        "from afd.server import define_command\n"
        "@define_command(name='todo-create', description='Create')\n"
        "async def create(input):\n"
        "    return success({'ran': True})\n"
        "registry = create_direct_registry([create])\n"
    )
    outcome = CliRunner().invoke(cli, ["--json", "call", "todo-create", "--module", str(module)])
    assert outcome.exit_code == 0, outcome.output
    assert '"ran": true' in outcome.output
    assert "env-secret" not in outcome.output
    assert transport.calls == []  # no transport, so no headers were resolved for one


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
