"""MCP authorization on HTTP (``spec/authorization.md``, M1 to M7): the options of
``create_server(..., auth=...)`` and the ASGI bearer layer the HTTP transports run ahead of
every route.

For each HTTP request the layer serves RFC 9728 protected-resource metadata at its two paths
without authentication (M7); otherwise it extracts the one bearer token (M2), verifies it
(M3), and either answers 401 with M5's exact challenge and body, or removes every
``Authorization`` header from the ASGI scope and admits the verified :class:`Credentials`
(M4), frozen and branded, for that request alone: the brand is removed when the request ends.
Scopes (M6): each admitted request gets a :class:`ScopeView`, decided once as it arrives; the
layer decides a ``POST`` JSON-RPC body before dispatch and answers a missing scope with M5's
403. A host whose own layer vouches for its callers admits them with ``server.admit`` and runs
the same decision with ``server.pre_dispatch_check``. A request that reaches the MCP service
without credentials admitted by this server's own layer fails closed with ``UNAUTHORIZED``
(M1), except on stdio or a transport the host explicitly marked trusted.
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import math
import re
from collections.abc import Callable, Iterator, Mapping, Sequence
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any

from afd.core.actor import Actor
from afd.core.clock import Clock, system_clock
from afd.server.auth_bearer import BearerRefusal, extract_bearer, names_access_token
from afd.server.auth_dispatch import (
    PROCEED,
    PreDispatch,
    body_too_large,
    decide_body,
    forbidden_response,
)
from afd.server.auth_jwt import TokenRequest, TokenVerifier
from afd.server.auth_resource import ProtectedResource, create_protected_resource, is_scope_token
from afd.server.auth_rules import (
    MAX_CLOCK_SKEW_S,
    AuthRuleCode,
    Credentials,
    TokenRules,
    _brand_verified_credentials,
    _copy_credentials,
    _is_branded_credentials,
    _unbrand_verified_credentials,
)
from afd.server.auth_scopes import ScopeChallenge, ScopeResolver, validate_scope_list
from afd.server.auth_view import ScopeAuthority, ScopeView

logger = logging.getLogger("afd.server")

_SAFE_RULE = re.compile(r"\A[A-Za-z0-9_.:-]{1,64}\Z", re.ASCII)
_SAFE_ALIAS = re.compile(r"\A[\x21-\x7E]{1,256}\Z", re.ASCII)
_DEFAULT_MAX_FORM_BODY_BYTES = 1_048_576
# Matches the MCP SDK's DEFAULT_MAX_REQUEST_BODY_SIZE (mcp.server.transport_security).
_DEFAULT_MAX_JSON_BODY_BYTES = 4 * 1024 * 1024


@dataclass(frozen=True)
class AuthRefusal:
    """A refused token, as :attr:`McpAuthOptions.on_refusal` receives it. Never the token or a claim."""

    rule: str
    issuer: str | None = None


@dataclass(frozen=True)
class McpAuthOptions:
    """``create_server``'s ``auth`` option (``spec/authorization.md``, "Options"): the server
    becomes an OAuth 2.1 protected resource on every HTTP transport. stdio, ``server.execute``
    and in-process registries are unaffected."""

    resource: str
    authorization_servers: Sequence[str]
    verifier: TokenVerifier
    scopes_supported: Sequence[str] = ()
    resource_name: str | None = None
    require_bound_tokens: bool | None = None
    on_refusal: Callable[[AuthRefusal], None] | None = None
    max_form_body_bytes: int = _DEFAULT_MAX_FORM_BODY_BYTES
    required_scopes: Sequence[str] = ()
    resolver: ScopeResolver | None = None
    filter_tools_by_scope: bool = False


def credentials_actor(credentials: Credentials) -> Actor:
    """The default actor of a verified call (M4), when ``context_hook`` maps none."""
    return Actor(
        kind="agent",
        id=credentials.client_id,
        on_behalf_of=credentials.subject,
    )


def _default_refusal(refusal: AuthRefusal) -> None:
    logger.warning(
        "[afd] refused a request's bearer token: rule=%s issuer=%s",
        refusal.rule,
        refusal.issuer if refusal.issuer is not None else "-",
    )


@dataclass
class _QueuedDispatch:
    """Single-use handoff for HTTP ``POST`` requests that answer ``202 Accepted``
    (SSE ``POST /messages/`` and Streamable HTTP notifications/responses) before
    the session loop executes the queued JSON-RPC message."""

    queued: bool = False
    finished: bool = False
    claimed: bool = False


@dataclass(frozen=True)
class _AdmittedAuth:
    layer: AuthLayer
    credentials: Credentials
    skew_s: int
    view: ScopeView | None = None
    handoff: _QueuedDispatch | None = None
    host_admitted: bool = False
    scopes: tuple[Mapping[str, Any], ...] = ()


_ADMITTED_AUTH: ContextVar[_AdmittedAuth | None] = ContextVar("afd_admitted_auth", default=None)
_TRUSTED_LAYERS: ContextVar[frozenset[AuthLayer]] = ContextVar(
    "afd_trusted_layers", default=frozenset()
)


@contextmanager
def bind_trusted_transport(layer: AuthLayer | None) -> Iterator[None]:
    """Mark the current async context as an explicitly trusted non-HTTP transport for ``layer`` (M1)."""
    if layer is None:
        yield
        return
    token = _TRUSTED_LAYERS.set(_TRUSTED_LAYERS.get() | {layer})
    try:
        yield
    finally:
        _TRUSTED_LAYERS.reset(token)


def is_trusted_transport(layer: AuthLayer) -> bool:
    """Whether the current async context is marked as a trusted transport for ``layer`` (M1)."""
    return layer in _TRUSTED_LAYERS.get()


def admitted_credentials_for(layer: AuthLayer) -> Credentials | None:
    """The verified credentials currently admitted for ``layer`` on this request, or ``None``."""
    admitted = _ADMITTED_AUTH.get()
    if (
        admitted is not None
        and admitted.layer is layer
        and _is_branded_credentials(admitted.credentials)
    ):
        return admitted.credentials
    return None


def admitted_view_for(layer: AuthLayer) -> ScopeView | None:
    """The :class:`ScopeView` currently admitted for ``layer`` on this request, or ``None``."""
    admitted = _ADMITTED_AUTH.get()
    if (
        admitted is not None
        and admitted.layer is layer
        and _is_branded_credentials(admitted.credentials)
    ):
        return admitted.view
    return None


@contextmanager
def claim_admitted_dispatch(layer: AuthLayer | None) -> Iterator[None]:
    """Claim a single-use HTTP ``202`` dispatch handoff for ``layer`` so the dispatched handler
    runs with a request-scoped verification brand that ends when the handler exits, and fails
    closed (clearing ``_ADMITTED_AUTH``) when an unqueued, replayed or expired handoff is
    rejected—even before the HTTP POST's ``finally`` runs (M1/M4)."""
    if layer is None:
        yield
        return
    admitted = _ADMITTED_AUTH.get()
    if admitted is None or admitted.layer is not layer or admitted.handoff is None:
        yield
        return
    handoff = admitted.handoff
    if not handoff.queued:
        # Synchronous HTTP 200 request currently in flight keeps its active brand.
        if not handoff.finished and _is_branded_credentials(admitted.credentials):
            yield
            return
        clear = _ADMITTED_AUTH.set(None)
        try:
            yield
        finally:
            _ADMITTED_AUTH.reset(clear)
        return
    if handoff.claimed:
        clear = _ADMITTED_AUTH.set(None)
        try:
            yield
        finally:
            _ADMITTED_AUTH.reset(clear)
        return
    handoff.claimed = True
    now_ms = layer._clock.now()
    deadline_ms = (admitted.credentials.expires_at + admitted.skew_s) * 1000
    if (isinstance(now_ms, float) and not math.isfinite(now_ms)) or now_ms >= deadline_ms:
        clear = _ADMITTED_AUTH.set(None)
        try:
            yield
        finally:
            _ADMITTED_AUTH.reset(clear)
        return
    fresh = _copy_credentials(admitted.credentials)
    _brand_verified_credentials(fresh, admitted.skew_s)
    fresh_view = admitted.view.with_credentials(fresh) if admitted.view is not None else None
    token = _ADMITTED_AUTH.set(
        _AdmittedAuth(layer=layer, credentials=fresh, skew_s=admitted.skew_s, view=fresh_view)
    )
    try:
        yield
    finally:
        _ADMITTED_AUTH.reset(token)
        _unbrand_verified_credentials(fresh)


def _is_whole(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _is_name(value: Any) -> bool:
    return isinstance(value, str) and value != ""


def _admissible(
    value: Any,
    *,
    resource: str,
    require_bound_tokens: bool,
    certificate: str | None,
    now: int,
    skew_s: int,
) -> Credentials | AuthRuleCode:
    """Return a fresh :class:`Credentials` copy when ``value`` has M4's shape for ``resource``
    and still holds on this request, else the rule code it breaks."""
    if not isinstance(value, Credentials):
        return "claims"
    cnf = value.cnf
    if (
        not _is_name(value.issuer)
        or not _is_name(value.subject)
        or not _is_name(value.client_id)
        or value.resource != resource
        or not _is_whole(value.expires_at)
        or not _is_whole(value.issued_at)
        or not isinstance(value.scopes, (list, tuple))
        or not all(is_scope_token(scope) for scope in value.scopes)
        or (value.auth_time is not None and not _is_whole(value.auth_time))
        or (value.acr is not None and not isinstance(value.acr, str))
        or (
            cnf is not None
            and (
                not isinstance(cnf, Mapping)
                or list(cnf.keys()) != ["x5t#S256"]
                or not _is_name(cnf.get("x5t#S256"))
            )
        )
    ):
        return "claims"

    if cnf is not None and cnf["x5t#S256"] != certificate:
        return "binding"
    if cnf is None and require_bound_tokens:
        return "binding"
    if now >= value.expires_at + skew_s:
        return "expired"

    deduped_scopes: list[str] = []
    seen: set[str] = set()
    for scope in value.scopes:
        if scope not in seen:
            seen.add(scope)
            deduped_scopes.append(scope)

    return Credentials(
        issuer=value.issuer,
        subject=value.subject,
        client_id=value.client_id,
        scopes=tuple(deduped_scopes),
        resource=resource,
        expires_at=value.expires_at,
        issued_at=value.issued_at,
        auth_time=value.auth_time,
        acr=value.acr,
        cnf={"x5t#S256": cnf["x5t#S256"]} if cnf is not None else None,
    )


def _header_values(scope: Mapping[str, Any], name: bytes) -> list[str]:
    raw_headers = scope.get("headers") or ()
    target = name.lower()
    values: list[str] = []
    for key, value in raw_headers:
        if isinstance(key, (bytes, bytearray)) and bytes(key).lower() == target:
            values.append(bytes(value).decode("latin-1"))
    return values


def _is_form_body(scope: Mapping[str, Any]) -> bool:
    for value in _header_values(scope, b"content-type"):
        media = value.split(";", 1)[0].strip().lower()
        if media == "application/x-www-form-urlencoded":
            return True
    return False


def _is_json_body(scope: Mapping[str, Any]) -> bool:
    for value in _header_values(scope, b"content-type"):
        media = value.split(";", 1)[0].strip().lower()
        if media == "application/json":
            return True
    return False


def _unwrap_scope(request_or_scope: Any) -> Mapping[str, Any]:
    if isinstance(request_or_scope, Mapping):
        return request_or_scope
    scope = getattr(request_or_scope, "scope", None)
    if isinstance(scope, Mapping):
        return scope
    raise ValueError("[AFD] expected an ASGI scope mapping or Starlette Request")


def _query_string(scope: Mapping[str, Any]) -> str | None:
    raw_query = scope.get("query_string", b"")
    if isinstance(raw_query, (bytes, bytearray)) and raw_query:
        return bytes(raw_query).decode("latin-1")
    if isinstance(raw_query, str) and raw_query:
        return raw_query
    return None


async def _read_body_bytes(
    scope: Mapping[str, Any], receive: Callable[[], Any], max_bytes: int
) -> bytes | None:
    """Read an HTTP request body up to ``max_bytes``; ``None`` if over cap."""
    for raw_len in _header_values(scope, b"content-length"):
        try:
            length = int(raw_len.strip())
        except ValueError:
            continue
        if length > max_bytes:
            return None
    chunks: list[bytes] = []
    size = 0
    while True:
        message = await receive()
        if message.get("type") != "http.request":
            break
        chunk = message.get("body", b"")
        if chunk:
            size += len(chunk)
            if size > max_bytes:
                return None
            chunks.append(bytes(chunk))
        if not message.get("more_body", False):
            break
    return b"".join(chunks)


def _replay_receive(body: bytes, original_receive: Any) -> Any:
    """ASGI ``receive`` delivering a preread ``body`` once, then delegating disconnect events."""
    delivered = False

    async def receive() -> dict[str, Any]:
        nonlocal delivered
        if not delivered:
            delivered = True
            return {"type": "http.request", "body": body, "more_body": False}
        return await original_receive()

    return receive


async def _send_pre_dispatch(send: Callable[[dict[str, Any]], Any], pre: PreDispatch) -> None:
    assert pre.status is not None
    payload = pre.body.encode("utf-8")
    headers = [
        (name.lower().encode("latin-1"), value.encode("latin-1"))
        for name, value in pre.headers.items()
    ]
    headers.append((b"content-length", str(len(payload)).encode("ascii")))
    await send({"type": "http.response.start", "status": pre.status, "headers": headers})
    await send({"type": "http.response.body", "body": payload, "more_body": False})


def _strip_authorization(scope: Mapping[str, Any]) -> dict[str, Any]:
    raw_headers = scope.get("headers") or ()
    cleaned = [
        (key, value)
        for key, value in raw_headers
        if not (isinstance(key, (bytes, bytearray)) and bytes(key).lower() == b"authorization")
    ]
    return {**scope, "headers": cleaned}


def _certificate_thumbprint(scope: Mapping[str, Any]) -> str | None:
    """SHA-256 thumbprint (unpadded base64url, RFC 8705 3.1) of the TLS client certificate
    from ASGI's ``extensions["tls"]`` when present."""
    extensions = scope.get("extensions")
    if not isinstance(extensions, Mapping):
        return None
    tls = extensions.get("tls")
    if not isinstance(tls, Mapping):
        return None
    chain = tls.get("client_cert_chain")
    if not isinstance(chain, Sequence) or isinstance(chain, (str, bytes)) or not chain:
        return None
    leaf = chain[0]
    der: bytes | None = None
    if isinstance(leaf, (bytes, bytearray)):
        raw = bytes(leaf)
        if raw.startswith(b"-----BEGIN"):
            der = _pem_to_der(raw.decode("ascii", errors="ignore"))
        elif raw:
            der = raw
    elif isinstance(leaf, str) and leaf:
        der = _pem_to_der(leaf)
    if not der:
        return None
    return base64.urlsafe_b64encode(hashlib.sha256(der).digest()).rstrip(b"=").decode("ascii")


def _pem_to_der(pem: str) -> bytes | None:
    lines = [
        line.strip()
        for line in pem.splitlines()
        if line.strip() and not line.strip().startswith("-----")
    ]
    if not lines:
        return None
    try:
        return base64.b64decode("".join(lines), validate=True)
    except ValueError:
        return None


async def _send_json(
    send: Callable[[dict[str, Any]], Any],
    status: int,
    body: Any,
    extra_headers: Sequence[tuple[bytes, bytes]] = (),
) -> None:
    payload = json.dumps(body).encode("utf-8")
    headers = [
        (b"content-type", b"application/json"),
        (b"content-length", str(len(payload)).encode("ascii")),
        *extra_headers,
    ]
    await send({"type": "http.response.start", "status": status, "headers": headers})
    await send({"type": "http.response.body", "body": payload, "more_body": False})


async def _send_empty(
    send: Callable[[dict[str, Any]], Any],
    status: int,
    extra_headers: Sequence[tuple[bytes, bytes]] = (),
) -> None:
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": [(b"content-length", b"0"), *extra_headers],
        }
    )
    await send({"type": "http.response.body", "body": b"", "more_body": False})


async def _read_form_body(
    scope: Mapping[str, Any], receive: Callable[[], Any], max_bytes: int
) -> str | None:
    """Read a form-encoded body up to ``max_bytes`` as Latin-1 text; ``None`` if over cap."""
    for raw_len in _header_values(scope, b"content-length"):
        try:
            length = int(raw_len.strip())
        except ValueError:
            continue
        if length > max_bytes:
            return None
    chunks: list[bytes] = []
    size = 0
    while True:
        message = await receive()
        if message.get("type") != "http.request":
            break
        chunk = message.get("body", b"")
        if chunk:
            size += len(chunk)
            if size > max_bytes:
                return None
            chunks.append(bytes(chunk))
        if not message.get("more_body", False):
            break
    return b"".join(chunks).decode("latin-1")


def _sdk_authenticated_user(credentials: Credentials) -> Any:
    """Build a tokenless SDK ``AuthenticatedUser`` so stateful Streamable HTTP and SSE
    transports enforce ``(client_id, issuer, subject)`` session ownership without ever
    placing the raw bearer token into ASGI ``scope``."""
    try:
        from mcp.server.auth.middleware.bearer_auth import AuthenticatedUser
        from mcp.server.auth.provider import AccessToken
    except ImportError:  # pragma: no cover - optional server dependency
        return None
    return AuthenticatedUser(
        AccessToken(
            token="",
            client_id=credentials.client_id,
            scopes=list(credentials.scopes),
            expires_at=credentials.expires_at,
            resource=credentials.resource,
            subject=credentials.subject,
            claims={"iss": credentials.issuer},
        )
    )


def _request_path(scope: Mapping[str, Any]) -> str:
    """The request path before percent-decoding (``raw_path`` when present), else ``path``."""
    raw_path = scope.get("raw_path")
    if isinstance(raw_path, (bytes, bytearray)) and raw_path:
        return bytes(raw_path).split(b"?", 1)[0].decode("latin-1")
    path = scope.get("path", "")
    return path if isinstance(path, str) else ""


class PreDispatchCheck:
    """The decision before dispatch for a host's own HTTP layer (``spec/authorization.md``, M6):
    runs the bearer layer's own implementation, so the two cannot drift."""

    def __init__(
        self,
        layer: AuthLayer,
        *,
        max_body_bytes: int,
        challenge: ScopeChallenge | None = None,
        scope_source: str | None = None,
    ) -> None:
        self._layer = layer
        self._max_body_bytes = max_body_bytes
        self._challenge = challenge
        self._scope_source = scope_source

    @property
    def max_body_bytes(self) -> int:
        """The largest body the decision reads; read at most this many bytes plus one before it."""
        return self._max_body_bytes

    def decide(self, request_or_scope: Any, body: bytes | bytearray | str) -> PreDispatch:
        """Decide ``request_or_scope`` (ASGI scope or Starlette Request) whose body the host has
        read, after admitting credentials with ``server.admit(...)``."""
        raw_bytes = (
            body.encode("utf-8")
            if isinstance(body, str)
            else bytes(body)
        )
        if len(raw_bytes) > self._max_body_bytes:
            return body_too_large()

        scope = _unwrap_scope(request_or_scope)
        admitted = _ADMITTED_AUTH.get()
        if (
            admitted is None
            or admitted.layer is not self._layer
            or not _is_branded_credentials(admitted.credentials)
            or not any(scope is admitted_scope for admitted_scope in admitted.scopes)
        ):
            return PROCEED

        view = admitted.view
        if view is None:
            return PROCEED

        method = (scope.get("method") or "GET").upper()
        path = _request_path(scope)
        if method == "GET" and path == "/sse":
            decision = view.decide_request()
            if decision == "proceed":
                return PROCEED
            return forbidden_response(
                self._layer.protected_resource,
                decision.forbidden,
                challenge=self._challenge,
                scope_source=self._scope_source,
            )

        if method != "POST" or not _is_json_body(scope):
            return PROCEED

        try:
            text = raw_bytes.decode("utf-8")
        except UnicodeDecodeError:
            return PROCEED

        return decide_body(
            view,
            text,
            self._layer.protected_resource,
            challenge=self._challenge,
            scope_source=self._scope_source,
        )


class AuthLayer:
    """The authorization layer of one AFD MCP server."""

    def __init__(
        self,
        *,
        protected_resource: ProtectedResource,
        verifier: TokenVerifier,
        clock: Clock,
        on_refusal: Callable[[AuthRefusal], None],
        skew_s: int,
        require_bound_tokens: bool,
        max_form_body_bytes: int,
        required_scopes: tuple[str, ...] = (),
        resolver: ScopeResolver | None = None,
        filter_tools_by_scope: bool = False,
        get_scope_authority: Callable[[], ScopeAuthority] | None = None,
    ) -> None:
        self.protected_resource = protected_resource
        self.required_scopes = required_scopes
        self.resolver = resolver
        self.filter_tools_by_scope = filter_tools_by_scope
        self._verifier = verifier
        self._clock = clock
        self._on_refusal = on_refusal
        self._skew_s = skew_s
        self._require_bound_tokens = require_bound_tokens
        self._max_form_body_bytes = max_form_body_bytes
        self._get_scope_authority = get_scope_authority

    def _build_view(self, credentials: Credentials) -> ScopeView | None:
        if self._get_scope_authority is None:
            return None
        return self._get_scope_authority().view(credentials)

    def _report_refusal(self, rule: str, issuer: str | None = None) -> None:
        safe_rule = rule if _SAFE_RULE.match(rule) is not None else "host"
        safe_issuer = (
            None
            if issuer is None
            else (issuer if _SAFE_ALIAS.match(issuer) is not None else "host")
        )
        try:
            self._on_refusal(AuthRefusal(rule=safe_rule, issuer=safe_issuer))
        except Exception:
            pass

    async def _send_unauthorized(
        self,
        send: Callable[[dict[str, Any]], Any],
        rule: str,
        issuer: str | None = None,
    ) -> None:
        self._report_refusal(rule, issuer)
        challenge = self.protected_resource.unauthorized_challenge(rule != "no-token")
        await _send_json(
            send,
            401,
            self.protected_resource.unauthorized_body(),
            extra_headers=[(b"www-authenticate", challenge.encode("latin-1"))],
        )

    @contextmanager
    def host_admit(self, request_or_scope: Any, credentials: Credentials) -> Iterator[Credentials]:
        """Admit ``credentials`` a host's own HTTP layer vouches for, for this request alone (M6)."""
        scope = _unwrap_scope(request_or_scope)
        query = _query_string(scope)
        if _header_values(scope, b"authorization") or (
            query is not None and names_access_token(query)
        ):
            raise ValueError(
                "[AFD] admit refuses a request that carries a bearer token: "
                "one request has one source of credentials"
            )
        existing = _ADMITTED_AUTH.get()
        if (
            existing is not None
            and existing.layer is self
            and _is_branded_credentials(existing.credentials)
            and any(scope is admitted_scope for admitted_scope in existing.scopes)
        ):
            raise ValueError(
                "[AFD] admit refuses a request whose credentials were admitted before"
            )
        now = math.floor(self._clock.now() / 1000)
        checked = _admissible(
            credentials,
            resource=self.protected_resource.resource,
            require_bound_tokens=self._require_bound_tokens,
            certificate=_certificate_thumbprint(scope),
            now=now,
            skew_s=0,
        )
        if isinstance(checked, str):
            raise ValueError(f"[AFD] admit refuses the credentials: rule {checked}")

        _brand_verified_credentials(checked, 0)
        ctx_token = None
        try:
            view = self._build_view(checked)
            ctx_token = _ADMITTED_AUTH.set(
                _AdmittedAuth(
                    layer=self,
                    credentials=checked,
                    skew_s=0,
                    view=view,
                    host_admitted=True,
                    scopes=(scope,),
                )
            )
            yield checked
        finally:
            if ctx_token is not None:
                _ADMITTED_AUTH.reset(ctx_token)
            _unbrand_verified_credentials(checked)

    def pre_dispatch_check(
        self,
        *,
        challenge: ScopeChallenge | None = None,
        scope_source: str | None = None,
        max_body_bytes: int | None = None,
    ) -> PreDispatchCheck:
        """Build a :class:`PreDispatchCheck` running the bearer layer's own decision before
        dispatch (``spec/authorization.md``, M6)."""
        if challenge is not None and not isinstance(challenge, ScopeChallenge):
            raise ValueError("[AFD] challenge must be a ScopeChallenge instance")
        if scope_source is not None and not isinstance(scope_source, str):
            raise ValueError("[AFD] scope_source must be a string")
        cap = _DEFAULT_MAX_JSON_BODY_BYTES if max_body_bytes is None else max_body_bytes
        if isinstance(cap, bool) or not isinstance(cap, int) or cap < 1:
            raise ValueError("[AFD] max_body_bytes must be a positive integer")
        return PreDispatchCheck(
            self,
            max_body_bytes=cap,
            challenge=challenge,
            scope_source=scope_source,
        )

    def wrap_asgi_app(
        self,
        app: Any,
        *,
        max_body_bytes: int | None = None,
        decide_post_body: bool = True,
    ) -> Any:
        """Wrap an ASGI application (Streamable HTTP or SSE) with AFD's bearer layer."""
        json_cap = (
            _DEFAULT_MAX_JSON_BODY_BYTES if max_body_bytes is None else max_body_bytes
        )
        return _BearerAuthAsgiApp(
            self,
            app,
            form_body_cap=self._max_form_body_bytes,
            json_body_cap=json_cap,
            decide_post_body=decide_post_body,
        )


class _BearerAuthAsgiApp:
    """ASGI wrapper enforcing AFD's bearer layer while proxying Starlette attributes (e.g. ``router``)."""

    def __init__(
        self,
        layer: AuthLayer,
        app: Any,
        *,
        form_body_cap: int,
        json_body_cap: int,
        decide_post_body: bool = True,
    ) -> None:
        self._layer = layer
        self._app = app
        self._form_body_cap = form_body_cap
        self._json_body_cap = json_body_cap
        self._decide_post_body = decide_post_body

    def __getattr__(self, name: str) -> Any:
        return getattr(self._app, name)

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        layer = self._layer
        scope_type = scope.get("type")
        if scope_type == "lifespan":
            await self._app(scope, receive, send)
            return
        if scope_type != "http":
            # Fail closed on non-HTTP ASGI protocols (e.g., raw websockets).
            await send({"type": "websocket.close", "code": 1008})
            return

        path = _request_path(scope)
        method = (scope.get("method") or "GET").upper()

        # M7: protected-resource metadata is public, GET only.
        if path in layer.protected_resource.metadata_paths:
            if method != "GET":
                await _send_empty(send, 405, extra_headers=[(b"allow", b"GET")])
                return
            await _send_json(send, 200, layer.protected_resource.document())
            return

        # A host's own layer vouched for this caller via server.admit(...): its credentials,
        # and its own decision before dispatch (server.pre_dispatch_check), stand for bearer auth.
        existing = _ADMITTED_AUTH.get()
        if (
            existing is not None
            and existing.layer is layer
            and existing.host_admitted
            and _is_branded_credentials(existing.credentials)
            and any(scope is admitted_scope for admitted_scope in existing.scopes)
        ):
            query = _query_string(scope)
            if _header_values(scope, b"authorization") or (
                query is not None and names_access_token(query)
            ):
                await layer._send_unauthorized(send, "token-location")
                return
            # Non-POST routes handled directly by the ASGI transport (GET/DELETE /mcp, GET /sse)
            # do not pass through JSON-RPC pre_boundary, so enforce required_scopes here too.
            if existing.view is not None and (
                (self._decide_post_body and method != "POST")
                or (not self._decide_post_body and method == "GET")
            ):
                req_dec = existing.view.decide_request()
                if req_dec != "proceed":
                    await _send_pre_dispatch(
                        send,
                        forbidden_response(layer.protected_resource, req_dec.forbidden),
                    )
                    return
            cleaned_scope = dict(scope)
            sdk_user = _sdk_authenticated_user(existing.credentials)
            if sdk_user is not None:
                cleaned_scope["user"] = sdk_user
            else:
                cleaned_scope.pop("user", None)
            handoff = _QueuedDispatch() if method == "POST" else None

            async def _observe_host_send(message: dict[str, Any]) -> None:
                if (
                    handoff is not None
                    and message.get("type") == "http.response.start"
                    and message.get("status") == 202
                ):
                    handoff.queued = True
                await send(message)

            ctx_token = _ADMITTED_AUTH.set(
                _AdmittedAuth(
                    layer=layer,
                    credentials=existing.credentials,
                    skew_s=existing.skew_s,
                    view=existing.view,
                    handoff=handoff,
                    host_admitted=True,
                    scopes=(*existing.scopes, cleaned_scope),
                )
            )
            try:
                await self._app(
                    cleaned_scope, receive, _observe_host_send if handoff is not None else send
                )
            finally:
                if handoff is not None:
                    handoff.finished = True
                _ADMITTED_AUTH.reset(ctx_token)
            return

        # M2: read form body when Content-Type is application/x-www-form-urlencoded.
        form_body: str | None = None
        if _is_form_body(scope):
            form_body = await _read_form_body(scope, receive, self._form_body_cap)
            if form_body is None:
                await _send_json(send, 413, {"error": "Request body is too large"})
                return

        query = _query_string(scope)
        auth_headers = _header_values(scope, b"authorization")
        bearer = extract_bearer(auth_headers, query, form_body)
        if isinstance(bearer, BearerRefusal):
            await layer._send_unauthorized(send, bearer.refused)
            return

        # M2: strip Authorization before the request can reach any downstream handler.
        cleaned_scope = _strip_authorization(scope)

        # M3: verify, then forget the token.
        certificate = _certificate_thumbprint(cleaned_scope)
        try:
            verification = await layer._verifier.verify(
                bearer.token, TokenRequest(certificate=certificate)
            )
        except Exception:
            await layer._send_unauthorized(send, "unavailable")
            return
        if not verification.ok:
            await layer._send_unauthorized(send, verification.rule, verification.issuer)
            return

        now = math.floor(layer._clock.now() / 1000)
        admitted = _admissible(
            verification.credentials,
            resource=layer.protected_resource.resource,
            require_bound_tokens=layer._require_bound_tokens,
            certificate=certificate,
            now=now,
            skew_s=layer._skew_s,
        )
        if isinstance(admitted, str):
            await layer._send_unauthorized(send, admitted)
            return

        # Every MCP HTTP route takes JSON; a form body has served its one purpose (M2).
        if form_body is not None:
            await _send_json(send, 415, {"error": "Content-Type must be application/json"})
            return

        _brand_verified_credentials(admitted, layer._skew_s)
        handoff: _QueuedDispatch | None = None
        ctx_token = None
        try:
            view = layer._build_view(admitted)
            next_receive = receive

            # M6: the 403 before dispatch (and 400 -32600 for JSON-RPC batches).
            if view is not None:
                if self._decide_post_body:
                    if method == "POST" and _is_json_body(cleaned_scope):
                        raw_body = await _read_body_bytes(
                            cleaned_scope, receive, self._json_body_cap
                        )
                        if raw_body is None:
                            await _send_pre_dispatch(send, body_too_large())
                            return
                        try:
                            text = raw_body.decode("utf-8")
                        except UnicodeDecodeError:
                            pre = PROCEED
                        else:
                            pre = decide_body(view, text, layer.protected_resource)
                        if not pre.proceed:
                            await _send_pre_dispatch(send, pre)
                            return
                        next_receive = _replay_receive(raw_body, receive)
                    elif method != "POST":
                        req_dec = view.decide_request()
                        if req_dec != "proceed":
                            await _send_pre_dispatch(
                                send,
                                forbidden_response(layer.protected_resource, req_dec.forbidden),
                            )
                            return
                elif method == "GET":
                    req_dec = view.decide_request()
                    if req_dec != "proceed":
                        await _send_pre_dispatch(
                            send,
                            forbidden_response(layer.protected_resource, req_dec.forbidden),
                        )
                        return

            sdk_user = _sdk_authenticated_user(admitted)
            if sdk_user is not None:
                cleaned_scope["user"] = sdk_user
            else:
                cleaned_scope.pop("user", None)

            handoff = _QueuedDispatch() if method == "POST" else None

            async def _observe_send(message: dict[str, Any]) -> None:
                if (
                    handoff is not None
                    and message.get("type") == "http.response.start"
                    and message.get("status") == 202
                ):
                    handoff.queued = True
                await send(message)

            ctx_token = _ADMITTED_AUTH.set(
                _AdmittedAuth(
                    layer=layer,
                    credentials=admitted,
                    skew_s=layer._skew_s,
                    view=view,
                    handoff=handoff,
                    scopes=(scope, cleaned_scope),
                )
            )
            await self._app(
                cleaned_scope, next_receive, _observe_send if handoff is not None else send
            )
        finally:
            if handoff is not None:
                handoff.finished = True
            if ctx_token is not None:
                _ADMITTED_AUTH.reset(ctx_token)
            _unbrand_verified_credentials(admitted)


def create_auth_layer(
    options: McpAuthOptions,
    *,
    clock: Clock | None = None,
    get_scope_authority: Callable[[], ScopeAuthority] | None = None,
) -> AuthLayer:
    """Validate ``options`` and build an :class:`AuthLayer` for one MCP server.

    Raises:
        ValueError: When options are invalid or disagree with ``verifier.rules`` / ``verifier.issuers``.
    """
    if not isinstance(options, McpAuthOptions):
        raise ValueError("[AFD] auth must be an McpAuthOptions instance")
    required_scopes = validate_scope_list("auth.required_scopes", options.required_scopes)
    resolver = options.resolver
    if resolver is not None:
        if not callable(getattr(resolver, "resolve", None)) or not callable(
            getattr(resolver, "visible", None)
        ):
            raise ValueError("[AFD] auth.resolver must have resolve() and visible()")
        known_attr = getattr(resolver, "known", None)
        if known_attr is not None and not callable(known_attr):
            raise ValueError("[AFD] auth.resolver.known must be callable when present")
    if not isinstance(options.filter_tools_by_scope, bool):
        raise ValueError("[AFD] auth.filter_tools_by_scope must be a bool")

    verifier = options.verifier
    if not callable(getattr(verifier, "verify", None)):
        raise ValueError("[AFD] auth.verifier must be a TokenVerifier, such as a JwtVerifier")

    rules = getattr(verifier, "rules", None)
    if rules is not None:
        if not isinstance(rules, TokenRules):
            raise ValueError("[AFD] verifier.rules must be a TokenRules instance")
        if (
            isinstance(rules.clock_skew_s, bool)
            or not isinstance(rules.clock_skew_s, int)
            or rules.clock_skew_s < 0
            or rules.clock_skew_s > MAX_CLOCK_SKEW_S
        ):
            raise ValueError(
                f"[AFD] verifier.rules.clock_skew_s must be a whole number from 0 to {MAX_CLOCK_SKEW_S}"
            )
        if rules.resource != options.resource:
            raise ValueError(
                f"[AFD] the verifier accepts the audience {json.dumps(rules.resource)} "
                f"but auth.resource is {json.dumps(options.resource)}"
            )

    if options.require_bound_tokens is not None and not isinstance(
        options.require_bound_tokens, bool
    ):
        raise ValueError("[AFD] auth.require_bound_tokens must be a bool")

    require_bound_tokens = (
        options.require_bound_tokens
        if options.require_bound_tokens is not None
        else (rules.require_bound_tokens if rules is not None else False)
    )
    if rules is not None and rules.require_bound_tokens != require_bound_tokens:
        raise ValueError(
            "[AFD] the verifier and auth.require_bound_tokens disagree on whether "
            "certificate-bound tokens are required"
        )

    if (
        isinstance(options.max_form_body_bytes, bool)
        or not isinstance(options.max_form_body_bytes, int)
        or options.max_form_body_bytes < 1
    ):
        raise ValueError("[AFD] auth.max_form_body_bytes must be a positive integer")

    protected = create_protected_resource(
        options.resource,
        options.authorization_servers,
        scopes_supported=options.scopes_supported,
        resource_name=options.resource_name,
        require_bound_tokens=require_bound_tokens,
    )

    servers = set(protected.authorization_servers)
    verifier_issuers = getattr(verifier, "issuers", None)
    if verifier_issuers is not None:
        for issuer in verifier_issuers:
            if issuer not in servers:
                raise ValueError(
                    f"[AFD] the verifier accepts tokens from {json.dumps(issuer)}, "
                    "which auth.authorization_servers does not name"
                )

    on_refusal = options.on_refusal if options.on_refusal is not None else _default_refusal
    if not callable(on_refusal):
        raise ValueError("[AFD] auth.on_refusal must be callable")

    authority_provider = get_scope_authority
    if authority_provider is None:
        if resolver is not None or options.filter_tools_by_scope:
            raise ValueError(
                "[AFD] create_auth_layer with resolver or filter_tools_by_scope requires "
                "get_scope_authority (use create_server(..., auth=...))"
            )
        default_authority = ScopeAuthority(
            required_scopes=required_scopes,
            resolver=None,
            filter_tools_by_scope=False,
            commands=(),
            tool_strategy="individual",
            group_by_fn=None,
            resource=protected,
        )
        authority_provider = lambda: default_authority  # noqa: E731

    skew_s = rules.clock_skew_s if rules is not None else 0
    return AuthLayer(
        protected_resource=protected,
        verifier=verifier,
        clock=clock or system_clock,
        on_refusal=on_refusal,
        skew_s=skew_s,
        require_bound_tokens=require_bound_tokens,
        max_form_body_bytes=options.max_form_body_bytes,
        required_scopes=required_scopes,
        resolver=resolver,
        filter_tools_by_scope=options.filter_tools_by_scope,
        get_scope_authority=authority_provider,
    )


__all__ = [
    "AuthLayer",
    "AuthRefusal",
    "McpAuthOptions",
    "PreDispatchCheck",
    "admitted_credentials_for",
    "admitted_view_for",
    "bind_trusted_transport",
    "claim_admitted_dispatch",
    "create_auth_layer",
    "credentials_actor",
    "is_trusted_transport",
]
