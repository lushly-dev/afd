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
import pytest
from click.testing import CliRunner

import afd.cli.main  # noqa: F401
from afd.cli.batch_stream import (
    SERVER_DEADLINE_MARGIN_S,
    StreamPrinter,
    batch_exit_code,
    batch_text,
    bounded_stream,
    parse_batch_commands,
    run_batch,
)
from afd.cli.main import cli
from afd.cli.terminal import sanitize_for_terminal
from afd.transports.base import ToolExecutionError

_cli_main = sys.modules["afd.cli.main"]
ROOT = Path(__file__).resolve().parents[1]


def batch_result(success=True, failures=0, results=None):
    return {
        "success": success,
        "results": results or [],
        "summary": {"total": 2, "successCount": 2 - failures, "failureCount": failures, "skippedCount": 0},
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
        '[{"command":"a","input":{"x":1},"id":"first"},{"name":"b","args":{"y":2}},{"command":"c"}]'
    ) == [
        {"id": "first", "command": "a", "input": {"x": 1}},
        {"id": "cmd-1", "command": "b", "input": {"y": 2}},
        {"id": "cmd-2", "command": "c", "input": {}},
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

COMMANDS = [{"id": "cmd-0", "command": "a", "input": {}}, {"id": "cmd-1", "command": "b", "input": {}}]


async def test_run_batch_sends_one_afd_batch_call_and_returns_its_result():
    call_tool = AsyncMock(return_value=batch_result())
    options = {"stopOnError": True, "timeout": 1000, "parallelism": 2}
    assert await run_batch(call_tool, COMMANDS, options) == batch_result()
    call_tool.assert_awaited_once_with("afd-batch", {"commands": COMMANDS, "options": options})


async def test_a_refused_batch_keeps_the_servers_error():
    error = {"code": "VALIDATION_ERROR", "message": "commands is empty", "suggestion": "Add a command"}
    result = await run_batch(AsyncMock(return_value={"success": False, "error": error}), COMMANDS, {})
    assert result["success"] is False
    assert result["error"] == error
    assert result["summary"] == {"total": 2, "successCount": 0, "failureCount": 2, "skippedCount": 0}


async def test_a_tool_error_without_a_result_is_a_batch_error():
    result = await run_batch(AsyncMock(side_effect=ToolExecutionError("boom")), COMMANDS, {})
    assert result["error"]["code"] == "BATCH_ERROR"
    assert result["error"]["message"] == "boom"


async def test_a_lost_answer_leaves_the_outcome_unknown_with_no_failures_claimed():
    result = await run_batch(AsyncMock(side_effect=asyncio.TimeoutError("timed out")), COMMANDS, {})
    assert result["error"]["code"] == "OUTCOME_UNKNOWN"
    assert result["error"]["retryable"] is False
    assert result["summary"] == {"total": 2, "successCount": 0, "failureCount": 0, "skippedCount": 0}
    assert result["results"] == []


async def test_an_answer_that_is_no_batch_result_is_a_parse_error():
    result = await run_batch(AsyncMock(return_value="text"), COMMANDS, {})
    assert result["error"]["code"] == "PARSE_ERROR"


def test_the_exit_code_tells_failure_from_partial_failure():
    assert batch_exit_code(batch_result()) == 0
    assert batch_exit_code(batch_result(failures=1)) == 2
    assert batch_exit_code(batch_result(success=False)) == 1


def test_batch_text_shows_each_command_when_verbose_and_strips_escapes():
    result = batch_result(
        failures=1,
        results=[
            {"id": "cmd-0", "index": 0, "command": "a", "durationMs": 1, "result": {"success": True, "data": {"n": 1}}},
            {
                "id": "cmd-1",
                "index": 1,
                "command": "b\x1b]0;owned\x07",
                "durationMs": 2,
                "result": {
                    "success": False,
                    "error": {"code": "NOT_FOUND", "message": "no \x1b[2Jb", "suggestion": "List first"},
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
    assert '    Data: {"n":1}' in text
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
    assert transport.seen["timeout"] == 2 + SERVER_DEADLINE_MARGIN_S
    assert transport.seen["server"] == "http://x/mcp"
    assert "✓ Batch completed successfully" in outcome.output
    transport.disconnect.assert_awaited_once()


@pytest.mark.parametrize("flags", [["--format", "json"], ["-f", "json"]])
def test_batch_json_prints_the_batch_result(transport, flags):
    outcome = CliRunner().invoke(cli, ["batch", '[{"command":"a"}]', *flags])
    assert outcome.exit_code == 0
    assert json.loads(outcome.output) == batch_result()


def test_the_global_json_flag_selects_json_too(transport):
    outcome = CliRunner().invoke(cli, ["--json", "batch", '[{"command":"a"}]'])
    assert json.loads(outcome.output) == batch_result()


@pytest.mark.parametrize(("result", "code"), [(batch_result(failures=1), 2), (batch_result(success=False), 1)])
def test_batch_exits_2_on_partial_failure_and_1_on_failure(transport, result, code):
    transport.call_tool.return_value = result
    assert CliRunner().invoke(cli, ["batch", '[{"command":"a"}]']).exit_code == code


def test_batch_refuses_malformed_commands_before_connecting(transport):
    outcome = CliRunner().invoke(cli, ["batch", '{"command":"a"}'])
    assert outcome.exit_code == 1
    assert "Invalid commands format: Commands must be an array" in outcome.output
    assert "afd batch ./commands.json" in outcome.output
    transport.connect.assert_not_awaited()


def test_batch_reports_a_connection_failure(transport):
    transport.connect.side_effect = OSError("refused")
    outcome = CliRunner().invoke(cli, ["batch", '[{"command":"a"}]'])
    assert outcome.exit_code == 1
    assert "Batch execution error: refused" in outcome.output


@pytest.mark.parametrize("flag", [["-t", "0"], ["-p", "0"], ["-f", "xml"]])
def test_batch_refuses_out_of_range_options(transport, flag):
    assert CliRunner().invoke(cli, ["batch", "[]", *flag]).exit_code == 2


# ── Stream chunks ─────────────────────────────────────────────────────────────


async def _chunks(*chunks, then=None):
    for chunk in chunks:
        yield chunk
    if then is not None:
        await then


async def _collect(stream):
    return [chunk async for chunk in stream]


async def test_bounded_stream_stops_after_the_complete_chunk():
    done = {"type": "complete", "totalChunks": 0, "totalDurationMs": 1}
    extra = {"type": "data", "data": 1, "index": 0, "isLast": True}
    assert await _collect(bounded_stream(_chunks(done, extra), 1)) == [done]


async def test_a_stream_that_ends_early_is_truncated():
    data = {"type": "data", "data": 1, "index": 0, "isLast": False}
    chunks = await _collect(bounded_stream(_chunks(data), 1))
    assert chunks[0] == data
    assert chunks[1]["error"]["code"] == "STREAM_TRUNCATED"
    assert chunks[1]["chunksBeforeError"] == 1


async def test_a_stream_past_its_deadline_times_out():
    progress = {"type": "progress", "progress": 0.1}
    chunks = await _collect(bounded_stream(_chunks(progress, then=asyncio.sleep(10)), 0.05))
    assert chunks[1]["error"]["code"] == "STREAM_TIMEOUT"
    assert chunks[1]["error"]["message"] == "Stream did not finish within 50ms"
    assert chunks[1]["error"]["retryable"] is True


def _printed(*chunks, show_progress=True):
    out = []
    printer = StreamPrinter(show_progress=show_progress, write=out.append)
    failed = [printer.handle(chunk) for chunk in chunks]
    return click.unstyle("".join(out)), failed


def test_stream_text_rewrites_progress_and_prints_the_final_result():
    text, failed = _printed(
        {"type": "progress", "progress": 0.5, "message": "Half", "itemsProcessed": 1, "itemsTotal": 2},
        {"type": "data", "data": "hello", "index": 0, "isLast": True},
        {"type": "complete", "totalChunks": 1, "totalDurationMs": 7, "confidence": 1, "data": {"n": 1}},
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
    for line in ("✗ Stream error", "  Error: [E] bad", "  Suggestion: retry", "  Chunks before error: 3",
                 "  This error may be recoverable", "  Resume from: 3"):
        assert line in text


def test_stream_refuses_the_mock_transport(tmp_path, monkeypatch):
    outcome = CliRunner().invoke(cli, ["stream", "export-run", "--server", "mock"])
    assert outcome.exit_code == 1
    assert "Streaming needs an HTTP server URL" in outcome.output


def test_stream_refuses_arguments_that_are_not_an_object():
    outcome = CliRunner().invoke(cli, ["stream", "export-run", "[1]", "--server", "http://x/mcp"])
    assert outcome.exit_code == 2
    assert "Arguments must be a JSON object" in outcome.output


# ── Live ──────────────────────────────────────────────────────────────────────

def protocol_server(*args, **kwargs):
    pytest.importorskip("mcp.client.streamable_http")
    from tests.test_mcp_protocol_live import protocol_server as serve

    return serve(*args, **kwargs)


async def afd(*args, home):
    """Run the CLI in a subprocess; return (exit code, stdout)."""
    env = dict(os.environ, PYTHONPATH=str(ROOT / "src"), HOME=str(home), NO_COLOR="1")
    process = await asyncio.create_subprocess_exec(
        sys.executable, "-c", "from afd.cli.main import main; main()", *args,
        env=env, stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await asyncio.wait_for(process.communicate(), 60)
    return process.returncode, stdout.decode() + stderr.decode()


async def test_batch_runs_against_a_python_server(tmp_path):
    commands = json.dumps([
        {"command": "probe-write"},
        {"command": "probe-read", "id": "read"},
        {"command": "no-such-command"},
    ])
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
        code, out = await afd("stream", "export-run", '{"format":"csv"}', "--server", url,
                              "--format", "json", home=tmp_path)
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

        code, out = await afd("stream", "slow-run", "--server", url, "-f", "json", "-t", "500",
                              home=tmp_path)
        assert code == 1
        assert json.loads(out.splitlines()[-1])["error"]["code"] == "STREAM_TIMEOUT"

        code, out = await afd("stream", "missing-run", "--server", url, "-f", "json", home=tmp_path)
        assert code == 1
        error = json.loads(out.splitlines()[-1])["error"]
        assert error["code"] == "STREAM_ERROR"
        assert "Unknown command missing-run" in error["message"]

        code, out = await afd("stream", "escape-run", "--server", url, "--no-progress", home=tmp_path)
        assert code == 0, out
        assert "safetext" in out and "red" in out
        assert "\x1b]" not in out and "\x1b[" not in out
