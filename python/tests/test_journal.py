"""Command journal: entries, sinks, context digest, recording middleware and replay."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from pydantic import BaseModel

from afd import (
    Actor,
    FileJournalSink,
    JournalContextDigest,
    JournalEntry,
    JournalRange,
    JournalRecord,
    MemoryJournalSink,
    create_context_digest,
    is_journal_entry,
    journal_actor,
    parse_journal,
    serialize_journal,
    serialize_journal_entry,
    success,
)
from afd.core.commands import CommandContext, ExposeOptions
from afd.core.errors import CommandError
from afd.core.journal import canonical_json
from afd.core.result import failure
from afd.server import create_journal_middleware, create_server, replay_journal


def _record(command: str = "todo-list", **overrides: Any) -> JournalRecord:
    values: dict[str, Any] = {
        "timestamp": "2026-01-01T00:00:00.000Z",
        "command": command,
        "input": {},
        "context_digest": JournalContextDigest(hash="sha256:00"),
        "result": {"success": True},
        "duration_ms": 0,
    }
    values.update(overrides)
    return JournalRecord(**values)


class Note(BaseModel):
    text: str = ""


def _server(**options: Any):
    server = create_server("journal-test", **options)
    mcp = ExposeOptions(mcp=True)
    state = {"count": 0}

    @server.command(name="note-add", description="Add a note", input_schema=Note, expose=mcp)
    async def add(input: Note, context: CommandContext):
        state["count"] += 1
        return success({"text": input.text, "roll": context.random.next(), "n": state["count"]})

    @server.command(name="note-fail", description="Fail", input_schema=Note, expose=mcp)
    async def fail(input: Note, context: CommandContext):
        return failure(CommandError(code="NOPE", message="No", suggestion="Do not"))

    @server.command(name="note-crash", description="Raise", input_schema=Note, expose=mcp)
    async def crash(input: Note, context: CommandContext):
        raise RuntimeError("secret path /etc/shadow")

    @server.command(name="auth-sign-in", description="Sign in", input_schema=Note, expose=mcp)
    async def sign_in(input: Note, context: CommandContext):
        return success({"token": "tok-123"})

    return server


# ═══════════════════════════════════════════════════════════════════════════════
# JSON LINES
# ═══════════════════════════════════════════════════════════════════════════════


class TestJsonLines:
    def test_numbers_are_written_as_javascript_writes_them(self):
        entry = JournalEntry.from_record(
            1,
            _record(
                input={
                    "values": [1.0, 0.5, 1e21, 1e-7, 123456789012.5, -0.0, 1e16, 0.000123, 2**60]
                }
            ),
        )
        line = serialize_journal_entry(entry)
        assert (
            '"values":[1,0.5,1e+21,1e-7,123456789012.5,0,10000000000000000,0.000123,'
            "1152921504606846976]" in line
        )

    def test_unset_fields_are_omitted_and_strings_keep_non_ascii(self):
        line = serialize_journal_entry(JournalEntry.from_record(3, _record(input={"t": "é\n"})))
        data = json.loads(line)
        assert list(data) == [
            "seq",
            "timestamp",
            "command",
            "input",
            "contextDigest",
            "result",
            "durationMs",
        ]
        assert '"t":"é\\n"' in line

    def test_parse_skips_blank_lines_and_accepts_crlf(self):
        line = serialize_journal_entry(JournalEntry.from_record(1, _record()))
        entries = parse_journal(f"\n{line}\r\n\r\n")
        assert [entry.seq for entry in entries] == [1]

    @pytest.mark.parametrize(
        ("text", "message"),
        [
            ('{"seq":1}\nnot json\n', "Journal line 1 is not a journal entry"),
            ("\n\nnot json\n", "Journal line 3 is not valid JSON"),
            ('{"seq":NaN}\n', "Journal line 1 is not valid JSON"),
        ],
    )
    def test_parse_errors_name_the_line(self, text: str, message: str):
        with pytest.raises(ValueError, match=message):
            parse_journal(text)

    def test_is_journal_entry(self):
        good = JournalEntry.from_record(1, _record()).to_dict()
        assert is_journal_entry(good)
        assert is_journal_entry(JournalEntry.from_record(1, _record()))
        assert not is_journal_entry({**good, "seq": 0})
        assert not is_journal_entry({**good, "seq": True})
        assert not is_journal_entry({**good, "actor": {"kind": "robot"}})
        assert not is_journal_entry({**good, "tape": {"clock": [], "random": ["x"]}})
        assert not is_journal_entry({**good, "result": {"data": 1}})

    def test_journal_actor_keeps_only_the_four_fields(self):
        assert journal_actor({"kind": "agent", "label": "C", "token": "x"}) == Actor(
            kind="agent", label="C"
        )
        assert journal_actor(Actor(kind="human", id="u")) == Actor(kind="human", id="u")
        assert journal_actor({"kind": "robot"}) is None
        assert journal_actor("agent") is None

    def test_canonical_json_sorts_keys(self):
        assert canonical_json({"b": 1, "a": {"d": 2.0, "c": None}}) == '{"a":{"c":null,"d":2},"b":1}'


# ═══════════════════════════════════════════════════════════════════════════════
# SINKS
# ═══════════════════════════════════════════════════════════════════════════════


class TestMemorySink:
    @pytest.mark.asyncio
    async def test_assigns_seq_and_reads_ranges(self):
        sink = MemoryJournalSink()
        for _ in range(4):
            await sink.append(_record())
        assert [entry.seq for entry in await sink.read()] == [1, 2, 3, 4]
        assert [entry.seq for entry in await sink.read(JournalRange(from_seq=2, to_seq=3))] == [2, 3]

    @pytest.mark.asyncio
    async def test_continues_from_initial_entries(self):
        sink = MemoryJournalSink([JournalEntry.from_record(7, _record())])
        assert (await sink.append(_record())).seq == 8


class TestFileSink:
    @pytest.mark.asyncio
    async def test_creates_the_file_and_continues_numbering(self, tmp_path: Path):
        path = tmp_path / "nested" / "journal.jsonl"
        sink = FileJournalSink(path)
        await sink.append(_record())
        await sink.append(_record())
        reopened = FileJournalSink(path)
        assert (await reopened.append(_record())).seq == 3
        assert [entry.seq for entry in parse_journal(path.read_text())] == [1, 2, 3]
        assert [entry.seq for entry in await reopened.read(JournalRange(from_seq=3))] == [3]

    @pytest.mark.asyncio
    async def test_drops_a_torn_last_line(self, tmp_path: Path):
        path = tmp_path / "journal.jsonl"
        good = serialize_journal([JournalEntry.from_record(1, _record())])
        path.write_text(good + '{"seq":2,"timest')
        sink = FileJournalSink(path)
        assert [entry.seq for entry in await sink.read()] == [1]
        assert (await sink.append(_record())).seq == 2
        assert [entry.seq for entry in parse_journal(path.read_text())] == [1, 2]

    @pytest.mark.asyncio
    async def test_keeps_a_complete_last_line_without_newline(self, tmp_path: Path):
        path = tmp_path / "journal.jsonl"
        path.write_text(serialize_journal_entry(JournalEntry.from_record(5, _record())))
        sink = FileJournalSink(path)
        assert (await sink.append(_record())).seq == 6
        assert path.read_text().count("\n") == 2

    @pytest.mark.asyncio
    async def test_reading_a_missing_file_is_empty(self, tmp_path: Path):
        assert await FileJournalSink(tmp_path / "none.jsonl").read() == []


# ═══════════════════════════════════════════════════════════════════════════════
# CONTEXT DIGEST: NO SECRETS
# ═══════════════════════════════════════════════════════════════════════════════


class TestContextDigest:
    def test_hashes_key_names_never_values(self):
        actor = Actor(kind="human", id="u1")
        one = CommandContext(trace_id="t", actor=actor, extra={"session": "s-1", "interface": "cli"})
        two = CommandContext(trace_id="t", actor=actor, extra={"session": "s-2", "interface": "cli"})
        three = CommandContext(trace_id="t", actor=actor, extra={"interface": "cli"})
        assert create_context_digest(one) == create_context_digest(two)
        assert create_context_digest(one).hash != create_context_digest(three).hash
        assert create_context_digest(one).interface == "cli"

    def test_allowlisted_values_change_the_hash(self):
        base = CommandContext(trace_id="t", actor=Actor(kind="human"))
        other = CommandContext(trace_id="u", actor=Actor(kind="human"))
        assert create_context_digest(base).hash != create_context_digest(other).hash

    @pytest.mark.asyncio
    async def test_auth_and_session_data_never_reach_an_entry(self):
        sink = MemoryJournalSink()
        server = _server(middleware=[create_journal_middleware(sink)])
        secrets = {
            "auth_session": {"accessToken": "SECRET-TOKEN-1"},
            "headers": {"authorization": "Bearer SECRET-TOKEN-2"},
            "cookie": "sid=SECRET-COOKIE",
        }
        context = CommandContext(
            trace_id="t1",
            actor=Actor(kind="human", id="u1", label="Ada"),
            extra={"interface": "mcp", **secrets},
        )
        context.timeout = 1000
        await server.execute("note-add", {"text": "hi"}, context)
        [entry] = await sink.read()
        text = serialize_journal_entry(entry)
        for secret in ("SECRET-TOKEN-1", "SECRET-TOKEN-2", "SECRET-COOKIE", "Bearer"):
            assert secret not in text
        assert entry.actor == Actor(kind="human", id="u1", label="Ada")
        assert entry.trace_id == "t1"
        assert entry.context_digest.interface == "mcp"
        assert set(json.loads(text)["contextDigest"]) == {"hash", "interface"}

    @pytest.mark.asyncio
    async def test_extra_actor_attributes_are_dropped(self):
        class SessionActor(Actor):
            pass

        actor = SessionActor(kind="agent", label="C")
        actor.session_token = "SECRET-ACTOR"  # type: ignore[attr-defined]
        sink = MemoryJournalSink()
        server = _server(middleware=[create_journal_middleware(sink)])
        await server.execute("note-add", {}, CommandContext(actor=actor))
        [entry] = await sink.read()
        assert "SECRET-ACTOR" not in serialize_journal_entry(entry)


# ═══════════════════════════════════════════════════════════════════════════════
# RECORDING MIDDLEWARE
# ═══════════════════════════════════════════════════════════════════════════════


class TestMiddleware:
    @pytest.mark.asyncio
    async def test_records_successes_with_input_result_and_tape(self):
        sink = MemoryJournalSink()
        server = _server(middleware=[create_journal_middleware(sink)])
        result = await server.execute("note-add", {"text": "a"}, CommandContext(trace_id="t"))
        [entry] = await sink.read()
        assert entry.command == "note-add"
        assert entry.input == {"text": "a"}
        assert entry.result["data"]["roll"] == result.data["roll"]
        assert entry.result["metadata"]["traceId"] == "t"
        assert entry.tape is not None
        assert entry.tape.random == [result.data["roll"]]
        assert len(entry.tape.clock) == 2  # the server's own timing of the handler
        assert entry.timestamp.endswith("Z") and len(entry.timestamp) == 24

    @pytest.mark.asyncio
    async def test_skips_failures_validation_errors_and_auth_by_default(self):
        sink = MemoryJournalSink()
        server = _server(middleware=[create_journal_middleware(sink)])
        await server.execute("note-fail", {})
        await server.execute("note-add", {"text": 5})  # rejected before middleware
        await server.execute("auth-sign-in", {})
        assert await sink.read() == []

    @pytest.mark.asyncio
    async def test_records_failures_and_raises_without_the_message(self):
        sink = MemoryJournalSink()
        server = _server(middleware=[create_journal_middleware(sink, record_failures=True)])
        await server.execute("note-fail", {})
        crashed = await server.execute("note-crash", {})
        assert crashed.error.code == "COMMAND_EXECUTION_ERROR"
        failed, crash = await sink.read()
        assert failed.result["error"]["code"] == "NOPE"
        assert crash.result["error"]["message"] == "An internal error occurred"
        assert "shadow" not in serialize_journal_entry(crash)

    @pytest.mark.asyncio
    async def test_filter_and_redact(self):
        sink = MemoryJournalSink()

        def redact(record: JournalRecord):
            if record.command == "note-add" and record.input.get("text") == "skip":
                return None
            record.result = {**record.result, "data": {"token": "[redacted]"}}
            record.tape = None
            return record

        server = _server(
            middleware=[create_journal_middleware(sink, filter=lambda name: True, redact=redact)]
        )
        await server.execute("note-add", {"text": "skip"})
        await server.execute("auth-sign-in", {})
        [entry] = await sink.read()
        assert entry.command == "auth-sign-in"
        assert entry.result["data"] == {"token": "[redacted]"}
        assert entry.tape is None

    @pytest.mark.asyncio
    async def test_sink_errors_go_to_on_error_and_keep_the_result(self):
        class BrokenSink:
            async def append(self, record):
                raise OSError("disk full")

            async def read(self, range=None):
                return []

        errors: list[Exception] = []
        server = _server(middleware=[create_journal_middleware(BrokenSink(), on_error=errors.append)])
        result = await server.execute("note-add", {"text": "a"})
        assert result.success
        assert [str(error) for error in errors] == ["disk full"]

    @pytest.mark.asyncio
    async def test_tape_is_truncated_past_max_reads(self):
        sink = MemoryJournalSink()
        server = _server(middleware=[create_journal_middleware(sink, max_tape_reads=1)])
        await server.execute("note-add", {})
        [entry] = await sink.read()
        assert entry.tape is not None
        assert entry.tape.truncated is True
        assert len(entry.tape.clock) == 1

    @pytest.mark.asyncio
    async def test_restores_the_context_sources(self):
        seen: list[Any] = []

        async def outer(name, input, context, next_fn):
            before = context.clock
            result = await next_fn()
            seen.append(context.clock is before)
            return result

        server = _server(middleware=[outer, create_journal_middleware(MemoryJournalSink())])
        await server.execute("note-add", {})
        assert seen == [True]


# ═══════════════════════════════════════════════════════════════════════════════
# REPLAY
# ═══════════════════════════════════════════════════════════════════════════════


async def _record_session(*calls: tuple[str, dict[str, Any]]) -> list[JournalEntry]:
    sink = MemoryJournalSink()
    server = _server(middleware=[create_journal_middleware(sink, record_failures=True)])
    for command, input in calls:
        await server.execute(command, input, CommandContext(trace_id=command))
    return await sink.read()


class TestReplay:
    @pytest.mark.asyncio
    async def test_replays_tape_backed_random_values(self):
        entries = await _record_session(("note-add", {"text": "a"}), ("note-add", {"text": "b"}))
        report = await replay_journal(_server(), entries)
        assert [entry.status for entry in report.entries] == ["same", "same"]
        assert report.same == 2 and not report.diverged

    @pytest.mark.asyncio
    async def test_reports_differences_with_paths(self):
        entries = await _record_session(("note-add", {"text": "a"}))
        server = _server()
        await server.execute("note-add", {})  # the replay target is not fresh: n differs
        report = await replay_journal(server, entries)
        [entry] = report.entries
        assert entry.status == "different"
        assert [(d.path, d.kind, d.recorded, d.replayed) for d in entry.differences] == [
            ("data.n", "changed", 1, 2)
        ]
        assert report.diverged and report.different == 1

    @pytest.mark.asyncio
    async def test_ignore_paths_and_added_removed_keys(self):
        [entry] = await _record_session(("note-add", {"text": "a"}))
        entry.result = {**entry.result, "data": {**entry.result["data"], "gone": True}}
        entry.result["data"].pop("text")
        report = await replay_journal(_server(), [entry])
        kinds = {(d.path, d.kind) for d in report.entries[0].differences}
        assert kinds == {("data.gone", "removed"), ("data.text", "added")}
        report = await replay_journal(_server(), [entry], ignore=["data"])
        assert report.entries[0].status == "same"

    @pytest.mark.asyncio
    async def test_booleans_are_not_numbers(self):
        [entry] = await _record_session(("note-add", {"text": "a"}))
        entry.result = {**entry.result, "data": {**entry.result["data"], "n": True}}
        report = await replay_journal(_server(), [entry])
        assert report.entries[0].differences[0].path == "data.n"

    @pytest.mark.asyncio
    async def test_errors_notes_and_stop_on_divergence(self):
        entries = await _record_session(
            ("note-add", {"text": "a"}), ("note-add", {"text": "b"}), ("note-add", {"text": "c"})
        )

        class Broken:
            async def execute(self, name, input, context=None):
                raise RuntimeError("boom")

        report = await replay_journal(Broken(), entries, stop_on_divergence=True)
        assert [(entry.status, entry.error) for entry in report.entries] == [("error", "boom")]
        assert report.errors == 1 and report.skipped == 2
        # The handler never ran, so the tape was not read.
        assert report.entries[0].notes == [
            "clock: the replay read 0 of 2 recorded readings",
            "random: the replay read 0 of 1 recorded values",
        ]

    @pytest.mark.asyncio
    async def test_entries_without_a_tape_get_a_fixed_clock_and_a_seeded_random(self):
        [entry] = await _record_session(("note-add", {"text": "a"}))
        entry.tape = None
        first = await replay_journal(_server(), [entry])
        second = await replay_journal(_server(), [entry])
        assert first.entries[0].replayed.data["roll"] == second.entries[0].replayed.data["roll"]

    @pytest.mark.asyncio
    async def test_restores_actor_trace_and_context_overrides(self):
        seen: list[CommandContext] = []

        async def spy(name, input, context, next_fn):
            seen.append(context)
            return await next_fn()

        [entry] = await _record_session(("note-add", {"text": "a"}))
        entry.actor = Actor(kind="script", id="cron")
        await replay_journal(_server(middleware=[spy]), [entry], context={"db": "fresh"})
        [context] = seen
        assert context.actor == Actor(kind="script", id="cron")
        assert context.trace_id == "note-add"
        assert context.extra["db"] == "fresh"
