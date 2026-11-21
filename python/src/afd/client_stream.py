"""Read an AFD server's ``POST /stream/<command>`` events as stream chunks.

A port of ``streamOverHttp`` in ``packages/client/src/mcp-stream.ts``. The last
chunk is always ``complete`` or ``error``; the reader makes the error chunk itself
when the stream ends early (``STREAM_TRUNCATED``), the deadline passes
(``STREAM_TIMEOUT``), the caller cancels (``STREAM_CANCELLED``), one event is too
large (``STREAM_EVENT_TOO_LARGE``), the server answers with an HTTP error (its
``error``, or ``STREAM_ERROR``) or the connection fails. Events that are not stream
chunks are skipped, and lines end only at CR, LF or CRLF, as the event-stream format
says, so a U+2028 inside JSON stays in its string.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import re
from collections.abc import AsyncIterator
from typing import Any

from afd.core.sse import SseDecoder
from afd.core.streaming import is_stream_chunk

DEFAULT_MAX_STREAM_EVENT_BYTES = 1024 * 1024
"""The largest event the reader accepts, as TypeScript's ``DEFAULT_MAX_SSE_EVENT_SIZE``."""

_LINE_END = re.compile(rb"\r\n|\r|\n")

TRUNCATED: dict[str, Any] = {
    "code": "STREAM_TRUNCATED",
    "message": "The stream ended without a complete or error chunk",
    "suggestion": (
        "The connection closed before the command reported its result. Check whether "
        "the command took effect before running it again."
    ),
    "retryable": False,
}


def stream_error_chunk(
    error: dict[str, Any], chunks_before_error: int, recoverable: bool = False
) -> dict[str, Any]:
    """A wire-format error chunk."""
    return {
        "type": "error",
        "error": error,
        "chunksBeforeError": chunks_before_error,
        "recoverable": recoverable,
    }


def _is_command_error(value: Any) -> bool:
    return (
        isinstance(value, dict)
        and isinstance(value.get("code"), str)
        and isinstance(value.get("message"), str)
    )


def http_failure(status: int, reason: str, body: bytes) -> dict[str, Any]:
    """The error of a stream request the server refused: the body's AFD error when it
    has one (such as ``INSUFFICIENT_SCOPE`` with its suggestion), else ``STREAM_ERROR``."""
    try:
        payload = json.loads(body) if body else None
    except (json.JSONDecodeError, UnicodeDecodeError):
        payload = None
    server_error = payload.get("error") if isinstance(payload, dict) else None
    if _is_command_error(server_error):
        return dict(server_error)
    return {
        "code": "STREAM_ERROR",
        "message": f"HTTP {status}: {reason}" if reason else f"HTTP {status}",
        "suggestion": (
            "Check the command name and arguments, and that the server supports streaming"
        ),
        "retryable": status >= 500,
    }


def connection_error(exc: BaseException) -> dict[str, Any]:
    """The error of a stream whose connection failed, as TypeScript's ``toCommandError``."""
    return {
        "code": "CONNECTION_ERROR",
        "message": str(exc) or "The request failed",
        "suggestion": (
            "Check that the server is reachable and retry. The request may have reached "
            "the server, so check its effect before retrying a mutation."
        ),
        "retryable": True,
    }


class _EventTooLargeError(Exception):
    pass


async def _read_events(response: Any, max_event_bytes: int) -> AsyncIterator[str]:
    """Yield each event's data from an event-stream response body."""
    decoder = SseDecoder(max_event_bytes=max_event_bytes)

    def decode(line: bytes) -> str | None:
        try:
            event = decoder.decode(line.decode("utf-8", errors="replace"))
        except ValueError as exc:
            raise _EventTooLargeError(str(exc)) from exc
        return None if event is None else event.data

    buffer = b""
    async for piece in response.aiter_bytes():
        buffer += piece
        while True:
            match = _LINE_END.search(buffer)
            # A CR at the end of the buffer may be the first half of a CRLF.
            if match is None or (match.group() == b"\r" and match.end() == len(buffer)):
                break
            line, buffer = buffer[: match.start()], buffer[match.end() :]
            data = decode(line)
            if data is not None:
                yield data
        if len(buffer) > max_event_bytes:
            raise _EventTooLargeError(f"SSE event exceeds {max_event_bytes} bytes")
    if buffer.endswith(b"\r"):
        # The body ended on a CR, which ends its line.
        data = decode(buffer[:-1])
        if data is not None:
            yield data
    # Otherwise an unterminated last line, or an event without its blank line, is discarded.


async def stream_over_http(
    url: str,
    args: dict[str, Any] | None,
    *,
    headers: dict[str, str] | None = None,
    session_id: str | None = None,
    timeout: float | None = None,
    cancel: asyncio.Event | None = None,
    connect_timeout: float | None = None,
    max_event_bytes: int = DEFAULT_MAX_STREAM_EVENT_BYTES,
) -> AsyncIterator[dict[str, Any]]:
    """POST ``args`` to ``url`` and yield its stream chunks (wire format, camelCase).

    Args:
        url: The ``/stream/<command>`` URL.
        args: The command's input.
        headers: Extra request headers.
        session_id: Sent as ``Mcp-Session-Id``, so the stream runs in the client's MCP
            session and sees its active context.
        timeout: Seconds the whole stream may take; ``None`` for no deadline.
        cancel: Set it to stop the stream with ``STREAM_CANCELLED``.
        connect_timeout: Seconds to wait for the connection.
        max_event_bytes: The largest event accepted.
    """
    import httpx

    queue: asyncio.Queue[tuple[str, Any]] = asyncio.Queue(maxsize=1)
    request_headers = {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        **(headers or {}),
        **({"Mcp-Session-Id": session_id} if session_id else {}),
    }

    async def produce() -> None:
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(None, connect=connect_timeout)
            ) as http, http.stream(
                "POST", url, json=args or {}, headers=request_headers
            ) as response:
                if not response.is_success:
                    body = await response.aread()
                    error = http_failure(response.status_code, response.reason_phrase, body)
                    await queue.put(("error", (error, False)))
                    return
                async for data in _read_events(response, max_event_bytes):
                    if data == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    if is_stream_chunk(chunk):
                        await queue.put(("chunk", chunk))
            await queue.put(("end", None))
        except _EventTooLargeError as exc:
            await queue.put(("error", ({
                "code": "STREAM_EVENT_TOO_LARGE",
                "message": str(exc),
                "suggestion": (
                    "Have the command emit smaller chunks, or raise max_stream_event_bytes "
                    "in the client config"
                ),
                "retryable": False,
            }, False)))
        except Exception as exc:  # noqa: BLE001 - every failure becomes an error chunk
            await queue.put(("error", (connection_error(exc), True)))

    loop = asyncio.get_running_loop()
    deadline = None if timeout is None else loop.time() + timeout
    producer = asyncio.ensure_future(produce())
    count = 0
    try:
        while True:
            getter = asyncio.ensure_future(queue.get())
            waiters: set[asyncio.Future[Any]] = {getter}
            cancelled = asyncio.ensure_future(cancel.wait()) if cancel is not None else None
            if cancelled is not None:
                waiters.add(cancelled)
            remaining = None if deadline is None else max(0.0, deadline - loop.time())
            done, _ = await asyncio.wait(
                waiters, timeout=remaining, return_when=asyncio.FIRST_COMPLETED
            )
            if cancelled is not None and not cancelled.done():
                cancelled.cancel()
            if getter not in done:
                getter.cancel()
                if cancel is not None and cancel.is_set():
                    yield stream_error_chunk({
                        "code": "STREAM_CANCELLED",
                        "message": "Stream was cancelled by the caller",
                        "suggestion": "The request was aborted by the client",
                    }, count)
                else:
                    yield stream_error_chunk({
                        "code": "STREAM_TIMEOUT",
                        "message": f"Stream did not finish within {round(timeout * 1000)}ms",
                        "suggestion": (
                            "Retry with a larger timeout. The command may still have run, "
                            "so check its effect before retrying a mutation."
                        ),
                        "retryable": True,
                    }, count)
                return
            kind, value = getter.result()
            if kind == "end":
                yield stream_error_chunk(dict(TRUNCATED), count)
                return
            if kind == "error":
                error, recoverable = value
                yield stream_error_chunk(error, count, recoverable)
                return
            yield value
            if value.get("type") in ("complete", "error"):
                return
            count += 1
    finally:
        producer.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await producer
