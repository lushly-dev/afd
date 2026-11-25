"""Backstop check for ``afd.auth`` middleware on token-authorized MCP servers.

Mirrors ``packages/server/src/auth-middleware-check.ts`` (#2524):

``afd.auth.create_auth_middleware`` marks itself with whether it was given
``is_verified_credentials``. Without it, a call carrying verified MCP bearer
credentials would be gated on the local adapter's session and stamped with the
local session's user. A server configured with ``auth`` refuses to start with
such middleware, directly in ``config.middleware`` or inside
``compose_middleware``.
"""

from __future__ import annotations

from collections.abc import Sequence
from types import MappingProxyType
from typing import Any

_AUTH_MIDDLEWARE_CREDENTIALS_ATTR = "_afd_auth_middleware_credentials"


def auth_middleware_recognises_credentials(middleware: Any) -> bool | None:
    """Read the own credentials-recognition mark on ``middleware``, if any."""
    try:
        own = vars(middleware)
    except TypeError:
        return None
    marker = own.get(_AUTH_MIDDLEWARE_CREDENTIALS_ATTR)
    if not isinstance(marker, (dict, MappingProxyType)):
        return None
    flag = marker.get("recognises_verified_credentials")
    return flag if isinstance(flag, bool) else None


def carry_auth_middleware_mark(composed: Any, parts: Sequence[Any]) -> None:
    """Propagate ``afd.auth`` credentials marks through ``compose_middleware``.

    One unmarked (``False``) auth middleware in a composition is enough to stamp
    the local session on a token's call, so ``composed`` is marked ``True`` only
    when every marked part recognises verified credentials.
    """
    flags = [
        flag for part in parts if (flag := auth_middleware_recognises_credentials(part)) is not None
    ]
    if not flags:
        return
    setattr(
        composed,
        _AUTH_MIDDLEWARE_CREDENTIALS_ATTR,
        MappingProxyType({"recognises_verified_credentials": all(flags)}),
    )


def assert_auth_middleware_recognises_tokens(
    *,
    has_auth: bool,
    middleware: Sequence[Any] | None,
) -> None:
    """Raise ``ValueError`` when a server with ``auth`` runs ``afd.auth`` without ``is_verified_credentials``."""
    if not has_auth or not middleware:
        return
    if any(auth_middleware_recognises_credentials(step) is False for step in middleware):
        raise ValueError(
            "afd.auth middleware on a server with auth needs is_verified_credentials: "
            "without it every token's call is gated on the local adapter's session and runs "
            "as its user. Pass create_auth_middleware(adapter, "
            "is_verified_credentials=is_verified_credentials), importing "
            "is_verified_credentials from afd.server"
        )
