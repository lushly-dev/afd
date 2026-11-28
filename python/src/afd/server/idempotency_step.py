"""The engine's idempotency step (``spec/idempotency.md``, S1 to S13): answers a repeat of a call
to a ``keyed`` command from a store, between the approval admission check and the handler
(``spec/dispatch.md``, "The idempotency step"). Mirrors ``packages/server/src/idempotency-step.ts``.

The shared executor (:mod:`afd.core.single_executor`) asks the step at three points: before input
validation, whether it can tell this caller apart (S3); after the declared context fields, the
call's digest (S4); and in the innermost link, under the principal middleware left, what to do
for the call (S5) and, once the handler returns, how to settle (S6).

**Cancellation (S7, ``cancels``).** Python's engine cancels the handler's task at the call's
deadline. The step catches the ``CancelledError`` its ``await`` of the handler raises, settles
the reservation as never settled and raises it again, so a repeat gets ``OUTCOME_UNKNOWN``. The
default store's methods are plain, and the step calls a plain method without awaiting, so the
settlement happens as soon as the cancellation reaches the step, without another turn of the
event loop; a handler that is awaiting another task when it is cancelled may take a few turns to
pass the cancellation on, and a host store whose methods are coroutines is awaited after it. A
repeat that arrives before then is told the call is in progress, which is safe. A ``reserve`` that awaits runs under :func:`asyncio.shield`: if the
call is cancelled while the store reserves, the reservation it made is released when it arrives.

Every engine path awaits its handler on the calling event loop. A host middleware that moves the
rest of the chain to a worker thread takes the step and the handler with it; a deadline does not
stop that thread, so such a host gets the ``drops`` behaviour of S7: the reservation stays live
for its lease, and is never settled after that.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import inspect
import itertools
import logging
import math
import secrets
import weakref
from collections.abc import Awaitable, Callable, Iterator, Mapping, Sequence
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any, Literal

from afd.core.clock import Clock, system_clock
from afd.core.errors import CommandError, Recovery
from afd.core.idempotency import AFD_IDEMPOTENCY_KEY_META_KEY
from afd.core.result import CommandResult, failure
from afd.core.similarity import truncate_name
from afd.server.idempotency_store import (
    IdempotencyRecord,
    IdempotencyReservationRequest,
    IdempotencySettlement,
    IdempotencyStore,
    InMemoryIdempotencyStore,
)

logger = logging.getLogger("afd.server")

DEFAULT_IDEMPOTENCY_TTL_MS = 86_400_000
"""The default time the store remembers a key: one day (S8)."""

DEFAULT_IDEMPOTENCY_LEASE_MS = 60_000
"""The default time a reservation stays live past the call's deadline (S7)."""


@dataclass(frozen=True)
class IdempotencyOptions:
    """The ``idempotency`` option of a server or registry (``spec/idempotency.md``, S1 to S13).

    Attributes:
        store: Where keys and results are kept (S12). Default: an
            :class:`~afd.server.idempotency_store.InMemoryIdempotencyStore`, for this process
            only, which a restart forgets (S13). A host with several processes behind one
            address gives them one shared store or leaves the step off.
        ttl_ms: How long a stored result, or a reservation never settled, answers repeats, from
            the time the key was reserved (S8). Default ``86400000`` (one day). Must be greater
            than the server's default deadline plus ``lease_ms``.
        lease_ms: How long a reservation still unsettled stays live past the call's deadline, or
            past the reservation where the call has none (S7). Default ``60000``. A host whose
            handlers run longer than that without a deadline sets it to cover them.
        callers_identified_by_hook: Security declaration: the server's ``context_hook``
            identifies every HTTP caller with a distinct actor, so the step may act on HTTP calls
            without ``auth`` (S3), as ``TaskOptions``' declaration of the same name does for
            tasks. Counted only when a ``context_hook`` is set.
    """

    store: IdempotencyStore | None = None
    ttl_ms: int = DEFAULT_IDEMPOTENCY_TTL_MS
    lease_ms: int = DEFAULT_IDEMPOTENCY_LEASE_MS
    callers_identified_by_hook: bool = False


@dataclass(frozen=True)
class IdempotencyCaller:
    """Who a lane says the caller is, for S3, set on the call's context by the MCP server.

    ``kind`` is ``http`` (``identified`` when the server can tell its callers apart),
    ``connection`` (stdio: a caller that, as middleware leaves it, has no identity of its own is
    told apart by its connection alone, so its keys are that connection's; ``default_actor`` is
    the server's, which counts as none) or ``unidentified`` (no connection the server can tell
    apart, so an anonymous caller is refused with K2, before confirmation; ``spec/dispatch.md``).
    """

    kind: Literal["http", "connection", "unidentified"]
    identified: bool = False
    connection: Any = None
    default_actor: Any = None


def _anonymous(actor: Any, credentials: Any, default_actor: Any) -> bool:
    """Whether a caller has no identity of its own (S3): no credentials, and no actor, a bare
    agent or the server's default actor, compared as M8 binds an actor (a label names no one)."""
    if credentials is not None:
        return False
    if actor is None:
        return True

    def bound(value: Any) -> tuple[Any, Any, Any]:
        return (
            getattr(value, "kind", None),
            getattr(value, "id", None),
            getattr(value, "on_behalf_of", None),
        )

    kind, actor_id, on_behalf_of = bound(actor)
    if kind == "agent" and actor_id is None and on_behalf_of is None:
        return True
    return default_actor is not None and bound(actor) == bound(default_actor)


@dataclass(frozen=True)
class IdempotencyCall:
    """What the engine prepared for a call the step acts on, before its middleware runs (S4)."""

    command: str
    key: str
    digest: str
    timeout_ms: float | None


@dataclass(frozen=True)
class ScopedIdempotencyCall:
    """A call as the store sees it: its scope (K5), digest and the times its lease counts from."""

    scope: str
    digest: str
    started_at: float
    deadline: float | None


@dataclass(frozen=True)
class PrincipalDecision:
    """Whether the step may act on a call (S3): ``ok`` with the scope's principal part,
    ``refused`` with the error, or ``internal`` (M8's internal error, for credentials it cannot
    bind)."""

    kind: Literal["ok", "refused", "internal"]
    principal: str | None = None
    error: CommandError | None = None


def _duration(value: Any, name: str) -> int:
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or value < 1
        or value > 9_007_199_254_740_991
    ):
        raise ValueError(f"idempotency.{name} must be a positive integer of milliseconds")
    return value


async def _maybe_await(value: Any) -> Any:
    return await value if inspect.isawaitable(value) else value


def _sha256_base64url(text: str) -> str:
    digest = hashlib.sha256(text.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def _is_cancelled(context: Any) -> bool:
    for name in ("cancel", "signal"):
        event = getattr(context, name, None)
        if event is not None and event.is_set():
            return True
    return False


_REPLAY_KEYS = ("idempotentReplay", "idempotent_replay")


def without_replay_marker(result: CommandResult[Any]) -> CommandResult[Any]:
    """``result`` without a handler-supplied ``metadata.idempotentReplay``, which is the
    engine's (S9)."""
    metadata = result.metadata
    extra = metadata.__pydantic_extra__ if metadata is not None else None
    if metadata is None or not extra or not any(key in extra for key in _REPLAY_KEYS):
        return result
    copied = metadata.model_copy()
    copied.__pydantic_extra__ = {k: v for k, v in extra.items() if k not in _REPLAY_KEYS}
    return result.model_copy(update={"metadata": copied})


def with_replay_marker(result: CommandResult[Any]) -> CommandResult[Any]:
    """``result`` with ``metadata.idempotentReplay: true`` (S9)."""
    from afd.core.result import ResultMetadata

    metadata = result.metadata if result.metadata is not None else ResultMetadata()
    copied = metadata.model_copy()
    copied.__pydantic_extra__ = {**(metadata.__pydantic_extra__ or {}), "idempotentReplay": True}
    return result.model_copy(update={"metadata": copied})


def key_reused_error() -> CommandError:
    """``IDEMPOTENCY_KEY_REUSED`` (S5)."""
    return CommandError(
        code="IDEMPOTENCY_KEY_REUSED",
        message="This idempotency key is already held for a call with another input",
        suggestion=(
            "Use a new idempotency key for a different call. Reuse a key only to repeat the "
            "same call with the same input."
        ),
        retryable=False,
        recovery=Recovery(kind="stop"),
        details={"meta": AFD_IDEMPOTENCY_KEY_META_KEY},
    )


def in_progress_error() -> CommandError:
    """``IDEMPOTENCY_IN_PROGRESS`` (S5)."""
    return CommandError(
        code="IDEMPOTENCY_IN_PROGRESS",
        message="An earlier call with this idempotency key and input is still running",
        suggestion=(
            "Repeat the call shortly with the same idempotency key: it then gets the earlier "
            "call’s result."
        ),
        retryable=True,
        recovery=Recovery(kind="retry", after_ms=1000),
        details={"meta": AFD_IDEMPOTENCY_KEY_META_KEY},
    )


def outcome_unknown_error() -> CommandError:
    """``OUTCOME_UNKNOWN`` from the step (S6, S7)."""
    return CommandError(
        code="OUTCOME_UNKNOWN",
        message=(
            "An earlier call with this idempotency key and input started, and nobody can say "
            "whether it was applied"
        ),
        suggestion=(
            "Check whether the change was made. If the call is still wanted, send it with a new "
            "idempotency key."
        ),
        retryable=False,
        recovery=Recovery(kind="external"),
        details={"meta": AFD_IDEMPOTENCY_KEY_META_KEY},
    )


def unidentified_callers_error() -> CommandError:
    """S3's refusal of a caller the server cannot tell apart."""
    return CommandError(
        code="UNAUTHORIZED",
        message=(
            "This server cannot tell its callers apart, so it does not answer repeats from its "
            "idempotency store"
        ),
        suggestion=(
            "Nothing ran. Call again without the idempotency key, or the server's operator "
            "configures authorization, or declares that the server's context hook identifies "
            "every caller (IdempotencyOptions.callers_identified_by_hook)."
        ),
        retryable=False,
    )


def internal_principal_error() -> CommandError:
    """M8's internal error, whose message names no one (S3)."""
    return CommandError(
        code="INTERNAL_ERROR",
        message="Internal error",
        suggestion="Nothing ran. Tell the server’s operator; calling again will not help.",
        retryable=False,
    )


def input_not_canonical_error(command_name: str) -> CommandError:
    """``VALIDATION_ERROR`` for an input with no canonical form, which a key cannot cover (S4)."""
    return CommandError(
        code="VALIDATION_ERROR",
        message=(
            f"The input of '{truncate_name(command_name)}' has no canonical JSON form, so an "
            "idempotency key cannot cover it"
        ),
        suggestion=(
            "Send plain JSON input (no set, bytes, class instance or non-finite number), or call "
            "without an idempotency key."
        ),
        retryable=False,
        details={"meta": AFD_IDEMPOTENCY_KEY_META_KEY, "reason": "input-not-canonical"},
    )


def _cancelled_before_start(name: str) -> CommandError:
    return CommandError(
        code="COMMAND_CANCELLED",
        message=f"Command '{truncate_name(name)}' was cancelled before it started",
        suggestion="Retry with a fresh signal if the command is still needed.",
        retryable=False,
    )


def _answer_for(record: IdempotencyRecord, digest: str, now: float) -> CommandResult[Any]:
    """The answer for a call whose scope ``record`` holds (S5)."""
    if record.digest != digest:
        return failure(key_reused_error())
    if record.state == "stored" and record.result is not None:
        return with_replay_marker(record.result)
    if record.state == "reserved" and now <= record.lease_ends_at:
        return failure(in_progress_error())
    return failure(outcome_unknown_error())


CredentialsOf = Callable[[Any], Any]


class IdempotencyStep:
    """The step, built once per server or registry and shared by its calls.

    Build it with :func:`create_idempotency_step`; a server builds its own from its
    ``idempotency`` option.
    """

    def __init__(
        self,
        options: IdempotencyOptions,
        *,
        clock: Clock,
        default_timeout_ms: float | None,
        context_field_names: Sequence[str] = (),
        credentials_of: CredentialsOf | None = None,
    ) -> None:
        if not isinstance(options, IdempotencyOptions):
            raise TypeError("idempotency must be an IdempotencyOptions")
        ttl_ms = _duration(options.ttl_ms, "ttl_ms")
        lease_ms = _duration(options.lease_ms, "lease_ms")
        deadline = default_timeout_ms or 0
        if ttl_ms <= deadline + lease_ms:
            raise ValueError(
                f"idempotency.ttl_ms ({ttl_ms}) must be greater than the default deadline "
                f"({deadline:g}) plus lease_ms ({lease_ms}), or a key could become new while its "
                "first call still runs"
            )
        store = options.store if options.store is not None else InMemoryIdempotencyStore()
        for method in ("reserve", "complete", "release", "get"):
            if not callable(getattr(store, method, None)):
                raise TypeError(f"idempotency.store must have a {method} method")
        if not isinstance(options.callers_identified_by_hook, bool):
            raise TypeError("idempotency.callers_identified_by_hook must be a boolean")
        self.options = options
        self.store: IdempotencyStore = store
        self.ttl_ms = ttl_ms
        self.lease_ms = lease_ms
        self.clock = clock
        self.default_timeout_ms = default_timeout_ms
        self.context_field_names = tuple(context_field_names)
        self._credentials_of = credentials_of or (
            lambda context: getattr(context, "credentials", None)
        )
        self._connections: weakref.WeakKeyDictionary[Any, str] = weakref.WeakKeyDictionary()
        self._connection_ids: dict[int, str] = {}
        self._connection_count = itertools.count(1)

    @property
    def callers_identified_by_hook(self) -> bool:
        """The option of the same name."""
        return self.options.callers_identified_by_hook

    def _connection_id(self, connection: Any) -> str:
        try:
            found = self._connections.get(connection)
        except TypeError:
            found = self._connection_ids.get(id(connection))
        if found is not None:
            return found
        made = f"{next(self._connection_count)}-{secrets.token_hex(8)}"
        try:
            self._connections[connection] = made
        except TypeError:
            self._connection_ids[id(connection)] = made
        return made

    def principal(self, context: Any) -> PrincipalDecision:
        """Whether the step may act on a call from the caller of ``context`` (S3)."""
        from afd.server.approval import _canonical_json
        from afd.server.principal import IncompleteCredentials, principal_binding

        caller = getattr(context, "_idempotency_caller", None)
        if isinstance(caller, IdempotencyCaller):
            if caller.kind == "http" and not caller.identified:
                return PrincipalDecision("refused", error=unidentified_callers_error())
            anonymous = caller.kind != "http" and _anonymous(
                getattr(context, "actor", None),
                self._credentials_of(context),
                caller.default_actor,
            )
            if caller.kind == "unidentified" and anonymous:
                return PrincipalDecision("refused", error=unidentified_callers_error())
            if caller.kind == "connection" and anonymous:
                return PrincipalDecision(
                    "ok",
                    principal=_canonical_json(
                        {"connection": self._connection_id(caller.connection)}
                    ),
                )
        try:
            return PrincipalDecision(
                "ok",
                principal=principal_binding(
                    getattr(context, "actor", None), self._credentials_of(context)
                ),
            )
        except (IncompleteCredentials, TypeError):
            return PrincipalDecision("internal")

    @staticmethod
    def scope(principal: str, command: str, key: str) -> str:
        """The scope of ``principal``, ``command`` and ``key`` (K5)."""
        from afd.server.approval import _canonical_json

        return _canonical_json({"command": command, "key": key, "principal": principal})

    @staticmethod
    def digest(fields: dict[str, Any], input: Any) -> str | None:
        """The digest of the call (S4): of its declared context fields and validated input, or
        ``None`` when either has no canonical form."""
        from afd.server.approval import _canonical_json, _plain_input

        try:
            canonical = _canonical_json(
                {
                    "context": {name: _plain_input(value) for name, value in fields.items()},
                    "input": _plain_input(input),
                }
            )
        except (TypeError, ValueError, RecursionError):
            return None
        return _sha256_base64url(canonical)

    def prepare(
        self, *, command: str, key: str, input: Any, context: Any, timeout_ms: float | None
    ) -> IdempotencyCall | CommandError:
        """The call the step acts on (S4), before middleware runs, or its refusal for an input
        with no canonical form. ``timeout_ms`` is the call's deadline as the engine enforces
        it."""
        extra = getattr(context, "extra", None)
        values = extra if isinstance(extra, dict) else {}
        fields = {
            name: values[name] for name in self.context_field_names if values.get(name) is not None
        }
        digest = self.digest(fields, input)
        if digest is None:
            return input_not_canonical_error(command)
        effective = (
            timeout_ms
            if isinstance(timeout_ms, (int, float))
            and not isinstance(timeout_ms, bool)
            and math.isfinite(timeout_ms)
            and timeout_ms > 0
            else None
        )
        return IdempotencyCall(command=command, key=key, digest=digest, timeout_ms=effective)

    async def _reserve(self, call: ScopedIdempotencyCall, now: float) -> Any:
        request = IdempotencyReservationRequest(
            digest=call.digest,
            reserved_at=now,
            expires_at=now + self.ttl_ms,
            lease_ends_at=(call.deadline if call.deadline is not None else now) + self.lease_ms,
        )
        made = self.store.reserve(call.scope, request, now)
        if not inspect.isawaitable(made):
            return made
        pending = asyncio.ensure_future(made)
        try:
            return await asyncio.shield(pending)
        except asyncio.CancelledError:
            # Cancelled while the store reserves: release what it reserved once it says (S5).
            def release_made(done: asyncio.Future[Any]) -> None:
                if done.cancelled() or done.exception() is not None:
                    return
                outcome = done.result()
                if getattr(outcome, "reserved", False) and outcome.reservation is not None:
                    released = self.store.release(call.scope, outcome.reservation)
                    if inspect.isawaitable(released):
                        task = asyncio.ensure_future(released)
                        task.add_done_callback(lambda t: t.cancelled() or t.exception())

            pending.add_done_callback(release_made)
            raise

    def _settle_threw(self, call: ScopedIdempotencyCall, reservation: str) -> Awaitable[Any] | None:
        settled = self.store.complete(call.scope, reservation, IdempotencySettlement("unknown"))
        return settled if inspect.isawaitable(settled) else None

    async def _settle(
        self, call: ScopedIdempotencyCall, reservation: str, result: CommandResult[Any]
    ) -> None:
        error = result.error if not result.success else None
        if error is not None and error.code == "TIMEOUT":
            # "May still have run" (spec/error-codes.md): nobody can say.
            await _maybe_await(
                self.store.complete(call.scope, reservation, IdempotencySettlement("unknown"))
            )
        elif error is not None and error.retryable is True:
            # A keyed command that returns a retryable failure promises nothing was applied.
            await _maybe_await(self.store.release(call.scope, reservation))
        else:
            await _maybe_await(
                self.store.complete(
                    call.scope, reservation, IdempotencySettlement("result", result)
                )
            )

    async def run(
        self,
        prepared: IdempotencyCall | None,
        *,
        context: Any,
        command_name: str,
        started_at: float,
        handler: Callable[[], Awaitable[CommandResult[Any]]],
        on_reserved: Callable[[], None],
    ) -> CommandResult[Any]:
        """Run the innermost link (S1, S5, S6) for ``prepared``: answer from the store, or reserve
        its key, check cancellation again, run ``handler`` and settle. The scope is bound here,
        to the principal the context holds after middleware ran (an auth middleware may set the
        actor), and the lease counts from ``started_at``, when the engine started the call's
        chain and its deadline. Without ``prepared`` (the step does not act), run ``handler``.
        Either way a handler's own ``idempotentReplay`` is removed (S9)."""
        if prepared is None:
            return without_replay_marker(await handler())
        decided = self.principal(context)
        if decided.kind == "refused":
            assert decided.error is not None
            return failure(decided.error)
        if decided.kind == "internal" or decided.principal is None:
            return failure(internal_principal_error())
        call = ScopedIdempotencyCall(
            scope=self.scope(decided.principal, prepared.command, prepared.key),
            digest=prepared.digest,
            started_at=started_at,
            deadline=None if prepared.timeout_ms is None else started_at + prepared.timeout_ms,
        )
        now = self.clock.now()
        outcome = await self._reserve(call, now)
        if not outcome.reserved:
            if outcome.record is None:
                raise TypeError("IdempotencyStore.reserve reported a held key without its record")
            return _answer_for(outcome.record, call.digest, now)
        if outcome.reservation is None:
            raise TypeError("IdempotencyStore.reserve reserved a key without an identity")
        reservation: str = outcome.reservation
        on_reserved()
        # The cancellation check again, now the key is held (S5): nothing ran, so nothing is kept.
        if _is_cancelled(context):
            await _maybe_await(self.store.release(call.scope, reservation))
            return failure(_cancelled_before_start(command_name))
        try:
            result = without_replay_marker(await handler())
        except BaseException:
            # A handler that raised, or was cancelled at the deadline (S7, `cancels`): never
            # settled, at once. A plain store settles here, before the engine answers TIMEOUT.
            try:
                pending = self._settle_threw(call, reservation)
                if pending is not None:
                    await pending
            except Exception as store_error:
                logger.error("The idempotency store failed to settle a call", exc_info=store_error)
            raise
        try:
            await self._settle(call, reservation, result)
        except Exception as store_error:
            # The handler's result stands: a store that failed to keep it leaves the reservation
            # to its lease (S7), after which a repeat is told the outcome is unknown.
            logger.error("The idempotency store failed to settle a call", exc_info=store_error)
        return result


# The raw key in the `_meta` (or meta argument) of the MCP `tools/call` being served, bound by the
# server around the call and taken by the tool router onto the call's context (K1).
_REQUEST_KEY: ContextVar[tuple[Any] | None] = ContextVar("afd_idempotency_key", default=None)


@contextmanager
def bind_request_idempotency_key(meta: Any) -> Iterator[None]:
    """Bind ``meta["dev.afd/idempotencyKey"]`` as the key of the MCP call being served. ``None``
    is no key (K2); any other value is kept as sent, for the engine to check."""
    raw = meta.get(AFD_IDEMPOTENCY_KEY_META_KEY) if isinstance(meta, Mapping) else None
    token = _REQUEST_KEY.set((raw,) if raw is not None else None)
    try:
        yield
    finally:
        _REQUEST_KEY.reset(token)


def peek_request_idempotency_key() -> Any:
    """The key bound for the MCP call being served, or ``None``."""
    bound = _REQUEST_KEY.get()
    return bound[0] if bound else None


def create_idempotency_step(
    options: IdempotencyOptions | None = None,
    *,
    clock: Clock | None = None,
    default_timeout_ms: float | None = None,
    context_field_names: Sequence[str] = (),
    credentials_of: CredentialsOf | None = None,
) -> IdempotencyStep:
    """Build the idempotency step (``spec/idempotency.md``, S1 to S13).

    The MCP server builds its own from its ``idempotency`` option. A registry made with
    ``create_command_registry`` or ``create_direct_registry`` takes one built here::

        registry = create_direct_registry(
            commands, idempotency=create_idempotency_step(IdempotencyOptions(), clock=clock)
        )

    Args:
        options: The store, ``ttl_ms`` and ``lease_ms``.
        clock: The step's clock: the server's or registry's own, never one a caller supplies
            (S8). Default ``system_clock``.
        default_timeout_ms: The deadline a call without its own ``timeout`` gets, which S8
            checks ``ttl_ms`` against. Default ``None``: none.
        context_field_names: The names of the declared context fields, which the digest covers
            (S4).
        credentials_of: The credentials a call's principal binding takes. Default:
            ``context.credentials``.

    Raises:
        ValueError: For a configuration S8 refuses, or a duration that is not a positive
            integer.
        TypeError: For a store without the four methods.
    """
    return IdempotencyStep(
        options if options is not None else IdempotencyOptions(),
        clock=clock if clock is not None else system_clock,
        default_timeout_ms=default_timeout_ms,
        context_field_names=context_field_names,
        credentials_of=credentials_of,
    )


__all__ = [
    "DEFAULT_IDEMPOTENCY_LEASE_MS",
    "bind_request_idempotency_key",
    "peek_request_idempotency_key",
    "DEFAULT_IDEMPOTENCY_TTL_MS",
    "IdempotencyCall",
    "IdempotencyCaller",
    "IdempotencyOptions",
    "IdempotencyStep",
    "PrincipalDecision",
    "ScopedIdempotencyCall",
    "create_idempotency_step",
    "in_progress_error",
    "input_not_canonical_error",
    "internal_principal_error",
    "key_reused_error",
    "outcome_unknown_error",
    "unidentified_callers_error",
    "with_replay_marker",
    "without_replay_marker",
]
