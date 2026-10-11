"""Ownership and local-default contracts for transport-scoped context stacks."""

import asyncio
import gc
from types import SimpleNamespace
from weakref import ref

import pytest

from afd.core.commands import CommandContext
from afd.server import create_server
from afd.server.bootstrap.afd_context import ContextState, create_context_state
from afd.server.session_context import SessionContextState
from afd.server.types import ContextConfig


class TransportSession:
    pass


def test_session_state_lifetime_and_exception_safe_scope():
    state = SessionContextState()
    state.enter("local")
    session = TransportSession()
    context = SimpleNamespace(session=session)
    with pytest.raises(RuntimeError), state.bind(context):
        state.enter("remote")
        raise RuntimeError("handler failed")
    assert state.get_active() == "local"
    with state.bind(context):
        assert state.get_active() == "remote"
    owner = ref(session)
    assert len(state.sessions) == 1
    del context, session
    gc.collect()
    assert owner() is None
    assert len(state.sessions) == 0


async def test_context_scope_propagates_to_tasks_without_crossing_sessions():
    state = SessionContextState()

    async def caller(name):
        with state.bind(SimpleNamespace(session=TransportSession())):
            state.enter(name)
            await asyncio.sleep(0)

            async def item():
                return state.get_active()

            return await asyncio.create_task(item())

    assert await asyncio.gather(caller("alice"), caller("bob")) == ["alice", "bob"]
    assert state.get_active() is None


async def test_local_execution_default_ignores_untrusted_supplied_identity():
    server = create_server(
        "local", contexts=[ContextConfig(name="alpha"), ContextConfig(name="beta")]
    )
    first = CommandContext(extra={"sessionId": "a", "session_id": "a"})
    second = CommandContext(extra={"sessionId": "b", "session_id": "b"})
    await server.execute("afd-context-enter", {"context": "alpha"}, first)
    # Local callers deliberately share the server's default; arbitrary strings
    # in CommandContext.extra do not create or impersonate transport sessions.
    result = await server.execute("afd-context-list", {}, second)
    assert result.data.active_context == "alpha"
    transport = SimpleNamespace(session=TransportSession())
    with server._context_state.bind(transport):
        assert server.context_state.get_active() is None
        await server.execute("afd-context-enter", {"context": "beta"})
        assert server.context_state.get_active() == "beta"
    assert server.context_state.get_active() == "alpha"


@pytest.mark.parametrize("depth", [0, -1, True, 1.5])
def test_context_depth_must_be_a_positive_integer(depth):
    with pytest.raises(ValueError, match="positive integer"):
        create_context_state(depth)


def test_context_state_depth_and_duplicate_active_context():
    state = ContextState(max_depth=2)
    state.enter("alpha")
    state.enter("alpha")
    assert state.stack == ["alpha"]
    state.enter("beta")
    with pytest.raises(ValueError, match="limited to 2"):
        state.enter("alpha")
    assert state.stack == ["alpha", "beta"]
