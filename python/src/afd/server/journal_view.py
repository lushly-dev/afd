"""Each dispatch's own view of a context's clock and random source (internal, #2703).

The journal records a call by having its handler read a recording clock and random source, and
keeps a secret call off tape by having it read the sources under them. Assigning those to
``context.clock`` and ``context.random`` for the length of the call would let a concurrent call on
the same context object read them too: an engine that hands one context to several calls
(Botcore's ``CommandHost``, or a chain composed by hand) would put a secret call's values on a
sibling's tape, or take a sibling's reads off its own.

So a journal step sets the sources for its own dispatch only, in a context variable. That reaches
its handler, the calls nested in it and the tasks and threads (``asyncio.to_thread``) they start,
and never a sibling task. While any step runs on a context, the context's ``clock`` and ``random``
hold a router that reads the current dispatch's source, or the context's own when the dispatch set
none; the last step to leave puts the context's own back. A router is falsy when the source it
gives the reader is ``None``, so ``context.clock or default`` still picks the default.

A read on a thread that carries no context variables (``loop.run_in_executor`` without
``contextvars.copy_context``, a middleware that moves the chain to such a thread) cannot name its
dispatch. When the steps running on the context form one chain, each entered inside the view of
the one before, the read is the innermost's: no other call is running. A step that starts on such
a thread names no parent, so it counts as a sibling. A secret call kept off tape always counts as
a step, so beside it, as beside any sibling, the read cannot be told apart from a sibling's. It then
reads the context's own source, never another call's, and the tape of every recording running on
the context is marked ``truncated``, so their replays say they cannot restore every value.
"""

from __future__ import annotations

import contextvars
import copy
import threading
import weakref
from collections.abc import Awaitable, Callable, Mapping
from types import MappingProxyType
from typing import Any, TypeVar

from afd.core.clock import system_clock, system_random

_T = TypeVar("_T")

# Each router to the step whose source the current dispatch reads through it. Never mutated: a
# step sets a new mapping and resets it when it leaves.
_VIEWS: contextvars.ContextVar[Mapping[_SourceRouter, _Step]] = contextvars.ContextVar(
    "afd_journal_views", default=MappingProxyType({})
)
# Guards installing and removing routers and their steps: a chain may run on another thread.
# Reentrant, since reading or setting a context's attribute may run code that reads its clock.
_LOCK = threading.RLock()


def _the(value: Any) -> Any:
    """What a router pickles as: the source it gave the pickling code."""
    return value


class _Step:
    """One journal step running on a context: the thread it set its view on, the source it set on
    each router and the step it is nested in there, and what to do when a read it may have missed
    happens on a thread without context variables."""

    __slots__ = ("missed", "parents", "sources", "thread")

    def __init__(self, missed: Callable[[], None] | None) -> None:
        self.thread = threading.get_ident()
        self.sources: dict[_SourceRouter, Any] = {}
        self.parents: dict[_SourceRouter, _Step | None] = {}
        self.missed = missed


class _SourceRouter:
    """Stands on a context in place of its own source while a journal step runs on it."""

    __slots__ = ("__weakref__", "_owner", "attr", "base", "steps")

    def __init__(self, owner: Any, attr: str, base: Any) -> None:
        # Weak, so a copy of the context that keeps the router does not keep the context alive.
        try:
            self._owner: Callable[[], Any] = weakref.ref(owner)
        except TypeError:
            self._owner = lambda: owner
        self.attr = attr
        self.base = base
        self.steps: list[_Step] = []

    def owner(self) -> Any:
        """The context the router was put on, or ``None`` once it is gone."""
        return self._owner()

    def _step(self, *, mark: bool) -> _Step | None:
        """The step whose source the current reader gets, or ``None`` for the context's own."""
        step = _VIEWS.get().get(self)
        if step is not None:
            return step
        here = threading.get_ident()
        with _LOCK:
            steps = list(object.__getattribute__(self, "steps"))
        # No step, or a sibling on a thread a step runs on: the context's own.
        if not steps or any(running.thread == here for running in steps):
            return None
        innermost = _innermost(self, steps)
        if innermost is not None:
            return innermost
        # Siblings run on the context: whose read this is cannot be told, so it reads the context's
        # own and every recording says it may be missing one.
        if mark:
            for running in steps:
                if running.missed is not None:
                    running.missed()
        return None

    def _resolve(self, *, mark: bool) -> Any:
        step = self._step(mark=mark)
        return object.__getattribute__(self, "base") if step is None else step.sources[self]

    def source(self) -> Any:
        """What the current dispatch reads: the source it set, else the context's own."""
        return self._resolve(mark=False)

    def __bool__(self) -> bool:
        return self.source() is not None

    def __getattr__(self, name: str) -> Any:
        # Anything else a source has (a seeded source's ``seed``, a manual clock's ``advance``).
        if name.startswith("_"):
            raise AttributeError(name)
        return getattr(self.source(), name)

    def __copy__(self) -> _SourceRouter:
        return self

    def __deepcopy__(self, memo: dict[int, Any]) -> Any:
        return copy.deepcopy(self.source(), memo)

    def __reduce__(self) -> tuple[Callable[[Any], Any], tuple[Any]]:
        return (_the, (self.source(),))

    def __repr__(self) -> str:
        return f"<dispatch view of {self.source()!r}>"


def _innermost(router: _SourceRouter, steps: list[_Step]) -> _Step | None:
    """The innermost of ``steps`` when they form one chain, each nested in the one before."""
    nested_in = {id(step.parents.get(router)) for step in steps}
    leaves = [step for step in steps if id(step) not in nested_in]
    if len(leaves) != 1:
        return None
    chain: set[int] = set()
    step: _Step | None = leaves[0]
    while step is not None and id(step) not in chain:
        chain.add(id(step))
        step = step.parents.get(router)
    return leaves[0] if all(id(running) in chain for running in steps) else None


class _ClockRouter(_SourceRouter):
    __slots__ = ()

    def now(self) -> float:
        value: float = (self._resolve(mark=True) or system_clock).now()
        return value


class _RandomRouter(_SourceRouter):
    __slots__ = ()

    def next(self) -> float:
        value: float = (self._resolve(mark=True) or system_random).next()
        return value


_ROUTERS: dict[str, type[_SourceRouter]] = {"clock": _ClockRouter, "random": _RandomRouter}


def dispatch_source(context: Any, attr: str) -> Any:
    """The ``clock`` or ``random`` the current dispatch reads on ``context``, or ``None``, for a
    journal step about to set its own: an ambiguous read marks the running recordings."""
    value = getattr(context, attr, None)
    return value._resolve(mark=True) if isinstance(value, _SourceRouter) else value


def _enter(context: Any, attr: str, step: _Step, source: Any) -> _SourceRouter:
    with _LOCK:
        current = getattr(context, attr, None)
        if isinstance(current, _SourceRouter):
            router = current
            # Only this dispatch's own view names the step it is nested in. A guess on a thread
            # without context variables could make a concurrent sibling its parent.
            parent = _VIEWS.get().get(router)
        else:
            router = _ROUTERS[attr](context, attr, current)
            parent = None
            setattr(context, attr, router)
        # Complete before the step is visible to a reader on another thread.
        step.sources[router] = source
        step.parents[router] = parent
        router.steps.append(step)
        return router


def _leave(router: _SourceRouter, step: _Step) -> None:
    with _LOCK:
        router.steps.remove(step)
        owner = router.owner()
        # Put the context's own back, unless something has replaced the router since.
        if not router.steps and owner is not None and getattr(owner, router.attr, None) is router:
            setattr(owner, router.attr, router.base)


async def run_with_sources(
    context: Any,
    sources: Mapping[str, Any],
    next_fn: Callable[[], Awaitable[_T]],
    *,
    missed: Callable[[], None] | None = None,
    required: bool = True,
) -> _T:
    """Run ``next_fn`` with ``context.clock`` and ``context.random`` (the keys of ``sources``)
    reading the given sources, for this dispatch only. ``missed`` is called when a read on a thread
    without context variables may have been this dispatch's. With ``required=False``, a context
    that takes no router (``None``, frozen) runs ``next_fn`` as it is."""
    step = _Step(missed)
    routers: list[_SourceRouter] = []
    view = dict(_VIEWS.get())
    try:
        for attr, source in sources.items():
            try:
                router = _enter(context, attr, step, source)
            except (AttributeError, TypeError, ValueError):
                # ValueError: a frozen pydantic model refuses the assignment with a ValidationError.
                if required:
                    raise
                continue
            routers.append(router)
            view[router] = step
        token = _VIEWS.set(view)
        try:
            return await next_fn()
        finally:
            _VIEWS.reset(token)
    finally:
        for router in routers:
            _leave(router, step)
