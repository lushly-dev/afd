"""Tests for afd.auth: adapter contract, middleware, commands, mock, and server backstop."""

from __future__ import annotations

import asyncio
import importlib
import logging
import threading
from datetime import UTC, datetime, timedelta, timezone, tzinfo
from types import MappingProxyType, SimpleNamespace
from typing import Any

import pytest
from pydantic import ValidationError

import afd.server.auth_middleware_check as auth_mw_check_mod
from afd.auth import (
    AUTH_COMMAND_NAMES,
    LOADING,
    UNAUTHENTICATED,
    AuthAdapter,
    AuthAdapterError,
    AuthenticatedSessionState,
    AuthSessionState,
    AuthStateCallback,
    AuthSubscription,
    CredentialsSignInOptions,
    ListenerSet,
    MockAuthAdapter,
    OAuthSignInOptions,
    PasskeySignInOptions,
    PendingOutcome,
    RedirectOutcome,
    Session,
    SignedInOutcome,
    SignInOptions,
    SignInOutcome,
    User,
    are_session_states_equal,
    create_auth_commands,
    create_auth_middleware,
    create_auth_mutation_commands,
    create_auth_session_get_command,
    get_context_auth,
    is_session_expired,
    passkey_cancelled,
    passkey_unsupported,
)
from afd.core.actor import Actor
from afd.core.commands import (
    CommandContext,
    CommandDefinition,
    ExposeOptions,
    create_command_registry,
)
from afd.core.journal import MemoryJournalSink
from afd.core.result import CommandResult, success
from afd.core.wire import to_wire
from afd.direct import DirectClient, create_direct_registry
from afd.server import (
    Credentials,
    McpAuthOptions,
    TokenVerified,
    compose_middleware,
    create_journal_middleware,
    create_server,
    is_verified_credentials,
)
from afd.server.auth_rules import (
    _brand_verified_credentials,
    _copy_credentials,
    _unbrand_verified_credentials,
)
from afd.server.bootstrap.afd_schema import _render_named_typescript_type


class ManualClock:
    """Mutable clock returning epoch milliseconds."""

    def __init__(self, initial_ms: float) -> None:
        self._now = initial_ms

    def now(self) -> float:
        return self._now

    def advance(self, delta_ms: float) -> None:
        self._now += delta_ms


class _SemiNaiveTz(tzinfo):
    """A tzinfo subclass whose utcoffset returns None (semi-naive datetime)."""

    def utcoffset(self, dt: datetime | None) -> timedelta | None:
        return None

    def dst(self, dt: datetime | None) -> timedelta | None:
        return None

    def tzname(self, dt: datetime | None) -> str | None:
        return None


def _make_credentials(*, expires_at_s: int, subject: str = "sub-1") -> Credentials:
    return Credentials(
        issuer="https://issuer.example",
        subject=subject,
        client_id="client-1",
        scopes=("read",),
        resource="https://mcp.example/mcp",
        expires_at=expires_at_s,
        issued_at=expires_at_s - 600,
    )


class _DummyVerifier:
    async def verify(self, _request: Any) -> TokenVerified:
        return TokenVerified(credentials=_make_credentials(expires_at_s=4_102_444_800))


def _dummy_auth_options() -> McpAuthOptions:
    return McpAuthOptions(
        resource="https://mcp.example/mcp",
        authorization_servers=("https://issuer.example",),
        verifier=_DummyVerifier(),
    )


# ═══════════════════════════════════════════════════════════════════════════════
# TYPES, WIRE SERIALIZATION, ERRORS & LISTENERS
# ═══════════════════════════════════════════════════════════════════════════════


def test_singletons_and_auth_models_wire_serialization() -> None:
    assert UNAUTHENTICATED.status == "unauthenticated"
    assert UNAUTHENTICATED.session is None
    assert UNAUTHENTICATED.user is None
    assert LOADING.status == "loading"
    assert LOADING.session is None
    assert LOADING.user is None

    with pytest.raises(ValidationError):
        UNAUTHENTICATED.status = "loading"  # type: ignore[misc]

    assert to_wire(UNAUTHENTICATED) == {
        "status": "unauthenticated",
        "session": None,
        "user": None,
    }
    assert to_wire(LOADING) == {
        "status": "loading",
        "session": None,
        "user": None,
    }

    # Naive datetime normalizes to UTC so wire JSON carries explicit Z.
    auth_state = AuthenticatedSessionState(
        session=Session(id="sess-1", expires_at=datetime(2026, 5, 1, 12, 30, 0)),
        user=User(id="u-1", email="alice@example.com", name="Alice"),
    )
    wire = to_wire(auth_state)
    assert wire == {
        "status": "authenticated",
        "session": {"id": "sess-1", "expiresAt": "2026-05-01T12:30:00Z"},
        "user": {"id": "u-1", "email": "alice@example.com", "name": "Alice"},
    }
    assert "image" not in wire["user"]

    # Session without expires_at omits expiresAt on wire.
    no_expiry = AuthenticatedSessionState(
        session=Session(id="sess-2"),
        user=User(id="u-2", email="bob@example.com"),
    )
    wire_no_exp = to_wire(no_expiry)
    assert wire_no_exp == {
        "status": "authenticated",
        "session": {"id": "sess-2"},
        "user": {"id": "u-2", "email": "bob@example.com"},
    }

    # SignInOutcome wire shapes.
    assert to_wire(SignedInOutcome()) == {"kind": "signed-in"}
    assert to_wire(RedirectOutcome(url="https://idp.example")) == {
        "kind": "redirect",
        "url": "https://idp.example",
    }
    assert to_wire(RedirectOutcome()) == {"kind": "redirect"}
    assert to_wire(PendingOutcome()) == {"kind": "pending"}


def test_auth_adapter_error_codes_and_retryability() -> None:
    assert AuthAdapterError.invalid_credentials().code == "INVALID_CREDENTIALS"
    assert AuthAdapterError.invalid_credentials().retryable is False
    assert AuthAdapterError.token_expired().code == "TOKEN_EXPIRED"
    assert AuthAdapterError.token_expired().retryable is False
    assert AuthAdapterError.provider_error("github").code == "PROVIDER_ERROR"
    assert AuthAdapterError.provider_error("github", "rate limited").message == (
        "Authentication provider 'github' error: rate limited"
    )
    assert AuthAdapterError.provider_error("github").retryable is False
    assert AuthAdapterError.network_error().code == "NETWORK_ERROR"
    assert AuthAdapterError.network_error().retryable is True
    assert AuthAdapterError.refresh_failed().code == "REFRESH_FAILED"
    assert AuthAdapterError.refresh_failed().retryable is True
    assert passkey_cancelled().code == "PASSKEY_CANCELLED"
    assert passkey_cancelled().retryable is False
    assert passkey_unsupported().code == "PASSKEY_UNSUPPORTED"
    assert passkey_unsupported().retryable is False


def test_listener_set_isolates_errors_and_respects_dynamic_subscribe_unsubscribe(
    caplog: pytest.LogCaptureFixture,
) -> None:
    seen: list[str] = []
    reported: list[BaseException] = []
    listeners: ListenerSet[str] = ListenerSet(on_listener_error=reported.append)

    late_calls: list[str] = []
    sub_b_holder: list[AuthSubscription] = []

    def listener_a(value: str) -> None:
        seen.append(f"a:{value}")
        listeners.add(late_calls.append)
        sub_b_holder[0].unsubscribe()
        raise RuntimeError("boom in a")

    def listener_b(value: str) -> None:
        seen.append(f"b:{value}")

    def listener_c(value: str) -> None:
        seen.append(f"c:{value}")

    listeners.add(listener_a)
    sub_b = listeners.add(listener_b)
    sub_b_holder.append(sub_b)
    listeners.add(listener_c)

    listeners.emit("first")
    assert seen == ["a:first", "c:first"]
    assert late_calls == []
    assert len(reported) == 1
    assert isinstance(reported[0], RuntimeError)

    listeners.emit("second")
    assert late_calls == ["second"]
    assert listeners.size == 3
    listeners.clear()
    assert listeners.size == 0

    # Default on_listener_error=None and a throwing error handler both log without aborting.
    with caplog.at_level(logging.ERROR, logger="afd.auth"):
        default_set: ListenerSet[str] = ListenerSet()
        after_boom: list[str] = []
        default_set.add(lambda _v: (_ for _ in ()).throw(RuntimeError("unhandled")))
        default_set.add(after_boom.append)
        default_set.emit("ping")
        assert after_boom == ["ping"]

        def bad_error_handler(_err: BaseException) -> None:
            raise ValueError("handler exploded")

        bad_set: ListenerSet[str] = ListenerSet(on_listener_error=bad_error_handler)
        after_bad: list[str] = []
        bad_set.add(lambda _v: (_ for _ in ()).throw(RuntimeError("listener exploded")))
        bad_set.add(after_bad.append)
        bad_set.emit("pong")
        assert after_bad == ["pong"]
    assert len(caplog.records) >= 2


def test_session_expiry_and_equality_helpers() -> None:
    t0 = datetime(2026, 1, 1, 12, 0, 0, tzinfo=UTC)
    now_ms = t0.timestamp() * 1000.0

    assert is_session_expired(Session(id="s1", expires_at=None), now_ms) is False
    assert (
        is_session_expired(Session(id="s1", expires_at=t0 + timedelta(seconds=1)), now_ms) is False
    )
    assert is_session_expired(Session(id="s1", expires_at=t0), now_ms) is True
    assert (
        is_session_expired(Session(id="s1", expires_at=t0 - timedelta(seconds=1)), now_ms) is True
    )
    assert (
        is_session_expired(Session(id="s1", expires_at=datetime(1970, 1, 1, tzinfo=UTC)), now_ms)
        is True
    )

    # Naive UTC and non-UTC timezone offsets compare against exact UTC instant.
    naive_future = Session.model_construct(id="s-naive", expires_at=datetime(2026, 1, 1, 12, 0, 1))
    assert is_session_expired(naive_future, now_ms) is False
    semi_naive_past = Session.model_construct(
        id="s-semi", expires_at=datetime(2026, 1, 1, 11, 59, 59, tzinfo=_SemiNaiveTz())
    )
    assert is_session_expired(semi_naive_past, now_ms) is True
    plus_two = timezone(timedelta(hours=2))
    same_instant_plus_two = Session(
        id="s-tz", expires_at=datetime(2026, 1, 1, 14, 0, 1, tzinfo=plus_two)
    )
    assert is_session_expired(same_instant_plus_two, now_ms) is False

    # Malformed expires_at, bool/non-numeric/overflowing now_ms all fail closed.
    bad_session = Session.model_construct(id="bad", expires_at="not-a-date")  # type: ignore[arg-type]
    assert is_session_expired(bad_session, now_ms) is True
    overflow_session = Session.model_construct(id="big", expires_at=10**400)  # type: ignore[arg-type]
    assert is_session_expired(overflow_session, now_ms) is True

    valid_session = Session(id="s1", expires_at=t0 + timedelta(hours=1))
    assert is_session_expired(valid_session, float("nan")) is True
    assert is_session_expired(valid_session, float("inf")) is True
    assert is_session_expired(valid_session, True) is True  # type: ignore[arg-type]
    assert is_session_expired(valid_session, False) is True  # type: ignore[arg-type]
    assert is_session_expired(valid_session, "1700000000000") is True  # type: ignore[arg-type]
    assert is_session_expired(valid_session, 10**400) is True

    left = AuthenticatedSessionState(
        session=Session(id="s1", expires_at=t0),
        user=User(id="u1", email="a@example.com", name="Alice"),
    )
    right = AuthenticatedSessionState(
        session=Session(id="s1", expires_at=t0),
        user=User(id="u1", email="a@example.com", name="Alice"),
    )
    different = AuthenticatedSessionState(
        session=Session(id="s2", expires_at=t0),
        user=User(id="u1", email="a@example.com", name="Alice"),
    )
    assert are_session_states_equal(left, right) is True
    assert are_session_states_equal(left, different) is False
    assert are_session_states_equal(UNAUTHENTICATED, LOADING) is False


# ═══════════════════════════════════════════════════════════════════════════════
# MOCK ADAPTER
# ═══════════════════════════════════════════════════════════════════════════════


async def test_mock_auth_adapter_lifecycle_clock_and_helpers() -> None:
    clock = ManualClock(1_700_000_000_000)
    mock = MockAuthAdapter(clock=clock)
    assert isinstance(mock, AuthAdapter)
    assert mock.get_session() == UNAUTHENTICATED

    events: list[AuthSessionState] = []
    sub = mock.on_auth_state_change(events.append)
    assert mock._get_listener_count() == 1

    outcome = await mock.sign_in(CredentialsSignInOptions(email="alice@example.com"))
    assert outcome == SignedInOutcome()
    state = mock.get_session()
    assert state.status == "authenticated"
    assert state.session.id == "mock-session-1700000000000"
    assert state.user.id == "mock-user-alice@example.com"
    assert state.user.name == "alice"
    assert state.session.expires_at is not None

    # Refresh before expiry keeps session; refresh at/after expiry signs out.
    clock.advance(3_599_000)
    await mock.refresh()
    assert mock.get_session().status == "authenticated"

    clock.advance(1_000)
    await mock.refresh()
    assert mock.get_session() == UNAUTHENTICATED

    # OAuth sign-in derives distinct session id at new clock instant.
    oauth_outcome = await mock.sign_in(OAuthSignInOptions(provider="github"))
    assert oauth_outcome == SignedInOutcome()
    oauth_state = mock.get_session()
    assert oauth_state.status == "authenticated"
    assert oauth_state.session.id == "mock-session-1700003600000"
    assert oauth_state.user.email == "user@github.com"

    # Passkey sign-in fails without _passkey_user, succeeds once configured.
    with pytest.raises(AuthAdapterError) as exc_info:
        await mock.sign_in(PasskeySignInOptions())
    assert exc_info.value.code == "PASSKEY_UNSUPPORTED"

    mock._passkey_user = lambda: User(id="pk-1", email="pk@example.com", name="PK")
    pk_outcome = await mock.sign_in(PasskeySignInOptions(auto_fill=True))
    assert pk_outcome == SignedInOutcome()
    pk_state = mock.get_session()
    assert pk_state.status == "authenticated"
    assert pk_state.user.id == "pk-1"

    # Test helpers work, support camelCase overrides, delay_ms, and _reset().
    mock._set_loading()
    assert mock.get_session() == LOADING
    mock._set_user(
        User(id="u-2", email="bob@example.com"),
        session={"id": "custom-id", "expiresAt": None},
    )
    bob_state = mock.get_session()
    assert bob_state.status == "authenticated"
    assert bob_state.session.id == "custom-id"
    assert bob_state.session.expires_at is None

    mock._reset()
    assert mock.get_session() == UNAUTHENTICATED
    assert mock._trigger_error("NETWORK_ERROR").retryable is True

    sub.unsubscribe()
    assert mock._get_listener_count() == 0
    assert len(events) == 7

    delayed = MockAuthAdapter(delay_ms=1, clock=clock)
    await delayed.sign_in(CredentialsSignInOptions(email="slow@example.com"))
    assert delayed.get_session().status == "authenticated"
    await delayed.sign_out()
    assert delayed.get_session() == UNAUTHENTICATED


# ═══════════════════════════════════════════════════════════════════════════════
# AUTH MIDDLEWARE
# ═══════════════════════════════════════════════════════════════════════════════


def test_auth_middleware_rejects_non_callable_is_verified_credentials() -> None:
    adapter = MockAuthAdapter()
    with pytest.raises(TypeError, match="callable"):
        create_auth_middleware(adapter, is_verified_credentials=False)  # type: ignore[arg-type]


async def test_auth_middleware_gates_unauthenticated_loading_and_expired() -> None:
    clock = ManualClock(1_700_000_000_000)
    adapter = MockAuthAdapter(clock=clock)
    mw = create_auth_middleware(adapter, exclude=["health-check"], clock=clock)
    called = False

    async def next_fn() -> CommandResult[Any]:
        nonlocal called
        called = True
        return success({"ok": True})

    # Unauthenticated -> UNAUTHORIZED (non-retryable) and strips MappingProxyType extra.
    ctx = CommandContext(extra=MappingProxyType({"auth": "spoofed", "keep": 1}))  # type: ignore[arg-type]
    res = await mw("todo-create", {}, ctx, next_fn)
    assert res.success is False
    assert res.error is not None
    assert res.error.code == "UNAUTHORIZED"
    assert res.error.retryable is False
    assert "auth" not in ctx.extra
    assert ctx.extra["keep"] == 1
    assert called is False

    # Loading -> UNAUTHORIZED (retryable)
    adapter._set_loading()
    res = await mw("todo-create", {}, CommandContext(), next_fn)
    assert res.success is False
    assert res.error is not None
    assert res.error.code == "UNAUTHORIZED"
    assert res.error.retryable is True

    # Authenticated but expired -> TOKEN_EXPIRED (retryable)
    adapter._set_user(
        User(id="u1", email="alice@example.com", name="Alice"),
        session={"expires_at": datetime(1970, 1, 1, tzinfo=UTC)},
    )
    res = await mw("todo-create", {}, CommandContext(), next_fn)
    assert res.success is False
    assert res.error is not None
    assert res.error.code == "TOKEN_EXPIRED"
    assert res.error.retryable is True
    assert called is False

    # Excluded and auth-* commands still run when session is expired, with forged auth stripped.
    for bypass_cmd in ("health-check", "auth-session-get"):
        ctx_bypass = CommandContext(extra=MappingProxyType({"auth": "forged"}))  # type: ignore[arg-type]
        res = await mw(bypass_cmd, {}, ctx_bypass, next_fn)
        assert res.success is True
        assert "auth" not in ctx_bypass.extra


async def test_auth_middleware_stamps_context_auth_and_actor_and_cleans_excluded() -> None:
    clock = ManualClock(1_700_000_000_000)
    adapter = MockAuthAdapter(clock=clock)
    mw = create_auth_middleware(adapter, exclude=["health-check"], clock=clock)

    seen_auth: list[Any] = []
    seen_actor: list[Actor | None] = []

    async def capture_ctx(ctx: CommandContext) -> CommandResult[Any]:
        seen_auth.append(get_context_auth(ctx))
        seen_actor.append(ctx.actor)
        return success({"ok": True})

    # Excluded command strips caller-supplied auth when unauthenticated without mutating caller dict.
    caller_extra = {"auth": "forged", "keep": 1}
    ctx_excluded = CommandContext(extra=caller_extra)
    res = await mw("health-check", {}, ctx_excluded, lambda: capture_ctx(ctx_excluded))
    assert res.success is True
    assert seen_auth[-1] is None
    assert "auth" not in ctx_excluded.extra
    assert ctx_excluded.extra["keep"] == 1
    assert caller_extra["auth"] == "forged"

    # Authenticated: human/unset/malformed actor -> human with user id and label.
    adapter._set_user(User(id="u-1", email="alice@example.com", name="Alice"))
    ctx_human = CommandContext(extra=MappingProxyType({"auth": "old"}))  # type: ignore[arg-type]
    res = await mw("todo-list", {}, ctx_human, lambda: capture_ctx(ctx_human))
    assert res.success is True
    assert isinstance(seen_auth[-1], AuthenticatedSessionState)
    assert seen_actor[-1] == Actor(kind="human", id="u-1", label="Alice")

    ctx_bad_actor = CommandContext(actor=SimpleNamespace(kind="agent"))  # type: ignore[arg-type]
    res = await mw("todo-list", {}, ctx_bad_actor, lambda: capture_ctx(ctx_bad_actor))
    assert res.success is True
    assert seen_actor[-1] == Actor(kind="human", id="u-1", label="Alice")

    # Authenticated: agent actor preserves identity and overwrites on_behalf_of.
    ctx_agent = CommandContext(actor=Actor(kind="agent", id="bot-9", on_behalf_of="spoofed"))
    res = await mw("todo-list", {}, ctx_agent, lambda: capture_ctx(ctx_agent))
    assert res.success is True
    assert seen_actor[-1] == Actor(kind="agent", id="bot-9", on_behalf_of="u-1")


async def test_auth_middleware_with_verified_credentials_and_expiry_fail_closed() -> None:
    clock = ManualClock(1_700_000_000_000)
    adapter = MockAuthAdapter(clock=clock)
    # Local session belongs to someone else; token calls must NEVER read or stamp it.
    adapter._set_user(User(id="local-user", email="local@example.com", name="Local"))

    mw = create_auth_middleware(
        adapter,
        exclude=["health-check"],
        is_verified_credentials=is_verified_credentials,
        clock=clock,
    )

    valid_creds = _brand_verified_credentials(
        _make_credentials(expires_at_s=1_700_000_600, subject="token-user")
    )
    token_actor = Actor(kind="agent", id="client-1")

    async def next_ok() -> CommandResult[Any]:
        return success({"ok": True})

    # Valid branded credentials bypass session, strip context.extra["auth"], keep token actor.
    ctx = CommandContext(
        actor=token_actor,
        credentials=valid_creds,
        extra=MappingProxyType({"auth": "forged"}),  # type: ignore[arg-type]
    )
    res = await mw("todo-list", {}, ctx, next_ok)
    assert res.success is True
    assert "auth" not in ctx.extra
    assert ctx.actor == token_actor

    # Valid branded credentials are refused on built-in session commands.
    for cmd_name in AUTH_COMMAND_NAMES:
        res = await mw(cmd_name, {}, CommandContext(credentials=valid_creds), next_ok)
        assert res.success is False
        assert res.error is not None
        assert res.error.code == "UNAUTHORIZED"
        assert res.error.retryable is False

    # Non-bool truthy predicate is NOT treated as True (strict `is True`).
    truthy_mw = create_auth_middleware(
        adapter,
        is_verified_credentials=lambda _c, _n: "yes",  # type: ignore[arg-type,return-value]
        clock=clock,
    )
    ctx_truthy = CommandContext(credentials=valid_creds)
    res = await truthy_mw("todo-list", {}, ctx_truthy, next_ok)
    assert res.success is True
    assert get_context_auth(ctx_truthy) is not None  # fell through to session

    # Expired branded credentials fail closed with TOKEN_EXPIRED even on excluded/session commands.
    clock.advance(700_000)
    for cmd_name in ("todo-list", "health-check", "auth-session-get"):
        res = await mw(
            cmd_name,
            {},
            CommandContext(credentials=valid_creds, extra={"auth": "forged"}),
            next_ok,
        )
        assert res.success is False
        assert res.error is not None
        assert res.error.code == "TOKEN_EXPIRED"
        assert res.error.retryable is True

    # Unbranded copy or revoked brand is NOT recognized as verified; falls back to session auth.
    forged_copy = _copy_credentials(valid_creds)
    _unbrand_verified_credentials(valid_creds)
    clock_before_session_expiry = ManualClock(1_700_000_100_000)
    mw_before = create_auth_middleware(
        adapter,
        is_verified_credentials=is_verified_credentials,
        clock=clock_before_session_expiry,
    )
    for unverified in (forged_copy, valid_creds):
        ctx_unverified = CommandContext(credentials=unverified)
        res = await mw_before("todo-list", {}, ctx_unverified, next_ok)
        assert res.success is True
        assert get_context_auth(ctx_unverified) is not None
        assert ctx_unverified.actor == Actor(kind="human", id="local-user", label="Local")


# ═══════════════════════════════════════════════════════════════════════════════
# SERVER #2524 BACKSTOP, E2E BEARER ADMISSION & JOURNAL EXCLUSION
# ═══════════════════════════════════════════════════════════════════════════════


async def test_server_with_auth_backstop_and_e2e_admitted_credentials() -> None:
    adapter = MockAuthAdapter()
    adapter._set_user(User(id="local-user", email="local@example.com", name="Local"))
    bare_mw = create_auth_middleware(adapter)
    aware_mw = create_auth_middleware(adapter, is_verified_credentials=is_verified_credentials)

    # Without server auth, bare middleware is allowed.
    create_server("no-token-auth", middleware=[bare_mw])

    # With server auth, bare middleware fails closed directly, composed, nested, and across reloads.
    with pytest.raises(ValueError, match="is_verified_credentials"):
        create_server("with-token-auth", auth=_dummy_auth_options(), middleware=[bare_mw])

    composed_bad = compose_middleware(aware_mw, bare_mw)
    with pytest.raises(ValueError, match="is_verified_credentials"):
        create_server("with-composed-bad", auth=_dummy_auth_options(), middleware=[composed_bad])

    nested_bad = compose_middleware(compose_middleware(bare_mw))
    with pytest.raises(ValueError, match="is_verified_credentials"):
        create_server("with-nested-bad", auth=_dummy_auth_options(), middleware=[nested_bad])

    reloaded = importlib.reload(auth_mw_check_mod)
    with pytest.raises(ValueError, match="is_verified_credentials"):
        reloaded.assert_auth_middleware_recognises_tokens(has_auth=True, middleware=[bare_mw])

    # With is_verified_credentials, both direct and composed are accepted, and admitted
    # bearer credentials run with token identity without reading the local session.
    server = create_server(
        "with-aware",
        tool_strategy="individual",
        auth=_dummy_auth_options(),
        middleware=[compose_middleware(aware_mw)],
    )
    for cmd in create_auth_commands(adapter):
        server.register(cmd)

    captured: dict[str, Any] = {}

    @server.command(
        name="item-read",
        description="Read an item",
        expose=ExposeOptions(mcp=True),
    )
    async def read_item(_input: Any, context: CommandContext) -> CommandResult[dict[str, Any]]:
        captured["auth"] = get_context_auth(context)
        captured["actor"] = context.actor
        captured["credentials_subject"] = getattr(context.credentials, "subject", None)
        return success({"ok": True})

    admitted_creds = _make_credentials(expires_at_s=4_102_444_800, subject="bearer-sub")
    router = server._get_router()
    with server.admit({"type": "http"}, admitted_creds):
        res_ok = await router("item-read", {})
        assert res_ok.success is True
        assert captured["auth"] is None
        assert captured["actor"] == Actor(kind="agent", id="client-1", on_behalf_of="bearer-sub")
        assert captured["credentials_subject"] == "bearer-sub"

        # Session commands are refused for token-backed calls even though exposed to MCP.
        res_sess = await router("auth-session-get", {})
        assert res_sess.success is False
        assert res_sess.error is not None
        assert res_sess.error.code == "UNAUTHORIZED"


async def test_journal_middleware_skips_auth_commands_by_default() -> None:
    adapter = MockAuthAdapter()
    sink = MemoryJournalSink()
    server = create_server(
        "auth-journal-test",
        middleware=[create_auth_middleware(adapter), create_journal_middleware(sink)],
    )
    for cmd in create_auth_commands(adapter):
        server.register(cmd)

    @server.command(name="item-ping", description="Ping")
    async def ping(_input: Any) -> CommandResult[dict[str, bool]]:
        return success({"pong": True})

    res_in = await server.execute(
        "auth-sign-in",
        {"method": "credentials", "email": "alice@example.com", "password": "secret"},
        context=CommandContext(extra={"interface": "agent"}),
    )
    assert res_in.success is True
    res_ping = await server.execute(
        "item-ping",
        {},
        context=CommandContext(extra={"interface": "agent"}),
    )
    assert res_ping.success is True
    res_out = await server.execute(
        "auth-sign-out",
        {},
        context=CommandContext(extra={"interface": "agent"}),
    )
    assert res_out.success is True
    wire_out = to_wire(res_out)
    assert "data" in wire_out and wire_out["data"] is None

    entries = await sink.read()
    assert [entry.command for entry in entries] == ["item-ping"]


# ═══════════════════════════════════════════════════════════════════════════════
# AUTH COMMANDS, SERVER REGISTRATION, BOOTSTRAP & DIRECT CLIENT
# ═══════════════════════════════════════════════════════════════════════════════


async def test_auth_commands_metadata_bootstrap_and_direct_client_flow() -> None:
    adapter = MockAuthAdapter()
    commands = create_auth_commands(adapter)
    by_name = {cmd.name: cmd for cmd in commands}

    assert [cmd.name for cmd in commands] == [
        "auth-sign-in",
        "auth-sign-out",
        "auth-session-get",
    ]
    assert by_name["auth-sign-in"].mutation is True
    assert by_name["auth-sign-in"].expose is not None
    assert by_name["auth-sign-in"].expose.mcp is False
    assert by_name["auth-sign-out"].mutation is True
    assert by_name["auth-sign-out"].destructive is True
    assert by_name["auth-sign-out"].confirm_prompt == "Sign out of your account?"
    assert by_name["auth-sign-out"].expose is not None
    assert by_name["auth-sign-out"].expose.mcp is False
    assert by_name["auth-session-get"].mutation is False
    assert by_name["auth-session-get"].expose is not None
    assert by_name["auth-session-get"].expose.mcp is True

    # Register on MCPServer with bootstrap=True and verify tools/list + bootstrap commands.
    server = create_server("auth-cmd-server", tool_strategy="individual", bootstrap=True)
    for cmd in commands:
        server.register(cmd)
    tool_names = {tool["name"] for tool in server.get_tool_definitions()}
    assert "auth-session-get" in tool_names
    assert "auth-sign-in" not in tool_names
    assert "auth-sign-out" not in tool_names

    help_res = await server.execute("afd-help", {"format": "full"})
    assert help_res.success is True
    docs_res = await server.execute("afd-docs", {})
    assert docs_res.success is True
    schema_json_res = await server.execute("afd-schema", {"format": "json"})
    assert schema_json_res.success is True
    schema_ts_res = await server.execute("afd-schema", {"format": "typescript"})
    assert schema_ts_res.success is True

    # Verify oneOf object schema renders valid TypeScript `export type` rather than `export interface ... | ...`.
    rendered_ts = _render_named_typescript_type(
        "AuthSignInInput", by_name["auth-sign-in"].input_schema
    )
    assert rendered_ts.startswith("export type AuthSignInInput = ")
    assert "export interface" not in rendered_ts

    # DirectClient + create_direct_registry end-to-end flow with auth middleware.
    @server.command(name="secret-read", description="Protected read")
    async def secret_read(_input: Any, context: CommandContext) -> CommandResult[dict[str, str]]:
        auth_state = get_context_auth(context)
        assert auth_state is not None
        return success({"email": auth_state.user.email})

    direct_adapter = MockAuthAdapter()
    direct_adapter._passkey_user = lambda: User(id="pk-u", email="pk@example.com", name="PK")
    direct_commands: list[Any] = [
        *create_auth_commands(direct_adapter),
        secret_read,
    ]
    direct_reg = create_direct_registry(
        direct_commands,
        middleware=[create_auth_middleware(direct_adapter)],
    )
    client = DirectClient(direct_reg)

    blocked = await client.call("secret-read", {})
    assert blocked.success is False
    assert blocked.error is not None
    assert blocked.error.code == "UNAUTHORIZED"

    sess0 = await client.call("auth-session-get", {})
    assert sess0.success is True
    assert sess0.data == UNAUTHENTICATED

    signed_in = await client.call(
        "auth-sign-in",
        {"method": "oauth", "provider": "github", "scopes": ["read:user"], "redirectTo": "/app"},
    )
    assert signed_in.success is True
    assert signed_in.data is not None
    assert signed_in.data.status == "authenticated"
    assert signed_in.data.user.email == "user@github.com"

    allowed = await client.call("secret-read", {})
    assert allowed.success is True
    assert allowed.data == {"email": "user@github.com"}

    pk_signed_in = await client.call("auth-sign-in", {"method": "passkey", "autoFill": True})
    assert pk_signed_in.success is True
    assert pk_signed_in.data is not None
    assert pk_signed_in.data.user.email == "pk@example.com"

    signed_out = await client.call("auth-sign-out", {})
    assert signed_out.success is True
    assert signed_out.data is None
    assert direct_adapter.get_session() == UNAUTHENTICATED

    # Also works on core CommandRegistry with validation error shape matching spec/validation.md.
    registry = create_command_registry()
    for cmd in create_auth_mutation_commands(adapter) + [create_auth_session_get_command(adapter)]:
        registry.register(cmd)

    r_none = await registry.execute("auth-sign-in", None)
    assert r_none.success is False
    assert r_none.error is not None
    assert r_none.error.code == "VALIDATION_ERROR"
    assert isinstance(r_none.error.details, dict)
    assert "errors" in r_none.error.details

    r_bad = await registry.execute(
        "auth-sign-in", {"method": "credentials", "email": "not-an-email"}
    )
    assert r_bad.success is False
    assert r_bad.error is not None
    assert r_bad.error.code == "VALIDATION_ERROR"


def test_mcp_server_register_command_definition_validation_parity() -> None:
    async def noop(_input: Any, _ctx: Any = None) -> CommandResult[dict[str, bool]]:
        return success({"ok": True})

    server = create_server(
        "reg-validation",
        tool_strategy="hybrid",
        first_class_tools=["private-cmd"],
        bootstrap=True,
    )

    with pytest.raises(TypeError, match="callable"):
        server.register(
            CommandDefinition(name="bad-handler", description="d", handler="nope")  # type: ignore[arg-type]
        )

    with pytest.raises(TypeError, match="approval"):
        server.register(
            CommandDefinition(
                name="bad-approval",
                description="d",
                handler=noop,
                approval="always",  # type: ignore[arg-type]
            )
        )

    with pytest.raises(ValueError, match="reserved"):
        server.register(CommandDefinition(name="afd-call", description="d", handler=noop))

    with pytest.raises(ValueError, match="bootstrap"):
        server.register(CommandDefinition(name="afd-help", description="d", handler=noop))

    with pytest.raises(ValueError, match="first_class_tools"):
        server.register(
            CommandDefinition(
                name="private-cmd",
                description="d",
                handler=noop,
                expose=ExposeOptions(mcp=False),
            )
        )

    with pytest.raises(ValueError):
        server.register(
            CommandDefinition(
                name="bad-schema",
                description="d",
                handler=noop,
                input_schema={"type": "object", "patternProperties": {".*": {"type": "string"}}},
            )
        )

    with pytest.raises(ValueError):
        server.register(
            CommandDefinition(
                name="bad-meta",
                description="d",
                handler=noop,
                tool_meta={"dev.afd/reserved": True},
            )
        )

    with pytest.raises(ValueError):
        server.register(
            CommandDefinition(
                name="bad-scope",
                description="d",
                handler=noop,
                scopes=["bad scope with space"],
            )
        )

    with pytest.raises(ValueError):
        server.register(
            CommandDefinition(
                name="bad-task",
                description="d",
                handler=noop,
                task="required",
                confirm_prompt="Sure?",
            )
        )

    # Caller's CommandDefinition is NOT mutated when registration fails.
    original_scopes = ["read", "read"]
    caller_def = CommandDefinition(
        name="private-cmd",
        description="d",
        handler=noop,
        scopes=original_scopes,
        expose=ExposeOptions(mcp=False),
    )
    with pytest.raises(ValueError, match="first_class_tools"):
        server.register(caller_def)
    assert caller_def.scopes == ["read", "read"]


class _ProgrammableAdapter:
    """Custom AuthAdapter for testing redirect, pending, async settle, timeout, and errors."""

    def __init__(
        self,
        *,
        initial: AuthSessionState = UNAUTHENTICATED,
        outcome: SignInOutcome | None = None,
        error: Exception | None = None,
        after_sign_in: Any = None,
    ) -> None:
        self._state: AuthSessionState = initial
        self._listeners: ListenerSet[AuthSessionState] = ListenerSet()
        self._outcome = outcome
        self._error = error
        self._after_sign_in = after_sign_in

    async def sign_in(self, options: SignInOptions) -> SignInOutcome | None:
        if self._error is not None:
            raise self._error
        if self._after_sign_in is not None:
            self._after_sign_in(self)
        return self._outcome

    async def sign_out(self) -> None:
        if self._error is not None:
            raise self._error
        self.emit(UNAUTHENTICATED)

    def get_session(self) -> AuthSessionState:
        return self._state

    def on_auth_state_change(self, callback: AuthStateCallback) -> AuthSubscription:
        return self._listeners.add(callback)

    def emit(self, state: AuthSessionState) -> None:
        self._state = state
        self._listeners.emit(state)


async def test_auth_sign_in_redirect_pending_async_settle_timeout_threads_and_errors() -> None:
    # 1. Redirect outcome with and without URL.
    redirect_adapter = _ProgrammableAdapter(
        outcome=RedirectOutcome(url="https://idp.example/authorize")
    )
    sign_in_cmd = create_auth_mutation_commands(redirect_adapter)[0]
    res = await sign_in_cmd.handler({"method": "oauth", "provider": "github"}, None)
    assert res.success is True
    assert res.warnings is not None
    assert res.warnings[0].code == "SIGN_IN_REDIRECT"
    assert res.warnings[0].details == {"url": "https://idp.example/authorize"}

    redirect_no_url = _ProgrammableAdapter(outcome=RedirectOutcome())
    res_no_url = await create_auth_mutation_commands(redirect_no_url)[0].handler(
        {"method": "oauth", "provider": "github"}, None
    )
    assert res_no_url.success is True
    wire_no_url = to_wire(res_no_url)
    assert wire_no_url["warnings"][0]["code"] == "SIGN_IN_REDIRECT"
    assert "details" not in wire_no_url["warnings"][0]

    # 2. Pending outcome carries SIGN_IN_PENDING warning.
    pending_adapter = _ProgrammableAdapter(outcome=PendingOutcome())
    sign_in_cmd = create_auth_mutation_commands(pending_adapter)[0]
    res = await sign_in_cmd.handler({"method": "credentials", "email": "alice@example.com"}, None)
    assert res.success is True
    assert res.warnings is not None
    assert res.warnings[0].code == "SIGN_IN_PENDING"

    # 3. Async state change (including from a background thread) settles to authenticated.
    threaded_adapter = _ProgrammableAdapter(outcome=SignedInOutcome())

    def emit_from_thread(adp: _ProgrammableAdapter) -> None:
        def worker() -> None:
            adp.emit(
                AuthenticatedSessionState(
                    session=Session(id="s-thread"),
                    user=User(id="u-thread", email="thread@example.com"),
                )
            )

        threading.Thread(target=worker, daemon=True).start()

    threaded_adapter._after_sign_in = emit_from_thread
    sign_in_cmd = create_auth_mutation_commands(threaded_adapter, sign_in_timeout_ms=500)[0]
    res = await sign_in_cmd.handler({"method": "credentials", "email": "thread@example.com"}, None)
    assert res.success is True
    assert res.data is not None
    assert res.data.status == "authenticated"
    assert res.data.user.email == "thread@example.com"
    assert threaded_adapter._listeners.size == 0

    # 4. Pre-existing authenticated session waits for a replacement and returns the new
    #    session when one arrives; if unchanged after the wait, reports the existing session
    #    as signed in (matching TS commands.test.ts).
    stale_state = AuthenticatedSessionState(
        session=Session(id="s-old"),
        user=User(id="u-old", email="old@example.com"),
    )
    replacement_state = AuthenticatedSessionState(
        session=Session(id="s-new"),
        user=User(id="u-new", email="new@example.com"),
    )
    replacing_adapter = _ProgrammableAdapter(initial=stale_state, outcome=SignedInOutcome())

    def schedule_replacement(adp: _ProgrammableAdapter) -> None:
        async def later() -> None:
            await asyncio.sleep(0.01)
            adp.emit(replacement_state)

        asyncio.get_running_loop().create_task(later())

    replacing_adapter._after_sign_in = schedule_replacement
    res_replaced = await create_auth_mutation_commands(replacing_adapter, sign_in_timeout_ms=500)[
        0
    ].handler({"method": "credentials", "email": "new@example.com"}, None)
    assert res_replaced.success is True
    assert res_replaced.data == replacement_state
    assert res_replaced.reasoning == "Signed in via credentials as new@example.com"

    unchanged_adapter = _ProgrammableAdapter(initial=stale_state, outcome=SignedInOutcome())
    res_unchanged = await create_auth_mutation_commands(unchanged_adapter, sign_in_timeout_ms=15)[
        0
    ].handler({"method": "credentials", "email": "old@example.com"}, None)
    assert res_unchanged.success is True
    assert res_unchanged.data == stale_state
    assert res_unchanged.reasoning == "Signed in via credentials as old@example.com"
    assert unchanged_adapter._listeners.size == 0

    # 5. Async state change settling to unauthenticated returns PROVIDER_ERROR.
    unauth_adapter = _ProgrammableAdapter(outcome=SignedInOutcome())

    def schedule_unauth(adp: _ProgrammableAdapter) -> None:
        async def later() -> None:
            await asyncio.sleep(0.01)
            adp.emit(UNAUTHENTICATED)

        asyncio.get_running_loop().create_task(later())

    unauth_adapter._after_sign_in = schedule_unauth
    sign_in_cmd = create_auth_mutation_commands(unauth_adapter, sign_in_timeout_ms=500)[0]
    res = await sign_in_cmd.handler({"method": "credentials", "email": "alice@example.com"}, None)
    assert res.success is False
    assert res.error is not None
    assert res.error.code == "PROVIDER_ERROR"

    # 6. Timeout without session confirmation returns current state with SIGN_IN_PENDING.
    silent_adapter = _ProgrammableAdapter(outcome=SignedInOutcome())
    sign_in_cmd = create_auth_mutation_commands(silent_adapter, sign_in_timeout_ms=20)[0]
    res = await sign_in_cmd.handler({"method": "credentials", "email": "alice@example.com"}, None)
    assert res.success is True
    assert res.data == UNAUTHENTICATED
    assert res.warnings is not None
    assert res.warnings[0].code == "SIGN_IN_PENDING"
    assert silent_adapter._listeners.size == 0

    # 7. Cancellation during settle() unsubscribes cleanly.
    cancel_adapter = _ProgrammableAdapter(outcome=SignedInOutcome())
    cancel_cmd = create_auth_mutation_commands(cancel_adapter, sign_in_timeout_ms=5_000)[0]
    task = asyncio.create_task(
        cancel_cmd.handler({"method": "credentials", "email": "alice@example.com"}, None)
    )
    await asyncio.sleep(0.01)
    assert cancel_adapter._listeners.size == 1
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert cancel_adapter._listeners.size == 0

    # 8. AuthAdapterError maps to structured failure; unexpected exceptions rethrow and clean up.
    err_adapter = _ProgrammableAdapter(error=AuthAdapterError.invalid_credentials())
    sign_in_cmd, sign_out_cmd = create_auth_mutation_commands(err_adapter)
    res_in = await sign_in_cmd.handler(
        {"method": "credentials", "email": "alice@example.com"}, None
    )
    assert res_in.success is False
    assert res_in.error is not None
    assert res_in.error.code == "INVALID_CREDENTIALS"
    assert res_in.error.retryable is False

    res_out = await sign_out_cmd.handler({}, None)
    assert res_out.success is False
    assert res_out.error is not None
    assert res_out.error.code == "INVALID_CREDENTIALS"

    boom_adapter = _ProgrammableAdapter(error=RuntimeError("unexpected crash"))
    boom_in, boom_out = create_auth_mutation_commands(boom_adapter)
    with pytest.raises(RuntimeError, match="unexpected crash"):
        await boom_in.handler({"method": "credentials", "email": "alice@example.com"}, None)
    assert boom_adapter._listeners.size == 0
    with pytest.raises(RuntimeError, match="unexpected crash"):
        await boom_out.handler({}, None)

    # 9. Invalid sign_in_timeout_ms fails fast at construction.
    with pytest.raises(ValueError, match="sign_in_timeout_ms"):
        create_auth_mutation_commands(silent_adapter, sign_in_timeout_ms=-1)
