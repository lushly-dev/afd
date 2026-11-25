"""Listener fan-out with per-listener error isolation.

Mirrors ``packages/auth/src/listeners.ts``: one throwing subscriber cannot block
later subscribers from observing a state change (such as sign-out) and cannot
cause the triggering operation to fail.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Generic, TypeVar

from afd.auth.types import AuthSubscription

logger = logging.getLogger("afd.auth")

ListenerErrorHandler = Callable[[BaseException], None]
"""Receives an exception raised by an ``on_auth_state_change`` subscriber."""

T = TypeVar("T")


def report_listener_error(
    error: BaseException,
    on_listener_error: ListenerErrorHandler | None = None,
) -> None:
    """Report a subscriber exception without interrupting the caller.

    Routes ``error`` to ``on_listener_error`` when configured. If no handler is
    configured, or if the handler itself raises, logs the exception through the
    ``afd.auth`` logger instead of letting it abort emission.
    """
    unhandled: BaseException = error
    if on_listener_error is not None:
        try:
            on_listener_error(error)
            return
        except Exception as handler_error:
            unhandled = handler_error
    logger.exception("Auth state listener raised an error", exc_info=unhandled)


class _ListenerSubscription:
    """Idempotent subscription handle returned by :meth:`ListenerSet.add`."""

    def __init__(self, remove: Callable[[], None]) -> None:
        self._remove = remove

    def unsubscribe(self) -> None:
        self._remove()


class ListenerSet(Generic[T]):
    """An ordered set of subscribers invoked in isolation."""

    def __init__(self, on_listener_error: ListenerErrorHandler | None = None) -> None:
        self._listeners: dict[Callable[[T], None], None] = {}
        self._on_listener_error = on_listener_error

    @property
    def size(self) -> int:
        """Number of currently registered listeners."""
        return len(self._listeners)

    def add(self, listener: Callable[[T], None]) -> AuthSubscription:
        """Register ``listener`` and return an unsubscribe handle."""
        self._listeners[listener] = None

        def _remove() -> None:
            self._listeners.pop(listener, None)

        return _ListenerSubscription(_remove)

    def emit(self, value: T) -> None:
        """Call every subscriber with ``value`` in registration order.

        Iterates a snapshot so listeners added during emission wait for the next
        event, and re-checks membership so listeners removed by an earlier
        subscriber are not called.
        """
        for listener in list(self._listeners):
            if listener not in self._listeners:
                continue
            try:
                listener(value)
            except Exception as error:
                report_listener_error(error, self._on_listener_error)

    def clear(self) -> None:
        """Remove all registered listeners."""
        self._listeners.clear()
