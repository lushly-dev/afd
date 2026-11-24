"""Private, opaque per-call allow policy shared by the in-process boundaries."""

import copy
from collections.abc import Callable
from typing import Any
from weakref import WeakKeyDictionary

from afd.core.errors import CommandError


class _AllowToken:
    __slots__ = ("__weakref__",)


_predicates: WeakKeyDictionary[_AllowToken, Callable[[str], bool]] = WeakKeyDictionary()


def _direct_allows(allow: Callable[[str], bool], name: str) -> bool:
    try:
        return allow(name) is True
    except Exception:
        return False


def _bound_allow(context: Any) -> Callable[[str], bool] | None:
    token = getattr(context, "_direct_allow", None)
    if token is None:
        return None
    # A caller cannot replace an opaque marker with another predicate to widen access.
    return (
        _predicates.get(token, lambda _: False)
        if isinstance(token, _AllowToken)
        else lambda _: False
    )


def _bind_allow(context: Any, allow: Callable[[str], bool] | None) -> Any:
    carried = _bound_allow(context)
    if allow is None and carried is None:
        return context
    token = _AllowToken()
    if allow is not None and carried is not None:
        _predicates[token] = lambda name: (
            _direct_allows(carried, name) and _direct_allows(allow, name)
        )
    else:
        policy = allow if allow is not None else carried
        assert policy is not None
        _predicates[token] = policy
    context = copy.copy(context)
    context._direct_allow = token
    return context


def _is_allowed(context: Any, name: str) -> bool:
    allow = _bound_allow(context)
    return allow is None or _direct_allows(allow, name)


def _not_allowed(name: str) -> CommandError:
    from afd.core.similarity import truncate_name

    return CommandError(
        code="COMMAND_NOT_ALLOWED",
        message=f"Command '{truncate_name(name)}' is not allowed for this client",
        suggestion="Call one of the commands returned by list_command_names()",
        retryable=False,
    )
