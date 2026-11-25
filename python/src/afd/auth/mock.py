"""In-memory mock auth adapter for testing.

Mirrors ``packages/auth/src/adapters/mock.ts``.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Mapping
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from afd.auth.errors import AuthAdapterError, passkey_unsupported
from afd.auth.listeners import ListenerErrorHandler, ListenerSet
from afd.auth.session_state import is_session_expired
from afd.auth.types import (
    LOADING,
    UNAUTHENTICATED,
    AuthenticatedSessionState,
    AuthSessionState,
    AuthStateCallback,
    AuthSubscription,
    OrganizationAccess,
    PasskeyManagement,
    Session,
    SessionManagement,
    SignedInOutcome,
    SignInOptions,
    SignInOutcome,
    User,
)
from afd.core.clock import Clock, system_clock

SESSION_LIFETIME_MS = 3_600_000
_EPOCH_UTC = datetime(1970, 1, 1, tzinfo=UTC)

MockTriggerableErrorCode = Literal[
    "INVALID_CREDENTIALS",
    "TOKEN_EXPIRED",
    "PROVIDER_ERROR",
    "NETWORK_ERROR",
    "REFRESH_FAILED",
]


def _epoch_ms_to_utc(ms: float) -> datetime:
    return _EPOCH_UTC + timedelta(milliseconds=ms)


class MockAuthAdapter:
    """In-memory :class:`~afd.auth.types.AuthAdapter` for tests and local development."""

    sessions: SessionManagement | None = None
    passkeys: PasskeyManagement | None = None
    organization: OrganizationAccess | None = None
    _passkey_user: Callable[[], User] | None = None

    def __init__(
        self,
        *,
        delay_ms: float = 0,
        on_listener_error: ListenerErrorHandler | None = None,
        clock: Clock | None = None,
    ) -> None:
        self._state: AuthSessionState = UNAUTHENTICATED
        self._delay_ms = delay_ms
        self.clock: Clock = clock if clock is not None else system_clock
        self._listeners: ListenerSet[AuthSessionState] = ListenerSet(on_listener_error)

    async def sign_in(self, options: SignInOptions) -> SignInOutcome:
        """Sign in using credentials, OAuth, or (if configured) passkey."""
        if self._delay_ms > 0:
            await asyncio.sleep(self._delay_ms / 1000.0)

        if options.method == "passkey":
            if self._passkey_user is None:
                raise passkey_unsupported()
            self._start_session(self._passkey_user())
            return SignedInOutcome()

        email = options.email if options.method == "credentials" else f"user@{options.provider}.com"
        # Derive id from email so the same person is stable across replays.
        name = email.split("@", 1)[0]
        self._start_session(User(id=f"mock-user-{email}", email=email, name=name))
        return SignedInOutcome()

    async def refresh(self) -> None:
        """Sign out a session whose ``expires_at`` has passed on ``self.clock``."""
        state = self._state
        if state.status == "authenticated" and is_session_expired(state.session, self.clock.now()):
            self._set_state(UNAUTHENTICATED)

    async def sign_out(self) -> None:
        """Clear the current session and notify listeners."""
        if self._delay_ms > 0:
            await asyncio.sleep(self._delay_ms / 1000.0)
        self._set_state(UNAUTHENTICATED)

    def get_session(self) -> AuthSessionState:
        """Return the current session state."""
        return self._state

    def on_auth_state_change(self, callback: AuthStateCallback) -> AuthSubscription:
        """Subscribe to session state changes."""
        return self._listeners.add(callback)

    # ═══════════════════════════════════════════════════════════════════════════
    # TEST HELPERS
    # ═══════════════════════════════════════════════════════════════════════════

    def _reset(self) -> None:
        """Reset state to :data:`UNAUTHENTICATED`."""
        self._set_state(UNAUTHENTICATED)

    def _set_user(
        self,
        user: User,
        session: Session | Mapping[str, Any] | None = None,
    ) -> None:
        """Sign in as ``user`` with optional session field overrides.

        Pass ``session={"expires_at": None}`` for a session without expiry, or
        ``session={"expires_at": datetime(1970, 1, 1, tzinfo=UTC)}`` for an
        expired session.
        """
        self._start_session(user, session)

    def _set_loading(self) -> None:
        """Transition state to :data:`LOADING`."""
        self._set_state(LOADING)

    def _trigger_error(self, code: MockTriggerableErrorCode) -> AuthAdapterError:
        """Build a structured :class:`AuthAdapterError` for test scenarios."""
        factories: dict[str, Callable[[], AuthAdapterError]] = {
            "INVALID_CREDENTIALS": AuthAdapterError.invalid_credentials,
            "TOKEN_EXPIRED": AuthAdapterError.token_expired,
            "PROVIDER_ERROR": lambda: AuthAdapterError.provider_error("mock"),
            "NETWORK_ERROR": AuthAdapterError.network_error,
            "REFRESH_FAILED": AuthAdapterError.refresh_failed,
        }
        factory = factories.get(code)
        if factory is None:
            raise ValueError(f"Unknown error code: {code}")
        return factory()

    def _get_listener_count(self) -> int:
        """Number of active ``on_auth_state_change`` subscribers."""
        return self._listeners.size

    def _start_session(
        self,
        user: User,
        session: Session | Mapping[str, Any] | None = None,
    ) -> None:
        now = self.clock.now()
        default_id = f"mock-session-{int(now)}"
        default_expires_at = _epoch_ms_to_utc(now + SESSION_LIFETIME_MS)

        if isinstance(session, Session):
            resolved = session
        elif isinstance(session, Mapping):
            session_id = str(session.get("id", default_id))
            if "expires_at" in session:
                expires_at = session["expires_at"]
            elif "expiresAt" in session:
                expires_at = session["expiresAt"]
            else:
                expires_at = default_expires_at
            resolved = Session(id=session_id, expires_at=expires_at)
        else:
            resolved = Session(id=default_id, expires_at=default_expires_at)

        self._set_state(
            AuthenticatedSessionState(
                status="authenticated",
                session=resolved,
                user=user,
            )
        )

    def _set_state(self, state: AuthSessionState) -> None:
        self._state = state
        self._listeners.emit(state)
