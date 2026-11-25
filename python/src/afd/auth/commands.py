"""AFD command definitions for authentication operations.

Mirrors ``packages/auth/src/commands.ts``, ``session-get-command.ts``, and
``mutation-commands.ts``.
"""

from __future__ import annotations

import asyncio
import contextlib
import copy
import math
from collections.abc import Mapping
from typing import Any

from afd.auth.errors import AuthAdapterError
from afd.auth.session_state import are_session_states_equal
from afd.auth.types import (
    AuthAdapter,
    AuthSessionState,
    CredentialsSignInOptions,
    OAuthSignInOptions,
    PasskeySignInOptions,
    PendingOutcome,
    RedirectOutcome,
    SignedInOutcome,
    SignInOptions,
    SignInOutcome,
)
from afd.core.commands import CommandContext, CommandDefinition, ExposeOptions
from afd.core.metadata import Warning as ResultWarning
from afd.core.metadata import WarningSeverity
from afd.core.result import CommandResult, error, success
from afd.core.schema_validation import (
    SchemaValidationError,
    schema_validation_failure,
    validate_schema,
)

DEFAULT_SIGN_IN_TIMEOUT_MS = 10_000
_SESSION_GET_SUGGESTION = "Call auth-session-get to check whether the session is active"

_EMAIL_PATTERN = (
    r"^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]"
    r"@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$"
)

_EMPTY_OBJECT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {},
}

_SIGN_IN_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "oneOf": [
        {
            "type": "object",
            "properties": {
                "method": {"type": "string", "const": "credentials"},
                "email": {
                    "type": "string",
                    "format": "email",
                    "pattern": _EMAIL_PATTERN,
                },
                "password": {"type": "string"},
            },
            "required": ["method", "email"],
        },
        {
            "type": "object",
            "properties": {
                "method": {"type": "string", "const": "oauth"},
                "provider": {"type": "string"},
                "scopes": {"type": "array", "items": {"type": "string"}},
                "redirectTo": {"type": "string"},
            },
            "required": ["method", "provider"],
        },
        {
            "type": "object",
            "properties": {
                "method": {"type": "string", "const": "passkey"},
                "autoFill": {"type": "boolean"},
            },
            "required": ["method"],
        },
    ],
}


def _auth_error_result(auth_error: AuthAdapterError) -> CommandResult[Any]:
    return error(
        auth_error.code,
        auth_error.message,
        suggestion=auth_error.suggestion,
        retryable=auth_error.retryable,
    )


def _parse_sign_in_input(raw_input: Any) -> SignInOptions:
    """Validate wire-format JSON input (camelCase keys: ``redirectTo``, ``autoFill``)."""
    payload: Any = {} if raw_input is None else raw_input
    validated = validate_schema(_SIGN_IN_JSON_SCHEMA, payload)
    method = validated["method"]
    if method == "credentials":
        return CredentialsSignInOptions.model_validate(validated)
    if method == "oauth":
        return OAuthSignInOptions.model_validate(validated)
    return PasskeySignInOptions.model_validate(validated)


def _describe_method(options: SignInOptions) -> str:
    if options.method == "oauth":
        return options.provider
    if options.method == "passkey":
        return "passkey"
    return "credentials"


def _to_outcome(value: Any) -> SignInOutcome | None:
    """Interpret an adapter's ``sign_in()`` return value.

    Adapters returning ``None`` (or arbitrary provider payloads) are treated as
    having no explicit incomplete outcome, matching TypeScript's ``toOutcome``.
    """
    if isinstance(value, (SignedInOutcome, RedirectOutcome, PendingOutcome)):
        return value
    if not isinstance(value, Mapping):
        return None
    kind = value.get("kind")
    if kind == "signed-in":
        return SignedInOutcome()
    if kind == "pending":
        return PendingOutcome()
    if kind == "redirect":
        url = value.get("url")
        return RedirectOutcome(url=url if isinstance(url, str) else None)
    return None


def _incomplete_sign_in(
    state: AuthSessionState,
    options: SignInOptions,
    outcome: RedirectOutcome | PendingOutcome,
) -> CommandResult[AuthSessionState]:
    via = _describe_method(options)
    if isinstance(outcome, RedirectOutcome):
        warning = ResultWarning(
            code="SIGN_IN_REDIRECT",
            message=f"Sign-in via {via} continues at the provider",
            severity=WarningSeverity.INFO,
            details={"url": outcome.url} if outcome.url is not None else None,
        )
        return success(
            state,
            reasoning=(
                f"Not signed in yet: sign-in via {via} continues at the provider, "
                "and the session starts after the provider redirects back"
            ),
            warnings=[warning],
            suggestions=[
                "Complete sign-in at the provider",
                "After the provider redirects back, call auth-session-get to confirm the session",
            ],
        )

    warning = ResultWarning(
        code="SIGN_IN_PENDING",
        message=f"Sign-in via {via} needs another step before a session exists",
        severity=WarningSeverity.WARNING,
    )
    return success(
        state,
        reasoning=(
            f"Not signed in yet: sign-in via {via} needs another step, "
            "such as email verification, before a session exists"
        ),
        warnings=[warning],
        suggestions=[
            "Complete the provider's verification step",
            _SESSION_GET_SUGGESTION,
        ],
    )


def _settled_sign_in(
    current: AuthSessionState,
    settled: AuthSessionState | None,
    options: SignInOptions,
    timeout_ms: float,
) -> CommandResult[AuthSessionState]:
    via = _describe_method(options)
    state = settled if settled is not None else current

    if state.status == "authenticated":
        return success(
            state,
            reasoning=f"Signed in via {via} as {state.user.email}",
        )

    if settled is not None and settled.status == "unauthenticated":
        return error(
            "PROVIDER_ERROR",
            f"Sign-in via {via} completed, but the provider reports no active session",
            suggestion=(
                "Check that the provider can store its session (cookies or tokens) "
                "in this environment, then sign in again"
            ),
            retryable=False,
        )

    timeout_label = str(int(timeout_ms)) if float(timeout_ms).is_integer() else str(timeout_ms)
    return success(
        current,
        reasoning=(
            f"Not signed in yet: the sign-in via {via} was accepted, but no session "
            f"was confirmed within {timeout_label} ms (status: {current.status})"
        ),
        warnings=[
            ResultWarning(
                code="SIGN_IN_PENDING",
                message=f"No session confirmed within {timeout_label} ms of sign-in",
                severity=WarningSeverity.WARNING,
            )
        ],
        suggestions=[_SESSION_GET_SUGGESTION],
    )


class _AuthStateWatcher:
    """Watches ``adapter.on_auth_state_change`` across a sign-in attempt."""

    def __init__(self, adapter: AuthAdapter) -> None:
        self._adapter = adapter
        self._changed = False
        self._waiter: asyncio.Future[AuthSessionState] | None = None
        self._subscription = adapter.on_auth_state_change(self._on_change)

    def _on_change(self, state: AuthSessionState) -> None:
        self._changed = True
        if state.status == "loading":
            return
        waiter = self._waiter
        if waiter is None or waiter.done():
            return
        self._waiter = None
        loop = waiter.get_loop()
        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            running = None
        if running is loop:
            if not waiter.done():
                waiter.set_result(state)
        elif not loop.is_closed():
            with contextlib.suppress(RuntimeError):
                loop.call_soon_threadsafe(self._resolve_waiter, waiter, state)

    @staticmethod
    def _resolve_waiter(
        waiter: asyncio.Future[AuthSessionState],
        state: AuthSessionState,
    ) -> None:
        if not waiter.done():
            waiter.set_result(state)

    async def settle(
        self,
        before: AuthSessionState,
        timeout_ms: float,
    ) -> AuthSessionState | None:
        current = self._adapter.get_session()
        if current.status == "authenticated" and (
            self._changed or not are_session_states_equal(before, current)
        ):
            return current

        loop = asyncio.get_running_loop()
        waiter: asyncio.Future[AuthSessionState] = loop.create_future()
        self._waiter = waiter
        # Re-check after arming so a background-thread emission in the narrow
        # window between the first get_session() and assigning self._waiter
        # is never missed.
        rechecked = self._adapter.get_session()
        if rechecked.status == "authenticated" and (
            self._changed or not are_session_states_equal(before, rechecked)
        ):
            self._waiter = None
            return rechecked
        try:
            return await asyncio.wait_for(waiter, timeout=timeout_ms / 1000.0)
        except TimeoutError:
            return None
        finally:
            if self._waiter is waiter:
                self._waiter = None

    def stop(self) -> None:
        self._waiter = None
        self._subscription.unsubscribe()


def create_auth_session_get_command(adapter: AuthAdapter) -> CommandDefinition:
    """Create the ``auth-session-get`` read command."""

    async def handler(
        raw_input: Any,
        context: CommandContext | None = None,
    ) -> CommandResult[AuthSessionState]:
        try:
            validate_schema(_EMPTY_OBJECT_SCHEMA, {} if raw_input is None else raw_input)
        except SchemaValidationError as exc:
            return schema_validation_failure(exc)

        session = adapter.get_session()
        return success(
            session,
            reasoning=f"Current auth status: {session.status}",
        )

    return CommandDefinition(
        name="auth-session-get",
        description="Get the current authentication session state",
        handler=handler,
        category="auth",
        tags=["auth", "session"],
        mutation=False,
        expose=ExposeOptions(palette=True, agent=True, cli=True, mcp=True),
        input_schema=copy.deepcopy(_EMPTY_OBJECT_SCHEMA),
    )


def create_auth_mutation_commands(
    adapter: AuthAdapter,
    *,
    sign_in_timeout_ms: float = DEFAULT_SIGN_IN_TIMEOUT_MS,
) -> list[CommandDefinition]:
    """Create ``auth-sign-in`` and ``auth-sign-out`` commands.

    ``auth-sign-in`` validates JSON wire payloads (camelCase keys such as
    ``redirectTo`` and ``autoFill``) matching ``@lushly-dev/afd-auth``.
    """
    if (
        isinstance(sign_in_timeout_ms, bool)
        or not isinstance(sign_in_timeout_ms, (int, float))
        or not math.isfinite(sign_in_timeout_ms)
        or sign_in_timeout_ms < 0
    ):
        raise ValueError("sign_in_timeout_ms must be a non-negative finite number")

    async def sign_in_handler(
        raw_input: Any,
        context: CommandContext | None = None,
    ) -> CommandResult[AuthSessionState]:
        try:
            parsed = _parse_sign_in_input(raw_input)
        except SchemaValidationError as exc:
            return schema_validation_failure(exc)

        before = adapter.get_session()
        watcher = _AuthStateWatcher(adapter)
        try:
            outcome = _to_outcome(await adapter.sign_in(parsed))
            if isinstance(outcome, (RedirectOutcome, PendingOutcome)):
                return _incomplete_sign_in(adapter.get_session(), parsed, outcome)
            settled = await watcher.settle(before, sign_in_timeout_ms)
            return _settled_sign_in(adapter.get_session(), settled, parsed, sign_in_timeout_ms)
        except AuthAdapterError as exc:
            return _auth_error_result(exc)
        finally:
            watcher.stop()

    async def sign_out_handler(
        raw_input: Any,
        context: CommandContext | None = None,
    ) -> CommandResult[None]:
        try:
            validate_schema(_EMPTY_OBJECT_SCHEMA, {} if raw_input is None else raw_input)
        except SchemaValidationError as exc:
            return schema_validation_failure(exc)

        try:
            await adapter.sign_out()
            return success(None, reasoning="Successfully signed out")
        except AuthAdapterError as exc:
            return _auth_error_result(exc)

    sign_in = CommandDefinition(
        name="auth-sign-in",
        description=(
            "Sign in with credentials, an OAuth provider or a passkey. Returns the new session, "
            "or the current state with a warning when sign-in continues at the provider (redirect) "
            "or has not completed yet."
        ),
        handler=sign_in_handler,
        category="auth",
        tags=["auth", "session"],
        mutation=True,
        # It takes a password: no journal records it without a `redact` that removes it.
        secret=True,
        expose=ExposeOptions(palette=True, agent=True, cli=True, mcp=False),
        input_schema=copy.deepcopy(_SIGN_IN_JSON_SCHEMA),
    )

    sign_out = CommandDefinition(
        name="auth-sign-out",
        description="Sign out of the current session",
        handler=sign_out_handler,
        category="auth",
        tags=["auth", "session"],
        mutation=True,
        destructive=True,
        confirm_prompt="Sign out of your account?",
        expose=ExposeOptions(palette=True, agent=True, cli=True, mcp=False),
        input_schema=copy.deepcopy(_EMPTY_OBJECT_SCHEMA),
    )

    return [sign_in, sign_out]


def create_auth_commands(
    adapter: AuthAdapter,
    *,
    sign_in_timeout_ms: float = DEFAULT_SIGN_IN_TIMEOUT_MS,
) -> list[CommandDefinition]:
    """Create the full built-in auth command suite (``auth-sign-in``, ``auth-sign-out``, ``auth-session-get``)."""
    return [
        *create_auth_mutation_commands(adapter, sign_in_timeout_ms=sign_in_timeout_ms),
        create_auth_session_get_command(adapter),
    ]
