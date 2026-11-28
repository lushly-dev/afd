"""What the journal records for a call the engine stopped waiting for (#2678).

``spec/journal.md``, "Calls that end at a deadline". Each handler waits on an event the test
sets. A single call's deadline is short and passes while the handler waits; a batch's or a
pipeline's passes only when the test says so, after the handler started. Nothing here races a
timer.
"""

from __future__ import annotations

import asyncio
import contextlib
import types
from collections.abc import AsyncIterator, Iterable
from typing import Any

import pytest
from pydantic import BaseModel

import afd.core.command_execution as command_execution
import afd.core.pipeline as pipeline_module
from afd import JournalEntry, JournalRecord, MemoryJournalSink, success
from afd.core.commands import CommandContext, ExposeOptions
from afd.direct import DirectCallContext, DirectClient, DirectCommandRegistry
from afd.server import create_journal_middleware, create_server

DEADLINE_MS = 20
#: A batch or pipeline deadline that never passes by itself: the test expires it.
NEVER_MS = 600_000
#: How long a test waits for something it caused; it never waits this long when the code is right.
GUARD_S = 5.0


class Empty(BaseModel):
    pass


class WatchedSink(MemoryJournalSink):
    """A memory sink that says when an entry arrives."""

    def __init__(self) -> None:
        super().__init__()
        self.arrived = asyncio.Event()

    async def append(self, record: JournalRecord) -> JournalEntry:
        entry = await super().append(record)
        self.arrived.set()
        return entry


class Slow:
    """A handler that waits for ``release``.

    On cancellation it re-raises, or with ``swallow`` waits for ``release`` again and returns, or
    with ``raise_instead`` raises an ordinary exception.
    """

    def __init__(self, *, swallow: bool = False, raise_instead: bool = False) -> None:
        self.swallow = swallow
        self.raise_instead = raise_instead
        self.started = asyncio.Event()
        self.release = asyncio.Event()
        self.cancelled = asyncio.Event()

    async def __call__(self, input: Any, context: Any):
        self.started.set()
        try:
            await self.release.wait()
        except asyncio.CancelledError:
            self.cancelled.set()
            if self.raise_instead:
                raise RuntimeError("stopped on cancel") from None
            if not self.swallow:
                raise
            await self.release.wait()
        return success("late")


def _server(slow: Slow, sink: WatchedSink, *, record_failures: bool = False, **options: Any):
    server = create_server(
        "journal-deadline",
        middleware=[create_journal_middleware(sink, record_failures=record_failures)],
        **options,
    )
    mcp = ExposeOptions(mcp=True)

    @server.command(name="work-slow", description="Wait", input_schema=Empty, expose=mcp)
    async def wait(input: Empty, context: CommandContext):
        return await slow(input, context)

    @server.command(name="work-quick", description="Return", input_schema=Empty, expose=mcp)
    async def quick(input: Empty, context: CommandContext):
        return success("quick")

    return server


@contextlib.asynccontextmanager
async def released(slow: Slow) -> AsyncIterator[Slow]:
    """Release ``slow`` however the test ends, so a failure never leaves a handler that ignores
    cancellation waiting forever (and the event loop unable to close)."""
    try:
        yield slow
    finally:
        slow.release.set()
        await _settle()


async def _settle() -> None:
    """Let every ready task run, a few rounds over."""
    for _ in range(20):
        await asyncio.sleep(0)


@pytest.fixture
def expire(monkeypatch: pytest.MonkeyPatch) -> asyncio.Event:
    """An event that stands in for the batch and pipeline deadlines.

    The executors wait for in-flight work with ``asyncio.wait(..., timeout=...)``. In their modules
    that wait returns as if timed out when this event is set, and never on the clock. That includes
    the 50 ms grace wait after the deadline, so these tests pin what is recorded, not that window.
    """
    event = asyncio.Event()
    real_wait = asyncio.wait

    async def wait(
        fs: Iterable[asyncio.Future[Any]],
        *,
        timeout: float | None = None,
        return_when: str = asyncio.ALL_COMPLETED,
    ) -> tuple[set[asyncio.Future[Any]], set[asyncio.Future[Any]]]:
        tasks = set(fs)
        if timeout is None:
            return await real_wait(tasks, return_when=return_when)
        expiry = asyncio.ensure_future(event.wait())
        try:
            while True:
                done = {task for task in tasks if task.done()}
                first = return_when == asyncio.FIRST_COMPLETED and done
                if event.is_set() or first or done == tasks:
                    return done, tasks - done
                await real_wait({*(tasks - done), expiry}, return_when=asyncio.FIRST_COMPLETED)
        finally:
            expiry.cancel()

    controlled = types.SimpleNamespace(**vars(asyncio))
    controlled.wait = wait
    monkeypatch.setattr(command_execution, "asyncio", controlled)
    monkeypatch.setattr(pipeline_module, "asyncio", controlled)
    return event


async def test_timeout_cancels_the_chain_and_records_nothing() -> None:
    slow, sink = Slow(), WatchedSink()
    server = _server(slow, sink, record_failures=True)
    result = await asyncio.wait_for(
        server.execute("work-slow", {}, CommandContext(timeout=DEADLINE_MS)), GUARD_S
    )
    assert result.error is not None and result.error.code == "TIMEOUT"
    await asyncio.wait_for(slow.cancelled.wait(), GUARD_S)
    slow.release.set()
    await _settle()
    assert await sink.read() == []


async def test_timeout_records_the_result_of_a_handler_that_ignores_cancellation() -> None:
    slow, sink = Slow(swallow=True), WatchedSink()
    server = _server(slow, sink)
    async with released(slow):
        result = await asyncio.wait_for(
            server.execute("work-slow", {}, CommandContext(timeout=DEADLINE_MS)), GUARD_S
        )
        assert result.error is not None and result.error.code == "TIMEOUT"
        await asyncio.wait_for(slow.cancelled.wait(), GUARD_S)
        # Still waiting on its release: no entry yet.
        await _settle()
        assert await sink.read() == []

        slow.release.set()
        await asyncio.wait_for(sink.arrived.wait(), GUARD_S)
    [entry] = await sink.read()
    assert entry.command == "work-slow"
    assert entry.result["success"] is True and entry.result["data"] == "late"


async def test_timeout_records_an_execution_error_for_a_handler_that_raises_on_cancel() -> None:
    slow, sink = Slow(raise_instead=True), WatchedSink()
    server = _server(slow, sink, record_failures=True)
    result = await asyncio.wait_for(
        server.execute("work-slow", {}, CommandContext(timeout=DEADLINE_MS)), GUARD_S
    )
    assert result.error is not None and result.error.code == "TIMEOUT"
    await asyncio.wait_for(sink.arrived.wait(), GUARD_S)
    [entry] = await sink.read()
    assert entry.command == "work-slow"
    assert entry.result["success"] is False
    assert entry.result["error"]["code"] == "COMMAND_EXECUTION_ERROR"


async def test_command_cancelled_when_the_chain_task_ends_cancelled_records_nothing() -> None:
    sink = WatchedSink()
    server = create_server(
        "journal-deadline", middleware=[create_journal_middleware(sink, record_failures=True)]
    )

    @server.command(
        name="work-gone", description="Cancel itself", input_schema=Empty, expose=ExposeOptions()
    )
    async def gone(input: Empty, context: CommandContext):
        raise asyncio.CancelledError

    # Long enough never to pass: the task ends cancelled first.
    result = await asyncio.wait_for(
        server.execute("work-gone", {}, CommandContext(timeout=60_000)), GUARD_S
    )
    assert result.error is not None and result.error.code == "COMMAND_CANCELLED"
    await _settle()
    assert await sink.read() == []


async def _expire_after_start(slow: Slow, expire: asyncio.Event, running: Any) -> Any:
    task = asyncio.ensure_future(running)
    try:
        await asyncio.wait_for(slow.started.wait(), GUARD_S)
        expire.set()
        return await asyncio.wait_for(task, GUARD_S)
    finally:
        if not task.done():
            task.cancel()


async def _check_late_entry(slow: Slow, sink: WatchedSink, swallow: bool) -> None:
    await asyncio.wait_for(slow.cancelled.wait(), GUARD_S)
    await _settle()
    assert await sink.read() == []

    slow.release.set()
    if swallow:
        await asyncio.wait_for(sink.arrived.wait(), GUARD_S)
    await _settle()
    entries = await sink.read()
    # The unstarted item or later step never has an entry.
    if swallow:
        assert [(entry.command, entry.result["data"]) for entry in entries] == [
            ("work-slow", "late")
        ]
    else:
        assert entries == []


@pytest.mark.parametrize("swallow", [False, True])
async def test_batch_timeout_records_only_a_handler_that_finishes(
    swallow: bool, expire: asyncio.Event
) -> None:
    slow, sink = Slow(swallow=swallow), WatchedSink()
    server = _server(slow, sink)
    async with released(slow):
        batch = await _expire_after_start(
            slow,
            expire,
            server.execute_batch(
                {
                    "commands": [
                        {"command": "work-slow", "input": {}},
                        {"command": "work-quick", "input": {}},
                    ],
                    "options": {"timeout": NEVER_MS, "parallelism": 1},
                }
            ),
        )
        codes = [item.result.error.code for item in batch.results if item.result.error is not None]
        assert codes == ["BATCH_TIMEOUT", "BATCH_TIMEOUT"]
        await _check_late_entry(slow, sink, swallow)


@pytest.mark.parametrize("swallow", [False, True])
async def test_pipeline_timeout_records_only_a_handler_that_finishes(
    swallow: bool, expire: asyncio.Event
) -> None:
    slow, sink = Slow(swallow=swallow), WatchedSink()
    server = _server(slow, sink)
    async with released(slow):
        pipeline = await _expire_after_start(
            slow,
            expire,
            server._execute_pipeline(
                {
                    "steps": [{"command": "work-slow"}, {"command": "work-quick"}],
                    "options": {"timeoutMs": NEVER_MS},
                }
            ),
        )
        codes = [step.error.code for step in pipeline.steps if step.error is not None]
        assert codes == ["PIPELINE_TIMEOUT", "PIPELINE_TIMEOUT"]
        await _check_late_entry(slow, sink, swallow)


async def test_direct_client_timeout_records_nothing() -> None:
    slow, sink = Slow(), WatchedSink()
    server = _server(slow, sink, record_failures=True)
    client = DirectClient(DirectCommandRegistry(server))
    result = await asyncio.wait_for(
        client.call("work-slow", {}, DirectCallContext(timeout=DEADLINE_MS)), GUARD_S
    )
    assert result.error is not None and result.error.code == "TIMEOUT"
    await asyncio.wait_for(slow.cancelled.wait(), GUARD_S)
    slow.release.set()
    await _settle()
    assert await sink.read() == []


async def test_direct_client_records_a_handler_that_blocks_past_its_deadline(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The handler blocks the loop past the deadline: here it moves the loop's clock by two
    minutes in one step instead of sleeping, so the deadline (one minute) passes only inside it."""
    sink = WatchedSink()
    # The server also arms the caller's timeout as its own deadline, but the chain task finishes in
    # the step that moves the clock, before either timer runs, so the server returns the result and
    # only the client gives TIMEOUT.
    server = create_server(
        "journal-deadline",
        middleware=[create_journal_middleware(sink)],
        default_timeout_ms=None,
    )
    loop = asyncio.get_running_loop()
    real_time = loop.time
    skipped = 0.0
    monkeypatch.setattr(loop, "time", lambda: real_time() + skipped)

    @server.command(name="work-block", description="Block", input_schema=Empty)
    async def block(input: Empty, context: CommandContext):
        nonlocal skipped
        skipped += 120.0
        return success("blocked")

    client = DirectClient(DirectCommandRegistry(server))
    # No guard timeout here: the jump would fire it. The handler returns at once, so this cannot hang.
    result = await client.call("work-block", {}, DirectCallContext(timeout=60_000))
    assert result.error is not None and result.error.code == "TIMEOUT"
    [entry] = await sink.read()
    assert entry.command == "work-block"
    assert entry.result["success"] is True and entry.result["data"] == "blocked"
