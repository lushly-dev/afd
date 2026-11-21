"""The ``afd batch`` and ``afd stream`` commands' work, apart from Click.

``batch`` sends one ``afd-batch`` call; ``stream`` prints what
:meth:`afd.client.McpClient.stream` reads from the server's ``POST /stream/<command>``. Their arguments, JSON output, text output and
exit codes mirror ``packages/cli/src/commands/batch.ts`` and ``stream.ts``. Text
output passes every server-provided value through
:func:`afd.cli.terminal.terminal_text`.
"""

from __future__ import annotations

import asyncio
import json
import math
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import click

from afd.cli.terminal import terminal_text
from afd.transports.base import (
    HttpStatusError,
    JsonRpcError,
    ToolExecutionError,
    ToolNotFoundError,
)
from afd.transports.base import TimeoutError as TransportTimeoutError

SERVER_DEADLINE_MARGIN_S = 5.0
"""Extra time the CLI waits for an ``afd-batch`` answer past the batch deadline,
as TypeScript's ``SERVER_DEADLINE_MARGIN_MS``."""

EXIT_PARTIAL = 2
"""Exit code of a batch that ran with some failed commands."""

EXIT_CANCELLED = 130
"""Exit code of a stream stopped with Ctrl+C."""


# ── Shared text helpers ──────────────────────────────────────────────────────


def js_round(value: float) -> int:
    """Round half up, as JavaScript's ``Math.round`` (Python's ``round`` rounds half to even)."""
    return math.floor(value + 0.5)


def _count(value: Any) -> float:
    """A summary count as a number; anything else counts as zero."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return 0
    return value


def _json_text(value: Any, indent: int | None = None) -> str:
    """``value`` as JSON for text output, keeping non-ASCII characters readable."""
    separators = None if indent is not None else (",", ":")
    return terminal_text(json.dumps(value, indent=indent, ensure_ascii=False, separators=separators))


def _bar(ratio: Any, width: int, color: str) -> str:
    """A fixed-width bar for a 0-1 ratio; values out of range are clamped."""
    try:
        value = float(ratio)
    except (TypeError, ValueError):
        value = 0.0
    if math.isnan(value):
        value = 0.0
    filled = js_round(min(1.0, max(0.0, value)) * width)
    return click.style("█" * filled, fg=color) + click.style("░" * (width - filled), dim=True)


def format_confidence(confidence: Any) -> str:
    """A confidence bar followed by the percentage, such as ``████████░░ 80%``."""
    try:
        value = float(confidence)
    except (TypeError, ValueError):
        value = 0.0
    color = "green" if value >= 0.8 else "yellow" if value >= 0.5 else "red"
    percent = js_round(value * 100) if math.isfinite(value) else 0
    return f"{_bar(value, 10, color)} {percent}%"


def progress_bar(progress: Any) -> str:
    """A 20-character progress bar in brackets."""
    return click.style("[", fg="cyan") + _bar(progress, 20, "cyan") + click.style("]", fg="cyan")


def format_error_summary(error: Any) -> str:
    """``[CODE] message`` for a command error, safe for the terminal."""
    error = error if isinstance(error, dict) else {}
    return terminal_text(f"[{error.get('code')}] {error.get('message')}")


def _dim(text: str) -> str:
    return click.style(text, dim=True)


def _number(value: Any, digits: int = 1) -> str:
    try:
        return f"{float(value):.{digits}f}"
    except (TypeError, ValueError):
        return terminal_text(value)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


# ── Batch ────────────────────────────────────────────────────────────────────


def parse_batch_commands(commands_arg: str) -> list[dict[str, Any]]:
    """Read the batch argument: a JSON array, or the path of a ``.json`` file holding one.

    ``name`` and ``args`` are accepted as aliases of ``command`` and ``input``; an
    entry without a string ``id`` gets ``cmd-<index>``.

    Raises:
        ValueError: The argument is not an array of commands.
        OSError: The file cannot be read.
    """
    if commands_arg.endswith(".json"):
        raw = json.loads(Path(commands_arg).read_text(encoding="utf-8"))
    else:
        raw = json.loads(commands_arg)
    if not isinstance(raw, list):
        raise ValueError("Commands must be an array")

    commands: list[dict[str, Any]] = []
    for index, entry in enumerate(raw):
        cmd = entry if isinstance(entry, dict) else {}
        command = cmd.get("command")
        if command is None:
            command = cmd.get("name")
        if not isinstance(command, str) or command == "":
            raise ValueError(f"Command at index {index} is missing 'command' field")
        command_input = cmd.get("input")
        if command_input is None:
            command_input = cmd.get("args")
        commands.append(
            {
                "id": cmd["id"] if isinstance(cmd.get("id"), str) else f"cmd-{index}",
                "command": command,
                "input": {} if command_input is None else command_input,
            }
        )
    return commands


def batch_failure(
    commands: list[dict[str, Any]], started_at: str, error: dict[str, Any], reasoning: str
) -> dict[str, Any]:
    """A failed batch in which no command is known to have run."""
    return {
        "success": False,
        "results": [],
        "summary": {
            "total": len(commands),
            "successCount": 0,
            "failureCount": len(commands),
            "skippedCount": 0,
        },
        "timing": {"startedAt": started_at, "completedAt": _now(), "totalMs": 0, "averageMs": 0},
        "confidence": 0,
        "reasoning": reasoning,
        "error": error,
    }


def unknown_outcome_batch(
    commands: list[dict[str, Any]], started_at: str, cause: Exception
) -> dict[str, Any]:
    """A batch whose answer never arrived: some or all of its commands may have run,
    so no command gets a status and every count but ``total`` is zero."""
    message = str(cause) or type(cause).__name__
    error = {
        "code": "OUTCOME_UNKNOWN",
        "message": (
            f"No batch result was received ({message}). "
            "The server may have run some or all of its commands."
        ),
        "suggestion": (
            "Check the effect of each command before retrying: running the batch again "
            "can repeat writes that already happened."
        ),
        "retryable": False,
        "details": failure_cause(cause),
    }
    result = batch_failure(commands, started_at, error, error["message"])
    result["summary"]["failureCount"] = 0
    return result


JSON_RPC_ERRORS: dict[int, dict[str, Any]] = {
    -32700: {"code": "PARSE_ERROR", "retryable": False, "suggestion": (
        "The server could not parse the request as JSON; check the arguments are serializable")},
    -32600: {"code": "INVALID_REQUEST", "retryable": False, "suggestion": (
        "The server rejected the JSON-RPC envelope; check that it is an AFD MCP endpoint")},
    -32601: {"code": "METHOD_NOT_FOUND", "retryable": False, "suggestion": (
        "The server does not support this MCP method; check the server type and version")},
    -32602: {"code": "INVALID_INPUT", "retryable": False, "suggestion": (
        "Correct the request parameters (tool name and arguments object) and try again")},
    -32603: {"code": "INTERNAL_ERROR", "retryable": True, "outcome_unknown": True, "suggestion": (
        "The server failed while handling the request; retry, and check the server logs if it "
        "persists")},
    -32000: {"code": "REQUEST_REJECTED", "retryable": False, "suggestion": (
        "The server rejected the HTTP request (Host, Origin, Content-Type or size); check the "
        "URL and headers")},
    -32001: {"code": "SESSION_NOT_FOUND", "retryable": True, "suggestion": (
        "The MCP session is unknown or expired; reconnect to start a new session")},
}
"""JSON-RPC error codes as TypeScript's client maps them (``client-errors.ts``)."""

# The MCP SDK raises MCPError for errors the server sent and for failures of its own,
# such as a lost connection (-32000), a timeout (408) or an answer it could not decode
# (-32700). Only these codes say the server refused the request before running it.
_SDK_REFUSALS = {-32600, -32601, -32602, -32001}


def _rpc_error(code: int, message: str, data: Any) -> dict[str, Any] | None:
    """The CommandError for a JSON-RPC error, or ``None`` when the server may have run it."""
    mapping = JSON_RPC_ERRORS.get(code, {})
    if mapping.get("outcome_unknown"):
        return None
    suggestion = data.get("suggestion") if isinstance(data, dict) else None
    return {
        "code": mapping.get("code", "JSON_RPC_ERROR"),
        "message": message or "The server returned a JSON-RPC error",
        "suggestion": suggestion if isinstance(suggestion, str) and suggestion else (
            mapping.get("suggestion", "Check the request against the server documentation")),
        "retryable": mapping.get("retryable", False),
        "details": {"jsonRpcCode": code},
    }


def refusal(exc: Exception) -> dict[str, Any] | None:
    """The error of a request the server definitely did not run, as TypeScript's
    ``isOutcomeUnknown`` decides; ``None`` when it may have run (a timeout, a lost
    connection, a 5xx or ``-32603``)."""
    if isinstance(exc, ToolNotFoundError):
        return {
            "code": "COMMAND_NOT_FOUND",
            "message": str(exc),
            "suggestion": "Check that the server offers afd-batch: run 'afd tools'",
            "retryable": False,
        }
    if isinstance(exc, JsonRpcError):
        return _rpc_error(exc.code, exc.rpc_message, exc.data)
    if isinstance(exc, HttpStatusError):
        if exc.status < 400 or exc.status >= 500:
            return None
        return {
            "code": f"HTTP_{exc.status}",
            "message": str(exc),
            "suggestion": (
                "The server refused the request; check that the URL points to an AFD MCP "
                "server endpoint"
            ),
            "retryable": exc.status == 429,
        }
    cause = getattr(exc, "cause", None)
    code = getattr(cause, "code", None)
    if type(cause).__name__ == "MCPError" and code in _SDK_REFUSALS:
        return _rpc_error(code, str(getattr(cause, "message", "") or cause), getattr(cause, "data", None))
    status = _http_status(cause)
    if status is not None:
        return refusal(HttpStatusError(status, str(exc)))
    return None


def _http_status(error: Any) -> int | None:
    """The HTTP status of an httpx-style ``HTTPStatusError`` (``error.response.status_code``)."""
    status = getattr(getattr(error, "response", None), "status_code", None)
    return status if isinstance(status, int) and not isinstance(status, bool) else None


def failure_cause(exc: Exception) -> dict[str, Any]:
    """The ``code`` and details of a failure that left the outcome unknown, as TypeScript
    records the cause of ``OUTCOME_UNKNOWN``."""
    if isinstance(exc, JsonRpcError):
        mapping = JSON_RPC_ERRORS.get(exc.code, {})
        return {"cause": mapping.get("code", "JSON_RPC_ERROR"), "jsonRpcCode": exc.code}
    cause = getattr(exc, "cause", None)
    if type(cause).__name__ == "MCPError" and isinstance(getattr(cause, "code", None), int):
        mapping = JSON_RPC_ERRORS.get(cause.code, {})
        return {"cause": mapping.get("code", "JSON_RPC_ERROR"), "jsonRpcCode": cause.code}
    status = exc.status if isinstance(exc, HttpStatusError) else _http_status(cause)
    if status is not None:
        return {"cause": f"HTTP_{status}"}
    timeouts = (TimeoutError, asyncio.TimeoutError, TransportTimeoutError)
    if isinstance(exc, timeouts) or isinstance(cause, timeouts):
        return {"cause": "TIMEOUT"}
    return {"cause": "CONNECTION_ERROR"}


def _is_batch_result(value: Any) -> bool:
    return (
        isinstance(value, dict)
        and isinstance(value.get("success"), bool)
        and isinstance(value.get("results"), list)
        and isinstance(value.get("summary"), dict)
        and isinstance(value.get("timing"), dict)
    )


async def run_batch(
    call_tool: Callable[[str, dict[str, Any]], Any],
    commands: list[dict[str, Any]],
    options: dict[str, Any],
) -> dict[str, Any]:
    """Send one ``afd-batch`` call and return its BatchResult (wire format).

    A server failure that is not a BatchResult (such as a refused envelope) becomes a
    failed batch that carries its error. A call that raises before an answer arrives
    gets ``OUTCOME_UNKNOWN``, since the server may already have run commands.
    """
    started_at = _now()
    try:
        result = await call_tool("afd-batch", {"commands": commands, "options": options})
    except ToolExecutionError as exc:
        message = str(exc) or "Batch execution failed"
        return batch_failure(
            commands,
            started_at,
            {
                "code": "BATCH_ERROR",
                "message": message,
                "suggestion": "Check the batch commands and try again",
            },
            f"Batch execution failed: {message}",
        )
    except Exception as exc:  # noqa: BLE001 - classified below
        error = refusal(exc)
        if error is None:
            return unknown_outcome_batch(commands, started_at, exc)
        return batch_failure(
            commands, started_at, error, f"Batch was not executed: {error['message']}"
        )

    if _is_batch_result(result):
        return result
    if isinstance(result, dict) and result.get("success") is False and isinstance(
        result.get("error"), dict
    ):
        error = result["error"]
        return batch_failure(
            commands, started_at, error, f"Batch execution failed: {error.get('message')}"
        )
    return batch_failure(
        commands,
        started_at,
        {
            "code": "PARSE_ERROR",
            "message": "Failed to parse batch result",
            "suggestion": "The server returned an invalid response",
        },
        "Failed to parse batch result",
    )


def batch_exit_code(result: dict[str, Any]) -> int:
    """1 for a failed batch, 2 when some commands failed, else 0."""
    if not result.get("success"):
        return 1
    if _count((result.get("summary") or {}).get("failureCount")) > 0:
        return EXIT_PARTIAL
    return 0


def batch_text(result: dict[str, Any], *, verbose: bool = False) -> list[str]:
    """The text lines of a batch result, as TypeScript's ``printBatchResult``."""
    summary = result.get("summary") or {}
    timing = result.get("timing") or {}
    failures = _count(summary.get("failureCount"))
    skipped = _count(summary.get("skippedCount"))
    lines: list[str] = []

    if result.get("success") and failures == 0:
        lines.append(click.style("✓ Batch completed successfully", fg="green"))
    elif result.get("success"):
        lines.append(click.style("⚠ Batch completed with partial failures", fg="yellow"))
    else:
        lines.append(click.style("✗ Batch failed", fg="red"))

    lines += ["", click.style("Summary:", bold=True)]
    lines.append(f"  Total:    {terminal_text(summary.get('total'))}")
    lines.append(f"  Success:  {click.style(terminal_text(summary.get('successCount')), fg='green')}")
    if failures > 0:
        lines.append(f"  Failed:   {click.style(terminal_text(summary['failureCount']), fg='red')}")
    if skipped > 0:
        lines.append(f"  Skipped:  {_dim(terminal_text(summary['skippedCount']))}")

    lines += ["", click.style("Timing:", bold=True)]
    lines.append(f"  Total:    {terminal_text(timing.get('totalMs'))}ms")
    lines.append(f"  Average:  {_number(timing.get('averageMs'))}ms/command")

    lines += ["", f"{click.style('Confidence:', bold=True)} {format_confidence(result.get('confidence'))}"]
    if result.get("reasoning"):
        lines.append(_dim(f"  {terminal_text(result['reasoning'])}"))

    entries = result.get("results") or []
    if verbose and entries:
        lines += ["", click.style("Command Results:", bold=True)]
        for entry in entries:
            entry = entry if isinstance(entry, dict) else {}
            outcome = entry.get("result") if isinstance(entry.get("result"), dict) else {}
            ok = outcome.get("success") is True
            status = click.style("✓", fg="green") if ok else click.style("✗", fg="red")
            entry_id = terminal_text(entry.get("id") or f"#{entry.get('index')}")
            command = click.style(terminal_text(entry.get("command")), fg="cyan")
            duration = terminal_text(entry.get("durationMs"))
            lines += ["", f"  {status} {command} {_dim(f'({entry_id}, {duration}ms)')}"]
            if ok and "data" in outcome:
                preview = json.dumps(outcome["data"], ensure_ascii=False, separators=(",", ":"))
                if len(preview) > 100:
                    preview = f"{preview[:100]}..."
                lines.append(f"    {_dim('Data:')} {terminal_text(preview)}")
            error = outcome.get("error")
            if not ok and isinstance(error, dict):
                lines.append(f"    {click.style('Error:', fg='red')} {format_error_summary(error)}")
                if error.get("suggestion"):
                    lines.append(f"    {_dim('Suggestion:')} {terminal_text(error['suggestion'])}")

    warnings = result.get("warnings") or []
    if warnings:
        lines += ["", click.style("Warnings:", fg="yellow")]
        for warning in warnings:
            warning = warning if isinstance(warning, dict) else {}
            text = f"[{warning.get('code')}] {warning.get('message')} ({warning.get('commandId')})"
            lines.append(f"  ⚠ {terminal_text(text)}")

    error = result.get("error")
    if isinstance(error, dict):
        lines += ["", f"{click.style('Error:', fg='red')} {format_error_summary(error)}"]
        if error.get("suggestion"):
            lines.append(f"{_dim('Suggestion:')} {terminal_text(error['suggestion'])}")
    return lines


# ── Stream ───────────────────────────────────────────────────────────────────


class StreamPrinter:
    """Prints stream chunks as text, rewriting one progress line in place."""

    def __init__(self, *, show_progress: bool, write: Callable[[str], None]) -> None:
        self._show_progress = show_progress
        self._write = write
        self._progress_line = ""

    def _echo(self, text: str = "") -> None:
        self._write(f"{text}\n")

    def clear_progress(self) -> None:
        if self._progress_line:
            width = len(click.unstyle(self._progress_line))
            self._write(f"\r{' ' * width}\r")
            self._progress_line = ""

    def handle(self, chunk: dict[str, Any]) -> bool:
        """Print one chunk; return True for an error chunk."""
        kind = chunk.get("type") if isinstance(chunk, dict) else None
        if kind == "progress":
            if not self._show_progress:
                return False
            self.clear_progress()
            progress = chunk.get("progress", 0)
            try:
                percent = js_round(float(progress) * 100)
            except (TypeError, ValueError, OverflowError):
                percent = 0
            items = ""
            if chunk.get("itemsProcessed") is not None and chunk.get("itemsTotal") is not None:
                items = terminal_text(f" ({chunk['itemsProcessed']}/{chunk['itemsTotal']})")
            message = terminal_text(chunk.get("message") or "")
            line = f"{progress_bar(progress)} {percent}%{items} {_dim(message)}"
            self._write(line)
            self._progress_line = line
        elif kind == "data":
            self.clear_progress()
            data = chunk.get("data")
            if isinstance(data, str):
                self._write(terminal_text(data))
            else:
                self._echo(_json_text(data, indent=2))
            if chunk.get("isLast"):
                self._echo()
        elif kind == "complete":
            self.clear_progress()
            self._echo()
            self._echo(click.style("✓ Stream complete", fg="green"))
            if _count(chunk.get("totalChunks")) > 0:
                self._echo(_dim(f"  Chunks: {terminal_text(chunk['totalChunks'])}"))
            self._echo(_dim(f"  Duration: {terminal_text(chunk.get('totalDurationMs'))}ms"))
            if chunk.get("confidence") is not None:
                self._echo(f"{_dim('  Confidence:')} {format_confidence(chunk['confidence'])}")
            if chunk.get("reasoning"):
                self._echo(_dim(f"  {terminal_text(chunk['reasoning'])}"))
            if "data" in chunk:
                self._echo()
                self._echo(click.style("Final Result:", bold=True))
                self._echo(_json_text(chunk["data"], indent=2))
        elif kind == "error":
            self.clear_progress()
            error = chunk.get("error") if isinstance(chunk.get("error"), dict) else {}
            self._echo()
            self._echo(click.style("✗ Stream error", fg="red"))
            self._echo(f"  {click.style('Error:', fg='red')} {format_error_summary(error)}")
            if error.get("suggestion"):
                self._echo(f"  {_dim('Suggestion:')} {terminal_text(error['suggestion'])}")
            if _count(chunk.get("chunksBeforeError")) > 0:
                self._echo(_dim(f"  Chunks before error: {terminal_text(chunk['chunksBeforeError'])}"))
            if chunk.get("recoverable"):
                self._echo(_dim("  This error may be recoverable"))
                if chunk.get("resumeFrom") is not None:
                    self._echo(_dim(f"  Resume from: {terminal_text(chunk['resumeFrom'])}"))
            return True
        return False
