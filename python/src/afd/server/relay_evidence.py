"""Private relay evidence carrier (``spec/command-metadata.md``, "Relay evidence").

Set only by the MCP server's :class:`~afd.server.human_relay.HumanRelay` gate after
``resume`` returns :class:`~afd.server.human_relay.RelayApproved`, read by
:func:`~afd.server.approval.create_approval_middleware`, and cleared by the server engine
before the command handler runs.

Never exported publicly, never read from tool arguments, ``_meta``, headers or
``requestState``, and never stored as an attribute on :class:`~afd.core.commands.CommandContext`
(so ``repr``, ``str``, ``vars``, ``dataclasses.asdict`` and JSON serialization never expose it).
"""

from __future__ import annotations

import threading
import weakref
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Literal

Canonicalize = Callable[[Any], str | None]


@dataclass(frozen=True)
class RelayEvidence:
    """Server-private approval evidence from an approved ``HumanRelay`` decision."""

    command: str = field(repr=False)
    input_digest: str = field(repr=False)
    actor: str = field(repr=False)
    credentials_binding: str = field(repr=False)
    decision_id: str = field(repr=False)
    use_sdk_credentials: bool = field(default=False, repr=False)

    def __repr__(self) -> str:
        return "RelayEvidence([redacted])"


@dataclass
class RelayDispatchAdmission:
    """One-shot dispatch guard for a host-verified call, checked immediately before the handler
    runs regardless of whether the command also declares an ``approval`` policy.

    Popped into the execution engine's local dispatch closure so that even a retained ``next_fn``
    invoked after ``_execute_command`` cleanup still observes ``taken == True`` and is refused.
    """

    command: str
    canonical: str
    canonicalize: Canonicalize
    taken: bool = False

    def consume(self, command_name: str, data: Any) -> Literal["admitted", "mismatch"]:
        if self.taken:
            return "mismatch"
        self.taken = True
        if self.command != command_name:
            return "mismatch"
        canonical = self.canonicalize(data)
        return "admitted" if canonical is not None and canonical == self.canonical else "mismatch"


@dataclass
class _RelayCarrier:
    evidence: RelayEvidence | None = None
    validated_input: tuple[str, Any] | None = None
    dispatch_admission: RelayDispatchAdmission | None = None
    context_fields_validated: bool = False
    transferred: bool = False


# Reentrant lock so CPython's cyclic GC invoking a weakref cleanup callback on the same thread
# during carrier allocation never deadlocks.
_LOCK = threading.RLock()
# Identity-keyed weakref table (CommandContext is an unhashable mutable dataclass): each entry
# pairs a weakref (with GC cleanup) and the carrier, checking `ref() is context` on every lookup
# so recycled object IDs can never collide.
_RECORDS: dict[int, tuple[weakref.ref[Any], _RelayCarrier]] = {}


def _put_locked(context: Any, carrier: _RelayCarrier) -> None:
    key = id(context)

    def _cleanup(dead_ref: weakref.ref[Any]) -> None:
        with _LOCK:
            current = _RECORDS.get(key)
            if current is not None and current[0] is dead_ref:
                _RECORDS.pop(key, None)

    _RECORDS[key] = (weakref.ref(context, _cleanup), carrier)


def _get_locked(context: Any) -> _RelayCarrier | None:
    entry = _RECORDS.get(id(context))
    if entry is None:
        return None
    if entry[0]() is not context:
        return None
    return entry[1]


def _get_or_create_locked(context: Any) -> _RelayCarrier:
    carrier = _get_locked(context)
    if carrier is None:
        carrier = _RelayCarrier()
        _put_locked(context, carrier)
    return carrier


def _pop_locked(context: Any) -> _RelayCarrier | None:
    key = id(context)
    entry = _RECORDS.get(key)
    if entry is None or entry[0]() is not context:
        return None
    _RECORDS.pop(key, None)
    return entry[1]


def attach_relay_evidence(context: Any, evidence: RelayEvidence) -> None:
    """Attach server-private ``evidence`` to ``context`` off-object."""
    with _LOCK:
        _get_or_create_locked(context).evidence = evidence


def relay_evidence_of(context: Any) -> RelayEvidence | None:
    """Read the server-private relay evidence attached to ``context``, if any."""
    if context is None:
        return None
    with _LOCK:
        carrier = _get_locked(context)
        return carrier.evidence if carrier is not None else None


def clear_relay_evidence(context: Any) -> None:
    """Clear private relay evidence (and any unused prevalidated input) before the handler runs."""
    if context is None:
        return
    with _LOCK:
        carrier = _get_locked(context)
        if carrier is None:
            return
        carrier.evidence = None
        carrier.validated_input = None
        if carrier.dispatch_admission is None:
            _pop_locked(context)


def clear_relay_state(context: Any) -> None:
    """Drop all private relay state attached to ``context`` when a dispatch finishes."""
    if context is None:
        return
    with _LOCK:
        _pop_locked(context)


def attach_relay_validated_input(context: Any, command: str, data: Any) -> None:
    """Attach already-validated input for a host-verified dispatch so dynamic defaults never drift."""
    with _LOCK:
        _get_or_create_locked(context).validated_input = (command, data)


def take_relay_validated_input(context: Any, command: str) -> tuple[Any] | None:
    """Take the already-validated input for ``command`` once, in a 1-tuple, if attached."""
    if context is None:
        return None
    with _LOCK:
        carrier = _get_locked(context)
        if carrier is None or carrier.validated_input is None:
            return None
        name, data = carrier.validated_input
        if name != command:
            return None
        carrier.validated_input = None
        return (data,)


def attach_relay_context_validated(context: Any) -> None:
    """Mark that declared context fields on ``context`` were already validated by ``HumanRelayGate``."""
    with _LOCK:
        _get_or_create_locked(context).context_fields_validated = True


def take_relay_context_validated(context: Any) -> bool:
    """Return ``True`` once when declared context fields were already validated for this dispatch."""
    if context is None:
        return False
    with _LOCK:
        carrier = _get_locked(context)
        if carrier is None or not carrier.context_fields_validated:
            return False
        carrier.context_fields_validated = False
        return True


def attach_relay_dispatch_admission(
    context: Any,
    command: str,
    canonical: str,
    canonicalize: Canonicalize,
) -> None:
    """Attach a one-shot host-verified dispatch admission for ``context``."""
    with _LOCK:
        _get_or_create_locked(context).dispatch_admission = RelayDispatchAdmission(
            command=command,
            canonical=canonical,
            canonicalize=canonicalize,
        )


def pop_relay_dispatch_admission(context: Any) -> RelayDispatchAdmission | None:
    """Pop the one-shot host-verified dispatch admission off ``context`` into the engine's
    dispatch closure, so it survives ``clear_relay_state`` for any retained ``next_fn`` and
    is never inherited by nested calls."""
    if context is None:
        return None
    with _LOCK:
        carrier = _get_locked(context)
        if carrier is None or carrier.dispatch_admission is None:
            return None
        admission = carrier.dispatch_admission
        carrier.dispatch_admission = None
        return admission


def transfer_relay_state(source: Any, target: Any) -> None:
    """Move private relay state from ``source`` (router context) onto ``target`` (the engine's
    per-call context) once only.

    Never moves or deletes state off an active engine context (already ``transferred``), so nested
    ``execute(..., context)`` calls neither steal the outer call's retry guard nor inherit its
    ``taken`` admission or relay evidence.
    """
    if source is None or target is None:
        return
    with _LOCK:
        carrier = _get_locked(source)
        if carrier is None or carrier.transferred:
            return
        _pop_locked(source)
        carrier.transferred = True
        _put_locked(target, carrier)
