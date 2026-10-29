"""Streaming chat — ``llm_chat_stream`` yields a chat turn as afd stream chunks.

Not registered as a command: registered commands are bridged into Copilot tools,
which must return a single CommandResult. ``llm_chat`` collects this stream.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from collections.abc import AsyncIterator
from typing import Any

from afd import CommandResult, error, success
from afd.core.errors import CommandError
from afd.core.streaming import (
    StreamChunk,
    create_complete_chunk,
    create_data_chunk,
    create_error_chunk,
    create_progress_chunk,
    is_complete_chunk,
    is_error_chunk,
)

from .session import get_session_registry

logger = logging.getLogger(__name__)

_MESSAGE_DELTA = "assistant.message_delta"
_TOOL_START = "tool.execution_start"


def _event_type(event: Any) -> str:
    kind = getattr(event, "type", "")
    return getattr(kind, "value", kind)


def _is_root_turn_event(event: Any) -> bool:
    """True for events from the main agent, not a sub-agent or a nested tool call."""
    data = getattr(event, "data", None)
    return not getattr(event, "agent_id", None) and not getattr(data, "parent_tool_call_id", None)


def _error_chunk(code: str, message: str, suggestion: str, chunks_before_error: int = 0):
    return create_error_chunk(
        CommandError(code=code, message=message, suggestion=suggestion),
        chunks_before_error=chunks_before_error,
    )


async def llm_chat_stream(
    session_id: str,
    message: str,
    attachments: list[dict] | None = None,
    timeout: float | None = None,
) -> AsyncIterator[StreamChunk]:
    """Send a message to an active LLM session and stream the reply.

    Yields a progress chunk when the message is sent and for each tool the
    assistant starts, a data chunk ``{"text": ..., "message_id": ...}`` for each
    piece of the reply, then a complete chunk with ``session_id``, ``message_id``
    and ``content``, or an error chunk.

    A turn that uses tools can contain several assistant messages; the data
    chunks stream all of them, and ``content`` is the final one. Joining the text
    of the data chunks whose ``message_id`` matches the complete chunk's gives
    ``content``.

    Closing the generator early, or cancelling its consumer, aborts the turn.
    Without ``timeout``, the Copilot SDK's default of 60 seconds applies.
    """
    entry = get_session_registry().get(session_id)
    if entry is None:
        yield _error_chunk(
            "SESSION_NOT_FOUND",
            f"No session with id {session_id!r}",
            "Use llm_session_list to see active sessions",
        )
        return

    session = entry.session
    send_options: dict[str, Any] = {}
    if attachments:
        send_options["attachments"] = attachments
    # The SDK default (60s) applies when no timeout is given; it rejects None.
    if timeout is not None:
        send_options["timeout"] = timeout

    started = time.monotonic()
    loop = asyncio.get_running_loop()
    events: asyncio.Queue[Any] = asyncio.Queue()

    def on_event(event: Any) -> None:
        # The SDK may dispatch from another thread; hand events to this loop.
        if _event_type(event) in (_MESSAGE_DELTA, _TOOL_START) and _is_root_turn_event(event):
            loop.call_soon_threadsafe(events.put_nowait, event)

    unsubscribe = session.on(on_event)
    turn = asyncio.create_task(session.send_and_wait(message, **send_options))
    next_event: asyncio.Future[Any] | None = None
    # Text streamed so far for each assistant message in the turn.
    streamed: dict[str, str] = {}
    # Hold back one piece so the last data chunk can be marked is_last.
    pending: dict[str, str] | None = None
    index = 0
    try:
        yield create_progress_chunk(0.0, message="Message sent", phase="send")
        while True:
            next_event = asyncio.ensure_future(events.get())
            await asyncio.wait({next_event, turn}, return_when=asyncio.FIRST_COMPLETED)
            if not next_event.done():
                next_event.cancel()
                # Give events handed over from another thread as the turn ended one
                # more loop iteration to land before deciding the stream is done.
                await asyncio.sleep(0)
                if events.empty():
                    break
                continue
            event = next_event.result()
            if _event_type(event) == _TOOL_START:
                tool = getattr(event.data, "tool_name", None) or "tool"
                yield create_progress_chunk(0.0, message=f"Running {tool}", phase="tool")
                continue
            text = getattr(event.data, "delta_content", "") or ""
            if not text:
                continue
            delta_id = getattr(event.data, "message_id", "") or ""
            streamed[delta_id] = streamed.get(delta_id, "") + text
            if pending is not None:
                yield create_data_chunk(pending, index=index, is_last=False)
                index += 1
            pending = {"text": text, "message_id": delta_id}

        try:
            final = turn.result()
        except Exception as exc:
            if pending is not None:
                yield create_data_chunk(pending, index=index, is_last=True)
                index += 1
            yield _error_chunk(
                "CHAT_ERROR",
                f"Failed to send message: {exc}",
                "The session may have been destroyed or timed out",
                chunks_before_error=index,
            )
            return

        message_id = pending["message_id"] if pending is not None else ""
        content = streamed.get(message_id, "")
        if final is not None and hasattr(final, "data"):
            message_id = getattr(final.data, "message_id", "") or message_id
            content = getattr(final.data, "content", "") or streamed.get(message_id, "")
        # The final message is authoritative; send whatever its deltas did not cover.
        covered = streamed.get(message_id, "")
        if content.startswith(covered) and len(content) > len(covered):
            if pending is not None:
                yield create_data_chunk(pending, index=index, is_last=False)
                index += 1
            pending = {"text": content[len(covered) :], "message_id": message_id}
        if pending is not None:
            yield create_data_chunk(pending, index=index, is_last=True)
            index += 1

        yield create_complete_chunk(
            total_chunks=index,
            total_duration_ms=(time.monotonic() - started) * 1000,
            data={"session_id": session_id, "message_id": message_id, "content": content},
            reasoning="Chat response received",
        )
    finally:
        unsubscribe()
        if next_event is not None and not next_event.done():
            next_event.cancel()
        if not turn.done():
            # The consumer stopped early or was cancelled: stop waiting and abort the turn.
            turn.cancel()
            with contextlib.suppress(BaseException):
                await turn
            try:
                await session.abort()
            except Exception:
                logger.warning("Failed to abort chat turn in session %s", session_id)


def chat_result(chunk: StreamChunk) -> CommandResult[dict] | None:
    """Convert a terminal ``llm_chat_stream`` chunk into a CommandResult.

    Returns None for progress and data chunks.
    """
    if is_error_chunk(chunk):
        err = chunk.error
        return error(err.code, err.message, suggestion=err.suggestion)
    if is_complete_chunk(chunk):
        return success(data=chunk.data, reasoning=chunk.reasoning)
    return None
