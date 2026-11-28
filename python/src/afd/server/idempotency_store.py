"""The idempotency step's store (``spec/idempotency.md``, S12): the interface a host may supply,
and the default, which keeps everything in memory for this process only.

Mirrors ``packages/server/src/idempotency-store.ts``. A host store's methods may be plain or
``async``; the step awaits what they return when it is awaitable.
"""

from __future__ import annotations

import itertools
import secrets
from collections.abc import Awaitable
from dataclasses import dataclass, replace
from typing import Any, Literal, Protocol, runtime_checkable

from afd.core.result import CommandResult

IdempotencyState = Literal["reserved", "stored", "unknown"]


@dataclass(frozen=True)
class IdempotencyRecord:
    """What the store holds for one scope (K5: the caller's principal binding, the command and
    the key).

    Attributes:
        reservation: The identity of the reservation this record was made for (S5, S12).
        digest: The call's digest (S4).
        reserved_at: When the key was reserved, on the server's clock (ms).
        expires_at: When the record stops answering repeats: ``reserved_at + ttl_ms`` (S8).
            Inclusive.
        lease_ends_at: When a reservation still unsettled stops being live and is treated as
            never settled: the call's deadline plus ``lease_ms``, or ``reserved_at + lease_ms``
            for a call without one (S7). Inclusive.
        state: ``reserved`` while the handler runs; ``stored`` once its result is kept;
            ``unknown`` once nobody can say whether it was applied (S6).
        result: The handler's result, when ``state`` is ``stored``.
    """

    reservation: str
    digest: str
    reserved_at: float
    expires_at: float
    lease_ends_at: float
    state: IdempotencyState
    result: CommandResult[Any] | None = None


@dataclass(frozen=True)
class IdempotencyReservationRequest:
    """A reservation to make: the record's times and digest, without its identity or state."""

    digest: str
    reserved_at: float
    expires_at: float
    lease_ends_at: float


@dataclass(frozen=True)
class IdempotencyReserveOutcome:
    """What ``reserve`` did: reserved the key (``reservation``), or found it held (``record``)."""

    reserved: bool
    reservation: str | None = None
    record: IdempotencyRecord | None = None


@dataclass(frozen=True)
class IdempotencySettlement:
    """How a reservation is settled: with the ``result`` to keep, or as never settled (S6)."""

    kind: Literal["result", "unknown"]
    result: CommandResult[Any] | None = None


@runtime_checkable
class IdempotencyStore(Protocol):
    """The store of the idempotency step (S12). Each method is atomic for its scope. A store
    shared by several processes gives the step's promise across them (S13); the default does
    not. Each method may return its value or an awaitable of it."""

    def reserve(
        self, scope: str, request: IdempotencyReservationRequest, now: float
    ) -> IdempotencyReserveOutcome | Awaitable[IdempotencyReserveOutcome]:
        """Reserve the key of ``scope`` for ``request``, unless a record that has not expired at
        ``now`` holds it: then report that record, changing nothing. Of two calls for one scope
        that find nothing, exactly one reserves. The new reservation's identity is unique."""
        ...

    def complete(
        self, scope: str, reservation: str, settlement: IdempotencySettlement
    ) -> None | Awaitable[None]:
        """Settle ``reservation`` as ``settlement`` says. Does nothing when the scope no longer
        holds that reservation (it was released, or the key was reserved again)."""
        ...

    def release(self, scope: str, reservation: str) -> None | Awaitable[None]:
        """Remove ``reservation``, so a repeat runs. Does nothing when the scope no longer holds
        that reservation."""
        ...

    def get(
        self, scope: str, now: float
    ) -> IdempotencyRecord | None | Awaitable[IdempotencyRecord | None]:
        """The record of ``scope`` that has not expired at ``now``, if any."""
        ...


_COUNTER = itertools.count(1)


def _next_reservation() -> str:
    """A reservation identity unique in this process."""
    return f"{next(_COUNTER)}-{secrets.token_hex(8)}"


def _kept(result: CommandResult[Any]) -> CommandResult[Any]:
    """A copy of ``result`` a caller cannot change through the one it holds."""
    try:
        return result.model_copy(deep=True)
    except Exception:
        return result


class InMemoryIdempotencyStore:
    """The default store: in memory, for this process only. A restart forgets every key, and a
    repeat that reaches another process finds nothing there (S13). A host that needs the promise
    across restarts or processes supplies a store that gives it.

    Its methods are plain, not ``async``: the step settles a reservation in the same step of the
    event loop as the handler's return or cancellation (S7, ``cancels``).

    Args:
        sweep_at: Scopes held before expired records are swept on the next reservation (default
            10,000). A sweep removes only expired records, so the store can hold more live ones
            than this; the next sweep then waits until it holds twice as many as the last one
            left.
    """

    def __init__(self, *, sweep_at: int = 10_000) -> None:
        if isinstance(sweep_at, bool) or not isinstance(sweep_at, int) or sweep_at < 1:
            raise ValueError("sweep_at must be a positive integer")
        self._records: dict[str, IdempotencyRecord] = {}
        self._sweep_at = sweep_at
        self._next_sweep_at = sweep_at

    @property
    def size(self) -> int:
        """How many scopes the store holds, expired ones included until a sweep."""
        return len(self._records)

    def reserve(
        self, scope: str, request: IdempotencyReservationRequest, now: float
    ) -> IdempotencyReserveOutcome:
        held = self.get(scope, now)
        if held is not None:
            return IdempotencyReserveOutcome(reserved=False, record=held)
        if len(self._records) >= self._next_sweep_at:
            self._sweep(now)
            # Amortized: a store full of live keys does not scan them on every reservation.
            self._next_sweep_at = max(self._sweep_at, 2 * len(self._records))
        reservation = _next_reservation()
        self._records[scope] = IdempotencyRecord(
            reservation=reservation,
            digest=request.digest,
            reserved_at=request.reserved_at,
            expires_at=request.expires_at,
            lease_ends_at=request.lease_ends_at,
            state="reserved",
        )
        return IdempotencyReserveOutcome(reserved=True, reservation=reservation)

    def complete(self, scope: str, reservation: str, settlement: IdempotencySettlement) -> None:
        record = self._records.get(scope)
        if record is None or record.reservation != reservation:
            return
        if settlement.kind == "result" and settlement.result is not None:
            self._records[scope] = replace(record, state="stored", result=_kept(settlement.result))
        else:
            self._records[scope] = replace(record, state="unknown", result=None)

    def release(self, scope: str, reservation: str) -> None:
        record = self._records.get(scope)
        if record is not None and record.reservation == reservation:
            del self._records[scope]

    def get(self, scope: str, now: float) -> IdempotencyRecord | None:
        record = self._records.get(scope)
        if record is None:
            return None
        if now > record.expires_at:
            del self._records[scope]
            return None
        if record.state == "stored" and record.result is not None:
            return replace(record, result=_kept(record.result))
        return record

    def _sweep(self, now: float) -> None:
        for scope in [key for key, record in self._records.items() if now > record.expires_at]:
            del self._records[scope]


__all__ = [
    "IdempotencyRecord",
    "IdempotencyReservationRequest",
    "IdempotencyReserveOutcome",
    "IdempotencySettlement",
    "IdempotencyState",
    "IdempotencyStore",
    "InMemoryIdempotencyStore",
]
