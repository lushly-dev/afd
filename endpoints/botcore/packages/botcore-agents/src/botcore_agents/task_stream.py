"""Task progress streaming — run an agent task as afd stream chunks.

``stream_assign`` and ``stream_resume`` back ``AgentOrchestrator.assign_task_stream``
and ``resume_task_stream``; ``assign_task`` and ``resume_task`` collect them. The
streams are not registered commands: registered commands can be bridged into
Copilot tools, which must return a single CommandResult.

This module is the orchestrator's task-execution path, split out of
``orchestrator.py`` for its line limit, so it uses the orchestrator's private
helpers (``_resolve_execution_target``, ``_begin_task``, ``_finish_task``).
"""

from __future__ import annotations

import contextlib
import logging
import time
from collections.abc import AsyncIterator
from typing import TYPE_CHECKING

from afd import CommandResult, error, success
from afd.core.streaming import (
    StreamChunk,
    create_complete_chunk,
    create_data_chunk,
    create_error_chunk,
    create_progress_chunk,
    is_complete_chunk,
    is_error_chunk,
)
from botcore_llm.chat_stream import llm_chat_stream

from .models import Task

if TYPE_CHECKING:
    from .orchestrator import AgentOrchestrator

logger = logging.getLogger(__name__)


def _error_chunk(result: CommandResult, chunks_before_error: int = 0) -> StreamChunk:
    return create_error_chunk(result.error, chunks_before_error=chunks_before_error)


def _terminal_chunk(
    result: CommandResult[dict], data_chunks: int, duration_ms: float
) -> StreamChunk:
    if not result.success:
        return _error_chunk(result, chunks_before_error=data_chunks)
    return create_complete_chunk(
        total_chunks=data_chunks,
        total_duration_ms=duration_ms,
        data=result.data,
        reasoning=result.reasoning,
    )


async def _run(orch: AgentOrchestrator, task: Task, agent: str) -> AsyncIterator[StreamChunk]:
    """Execute *task* on *agent*, forwarding the agent's chat stream."""
    state = await orch._begin_task(task, agent)
    # Hold this run's entry: after a state restore, the id may be reused by a new run.
    progress = orch._progress[task.id]
    message_id = None
    started = time.monotonic()
    data_chunks = 0
    finished = False
    try:
        yield create_progress_chunk(
            0.0, message=f"Task {task.id} started on {agent}", phase="started"
        )
        status, result = "failed", "Chat stream ended without a result"
        session_id = state.session_id
        try:
            async with contextlib.aclosing(llm_chat_stream(session_id, task.description)) as chat:
                async for chunk in chat:
                    if chunk.type == "progress":
                        progress["progress_message"] = chunk.message or ""
                        yield create_progress_chunk(0.0, message=chunk.message, phase=chunk.phase)
                    elif chunk.type == "data":
                        data_chunks += 1
                        # Separate the messages of a tool-using turn.
                        if message_id is not None and chunk.data.get("message_id") != message_id:
                            progress["partial_result"] += "\n\n"
                        message_id = chunk.data.get("message_id")
                        progress["partial_result"] += chunk.data.get("text", "")
                        yield create_data_chunk(
                            {**chunk.data, "task_id": task.id},
                            index=chunk.index,
                            is_last=chunk.is_last,
                        )
                    elif is_complete_chunk(chunk):
                        status, result = "completed", chunk.data.get("content", "")
                    elif is_error_chunk(chunk):
                        status, result = "failed", chunk.error.message
        except Exception as exc:
            status, result = "failed", str(exc)
            logger.warning("Task %s execution error: %s", task.id, exc)

        outcome = await orch._finish_task(task, state, status, result)
        finished = True
        yield _terminal_chunk(outcome, data_chunks, (time.monotonic() - started) * 1000)
    finally:
        if not finished:
            # The consumer stopped early or was cancelled; the chat turn is already
            # aborted, so record the task as cancelled and free the agent.
            await orch._finish_task(task, state, "cancelled", "")


async def stream_assign(
    orch: AgentOrchestrator,
    description: str,
    agent: str = "",
    role: str = "",
    priority: int = 5,
) -> AsyncIterator[StreamChunk]:
    """Assign a task and stream its execution.

    Yields a progress chunk naming the task id and agent when the task starts,
    the agent's chat progress (tools started) and reply text as data chunks
    ``{"text", "message_id", "task_id"}``, then a complete chunk with the same
    data ``task_assign`` returns (``task_id``, ``status``, ``result``, ``agent``)
    or an error chunk. Closing the stream early aborts the chat turn and marks
    the task cancelled.
    """
    resolved = await orch._resolve_execution_target(agent=agent, role=role)
    if not resolved.success:
        yield _error_chunk(resolved)
        return

    task = Task(description=description, priority=priority)
    orch._tasks[task.id] = task
    async with contextlib.aclosing(_run(orch, task, resolved.data["name"])) as run:
        async for chunk in run:
            yield chunk


async def stream_resume(
    orch: AgentOrchestrator,
    task_id: str,
    agent: str = "",
    role: str = "",
) -> AsyncIterator[StreamChunk]:
    """Resume a pending or assigned task and stream its execution, as ``stream_assign``."""
    task = orch._tasks.get(task_id)
    if task is None:
        yield _error_chunk(error("TASK_NOT_FOUND", f"No task with id {task_id!r}"))
        return
    if task.status not in {"pending", "assigned"}:
        yield _error_chunk(
            error(
                "TASK_NOT_RESUMABLE",
                f"Task {task_id!r} is {task.status} and cannot be resumed",
                suggestion="Resume only pending or assigned tasks",
            )
        )
        return

    resolved = await orch._resolve_execution_target(agent=agent, role=role)
    if not resolved.success:
        yield _error_chunk(resolved)
        return

    task.result = ""
    task.completed_at = None
    async with contextlib.aclosing(_run(orch, task, resolved.data["name"])) as run:
        async for chunk in run:
            yield chunk


async def collect_task(stream: AsyncIterator[StreamChunk]) -> CommandResult[dict]:
    """Collect a task stream into the CommandResult the non-streaming commands return."""
    async with contextlib.aclosing(stream) as chunks:
        async for chunk in chunks:
            if is_error_chunk(chunk):
                err = chunk.error
                return error(
                    err.code,
                    err.message,
                    suggestion=err.suggestion,
                    retryable=err.retryable,
                    details=err.details,
                )
            if is_complete_chunk(chunk):
                return success(data=chunk.data, reasoning=chunk.reasoning)
    return error(
        "TASK_EXECUTION_ERROR",
        "Task stream ended without a result",
        suggestion="Check task_status, then assign the task again",
    )
