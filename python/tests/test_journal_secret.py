"""Commands that declare ``secret`` in the journal (``spec/journal.md``, ``spec/command-metadata.md``).

Mirrors the ``secret`` cases of ``packages/server/src/journal.test.ts``.
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest
from pydantic import BaseModel

from afd import JournalRecord, MemoryJournalSink, serialize_journal, success
from afd.core import open_dispatch
from afd.core.commands import CommandContext, CommandDefinition, create_command_registry
from afd.core.journal import JournalEntry
from afd.core.running_command import running_command_secret
from afd.direct import DirectClient, DirectClientOptions, SimpleRegistry, create_direct_registry
from afd.server import (
    JournalRedactInfo,
    create_journal_middleware,
    create_server,
    define_command,
    run_off_tape,
)
from afd.server.middleware import compose_middleware
from afd.testing.fixtures import MockServer


class Unlock(BaseModel):
    passphrase: str = ""


class Roll(BaseModel):
    sides: int = 6


class Empty(BaseModel):
    pass


@define_command(
    name="vault-unlock", description="Unlock the vault", input_schema=Unlock, secret=True
)
async def vault_unlock(input: Unlock) -> Any:
    return success({"key": "SECRET-VAULT-KEY"})


@define_command(name="dice-roll", description="Roll a die", input_schema=Roll)
async def dice_roll(input: Roll) -> Any:
    return success({"value": 4})


def _text(entries: list[JournalEntry]) -> str:
    return serialize_journal(entries)


async def _run(**options: Any) -> list[JournalEntry]:
    sink = MemoryJournalSink()
    server = create_server("s", middleware=[create_journal_middleware(sink, **options)])
    server.register(vault_unlock)
    server.register(dice_roll)
    await server.execute("vault-unlock", {"passphrase": "hunter2"})
    await server.execute("dice-roll", {"sides": 6})
    return await sink.read()


@pytest.mark.parametrize(
    "options",
    [{}, {"filter": lambda name: True}, {"record_failures": True, "filter": lambda name: True}],
)
async def test_never_records_a_secret_command_without_redact_whatever_its_name_or_filter(
    options: dict[str, Any],
) -> None:
    entries = await _run(**options)
    assert [entry.command for entry in entries] == ["dice-roll"]
    assert "hunter2" not in _text(entries) and "SECRET" not in _text(entries)


async def test_with_redact_the_host_removes_the_secret_and_the_call_is_recorded() -> None:
    def redact(record: JournalRecord) -> JournalRecord:
        record.input = {}
        record.result = {"success": True}
        return record

    entries = await _run(filter=lambda name: True, redact=redact)
    assert [entry.command for entry in entries] == ["vault-unlock", "dice-roll"]
    assert "hunter2" not in _text(entries) and "SECRET" not in _text(entries)


async def test_a_direct_registry_runs_the_same_engine_so_the_same_rule_holds() -> None:
    sink = MemoryJournalSink()
    registry = create_direct_registry(
        [vault_unlock], middleware=[create_journal_middleware(sink, filter=lambda name: True)]
    )
    await registry.execute("vault-unlock", {"passphrase": "hunter2"})
    assert await sink.read() == []


async def test_the_core_registry_reads_the_declaration_too() -> None:
    async def unlock(input: Any, context: Any) -> Any:
        return success({"key": "SECRET-VAULT-KEY"})

    async def roll(input: Any, context: Any) -> Any:
        return success({"value": 4})

    sink = MemoryJournalSink()
    registry = create_command_registry(
        middleware=[create_journal_middleware(sink, filter=lambda name: True)]
    )
    registry.register(
        CommandDefinition(
            name="vault-unlock", description="Unlock the vault", handler=unlock, secret=True
        )
    )
    registry.register(CommandDefinition(name="dice-roll", description="Roll", handler=roll))
    await registry.execute("vault-unlock", {"passphrase": "hunter2"})
    await registry.execute("dice-roll", {})
    assert [entry.command for entry in await sink.read()] == ["dice-roll"]


async def test_tells_redact_which_calls_are_secret() -> None:
    seen: list[tuple[str, bool | None]] = []

    def redact(record: JournalRecord, info: JournalRedactInfo) -> JournalRecord | None:
        seen.append((record.command, info.secret))
        return None if info.secret else record

    entries = await _run(filter=lambda name: True, redact=redact)
    assert seen == [("vault-unlock", True), ("dice-roll", False)]
    assert [entry.command for entry in entries] == ["dice-roll"]


async def test_a_one_argument_redact_still_gets_the_record_alone() -> None:
    calls: list[str] = []

    def redact(record: JournalRecord) -> JournalRecord:
        calls.append(record.command)
        return record

    await _run(redact=redact)
    assert calls == ["vault-unlock", "dice-roll"]


async def test_records_nothing_without_redact_where_it_cannot_read_the_declaration() -> None:
    sink = MemoryJournalSink()
    client = DirectClient(
        create_direct_registry([vault_unlock, dice_roll]),
        DirectClientOptions(middleware=[create_journal_middleware(sink, filter=lambda name: True)]),
    )
    await client.call("vault-unlock", {"passphrase": "hunter2"})
    await client.call("dice-roll", {"sides": 6})
    assert await sink.read() == []

    told: list[bool | None] = []

    def redact(record: JournalRecord, info: JournalRedactInfo) -> JournalRecord:
        told.append(info.secret)
        return record

    redacting = DirectClient(
        create_direct_registry([dice_roll]),
        DirectClientOptions(
            middleware=[create_journal_middleware(MemoryJournalSink(), redact=redact)]
        ),
    )
    await redacting.call("dice-roll", {"sides": 6})
    assert told == [None]


class _CountingRandom:
    def __init__(self) -> None:
        self.draws = 0

    def next(self) -> float:
        self.draws += 1
        return 0.25 + 0.01 * self.draws


def _session_server(random: _CountingRandom, **options: Any) -> Any:
    sink = MemoryJournalSink()
    server = create_server(
        "s", random=random, middleware=[create_journal_middleware(sink, **options)]
    )

    @server.command(
        name="token-mint",
        description="Mint a token from random values",
        input_schema=Empty,
        secret=True,
    )
    async def mint(input: Empty, context: CommandContext) -> Any:
        return success({"token": f"T-{context.random.next()}-{context.random.next()}"})

    @server.command(
        name="session-open", description="Open a session, minting its token", input_schema=Empty
    )
    async def open_session(input: Empty, context: CommandContext) -> Any:
        await server.execute("token-mint", {}, context)
        return success({"opened": True})

    return server, sink


async def test_keeps_a_secret_nested_call_off_its_recorded_parents_tape_and_marks_it() -> None:
    random = _CountingRandom()
    server, sink = _session_server(random)
    await server.execute("session-open", {})
    entries = await sink.read()
    assert [entry.command for entry in entries] == ["session-open"]
    assert entries[0].tape is not None
    assert entries[0].tape.random == []
    assert entries[0].tape.truncated is True
    assert random.draws == 2


async def test_keeps_a_recorded_secret_nested_calls_reads_on_its_own_entry() -> None:
    random = _CountingRandom()
    # A redact that keeps every record: the secret call is recorded, its secret left to redact.
    server, sink = _session_server(random, redact=lambda record: record)
    await server.execute("session-open", {})
    child, parent = await sink.read()
    assert (child.command, parent.command) == ("token-mint", "session-open")
    assert child.tape is not None and child.tape.random == [0.26, 0.27]
    assert parent.tape is not None
    assert parent.tape.random == []
    assert parent.tape.truncated is True


def test_refuses_a_secret_that_is_not_a_boolean() -> None:
    with pytest.raises(TypeError, match="secret must be a boolean"):
        define_command(name="vault-unlock", description="Unlock", secret="yes")  # type: ignore[arg-type]

    async def handler(input: Any, context: Any) -> Any:
        return success({})

    server = create_server("s")
    with pytest.raises(TypeError, match="secret must be a boolean"):
        server.command(name="vault-unlock", description="Unlock", secret=1)(handler)  # type: ignore[arg-type]

    definition = CommandDefinition(
        name="vault-unlock",
        description="Unlock",
        handler=handler,
        secret="yes",  # type: ignore[arg-type]
    )
    with pytest.raises(TypeError, match="secret must be a boolean"):
        server.register(definition)
    with pytest.raises(TypeError, match="secret must be a boolean"):
        create_command_registry().register(definition)


async def test_a_context_saved_from_a_finished_call_reads_as_unknown() -> None:
    # The declaration is bound to the dispatch running on that context object, not to the name:
    # once the call ends, the same context read again by a recorder outside the engine is unknown.
    saved: list[CommandContext] = []

    async def keep_context(name: str, input: Any, context: CommandContext, next_fn: Any) -> Any:
        saved.append(context)
        return await next_fn()

    server = create_server("s", middleware=[keep_context])
    server.register(dice_roll)
    await server.execute("dice-roll", {"sides": 6})
    [context] = saved

    async def next_fn() -> Any:
        return success({"key": "SECRET-VAULT-KEY"})

    sink = MemoryJournalSink()
    journal = create_journal_middleware(sink, filter=lambda name: True)
    await journal("dice-roll", {"sides": 6}, context, next_fn)
    assert await sink.read() == []

    told: list[bool | None] = []

    def redact(record: JournalRecord, info: JournalRedactInfo) -> JournalRecord:
        told.append(info.secret)
        return record

    await create_journal_middleware(MemoryJournalSink(), redact=redact)(
        "dice-roll", {"sides": 6}, context, next_fn
    )
    assert told == [None]


async def test_a_nested_call_on_a_fresh_context_with_the_parents_sources_reads_off_its_tape() -> (
    None
):
    random = _CountingRandom()
    sink = MemoryJournalSink()
    server = create_server("s", random=random, middleware=[create_journal_middleware(sink)])

    @server.command(name="token-mint", description="Mint", input_schema=Empty, secret=True)
    async def mint(input: Empty, context: CommandContext) -> Any:
        return success({"token": f"T-{context.random.next()}-{context.clock.now()}"})

    @server.command(name="session-open", description="Open", input_schema=Empty)
    async def open_session(input: Empty, context: CommandContext) -> Any:
        # A context of its own that carries the parent's recording clock and random source.
        fresh = CommandContext(clock=context.clock, random=context.random)
        await server.execute("token-mint", {}, fresh)
        return success({"opened": True})

    await server.execute("session-open", {})
    [entry] = await sink.read()
    assert entry.command == "session-open"
    assert entry.tape is not None
    assert entry.tape.random == []
    assert entry.tape.truncated is True
    assert random.draws == 1


async def test_a_chain_a_handler_runs_on_its_own_context_cannot_read_the_outer_declaration() -> (
    None
):
    # A host's own chain called from inside a handler with the handler's context (as Botcore's
    # MCP wrapper calls `host.execute`) must not read the outer command's "not secret".
    sink = MemoryJournalSink()
    inner = compose_middleware(create_journal_middleware(sink, filter=lambda name: True))
    server = create_server("s")

    @server.command(name="host-call", description="Call a host", input_schema=Empty)
    async def host_call(input: Empty, context: CommandContext) -> Any:
        async def unlock() -> Any:
            return success({"key": "SECRET-VAULT-KEY"})

        return await inner("vault-unlock", {"passphrase": "hunter2"}, context, unlock)

    assert (await server.execute("host-call", {})).success
    assert await sink.read() == []


async def test_a_task_spawned_inside_a_dispatch_stops_reading_it_when_the_dispatch_ends() -> None:
    sink = MemoryJournalSink()
    journal = create_journal_middleware(sink, filter=lambda name: True)
    release = asyncio.Event()
    spawned: list[asyncio.Task[Any]] = []

    async def later(context: CommandContext) -> None:
        await release.wait()

        async def unlock() -> Any:
            return success({"key": "SECRET-VAULT-KEY"})

        await journal("vault-unlock", {"passphrase": "hunter2"}, context, unlock)

    async def spawn(name: str, input: Any, context: CommandContext, next_fn: Any) -> Any:
        # The task inherits a copy of the context variables, the dispatch's entry included.
        spawned.append(asyncio.create_task(later(context)))
        return await next_fn()

    server = create_server("s", middleware=[spawn])
    server.register(dice_roll)
    assert (await server.execute("dice-roll", {"sides": 6})).success
    release.set()
    await spawned[0]
    assert await sink.read() == []


async def _in_a_thread(name: str, input: Any, context: Any, next_fn: Any) -> Any:
    """Runs the rest of the chain on a new event loop in a worker thread, without copying the
    context variables (``run_in_executor`` copies none)."""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, lambda: asyncio.run(next_fn()))


async def test_the_declaration_crosses_a_middleware_that_moves_the_chain_to_a_thread() -> None:
    sink = MemoryJournalSink()
    server = create_server(
        "s", middleware=[_in_a_thread, create_journal_middleware(sink, filter=lambda name: True)]
    )
    server.register(vault_unlock)
    server.register(dice_roll)
    assert (await server.execute("dice-roll", {"sides": 6})).success
    assert (await server.execute("vault-unlock", {"passphrase": "hunter2"})).success
    assert [entry.command for entry in await sink.read()] == ["dice-roll"]


async def test_simple_registry_keeps_secret_given_or_decorated() -> None:
    sink = MemoryJournalSink()
    registry = SimpleRegistry(
        middleware=[create_journal_middleware(sink, filter=lambda name: True)]
    )

    async def unlock(passphrase: str = "") -> Any:
        return success({"key": "SECRET-VAULT-KEY"})

    @define_command(name="vault-open", description="Open", secret=True)
    async def vault_open(passphrase: str = "") -> Any:
        return success({"key": "SECRET-VAULT-KEY"})

    async def roll(sides: int = 6) -> Any:
        return success({"value": 4})

    registry.register("vault-unlock", unlock, secret=True)
    registry.register("vault-open", vault_open)
    registry.register("dice-roll", roll)
    for name in ("vault-unlock", "dice-roll"):
        assert (await registry.execute(name, {})).success
    assert [entry.command for entry in await sink.read()] == ["dice-roll"]
    # A decorated handler takes its input as one object, not as SimpleRegistry's keywords, so
    # the definition the registry built for it is what shows the declaration was kept.
    assert registry._definitions["vault-open"].secret is True
    assert registry._definitions["dice-roll"].secret is False
    with pytest.raises(TypeError, match="secret must be a boolean"):
        registry.register("vault-bad", unlock, secret="yes")  # type: ignore[arg-type]


async def test_mock_server_keeps_secret_given_or_decorated() -> None:
    sink = MemoryJournalSink()
    server = MockServer(middleware=[create_journal_middleware(sink, filter=lambda name: True)])

    @server.command("vault-unlock", secret=True)
    async def unlock(input: Any) -> Any:
        return success({"key": "SECRET-VAULT-KEY"})

    @define_command(name="vault-open", description="Open", secret=True)
    async def vault_open(input: Any) -> Any:
        return success({"key": "SECRET-VAULT-KEY"})

    server.command("vault-open")(vault_open)

    @server.command("dice-roll")
    async def roll(input: Any) -> Any:
        return success({"value": 4})

    for name in ("vault-unlock", "vault-open", "dice-roll"):
        assert (await server.execute(name, {})).success
    assert [entry.command for entry in await sink.read()] == ["dice-roll"]
    with pytest.raises(TypeError, match="secret must be a boolean"):
        server.command("vault-bad", secret=1)(unlock)  # type: ignore[arg-type]


async def test_redact_gets_the_info_only_when_it_asks_for_it() -> None:
    told: dict[str, Any] = {}

    def positional(record: JournalRecord, info: JournalRedactInfo) -> JournalRecord:
        told.setdefault("positional", []).append(info.secret)
        return record

    def keyword(record: JournalRecord, *, info: JournalRedactInfo) -> JournalRecord:
        told.setdefault("keyword", []).append(info.secret)
        return record

    def defaulted(record: JournalRecord, extra: Any = "default") -> JournalRecord:
        told.setdefault("defaulted", []).append(extra)
        return record

    def variadic(record: JournalRecord, *rest: Any) -> JournalRecord:
        told.setdefault("variadic", []).append(rest)
        return record

    for redact in (positional, keyword, defaulted, variadic):
        await _run(redact=redact)
    assert told == {
        "positional": [True, False],
        "keyword": [True, False],
        "defaulted": ["default", "default"],
        "variadic": [(), ()],
    }


async def test_a_recorder_given_its_own_next_on_the_dispatch_context_reads_unknown() -> None:
    # After the handler returns, an outer middleware runs a separate journal on the context the
    # handler kept, with a `next` of its own: it must not read the dispatch's "not secret".
    kept: dict[str, Any] = {}
    later = MemoryJournalSink()
    own = create_journal_middleware(later, filter=lambda name: True)

    @define_command(name="report-build", description="Keep the context", input_schema=Empty)
    async def report_build(input: Empty, context: Any = None) -> Any:
        kept["ctx"] = context
        return success({})

    async def outer(name: str, input: Any, context: CommandContext, next_fn: Any) -> Any:
        result = await next_fn()

        async def inner() -> Any:
            return success({"key": "SECRET-VAULT-KEY"})

        await own("vault-read", {"passphrase": "hunter2"}, kept["ctx"], inner)
        return result

    server = create_server("s", middleware=[outer])
    server.register(report_build)
    assert (await server.execute("report-build", {})).success
    assert await later.read() == []


async def test_a_retry_that_calls_next_twice_records_both_calls() -> None:
    sink = MemoryJournalSink()

    async def retry(name: str, input: Any, context: CommandContext, next_fn: Any) -> Any:
        await next_fn()
        return await next_fn()

    server = create_server("s", middleware=[retry, create_journal_middleware(sink)])
    server.register(dice_roll)
    assert (await server.execute("dice-roll", {"sides": 6})).success
    assert [entry.command for entry in await sink.read()] == ["dice-roll", "dice-roll"]


async def test_a_journal_inside_compose_middleware_still_reads_the_declaration() -> None:
    sink = MemoryJournalSink()
    seen: list[tuple[str, bool | None]] = []

    async def passthrough(name: str, input: Any, context: CommandContext, next_fn: Any) -> Any:
        return await next_fn()

    def redact(record: JournalRecord, info: JournalRedactInfo) -> JournalRecord | None:
        seen.append((record.command, info.secret))
        return None if info.secret else record

    composed = compose_middleware(
        passthrough, create_journal_middleware(sink, filter=lambda name: True, redact=redact)
    )
    server = create_server("s", middleware=[composed])
    server.register(vault_unlock)
    server.register(dice_roll)
    await server.execute("vault-unlock", {"passphrase": "hunter2"})
    await server.execute("dice-roll", {"sides": 6})
    assert seen == [("vault-unlock", True), ("dice-roll", False)]
    assert [entry.command for entry in await sink.read()] == ["dice-roll"]

    # Without redact, the composed journal still refuses the secret call and records the other.
    plain = MemoryJournalSink()
    server = create_server(
        "s",
        middleware=[
            compose_middleware(passthrough, create_journal_middleware(plain, filter=lambda n: True))
        ],
    )
    server.register(vault_unlock)
    server.register(dice_roll)
    await server.execute("vault-unlock", {"passphrase": "hunter2"})
    await server.execute("dice-roll", {"sides": 6})
    assert [entry.command for entry in await plain.read()] == ["dice-roll"]


# ── An engine of its own: open_dispatch ─────────────────────────────────


def _own_engine(*middleware: Any) -> Any:
    """A minimal engine outside AFD's executor (as Botcore's CommandHost is): it opens a dispatch
    for each call, binds the continuation it hands its composed chain, and closes it after."""
    chain = compose_middleware(*middleware)

    async def execute(
        name: str, input: Any, context: CommandContext, handler: Any, *, secret: bool
    ) -> Any:
        with open_dispatch(context, secret=secret) as dispatch:
            return await chain(name, input, context, dispatch.bind(handler))

    return execute


async def _unlock() -> Any:
    return success({"key": "SECRET-VAULT-KEY"})


async def _roll() -> Any:
    return success({"value": 4})


async def test_an_engine_of_its_own_binds_the_declaration_with_open_dispatch() -> None:
    sink = MemoryJournalSink()
    execute = _own_engine(create_journal_middleware(sink, filter=lambda name: True))
    await execute("vault-unlock", {"passphrase": "hunter2"}, CommandContext(), _unlock, secret=True)
    await execute("dice-roll", {"sides": 6}, CommandContext(), _roll, secret=False)
    entries = await sink.read()
    assert [entry.command for entry in entries] == ["dice-roll"]
    assert "hunter2" not in _text(entries) and "SECRET" not in _text(entries)


async def test_open_dispatch_tells_redact_which_calls_are_secret() -> None:
    seen: list[tuple[str, bool | None]] = []

    def redact(record: JournalRecord, info: JournalRedactInfo) -> JournalRecord:
        seen.append((record.command, info.secret))
        return record

    execute = _own_engine(create_journal_middleware(MemoryJournalSink(), redact=redact))
    await execute("vault-unlock", {}, CommandContext(), _unlock, secret=True)
    await execute("dice-roll", {}, CommandContext(), _roll, secret=False)
    assert seen == [("vault-unlock", True), ("dice-roll", False)]


async def test_a_dispatch_reads_only_on_its_own_context_and_only_while_open() -> None:
    context = CommandContext()
    dispatch = open_dispatch(context, secret=False)
    bound = dispatch.bind(_roll)
    assert bound is not _roll and dispatch.open and dispatch.secret is False
    assert running_command_secret(context, bound) is False
    assert running_command_secret(CommandContext(), bound) is None
    dispatch.close()
    assert not dispatch.open
    assert running_command_secret(context, bound) is None
    with pytest.raises(RuntimeError, match="closed dispatch"):
        dispatch.bind(_unlock)


def test_open_dispatch_refuses_a_secret_that_is_not_a_boolean() -> None:
    for wrong in ("yes", 1, None):
        with pytest.raises(TypeError, match="secret must be a bool"):
            open_dispatch(CommandContext(), secret=wrong)  # type: ignore[arg-type]


async def test_open_dispatch_keeps_a_secret_call_off_a_recording_parents_tape() -> None:
    random = _CountingRandom()
    sink = MemoryJournalSink()
    execute = _own_engine(create_journal_middleware(sink))
    context = CommandContext(random=random)

    async def mint() -> Any:
        return success({"token": f"T-{context.random.next()}"})

    async def open_session() -> Any:
        # The parent's recorder has wrapped context.random; the secret child reads through it.
        await execute("token-mint", {}, context, mint, secret=True)
        return success({"opened": True})

    await execute("session-open", {}, context, open_session, secret=False)
    [entry] = await sink.read()
    assert entry.command == "session-open"
    assert entry.tape is not None
    assert entry.tape.random == []
    assert entry.tape.truncated is True
    assert random.draws == 1


async def test_each_binding_is_a_new_continuation_so_none_replaces_or_revives_another() -> None:
    context = CommandContext()
    with open_dispatch(context, secret=True) as first:
        kept = first.bind(_unlock)
        assert running_command_secret(context, kept) is True
    with open_dispatch(context, secret=False) as second:
        again = second.bind(_unlock)
        assert again is not kept
        assert running_command_secret(context, again) is False
        # The continuation kept from the closed dispatch stays unknown.
        assert running_command_secret(context, kept) is None
    assert (await again()).data == {"key": "SECRET-VAULT-KEY"}


async def test_marks_every_recording_layers_tape_around_a_secret_call() -> None:
    random = _CountingRandom()
    outer_sink, inner_sink = MemoryJournalSink(), MemoryJournalSink()
    execute = _own_engine(
        create_journal_middleware(outer_sink), create_journal_middleware(inner_sink)
    )
    context = CommandContext(random=random)

    async def mint() -> Any:
        return success({"token": f"T-{context.random.next()}"})

    async def open_session() -> Any:
        await execute("token-mint", {}, context, mint, secret=True)
        return success({"opened": True})

    await execute("session-open", {}, context, open_session, secret=False)
    for sink in (outer_sink, inner_sink):
        [entry] = await sink.read()
        assert entry.tape is not None and entry.tape.random == []
        assert entry.tape.truncated is True


async def test_run_off_tape_keeps_a_call_off_a_parents_tape_with_no_recorder_of_its_own() -> None:
    random = _CountingRandom()
    sink = MemoryJournalSink()
    execute = _own_engine(create_journal_middleware(sink))
    context = CommandContext(random=random)

    async def mint() -> Any:
        return success({"token": f"T-{context.random.next()}"})

    async def open_session() -> Any:
        # The secret call runs with no recorder in its path, as a host with no journal of its
        # own runs one inside a call an outer journal records.
        await run_off_tape(context, mint)
        return success({"opened": True})

    await execute("session-open", {}, context, open_session, secret=False)
    [entry] = await sink.read()
    assert entry.tape is not None
    assert entry.tape.random == []
    assert entry.tape.truncated is True
    assert random.draws == 1


async def test_a_dispatch_closes_when_the_chain_raises() -> None:
    context = CommandContext()
    kept: list[Any] = []

    async def failing() -> Any:
        raise RuntimeError("boom")

    dispatch = open_dispatch(context, secret=False)
    with pytest.raises(RuntimeError, match="boom"), dispatch:
        kept.append(dispatch.bind(failing))
        await kept[0]()
    assert not dispatch.open
    assert running_command_secret(context, kept[0]) is None


def test_a_bound_coroutine_continuation_stays_a_coroutine_function() -> None:
    import inspect

    def plain() -> Any:
        return _roll()

    with open_dispatch(CommandContext(), secret=False) as dispatch:
        assert inspect.iscoroutinefunction(dispatch.bind(_roll))
        assert not inspect.iscoroutinefunction(dispatch.bind(plain))


def test_open_dispatch_leaves_mutation_unknown_unless_told() -> None:
    from afd.core.running_command import running_command_mutation

    context = CommandContext()
    with open_dispatch(context, secret=False) as unknown:
        assert running_command_mutation(context, unknown.bind(_roll)) is None
    with open_dispatch(context, secret=False, mutation=True) as told:
        assert running_command_mutation(context, told.bind(_roll)) is True
    with pytest.raises(TypeError, match="mutation must be a bool or None"):
        open_dispatch(context, secret=False, mutation="yes")  # type: ignore[arg-type]


@pytest.mark.parametrize(("mutation", "attempts"), [(None, 1), (True, 1), (False, 3)])
async def test_retry_behind_open_dispatch_repeats_only_a_declared_non_mutation(
    mutation: bool | None, attempts: int
) -> None:
    from afd import error
    from afd.server.middleware import create_retry_middleware

    calls: list[int] = []

    async def flaky() -> Any:
        calls.append(1)
        return error("TRANSIENT_ERROR", "temporary", suggestion="Retry")

    chain = compose_middleware(create_retry_middleware(max_retries=2, retry_delay=0))
    context = CommandContext()
    with open_dispatch(context, secret=False, mutation=mutation) as dispatch:
        await chain("probe", {}, context, dispatch.bind(flaky))
    assert len(calls) == attempts
