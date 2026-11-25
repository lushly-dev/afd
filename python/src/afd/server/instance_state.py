"""Per-process approval and elicitation state checks (``instances`` option).

Mirrors ``packages/server/src/instance-state.ts`` and
``packages/server/src/approval-process-state.ts``:

- An MCP server's elicitation ``requestState`` key (``confirmation_key``, else a
  random per-process key) and each single-use approval middleware's spent-nonce
  store (``nonce_store``, else in-process memory) hold only within one process.
- With ``instances="multiple"``, creating the server raises ``ValueError`` when
  any active per-process default would be relied on.
- With ``instances=None`` (omitted), serving over HTTP logs one warning per
  process to stderr when a per-process default is in use. ``instances="single"``
  silences that warning; stdio logs nothing.
"""

from __future__ import annotations

import sys
import threading
from collections.abc import Sequence
from dataclasses import dataclass
from types import MappingProxyType
from typing import Any, Literal

ServerInstances = Literal["single", "multiple"]
"""How many processes serve this server's URL: ``"single"`` or ``"multiple"``."""

MIN_CONFIRMATION_KEY_BYTES = 32
_APPROVAL_PROCESS_STATE_ATTR = "_afd_approval_process_state"
_INSTANCES_WARNED_SYS_ATTR = "_afd_instances_warning_logged"
_WARN_LOCK = threading.Lock()


@dataclass(frozen=True)
class ApprovalProcessState:
    """Whether an approval middleware relays over MCP and keeps single-use nonces in memory."""

    relay: bool
    per_process_nonces: bool


@dataclass(frozen=True)
class InstanceState:
    """Validated confirmation key and optional HTTP warning for an MCP server."""

    confirmation_key: bytes | None = None
    http_warning: str | None = None


def mark_approval_process_state(middleware: Any, state: ApprovalProcessState) -> None:
    """Attach a stable marker to ``middleware`` so ``check_instance_state`` sees it across reloads."""
    setattr(
        middleware,
        _APPROVAL_PROCESS_STATE_ATTR,
        MappingProxyType(
            {
                "relay": bool(state.relay),
                "per_process_nonces": bool(state.per_process_nonces),
            }
        ),
    )


def approval_process_state(middleware: Any) -> ApprovalProcessState | None:
    """Read the own approval process-state marker on ``middleware``, if any.

    Uses plain boolean mapping fields rather than ``isinstance(..., ApprovalProcessState)``
    so middleware created before a module reload is still recognized.
    """
    try:
        own = vars(middleware)
    except TypeError:
        return None
    marker = own.get(_APPROVAL_PROCESS_STATE_ATTR)
    if isinstance(marker, ApprovalProcessState):
        return marker
    if not isinstance(marker, (dict, MappingProxyType)):
        return None
    relay = marker.get("relay")
    per_process_nonces = marker.get("per_process_nonces")
    if isinstance(relay, bool) and isinstance(per_process_nonces, bool):
        return ApprovalProcessState(relay=relay, per_process_nonces=per_process_nonces)
    return None


def carry_approval_process_state(composed: Any, parts: Sequence[Any]) -> None:
    """Propagate per-process state from any part of ``compose_middleware`` onto ``composed``."""
    states = [state for part in parts if (state := approval_process_state(part)) is not None]
    if not states:
        return
    mark_approval_process_state(
        composed,
        ApprovalProcessState(
            relay=any(state.relay for state in states),
            per_process_nonces=any(state.per_process_nonces for state in states),
        ),
    )


def check_confirmation_key(key: Any) -> bytes | None:
    """Validate and copy ``confirmation_key`` into an immutable ``bytes`` value."""
    if key is None:
        return None
    if isinstance(key, str):
        raw = key.encode("utf-8")
    elif isinstance(key, (bytes, bytearray, memoryview)):
        raw = bytes(key)
    else:
        raise TypeError("confirmation_key must be a str or bytes")
    if len(raw) < MIN_CONFIRMATION_KEY_BYTES:
        raise ValueError(f"confirmation_key must be at least {MIN_CONFIRMATION_KEY_BYTES} bytes")
    return raw


def check_instance_state(
    *,
    name: str,
    instances: str | None,
    confirmation_key: Any,
    confirmations: str,
    middleware: Sequence[Any],
) -> InstanceState:
    """Validate ``instances`` and ``confirmation_key`` and detect per-process defaults."""
    if instances is not None and instances not in ("single", "multiple"):
        raise ValueError("instances must be 'single' or 'multiple'")

    key_bytes = check_confirmation_key(confirmation_key)
    approvals = [
        state for step in middleware if (state := approval_process_state(step)) is not None
    ]
    elicits = confirmations != "off" or any(state.relay for state in approvals)

    missing: list[str] = []
    if elicits and key_bytes is None:
        missing.append(
            "confirmation_key (each process signs elicitation requestState with its own random "
            "key, so an answer must reach the process that asked)"
        )
    if any(state.per_process_nonces for state in approvals):
        missing.append(
            "the approval middleware's nonce_store (spent single-use tokens are kept in this "
            "process's memory, so a token works once on each process)"
        )

    if not missing:
        return InstanceState(confirmation_key=key_bytes)

    joined = " and ".join(missing)
    if instances == "multiple":
        raise ValueError(
            f"[AFD] {name}: instances='multiple' needs {joined}. "
            "Pass the same confirmation_key (at least 32 bytes) to every instance, and give "
            "create_approval_middleware a nonce_store every instance shares."
        )

    return InstanceState(
        confirmation_key=key_bytes,
        http_warning=(
            None
            if instances == "single"
            else (
                f"[{name}] warning: one process must serve every request: this server has no "
                f"{joined}. Behind several processes, share them and set instances='multiple'; "
                "with one process, set instances='single' to silence this."
            )
        ),
    )


def warn_instances_once(message: str | None) -> None:
    """Write ``message`` to stderr once per process across all servers in this process."""
    if not message:
        return
    with _WARN_LOCK:
        if _INSTANCES_WARNED_SYS_ATTR in sys.__dict__:
            return
        setattr(sys, _INSTANCES_WARNED_SYS_ATTR, True)
    print(message, file=sys.stderr, flush=True)


def _reset_instances_warning_for_tests() -> None:
    """Clear the process-wide warning flag (for unit tests only)."""
    with _WARN_LOCK:
        sys.__dict__.pop(_INSTANCES_WARNED_SYS_ATTR, None)
