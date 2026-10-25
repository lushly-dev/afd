"""Context stacks owned by trusted MCP transport sessions, or by one MCP 2026-07-28 request.

The SDK connection behind a ServerSession is the identity of a 2025-era
(``initialize``) connection, never tool arguments, request metadata or client-supplied session
names. Weak keys release stacks when the transport releases its sessions.
ContextVar binding also propagates to batch item tasks without exposing an
identity field in CommandContext.extra.

An MCP 2026-07-28 request has no session: its active context is request input,
``_meta["dev.afd/context"]``, held in a non-persistent per-request state.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any, Collection
from weakref import WeakKeyDictionary

from afd.server.bootstrap.afd_context import AFD_CONTEXT_META_KEY, ContextState

MODERN_PROTOCOL_VERSION = "2026-07-28"
"""The first MCP revision without sessions (per-request ``_meta``)."""


class UnknownContextError(ValueError):
    """``_meta["dev.afd/context"]`` names a context the server does not configure."""


def is_modern_protocol(version: Any) -> bool:
    """Whether a negotiated protocol version is MCP 2026-07-28 or later."""
    return isinstance(version, str) and version >= MODERN_PROTOCOL_VERSION


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

    @property
    def persistent(self) -> bool:  # type: ignore[override]
        return self._state().persistent

    def get_active(self) -> str | None:
        return self._state().get_active()

    def enter(self, name: str) -> None:
        self._state().enter(name)

    def exit(self) -> str | None:
        return self._state().exit()

    @contextmanager
    def bind(
        self,
        request: Any,
        *,
        stateless: bool = False,
        contexts: Collection[str] = (),
    ) -> Iterator[None]:
        """Bind the state of one SDK request (``ServerRequestContext``).

        ``None`` means an in-process call, which uses the local stack. A modern
        request gets a per-request state with its ``_meta`` context active; a
        2025-era request over stateless HTTP gets a state that cannot change; any
        other 2025-era request shares its session's stack.

        Raises:
            UnknownContextError: a modern request names an unconfigured context.
        """
        if request is None:
            yield
            return
        if is_modern_protocol(getattr(request, "protocol_version", None)):
            state = ContextState(persistent=False)
            params = getattr(request, "params", None)
            meta = params.get("_meta") if isinstance(params, dict) else None
            requested = meta.get(AFD_CONTEXT_META_KEY) if isinstance(meta, dict) else None
            if requested is not None:
                if not isinstance(requested, str) or requested not in contexts:
                    raise UnknownContextError(
                        f'Unknown context in _meta["{AFD_CONTEXT_META_KEY}"]'
                    )
                state.enter(requested)
        elif stateless and getattr(request, "request", None) is not None:
            # SDK stateless HTTP creates a new ServerSession for each request.
            # Do not report a context change that cannot persist to the next one.
            state = ContextState()
            state.session_available = False
        else:
            session = getattr(request, "session", None)
            if session is None:
                yield
                return
            # mcp 2.x builds a ServerSession per request; the connection it wraps is
            # the identity of a 2025-era client. There is no public accessor, and the
            # live session-isolation tests fail if this stops holding.
            identity = getattr(session, "_connection", session)
            state = self.sessions.get(identity)
            if state is None:
                state = ContextState()
                self.sessions[identity] = state
        token = self._current.set(state)
        try:
            yield
        finally:
            self._current.reset(token)
