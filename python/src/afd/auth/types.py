"""Core auth types for AFD's provider-agnostic authentication adapter.

Mirrors ``packages/auth/src/types.ts`` with frozen wire models and a
discriminated union for :data:`AuthSessionState` so callers check ``status``
before reading ``session`` or ``user``.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any, Literal, Protocol, runtime_checkable

from pydantic import (
    ConfigDict,
    SerializationInfo,
    SerializerFunctionWrapHandler,
    field_validator,
    model_serializer,
)

from afd.core.wire import WIRE_MODEL_CONFIG, WireModel

_FROZEN_WIRE_CONFIG = ConfigDict(**WIRE_MODEL_CONFIG, frozen=True)


def _normalize_utc_datetime(value: datetime | None) -> datetime | None:
    """Normalize naive/semi-naive ``datetime`` values to UTC so wire output always carries ``Z``."""
    if value is None:
        return None
    if value.tzinfo is None or value.tzinfo.utcoffset(value) is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


# ═══════════════════════════════════════════════════════════════════════════════
# SESSION & USER
# ═══════════════════════════════════════════════════════════════════════════════


class Session(WireModel):
    """An authenticated session held by an :class:`AuthAdapter`."""

    model_config = _FROZEN_WIRE_CONFIG

    id: str
    expires_at: datetime | None = None

    @field_validator("expires_at", mode="after")
    @classmethod
    def _ensure_utc_expires_at(cls, value: datetime | None) -> datetime | None:
        return _normalize_utc_datetime(value)


class User(WireModel):
    """The signed-in user associated with an authenticated session."""

    model_config = _FROZEN_WIRE_CONFIG

    id: str
    email: str
    name: str | None = None
    image: str | None = None


# ═══════════════════════════════════════════════════════════════════════════════
# PROVIDER & SIGN-IN OPTIONS
# ═══════════════════════════════════════════════════════════════════════════════

Provider = str
"""Authentication provider identifier (e.g. ``"github"``, ``"google"``, ``"email"``)."""


class CredentialsSignInOptions(WireModel):
    """Sign in with email and optional password."""

    model_config = _FROZEN_WIRE_CONFIG

    method: Literal["credentials"] = "credentials"
    email: str
    password: str | None = None


class OAuthSignInOptions(WireModel):
    """Sign in through an OAuth provider."""

    model_config = _FROZEN_WIRE_CONFIG

    method: Literal["oauth"] = "oauth"
    provider: Provider
    scopes: list[str] | None = None
    redirect_to: str | None = None


class PasskeySignInOptions(WireModel):
    """Sign in with a passkey (WebAuthn). Adapters without passkeys reject it."""

    model_config = _FROZEN_WIRE_CONFIG

    method: Literal["passkey"] = "passkey"
    auto_fill: bool | None = None


SignInOptions = CredentialsSignInOptions | OAuthSignInOptions | PasskeySignInOptions
"""Options accepted by :meth:`AuthAdapter.sign_in`."""


class SignedInOutcome(WireModel):
    """The provider accepted sign-in; the session may arrive via state change."""

    model_config = _FROZEN_WIRE_CONFIG

    kind: Literal["signed-in"] = "signed-in"


class RedirectOutcome(WireModel):
    """Sign-in continues at an external provider URL before a session exists."""

    model_config = _FROZEN_WIRE_CONFIG

    kind: Literal["redirect"] = "redirect"
    url: str | None = None


class PendingOutcome(WireModel):
    """Sign-in requires another verification step before a session exists."""

    model_config = _FROZEN_WIRE_CONFIG

    kind: Literal["pending"] = "pending"


SignInOutcome = SignedInOutcome | RedirectOutcome | PendingOutcome
"""What an adapter knows about a sign-in when :meth:`AuthAdapter.sign_in` resolves."""


# ═══════════════════════════════════════════════════════════════════════════════
# AUTH SESSION STATE (Discriminated Union)
# ═══════════════════════════════════════════════════════════════════════════════


def _keep_null_session_and_user(
    model: UnauthenticatedSessionState | LoadingSessionState,
    handler: SerializerFunctionWrapHandler,
    info: SerializationInfo,
) -> Any:
    """Keep explicit ``session: null`` and ``user: null`` on wire output."""
    dumped = handler(model)
    if info.exclude_none and isinstance(dumped, dict):
        return {
            "status": dumped.get("status", model.status),
            "session": None,
            "user": None,
        }
    return dumped


class UnauthenticatedSessionState(WireModel):
    """Session state when no user is signed in."""

    model_config = _FROZEN_WIRE_CONFIG

    status: Literal["unauthenticated"] = "unauthenticated"
    session: None = None
    user: None = None

    @model_serializer(mode="wrap")
    def _serialize(self, handler: SerializerFunctionWrapHandler, info: SerializationInfo) -> Any:
        return _keep_null_session_and_user(self, handler, info)


class LoadingSessionState(WireModel):
    """Session state while the adapter is resolving authentication state."""

    model_config = _FROZEN_WIRE_CONFIG

    status: Literal["loading"] = "loading"
    session: None = None
    user: None = None

    @model_serializer(mode="wrap")
    def _serialize(self, handler: SerializerFunctionWrapHandler, info: SerializationInfo) -> Any:
        return _keep_null_session_and_user(self, handler, info)


class AuthenticatedSessionState(WireModel):
    """Session state when a user is signed in."""

    model_config = _FROZEN_WIRE_CONFIG

    status: Literal["authenticated"] = "authenticated"
    session: Session
    user: User


AuthSessionState = UnauthenticatedSessionState | LoadingSessionState | AuthenticatedSessionState
"""Discriminated union representing the current authentication state."""

UNAUTHENTICATED: UnauthenticatedSessionState = UnauthenticatedSessionState()
"""Immutable singleton for the unauthenticated state."""

LOADING: LoadingSessionState = LoadingSessionState()
"""Immutable singleton for the loading state."""


# ═══════════════════════════════════════════════════════════════════════════════
# SUBSCRIPTION & CAPABILITY PROTOCOLS
# ═══════════════════════════════════════════════════════════════════════════════


@runtime_checkable
class AuthSubscription(Protocol):
    """Handle returned by :meth:`AuthAdapter.on_auth_state_change`."""

    def unsubscribe(self) -> None:
        """Stop receiving auth state change notifications."""
        ...


AuthStateCallback = Callable[[AuthSessionState], None]
"""Subscriber invoked whenever an adapter's session state changes."""


class SessionRow(WireModel):
    """One active session shown to the signed-in user (no token or IP)."""

    model_config = _FROZEN_WIRE_CONFIG

    handle: str
    current: bool
    created_at: datetime
    updated_at: datetime
    expires_at: datetime | None = None
    device: str | None = None

    @field_validator("created_at", "updated_at", "expires_at", mode="after")
    @classmethod
    def _ensure_utc_timestamps(cls, value: datetime | None) -> datetime | None:
        return _normalize_utc_datetime(value)


@runtime_checkable
class SessionManagement(Protocol):
    """Optional capability for listing and revoking active sessions."""

    def list_sessions(self) -> Awaitable[list[SessionRow]]: ...

    def revoke_session(self, target: str) -> Awaitable[None]: ...


class PasskeyRow(WireModel):
    """One registered passkey (no public key or credential ID)."""

    model_config = _FROZEN_WIRE_CONFIG

    id: str
    name: str | None = None
    created_at: datetime
    device_type: Literal["singleDevice", "multiDevice"] | None = None
    backed_up: bool | None = None

    @field_validator("created_at", mode="after")
    @classmethod
    def _ensure_utc_created_at(cls, value: datetime) -> datetime:
        normalized = _normalize_utc_datetime(value)
        assert normalized is not None
        return normalized


@runtime_checkable
class PasskeyManagement(Protocol):
    """Optional capability for managing registered passkeys."""

    def list_passkeys(self) -> Awaitable[list[PasskeyRow]]: ...

    def add_passkey(self, *, name: str | None = None) -> Awaitable[PasskeyRow]: ...

    def rename_passkey(self, passkey_id: str, name: str) -> Awaitable[None]: ...

    def remove_passkey(self, passkey_id: str) -> Awaitable[None]: ...


class OrganizationMember(WireModel):
    """A member of an organization."""

    model_config = _FROZEN_WIRE_CONFIG

    id: str
    user_id: str
    role: str
    created_at: datetime
    user: User

    @field_validator("created_at", mode="after")
    @classmethod
    def _ensure_utc_created_at(cls, value: datetime) -> datetime:
        normalized = _normalize_utc_datetime(value)
        assert normalized is not None
        return normalized


class OrganizationInvitation(WireModel):
    """An invitation to join an organization."""

    model_config = _FROZEN_WIRE_CONFIG

    id: str
    organization_id: str
    email: str
    role: str
    status: Literal["pending", "accepted", "rejected", "canceled"]
    expires_at: datetime

    @field_validator("expires_at", mode="after")
    @classmethod
    def _ensure_utc_expires_at(cls, value: datetime) -> datetime:
        normalized = _normalize_utc_datetime(value)
        assert normalized is not None
        return normalized


@runtime_checkable
class OrganizationAccess(Protocol):
    """Optional capability for organization membership and invitations."""

    def membership(self, organization_id: str) -> Awaitable[dict[str, str] | None]: ...

    def list_members(
        self,
        organization_id: str,
        *,
        limit: int | None = None,
        offset: int | None = None,
    ) -> Awaitable[list[OrganizationMember]]: ...

    def invite(
        self,
        organization_id: str,
        *,
        email: str,
        role: str,
    ) -> Awaitable[OrganizationInvitation]: ...

    def list_invitations(self, organization_id: str) -> Awaitable[list[OrganizationInvitation]]: ...

    def cancel_invitation(self, organization_id: str, invitation_id: str) -> Awaitable[None]: ...

    def remove_member(self, organization_id: str, member_id: str) -> Awaitable[None]: ...

    def set_role(self, organization_id: str, member_id: str, role: str) -> Awaitable[None]: ...

    def leave(self, organization_id: str) -> Awaitable[None]: ...

    def list_own_invitations(self) -> Awaitable[list[OrganizationInvitation]]: ...

    def accept_invitation(self, invitation_id: str) -> Awaitable[None]: ...

    def reject_invitation(self, invitation_id: str) -> Awaitable[None]: ...


# ═══════════════════════════════════════════════════════════════════════════════
# AUTH ADAPTER PROTOCOL
# ═══════════════════════════════════════════════════════════════════════════════


@runtime_checkable
class AuthAdapter(Protocol):
    """Provider-agnostic authentication adapter contract.

    Adapters may also expose an optional async ``refresh()`` method and
    optional ``sessions``, ``passkeys`` and ``organization`` capabilities.
    """

    def sign_in(self, options: SignInOptions) -> Awaitable[SignInOutcome | None]:
        """Start a sign-in flow and resolve with a :data:`SignInOutcome` or ``None``."""
        ...

    def sign_out(self) -> Awaitable[None]:
        """Sign out of the current session."""
        ...

    def get_session(self) -> AuthSessionState:
        """Return the current authentication session state synchronously."""
        ...

    def on_auth_state_change(self, callback: AuthStateCallback) -> AuthSubscription:
        """Subscribe to session state transitions."""
        ...
