"""Tests for llm_chat_stream — streaming a chat turn as afd chunks."""

from __future__ import annotations

import asyncio
import threading
from types import SimpleNamespace

import pytest
from afd.testing import assert_error, assert_success

from botcore_llm.chat_stream import llm_chat_stream
from botcore_llm.commands import llm_chat
from botcore_llm.session import get_session_registry


def _delta(
    text: str, *, agent_id: str | None = None, parent: str | None = None, message_id: str = "msg-1"
):
    return SimpleNamespace(
        type=SimpleNamespace(value="assistant.message_delta"),
        agent_id=agent_id,
        data=SimpleNamespace(delta_content=text, message_id=message_id, parent_tool_call_id=parent),
    )


def _tool_start(name: str):
    return SimpleNamespace(
        type="tool.execution_start",
        agent_id=None,
        data=SimpleNamespace(tool_name=name, parent_tool_call_id=None),
    )


def _final(content: str, message_id: str = "msg-1"):
    return SimpleNamespace(data=SimpleNamespace(content=content, message_id=message_id))


class FakeSession:
    """Copilot session stand-in: emits events to handlers while send_and_wait runs."""

    def __init__(self, events=(), final=None, raises=None, hang=False, thread=False, late=False):
        self.session_id = "s-1"
        self._events = list(events)
        self._final = final
        self._raises = raises
        self._hang = hang
        self._thread = thread
        # late: deliver events on the loop just after send_and_wait returns.
        self._late = late
        self.handlers = []
        self.sent = []
        self.aborted = 0
        self.unsubscribed = 0

    def on(self, handler):
        self.handlers.append(handler)

        def unsubscribe():
            self.unsubscribed += 1
            self.handlers.remove(handler)

        return unsubscribe

    def _emit(self, event):
        for handler in list(self.handlers):
            handler(event)

    async def send_and_wait(self, message, **kwargs):
        self.sent.append((message, kwargs))
        if self._late:
            loop = asyncio.get_running_loop()
            for event in self._events:
                loop.call_soon(self._emit, event)
            return self._final
        for event in self._events:
            if self._thread:
                worker = threading.Thread(target=self._emit, args=(event,))
                worker.start()
                worker.join()
            else:
                self._emit(event)
            await asyncio.sleep(0)
        if self._hang:
            await asyncio.Event().wait()
        if self._raises is not None:
            raise self._raises
        return self._final

    async def abort(self):
        self.aborted += 1


@pytest.fixture()
def register():
    registry = get_session_registry()
    ids: list[str] = []

    def _register(session: FakeSession) -> str:
        registry.register(session.session_id, session, model="test-model")
        ids.append(session.session_id)
        return session.session_id

    yield _register
    for session_id in ids:
        registry.remove(session_id)


async def _collect(session_id: str, message: str = "hi", **kwargs):
    return [chunk async for chunk in llm_chat_stream(session_id, message, **kwargs)]


async def test_streams_deltas_then_completes(register) -> None:
    session = FakeSession(
        events=[_delta("Hel"), _delta("lo "), _delta("there")], final=_final("Hello there")
    )
    chunks = await _collect(register(session), attachments=[{"type": "file"}], timeout=5.0)

    assert [c.type for c in chunks] == ["progress", "data", "data", "data", "complete"]
    data = [c for c in chunks if c.type == "data"]
    assert [(c.data["text"], c.index, c.is_last) for c in data] == [
        ("Hel", 0, False),
        ("lo ", 1, False),
        ("there", 2, True),
    ]
    complete = chunks[-1]
    assert complete.total_chunks == 3
    assert complete.data == {"session_id": "s-1", "message_id": "msg-1", "content": "Hello there"}
    assert session.sent == [("hi", {"attachments": [{"type": "file"}], "timeout": 5.0})]
    assert session.unsubscribed == 1
    assert session.aborted == 0


async def test_ignores_sub_agent_and_nested_tool_deltas(register) -> None:
    events = [
        _delta("A"),
        _delta("sub", agent_id="helper"),
        _delta("tool", parent="call-1"),
        _delta("B"),
    ]
    chunks = await _collect(register(FakeSession(events=events, final=_final("AB"))))

    assert "".join(c.data["text"] for c in chunks if c.type == "data") == "AB"


async def test_tool_start_is_a_progress_chunk(register) -> None:
    events = [_tool_start("grep"), _delta("done")]
    chunks = await _collect(register(FakeSession(events=events, final=_final("done"))))

    progress = [c.message for c in chunks if c.type == "progress"]
    assert progress == ["Message sent", "Running grep"]


async def test_without_deltas_sends_the_final_message_as_one_chunk(register) -> None:
    """With streaming off, the final message still arrives as a data chunk."""
    chunks = await _collect(register(FakeSession(final=_final("Whole reply"))))

    data = [c for c in chunks if c.type == "data"]
    assert [(c.data["text"], c.index, c.is_last) for c in data] == [("Whole reply", 0, True)]
    assert chunks[-1].data["content"] == "Whole reply"


async def test_final_message_fills_in_missing_tail(register) -> None:
    chunks = await _collect(
        register(FakeSession(events=[_delta("Hello")], final=_final("Hello world")))
    )

    data = [c for c in chunks if c.type == "data"]
    assert [(c.data["text"], c.is_last) for c in data] == [("Hello", False), (" world", True)]
    assert "".join(c.data["text"] for c in data) == chunks[-1].data["content"]


async def test_deltas_from_another_thread(register) -> None:
    events = [_delta("one "), _delta("two")]
    chunks = await _collect(
        register(FakeSession(events=events, final=_final("one two"), thread=True))
    )

    assert "".join(c.data["text"] for c in chunks if c.type == "data") == "one two"


async def test_send_failure_is_an_error_chunk(register) -> None:
    session = FakeSession(events=[_delta("a"), _delta("b")], raises=TimeoutError("timed out"))
    chunks = await _collect(register(session))

    error_chunk = chunks[-1]
    assert error_chunk.type == "error"
    assert error_chunk.error.code == "CHAT_ERROR"
    assert "timed out" in error_chunk.error.message
    assert error_chunk.error.suggestion
    assert error_chunk.chunks_before_error == 2
    data = [c for c in chunks if c.type == "data"]
    assert [(c.data["text"], c.is_last) for c in data] == [("a", False), ("b", True)]
    assert session.unsubscribed == 1


async def test_unknown_session_is_an_error_chunk() -> None:
    chunks = await _collect("missing")

    assert [c.type for c in chunks] == ["error"]
    assert chunks[0].error.code == "SESSION_NOT_FOUND"


async def test_closing_early_aborts_the_turn(register) -> None:
    session = FakeSession(events=[_delta("first"), _delta("second")], hang=True)
    stream = llm_chat_stream(register(session), "hi")
    async for chunk in stream:
        if chunk.type == "data":
            break
    await stream.aclose()

    assert session.aborted == 1
    assert session.unsubscribed == 1


async def test_llm_chat_collects_the_stream(register) -> None:
    session = FakeSession(events=[_delta("Hi")], final=_final("Hi"))
    result = await llm_chat(register(session), "hello")

    assert assert_success(result) == {"session_id": "s-1", "message_id": "msg-1", "content": "Hi"}


async def test_llm_chat_reports_send_failure(register) -> None:
    result = await llm_chat(register(FakeSession(raises=RuntimeError("gone"))), "hello")

    assert_error(result, "CHAT_ERROR")
    assert result.error.suggestion


async def test_data_chunks_carry_message_id(register) -> None:
    chunks = await _collect(register(FakeSession(events=[_delta("Hi")], final=_final("Hi"))))

    assert [c.data for c in chunks if c.type == "data"] == [{"text": "Hi", "message_id": "msg-1"}]


async def test_events_landing_as_the_turn_finishes_are_drained(register) -> None:
    """Events handed over just after the turn completes are still streamed."""
    events = [_delta("a"), _delta("b"), _delta("c")]
    chunks = await _collect(register(FakeSession(events=events, final=_final("abc"), late=True)))

    assert [c.type for c in chunks] == ["progress", "data", "data", "data", "complete"]
    assert "".join(c.data["text"] for c in chunks if c.type == "data") == "abc"


async def test_turn_with_several_messages(register) -> None:
    """A tool-using turn streams every message; the final one's chunks join to content."""
    events = [
        _delta("Let me check. ", message_id="m1"),
        _tool_start("grep"),
        _delta("Ans", message_id="m2"),
        _delta("wer", message_id="m2"),
    ]
    chunks = await _collect(register(FakeSession(events=events, final=_final("Answer", "m2"))))

    complete = chunks[-1]
    assert complete.data["message_id"] == "m2"
    assert complete.data["content"] == "Answer"
    data = [c.data for c in chunks if c.type == "data"]
    assert "".join(d["text"] for d in data) == "Let me check. Answer"
    assert "".join(d["text"] for d in data if d["message_id"] == "m2") == "Answer"


async def test_cancelling_the_consumer_aborts_the_turn(register) -> None:
    session = FakeSession(events=[_delta("first")], hang=True)
    session_id = register(session)
    first_data = asyncio.Event()

    async def consume():
        async for chunk in llm_chat_stream(session_id, "hi"):
            if chunk.type == "data":
                first_data.set()

    task = asyncio.create_task(consume())
    # The held-back piece is only released by a later event, so wait for the subscription.
    while not session.handlers:
        await asyncio.sleep(0)
    for _ in range(5):
        await asyncio.sleep(0)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert session.aborted == 1
    assert session.unsubscribed == 1
    assert not first_data.is_set()


async def test_llm_chat_unsubscribes_before_returning(register) -> None:
    session = FakeSession(events=[_delta("Hi")], final=_final("Hi"))
    await llm_chat(register(session), "hello")

    assert session.unsubscribed == 1
    assert session.handlers == []


async def test_llm_chat_cancellation_aborts_the_turn(register) -> None:
    session = FakeSession(hang=True)
    task = asyncio.create_task(llm_chat(register(session), "hello"))
    while not session.handlers:
        await asyncio.sleep(0)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert session.aborted == 1
    assert session.unsubscribed == 1


async def test_without_a_final_message_content_is_the_streamed_text(register) -> None:
    """If the SDK returns no final message, the last streamed message is the reply."""
    session = FakeSession(events=[_delta("Partial reply")], final=None)
    result = await llm_chat(register(session), "hello")

    data = assert_success(result)
    assert data == {"session_id": "s-1", "message_id": "msg-1", "content": "Partial reply"}
