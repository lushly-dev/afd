"""Declared context fields (spec/context-fields.md): declaration checks, validation on every
in-process call, and what the journal keeps (spec/journal.md, "Declared context fields").

Mirrors ``packages/server/src/context-fields.test.ts``.
"""

from __future__ import annotations

from typing import Annotated, Any

import pytest
from pydantic import BaseModel, Field, StringConstraints, TypeAdapter

from afd import (
    JournalContextDigest,
    JournalEntry,
    JournalTape,
    MemoryJournalSink,
    create_context_digest,
    fixed_clock,
    is_journal_entry,
    parse_journal,
    seeded_random,
    serialize_journal,
    success,
)
from afd.core.commands import CommandContext, ExposeOptions
from afd.core.journal import JournalContextFields
from afd.server import (
    MAX_JOURNAL_CONTEXT_BYTES,
    ContextField,
    MCPServer,
    check_context_fields,
    create_journal_middleware,
    create_server,
    journal_context_fields,
    replay_journal,
)
from afd.server.factory import ServerConfig


class Scope(BaseModel):
    project: str


class Empty(BaseModel):
    pass


SCOPE = ContextField(name="scope", meta="dev.example/scope", schema=Scope, journal=True)
LOCALE = ContextField(
    name="locale",
    meta="dev.example/locale",
    schema=Annotated[str, StringConstraints(strip_whitespace=True)],
)


def _field(**overrides: Any) -> ContextField:
    values: dict[str, Any] = {
        "name": SCOPE.name,
        "meta": SCOPE.meta,
        "schema": SCOPE.schema,
        "journal": SCOPE.journal,
        "required": SCOPE.required,
    }
    values.update(overrides)
    return ContextField(**values)


def _server(fields: list[Any] | None = None, **options: Any):
    """A server with ``scope-echo``, which returns the declared fields the call sees."""
    server = create_server("fields", context_fields=fields, **options)
    seen: list[CommandContext] = []

    @server.command(
        name="scope-echo",
        description="Return the declared fields the call sees",
        input_schema=Empty,
        expose=ExposeOptions(mcp=True),
    )
    async def echo(input: Empty, context: CommandContext):
        seen.append(context)
        scope = context.extra.get("scope")
        return success(
            {
                "scope": scope.model_dump(by_alias=True) if isinstance(scope, BaseModel) else scope,
                "locale": context.extra.get("locale"),
            }
        )

    server.seen = seen  # type: ignore[attr-defined]
    return server


# ═══════════════════════════════════════════════════════════════════════════════
# DECLARATIONS
# ═══════════════════════════════════════════════════════════════════════════════


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"name": ""}, "non-empty name"),
        ({"name": "actor"}, "name AFD sets itself"),
        ({"name": "traceId"}, "name AFD sets itself"),
        ({"name": "trace_id"}, "name AFD sets itself"),
        ({"name": "session"}, "name AFD sets itself"),
        ({"name": "source"}, "name AFD sets itself"),
        ({"name": "extra"}, "name AFD sets itself"),
        ({"name": "active_context"}, "name AFD sets itself"),
        ({"meta": "scope"}, "reverse-DNS prefix"),
        ({"meta": "example/scope"}, "reverse-DNS prefix"),
        ({"meta": "dev.example/"}, "reverse-DNS prefix"),
        ({"meta": "dev.afd/scope"}, "reserved meta prefix"),
        ({"meta": "Dev.AFD/scope"}, "reserved meta prefix"),
        ({"meta": "io.modelcontextprotocol/scope"}, "reserved meta prefix"),
        ({"meta": "dev.MCP.tools/scope"}, "reserved meta prefix"),
    ],
)
def test_refuses_a_bad_declaration(overrides: dict[str, Any], message: str):
    with pytest.raises(ValueError, match=message):
        check_context_fields([_field(**overrides)])


@pytest.mark.parametrize("schema", [None, object()])
def test_refuses_a_schema_pydantic_cannot_use(schema: Any):
    with pytest.raises(TypeError, match="Context field 'scope' needs a schema"):
        check_context_fields([_field(schema=schema)])


def test_refuses_a_name_or_meta_key_declared_twice():
    with pytest.raises(ValueError, match="twice"):
        check_context_fields([SCOPE, _field(meta=LOCALE.meta)])
    with pytest.raises(ValueError, match="twice"):
        check_context_fields([SCOPE, _field(name="other")])


def test_accepts_mappings_and_type_adapters():
    [scope, locale] = check_context_fields(
        [
            {"name": "scope", "meta": "dev.example/scope", "schema": Scope, "journal": True},
            {"name": "locale", "meta": "dev.example/locale", "schema": TypeAdapter(str)},
        ]
    )
    assert isinstance(scope, ContextField) and scope.journal
    assert locale.validate("en") == "en"
    with pytest.raises(TypeError, match="Not a context field"):
        check_context_fields([{"name": "scope"}])
    with pytest.raises(TypeError, match="must be a list"):
        check_context_fields(SCOPE)  # type: ignore[arg-type]


def test_is_checked_when_a_server_is_created():
    bad = [_field(name="clock")]
    with pytest.raises(ValueError, match="'clock'"):
        create_server("fields", context_fields=bad)
    with pytest.raises(ValueError, match="'clock'"):
        MCPServer(ServerConfig(name="fields", context_fields=bad))
    assert create_server("fields").context_fields == ()
    assert create_server("fields", context_fields=[SCOPE]).context_fields == (SCOPE,)


# ═══════════════════════════════════════════════════════════════════════════════
# VALUES IN PROCESS
# ═══════════════════════════════════════════════════════════════════════════════


@pytest.mark.asyncio
async def test_values_reach_the_handler_as_their_schema_outputs_them():
    server = _server([SCOPE, LOCALE])
    extra = {"scope": {"project": "p-1"}, "locale": "  en-GB "}
    result = await server.execute("scope-echo", {}, CommandContext(extra=extra))
    assert result.success
    assert result.data == {"scope": {"project": "p-1"}, "locale": "en-GB"}
    assert isinstance(server.seen[0].extra["scope"], Scope)
    # The caller's dict keeps what it sent.
    assert extra == {"scope": {"project": "p-1"}, "locale": "  en-GB "}


@pytest.mark.asyncio
async def test_an_invalid_value_fails_with_validation_error_naming_the_field_and_meta_key():
    calls: list[str] = []

    async def spy(name: str, input: Any, context: CommandContext, next_fn: Any):
        calls.append(name)
        return await next_fn()

    server = _server([SCOPE, LOCALE], middleware=[spy])
    result = await server.execute(
        "scope-echo", {}, CommandContext(extra={"scope": {"project": 42}})
    )
    assert not result.success
    assert result.error.code == "VALIDATION_ERROR"
    assert result.error.message == "Context field 'scope' is not valid"
    details = result.error.details
    assert details["field"] == "scope" and details["meta"] == "dev.example/scope"
    assert [issue["path"] for issue in details["errors"]] == ["project"]
    assert '_meta["dev.example/scope"]' in result.error.suggestion
    assert "leave it out" in result.error.suggestion
    # Before middleware and the handler.
    assert calls == [] and server.seen == []


@pytest.mark.asyncio
async def test_a_call_without_a_required_field_fails():
    server = _server([_field(required=True)])
    result = await server.execute("scope-echo", {})
    assert result.error.code == "VALIDATION_ERROR"
    assert result.error.message == "Context field 'scope' is required"
    assert result.error.details == {
        "field": "scope",
        "meta": "dev.example/scope",
        "errors": [{"path": "", "message": "Required"}],
    }
    assert "it is required" in result.error.suggestion
    # None counts as no value.
    result = await server.execute("scope-echo", {}, CommandContext(extra={"scope": None}))
    assert result.error.message == "Context field 'scope' is required"


@pytest.mark.asyncio
async def test_required_is_not_enforced_for_afd_commands_but_present_values_are_validated():
    server = _server([_field(required=True)])
    help_result = await server.execute("afd-help", {})
    assert help_result.success
    result = await server.execute("scope-echo", {})
    assert result.error.code == "VALIDATION_ERROR"
    assert result.error.message == "Context field 'scope' is required"
    invalid = await server.execute(
        "afd-help", {}, CommandContext(extra={"scope": {"project": 42}})
    )
    assert invalid.error.code == "VALIDATION_ERROR"
    assert invalid.error.message == "Context field 'scope' is not valid"


@pytest.mark.asyncio
async def test_a_validator_that_raises_fails_the_call():
    def explode(value: Any) -> Any:
        raise RuntimeError("bad scope")

    from pydantic import PlainValidator

    field = _field(schema=Annotated[Any, PlainValidator(explode)])
    server = _server([field])
    result = await server.execute("scope-echo", {}, CommandContext(extra={"scope": "x"}))
    assert result.error.code == "VALIDATION_ERROR"
    assert result.error.details["errors"] == [{"path": "", "message": "bad scope"}]


# ═══════════════════════════════════════════════════════════════════════════════
# JOURNAL
# ═══════════════════════════════════════════════════════════════════════════════


async def _record(extra: dict[str, Any], fields: list[Any] | None = None) -> JournalEntry:
    sink = MemoryJournalSink()
    server = _server(
        [SCOPE, LOCALE] if fields is None else fields,
        clock=fixed_clock(0),
        middleware=[create_journal_middleware(sink)],
    )
    await server.execute("scope-echo", {}, CommandContext(trace_id="t", extra=extra))
    [entry] = await sink.read()
    return entry


@pytest.mark.asyncio
async def test_keeps_journaled_values_in_context_and_leaves_the_others_as_key_names():
    entry = await _record({"scope": {"project": "p-1"}, "locale": "en"})
    assert entry.context == {"scope": {"project": "p-1"}}
    assert entry.context_omitted is None
    data = entry.to_dict()
    assert list(data)[list(data).index("contextDigest") + 1] == "context"
    expected = create_context_digest(
        CommandContext(
            trace_id="t",
            extra={"scope": {"project": "p-1"}, "locale": "en"},
            clock=fixed_clock(0),
            random=seeded_random("x"),
        ),
        JournalContextFields(context={"scope": {"project": "p-1"}}),
    )
    assert entry.context_digest == expected
    without_scope = create_context_digest(
        CommandContext(
            trace_id="t", extra={"locale": "en"}, clock=fixed_clock(0), random=seeded_random("x")
        )
    )
    assert entry.context_digest.hash != without_scope.hash


@pytest.mark.asyncio
async def test_hashes_an_entry_without_journaled_values_exactly_as_before():
    entry = await _record({"locale": "en"})
    assert entry.context is None and entry.context_omitted is None
    expected = create_context_digest(
        CommandContext(
            trace_id="t", extra={"locale": "en"}, clock=fixed_clock(0), random=seeded_random("x")
        )
    )
    assert entry.context_digest == expected


@pytest.mark.asyncio
async def test_names_a_value_over_the_cap_in_context_omitted_instead():
    assert MAX_JOURNAL_CONTEXT_BYTES == 4096
    entry = await _record({"scope": {"project": "é" * 2100}})
    assert entry.context is None
    assert entry.context_omitted == ["scope"]
    # {"project":"…"} is the value plus 14 bytes: 4096 bytes is kept, 4097 is not.
    kept = await _record({"scope": {"project": "x" * 4082}})
    assert kept.context == {"scope": {"project": "x" * 4082}}
    omitted = await _record({"scope": {"project": "x" * 4083}})
    assert omitted.context_omitted == ["scope"]


def test_journal_context_fields_sorts_names_and_skips_missing_values():
    context = CommandContext(
        extra={"b": {"z": 1, "a": [2]}, "a": "x", "c": None, "big": "y" * 5000}
    )
    journaled = journal_context_fields(context, ["c", "b", "a", "missing", "big"])
    assert journaled.context == {"a": "x", "b": {"a": [2], "z": 1}}
    assert list(journaled.context) == ["a", "b"]
    assert list(journaled.context["b"]) == ["a", "z"]
    assert journaled.context_omitted == ["big"]
    assert journal_context_fields(context, []) == JournalContextFields()


def test_the_digest_moves_journaled_names_out_of_keys():
    context = CommandContext(trace_id="t", extra={"scope": 1, "space": 2, "other": 3})
    plain = create_context_digest(context)
    assert plain == create_context_digest(context, JournalContextFields())
    with_fields = create_context_digest(
        context, JournalContextFields(context={"scope": 1}, context_omitted=["space"])
    )
    assert with_fields.hash != plain.hash


@pytest.mark.asyncio
async def test_journals_a_model_by_alias_and_replays_it():
    class Aliased(BaseModel):
        project_id: str = Field(alias="projectId")

    field = _field(schema=Aliased)
    entry = await _record({"scope": {"projectId": "p-1"}}, fields=[field])
    assert entry.context == {"scope": {"projectId": "p-1"}}
    report = await replay_journal(_server([field]), [entry])
    assert report.entries[0].status == "same"


def test_entries_with_context_fields_round_trip_and_are_checked():
    entry = JournalEntry(
        seq=1,
        timestamp="2026-01-01T00:00:00.000Z",
        command="scope-echo",
        input={},
        context_digest=JournalContextDigest(hash="sha256:00"),
        context={"scope": {"project": "p-1"}},
        context_omitted=["space"],
        result={"success": True},
        duration_ms=0,
    )
    text = serialize_journal([entry])
    assert '"contextDigest":{"hash":"sha256:00"},"context":{"scope"' in text
    assert '"contextOmitted":["space"],"result"' in text
    [parsed] = parse_journal(text)
    assert parsed == entry
    assert serialize_journal([parsed]) == text
    data = entry.to_dict()
    assert is_journal_entry(data)
    assert not is_journal_entry({**data, "context": None})
    assert not is_journal_entry({**data, "context": ["scope"]})
    assert not is_journal_entry({**data, "contextOmitted": "space"})
    assert not is_journal_entry({**data, "contextOmitted": [1]})


# ═══════════════════════════════════════════════════════════════════════════════
# REPLAY
# ═══════════════════════════════════════════════════════════════════════════════


@pytest.mark.asyncio
async def test_replays_a_field_the_target_no_longer_declares_without_it_with_a_note():
    entry = await _record({"scope": {"project": "p-1"}})
    report = await replay_journal(_server(), [entry])
    assert report.entries[0].status == "different"
    assert report.entries[0].notes == [
        "context field 'scope' is no longer declared; replayed without it"
    ]
    restored = await replay_journal(_server([SCOPE, LOCALE]), [entry])
    assert restored.entries[0].status == "same"
    assert restored.entries[0].notes is None


@pytest.mark.asyncio
async def test_restores_every_field_on_a_target_without_declarations():
    entry = await _record({"scope": {"project": "p-1"}})
    entry.tape = None

    class Bare:
        async def execute(self, name: str, input: Any, context: Any = None) -> Any:
            return success({"scope": context.extra.get("scope"), "locale": None})

    report = await replay_journal(Bare(), [entry], ignore=["metadata"])
    assert report.entries[0].status == "same"
    assert report.entries[0].notes is None


@pytest.mark.asyncio
async def test_a_restored_value_that_no_longer_validates_fails_the_call():
    entry = await _record({"scope": {"project": "p-1"}})
    entry.context = {"scope": {"project": 7}}
    report = await replay_journal(_server([SCOPE]), [entry])
    assert report.entries[0].status == "different"
    assert report.entries[0].replayed.error.code == "VALIDATION_ERROR"


@pytest.mark.asyncio
async def test_field_notes_come_before_tape_notes():
    entry = await _record({"scope": {"project": "x" * 5000}})
    entry.context = {"gone": 1}
    assert entry.tape is not None
    entry.tape = JournalTape(clock=entry.tape.clock, random=entry.tape.random, truncated=True)
    report = await replay_journal(_server([SCOPE]), [entry])
    assert report.entries[0].notes == [
        "context field 'gone' is no longer declared; replayed without it",
        "context field 'scope' was too large to journal; replayed without it",
        "the recorded tape was truncated; values past it are not restored",
    ]
