"""Tests for agent task progress streaming (assign_task_stream / resume_task_stream)."""

from __future__ import annotations

import asyncio
from unittest.mock import patch

import pytest
from afd import error
from afd.core.streaming import create_complete_chunk, create_data_chunk, create_progress_chunk
from afd.testing import assert_error, assert_success

import botcore_agents.commands as commands_mod
from botcore_agents.models import Task
from botcore_agents.orchestrator import AgentOrchestrator


async def _started(orchestrator: AgentOrchestrator, name: str = "researcher") -> None:
    await orchestrator.create_agent(name)
    await orchestrator.start_agent(name)


async def _collect(stream):
    return [chunk async for chunk in stream]


def _chat_stream(*pieces: str, hang: bool = False):
    """A fake llm_chat_stream that streams *pieces*, then completes or hangs."""

    async def fake(session_id, message, attachments=None, timeout=None):
        yield create_progress_chunk(0.0, message="Message sent", phase="send")
        yield create_progress_chunk(0.0, message="Running grep", phase="tool")
        for i, piece in enumerate(pieces):
            last = i == len(pieces) - 1 and not hang
            yield create_data_chunk({"text": piece, "message_id": "m1"}, index=i, is_last=last)
        if hang:
            await asyncio.Event().wait()
        content = "".join(pieces)
        data = {"session_id": session_id, "message_id": "m1", "content": content}
        yield create_complete_chunk(total_chunks=len(pieces), total_duration_ms=0, data=data)

    return patch("botcore_agents.task_stream.llm_chat_stream", fake)


class TestAssignTaskStream:
    async def test_streams_progress_text_and_result(self, orchestrator, mock_llm):
        await _started(orchestrator)
        with _chat_stream("Found ", "three ", "files"):
            chunks = await _collect(
                orchestrator.assign_task_stream("Find files", agent="researcher")
            )

        assert [c.type for c in chunks] == [
            "progress",
            "progress",
            "progress",
            "data",
            "data",
            "data",
            "complete",
        ]
        task_id = chunks[-1].data["task_id"]
        assert chunks[0].phase == "started"
        assert task_id in chunks[0].message and "researcher" in chunks[0].message
        assert [c.message for c in chunks[1:3]] == ["Message sent", "Running grep"]
        data = [c for c in chunks if c.type == "data"]
        assert [(c.data["text"], c.index, c.is_last) for c in data] == [
            ("Found ", 0, False),
            ("three ", 1, False),
            ("files", 2, True),
        ]
        assert {c.data["task_id"] for c in data} == {task_id}
        complete = chunks[-1]
        assert complete.total_chunks == 3
        assert complete.data == {
            "task_id": task_id,
            "status": "completed",
            "result": "Found three files",
            "agent": "researcher",
        }
        assert orchestrator.tasks[task_id].result == "Found three files"
        assert orchestrator.get_agent_status("researcher").data["status"] == "idle"

    async def test_role_resolution(self, orchestrator, mock_llm):
        chunks = await _collect(orchestrator.assign_task_stream("Research", role="researcher"))

        assert chunks[-1].type == "complete"
        assert chunks[-1].data["agent"].startswith("researcher")

    @pytest.mark.parametrize(
        ("kwargs", "code"),
        [({}, "NO_TARGET"), ({"agent": "ghost"}, "AGENT_NOT_FOUND")],
    )
    async def test_target_errors_create_no_task(self, orchestrator, mock_llm, kwargs, code):
        chunks = await _collect(orchestrator.assign_task_stream("Work", **kwargs))

        assert [c.type for c in chunks] == ["error"]
        assert chunks[0].error.code == code
        assert orchestrator.tasks == {}

    async def test_chat_failure_fails_the_task(self, orchestrator, mock_llm):
        mock_llm["chat"].return_value = error("CHAT_ERROR", "LLM failed")
        await _started(orchestrator)

        chunks = await _collect(orchestrator.assign_task_stream("Bad task", agent="researcher"))

        err = chunks[-1]
        assert err.type == "error"
        assert err.error.code == "TASK_EXECUTION_ERROR"
        assert "LLM failed" in err.error.message
        assert err.error.suggestion
        (task,) = orchestrator.tasks.values()
        assert task.status == "failed"
        health = orchestrator.get_agent_status("researcher").data
        assert health["status"] == "idle"
        assert health["tasks_failed"] == 1

    async def test_closing_early_cancels_the_task(self, orchestrator, mock_llm):
        await _started(orchestrator)
        with _chat_stream("partial", hang=True):
            stream = orchestrator.assign_task_stream("Long task", agent="researcher")
            async for chunk in stream:
                if chunk.type == "data":
                    break
            await stream.aclose()

        (task,) = orchestrator.tasks.values()
        assert task.status == "cancelled"
        assert task.completed_at is not None
        health = orchestrator.get_agent_status("researcher").data
        assert health["status"] == "idle"
        assert health["current_task"] == ""
        assert health["tasks_completed"] == 0
        assert health["tasks_failed"] == 0

    async def test_cancelling_the_consumer_cancels_the_task(self, orchestrator, mock_llm):
        await _started(orchestrator)
        seen = asyncio.Event()

        async def consume():
            async for chunk in orchestrator.assign_task_stream("Long task", agent="researcher"):
                if chunk.type == "data":
                    seen.set()

        with _chat_stream("partial", hang=True):
            task = asyncio.create_task(consume())
            await seen.wait()
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task

        (record,) = orchestrator.tasks.values()
        assert record.status == "cancelled"
        assert orchestrator.get_agent_status("researcher").data["status"] == "idle"

    async def test_stopping_the_agent_mid_task(self, orchestrator, mock_llm):
        """stop_agent cancels the running task; the stream reports it, the agent stays stopped."""
        await _started(orchestrator)
        chunks = []

        async def consume():
            async for chunk in orchestrator.assign_task_stream("Long task", agent="researcher"):
                chunks.append(chunk)
                if chunk.type == "data":
                    await orchestrator.stop_agent("researcher")

        with _chat_stream("partial", "rest"):
            await consume()

        assert chunks[-1].type == "error"
        assert chunks[-1].error.code == "TASK_CANCELLED"
        assert chunks[-1].error.suggestion
        (task,) = orchestrator.tasks.values()
        assert task.status == "cancelled"
        assert orchestrator.get_agent_status("researcher").data["status"] == "stopped"

    async def test_agent_deleted_mid_task(self, orchestrator, mock_llm):
        """Stopping and deleting the agent mid-task still ends with a result, not a crash."""
        await _started(orchestrator)

        async def stop_and_delete_on_data():
            async for chunk in orchestrator.assign_task_stream("Long task", agent="researcher"):
                if chunk.type == "data":
                    await orchestrator.stop_agent("researcher")
                    await orchestrator.delete_agent("researcher")
            return chunk

        with _chat_stream("partial", "rest"):
            last = await stop_and_delete_on_data()

        assert last.type == "error"
        assert last.error.code == "TASK_CANCELLED"
        assert "researcher" not in orchestrator.agents

    async def test_replacement_agent_with_same_name_is_untouched(self, orchestrator, mock_llm):
        """Finishing an old task does not change a new agent created under the same name."""
        await _started(orchestrator)

        async def replace_on_data():
            async for chunk in orchestrator.assign_task_stream("Long task", agent="researcher"):
                if chunk.type == "data":
                    await orchestrator.stop_agent("researcher")
                    await orchestrator.delete_agent("researcher")
                    await _started(orchestrator)
                    replacement = orchestrator._agents["researcher"]
                    replacement.health.status = "busy"
                    replacement.health.current_task = "other"

        with _chat_stream("partial", "rest"):
            await replace_on_data()

        health = orchestrator.get_agent_status("researcher").data
        assert health["current_task"] == "other"
        assert health["status"] == "busy"

    async def test_closing_early_closes_the_chat_stream(self, orchestrator, mock_llm):
        await _started(orchestrator)
        closed = []

        async def chat(session_id, message, attachments=None, timeout=None):
            try:
                yield create_data_chunk(
                    {"text": "partial", "message_id": "m1"}, index=0, is_last=False
                )
                await asyncio.Event().wait()
            finally:
                closed.append(True)

        with patch("botcore_agents.task_stream.llm_chat_stream", chat):
            stream = orchestrator.assign_task_stream("Long task", agent="researcher")
            async for chunk in stream:
                if chunk.type == "data":
                    break
            await stream.aclose()

        assert closed == [True]

    async def test_chat_stream_without_a_result_fails_the_task(self, orchestrator, mock_llm):
        await _started(orchestrator)

        async def chat(session_id, message, attachments=None, timeout=None):
            yield create_data_chunk({"text": "cut off", "message_id": "m1"}, index=0, is_last=True)

        with patch("botcore_agents.task_stream.llm_chat_stream", chat):
            chunks = await _collect(orchestrator.assign_task_stream("Task", agent="researcher"))

        assert chunks[-1].type == "error"
        assert chunks[-1].error.code == "TASK_EXECUTION_ERROR"
        assert "without a result" in chunks[-1].error.message
        assert chunks[-1].chunks_before_error == 1


class TestResumeTaskStream:
    async def test_resumes_a_pending_task(self, orchestrator, mock_llm):
        await _started(orchestrator)
        task = Task(description="Resume work", status="pending")
        orchestrator._tasks[task.id] = task

        with _chat_stream("done"):
            chunks = await _collect(orchestrator.resume_task_stream(task.id, agent="researcher"))

        assert chunks[-1].type == "complete"
        assert chunks[-1].data["task_id"] == task.id
        assert {c.data["task_id"] for c in chunks if c.type == "data"} == {task.id}
        assert orchestrator.tasks[task.id].status == "completed"

    async def test_rejects_a_finished_task(self, orchestrator, mock_llm):
        task = Task(description="Already done", status="completed")
        orchestrator._tasks[task.id] = task

        chunks = await _collect(orchestrator.resume_task_stream(task.id, agent="researcher"))

        assert [c.type for c in chunks] == ["error"]
        assert chunks[0].error.code == "TASK_NOT_RESUMABLE"


class TestCollectors:
    async def test_assign_task_returns_the_streamed_result(self, orchestrator, mock_llm):
        await _started(orchestrator)
        with _chat_stream("All ", "good"):
            result = await orchestrator.assign_task("Check", agent="researcher")

        data = assert_success(result)
        assert data["result"] == "All good"
        assert data["status"] == "completed"

    async def test_task_assign_stream_command(self, orchestrator, mock_llm):
        await _started(orchestrator)
        with patch.object(commands_mod, "_get_orch", return_value=orchestrator):
            chunks = await _collect(commands_mod.task_assign_stream("Work", agent="researcher"))
            result = await commands_mod.task_resume("missing")

        assert chunks[-1].type == "complete"
        assert_error(result, "TASK_NOT_FOUND")


class TestPartialOutput:
    """task_status shows a running task's streamed text and latest progress (#37)."""

    async def test_task_status_while_running(self, orchestrator, mock_llm):
        await _started(orchestrator)
        seen = []

        async def consume():
            async for chunk in orchestrator.assign_task_stream("Long task", agent="researcher"):
                task_id = chunk.data["task_id"] if chunk.type == "data" else None
                if chunk.type == "progress" and chunk.phase == "started":
                    (task_id,) = orchestrator.tasks
                if task_id:
                    seen.append((chunk.type, orchestrator.get_task(task_id).data))
            return chunk

        with _chat_stream("Found ", "three ", "files"):
            last = await consume()

        started = seen[0][1]
        assert started["status"] == "running"
        assert started["partial_result"] == ""
        assert started["progress_message"] == "Started on researcher"
        data = [d for kind, d in seen if kind == "data"]
        assert [d["partial_result"] for d in data] == [
            "Found ",
            "Found three ",
            "Found three files",
        ]
        assert {d["progress_message"] for d in data} == {"Running grep"}

        finished = orchestrator.get_task(last.data["task_id"]).data
        assert finished["result"] == "Found three files"
        assert "partial_result" not in finished
        assert "progress_message" not in finished
        assert orchestrator._progress == {}

    async def test_task_status_while_task_assign_runs(self, orchestrator, mock_llm):
        """Poll task_status from another coroutine while the non-streaming task_assign runs."""
        await _started(orchestrator)
        with (
            _chat_stream("partial ", "text", hang=True),
            patch.object(commands_mod, "_get_orch", return_value=orchestrator),
        ):
            assign = asyncio.create_task(commands_mod.task_assign("Long task", agent="researcher"))
            status = {}
            for _ in range(100):
                await asyncio.sleep(0)
                if orchestrator.tasks:
                    (task_id,) = orchestrator.tasks
                    status = assert_success(await commands_mod.task_status(task_id))
                    if status.get("partial_result") == "partial text":
                        break
            assign.cancel()
            with pytest.raises(asyncio.CancelledError):
                await assign

        assert status["status"] == "running"
        assert status["partial_result"] == "partial text"
        assert status["progress_message"] == "Running grep"
        assert orchestrator._progress == {}
        assert orchestrator.get_task(task_id).data["status"] == "cancelled"
        assert "partial_result" not in orchestrator.get_task(task_id).data

    async def test_messages_of_a_turn_are_separated(self, orchestrator, mock_llm):
        await _started(orchestrator)
        statuses = []

        async def chat(session_id, message, attachments=None, timeout=None):
            yield create_data_chunk(
                {"text": "Let me check.", "message_id": "m1"}, index=0, is_last=False
            )
            yield create_data_chunk({"text": "Found ", "message_id": "m2"}, index=1, is_last=False)
            yield create_data_chunk({"text": "it", "message_id": "m2"}, index=2, is_last=True)
            data = {"session_id": session_id, "message_id": "m2", "content": "Found it"}
            yield create_complete_chunk(total_chunks=3, total_duration_ms=0, data=data)

        with patch("botcore_agents.task_stream.llm_chat_stream", chat):
            async for chunk in orchestrator.assign_task_stream("Task", agent="researcher"):
                if chunk.type == "data":
                    statuses.append(orchestrator.get_task(chunk.data["task_id"]).data)

        assert statuses[-1]["partial_result"] == "Let me check.\n\nFound it"

    async def test_cleared_when_the_task_fails(self, orchestrator, mock_llm):
        await _started(orchestrator)

        async def chat(session_id, message, attachments=None, timeout=None):
            yield create_data_chunk({"text": "cut off", "message_id": "m1"}, index=0, is_last=True)

        with patch("botcore_agents.task_stream.llm_chat_stream", chat):
            chunks = await _collect(orchestrator.assign_task_stream("Task", agent="researcher"))

        assert chunks[-1].type == "error"
        (task,) = orchestrator.tasks.values()
        assert "partial_result" not in orchestrator.get_task(task.id).data
        assert orchestrator._progress == {}

    async def test_hidden_once_the_agent_is_stopped(self, orchestrator, mock_llm):
        """stop_agent cancels the task; task_status shows it cancelled, without partial output."""
        await _started(orchestrator)
        statuses = []
        progress_after_stop = []

        async def consume():
            async for chunk in orchestrator.assign_task_stream("Long task", agent="researcher"):
                if chunk.type == "data":
                    await orchestrator.stop_agent("researcher")
                    statuses.append(orchestrator.get_task(chunk.data["task_id"]).data)
                    progress_after_stop.append(dict(orchestrator._progress))

        with _chat_stream("partial", "rest"):
            await consume()

        assert statuses[0]["status"] == "cancelled"
        assert "partial_result" not in statuses[0]
        assert progress_after_stop[0] == {}
        assert orchestrator._progress == {}

    async def test_cleared_on_state_restore(self, orchestrator, mock_llm):
        await _started(orchestrator)
        with _chat_stream("partial", hang=True):
            stream = orchestrator.assign_task_stream("Long task", agent="researcher")
            async for chunk in stream:
                if chunk.type == "data":
                    break
            orchestrator._restore_from_snapshot(orchestrator._build_snapshot())
            progress_after_restore = dict(orchestrator._progress)
            (task_id,) = orchestrator.tasks
            restored = orchestrator.get_task(task_id).data
            await stream.aclose()

        assert progress_after_restore == {}
        assert restored["status"] == "pending"
        assert "partial_result" not in restored

    async def test_old_run_does_not_clear_a_resumed_run(self, orchestrator, mock_llm):
        """After a restore and resume, the old stream ending leaves the new run's progress."""
        await _started(orchestrator)
        with _chat_stream("old", hang=True):
            old = orchestrator.assign_task_stream("Long task", agent="researcher")
            async for chunk in old:
                if chunk.type == "data":
                    break
            orchestrator._restore_from_snapshot(orchestrator._build_snapshot())
            (task_id,) = orchestrator.tasks
            # Restored agents come back stopped; start it again for the new run.
            await orchestrator.start_agent("researcher")
            new = orchestrator.resume_task_stream(task_id, agent="researcher")
            async for chunk in new:
                if chunk.type == "data":
                    break
            await old.aclose()
            status = orchestrator.get_task(task_id).data
            await new.aclose()

        assert status["status"] == "running"
        assert status["partial_result"] == "old"
        assert orchestrator._progress == {}
