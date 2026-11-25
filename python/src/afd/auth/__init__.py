"""Provider-agnostic application authentication for AFD.

Mirrors ``@lushly-dev/afd-auth`` for Python hosts:

- :class:`AuthAdapter` protocol and discriminated :data:`AuthSessionState` types
- :func:`create_auth_middleware` for gating commands behind a verified session
  (with :func:`afd.server.is_verified_credentials` awareness on token-authorized
  MCP servers)
- :func:`create_auth_commands`, :func:`create_auth_session_get_command`, and
  :func:`create_auth_mutation_commands` for ``auth-sign-in``, ``auth-sign-out``
  and ``auth-session-get``
- :class:`MockAuthAdapter` for deterministic tests and local development
"""

from __future__ import annotations

from afd.auth.commands import (
    DEFAULT_SIGN_IN_TIMEOUT_MS,
    create_auth_commands,
    create_auth_mutation_commands,
    create_auth_session_get_command,
)
from afd.auth.errors import (
    RETRYABLE_AUTH_ERROR_CODES,
    AuthAdapterError,
    AuthErrorCode,
    passkey_cancelled,
    passkey_unsupported,
)
from afd.auth.listeners import (
    ListenerErrorHandler,
    ListenerSet,
    report_listener_error,
)
from afd.auth.middleware import (
    AUTH_COMMAND_NAMES,
    VerifiedCredentialsCheck,
    create_auth_middleware,
    get_context_auth,
)
from afd.auth.mock import (
    SESSION_LIFETIME_MS,
    MockAuthAdapter,
    MockTriggerableErrorCode,
)
from afd.auth.session_state import (
    are_session_states_equal,
    are_users_equal,
    is_session_expired,
)
from afd.auth.types import (
    LOADING,
    UNAUTHENTICATED,
    AuthAdapter,
    AuthenticatedSessionState,
    AuthSessionState,
    AuthStateCallback,
    AuthSubscription,
    CredentialsSignInOptions,
    LoadingSessionState,
    OAuthSignInOptions,
    OrganizationAccess,
    OrganizationInvitation,
    OrganizationMember,
    PasskeyManagement,
    PasskeyRow,
    PasskeySignInOptions,
    PendingOutcome,
    Provider,
    RedirectOutcome,
    Session,
    SessionManagement,
    SessionRow,
    SignedInOutcome,
    SignInOptions,
    SignInOutcome,
    UnauthenticatedSessionState,
    User,
)

__all__ = [
    "AUTH_COMMAND_NAMES",
    "DEFAULT_SIGN_IN_TIMEOUT_MS",
    "LOADING",
    "RETRYABLE_AUTH_ERROR_CODES",
    "SESSION_LIFETIME_MS",
    "UNAUTHENTICATED",
    "AuthAdapter",
    "AuthAdapterError",
    "AuthErrorCode",
    "AuthSessionState",
    "AuthStateCallback",
    "AuthSubscription",
    "AuthenticatedSessionState",
    "CredentialsSignInOptions",
    "ListenerErrorHandler",
    "ListenerSet",
    "LoadingSessionState",
    "MockAuthAdapter",
    "MockTriggerableErrorCode",
    "OAuthSignInOptions",
    "OrganizationAccess",
    "OrganizationInvitation",
    "OrganizationMember",
    "PasskeyManagement",
    "PasskeyRow",
    "PasskeySignInOptions",
    "PendingOutcome",
    "Provider",
    "RedirectOutcome",
    "Session",
    "SessionManagement",
    "SessionRow",
    "SignInOptions",
    "SignInOutcome",
    "SignedInOutcome",
    "UnauthenticatedSessionState",
    "User",
    "VerifiedCredentialsCheck",
    "are_session_states_equal",
    "are_users_equal",
    "create_auth_commands",
    "create_auth_middleware",
    "create_auth_mutation_commands",
    "create_auth_session_get_command",
    "get_context_auth",
    "is_session_expired",
    "passkey_cancelled",
    "passkey_unsupported",
    "report_listener_error",
]
