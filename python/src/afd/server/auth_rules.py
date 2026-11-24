"""Token rules that need no key and no network (``spec/authorization.md``, M3 rules 2,
3 and 5 to 10, M3.2 and M4), shared by AFD's JWT verifier and a host's introspection verifier.

Each rule is checked here explicitly, in the specification's order: no library default is
relied on. Also holds the request-scoped verification brand for :class:`Credentials`.
"""

from __future__ import annotations

import math
import time
import types
import unicodedata
import weakref
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Generic, Literal, TypeGuard, TypeVar

from afd.server.auth_resource import assert_https_url, audience_accepts, is_scope_token

AuthRuleCode = Literal[
    "no-token",
    "token-location",
    "token-malformed",
    "unknown-issuer",
    "typ",
    "alg",
    "kid",
    "crit",
    "key-reference",
    "key",
    "signature",
    "issuer",
    "audience",
    "claims",
    "expired",
    "not-yet-valid",
    "lifetime",
    "scope-malformed",
    "scopes-too-many",
    "dpop-unsupported",
    "binding",
    "inactive",
    "unavailable",
]
"""The rule a refused token or request broke (``spec/authorization.md``, M5). Logged, never sent."""

AUTH_RULE_CODES: tuple[AuthRuleCode, ...] = (
    "no-token",
    "token-location",
    "token-malformed",
    "unknown-issuer",
    "typ",
    "alg",
    "kid",
    "crit",
    "key-reference",
    "key",
    "signature",
    "issuer",
    "audience",
    "claims",
    "expired",
    "not-yet-valid",
    "lifetime",
    "scope-malformed",
    "scopes-too-many",
    "dpop-unsupported",
    "binding",
    "inactive",
    "unavailable",
)
"""Every rule code, in the specification's order."""

SigningAlgorithm = Literal[
    "RS256",
    "RS384",
    "RS512",
    "PS256",
    "PS384",
    "PS512",
    "ES256",
    "ES384",
    "EdDSA",
]
"""The JWS algorithms AFD's verifier can check. ``none`` and ``HS*`` are always refused."""

SIGNING_ALGORITHMS: tuple[SigningAlgorithm, ...] = (
    "RS256",
    "RS384",
    "RS512",
    "PS256",
    "PS384",
    "PS512",
    "ES256",
    "ES384",
    "EdDSA",
)
"""Every :data:`SigningAlgorithm`."""

MAX_CLOCK_SKEW_S = 300
"""The largest clock skew a verifier may allow, in seconds."""

DEFAULT_CLOCK_SKEW_S = 60
"""The default clock skew, in seconds."""

DEFAULT_MAX_TOKEN_LIFETIME_S = 3600
"""The default longest token lifetime (``exp - iat``), in seconds."""

DEFAULT_SCOPE_LIMIT = 64
"""The default scope limit."""

MAX_CLAIM_CHARS = 255
"""The most Unicode code points a ``jti``, ``sub``, ``client_id`` or ``acr`` may hold."""

_MAX_SAFE_INT = 2**53 - 1
_ABSENT = object()

T = TypeVar("T")


@dataclass(frozen=True)
class Credentials:
    """The verified claims of one request's access token (``spec/authorization.md``, M4):
    what a command sees as ``context.credentials`` on a call the server verified. Never the token.

    ``repr`` and ``str`` print ``[redacted]`` for every field except ``issuer`` and ``expires_at``.
    """

    issuer: str
    subject: str
    client_id: str
    scopes: tuple[str, ...]
    resource: str
    expires_at: int
    issued_at: int
    auth_time: int | None = None
    acr: str | None = None
    cnf: Mapping[str, str] | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.scopes, tuple):
            object.__setattr__(self, "scopes", tuple(self.scopes))
        if self.cnf is not None and not isinstance(self.cnf, types.MappingProxyType):
            object.__setattr__(self, "cnf", types.MappingProxyType(dict(self.cnf)))

    def __repr__(self) -> str:
        parts = [
            f"issuer={self.issuer!r}",
            "subject='[redacted]'",
            "client_id='[redacted]'",
            "scopes='[redacted]'",
            "resource='[redacted]'",
            f"expires_at={self.expires_at!r}",
            "issued_at='[redacted]'",
        ]
        if self.auth_time is not None:
            parts.append("auth_time='[redacted]'")
        if self.acr is not None:
            parts.append("acr='[redacted]'")
        if self.cnf is not None:
            parts.append("cnf='[redacted]'")
        return f"Credentials({', '.join(parts)})"

    __str__ = __repr__

    def to_wire(self) -> dict[str, Any]:
        """The credentials as camelCase JSON matching ``spec/authorization.json``."""
        data: dict[str, Any] = {
            "issuer": self.issuer,
            "subject": self.subject,
            "clientId": self.client_id,
            "scopes": list(self.scopes),
            "resource": self.resource,
            "expiresAt": self.expires_at,
            "issuedAt": self.issued_at,
        }
        if self.auth_time is not None:
            data["authTime"] = self.auth_time
        if self.acr is not None:
            data["acr"] = self.acr
        if self.cnf is not None:
            data["cnf"] = dict(self.cnf)
        return data


# Identity-keyed brand registry: keyed by ``id(credentials)`` with a ``weakref.ref`` and an
# identity check (``ref() is credentials``), never value equality, so a forged ``Credentials``
# instance with equal fields or a shallow copy never passes ``is_verified_credentials``.
_VERIFIED_BRANDS: dict[int, tuple[weakref.ref[Credentials], int | float]] = {}


def _copy_credentials(credentials: Credentials) -> Credentials:
    """Internal: return an unbranded shallow value copy of ``credentials``."""
    return Credentials(
        issuer=credentials.issuer,
        subject=credentials.subject,
        client_id=credentials.client_id,
        scopes=tuple(credentials.scopes),
        resource=credentials.resource,
        expires_at=credentials.expires_at,
        issued_at=credentials.issued_at,
        auth_time=credentials.auth_time,
        acr=credentials.acr,
        cnf=dict(credentials.cnf) if credentials.cnf is not None else None,
    )


def _brand_verified_credentials(credentials: Credentials, skew_s: int = 0) -> Credentials:
    """Internal: mark ``credentials`` as verified by AFD's auth layer until unbranded or expired."""
    expires_at = credentials.expires_at
    if (
        isinstance(expires_at, int)
        and not isinstance(expires_at, bool)
        and isinstance(skew_s, int)
        and not isinstance(skew_s, bool)
        and skew_s >= 0
    ):
        deadline_ms: int | float = (expires_at + skew_s) * 1000
    else:
        deadline_ms = math.nan
    obj_id = id(credentials)

    def _cleanup(_ref: weakref.ref[Credentials], *, key: int = obj_id) -> None:
        entry = _VERIFIED_BRANDS.get(key)
        if entry is not None and entry[0] is _ref:
            _VERIFIED_BRANDS.pop(key, None)

    _VERIFIED_BRANDS[obj_id] = (weakref.ref(credentials, _cleanup), deadline_ms)
    return credentials


def _unbrand_verified_credentials(credentials: Credentials) -> None:
    """Internal: remove the verification brand when the request or task ends."""
    obj_id = id(credentials)
    entry = _VERIFIED_BRANDS.get(obj_id)
    if entry is not None and entry[0]() is credentials:
        _VERIFIED_BRANDS.pop(obj_id, None)


def _is_branded_credentials(credentials: Any) -> bool:
    """Internal: whether ``credentials`` currently holds an active (unrevoked) brand."""
    if not isinstance(credentials, Credentials):
        return False
    entry = _VERIFIED_BRANDS.get(id(credentials))
    return entry is not None and entry[0]() is credentials


def _clone_verified_credentials(credentials: Credentials) -> Credentials | None:
    """Internal: clone branded credentials with the same deadline (for background tasks)."""
    entry = _VERIFIED_BRANDS.get(id(credentials))
    if entry is None or entry[0]() is not credentials:
        return None
    deadline_ms = entry[1]
    cloned = _copy_credentials(credentials)
    obj_id = id(cloned)

    def _cleanup(_ref: weakref.ref[Credentials], *, key: int = obj_id) -> None:
        current = _VERIFIED_BRANDS.get(key)
        if current is not None and current[0] is _ref:
            _VERIFIED_BRANDS.pop(key, None)

    _VERIFIED_BRANDS[obj_id] = (weakref.ref(cloned, _cleanup), deadline_ms)
    return cloned


def is_verified_credentials(credentials: Any, now_ms: float | None = None) -> bool:
    """Whether ``credentials`` is the exact object AFD's auth layer put on a call after
    verifying its token, and its admitted expiry (``expires_at`` plus any admission clock
    skew, M4) is still after ``now_ms`` (default: current wall time in epoch milliseconds).

    A copy, a freshly constructed ``Credentials`` with identical fields, and credentials whose
    request has ended all return ``False``.
    """
    if not isinstance(credentials, Credentials):
        return False
    entry = _VERIFIED_BRANDS.get(id(credentials))
    if entry is None or entry[0]() is not credentials:
        return False
    deadline_ms = entry[1]
    if isinstance(deadline_ms, float) and not math.isfinite(deadline_ms):
        return False
    now = time.time() * 1000.0 if now_ms is None else now_ms
    if isinstance(now, float) and not math.isfinite(now):
        return False
    return deadline_ms > now


@dataclass(frozen=True)
class TokenRules:
    """The rules a verified token's claims must pass (M3 rules 6 to 10), checked and frozen."""

    resource: str
    clock_skew_s: int = DEFAULT_CLOCK_SKEW_S
    max_token_lifetime_s: int = DEFAULT_MAX_TOKEN_LIFETIME_S
    scope_prefix: str | None = None
    scope_limit: int = DEFAULT_SCOPE_LIMIT
    require_bound_tokens: bool = False


def _whole_number(what: str, value: Any, minimum: int, maximum: int = _MAX_SAFE_INT) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum or value > maximum:
        raise ValueError(f"[AFD] {what} must be a whole number from {minimum} to {maximum}")
    return value


def create_token_rules(
    resource: str,
    *,
    clock_skew_s: int = DEFAULT_CLOCK_SKEW_S,
    max_token_lifetime_s: int = DEFAULT_MAX_TOKEN_LIFETIME_S,
    scope_prefix: str | None = None,
    scope_limit: int = DEFAULT_SCOPE_LIMIT,
    require_bound_tokens: bool = False,
) -> TokenRules:
    """Create and validate claim rules for tokens whose audience is ``resource``.

    Raises:
        ValueError: When ``resource`` is not an absolute ``https`` URL without userinfo, query
            or fragment, ``clock_skew_s`` is outside ``0..300``, ``max_token_lifetime_s`` or
            ``scope_limit`` is under 1, or ``scope_prefix`` is not a scope token.
    """
    assert_https_url("resource", resource)
    if scope_prefix is not None and not is_scope_token(scope_prefix):
        raise ValueError(f"[AFD] scope prefix {scope_prefix!r} is not an OAuth scope token")
    if not isinstance(require_bound_tokens, bool):
        raise ValueError("[AFD] require_bound_tokens must be a bool")
    return TokenRules(
        resource=resource,
        clock_skew_s=_whole_number("clock_skew_s", clock_skew_s, 0, MAX_CLOCK_SKEW_S),
        max_token_lifetime_s=_whole_number("max_token_lifetime_s", max_token_lifetime_s, 1),
        scope_prefix=scope_prefix,
        scope_limit=_whole_number("scope_limit", scope_limit, 1),
        require_bound_tokens=require_bound_tokens,
    )


@dataclass(frozen=True)
class RuleOk(Generic[T]):
    """A passing rule outcome."""

    value: T

    @property
    def ok(self) -> Literal[True]:
        return True


@dataclass(frozen=True)
class RuleRefusal:
    """A failing rule outcome with the M5 rule code."""

    rule: AuthRuleCode

    @property
    def ok(self) -> Literal[False]:
        return False


RuleResult = RuleOk[T] | RuleRefusal


def parse_scope_claim(
    scope: Any = _ABSENT,
    prefix: str | None = None,
    limit: int = DEFAULT_SCOPE_LIMIT,
) -> RuleResult[list[str]]:
    """Parse a ``scope`` claim (``spec/authorization.md``, M3.2).

    Pass no ``scope`` argument (or omit the key) when the claim is absent; passing ``None``
    represents JSON ``null``, which is refused with ``scope-malformed``.
    """
    if scope is _ABSENT:
        return RuleOk([])
    if not isinstance(scope, str):
        return RuleRefusal("scope-malformed")
    if scope == "":
        return RuleOk([])
    scopes: list[str] = []
    seen: set[str] = set()
    for token in scope.split(" "):
        if not is_scope_token(token):
            return RuleRefusal("scope-malformed")
        if token not in seen:
            seen.add(token)
            scopes.append(token)
    if prefix is None:
        counted = len(scopes)
    else:
        wanted = f"{prefix}:"
        counted = sum(1 for held in scopes if held.startswith(wanted))
    if counted > limit:
        return RuleRefusal("scopes-too-many")
    return RuleOk(scopes)


_TYP = frozenset({"at+jwt", "application/at+jwt"})
_KEY_REFERENCES = ("jku", "x5u", "x5c", "jwk")


def check_jws_header(header: Any, algorithms: Sequence[str]) -> RuleResult[None]:
    """Rule 2 on a decoded JWS header, against the issuer's algorithm list: ``typ``, then
    ``alg``, ``kid``, ``crit`` and key references. ``none`` and ``HS*`` are always refused."""
    if not isinstance(header, Mapping):
        return RuleRefusal("typ")
    typ = header.get("typ")
    if not isinstance(typ, str) or typ.lower() not in _TYP:
        return RuleRefusal("typ")
    alg = header.get("alg")
    if not isinstance(alg, str) or alg == "none" or alg.startswith("HS") or alg not in algorithms:
        return RuleRefusal("alg")
    kid = header.get("kid")
    if not isinstance(kid, str) or kid == "":
        return RuleRefusal("kid")
    if "crit" in header:
        return RuleRefusal("crit")
    if any(member in header for member in _KEY_REFERENCES):
        return RuleRefusal("key-reference")
    return RuleOk(None)


def _key_fits(alg: str, kty: Any, crv: Any) -> bool:
    """The ``kty``, and ``crv`` when it matters, each algorithm needs (RFC 7518 3.4, RFC 8037 3.1)."""
    if alg in ("RS256", "RS384", "RS512", "PS256", "PS384", "PS512"):
        return bool(kty == "RSA")
    if alg == "ES256":
        return bool(kty == "EC" and crv == "P-256")
    if alg == "ES384":
        return bool(kty == "EC" and crv == "P-384")
    if alg == "ES512":
        return bool(kty == "EC" and crv == "P-521")
    if alg == "EdDSA":
        return bool(kty == "OKP" and crv in ("Ed25519", "Ed448"))
    return False


def check_key_fit(header: Any, key: Any) -> RuleResult[None]:
    """Rule 3 on a header that passed rule 2 and the issuer's key with its ``kid`` (``None``
    for none)."""
    if not isinstance(header, Mapping) or not isinstance(key, Mapping):
        return RuleRefusal("key")
    alg = header.get("alg")
    kid = header.get("kid")
    if not isinstance(alg, str) or not isinstance(kid, str) or key.get("kid") != kid:
        return RuleRefusal("key")
    if not _key_fits(alg, key.get("kty"), key.get("crv")):
        return RuleRefusal("key")
    if "alg" in key and key["alg"] != alg:
        return RuleRefusal("key")
    if "use" in key and key["use"] != "sig":
        return RuleRefusal("key")
    if "key_ops" in key:
        ops = key["key_ops"]
        if not isinstance(ops, (list, tuple)) or "verify" not in ops:
            return RuleRefusal("key")
    return RuleOk(None)


def _claim_text(value: Any) -> TypeGuard[str]:
    """A string claim of rule 7: non-empty, at most 255 Unicode code points, no Cc character."""
    if not isinstance(value, str) or value == "" or len(value) > MAX_CLAIM_CHARS:
        return False
    return not any(unicodedata.category(ch) == "Cc" for ch in value)


def _is_time(value: Any) -> TypeGuard[int | float]:
    if isinstance(value, bool):
        return False
    if isinstance(value, int):
        try:
            return math.isfinite(float(value))
        except OverflowError:
            return False
    return isinstance(value, float) and math.isfinite(value)


def check_claims(
    claims: Mapping[str, Any],
    issuer: str,
    rules: TokenRules,
    now: int | float,
    certificate: str | None = None,
) -> RuleResult[Credentials]:
    """Rules 5 to 10 on a token's claims after its signature (or on an introspection response),
    at ``now`` (seconds since the epoch), for ``issuer`` under ``rules``.

    ``certificate`` is the SHA-256 thumbprint (unpadded base64url) of the request's TLS client
    certificate, or ``None``.
    """
    # 5. Issuer.
    if claims.get("iss") != issuer:
        return RuleRefusal("issuer")
    # 6. Audience: never optional.
    if not audience_accepts(claims.get("aud"), rules.resource):
        return RuleRefusal("audience")
    # 7. Required claims.
    exp = claims.get("exp")
    iat = claims.get("iat")
    jti = claims.get("jti")
    sub = claims.get("sub")
    client_id = claims.get("client_id")
    if not _is_time(exp) or not _is_time(iat):
        return RuleRefusal("claims")
    if not _claim_text(jti) or not _claim_text(sub) or not _claim_text(client_id):
        return RuleRefusal("claims")
    nbf_present = "nbf" in claims
    nbf_val: int | float | None = None
    if nbf_present:
        raw_nbf = claims.get("nbf")
        if not _is_time(raw_nbf):
            return RuleRefusal("claims")
        nbf_val = raw_nbf
    auth_time_present = "auth_time" in claims
    auth_time_val: int | float | None = None
    if auth_time_present:
        raw_auth_time = claims.get("auth_time")
        if not _is_time(raw_auth_time):
            return RuleRefusal("claims")
        auth_time_val = raw_auth_time
    acr_present = "acr" in claims
    acr_val: str | None = None
    if acr_present:
        raw_acr = claims.get("acr")
        if not _claim_text(raw_acr):
            return RuleRefusal("claims")
        acr_val = raw_acr

    # 8. Time.
    skew = rules.clock_skew_s
    if now >= exp + skew:
        return RuleRefusal("expired")
    if iat > now + skew or (nbf_val is not None and nbf_val > now + skew):
        return RuleRefusal("not-yet-valid")
    if exp < iat or exp - iat > rules.max_token_lifetime_s:
        return RuleRefusal("lifetime")

    # 9. Scopes.
    scope_val = claims.get("scope", _ABSENT)
    scopes_result = parse_scope_claim(scope_val, rules.scope_prefix, rules.scope_limit)
    if not scopes_result.ok:
        return scopes_result

    # 10. Binding.
    thumbprint: str | None = None
    if "cnf" in claims:
        cnf = claims["cnf"]
        if not isinstance(cnf, Mapping):
            return RuleRefusal("binding")
        if "jkt" in cnf:
            return RuleRefusal("dpop-unsupported")
        if any(method != "x5t#S256" for method in cnf):
            return RuleRefusal("binding")
        if "x5t#S256" in cnf:
            bound = cnf["x5t#S256"]
            if not isinstance(bound, str) or certificate is None or bound != certificate:
                return RuleRefusal("binding")
            thumbprint = bound
    if thumbprint is None and rules.require_bound_tokens:
        return RuleRefusal("binding")

    return RuleOk(
        Credentials(
            issuer=issuer,
            subject=sub,
            client_id=client_id,
            scopes=tuple(scopes_result.value),
            resource=rules.resource,
            expires_at=math.floor(exp),
            issued_at=math.floor(iat),
            auth_time=math.floor(auth_time_val) if auth_time_val is not None else None,
            acr=acr_val,
            cnf={"x5t#S256": thumbprint} if thumbprint is not None else None,
        )
    )


_INTROSPECTION_REQUIRED = ("exp", "iat", "iss", "aud", "sub", "client_id")


def check_introspection(
    response: Any,
    issuer: str,
    rules: TokenRules,
    now: int | float,
    certificate: str | None = None,
) -> RuleResult[Credentials]:
    """An RFC 7662 introspection response for the one issuer configured for introspection
    (``spec/authorization.md``, M3, "Introspection"): ``active`` must be ``True`` (else
    ``inactive``), and ``exp``, ``iat``, ``iss``, ``aud``, ``sub`` and ``client_id`` must be
    present (else ``claims``); rules 5 to 10 (:func:`check_claims`) then apply.
    """
    if not isinstance(response, Mapping) or response.get("active") is not True:
        return RuleRefusal("inactive")
    if any(field not in response for field in _INTROSPECTION_REQUIRED):
        return RuleRefusal("claims")
    return check_claims(response, issuer, rules, now, certificate)


__all__ = [
    "AUTH_RULE_CODES",
    "AuthRuleCode",
    "Credentials",
    "DEFAULT_CLOCK_SKEW_S",
    "DEFAULT_MAX_TOKEN_LIFETIME_S",
    "DEFAULT_SCOPE_LIMIT",
    "MAX_CLAIM_CHARS",
    "MAX_CLOCK_SKEW_S",
    "RuleOk",
    "RuleRefusal",
    "RuleResult",
    "SIGNING_ALGORITHMS",
    "SigningAlgorithm",
    "TokenRules",
    "check_claims",
    "check_introspection",
    "check_jws_header",
    "check_key_fit",
    "create_token_rules",
    "is_verified_credentials",
    "parse_scope_claim",
]
