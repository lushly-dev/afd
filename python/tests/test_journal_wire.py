"""The golden journal fixture, spec/wire/journal.jsonl (see spec/journal.md).

TypeScript writes the fixture. Python must read it, write it back byte for
byte, record the same session to the same entries (compared as JSON values),
and replay it to ``same`` on a fresh server.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pytest
from pydantic import BaseModel

from afd import (
    Actor,
    MemoryJournalSink,
    failure,
    fixed_clock,
    parse_journal,
    seeded_random,
    serialize_journal,
    success,
)
from afd.core.commands import CommandContext, ExposeOptions
from afd.core.errors import CommandError
from afd.server import create_journal_middleware, create_server, replay_journal

FIXTURE = Path(__file__).resolve().parents[2] / "spec" / "wire" / "journal.jsonl"


class CreateInput(BaseModel):
    title: str


class GetInput(BaseModel):
    id: str


class Empty(BaseModel):
    pass


def _iso(ms: float) -> str:
    moment = datetime(1970, 1, 1, tzinfo=timezone.utc) + timedelta(milliseconds=ms)
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


def _todo_server(**options: Any):
    """The fixture's todo commands (``journal-wire.test.ts``), on a fresh server."""
    server = create_server("journal-fixture", version="1.0.0", **options)
    todos: dict[str, dict[str, str]] = {}
    mcp = ExposeOptions(mcp=True)

    @server.command(
        name="todo-create",
        description="Create a todo",
        input_schema=CreateInput,
        mutation=True,
        expose=mcp,
        version="1.0.0",
    )
    async def create(input: CreateInput, context: CommandContext):
        todo_id = f"todo-{int(context.random.next() * 0x10000):x}"
        todo = {"id": todo_id, "title": input.title, "createdAt": _iso(context.clock.now())}
        todos[todo_id] = todo
        return success(todo, reasoning=f'Created "{input.title}"', confidence=1)

    @server.command(
        name="todo-get",
        description="Get a todo",
        input_schema=GetInput,
        expose=mcp,
        version="1.0.0",
    )
    async def get(input: GetInput, context: CommandContext):
        todo = todos.get(input.id)
        if todo is not None:
            return success(todo)
        return failure(
            CommandError(
                code="NOT_FOUND",
                message=f"Todo {input.id} not found",
                suggestion="Use todo-list to see the todo ids",
            )
        )

    @server.command(
        name="todo-list",
        description="List todos",
        input_schema=Empty,
        expose=mcp,
        version="1.0.0",
    )
    async def list_todos(input: Empty, context: CommandContext):
        return success({"items": list(todos.values()), "count": len(todos)})

    return server


def _fixture_lines() -> list[dict[str, Any]]:
    return [json.loads(line) for line in FIXTURE.read_text(encoding="utf-8").splitlines()]


def test_round_trips_byte_for_byte():
    text = FIXTURE.read_text(encoding="utf-8")
    entries = parse_journal(text)
    assert [entry.seq for entry in entries] == [1, 2, 3, 4]
    assert serialize_journal(entries) == text


def test_parsed_entries_hold_the_fixture_values():
    first = parse_journal(FIXTURE.read_text(encoding="utf-8"))[0]
    assert first.trace_id == "trace-1"
    assert first.actor == Actor(kind="agent", label="Claude", on_behalf_of="user-1")
    assert first.context_digest.interface == "mcp"
    assert first.tape is not None and first.tape.random == [0.7345767796505243]
    assert first.result["metadata"]["actorKind"] == "agent"


@pytest.mark.asyncio
async def test_records_the_same_session_as_typescript():
    sink = MemoryJournalSink()
    clock = fixed_clock("2026-01-01T00:00:00Z")
    server = _todo_server(
        clock=clock,
        random=seeded_random("journal-fixture"),
        middleware=[create_journal_middleware(sink, record_failures=True)],
    )
    agent = Actor(kind="agent", label="Claude", on_behalf_of="user-1")
    human = Actor(kind="human", id="user-1")
    calls = [
        ("todo-create", {"title": "Buy milk"}, agent, "trace-1"),
        ("todo-create", {"title": "Walk the dog"}, human, "trace-2"),
        ("todo-get", {"id": "todo-missing"}, agent, "trace-3"),
        ("todo-list", {}, agent, "trace-4"),
    ]
    for command, input, actor, trace_id in calls:
        await server.execute(
            command,
            input,
            CommandContext(trace_id=trace_id, actor=actor, extra={"interface": "mcp"}),
        )
        clock.advance(1000)

    recorded = [entry.to_dict() for entry in await sink.read()]
    # The same JSON values, context hashes included: Python's context has the same
    # non-allowlisted keys (clock and random) as TypeScript's here.
    assert recorded == _fixture_lines()


@pytest.mark.asyncio
async def test_replays_the_fixture_to_the_same_results():
    entries = parse_journal(FIXTURE.read_text(encoding="utf-8"))
    report = await replay_journal(_todo_server(), entries, ignore=[])
    assert [(entry.seq, entry.status, entry.notes) for entry in report.entries] == [
        (1, "same", None),
        (2, "same", None),
        (3, "same", None),
        (4, "same", None),
    ]
    assert not report.diverged


@pytest.mark.asyncio
async def test_replay_through_a_journal_middleware_records_nothing():
    entries = parse_journal(FIXTURE.read_text(encoding="utf-8"))
    sink = MemoryJournalSink()
    server = _todo_server(middleware=[create_journal_middleware(sink, record_failures=True)])
    report = await replay_journal(server, entries, ignore=[])
    assert report.same == 4
    assert await sink.read() == []
