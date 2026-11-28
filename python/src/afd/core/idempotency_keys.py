"""Where a call's idempotency key came from, as the engines decide it (``spec/idempotency.md``,
K1 to K6). Internal to AFD's own engines; mirrors ``packages/core/src/idempotency-keys.ts``.

A key reaches an engine on ``context.idempotency_key``. The engine takes it:

- as no key when it is absent or ``None`` (K2), or when it equals the key the engine delivered to
  the handler of the call this one is nested in (K6), marked on that handler's context;
- as it is when the engine set it itself, a derived key (K4) or one restored from a journal,
  which fail K2's form;
- as a caller's key when it has K2's form, and otherwise refuses the call.

The marks are private attributes of the context (TypeScript keeps them under registered
symbols). They are not a boundary against code in the same process: a key marked as the
engine's still scopes only its caller's own calls (K5).
"""

from __future__ import annotations

import copy
import dataclasses
from contextlib import suppress
from dataclasses import dataclass
from typing import Any, Literal

from afd.core.idempotency import derive_idempotency_key, is_idempotency_key

IDEMPOTENCY_KEY_SET_BY_ENGINE = "_idempotency_key_engine"
"""The context attribute marking a key the engine set itself: derived (K4) or restored."""

IDEMPOTENCY_KEY_DELIVERED = "_idempotency_key_delivered"
"""The context attribute marking the key the engine delivered to a handler (K6)."""

_ATTRIBUTES = ("idempotency_key", IDEMPOTENCY_KEY_SET_BY_ENGINE, IDEMPOTENCY_KEY_DELIVERED)


@dataclass(frozen=True)
class CallIdempotencyKey:
    """The key a call carries, as an engine decides it.

    ``kind`` is ``none`` (no key), ``key`` (with ``key`` and whether the engine set it) or
    ``invalid`` (a caller's value that is not of K2's form).
    """

    kind: Literal["none", "key", "invalid"]
    key: str | None = None
    set_by_engine: bool = False


NO_KEY = CallIdempotencyKey("none")
INVALID_KEY = CallIdempotencyKey("invalid")


def _get(context: Any, name: str) -> Any:
    if isinstance(context, dict):
        return context.get(name)
    return getattr(context, name, None)


def _set(context: Any, name: str, value: Any) -> None:
    if isinstance(context, dict):
        if value is None:
            context.pop(name, None)
        else:
            context[name] = value
        return
    with suppress(AttributeError, TypeError, dataclasses.FrozenInstanceError):
        setattr(context, name, value)


def has_idempotency_key_state(context: Any) -> bool:
    """Whether ``context`` carries a key or either mark."""
    return context is not None and any(_get(context, name) is not None for name in _ATTRIBUTES)


def resolve_idempotency_key(context: Any) -> CallIdempotencyKey:
    """The key ``context`` carries, decided as the module docstring says."""
    if context is None:
        return NO_KEY
    raw = _get(context, "idempotency_key")
    if raw is None:
        return NO_KEY
    delivered = _get(context, IDEMPOTENCY_KEY_DELIVERED)
    if delivered is not None and delivered == raw:
        return NO_KEY
    if isinstance(raw, str) and _get(context, IDEMPOTENCY_KEY_SET_BY_ENGINE) == raw:
        return CallIdempotencyKey("key", raw, set_by_engine=True)
    if is_idempotency_key(raw):
        return CallIdempotencyKey("key", raw)
    return INVALID_KEY


def deliver_idempotency_key(context: Any, key: CallIdempotencyKey) -> None:
    """Put the call's key on ``context`` itself, the object its middleware and handler share (K3),
    and mark it delivered, so a call the handler makes on this context starts without it (K6)."""
    value = key.key if key.kind == "key" else None
    _set(context, "idempotency_key", value)
    _set(context, IDEMPOTENCY_KEY_SET_BY_ENGINE, None)
    _set(context, IDEMPOTENCY_KEY_DELIVERED, value)


def idempotency_fields(source: Any) -> dict[str, Any]:
    """The idempotency attributes of ``source`` to carry onto a context built from it: the key,
    the engine's marks on it, who the lane says the caller is (S3) and whether it is a task run
    (S11)."""
    return {
        "idempotency_key": _get(source, "idempotency_key"),
        IDEMPOTENCY_KEY_SET_BY_ENGINE: _get(source, IDEMPOTENCY_KEY_SET_BY_ENGINE),
        IDEMPOTENCY_KEY_DELIVERED: _get(source, IDEMPOTENCY_KEY_DELIVERED),
        "_idempotency_caller": _get(source, "_idempotency_caller"),
        "_task_run": _get(source, "_task_run") is True,
    }


def _copy_with(context: Any, values: dict[str, Any]) -> Any:
    if isinstance(context, dict):
        copied = dict(context)
        for name, value in values.items():
            _set(copied, name, value)
        return copied
    if dataclasses.is_dataclass(context) and not isinstance(context, type):
        names = {item.name for item in dataclasses.fields(context)}
        if values.keys() <= names:
            return dataclasses.replace(context, **values)
    copied = copy.copy(context)
    for name, value in values.items():
        _set(copied, name, value)
    return copied


def with_engine_idempotency_key(context: Any, key: str | None) -> Any:
    """A copy of ``context`` carrying ``key`` as a key the engine chose (a derived or restored
    key), or no key when ``key`` is ``None``."""
    return _copy_with(
        context,
        {
            "idempotency_key": key,
            IDEMPOTENCY_KEY_SET_BY_ENGINE: key,
            IDEMPOTENCY_KEY_DELIVERED: None,
        },
    )


def with_derived_idempotency_key(
    context: Any, kind: Literal["batch", "pipeline"], index: int
) -> Any:
    """The context of the item or step at ``index`` of a batch or pipeline whose request ran on
    ``context``: under the key derived from the request's (K4), without one when the request had
    none or inherited it (K6), and unchanged with an invalid one, so the item fails K2 at its
    engine."""
    if context is None:
        return context
    key = resolve_idempotency_key(context)
    if key.kind == "invalid":
        return context
    if key.kind == "none":
        return (
            context
            if not has_idempotency_key_state(context)
            else with_engine_idempotency_key(context, None)
        )
    assert key.key is not None
    return with_engine_idempotency_key(context, derive_idempotency_key(key.key, kind, index))


__all__ = [
    "IDEMPOTENCY_KEY_DELIVERED",
    "IDEMPOTENCY_KEY_SET_BY_ENGINE",
    "INVALID_KEY",
    "NO_KEY",
    "CallIdempotencyKey",
    "deliver_idempotency_key",
    "has_idempotency_key_state",
    "idempotency_fields",
    "resolve_idempotency_key",
    "with_derived_idempotency_key",
    "with_engine_idempotency_key",
]
