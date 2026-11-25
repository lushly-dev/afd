"""Structured error types for :mod:`afd.auth`.

Mirrors ``packages/auth/src/errors.ts``.
"""

from __future__ import annotations

from typing import Literal

AuthErrorCode = Literal[
    "INVALID_CREDENTIALS",
    "TOKEN_EXPIRED",
    "PROVIDER_ERROR",
    "NETWORK_ERROR",
    "REFRESH_FAILED",
    "PASSKEY_CANCELLED",
    "PASSKEY_UNSUPPORTED",
]
"""Structured error codes raised by :class:`AuthAdapterError`."""

RETRYABLE_AUTH_ERROR_CODES: frozenset[AuthErrorCode] = frozenset(
    {"NETWORK_ERROR", "REFRESH_FAILED"}
)


class AuthAdapterError(Exception):
    """Structured authentication error with actionable suggestion and retryability."""

    code: AuthErrorCode
    message: str
    suggestion: str
    retryable: bool

    def __init__(
        self,
        *,
        code: AuthErrorCode,
        message: str,
        suggestion: str,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.suggestion = suggestion
        self.retryable = code in RETRYABLE_AUTH_ERROR_CODES

    @classmethod
    def invalid_credentials(cls) -> AuthAdapterError:
        """Invalid email or password."""
        return cls(
            code="INVALID_CREDENTIALS",
            message="Invalid email or password",
            suggestion="Check your credentials and try again",
        )

    @classmethod
    def token_expired(cls) -> AuthAdapterError:
        """Session or token has expired."""
        return cls(
            code="TOKEN_EXPIRED",
            message="Session has expired",
            suggestion="Sign in again to continue",
        )

    @classmethod
    def provider_error(cls, provider: str, details: str | None = None) -> AuthAdapterError:
        """Authentication provider returned an error."""
        message = (
            f"Authentication provider '{provider}' error: {details}"
            if details
            else f"Authentication provider '{provider}' encountered an error"
        )
        return cls(
            code="PROVIDER_ERROR",
            message=message,
            suggestion="Try again or use a different sign-in method",
        )

    @classmethod
    def network_error(cls) -> AuthAdapterError:
        """Network request to the auth provider failed (retryable)."""
        return cls(
            code="NETWORK_ERROR",
            message="Network request failed",
            suggestion="Check your connection and try again",
        )

    @classmethod
    def refresh_failed(cls) -> AuthAdapterError:
        """Refreshing the session failed (retryable)."""
        return cls(
            code="REFRESH_FAILED",
            message="Failed to refresh session",
            suggestion="Sign in again to continue",
        )


def passkey_cancelled() -> AuthAdapterError:
    """``PASSKEY_CANCELLED``: the passkey ceremony was dismissed or timed out."""
    return AuthAdapterError(
        code="PASSKEY_CANCELLED",
        message="The passkey request was cancelled",
        suggestion="Try again and choose a passkey, or use another sign-in method",
    )


def passkey_unsupported() -> AuthAdapterError:
    """``PASSKEY_UNSUPPORTED``: the environment or provider does not support passkeys."""
    return AuthAdapterError(
        code="PASSKEY_UNSUPPORTED",
        message="Passkeys are not available here",
        suggestion="Use a browser that supports passkeys, or another sign-in method",
    )
