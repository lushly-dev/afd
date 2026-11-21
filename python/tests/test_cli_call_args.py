"""``afd call``, ``tools``, ``validate``, ``connect`` and ``shell`` take TypeScript's
``key=value`` arguments and ``-H``/``AFD_HEADERS`` request headers (#1822), as
``packages/cli/src/args.ts`` and ``credentials.ts``."""

import json
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
        ([], "X-Ok: 1\n\nAuthorisation Bearer sk-SECRET", "AFD_HEADERS line 3"),
        (["-H", "Authorization: Bearer sk-\x0bSECRET"], "", "--header 1"),
        (["-H", "Authorization: Bearer sk-SECRET\rX: y"], "", "--header 1"),
        (["-H", "sk-SECRET: a\x00b"], "", "--header 1"),
        (["-H", "X: sk-\u2028SECRET"], "", "--header 1"),
        ([], "Authorization: Bearer sk-\x0bSECRET", "AFD_HEADERS line 1"),
    ],
)
def test_a_malformed_header_exits_1_without_showing_its_value(transport, monkeypatch, flags, env, source):
    monkeypatch.setenv("AFD_HEADERS", env)
    outcome = CliRunner().invoke(cli, ["call", "todo-create", "-s", "http://x/mcp", *flags])
    assert outcome.exit_code == 1
    assert f"{source}: Invalid header" in outcome.output
    assert "SECRET" not in outcome.output
    transport.connect.assert_not_awaited()


def test_a_header_value_may_hold_tabs_and_latin_1(transport):
    outcome = CliRunner().invoke(cli, ["call", "x", "-s", "http://x/mcp", "-H", "X-Note: a\tb caf\xe9"])
    assert outcome.exit_code == 0, outcome.output
    assert transport.calls[-1]["headers"] == {"X-Note": "a\tb caf\xe9"}


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
    for bad in ("-1", "0", "nan", "inf"):
        assert CliRunner().invoke(cli, ["connect", "http://x/mcp", "-t", bad]).exit_code == 2
    assert all(call["timeout"] == 2.0 for call in transport.calls)


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


def _shell(transport, monkeypatch, *lines):
    _cli_main._save_state({"server": "http://x/mcp"})
    feed = iter([*lines, "exit"])
    monkeypatch.setattr("rich.prompt.Prompt.ask", lambda *args, **kwargs: next(feed))
    return CliRunner().invoke(cli, ["shell"])


def test_a_failed_call_prints_its_error_and_the_shell_continues(transport, monkeypatch):
    """#1835, as TypeScript's shell: a failed request does not end the shell."""
    transport.call_tool.side_effect = [RuntimeError("lost \x1b]0;owned\x07[/x] link"), {"success": True}]
    outcome = _shell(transport, monkeypatch, "call todo-create", "call todo-create title=milk")
    assert outcome.exit_code == 0, outcome.output
    assert "Call failed: lost [/x] link" in outcome.output
    assert "\x1b" not in outcome.output
    assert transport.call_tool.await_count == 2
    assert "Goodbye!" in outcome.output


def test_a_failed_tools_listing_prints_its_error_and_the_shell_continues(transport, monkeypatch):
    transport.list_tools.side_effect = [OSError("reset"), [ToolInfo(name="todo-create", description="Create")]]
    outcome = _shell(transport, monkeypatch, "tools", "tools")
    assert outcome.exit_code == 0, outcome.output
    assert "Listing tools failed: reset" in outcome.output
    assert "todo-create" in outcome.output


@pytest.mark.parametrize("line", ["call", "call   "])
def test_call_without_a_name_prints_its_usage(transport, monkeypatch, line):
    outcome = _shell(transport, monkeypatch, line)
    assert outcome.exit_code == 0, outcome.output
    assert "Usage: call <name> [args]" in outcome.output
    transport.call_tool.assert_not_awaited()


def test_an_unknown_command_with_markup_is_printed_literally(transport, monkeypatch):
    outcome = _shell(transport, monkeypatch, "frobnicate [/x] [bold]")
    assert outcome.exit_code == 0, outcome.output
    assert "Unknown command: frobnicate [/x] [bold]" in outcome.output


def test_a_failed_result_with_markup_does_not_end_the_shell(transport, monkeypatch):
    transport.call_tool.return_value = {
        "success": False,
        "error": {"code": "BAD [x]", "message": "bad [/x] arg :smile:", "suggestion": "fix \x1b]0;t\x07[/b]"},
    }
    outcome = _shell(transport, monkeypatch, "call todo-create", "exit")
    assert outcome.exit_code == 0, outcome.output
    assert "bad [/x] arg :smile:" in outcome.output
    assert "fix [/b]" in outcome.output
    assert "\x1b" not in outcome.output
    assert "Call failed" not in outcome.output


def test_afd_call_prints_a_failed_result_with_markup_literally(transport):
    transport.call_tool.return_value = {
        "success": False,
        "error": {"code": "E", "message": "see [/x] :smile:", "suggestion": "[bold]retry"},
    }
    outcome = CliRunner().invoke(cli, ["call", "todo-create", "-s", "http://x/mcp"])
    assert "see [/x] :smile:" in outcome.output
    assert "[bold]retry" in outcome.output


def test_tools_with_markup_in_a_description_are_listed_as_written(transport, monkeypatch):
    transport.list_tools.return_value = [ToolInfo(name="todo-[x]", description="See [/example] :smile:")]
    outcome = _shell(transport, monkeypatch, "tools")
    assert "Listing tools failed" not in outcome.output
    assert "See [/example] :smile:" in outcome.output
    assert "todo-[x]" in outcome.output
    listing = CliRunner().invoke(cli, ["tools", "-s", "http://x/mcp"])
    assert listing.exit_code == 0, listing.output
    assert "See [/example] :smile:" in listing.output


def test_call_followed_by_a_tab_is_a_call(transport, monkeypatch):
    outcome = _shell(transport, monkeypatch, "call\ttodo-create title=milk")
    assert outcome.exit_code == 0, outcome.output
    transport.call_tool.assert_awaited_once_with("todo-create", {"title": "milk"})


def test_an_unknown_command_keeps_emoji_codes_literal(transport, monkeypatch):
    outcome = _shell(transport, monkeypatch, "unknown :smile:")
    assert "Unknown command: unknown :smile:" in outcome.output


@pytest.mark.parametrize("command", [["--json", "tools"], ["--json", "tools", "--detail", "todo-[x]"]])
def test_json_output_keeps_server_text_exact(transport, command):
    transport.list_tools.return_value = [ToolInfo(name="todo-[x]", description="See [/example] :smile:")]
    outcome = CliRunner().invoke(cli, [*command, "-s", "http://x/mcp"])
    assert outcome.exit_code == 0, outcome.output
    assert "See [/example] :smile:" in json.loads(outcome.output).__repr__()


def test_status_json_keeps_the_saved_server_exact(transport):
    _cli_main._save_state({"server": "http://x/mcp?q=:smile:"})
    outcome = CliRunner().invoke(cli, ["--json", "status"])
    assert json.loads(outcome.output)["server"] == "http://x/mcp?q=:smile:"


def test_surface_findings_print_command_names_as_written(transport):
    transport.list_tools.return_value = [
        ToolInfo(name="foo[/x]", description="x", input_schema={"type": "object"}, meta={"mutation": False}),
    ]
    outcome = CliRunner().invoke(cli, ["validate", "--surface", "--verbose", "-s", "http://x/mcp"])
    assert "closing tag" not in outcome.output
    assert "foo[/x]" in outcome.output


def test_the_shell_help_shows_the_args_placeholder(transport, monkeypatch):
    outcome = _shell(transport, monkeypatch, "help")
    assert "call <tool> [args]" in outcome.output


def test_a_long_description_is_cut_after_escape_codes_are_removed(transport):
    visible = "d" * 57
    transport.list_tools.return_value = [ToolInfo(name="t", description=f"\x1b[31m{visible}\x1b[0m")]
    outcome = CliRunner().invoke(cli, ["tools", "-s", "http://x/mcp"])
    assert visible in outcome.output.replace("\n", "").replace("│", "").replace(" ", "")
    assert "..." not in outcome.output


def test_header_parsing_trims_only_spaces_and_tabs():
    """str.strip would drop a trailing vertical tab or U+2028 before the check, and a
    no-break space that may be part of the value; only HTTP's OWS is trimmed."""
    from afd.cli.args import parse_header

    assert parse_header(" \tX-Key \t:  \t v \t ") == ("X-Key", "v")
    assert parse_header("X: tok\xa0") == ("X", "tok\xa0")
    assert parse_header("X: tok\x85") == ("X", "tok\x85")  # obs-text, which strip() dropped
    for bad in ("X: secret\x0b", "X: secret\u2028", "\x0bX: v", "X: secret\n", "X\n: v"):
        with pytest.raises(ValueError, match="Invalid header"):
            parse_header(bad)


def test_an_afd_headers_line_holding_only_a_control_character_is_reported_by_its_number():
    from afd.cli.args import resolve_headers

    with pytest.raises(ValueError, match="^AFD_HEADERS line 2: Invalid header"):
        resolve_headers([], {"AFD_HEADERS": "X: 1\n\x0b"})

