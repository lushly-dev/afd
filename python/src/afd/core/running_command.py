"""The command each engine dispatch runs, for middleware that must read its declaration (internal).

The shared single-command executor (:mod:`afd.core.single_executor`) opens one
:class:`RunningCommand` per dispatch: the context object it passes down the chain and whether the
command declares ``secret``. It binds the entry to each continuation it builds for that chain, the
``next`` every middleware is handed, by the continuation's identity. The journal middleware reads
the declaration only when the ``next`` it was handed is one of those, the entry is still open and
the context is the dispatch's own: a recorder given a ``next`` of its own (one a handler or an
outer middleware runs itself with the dispatch's context, or another host's chain) reads unknown.
Because the binding travels with the continuation, it holds where a middleware moves the rest of
the chain to a worker thread with a fresh event loop. The dispatch closes the entry when it ends,
so a continuation kept or a task spawned inside it reads unknown afterwards. ``compose_middleware``
binds the continuations it builds to the entry of the ``next`` it was handed. Mirrors
``markEngineNext`` and ``liveSecret`` in ``packages/server/src/approval-admission.ts``. No field
of a context, and nothing a caller passes, binds a continuation.
"""

from __future__ import annotations

import threading
import weakref
from typing import Any


class RunningCommand:
    """One dispatch's entry: its context, its command's ``secret``, and whether it is still open."""

    __slots__ = ("context", "open", "secret")

    def __init__(self, context: Any, secret: bool) -> None:
        self.context = context
        self.secret = secret
        self.open = True


# Each engine-built continuation, by identity, to its dispatch's entry. Weak, so a continuation
# that is dropped takes its binding with it. Guarded by _LOCK: a chain may run on another thread.
_BOUND: weakref.WeakKeyDictionary[Any, RunningCommand] = weakref.WeakKeyDictionary()
_LOCK = threading.Lock()


def open_running_command(context: Any, command: Any) -> RunningCommand:
    """The entry of a dispatch of ``command`` on ``context``; close it when the dispatch ends."""
    return RunningCommand(context, getattr(command, "secret", False) is True)


def bind_continuation(next_fn: Any, entry: RunningCommand) -> None:
    """Bind a continuation the engine built for ``entry``'s chain to that entry."""
    with _LOCK:
        _BOUND[next_fn] = entry


def bound_entry(next_fn: Any) -> RunningCommand | None:
    """The entry ``next_fn`` was bound to, or ``None``."""
    try:
        with _LOCK:
            return _BOUND.get(next_fn)
    except TypeError:  # Not weak-referenceable: never bound.
        return None


def pass_on_binding(handed: Any, built: Any) -> None:
    """Bind ``built``, a continuation a middleware composer made, to the entry of ``handed``, the
    ``next`` it was given, if that one is bound."""
    entry = bound_entry(handed)
    if entry is not None:
        bind_continuation(built, entry)


def running_command_secret(context: Any, next_fn: Any) -> bool | None:
    """Whether the command the engine's chain runs on ``context`` declares ``secret``, read through
    ``next_fn``, the continuation the reader was handed; ``None`` unless it is one the engine built
    for an open dispatch on that very context object."""
    entry = bound_entry(next_fn)
    if entry is None or not entry.open or entry.context is not context:
        return None
    return entry.secret
