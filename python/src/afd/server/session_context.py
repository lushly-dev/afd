"""Context stacks owned by trusted MCP transport sessions.

The SDK's ServerSession object is the identity, never tool arguments, request
metadata or client-supplied session names. Weak keys release stacks when the
transport releases its sessions. ContextVar binding also propagates to batch
item tasks without exposing an identity field in CommandContext.extra.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any
from weakref import WeakKeyDictionary

from afd.server.bootstrap.afd_context import ContextState


class SessionContextState(ContextState):
    """A compatibility facade over the current session or local default stack."""

    def __init__(self) -> None:
        self.local = ContextState()
        self.sessions: WeakKeyDictionary[Any, ContextState] = WeakKeyDictionary()
        self._current: ContextVar[ContextState | None] = ContextVar(
            "afd_session_context", default=None
        )

    def _state(self) -> ContextState:
        return self._current.get() or self.local

    @property
    def stack(self) -> list[str]:
        return self._state().stack

    @property
    def max_depth(self) -> int:
        return self._state().max_depth

    @property
    def session_available(self) -> bool:
        return self._state().session_available

    def get_active(self) -> str | None:
        return self._state().get_active()

    def enter(self, name: str) -> None:
        self._state().enter(name)

    def exit(self) -> str | None:
        return self._state().exit()

    @contextmanager
    def bind(self, context: Any, *, stateless: bool = False) -> Iterator[None]:
        """Bind an SDK context; absence of a request means an in-process call."""
        try:
            session = context.session
        except (AttributeError, ValueError):
            yield
            return
        if stateless and context.request_context.request is not None:
            # SDK stateless HTTP creates a new ServerSession for each request.
            # Do not report a context change that cannot persist to the next one.
            state = ContextState()
            state.session_available = False
        else:
            state = self.sessions.get(session)
            if state is None:
                state = ContextState()
                self.sessions[session] = state
        token = self._current.set(state)
        try:
            yield
        finally:
            self._current.reset(token)
