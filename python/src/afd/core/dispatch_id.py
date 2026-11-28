"""The dispatch id (``spec/dispatch.md``, "The dispatch id", I1 to I4).

The engine gives each call it runs an id, and middleware and the handler read it as
``context.dispatch_id``. A host that keeps its own record of a call (an intent written before
the handler, an approval) keys it by this id, which no other dispatch shares.

- **I1.** 128 bits from the platform's cryptographic random source (:mod:`secrets`), written as
  22 characters of unpadded base64url. Never drawn from ``context.random``, so a journal's tape
  is unchanged, and never taken from the caller: a value under ``dispatch_id`` or
  ``dispatchId`` in ``context.extra`` is removed.
- **I2.** Each batch item, pipeline step and command a handler runs through the registry gets its
  own; the outer call's context keeps its own.
- **I3.** The id is not stored on the context. This module keeps it, keyed by the identity of the
  context object the engine runs the call on, and ``dispatch_id`` is a read-only property that
  looks it up. No link can change what a later link reads, through the property, the instance
  dictionary or ``object.__setattr__``.
- **I4.** Since it is not on the object, it is in no copy, pickle, ``vars()``, ``repr``,
  result, journal entry or context digest.

A handler called as a plain function (a ``define_command`` function called directly) is not a
dispatch: while it runs, its context reads ``dispatch_id`` as ``None``, and the caller's
context reads its own id again once it returns.
"""

from __future__ import annotations

import base64
import contextlib
import contextvars
import copyreg
import secrets
import weakref
from collections.abc import Awaitable, Callable, Iterator, Mapping
from typing import Any, cast

DISPATCH_ID_NAMES = frozenset({"dispatch_id", "dispatchId"})
"""The names of the dispatch id: reserved as context field names, and removed from
``context.extra`` when a call starts."""

ENGINE_ENTRY = "__afd_engine_handler__"
"""The attribute of an AFD-decorated handler holding the entry the engine calls."""

VALIDATED_ENTRY = "__afd_validated_handler__"
"""The attribute of an AFD-decorated handler holding its entry for an already validated input."""

_OWNER = "__afd_entry_owner__"

# The id of each context object a dispatch runs on, by ``id(context)``: the object itself (a
# weak reference when it takes one, else a strong one released when the dispatch ends) and the id.
_IDS: dict[int, tuple[Any, bool, str]] = {}

# Contexts whose id reads as None here: ones a handler called as a plain function holds.
_MASKED: contextvars.ContextVar[frozenset[int]] = contextvars.ContextVar(
    "afd_masked_dispatch_ids", default=frozenset()
)

# The handler the engine is about to call through its public entry, for the context it runs on,
# so the AFD wrapper inside a decorator the host put around it knows it is the engine's call.
_ENGINE_CALL: contextvars.ContextVar[tuple[int, Any] | None] = contextvars.ContextVar(
    "afd_engine_handler_call", default=None
)

_CARRIER_TYPES: dict[type, type] = {}


def create_dispatch_id() -> str:
    """A fresh dispatch id: 16 bytes from :func:`secrets.token_bytes` as unpadded base64url
    (22 characters, the last ``A``, ``Q``, ``g`` or ``w``)."""
    return base64.urlsafe_b64encode(secrets.token_bytes(16)).rstrip(b"=").decode("ascii")


def _lookup(context: object) -> str | None:
    key = id(context)
    if key in _MASKED.get():
        return None
    entry = _IDS.get(key)
    if entry is None:
        return None
    held, weak, dispatch_id = entry
    target = held() if weak else held
    return dispatch_id if target is context else None


class DispatchIdCarrier:
    """Gives a context class its read-only ``dispatch_id``.

    The value is not an attribute of the instance: the engine keeps it, so assigning or deleting
    ``dispatch_id`` raises :class:`AttributeError`, and copies, pickles and ``vars()`` never
    hold it.
    """

    __slots__ = ()

    @property
    def dispatch_id(self) -> str | None:
        """The id the engine gave this dispatch (``spec/dispatch.md``, "The dispatch id"): 128
        random bits as 22 characters of unpadded base64url, set before anything else runs.
        ``None`` outside an AFD engine, and while a handler called as a plain function runs.

        Read it; never set it. Key a record you keep of a call (an intent written before the
        handler, an approval) by it. A batch item, a pipeline step and a command a handler runs
        through the registry each get their own, whatever trace id they share.
        """
        return _lookup(self)

    def __setattr__(self, name: str, value: Any) -> None:
        if name == "dispatch_id":
            raise AttributeError(
                "dispatch_id is set by the engine for each dispatch; read it, never set it"
            )
        super().__setattr__(name, value)


def dispatch_id_of(context: Any) -> str | None:
    """The dispatch id ``context`` carries, or ``None``."""
    return _lookup(context) if context is not None else None


def _carrier_type(cls: type) -> type:
    """The class the engine runs a context of the host's class ``cls`` on: ``cls`` with the
    ``dispatch_id`` property added. It pickles (and deep-copies) as ``cls``: it bears ``cls``'s
    names, so pickle could not find it by them, and the copy holds no id anyway."""
    carrier = _CARRIER_TYPES.get(cls)
    if carrier is None:

        def __reduce_ex__(self: Any, protocol: Any) -> Any:  # noqa: N807
            reduced = super(carrier, self).__reduce_ex__(protocol)  # type: ignore[arg-type]
            if not (isinstance(reduced, tuple) and len(reduced) >= 2):
                return reduced
            make, arguments, *rest = reduced
            # A host class without an instance dictionary has no place for what was set on the
            # copy outside its slots, in the dictionary the carrier class adds: those names are
            # left out of the default state. A host's own __getstate__ says what its state is.
            if (
                rest
                and cls.__dictoffset__ == 0
                and getattr(cls, "__getstate__", None) is getattr(object, "__getstate__", None)
            ):
                added = set(getattr(self, "__dict__", {}))
                state = rest[0]
                if isinstance(state, tuple) and len(state) == 2:
                    rest[0] = (None, state[1])
                elif isinstance(state, dict):
                    # None, not an empty dict: loading any dict state needs an instance
                    # dictionary, which a host such as a plain dict subclass does not have.
                    rest[0] = {
                        name: value for name, value in state.items() if name not in added
                    } or None
            # Pickle checks that __newobj__ builds the object's own class, so build the host's
            # class with a function of this module instead.
            if make is copyreg.__newobj__:  # type: ignore[attr-defined]
                host = cls if arguments[0] is carrier else arguments[0]
                return (_new_host, (host, *arguments[1:]), *rest)
            if make is copyreg.__newobj_ex__:  # type: ignore[attr-defined]
                host, args, kwargs = arguments
                return (_new_host_ex, (cls if host is carrier else host, args, kwargs), *rest)
            # A host's own __reduce__ that names type(self) names the carrier class.
            if make is carrier:
                make = cls
            if isinstance(arguments, tuple):
                arguments = tuple(cls if item is carrier else item for item in arguments)
            return (make, arguments, *rest)

        carrier = type(
            cls.__name__,
            (cls, DispatchIdCarrier),
            {
                "__module__": cls.__module__,
                "__qualname__": cls.__qualname__,
                "__doc__": cls.__doc__,
                "__reduce_ex__": __reduce_ex__,
            },
        )
        _CARRIER_TYPES[cls] = carrier
    return carrier


def _new_host(cls: type, *args: Any) -> Any:
    """Unpickle a context the engine ran on as its host class (see :func:`_carrier_type`)."""
    return cls.__new__(cls, *args)


def _new_host_ex(cls: type, args: tuple[Any, ...], kwargs: dict[str, Any]) -> Any:
    return cls.__new__(cls, *args, **kwargs)


def _slot_names(cls: type) -> Iterator[str]:
    for klass in cls.__mro__:
        slots = klass.__dict__.get("__slots__", ())
        for name in (slots,) if isinstance(slots, str) else slots:
            if name not in ("__dict__", "__weakref__"):
                yield name


def as_dispatch_context(context: Any) -> Any:
    """``context`` as an object that reads ``dispatch_id``: itself when its class is an AFD
    context class, else a copy whose class adds the property to the context's own class, with
    every field, slot and attribute of the original. The original is never changed."""
    if isinstance(context, DispatchIdCarrier):
        return context
    cls = type(context)
    carrier = _carrier_type(cls)
    if isinstance(context, Mapping):
        return carrier(context)
    copied = cast(Any, carrier).__new__(carrier)
    state = getattr(context, "__dict__", None)
    if isinstance(state, dict):
        copied.__dict__.update(state)
    for name in _slot_names(cls):
        with contextlib.suppress(AttributeError):
            object.__setattr__(copied, name, object.__getattribute__(context, name))
    return copied


def begin_dispatch(context: Any) -> str:
    """Start a dispatch on ``context``, an object the engine made for this call (see
    :func:`as_dispatch_context`): give it a fresh id, and remove any value a caller or a context
    hook put in ``extra`` under the id's names (I1). ``extra`` is replaced, not changed, so the
    caller's dictionary keeps its values. :func:`end_dispatch` releases the id when the context
    takes no weak reference."""
    dispatch_id = create_dispatch_id()
    extra = getattr(context, "extra", None)
    if isinstance(extra, Mapping) and not DISPATCH_ID_NAMES.isdisjoint(extra):
        with contextlib.suppress(AttributeError, TypeError):
            object.__setattr__(
                context,
                "extra",
                {name: value for name, value in extra.items() if name not in DISPATCH_ID_NAMES},
            )
    key = id(context)

    def release(_ref: Any) -> None:
        _IDS.pop(key, None)

    try:
        held: Any = weakref.ref(context, release)
        weak = True
    except TypeError:
        held, weak = context, False
    _IDS[key] = (held, weak, dispatch_id)
    return dispatch_id


def end_dispatch(context: Any) -> None:
    """Release the id of a dispatch whose context takes no weak reference. A context that does
    keeps reading its id until it is collected."""
    entry = _IDS.get(id(context))
    if entry is not None and not entry[1] and entry[0] is context:
        del _IDS[id(context)]


def own_entry(owner: Callable[..., Any], entry: Callable[..., Any]) -> None:
    """Mark ``entry`` as the engine entry of the AFD wrapper ``owner``, so a decorator that copies
    ``owner``'s attributes (``functools.wraps``) does not pass for it."""
    setattr(entry, _OWNER, owner)


def owned_entry(handler: Any, name: str) -> Callable[..., Awaitable[Any]] | None:
    """The entry ``name`` of ``handler`` when ``handler`` is the AFD wrapper that owns it; ``None``
    for a function that only copied the attribute, such as a host's decorator around one."""
    entry = getattr(handler, name, None)
    if entry is not None and getattr(entry, _OWNER, None) is handler:
        return entry  # type: ignore[no-any-return]
    return None


async def call_public_handler(handler: Any, data: Any, context: Any) -> Any:
    """Call a handler that is not an AFD wrapper's own entry, as the engine's call: an AFD wrapper
    inside it (under ``functools.wraps``) reads the dispatch id."""
    token = _ENGINE_CALL.set((id(context), handler))
    try:
        return await handler(data, context)
    finally:
        _ENGINE_CALL.reset(token)


def _wraps(handler: Any, wrapper: Any) -> bool:
    seen: set[int] = set()
    while handler is not None and id(handler) not in seen:
        if handler is wrapper:
            return True
        seen.add(id(handler))
        handler = getattr(handler, "__wrapped__", None)
    return False


@contextlib.contextmanager
def handler_call(wrapper: Any, context: Any) -> Iterator[None]:
    """The scope of a call to the AFD wrapper ``wrapper``: the engine's call when the engine is
    calling ``wrapper`` or a decorator around it for ``context``; otherwise a plain call, which is
    not a dispatch, so ``context`` reads no dispatch id until it returns. Nothing the caller holds
    is copied or changed.

    The mask is a context variable, so code the plain call runs in the same task, in a task it
    starts and through :func:`asyncio.to_thread` sees it. A raw :class:`threading.Thread` or
    ``loop.run_in_executor`` started inside it does not copy context variables: there the
    context reads the id of the dispatch that holds it."""
    pending = _ENGINE_CALL.get()
    if pending is not None and pending[0] == id(context) and _wraps(pending[1], wrapper):
        # Taken once: a call this handler makes to another AFD function is a plain call.
        token = _ENGINE_CALL.set(None)
        try:
            yield
        finally:
            _ENGINE_CALL.reset(token)
        return
    if context is None:
        yield
        return
    masked = _MASKED.set(_MASKED.get() | {id(context)})
    engine = _ENGINE_CALL.set(None)
    try:
        yield
    finally:
        _ENGINE_CALL.reset(engine)
        _MASKED.reset(masked)


__all__ = [
    "DISPATCH_ID_NAMES",
    "ENGINE_ENTRY",
    "VALIDATED_ENTRY",
    "DispatchIdCarrier",
    "as_dispatch_context",
    "begin_dispatch",
    "call_public_handler",
    "create_dispatch_id",
    "dispatch_id_of",
    "end_dispatch",
    "handler_call",
    "own_entry",
    "owned_entry",
]
