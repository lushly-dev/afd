"""The principal behind a command call, and the context defaults AFD surfaces
fill in (``actor``, ``clock``, ``random``).

Mirrors ``packages/core/src/actor.ts``.
"""

from __future__ import annotations

import copy
import dataclasses
from dataclasses import dataclass
from typing import Any, Literal, Optional, Tuple, TypeVar

from afd.core.clock import Clock, RandomSource, system_clock, system_random

__all__ = [
    "ACTOR_KINDS",
    "Actor",
    "ActorKind",
    "ContextDefaults",
    "is_actor",
    "is_actor_kind",
    "with_context_defaults",
]

ActorKind = Literal["human", "agent", "service", "script", "test"]
"""What kind of principal is calling: a person, an AI agent, a service, a script or a test."""

ACTOR_KINDS: Tuple[ActorKind, ...] = ("human", "agent", "service", "script", "test")
"""The kinds of principal that can call a command."""


@dataclass
class Actor:
    """Who is calling a command.

    Surfaces fill in ``kind``: ``DirectClient`` defaults to ``human``, the MCP
    server to ``agent``, and the testing helpers to ``test``. Middleware and
    handlers read ``context.actor`` to key trust, approval, rate-limit or
    data rules on it; AFD itself only reports ``kind`` (as
    ``metadata.actorKind``), never the id.

    Attributes:
        kind: What kind of principal this is.
        id: Stable identifier within the application, e.g. a user ID.
        label: Display name, e.g. "Claude (advisor)".
        on_behalf_of: The human an agent or service is acting for.
    """

    kind: ActorKind
    id: Optional[str] = None
    label: Optional[str] = None
    on_behalf_of: Optional[str] = None


def is_actor_kind(value: Any) -> bool:
    """Whether ``value`` is one of :data:`ACTOR_KINDS`."""
    return isinstance(value, str) and value in ACTOR_KINDS


def is_actor(value: Any) -> bool:
    """Whether ``value`` is a well-formed :class:`Actor`."""
    return (
        isinstance(value, Actor)
        and is_actor_kind(value.kind)
        and all(
            field is None or isinstance(field, str)
            for field in (value.id, value.label, value.on_behalf_of)
        )
    )


def actor_kind_of(actor: Any) -> Optional[ActorKind]:
    """The actor's kind when it is a valid one, for ``metadata.actorKind`` and telemetry."""
    kind = getattr(actor, "kind", None)
    return kind if is_actor_kind(kind) else None


@dataclass
class ContextDefaults:
    """Defaults for :func:`with_context_defaults`.

    Attributes:
        clock: Clock when the context has none. Default: :data:`system_clock`.
        random: Random source when the context has none. Default: :data:`system_random`.
        actor: Actor when the context has none. Default: none (the context keeps no actor).
    """

    clock: Optional[Clock] = None
    random: Optional[RandomSource] = None
    actor: Optional[Actor] = None


ContextT = TypeVar("ContextT")


def with_context_defaults(
    context: Optional[ContextT] = None,
    defaults: Optional[ContextDefaults] = None,
) -> ContextT:
    """A copy of ``context`` with ``clock``, ``random`` and (when given) ``actor``
    filled in where it has none. Values already on the context always win.

    Works on ``afd.core.CommandContext`` (the default when ``context`` is None),
    ``afd.direct.CommandContext`` and any dataclass with those fields. Another
    object is shallow-copied and given the attributes; one that cannot take
    them is returned unchanged. The actor is copied too: middleware may refine ``context.actor`` in place,
    and a shared default object would carry one caller's identity into the next
    call.
    """
    if context is None:
        from afd.core.commands import CommandContext

        context = CommandContext()  # type: ignore[assignment]
    defaults = defaults or ContextDefaults()
    actor = getattr(context, "actor", None) or defaults.actor
    values = {
        "clock": getattr(context, "clock", None) or defaults.clock or system_clock,
        "random": getattr(context, "random", None) or defaults.random or system_random,
        "actor": copy.copy(actor) if actor is not None else None,
    }
    if dataclasses.is_dataclass(context) and values.keys() <= {
        field.name for field in dataclasses.fields(context)
    }:
        return dataclasses.replace(context, **values)  # type: ignore[type-var]
    # A caller's own context type (TypeScript accepts any object here).
    filled = copy.copy(context)
    try:
        for name, value in values.items():
            setattr(filled, name, value)
    except (AttributeError, TypeError):
        return context
    return filled
