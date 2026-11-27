"""``afd batch`` and ``afd stream``: arguments, JSON and text output and exit codes,
as ``packages/cli/src/commands/batch.ts`` and ``stream.ts``.

The live tests run the CLI in a subprocess against a real server: the Python AFD
server for ``batch`` (``afd-batch``), and ``fixtures/stream_server.py`` for ``stream``,
since the Python server has no ``/stream`` route yet.
"""

import asyncio
import json
import os
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import click
import httpx
import pytest
from click.testing import CliRunner

import afd.cli.main  # noqa: F401
from afd.cli.args import parse_tool_args, resolve_headers
from afd.cli.batch_stream import (
    SERVER_DEADLINE_MARGIN_S,
    StreamPrinter,
    batch_exit_code,
    batch_text,
    parse_batch_commands,
    run_batch,
)
from afd.cli.main import cli
from afd.cli.terminal import sanitize_for_terminal
from afd.transports.base import (
    HttpStatusError,
    JsonRpcError,
    ToolExecutionError,
    ToolNotFoundError,
    TransportError,
)

_cli_main = sys.modules["afd.cli.main"]
ROOT = Path(__file__).resolve().parents[1]


def batch_result(success=True, failures=0, results=None):
    return {
        "success": success,
        "results": results or [],
        "summary": {
            "total": 2,
            "successCount": 2 - failures,
            "failureCount": failures,
            "skippedCount": 0,
        },
        "timing": {"totalMs": 4, "averageMs": 2, "startedAt": "s", "completedAt": "c"},
        "confidence": 1 if failures == 0 else 0.5,
        "reasoning": "All 2 commands succeeded",
    }


# ── Terminal safety ───────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("raw", "safe"),
    [
        ("title\x1b]0;owned\x07 kept", "title kept"),
        ("link\x1b]8;;https://x\x1b\\here", "linkhere"),
        ("\x1b[2J\x1b[1;1Hclear", "clear"),
        ("c1\x9b31mred", "c1red"),
        ("over\rwrite\b!", "overwrite!"),
        ("reset\x1bc done", "reset done"),
        ("tab\tand\nline", "tab\tand\nline"),
        ("café ✓ 東京", "café ✓ 東京"),
        ("open\x1b]0;never closed", "open0;never closed"),
        ("trailing\x1b", "trailing"),
    ],
)
def test_sanitize_for_terminal_removes_controls_and_keeps_text(raw, safe):
    assert sanitize_for_terminal(raw) == safe


# ── Batch arguments ───────────────────────────────────────────────────────────


def test_parse_batch_commands_accepts_aliases_and_numbers_the_ids():
    assert parse_batch_commands(
        '[{"command":"a","input":{"x":1},"id":"first"},{"name":"b","args":{"y":2}},{"command":"c"},'
        '{"command":null,"name":"d","input":null,"args":{"z":3}}]'
    ) == [
        {"id": "first", "command": "a", "input": {"x": 1}},
        {"id": "cmd-1", "command": "b", "input": {"y": 2}},
        {"id": "cmd-2", "command": "c", "input": {}},
        {"id": "cmd-3", "command": "d", "input": {"z": 3}},
    ]


def test_parse_batch_commands_reads_a_json_file(tmp_path):
    path = tmp_path / "commands.json"
    path.write_text('[{"command":"todo-list"}]')
    assert parse_batch_commands(str(path)) == [{"id": "cmd-0", "command": "todo-list", "input": {}}]


@pytest.mark.parametrize(
    ("raw", "message"),
    [
        ('{"command":"a"}', "Commands must be an array"),
        ('[{"input":{}}]', "Command at index 0 is missing 'command' field"),
        ('[{"command":""}]', "Command at index 0 is missing 'command' field"),
        ("[1]", "Command at index 0 is missing 'command' field"),
    ],
)
def test_parse_batch_commands_refuses_what_is_not_a_command_array(raw, message):
    with pytest.raises(ValueError, match=message):
        parse_batch_commands(raw)


# ── Batch results ─────────────────────────────────────────────────────────────

COMMANDS = [
    {"id": "cmd-0", "command": "a", "input": {}},
    {"id": "cmd-1", "command": "b", "input": {}},
]


async def test_run_batch_sends_one_afd_batch_call_and_returns_its_result():
    call_tool = AsyncMock(return_value=batch_result())
    options = {"stopOnError": True, "timeout": 1000, "parallelism": 2}
    assert await run_batch(call_tool, COMMANDS, options) == batch_result()
    call_tool.assert_awaited_once_with("afd-batch", {"commands": COMMANDS, "options": options})


async def test_a_refused_batch_keeps_the_servers_error():
    error = {
        "code": "VALIDATION_ERROR",
        "message": "commands is empty",
        "suggestion": "Add a command",
    }
    result = await run_batch(
        AsyncMock(return_value={"success": False, "error": error}), COMMANDS, {}
    )
    assert result["success"] is False
    assert result["error"] == error
    assert result["summary"] == {
        "total": 2,
        "successCount": 0,
        "failureCount": 2,
        "skippedCount": 0,
    }


async def test_a_tool_error_without_a_result_is_a_batch_error():
    result = await run_batch(AsyncMock(side_effect=ToolExecutionError("boom")), COMMANDS, {})
    assert result["error"]["code"] == "BATCH_ERROR"
    assert result["error"]["message"] == "boom"


async def test_a_lost_answer_leaves_the_outcome_unknown_with_no_failures_claimed():
    result = await run_batch(AsyncMock(side_effect=TimeoutError("timed out")), COMMANDS, {})
    assert result["error"]["code"] == "OUTCOME_UNKNOWN"
    assert result["error"]["retryable"] is False
    assert result["summary"] == {
        "total": 2,
        "successCount": 0,
        "failureCount": 0,
        "skippedCount": 0,
    }
    assert result["results"] == []


async def test_an_answer_that_is_no_batch_result_is_a_parse_error():
    result = await run_batch(AsyncMock(return_value="text"), COMMANDS, {})
    assert result["error"]["code"] == "PARSE_ERROR"


class _McpError(Exception):
    """Stands in for the MCP SDK's ``MCPError``, which the classification checks by name."""

    def __init__(self, code, message, data=None):
        super().__init__(message)
        self.code, self.message, self.data = code, message, data


_McpError.__name__ = "MCPError"


@pytest.mark.parametrize(
    ("raised", "code"),
    [
        (JsonRpcError(-32602, "Unknown tool: afd-batch"), "INVALID_INPUT"),
        (JsonRpcError(-32001, "Session not found"), "SESSION_NOT_FOUND"),
        (JsonRpcError(-1, "Odd"), "JSON_RPC_ERROR"),
        (HttpStatusError(404, "HTTP 404: Not Found"), "HTTP_404"),
        (ToolNotFoundError("afd-batch"), "COMMAND_NOT_FOUND"),
        (TransportError("bad", cause=_McpError(-32602, "Invalid params")), "INVALID_INPUT"),
    ],
)
async def test_a_definite_rejection_counts_every_command_as_failed(raised, code):
    result = await run_batch(AsyncMock(side_effect=raised), COMMANDS, {})
    assert result["error"]["code"] == code
    assert result["summary"]["failureCount"] == 2
    assert result["reasoning"].startswith("Batch was not executed: ")


async def test_a_json_rpc_errors_suggestion_comes_from_the_server_when_it_sends_one():
    raised = JsonRpcError(-32602, "Bad", {"suggestion": "Use afd-detail"})
    result = await run_batch(AsyncMock(side_effect=raised), COMMANDS, {})
    assert result["error"]["suggestion"] == "Use afd-detail"
    assert result["error"]["details"] == {"jsonRpcCode": -32602}


@pytest.mark.parametrize(
    "raised",
    [
        JsonRpcError(-32603, "Internal error"),
        HttpStatusError(503, "HTTP 503: Service Unavailable"),
        TransportError("closed", cause=_McpError(-32000, "Connection closed")),
        TransportError("timed out", cause=_McpError(408, "Timed out")),
        OSError("reset"),
    ],
)
async def test_a_failure_that_may_have_run_leaves_the_outcome_unknown(raised):
    result = await run_batch(AsyncMock(side_effect=raised), COMMANDS, {})
    assert result["error"]["code"] == "OUTCOME_UNKNOWN"
    assert result["summary"]["failureCount"] == 0


class _StatusError(Exception):
    """Stands in for httpx's ``HTTPStatusError``: ``.response.status_code``."""

    def __init__(self, status):
        super().__init__(f"HTTP {status}")
        self.response = MagicMock(status_code=status)


@pytest.mark.parametrize(
    ("raised", "outcome"),
    [
        (
            TransportError("bad", cause=_McpError(-32700, "Could not decode the answer")),
            "OUTCOME_UNKNOWN",
        ),
        (TransportError("bad", cause=_McpError(-32603, "Internal")), "OUTCOME_UNKNOWN"),
        (TransportError("refused", cause=_StatusError(403)), "HTTP_403"),
        (TransportError("down", cause=_StatusError(502)), "OUTCOME_UNKNOWN"),
    ],
)
async def test_an_mcp_sdk_failure_is_a_refusal_only_when_the_server_refused(raised, outcome):
    result = await run_batch(AsyncMock(side_effect=raised), COMMANDS, {})
    assert result["error"]["code"] == outcome


@pytest.mark.parametrize(
    ("raised", "details"),
    [
        (JsonRpcError(-32603, "Internal"), {"cause": "INTERNAL_ERROR", "jsonRpcCode": -32603}),
        (HttpStatusError(503, "HTTP 503"), {"cause": "HTTP_503"}),
        (TimeoutError("timed out"), {"cause": "TIMEOUT"}),
        (OSError("reset"), {"cause": "CONNECTION_ERROR"}),
    ],
)
async def test_an_unknown_outcome_records_its_typed_cause(raised, details):
    result = await run_batch(AsyncMock(side_effect=raised), COMMANDS, {})
    assert result["error"]["details"] == details


@pytest.mark.parametrize(
    ("status", "code", "expected"),
    [(200, -32602, -32602), (400, -32602, -32602), (500, -32602, -32602), (400, -32603, -32603)],
)
async def test_the_http_transport_reads_a_json_rpc_error_before_the_status(
    monkeypatch, status, code, expected
):
    from afd.transports.http import HttpTransport

    async def post(self_client, url, *, json=None, headers=None, timeout=None):
        if json["method"] == "initialize":
            return httpx.Response(200, json={"jsonrpc": "2.0", "id": json["id"], "result": {}})
        return httpx.Response(
            status,
            json={"jsonrpc": "2.0", "id": json["id"], "error": {"code": code, "message": "Nope"}},
        )

    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    transport = HttpTransport("http://localhost:3100/message")
    await transport.connect()
    with pytest.raises(JsonRpcError) as raised:
        await transport.call_tool("afd-batch", {})
    assert raised.value.code == expected
    result = await run_batch(AsyncMock(side_effect=raised.value), COMMANDS, {})
    assert result["error"]["code"] == ("OUTCOME_UNKNOWN" if expected == -32603 else "INVALID_INPUT")


async def test_the_http_transport_keeps_a_plain_http_error_as_a_status(monkeypatch):
    from afd.transports.http import HttpTransport

    async def post(self_client, url, *, json=None, headers=None, timeout=None):
        if json["method"] == "initialize":
            return httpx.Response(200, json={"jsonrpc": "2.0", "id": json["id"], "result": {}})
        return httpx.Response(403, text="Forbidden")

    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    transport = HttpTransport("http://localhost:3100/message")
    await transport.connect()
    with pytest.raises(HttpStatusError) as raised:
        await transport.call_tool("afd-batch", {})
    assert raised.value.status == 403


def test_the_exit_code_tells_failure_from_partial_failure():
    assert batch_exit_code(batch_result()) == 0
    assert batch_exit_code(batch_result(failures=1)) == 2
    assert batch_exit_code(batch_result(success=False)) == 1
    odd = batch_result()
    odd["summary"]["failureCount"] = None
    assert batch_exit_code(odd) == 0
    assert "Failed:" not in click.unstyle("\n".join(batch_text(odd)))


@pytest.mark.parametrize(
    ("confidence", "bars", "percent"), [(0.85, 9, 85), (0.125, 1, 13), (0.5, 5, 50)]
)
def test_confidence_rounds_half_up_as_javascript_does(confidence, bars, percent):
    result = batch_result()
    result["confidence"] = confidence
    line = next(
        line for line in map(click.unstyle, batch_text(result)) if line.startswith("Confidence:")
    )
    assert line == f"Confidence: {'█' * bars}{'░' * (10 - bars)} {percent}%"


def test_batch_text_shows_each_command_when_verbose_and_strips_escapes():
    result = batch_result(
        failures=1,
        results=[
            {
                "id": "cmd-0",
                "index": 0,
                "command": "a",
                "durationMs": 1,
                "result": {"success": True, "data": {"n": "café"}},
            },
            {
                "id": "cmd-2",
                "index": 2,
                "command": "c",
                "durationMs": 1,
                "result": {"success": True, "data": None},
            },
            {
                "id": "cmd-1",
                "index": 1,
                "command": "b\x1b]0;owned\x07",
                "durationMs": 2,
                "result": {
                    "success": False,
                    "error": {
                        "code": "NOT_FOUND",
                        "message": "no \x1b[2Jb",
                        "suggestion": "List first",
                    },
                },
            },
        ],
    )
    result["warnings"] = [{"code": "SLOW", "message": "took long", "commandId": "cmd-0"}]
    text = click.unstyle("\n".join(batch_text(result, verbose=True)))
    assert "⚠ Batch completed with partial failures" in text
    assert "  Failed:   1" in text
    assert "  Average:  2.0ms/command" in text
    assert "Confidence: █████░░░░░ 50%" in text
    assert "  ✓ a (cmd-0, 1ms)" in text
    assert '    Data: {"n":"café"}' in text
    assert "    Data: null" in text
    assert "  ✗ b (cmd-1, 2ms)" in text
    assert "    Error: [NOT_FOUND] no b" in text
    assert "    Suggestion: List first" in text
    assert "  ⚠ [SLOW] took long (cmd-0)" in text
    assert "\x1b]" not in text and "\x1b[2J" not in text
    assert "Command Results:" not in click.unstyle("\n".join(batch_text(result)))


# ── Batch command ─────────────────────────────────────────────────────────────


@pytest.fixture
def transport(monkeypatch):
    fake = MagicMock()
    fake.connect = AsyncMock()
    fake.disconnect = AsyncMock()
    fake.call_tool = AsyncMock(return_value=batch_result())
    seen = {}

    def get_transport(server=None, **options):
        seen.update(options, server=server)
        return fake

    monkeypatch.setattr(_cli_main, "_get_transport", get_transport)
    fake.seen = seen
    return fake


def test_batch_sends_its_options_and_waits_a_margin_past_the_deadline(transport):
    outcome = CliRunner().invoke(
        cli,
        ["batch", '[{"command":"a"}]', "--server", "http://x/mcp", "-s", "-t", "2000", "-p", "3"],
    )
    assert outcome.exit_code == 0, outcome.output
    transport.call_tool.assert_awaited_once_with(
        "afd-batch",
        {
            "commands": [{"id": "cmd-0", "command": "a", "input": {}}],
            "options": {"stopOnError": True, "timeout": 2000, "parallelism": 3},
        },
    )
    assert transport.seen["server"] == "http://x/mcp"
    assert transport.seen["timeout"] == 30.0  # 2 s plus the margin is less than the default
    CliRunner().invoke(cli, ["batch", '[{"command":"a"}]', "-t", "60000"])
    assert transport.seen["timeout"] == 60 + SERVER_DEADLINE_MARGIN_S
    assert "✓ Batch completed successfully" in outcome.output
    assert transport.disconnect.await_count == 2  # once for each run


@pytest.mark.parametrize("flags", [["--format", "json"], ["-f", "json"]])
def test_batch_json_prints_the_batch_result(transport, flags):
    outcome = CliRunner().invoke(cli, ["batch", '[{"command":"a"}]', *flags])
    assert outcome.exit_code == 0
    assert json.loads(outcome.output) == batch_result()


def test_the_global_json_flag_selects_json_too(transport):
    outcome = CliRunner().invoke(cli, ["--json", "batch", '[{"command":"a"}]'])
    assert json.loads(outcome.output) == batch_result()


@pytest.mark.parametrize(
    ("result", "code"), [(batch_result(failures=1), 2), (batch_result(success=False), 1)]
)
def test_batch_exits_2_on_partial_failure_and_1_on_failure(transport, result, code):
    transport.call_tool.return_value = result
    assert CliRunner().invoke(cli, ["batch", '[{"command":"a"}]']).exit_code == code


def test_batch_refuses_malformed_commands_before_connecting(transport):
    outcome = CliRunner().invoke(cli, ["batch", '{"command":"a"}'])
    assert outcome.exit_code == 1
    assert "Invalid commands format: Commands must be an array" in outcome.output
    assert "afd batch ./commands.json" in outcome.output
    transport.connect.assert_not_awaited()


def test_batch_reports_a_connection_failure_as_plain_text(transport):
    transport.connect.side_effect = TransportError(
        "HTTP 500: \x1b]52;c;aGk=\x07[/x][link=https://e]docs[/link]"
    )
    outcome = CliRunner().invoke(cli, ["batch", '[{"command":"a"}]'])
    assert outcome.exit_code == 1
    assert "Batch execution error: HTTP 500: [/x][link=https://e]docs[/link]" in outcome.output
    assert "\x1b" not in outcome.output


def test_batch_sends_headers_from_the_flags_and_the_environment(transport, monkeypatch):
    monkeypatch.setenv("AFD_HEADERS", "Accept-Language: fr\nX-Trace: env")
    outcome = CliRunner().invoke(
        cli, ["batch", '[{"command":"a"}]', "-H", "Accept-Language: en", "--header", "X-Other: 1"]
    )
    assert outcome.exit_code == 0, outcome.output
    assert transport.seen["headers"] == {"Accept-Language": "en", "X-Trace": "env", "X-Other": "1"}


def test_batch_refuses_a_malformed_header(transport):
    outcome = CliRunner().invoke(cli, ["batch", "[]", "-H", "no colon"])
    assert outcome.exit_code == 1
    assert "--header 1: Invalid header" in outcome.output
    assert "no colon" not in outcome.output


def test_a_short_batch_deadline_still_waits_the_default_request_timeout(transport):
    CliRunner().invoke(cli, ["batch", '[{"command":"a"}]', "-t", "0"])
    assert transport.seen["timeout"] == 30.0


@pytest.mark.parametrize("flag", [["-t", "-1"], ["-p", "0"], ["-f", "xml"]])
def test_batch_refuses_out_of_range_options(transport, flag):
    assert CliRunner().invoke(cli, ["batch", "[]", *flag]).exit_code == 2


# ── Stream text ───────────────────────────────────────────────────────────────


def _printed(*chunks, show_progress=True):
    out = []
    printer = StreamPrinter(show_progress=show_progress, write=out.append)
    failed = [printer.handle(chunk) for chunk in chunks]
    return click.unstyle("".join(out)), failed


def test_stream_text_rewrites_progress_and_prints_the_final_result():
    text, failed = _printed(
        {
            "type": "progress",
            "progress": 0.5,
            "message": "Half",
            "itemsProcessed": 1,
            "itemsTotal": 2,
        },
        {"type": "data", "data": "hello", "index": 0, "isLast": True},
        {
            "type": "complete",
            "totalChunks": 1,
            "totalDurationMs": 7,
            "confidence": 1,
            "data": {"n": 1},
        },
    )
    assert failed == [False, False, False]
    assert "[██████████░░░░░░░░░░] 50% (1/2) Half" in text
    assert "\r" in text  # the progress line is cleared before the data
    assert "hello\n" in text
    assert "✓ Stream complete" in text
    assert "  Chunks: 1" in text and "  Duration: 7ms" in text
    assert "  Confidence: ██████████ 100%" in text
    assert 'Final Result:\n{\n  "n": 1\n}' in text


def test_stream_text_hides_progress_when_asked():
    text, _ = _printed({"type": "progress", "progress": 0.5}, show_progress=False)
    assert text == ""


def test_stream_text_reports_an_error_chunk():
    text, failed = _printed(
        {
            "type": "error",
            "error": {"code": "E", "message": "bad", "suggestion": "retry"},
            "chunksBeforeError": 3,
            "recoverable": True,
            "resumeFrom": 3,
        }
    )
    assert failed == [True]
    for line in (
        "✗ Stream error",
        "  Error: [E] bad",
        "  Suggestion: retry",
        "  Chunks before error: 3",
        "  This error may be recoverable",
        "  Resume from: 3",
    ):
        assert line in text


def test_stream_refuses_the_mock_transport(tmp_path, monkeypatch):
    outcome = CliRunner().invoke(cli, ["stream", "export-run", "--server", "mock"])
    assert outcome.exit_code == 1
    assert "Streaming needs an HTTP server URL" in outcome.output


@pytest.mark.parametrize("raw", ["[1]", "{bad", "=x", "note='open", '{"a": NaN}'])
def test_stream_refuses_malformed_arguments(raw):
    outcome = CliRunner().invoke(cli, ["stream", "export-run", raw, "--server", "http://x/mcp"])
    assert outcome.exit_code == 1
    assert "Use a JSON object or key=value pairs." in outcome.output


@pytest.mark.parametrize(
    ("raw", "parsed"),
    [
        (None, {}),
        ("  ", {}),
        ('{"title": "Buy  milk"}', {"title": "Buy  milk"}),
        ("count=2 done=true title=milk", {"count": 2, "done": True, "title": "milk"}),
        ("title=\"Buy milk\" note='two words'", {"title": "Buy milk", "note": "two words"}),
        ('tags=["a", "b"] meta={"k": [1, 2]}', {"tags": ["a", "b"], "meta": {"k": [1, 2]}}),
        ("note=don't url=a=b", {"note": "don't", "url": "a=b"}),
        ('say="a \\" b"', {"say": 'a " b'}),
        ("caption=NaN limit=Infinity", {"caption": "NaN", "limit": "Infinity"}),
    ],
)
def test_tool_arguments_are_a_json_object_or_key_value_pairs(raw, parsed):
    assert parse_tool_args(raw) == parsed


def test_a_header_flag_replaces_an_environment_header_of_the_same_name():
    env = {"AFD_HEADERS": "authorization: Bearer env\r\n\nX-A: 1"}
    assert resolve_headers(["Authorization: Bearer flag"], env) == {
        "Authorization": "Bearer flag",
        "X-A": "1",
    }
    with pytest.raises(ValueError, match="AFD_HEADERS line 1: Invalid header"):
        resolve_headers([], {"AFD_HEADERS": "bad header"})


# ── Live ──────────────────────────────────────────────────────────────────────


def protocol_server(*args, **kwargs):
    pytest.importorskip("mcp.client.streamable_http")
    from tests.test_mcp_protocol_live import protocol_server as serve

    return serve(*args, **kwargs)


def _text(output: bytes) -> str:
    """Decode a subprocess stream with ``\n`` line endings on every platform.

    Windows writes ``\r\n`` to a piped stdout, and the assertions below match
    multi-line output with ``\n`` (#2172).
    """
    return output.decode().replace("\r\n", "\n")


def test_text_normalizes_windows_line_endings():
    assert _text(b'Final Result:\r\n{\r\n  "rows": 2\r\n}\r\n') == (
        'Final Result:\n{\n  "rows": 2\n}\n'
    )


async def afd(*args, home, extra_env=None):
    """Run the CLI in a subprocess; return (exit code, stdout and stderr)."""
    env = dict(os.environ, PYTHONPATH=str(ROOT / "src"), HOME=str(home), NO_COLOR="1")
    if extra_env:
        env.update(extra_env)
    process = await asyncio.create_subprocess_exec(
        sys.executable,
        "-c",
        "from afd.cli.main import main; main()",
        *args,
        env=env,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await asyncio.wait_for(process.communicate(), 60)
    return process.returncode, _text(stdout) + _text(stderr)


async def test_batch_runs_against_a_python_server(tmp_path):
    commands = json.dumps(
        [
            {"command": "probe-write"},
            {"command": "probe-read", "id": "read"},
            {"command": "no-such-command"},
        ]
    )
    async with protocol_server("individual", "streamable-http") as url:
        code, out = await afd("batch", commands, "--server", url, "-f", "json", home=tmp_path)
        assert code == 2, out
        result = json.loads(out)
        assert result["summary"]["total"] == 3
        assert result["summary"]["failureCount"] == 1
        assert [entry["id"] for entry in result["results"]] == ["cmd-0", "read", "cmd-2"]
        assert result["results"][1]["result"]["data"] == {"writes": 1}

        code, out = await afd("batch", commands, "--server", url, "-s", "-v", home=tmp_path)
        assert code == 2, out
        assert "⚠ Batch completed with partial failures" in out
        assert "✓ probe-read (read," in out
        assert "✗ no-such-command (cmd-2," in out


async def test_stream_runs_against_a_stream_endpoint(tmp_path):
    async with protocol_server("individual", "streamable-http", fixture="stream_server.py") as url:
        code, out = await afd(
            "stream",
            "export-run",
            '{"format":"csv"}',
            "--server",
            url,
            "--format",
            "json",
            home=tmp_path,
        )
        assert code == 0, out
        chunks = [json.loads(line) for line in out.splitlines()]
        assert [chunk["type"] for chunk in chunks] == ["progress", "data", "data", "complete"]
        assert chunks[1]["data"] == {"row": 1, "format": "csv"}

        code, out = await afd("stream", "export-run", "--server", url, home=tmp_path)
        assert code == 0, out
        assert "Streaming export-run... (Ctrl+C to cancel)" in out
        assert "✓ Stream complete" in out
        assert 'Final Result:\n{\n  "rows": 2\n}' in out

        code, out = await afd("stream", "fail-run", "--server", url, home=tmp_path)
        assert code == 1
        assert "[EXPORT_FAILED] Disk full" in out
        assert "Resume from: 1" in out

        code, out = await afd("stream", "cut-run", "--server", url, "-f", "json", home=tmp_path)
        assert code == 1
        assert json.loads(out.splitlines()[-1])["error"]["code"] == "STREAM_TRUNCATED"

        code, out = await afd(
            "stream", "slow-run", "--server", url, "-f", "json", "-t", "500", home=tmp_path
        )
        assert code == 1
        assert json.loads(out.splitlines()[-1])["error"]["code"] == "STREAM_TIMEOUT"

        code, out = await afd("stream", "missing-run", "--server", url, "-f", "json", home=tmp_path)
        assert code == 1
        error = json.loads(out.splitlines()[-1])["error"]
        assert error == {
            "code": "COMMAND_NOT_FOUND",
            "message": "Unknown command missing-run",
            "suggestion": "Run afd-discover",
        }

        code, out = await afd(
            "stream", "escape-run", "--server", url, "--no-progress", home=tmp_path
        )
        assert code == 0, out
        assert "safetext" in out and "red" in out
        # Click strips CSI from piped output itself, so only the OSC check proves the sanitizer.
        assert "\x1b]" not in out and "owned" not in out

        code, out = await afd(
            "stream",
            "export-run",
            "format=csv",
            "--server",
            url,
            "-t",
            "0",
            "-f",
            "json",
            home=tmp_path,
        )
        assert code == 0, out
        assert json.loads(out.splitlines()[1])["data"] == {"row": 1, "format": "csv"}


async def _spawn(*args, home):
    env = dict(os.environ, PYTHONPATH=str(ROOT / "src"), HOME=str(home), NO_COLOR="1")
    return await asyncio.create_subprocess_exec(
        sys.executable,
        "-c",
        "from afd.cli.main import main; main()",
        *args,
        env=env,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )


@pytest.mark.skipif(sys.platform == "win32", reason="POSIX signals")
@pytest.mark.parametrize("signum", ["SIGINT", "SIGTERM"])
@pytest.mark.parametrize("output", ["json", "text"])
async def test_a_signal_cancels_the_stream_with_a_final_chunk_and_exit_130(
    tmp_path, signum, output
):
    import signal

    async with protocol_server("individual", "streamable-http", fixture="stream_server.py") as url:
        process = await _spawn("stream", "slow-run", "--server", url, "-f", output, home=tmp_path)
        first = await asyncio.wait_for(process.stdout.read(1), 30)  # the stream has started
        await asyncio.sleep(0.2)
        process.send_signal(getattr(signal, signum))
        rest, _ = await asyncio.wait_for(process.communicate(), 30)
        out = (first + rest).decode()

    assert process.returncode == 130, out
    if output == "json":
        last = json.loads(out.splitlines()[-1])
        assert last["error"]["code"] == "STREAM_CANCELLED"
        assert last["chunksBeforeError"] == 1
    else:
        assert "[STREAM_CANCELLED] Stream was cancelled by the caller" in out
        assert out.rstrip().endswith("⚠ Stream cancelled by user")


async def test_the_stream_runs_in_the_clients_mcp_session():
    from afd.client import McpClient, McpClientConfig

    async with protocol_server("individual", "streamable-http", fixture="stream_server.py") as url:
        client = McpClient(McpClientConfig(url=url, protocol_mode="legacy", auto_reconnect=False))
        await client.connect()
        try:
            session_id = client._transport.session_id
            chunks = [chunk async for chunk in client.stream("session-run", {})]
        finally:
            await client.disconnect()

    assert session_id
    assert chunks[-1]["data"] == {"session": session_id}


async def test_batch_and_stream_survive_a_cp1252_console(tmp_path):
    """Under a cp1252 console (as on Windows), Unicode symbols and bars do not raise."""
    cp1252 = {"PYTHONIOENCODING": "cp1252"}
    commands = json.dumps(
        [
            {"command": "probe-write"},
            {"command": "probe-read", "id": "read"},
            {"command": "no-such-command"},
        ]
    )
    async with protocol_server("individual", "streamable-http") as url:
        code, out = await afd(
            "batch", commands, "--server", url, "-s", "-v", home=tmp_path, extra_env=cp1252
        )
        assert code == 2, out
        assert "⚠ Batch completed with partial failures" in out
        assert "✓ probe-read (read," in out
        assert "✗ no-such-command (cmd-2," in out

    async with protocol_server("individual", "streamable-http", fixture="stream_server.py") as url:
        code, out = await afd(
            "stream", "export-run", "--server", url, home=tmp_path, extra_env=cp1252
        )
        assert code == 0, out
        assert "✓ Stream complete" in out
        assert 'Final Result:\n{\n  "rows": 2\n}' in out

        code, out = await afd(
            "stream", "fail-run", "--server", url, home=tmp_path, extra_env=cp1252
        )
        assert code == 1, out
        assert "✗ Stream error" in out
        assert "[EXPORT_FAILED] Disk full" in out

    # Also exercise sys.stderr (`_fail()` emits `✗ Error:` with err=True) under cp1252.
    code, out = await afd("batch", "{bad", home=tmp_path, extra_env=cp1252)
    assert code == 1, out
    assert "✗ Error:" in out
