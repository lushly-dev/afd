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
binds the continuations it builds to the entry of the ``next`` it was handed. The retry middleware
reads ``mutation`` the same way. Mirrors ``markEngineNext``, ``liveSecret`` and ``liveMutation``
in ``packages/server/src/approval-admission.ts``. No field of a context binds a continuation.

An engine of its own that runs AFD middleware outside this executor (Botcore's ``CommandHost``)
opens the same entry through the public :func:`open_dispatch`, exported from ``afd.core``. The
binding guards against accidents (a recorder handed a ``next`` of its own, a context kept past its
call), not against hostile in-process code, which could as well write to a sink itself.
"""

from __future__ import annotations

import inspect
import threading
import weakref
from collections.abc import Callable
from types import TracebackType
from typing import Any, TypeVar, cast

_Next = TypeVar("_Next", bound=Callable[..., Any])


class RunningCommand:
    """One dispatch's entry: its context, its command's ``secret`` and ``mutation``, and whether it
    is still open."""

    __slots__ = ("context", "mutation", "open", "secret")

    def __init__(self, context: Any, secret: bool, mutation: bool | None = None) -> None:
        self.context = context
        self.secret = secret
        self.mutation = mutation
        self.open = True


# Each engine-built continuation, by identity, to its dispatch's entry. Weak, so a continuation
# that is dropped takes its binding with it. Guarded by _LOCK: a chain may run on another thread.
_BOUND: weakref.WeakKeyDictionary[Any, RunningCommand] = weakref.WeakKeyDictionary()
_LOCK = threading.Lock()


def open_running_command(context: Any, command: Any) -> RunningCommand:
    """The entry of a dispatch of ``command`` on ``context``; close it when the dispatch ends."""
    return RunningCommand(
        context,
        getattr(command, "secret", False) is True,
        getattr(command, "mutation", False) is True,
    )


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


def running_command_mutation(context: Any, next_fn: Any) -> bool | None:
    """Whether the command the engine's chain runs on ``context`` declares ``mutation``, for the
    retry middleware, read through ``next_fn`` as :func:`running_command_secret` reads ``secret``;
    ``None`` outside an open dispatch of the engine on that very context object."""
    entry = bound_entry(next_fn)
    if entry is None or not entry.open or entry.context is not context:
        return None
    return entry.mutation


class CommandDispatch:
    """One dispatch an external engine runs: see :func:`open_dispatch`."""

    __slots__ = ("_entry",)

    def __init__(self, entry: RunningCommand) -> None:
        self._entry = entry

    @property
    def secret(self) -> bool:
        """Whether the command this dispatch runs declares ``secret``."""
        return self._entry.secret

    @property
    def mutation(self) -> bool | None:
        """Whether the command changes state, or ``None`` when the engine did not say."""
        return self._entry.mutation

    @property
    def open(self) -> bool:
        """Whether the dispatch is still running; middleware reads unknown once it is closed."""
        return self._entry.open

    def bind(self, next_fn: _Next) -> _Next:
        """A continuation that calls ``next_fn`` and is bound to this dispatch: hand it, not
        ``next_fn``, to the middleware chain. Each call returns a new one, so a binding never
        replaces another dispatch's and a continuation kept from a closed dispatch stays
        unknown."""
        if not self._entry.open:
            raise RuntimeError("Cannot bind a continuation to a closed dispatch")

        bound: Callable[..., Any]
        if inspect.iscoroutinefunction(next_fn):

            async def bound(*args: Any, **kwargs: Any) -> Any:
                return await next_fn(*args, **kwargs)

        else:

            def bound(*args: Any, **kwargs: Any) -> Any:
                return next_fn(*args, **kwargs)

        bind_continuation(bound, self._entry)
        return cast(_Next, bound)

    def close(self) -> None:
        """End the dispatch: every continuation bound to it reads unknown from now on."""
        self._entry.open = False

    def __enter__(self) -> CommandDispatch:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        self.close()


def open_dispatch(context: Any, *, secret: bool, mutation: bool | None = None) -> CommandDispatch:
    """Open a dispatch for an engine that runs AFD middleware outside AFD's executor.

    ``context`` is the very object the engine passes down its middleware chain, and ``secret``
    whether the command it runs declares ``secret`` (``spec/journal.md``). Bind each continuation
    the engine builds for that chain with :meth:`CommandDispatch.bind` (``compose_middleware``
    passes the binding on to its own), run the chain, and close the dispatch when it ends; as a
    context manager it closes itself. Middleware handed a bound continuation, on that context,
    while the dispatch is open, reads the declaration: ``create_journal_middleware`` then records
    a non-secret call without ``redact``, skips a secret one without it, and keeps a secret call
    off a recording parent's tape. Anything else reads unknown. An engine with no recorder in
    its own chain keeps a secret call off a parent's tape with ``afd.server.run_off_tape``.

    The declaration is the engine's word: like the rest of the process, code that can call this
    is trusted, so this is not a boundary against in-process code.

    ``mutation`` says whether the command changes state, for the retry middleware; left out, it
    reads unknown there, as outside any dispatch, so nothing is retried on a guess.

    Raises:
        TypeError: When ``secret`` is not a ``bool``, or ``mutation`` is neither a ``bool`` nor
            ``None``.
    """
    if not isinstance(secret, bool):
        raise TypeError(f"secret must be a bool, got {type(secret).__name__}")
    if mutation is not None and not isinstance(mutation, bool):
        raise TypeError(f"mutation must be a bool or None, got {type(mutation).__name__}")
    return CommandDispatch(RunningCommand(context, secret, mutation))
