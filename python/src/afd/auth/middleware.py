"""Auth middleware for gating AFD commands behind authentication.

Mirrors ``packages/auth/src/middleware.ts``.
"""

from __future__ import annotations

import dataclasses
import time
from collections.abc import Callable, Mapping, Sequence
from types import MappingProxyType
from typing import Any

from afd.auth.session_state import is_session_expired
from afd.auth.types import AuthAdapter, AuthenticatedSessionState
from afd.core.actor import Actor, is_actor
from afd.core.clock import Clock
from afd.core.commands import CommandContext, CommandMiddleware, NextFn
from afd.core.result import CommandResult, error

AUTH_COMMAND_NAMES: tuple[str, ...] = (
    "auth-sign-in",
    "auth-sign-out",
    "auth-session-get",
)
"""Built-in auth commands that always bypass session gating."""

_SESSION_COMMANDS: frozenset[str] = frozenset(AUTH_COMMAND_NAMES)

# Matches afd.server.auth_middleware_check._AUTH_MIDDLEWARE_CREDENTIALS_ATTR so
# afd.auth does not need to import afd.server (and its optional MCP SDK extra).
_AUTH_MIDDLEWARE_CREDENTIALS_ATTR = "_afd_auth_middleware_credentials"

# Finite epoch-ms sentinel matching JS Number.MIN_SAFE_INTEGER. Used to probe
# whether a branded Credentials object expired before ``now``, since
# afd.server.is_verified_credentials rejects non-finite ``now_ms``.
_MIN_SAFE_INTEGER = -9_007_199_254_740_991

VerifiedCredentialsCheck = Callable[[Any, float], bool]
"""Predicate recognizing verified server credentials (``afd.server.is_verified_credentials``)."""


def get_context_auth(context: Any) -> AuthenticatedSessionState | None:
    """Read the verified session placed on ``context`` by :func:`create_auth_middleware`."""
    if context is None:
        return None
    extra = getattr(context, "extra", None)
    if isinstance(extra, Mapping):
        state = extra.get("auth")
        if isinstance(state, AuthenticatedSessionState):
            return state
    direct = getattr(context, "auth", None)
    if isinstance(direct, AuthenticatedSessionState):
        return direct
    return None


def _set_context_auth(context: Any, state: AuthenticatedSessionState) -> None:
    extra = getattr(context, "extra", None)
    if isinstance(extra, Mapping):
        # Copy the mapping so callers reusing a mapping are not mutated across calls.
        updated = dict(extra)
        updated["auth"] = state
        context.extra = updated
    if hasattr(context, "auth"):
        context.auth = state


def _clear_context_auth(context: Any) -> None:
    extra = getattr(context, "extra", None)
    if isinstance(extra, Mapping) and "auth" in extra:
        updated = dict(extra)
        updated.pop("auth", None)
        context.extra = updated
    if hasattr(context, "auth"):
        try:
            delattr(context, "auth")
        except AttributeError:
            context.auth = None


def _actor_for_session(actor: Any, session: AuthenticatedSessionState) -> Actor:
    """Derive the verified actor for a session-authenticated call.

    An unset, invalid, or ``human`` actor becomes the session user (``id`` and
    optional ``label``). An ``agent``, ``service``, ``script`` or ``test`` actor
    keeps its identity and has ``on_behalf_of`` set to ``user.id`` (replacing
    any caller-supplied value).
    """
    user = session.user
    if not isinstance(actor, Actor) or not is_actor(actor) or actor.kind == "human":
        return Actor(
            kind="human",
            id=user.id,
            label=user.name if user.name else None,
        )
    return dataclasses.replace(actor, on_behalf_of=user.id)


def create_auth_middleware(
    adapter: AuthAdapter,
    *,
    exclude: Sequence[str] | None = None,
    is_verified_credentials: VerifiedCredentialsCheck | None = None,
    clock: Clock | None = None,
) -> CommandMiddleware:
    """Create middleware that gates commands behind authentication.

    - Unauthenticated -> ``UNAUTHORIZED`` (non-retryable)
    - Loading -> ``UNAUTHORIZED`` (retryable)
    - Authenticated but expired -> ``TOKEN_EXPIRED`` (retryable)
    - Authenticated -> sets ``context.extra["auth"]``, updates ``context.actor``,
      and calls ``next_fn()``

    Excluded commands and the built-in auth commands always run and only see
    ``context.extra["auth"]`` when the adapter holds an unexpired session. Caller-
    supplied ``auth`` values are always stripped or overwritten.

    On a server configured with MCP bearer-token ``auth``, pass
    ``is_verified_credentials=afd.server.is_verified_credentials`` so token-backed
    calls keep their verified actor, bypass local session gating, fail closed with
    ``TOKEN_EXPIRED`` if the token expired, and are refused on session commands
    (``auth-sign-in``, ``auth-sign-out``, ``auth-session-get``) with ``UNAUTHORIZED``.
    """
    if is_verified_credentials is not None and not callable(is_verified_credentials):
        raise TypeError("is_verified_credentials must be callable")

    excluded: frozenset[str] = frozenset((*AUTH_COMMAND_NAMES, *(exclude or ())))

    async def middleware(
        command_name: str,
        input: Any,
        context: CommandContext,
        next_fn: NextFn,
    ) -> CommandResult[Any]:
        now = clock.now() if clock is not None else time.time() * 1000.0
        credentials = getattr(context, "credentials", None)
        if credentials is not None and is_verified_credentials is not None:
            if is_verified_credentials(credentials, now) is True:
                # The token is the caller: no session decides this call or names its actor.
                _clear_context_auth(context)
                if command_name in _SESSION_COMMANDS:
                    return error(
                        "UNAUTHORIZED",
                        "Not available to a token",
                        suggestion=(
                            "This call is authorized by a token; session commands "
                            "need a signed-in session"
                        ),
                        retryable=False,
                    )
                return await next_fn()
            # Branded by afd.server with a finite expiry, but expired by ``now``:
            # fail closed and never fall through to the local adapter's session.
            if is_verified_credentials(credentials, _MIN_SAFE_INTEGER) is True:
                _clear_context_auth(context)
                return error(
                    "TOKEN_EXPIRED",
                    "Access token has expired",
                    suggestion="Obtain a fresh access token and try again",
                    retryable=True,
                )

        state = adapter.get_session()
        verified: AuthenticatedSessionState | None = (
            state
            if state.status == "authenticated" and not is_session_expired(state.session, now)
            else None
        )

        # Overwrite or strip whatever the caller placed on the context.
        if verified is not None:
            _set_context_auth(context, verified)
            context.actor = _actor_for_session(getattr(context, "actor", None), verified)
        else:
            _clear_context_auth(context)

        if command_name in excluded or verified is not None:
            return await next_fn()

        if state.status == "loading":
            return error(
                "UNAUTHORIZED",
                "Authentication state is loading",
                suggestion="Wait for authentication to complete and try again",
                retryable=True,
            )

        if state.status == "authenticated":
            return error(
                "TOKEN_EXPIRED",
                "Session has expired",
                suggestion=(
                    "Try again once the auth provider has refreshed the session, "
                    "or sign in again with auth-sign-in"
                ),
                retryable=True,
            )

        return error(
            "UNAUTHORIZED",
            "Authentication required",
            suggestion="Sign in with auth-sign-in to access this command",
            retryable=False,
        )

    setattr(
        middleware,
        _AUTH_MIDDLEWARE_CREDENTIALS_ATTR,
        MappingProxyType({"recognises_verified_credentials": is_verified_credentials is not None}),
    )
    return middleware
