"""How the MCP server's lanes serve the idempotency step (``spec/idempotency.md``, S3, K5): the
step built from the server's option, the credentials a scope binds, who the lane says the caller
is, and the per-connection object that tells anonymous stdio callers apart.
"""

from __future__ import annotations

import contextvars
import functools
from collections.abc import Callable, Iterator, Mapping
from contextlib import ExitStack, contextmanager
from contextvars import ContextVar
from typing import Any

from afd.core.actor import Actor
from afd.core.output_budget import bind_output_budget_ask
from afd.server.context_fields import bind_context_field_values
from afd.server.idempotency_step import (
    IdempotencyCaller,
    IdempotencyOptions,
    IdempotencyStep,
    bind_request_idempotency_key,
    create_idempotency_step,
)
from afd.server.principal import sdk_access_token, sdk_credentials
from afd.server.sdk_internals import connection_identity

__all__ = [
    "CURRENT_CONNECTION",
    "IdempotencyOptions",
    "bind_meta_values",
    "bind_request_idempotency_key",
    "build_idempotency_step",
    "caller_for",
    "idempotency_caller",
    "idempotency_credentials",
    "router_deps",
    "tag_connections",
]

# One object per connection the low-level server serves with `Server.run` (stdio, SSE, in
# memory), seen by each of its requests, so they can be told apart from another connection's
# (S3). Streamable HTTP does not use `run`. See afd.server.sdk_internals.READ_STREAM_CONTEXT.
CURRENT_CONNECTION: ContextVar[object | None] = ContextVar("afd_mcp_connection", default=None)


class _ConnectionStream:
    """A connection's read stream whose per-message context (``last_context``, which the SDK's
    dispatcher runs each request's handler in) also binds the connection's own object."""

    def __init__(self, inner: Any, connection: object) -> None:
        self._inner = inner
        self._connection = connection

    @property
    def last_context(self) -> contextvars.Context:
        sender = getattr(self._inner, "last_context", None)
        context = (
            sender.copy() if isinstance(sender, contextvars.Context) else contextvars.copy_context()
        )
        context.run(CURRENT_CONNECTION.set, self._connection)
        return context

    async def receive(self) -> Any:
        return await self._inner.receive()

    def __aiter__(self) -> _ConnectionStream:
        return self

    async def __anext__(self) -> Any:
        import anyio

        try:
            return await self._inner.receive()
        except anyio.EndOfStream:
            raise StopAsyncIteration from None

    async def __aenter__(self) -> _ConnectionStream:
        await self._inner.__aenter__()
        return self

    async def __aexit__(self, *exc: Any) -> Any:
        return await self._inner.__aexit__(*exc)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._inner, name)


def tag_connections(lowlevel: Any) -> None:
    """Wrap ``lowlevel.run`` so each connection it serves carries an object of its own."""
    original = getattr(lowlevel, "run", None) if lowlevel is not None else None
    if original is None or getattr(lowlevel, "_afd_tags_connections", False):
        return

    async def run(read_stream: Any, *args: Any, **kwargs: Any) -> Any:
        return await original(_ConnectionStream(read_stream, object()), *args, **kwargs)

    lowlevel.run = run
    lowlevel._afd_tags_connections = True


def idempotency_credentials(context: Any, *, auth_layer: bool = False) -> Any:
    """The credentials a call's idempotency scope binds (K5): those on the context, which AFD's
    auth layer admitted. Without an auth layer, the MCP SDK's verified token for the request
    being served stands in, as the approver's principal binding takes it (M8). Raises
    ``IncompleteCredentials`` for a token that cannot be bound (S3)."""
    credentials = getattr(context, "credentials", None)
    if credentials is not None or auth_layer:
        return credentials
    return sdk_credentials()


def build_idempotency_step(
    config: Any, default_timeout_ms: float | None, *, auth_layer: bool = False
) -> IdempotencyStep | None:
    """The server's step from its ``idempotency`` option, checked against the default deadline
    (S8), or ``None`` without the option. ``auth_layer`` says whether AFD's auth layer admits the
    server's callers, so the step binds only the credentials it admitted.

    Raises:
        TypeError: For an option that is not an ``IdempotencyOptions``.
        ValueError: For a configuration S8 refuses.
    """
    options = config.idempotency
    if options is None:
        return None
    if not isinstance(options, IdempotencyOptions):
        raise TypeError("idempotency must be an IdempotencyOptions instance")
    return create_idempotency_step(
        options,
        clock=config.clock,
        default_timeout_ms=default_timeout_ms,
        context_field_names=[field.name for field in config.context_fields],
        credentials_of=functools.partial(idempotency_credentials, auth_layer=auth_layer),
    )


def idempotency_caller(
    step: IdempotencyStep | None,
    request_context: Any,
    own_actor: Any,
    credentials: Any,
    hook_declared: bool,
    *,
    auth_layer: bool = False,
    default_actor: Any = None,
) -> IdempotencyCaller | None:
    """Who the lane says the caller of the MCP request being served is (S3): an HTTP caller,
    identified when the server can tell its callers apart (verified credentials, or a context
    hook the host declared identifies every caller); or, on a connection (stdio), the
    connection, which the step uses for a caller that, as middleware leaves it, has no identity
    of its own (``default_actor`` counts as none). ``None`` outside an MCP request, or without
    the step. Behind AFD's auth layer (``auth_layer``), only the
    credentials it admitted identify a caller, never the SDK's own token."""
    if step is None or request_context is None:
        return None
    if getattr(request_context, "request", None) is not None:
        return IdempotencyCaller(
            "http",
            identified=credentials is not None
            or (not auth_layer and sdk_access_token() is not None)
            or hook_declared,
        )
    connection = CURRENT_CONNECTION.get()
    if connection is None:
        # A connection the server did not see start (the SDK's in-process client, which
        # dispatches without streams). A 2025 connection keeps its identity across requests;
        # a 2026-07-28 request has none of its own, so its caller cannot be told apart.
        session = getattr(request_context, "session", None)
        if session is not None and not _is_modern(request_context):
            connection = connection_identity(session)
    # On a connection, whether the caller has an identity of its own is decided when the step
    # runs, from the context as middleware left it (S3, K5). Without one, an anonymous caller
    # cannot be told apart and is refused with K2, before confirmation (spec/dispatch.md).
    if connection is None:
        return IdempotencyCaller("unidentified", default_actor=default_actor)
    return IdempotencyCaller("connection", connection=connection, default_actor=default_actor)


def _is_modern(request_context: Any) -> bool:
    try:
        from mcp_types.version import MODERN_PROTOCOL_VERSIONS
    except ImportError:  # pragma: no cover - optional dependency
        return False
    return getattr(request_context, "protocol_version", None) in MODERN_PROTOCOL_VERSIONS


def caller_for(
    server: Any, current_request: Callable[[], Any]
) -> Callable[[Any, Any], IdempotencyCaller | None]:
    """The tool router's ``idempotency_caller`` for an MCP server: :func:`idempotency_caller` for
    the request ``current_request`` returns, with the server's step and declarations."""

    def caller(own_actor: Any, credentials: Any) -> IdempotencyCaller | None:
        step = server._idempotency
        hook_declared = server.config.context_hook is not None and (
            (step is not None and step.callers_identified_by_hook)
            or server._task_runtime.options.callers_identified_by_hook
        )
        return idempotency_caller(
            step,
            current_request(),
            own_actor,
            credentials,
            hook_declared,
            auth_layer=server._auth_layer is not None,
            default_actor=server.config.actor or Actor(kind="agent"),
        )

    return caller


def router_deps(server: Any, current_request: Callable[[], Any]) -> dict[str, Any]:
    """The tool router's idempotency dependencies for an MCP server: its step and
    :func:`caller_for`."""
    return {
        "idempotency": server._idempotency,
        "idempotency_caller": caller_for(server, current_request),
    }


@contextmanager
def bind_meta_values(
    field_values: Mapping[str, Any] | None, budget_ask: Any, meta: Any
) -> Iterator[None]:
    """Bind what a ``tools/call``'s ``_meta`` (and a meta-tool's ``meta`` argument) carries for
    the call being served: the declared context fields' values, the output-budget ask and the
    idempotency key (K1)."""
    with ExitStack() as stack:
        stack.enter_context(bind_context_field_values(field_values))
        stack.enter_context(bind_output_budget_ask(budget_ask))
        stack.enter_context(bind_request_idempotency_key(meta))
        yield
