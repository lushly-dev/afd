"""Per-request context hook for AFD MCP servers (``#800``).

Turns what the transport knows about an inbound MCP ``tools/call`` (the SDK
``ServerRequestContext`` and, over HTTP, the Starlette ``Request``) into the
:class:`~afd.core.commands.CommandContext` that commands run with.

Install with ``create_server(..., context_hook=hook)``. The hook runs once per
``tools/call`` before the request-state boundary, before the confirmation gate
and before command lookup, on every route (individual, grouped, hybrid,
``afd-call``, ``afd-batch``, ``afd-pipe``, ``afd-discover``, ``afd-detail``,
unknown and unexposed names).

Security rules
--------------

The hook is **trust-bearing**: whatever it puts on the context (above all
``actor``) is believed by every command, middleware, confirmation state and
journal downstream.

- **Verify, then trust.** A header such as ``X-Actor`` is attacker-controlled
  unless a layer in front of the server verified the request. Read identity only
  from values your own transport layer set after authenticating (for example,
  ``request.http_request.state`` populated by ASGI auth middleware), never from
  ``_meta``, tool arguments or an unverified header a caller can send.
- **Fail closed.** Return a :class:`~afd.core.errors.CommandError` (or a failed
  :class:`~afd.core.result.CommandResult`) when a call cannot be attributed.
  Nothing runs: not the command, not a confirmation prompt, not request-state
  unsealing, and an unknown or unexposed tool answers identically to a real one
  so a refused caller learns nothing about which tools or contexts exist.
- **Refusals are redacted.** Only ``code``, ``message``, ``suggestion``,
  ``retryable`` and ``recovery`` reach the client; ``details`` and ``cause`` are dropped. Do not
  put credential rejection reasons, usernames or policy names in ``message``; log
  them on the server and return a generic refusal (``UNAUTHORIZED`` or
  ``FORBIDDEN``).
- **Exceptions and invalid returns fail closed.** An exception raised by the
  hook (other than ``BaseException`` such as ``asyncio.CancelledError``), or a
  return value other than :class:`~afd.core.commands.CommandContext`,
  :class:`~afd.core.errors.CommandError` or a failed
  :class:`~afd.core.result.CommandResult`, refuses the request with a generic
  ``INTERNAL_ERROR``; the exception text is logged and never sent, even when
  ``dev_mode=True``.
- **Server invariants hold.** After the hook returns a ``CommandContext``, the
  server enforces ``extra["interface"] = "mcp"``, ``extra["remote"] = True``
  (so ``expose.mcp`` and D4 hiding always hold), the request's active context
  (``extra["active_context"]``), a non-empty ``trace_id``, and valid ``actor``,
  ``clock`` and ``random`` defaults. DirectClient-only internal tokens
  (``_direct_approval``, ``_direct_allow``) are cleared.
- **Declared context fields: trusted code wins.** The hook runs without
  caller-sent ``_meta`` context fields in ``context.extra``, so it never
  mistakes a caller's claim for verified data. Afterwards, declared fields from
  ``_meta`` are merged with any key set by the hook taking precedence
  (``spec/context-fields.md``, "Trusted code wins"), including an explicit
  ``None`` set by the hook to overrule a caller claim.
- **Principal binding.** The hook's resolved ``actor`` at call start is
  snapshotted and bound in confirmation and approval-relay ``requestState``
  alongside any SDK-verified access token (``spec/authorization.md``, M8), so
  callers separated by the hook cannot replay each other's states and later
  in-place actor mutations do not change the binding.

The hook also runs on ``tasks/get``, ``tasks/update`` and ``tasks/cancel``
(with :attr:`ContextHookRequest.tool` set to the MCP method name) before task
owner lookup. It does not run on ``tools/list``, ``server/discover``,
``initialize`` or in-process ``server.execute()``. On MCP 2026-07-28 Streamable
HTTP, the SDK also
validates ``x-mcp-header`` tool schemas before middleware runs (standard AFD
commands do not declare ``x-mcp-header``). To reject requests before any SDK
handling (such as missing bearer tokens on ``tools/list`` or header checks),
install ASGI middleware in front of ``server.streamable_http_app()``.

Transports
----------

Over Streamable HTTP and SSE, :attr:`ContextHookRequest.http_request` is the
Starlette ``Request`` carrying headers, URL and ASGI ``state``. Over stdio or an
in-process ``Client(mcp)`` connection, it is ``None``.
"""

from __future__ import annotations

import copy
import inspect
import logging
from collections.abc import Awaitable, Callable, Iterator, Mapping
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any

from afd.core.actor import Actor, ContextDefaults, is_actor, with_context_defaults
from afd.core.commands import CommandContext
from afd.core.errors import CommandError, ErrorCodes
from afd.core.output_budget import normalize_ask_option
from afd.core.result import CommandResult
from afd.server.auth import credentials_actor
from afd.server.auth_rules import (
    Credentials,
    _clone_verified_credentials,
    _copy_credentials,
    _unbrand_verified_credentials,
)
from afd.server.context_fields import JOURNALED_CONTEXT_FIELDS

logger = logging.getLogger("afd.server")

_DEFAULT_MCP_ACTOR = Actor(kind="agent")


@dataclass(frozen=True)
class ContextHookRequest:
    """What a per-request context hook is told about an MCP ``tools/call``.

    Attributes:
        tool: The ``name`` of the tool being called, as sent by the client. It
            may name a tool that does not exist or is not exposed to MCP: the
            hook runs first on purpose.
        request_context: The MCP SDK's ``ServerRequestContext`` (``session``,
            ``protocol_version``, ``request``, ``meta``, ``params``, etc.), or
            ``None`` when invoked outside an SDK request.
    """

    tool: str
    request_context: Any

    @property
    def http_request(self) -> Any:
        """The transport's HTTP request (a Starlette ``Request`` over Streamable
        HTTP or SSE), or ``None`` over stdio or an in-process connection."""
        return getattr(self.request_context, "request", None)

    def header(self, name: str) -> str | None:
        """A request header as text, case-insensitive, or ``None`` over stdio,
        when absent, or when the HTTP request carries no headers mapping."""
        req = self.http_request
        headers = getattr(req, "headers", None)
        if not isinstance(headers, Mapping):
            return None
        value = headers.get(name)
        if isinstance(value, str):
            return value
        lower = name.lower()
        for key, candidate in headers.items():
            if isinstance(key, str) and key.lower() == lower and isinstance(candidate, str):
                return candidate
        return None


ContextHookResult = CommandContext | CommandError | CommandResult[Any]
ContextHook = Callable[
    [ContextHookRequest, CommandContext],
    ContextHookResult | Awaitable[ContextHookResult],
]
"""Per-request hook: ``(request, context) -> CommandContext | CommandError`` (sync or async)."""


@dataclass(frozen=True)
class HookOutcome:
    """The normalized result of running the server's context hook for one ``tools/call``."""

    context: CommandContext | None = None
    actor_at_start: Actor | None = None
    refusal: CommandError | None = None


_REQUEST_HOOK_OUTCOME: ContextVar[HookOutcome | None] = ContextVar(
    "afd_context_hook_outcome", default=None
)


@contextmanager
def bind_hook_outcome(outcome: HookOutcome | None) -> Iterator[None]:
    """Bind ``outcome`` for the duration of one MCP ``tools/call``."""
    token = _REQUEST_HOOK_OUTCOME.set(outcome)
    try:
        yield
    finally:
        _REQUEST_HOOK_OUTCOME.reset(token)


def current_hook_outcome() -> HookOutcome | None:
    """The hook outcome bound for the MCP ``tools/call`` being served, or ``None``."""
    return _REQUEST_HOOK_OUTCOME.get()


def trace_prefix_for_tool(tool_name: str) -> str:
    """Trace ID prefix matching ``tool_router.py`` for ``tool_name``."""
    if tool_name == "afd-call":
        return "afd-call"
    if tool_name == "afd-batch":
        return "batch"
    if tool_name == "afd-pipe":
        return "pipeline"
    return "trace"


def visible_hook_error(err: CommandError) -> CommandError:
    """A hook refusal as the caller sees it: ``details`` and ``cause`` are dropped, and the
    ``recovery`` kept, since a refused caller needs it (a sign-in, for one)."""
    return CommandError(
        code=err.code,
        message=err.message,
        suggestion=err.suggestion,
        retryable=err.retryable,
        recovery=err.recovery,
    )


def _internal_hook_error() -> CommandError:
    return CommandError(
        code=ErrorCodes.INTERNAL_ERROR,
        message="An internal error occurred",
        suggestion="Retry the request or contact the server operator.",
        retryable=True,
    )


def copy_extra(extra: Mapping[str, Any]) -> dict[str, Any]:
    """Copy ``extra`` and any nested plain ``dict``/``list`` values (depth-capped),
    keeping non-container host objects (clients, sessions) by reference so sibling
    batch items, pipeline steps and retry rounds cannot mutate each other's claim
    containers."""
    return {key: _copy_extra_value(value, 0) for key, value in extra.items()}


def _copy_extra_value(value: Any, depth: int) -> Any:
    if depth >= 16:
        return value
    if type(value) is dict:
        return {k: _copy_extra_value(v, depth + 1) for k, v in value.items()}
    if type(value) is list:
        return [_copy_extra_value(item, depth + 1) for item in value]
    return value


async def run_context_hook(
    hook: ContextHook,
    tool: str,
    request_context: Any,
    defaults: ContextDefaults,
    trace_id: str,
    *,
    credentials: Credentials | None = None,
) -> HookOutcome:
    """Invoke ``hook`` once and normalize its answer, failing closed on error."""
    default_actor = (
        credentials_actor(credentials)
        if credentials is not None
        else (defaults.actor if defaults.actor is not None else _DEFAULT_MCP_ACTOR)
    )
    effective_defaults = ContextDefaults(
        clock=defaults.clock,
        random=defaults.random,
        actor=default_actor,
    )
    # Give the hook the server's defaults (and an isolated copy of verified credentials when
    # auth is on, never _meta context fields), so it can map credentials to the actor without
    # being able to mutate the authoritative credentials object in place (e.g. via
    # object.__setattr__).
    hook_credentials: Credentials | None = None
    unbrand_hook_credentials = False
    if credentials is not None:
        cloned = _clone_verified_credentials(credentials)
        if cloned is not None:
            hook_credentials = cloned
            unbrand_hook_credentials = True
        else:
            hook_credentials = _copy_credentials(credentials)
    base = with_context_defaults(
        CommandContext(trace_id=trace_id, extra={}, credentials=hook_credentials),
        effective_defaults,
    )
    hook_request = ContextHookRequest(tool=tool, request_context=request_context)
    try:
        raw = hook(hook_request, base)
        if inspect.isawaitable(raw):
            raw = await raw

        if isinstance(raw, CommandError):
            return HookOutcome(refusal=visible_hook_error(raw))

        if isinstance(raw, CommandResult):
            if not raw.success and raw.error is not None:
                return HookOutcome(refusal=visible_hook_error(raw.error))
            logger.error("Context hook returned a CommandResult without an error; failing closed")
            return HookOutcome(refusal=_internal_hook_error())

        if not isinstance(raw, CommandContext):
            logger.error(
                "Context hook returned %s instead of CommandContext or CommandError; failing closed",
                type(raw).__name__,
            )
            return HookOutcome(refusal=_internal_hook_error())

        if raw.actor is not None and not is_actor(raw.actor):
            logger.error(
                "Context hook returned an invalid actor (%s); failing closed",
                type(raw.actor).__name__,
            )
            return HookOutcome(refusal=_internal_hook_error())

        if raw.trace_id is not None and not isinstance(raw.trace_id, str):
            logger.error("Context hook returned a non-string trace_id; failing closed")
            return HookOutcome(refusal=_internal_hook_error())

        if raw.clock is not None and not callable(getattr(raw.clock, "now", None)):
            logger.error(
                "Context hook returned an invalid clock (%s); failing closed",
                type(raw.clock).__name__,
            )
            return HookOutcome(refusal=_internal_hook_error())

        if raw.random is not None and not callable(getattr(raw.random, "next", None)):
            logger.error(
                "Context hook returned an invalid random source (%s); failing closed",
                type(raw.random).__name__,
            )
            return HookOutcome(refusal=_internal_hook_error())

        if raw.extra is None:
            extra: dict[str, Any] = {}
        elif isinstance(raw.extra, Mapping):
            extra = copy_extra(
                {key: value for key, value in raw.extra.items() if key != JOURNALED_CONTEXT_FIELDS}
            )
        else:
            logger.error(
                "Context hook returned non-mapping extra (%s); failing closed",
                type(raw.extra).__name__,
            )
            return HookOutcome(refusal=_internal_hook_error())

        # Copy into a fresh CommandContext so DirectClient-only internal tokens
        # (_direct_approval, _direct_allow) cannot be carried or forged, later
        # mutations to the returned object cannot alter the bound context, and the
        # server's verified credentials (M4) cannot be changed or forged by the hook.
        hook_budget_ask = (
            raw._output_budget_ask
            if raw._output_budget_ask is not None
            else (
                normalize_ask_option(raw.output_budget) if raw.output_budget is not None else None
            )
        )
        clean = CommandContext(
            trace_id=raw.trace_id if raw.trace_id else trace_id,
            timeout=raw.timeout,
            extra=extra,
            actor=copy.copy(raw.actor) if raw.actor is not None else None,
            clock=raw.clock,
            random=raw.random,
            approval=raw.approval,
            credentials=credentials,
            _output_budget_ask=hook_budget_ask,
        )
        normalized = with_context_defaults(clean, effective_defaults)
        actor_at_start = copy.copy(normalized.actor)
        return HookOutcome(context=normalized, actor_at_start=actor_at_start)
    except Exception as exc:
        logger.error("Context hook raised an unhandled exception", exc_info=exc)
        return HookOutcome(refusal=_internal_hook_error())
    finally:
        if unbrand_hook_credentials and hook_credentials is not None:
            _unbrand_verified_credentials(hook_credentials)


__all__ = [
    "ContextHook",
    "ContextHookRequest",
    "ContextHookResult",
    "HookOutcome",
    "bind_hook_outcome",
    "copy_extra",
    "current_hook_outcome",
    "run_context_hook",
    "trace_prefix_for_tool",
    "visible_hook_error",
]
