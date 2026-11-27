"""A command's ``secret`` on its CommandPolicy, read by AFD's journal behind the host."""

from __future__ import annotations

from typing import Any

import pytest
from afd import JournalRecord, MemoryJournalSink, serialize_journal, success
from afd.core.commands import CommandContext
from afd.server import JournalRedactInfo
from afd.server.journal import create_journal_middleware

from botcore.context import ExecutionContext, current_call
from botcore.host import CommandHost, CommandPolicy, narrow_policy


class _CountingRandom:
    def __init__(self) -> None:
        self.draws = 0

    def next(self) -> float:
        self.draws += 1
        return 0.25 + 0.01 * self.draws


async def vault_unlock(passphrase: str = ""):
    """Unlock the vault."""
    return success({"key": "SECRET-VAULT-KEY"})


async def dice_roll(sides: int = 6):
    """Roll a die."""
    return success({"value": 4})


def make_host(tmp_path, *middleware: Any) -> CommandHost:
    host = CommandHost("vault", ExecutionContext(tmp_path, profile="trusted-local"))
    host.register("vault-unlock", vault_unlock, CommandPolicy(secret=True))
    host.register("dice-roll", dice_roll, CommandPolicy())
    host.middleware.extend(middleware)
    return host


async def test_records_a_non_secret_call_and_skips_a_secret_one_without_redact(tmp_path):
    sink = MemoryJournalSink()
    host = make_host(tmp_path, create_journal_middleware(sink, filter=lambda name: True))
    assert (await host.execute("vault-unlock", {"passphrase": "hunter2"})).success
    assert (await host.execute("dice-roll", {"sides": 6})).success
    entries = await sink.read()
    assert [entry.command for entry in entries] == ["dice-roll"]
    text = serialize_journal(entries)
    assert "hunter2" not in text and "SECRET" not in text


async def test_tells_a_two_argument_redact_which_calls_are_secret(tmp_path):
    seen: list[tuple[str, bool | None]] = []

    def redact(record: JournalRecord, info: JournalRedactInfo) -> JournalRecord:
        seen.append((record.command, info.secret))
        return record

    host = make_host(tmp_path, create_journal_middleware(MemoryJournalSink(), redact=redact))
    await host.execute("vault-unlock", {})
    await host.execute("dice-roll", {})
    assert seen == [("vault-unlock", True), ("dice-roll", False)]


async def test_the_declaration_reaches_a_journal_behind_other_middleware(tmp_path):
    sink = MemoryJournalSink()

    async def passthrough(command, args, context, next_fn):
        return await next_fn()

    host = make_host(tmp_path, passthrough, create_journal_middleware(sink))
    await host.execute("vault-unlock", {})
    await host.execute("dice-roll", {})
    assert [entry.command for entry in await sink.read()] == ["dice-roll"]


async def test_keeps_a_secret_nested_call_off_its_recording_parents_tape(tmp_path):
    random = _CountingRandom()
    sink = MemoryJournalSink()
    host = make_host(tmp_path, create_journal_middleware(sink))

    async def token_mint():
        """Mint a token from random values."""
        return success({"token": f"T-{current_call().random.next()}"})

    async def session_open():
        """Open a session, minting its token."""
        await host.execute("token-mint", {}, current_call())
        return success({"opened": True})

    host.register("token-mint", token_mint, CommandPolicy(secret=True))
    host.register("session-open", session_open, CommandPolicy())
    assert (await host.execute("session-open", {}, CommandContext(random=random))).success
    [entry] = await sink.read()
    assert entry.command == "session-open"
    assert entry.tape is not None
    assert entry.tape.random == []
    assert entry.tape.truncated is True
    assert random.draws == 1


@pytest.mark.parametrize("wrong", ["yes", 1, None])
def test_refuses_a_secret_that_is_not_a_boolean(wrong):
    with pytest.raises(TypeError, match="secret must be a bool"):
        CommandPolicy(secret=wrong)


def test_the_catalog_shows_the_declaration(tmp_path):
    rows = {row["name"]: row for row in make_host(tmp_path).catalog()}
    assert rows["vault-unlock"]["secret"] is True
    assert rows["dice-roll"]["secret"] is False


def test_a_host_policy_may_add_the_declaration_but_not_remove_it():
    assert narrow_policy("x", CommandPolicy(), CommandPolicy(secret=True)).secret is True
    assert narrow_policy("x", CommandPolicy(secret=True), CommandPolicy()).secret is True
    assert narrow_policy("x", CommandPolicy(), CommandPolicy()).secret is False


async def test_the_mcp_server_declares_it_on_the_afd_command_and_journals_by_it(tmp_path):
    pytest.importorskip("mcp")
    from botcore.host_surfaces import create_host_mcp_server

    sink = MemoryJournalSink()
    mcp = create_host_mcp_server(
        make_host(tmp_path),
        middleware=[create_journal_middleware(sink, filter=lambda name: True)],
    )
    secrets = {command.name: command.secret for command in mcp.afd_server.list_commands()}
    assert (secrets["vault-unlock"], secrets["dice-roll"]) == (True, False)
    await mcp.afd_server.execute("vault-unlock", {"passphrase": "hunter2"})
    await mcp.afd_server.execute("dice-roll", {"sides": 6})
    assert [entry.command for entry in await sink.read()] == ["dice-roll"]


async def test_a_secret_call_reads_off_an_outer_journals_tape_with_none_in_the_host(tmp_path):
    # The journal is on the MCP server only; the host's own chain has none.
    pytest.importorskip("mcp")
    from botcore.host_surfaces import create_host_mcp_server

    random = _CountingRandom()
    sink = MemoryJournalSink()
    host = make_host(tmp_path)

    async def token_mint():
        """Mint a token from random values."""
        return success({"token": f"T-{current_call().random.next()}"})

    async def session_open():
        """Open a session, minting its token."""
        await host.execute("token-mint", {}, current_call())
        return success({"opened": True})

    host.register("token-mint", token_mint, CommandPolicy(secret=True))
    host.register("session-open", session_open, CommandPolicy())
    mcp = create_host_mcp_server(host, random=random, middleware=[create_journal_middleware(sink)])
    assert (await mcp.afd_server.execute("session-open", {})).success
    [entry] = await sink.read()
    assert entry.command == "session-open"
    assert entry.tape is not None
    assert entry.tape.random == []
    assert entry.tape.truncated is True
    assert random.draws == 1


async def test_a_host_journal_inside_the_mcp_server_reads_the_declaration(tmp_path):
    # AFD's dispatch and the host's are both open on one context object.
    pytest.importorskip("mcp")
    from botcore.host_surfaces import create_host_mcp_server

    sink = MemoryJournalSink()
    mcp = create_host_mcp_server(make_host(tmp_path, create_journal_middleware(sink)))
    await mcp.afd_server.execute("vault-unlock", {"passphrase": "hunter2"})
    await mcp.afd_server.execute("dice-roll", {"sides": 6})
    entries = await sink.read()
    assert [entry.command for entry in entries] == ["dice-roll"]
    assert "hunter2" not in serialize_journal(entries)


def test_a_handler_decorated_secret_is_secret_under_a_default_policy(tmp_path):
    # Fail-safe only: a define_command wrapper is not a host handler shape, but a declaration
    # on one is never read as not secret.
    from afd.server import define_command

    @define_command(name="token-issue", description="Issue a token", secret=True)
    async def token_issue():
        """Issue a token."""
        return success({"token": "SECRET-TOKEN"})

    host = make_host(tmp_path)
    host.register("token-issue", token_issue, CommandPolicy())
    assert host.policy("token-issue").secret is True


async def test_a_redacted_secret_call_keeps_its_reads_on_its_own_mcp_entry(tmp_path):
    pytest.importorskip("mcp")
    from botcore.host_surfaces import create_host_mcp_server

    random = _CountingRandom()
    sink = MemoryJournalSink()
    host = make_host(tmp_path)

    async def token_mint():
        """Mint a token from random values."""
        return success({"token": f"T-{current_call().random.next()}"})

    host.register("token-mint", token_mint, CommandPolicy(secret=True))
    mcp = create_host_mcp_server(
        host, random=random, middleware=[create_journal_middleware(sink, redact=lambda r: r)]
    )
    assert (await mcp.afd_server.execute("token-mint", {})).success
    [entry] = await sink.read()
    assert entry.command == "token-mint"
    assert entry.tape is not None and entry.tape.random == [0.26]
    assert entry.tape.truncated is not True


def test_the_mcp_server_passes_no_secret_to_an_afd_that_predates_it(tmp_path, monkeypatch):
    # afd before 0.14.0: define_command takes no `secret`, so it must not be passed.
    pytest.importorskip("mcp")
    import afd.server

    import botcore.host_surfaces as surfaces

    real = afd.server.define_command
    seen: list[dict[str, Any]] = []

    def old_define_command(**options: Any) -> Any:
        if "secret" in options:
            raise TypeError("define_command() got an unexpected keyword argument 'secret'")
        seen.append(options)
        return real(**options)

    monkeypatch.setattr(surfaces, "SECRET_AWARE", False)
    monkeypatch.setattr(afd.server, "define_command", old_define_command)
    surfaces.create_host_mcp_server(make_host(tmp_path))
    assert {options["name"] for options in seen} >= {"vault-unlock", "dice-roll"}


def test_registering_a_secret_command_warns_on_an_afd_that_cannot_honour_it(tmp_path, monkeypatch):
    import botcore.host as host_module

    monkeypatch.setattr(host_module, "declared_secret", None)
    host = CommandHost("vault", ExecutionContext(tmp_path, profile="trusted-local"))
    with pytest.warns(RuntimeWarning, match="predates 0.14.0"):
        host.register("vault-unlock", vault_unlock, CommandPolicy(secret=True))


async def test_with_no_journal_on_the_mcp_server_the_host_isolates_a_secret_call(tmp_path):
    # A recorder outside the MCP server records a call that runs a secret command through it.
    pytest.importorskip("mcp")
    from afd.server.middleware import compose_middleware

    from botcore.host_surfaces import create_host_mcp_server

    random = _CountingRandom()
    sink = MemoryJournalSink()
    host = make_host(tmp_path)

    async def token_mint():
        """Mint a token from random values."""
        return success({"token": f"T-{current_call().random.next()}"})

    host.register("token-mint", token_mint, CommandPolicy(secret=True))
    mcp = create_host_mcp_server(host)
    outer = compose_middleware(create_journal_middleware(sink, redact=lambda record: record))
    context = CommandContext(random=random)

    async def session_open():
        await mcp.afd_server.execute("token-mint", {}, context)
        return success({"opened": True})

    await outer("session-open", {}, context, session_open)
    [entry] = await sink.read()
    assert entry.tape is not None
    assert entry.tape.random == []
    assert entry.tape.truncated is True


async def test_isolation_covers_only_the_call_it_marks(tmp_path):
    import botcore.host as host_module

    seen: list[bool] = []

    async def probe():
        """Report whether the call it runs in is marked isolated."""
        seen.append(host_module._ISOLATED.get())
        return success({})

    host = make_host(tmp_path)
    host.register("probe", probe, CommandPolicy())
    with host_module.isolated_call():
        assert (await host.execute("probe", {})).success
    assert seen == [False]


async def test_a_journal_composed_inside_other_middleware_keeps_its_own_tape(tmp_path):
    pytest.importorskip("mcp")
    from afd.server.middleware import compose_middleware

    from botcore.host_surfaces import create_host_mcp_server

    random = _CountingRandom()
    sink = MemoryJournalSink()
    host = make_host(tmp_path)

    async def token_mint():
        """Mint a token from random values."""
        return success({"token": f"T-{current_call().random.next()}"})

    host.register("token-mint", token_mint, CommandPolicy(secret=True))
    journal = compose_middleware(create_journal_middleware(sink, redact=lambda record: record))
    mcp = create_host_mcp_server(host, random=random, middleware=[journal])
    assert (await mcp.afd_server.execute("token-mint", {})).success
    [entry] = await sink.read()
    assert entry.tape is not None and entry.tape.random == [0.26]
    assert entry.tape.truncated is not True
