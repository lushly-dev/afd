"""AFD's JWT access-token verifier (``spec/authorization.md``, M3, RFC 9068), its key sources,
and introspection as the alternative for opaque tokens.

``cryptography`` checks the signature and nothing else: AFD never calls ``jwt.decode``, so no
library default applies. Routing, strict JOSE JSON parsing (unique keys, canonical unpadded
base64url), every header and key rule, and every claim rule are AFD's own code, in the
specification's order. AFD opens no socket: keys and introspection answers come from the host.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import inspect
import json
import math
import re
import types
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal, Protocol, runtime_checkable

from afd.core.clock import Clock, system_clock
from afd.server.auth_resource import assert_https_url
from afd.server.auth_rules import (
    SIGNING_ALGORITHMS,
    AuthRuleCode,
    Credentials,
    SigningAlgorithm,
    TokenRules,
    check_claims,
    check_introspection,
    check_jws_header,
    check_key_fit,
)

# ═══════════════════════════════════════════════════════════════════════════════
# STRICT JOSE BASE64URL & JSON (RFC 7515 2 & 4, RFC 7519 4)
# ═══════════════════════════════════════════════════════════════════════════════

_BASE64URL = re.compile(r"\A[A-Za-z0-9_-]*\Z", re.ASCII)
_SAFE_ALIAS = re.compile(r"\A[\x21-\x7E]{1,256}\Z", re.ASCII)


def decode_base64url(part: str) -> bytes | None:
    """Unpadded base64url (RFC 7515 2) decoded strictly: only the alphabet, no padding, no
    length leaving a lone character, and no non-zero trailing bits. ``None`` otherwise."""
    if not isinstance(part, str) or _BASE64URL.match(part) is None or len(part) % 4 == 1:
        return None
    padded = part + "=" * ((4 - len(part) % 4) % 4)
    try:
        raw = base64.urlsafe_b64decode(padded.encode("ascii"))
    except (ValueError, UnicodeEncodeError):
        return None
    # Re-encoding reproduces the input only when every trailing pad bit was zero.
    if base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii") != part:
        return None
    return raw


def _unique_object_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate key")
        result[key] = value
    return result


def _reject_constant(name: str) -> Any:
    raise ValueError(f"{name} is not JSON")


def parse_strict_object(text: str) -> dict[str, Any] | None:
    """``text`` parsed as one JSON object whose objects, at every depth, have unique member
    names; or ``None`` for invalid JSON, non-finite constants, non-object root, or repeated names."""
    try:
        value = json.loads(
            text,
            object_pairs_hook=_unique_object_pairs,
            parse_constant=_reject_constant,
        )
    except (ValueError, TypeError, RecursionError):
        return None
    return value if isinstance(value, dict) else None


def decode_jose_object(part: str) -> dict[str, Any] | None:
    """A base64url part decoded as UTF-8 to one JSON object with unique member names, or ``None``."""
    raw = decode_base64url(part)
    if raw is None:
        return None
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        return None
    return parse_strict_object(text)


def _compact_jws_parts(token: str) -> tuple[str, str, str] | None:
    """The three parts of a compact JWS (the first two non-empty), or ``None`` (M3 rule 1)."""
    if not isinstance(token, str):
        return None
    parts = token.split(".")
    if len(parts) != 3:
        return None
    header, payload, signature = parts
    if (
        header == ""
        or payload == ""
        or _BASE64URL.match(header) is None
        or _BASE64URL.match(payload) is None
        or _BASE64URL.match(signature) is None
    ):
        return None
    return header, payload, signature


def is_compact_jws(token: str) -> bool:
    """Whether ``token`` has the shape of a compact JWS: the routing test of M3 rule 1."""
    return _compact_jws_parts(token) is not None


# ═══════════════════════════════════════════════════════════════════════════════
# VERIFIER & KEY SOURCE CONTRACTS
# ═══════════════════════════════════════════════════════════════════════════════


@dataclass(frozen=True)
class TokenRequest:
    """What a :class:`TokenVerifier` knows of the request a token came on. Never a header."""

    certificate: str | None = None
    """SHA-256 thumbprint (unpadded base64url, RFC 8705 3.1) of the TLS client certificate."""


@dataclass(frozen=True)
class TokenVerified:
    """A verified bearer token carrying its :class:`Credentials`."""

    credentials: Credentials

    @property
    def ok(self) -> Literal[True]:
        return True


@dataclass(frozen=True)
class TokenRefused:
    """A refused bearer token carrying its rule code and optional issuer alias."""

    rule: str
    issuer: str | None = None

    @property
    def ok(self) -> Literal[False]:
        return False


TokenVerification = TokenVerified | TokenRefused


@runtime_checkable
class TokenVerifier(Protocol):
    """Verifies one request's bearer token (``spec/authorization.md``, M3)."""

    async def verify(
        self, token: str, request: TokenRequest = TokenRequest()
    ) -> TokenVerification: ...


@dataclass(frozen=True)
class KeyFound:
    """A JWK found by a :class:`KeySource`."""

    key: Mapping[str, Any]


@dataclass(frozen=True)
class KeyErrorResult:
    """Why a :class:`KeySource` returned no key: ``unknown`` -> ``key``, ``unavailable`` -> fail closed."""

    error: Literal["unknown", "unavailable"]


KeyLookup = KeyFound | KeyErrorResult


@runtime_checkable
class KeySource(Protocol):
    """Where an issuer's signing keys come from (``spec/authorization.md``, M3 rule 3)."""

    async def key(self, issuer: str, kid: str) -> KeyLookup: ...


# ═══════════════════════════════════════════════════════════════════════════════
# JWKS KEY SOURCE
# ═══════════════════════════════════════════════════════════════════════════════


def _read_jwks(document: Any) -> dict[str, Mapping[str, Any]] | str:
    keys = document.get("keys") if isinstance(document, Mapping) else None
    if not isinstance(keys, (list, tuple)):
        return 'a JWKS document has a "keys" array'
    by_kid: dict[str, Mapping[str, Any]] = {}
    for entry in keys:
        if not isinstance(entry, Mapping):
            return "every key of a JWKS document is an object with a non-empty kid"
        kid = entry.get("kid")
        if not isinstance(kid, str) or kid == "":
            return "every key of a JWKS document is an object with a non-empty kid"
        if kid in by_kid:
            return f"kid {json.dumps(kid)} appears more than once"
        by_kid[kid] = types.MappingProxyType(dict(entry))
    return by_kid


class _StaticJwksKeySource:
    def __init__(self, keys: dict[str, Mapping[str, Any]]) -> None:
        self._keys = keys

    async def key(self, _issuer: str, kid: str) -> KeyLookup:
        found = self._keys.get(kid)
        return KeyFound(found) if found is not None else KeyErrorResult("unknown")


class _DynamicJwksKeySource:
    def __init__(
        self,
        load: Callable[[], Any],
        *,
        min_refetch_interval_ms: float,
        max_age_ms: float,
        max_stale_ms: float,
        clock: Clock,
    ) -> None:
        self._load = load
        self._min_interval = min_refetch_interval_ms
        self._max_age = max_age_ms
        self._max_stale = max_stale_ms
        self._clock = clock
        self._keys: dict[str, Mapping[str, Any]] | None = None
        self._loaded_at = -math.inf
        self._attempted_at = -math.inf
        self._pending: asyncio.Task[bool] | None = None

    async def _attempt(self) -> bool:
        try:
            raw = self._load()
            if inspect.isawaitable(raw):
                raw = await raw
            parsed = _read_jwks(raw)
            if isinstance(parsed, str):
                return False
            self._keys = parsed
            self._loaded_at = self._clock.now()
            return True
        except Exception:
            return False

    async def _refresh(self) -> bool:
        task = self._pending
        if task is None or task.done():
            self._attempted_at = self._clock.now()
            task = asyncio.create_task(self._attempt())
            self._pending = task

            def _clear(done: asyncio.Task[bool]) -> None:
                if self._pending is done:
                    self._pending = None

            task.add_done_callback(_clear)
        return await asyncio.shield(task)

    async def key(self, _issuer: str, kid: str) -> KeyLookup:
        now = self._clock.now()
        may_load = now - self._attempted_at >= self._min_interval
        has_pending = self._pending is not None and not self._pending.done()
        if (self._keys is None or now - self._loaded_at >= self._max_age) and (
            may_load or has_pending
        ):
            await self._refresh()
        if self._keys is None or self._clock.now() - self._loaded_at >= self._max_stale:
            return KeyErrorResult("unavailable")
        known = self._keys.get(kid)
        if known is not None:
            return KeyFound(known)
        has_pending = self._pending is not None and not self._pending.done()
        if self._clock.now() - self._attempted_at >= self._min_interval or has_pending:
            if not await self._refresh():
                return KeyErrorResult("unavailable")
            fetched = self._keys.get(kid) if self._keys is not None else None
            if fetched is not None:
                return KeyFound(fetched)
        return KeyErrorResult("unknown")


def jwks_key_source(
    jwks: Mapping[str, Any] | Callable[[], Any],
    *,
    min_refetch_interval_ms: float = 30_000,
    max_age_ms: float = 300_000,
    max_stale_ms: float = 3_600_000,
    clock: Clock | None = None,
) -> KeySource:
    """A :class:`KeySource` over a JWKS document (RFC 7517 5): fixed mapping or loader callable.

    Loaded keys are used for ``max_age_ms``; an unknown ``kid`` reloads at most once per
    ``min_refetch_interval_ms``; failed loads keep last good keys up to ``max_stale_ms`` and
    otherwise return ``unavailable``. Give each issuer its own key source.
    """
    if not callable(jwks):
        parsed = _read_jwks(jwks)
        if isinstance(parsed, str):
            raise ValueError(f"[AFD] {parsed}")
        return _StaticJwksKeySource(parsed)
    if (
        isinstance(min_refetch_interval_ms, bool)
        or isinstance(max_age_ms, bool)
        or isinstance(max_stale_ms, bool)
        or not (max_stale_ms >= max_age_ms)
    ):
        raise ValueError("[AFD] max_stale_ms must be at least max_age_ms")
    return _DynamicJwksKeySource(
        jwks,
        min_refetch_interval_ms=min_refetch_interval_ms,
        max_age_ms=max_age_ms,
        max_stale_ms=max_stale_ms,
        clock=clock or system_clock,
    )


# ═══════════════════════════════════════════════════════════════════════════════
# SIGNATURE VERIFICATION (cryptography ONLY, PUBLIC JWK MEMBERS ONLY)
# ═══════════════════════════════════════════════════════════════════════════════

_PUBLIC_MEMBERS: dict[str, tuple[str, ...]] = {
    "RSA": ("n", "e"),
    "EC": ("crv", "x", "y"),
    "OKP": ("crv", "x"),
}

_COORDINATE_BYTES: dict[str, int] = {
    "ES256": 32,
    "ES384": 48,
    "EdDSA": 32,
}

_MIN_RSA_BITS = 2048


def _import_public_key(alg: SigningAlgorithm, jwk: Mapping[str, Any]) -> Any:
    """Build a ``cryptography`` public verification key from public JWK members only,
    or return ``None`` when the material is unusable (short coordinate, weak RSA < 2048 bits,
    unsupported curve such as Ed448, invalid point)."""
    try:
        from cryptography.hazmat.primitives.asymmetric import ec, ed25519, rsa
    except ImportError as exc:  # pragma: no cover - optional server dependency
        raise RuntimeError(
            "cryptography is required for JWT signature verification; install afd[server]"
        ) from exc

    kty = jwk.get("kty")
    if not isinstance(kty, str) or kty not in _PUBLIC_MEMBERS:
        return None
    members = _PUBLIC_MEMBERS[kty]
    crv: str | None = None
    decoded: dict[str, bytes] = {}
    for member in members:
        value = jwk.get(member)
        if not isinstance(value, str) or value == "":
            return None
        if member == "crv":
            crv = value
        else:
            raw = decode_base64url(value)
            if not raw:
                return None
            decoded[member] = raw

    try:
        if kty == "RSA":
            n = int.from_bytes(decoded["n"], "big")
            e = int.from_bytes(decoded["e"], "big")
            if n.bit_length() < _MIN_RSA_BITS or e < 3 or e % 2 == 0:
                return None
            return rsa.RSAPublicNumbers(e=e, n=n).public_key()

        if kty == "EC":
            x_bytes = decoded["x"]
            y_bytes = decoded["y"]
            expected_len = _COORDINATE_BYTES.get(alg)
            if expected_len is None or len(x_bytes) != expected_len or len(y_bytes) != expected_len:
                return None
            curve: ec.EllipticCurve
            if alg == "ES256" and crv == "P-256":
                curve = ec.SECP256R1()
            elif alg == "ES384" and crv == "P-384":
                curve = ec.SECP384R1()
            else:
                return None
            x = int.from_bytes(x_bytes, "big")
            y = int.from_bytes(y_bytes, "big")
            return ec.EllipticCurvePublicNumbers(x=x, y=y, curve=curve).public_key()

        if kty == "OKP":
            if alg != "EdDSA" or crv != "Ed25519":
                return None
            x_bytes = decoded["x"]
            if len(x_bytes) != 32:
                return None
            return ed25519.Ed25519PublicKey.from_public_bytes(x_bytes)
    except (ValueError, TypeError):
        return None
    return None


def _verify_jws_signature(
    alg: SigningAlgorithm,
    public_key: Any,
    signing_input: bytes,
    signature: bytes,
) -> Literal["ok", "signature", "key"]:
    """Verify the raw JWS signature over ``signing_input`` with ``public_key``."""
    from cryptography.exceptions import InvalidSignature
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import ec, padding, utils

    hash_for: dict[str, hashes.HashAlgorithm] = {
        "RS256": hashes.SHA256(),
        "RS384": hashes.SHA384(),
        "RS512": hashes.SHA512(),
        "PS256": hashes.SHA256(),
        "PS384": hashes.SHA384(),
        "PS512": hashes.SHA512(),
        "ES256": hashes.SHA256(),
        "ES384": hashes.SHA384(),
    }

    try:
        if alg in ("RS256", "RS384", "RS512"):
            public_key.verify(signature, signing_input, padding.PKCS1v15(), hash_for[alg])
            return "ok"
        if alg in ("PS256", "PS384", "PS512"):
            digest = hash_for[alg]
            public_key.verify(
                signature,
                signing_input,
                padding.PSS(mgf=padding.MGF1(digest), salt_length=digest.digest_size),
                digest,
            )
            return "ok"
        if alg in ("ES256", "ES384"):
            coord = _COORDINATE_BYTES[alg]
            if len(signature) != 2 * coord:
                return "signature"
            r = int.from_bytes(signature[:coord], "big")
            s = int.from_bytes(signature[coord:], "big")
            der = utils.encode_dss_signature(r, s)
            public_key.verify(der, signing_input, ec.ECDSA(hash_for[alg]))
            return "ok"
        if alg == "EdDSA":
            if len(signature) != 64:
                return "signature"
            public_key.verify(signature, signing_input)
            return "ok"
    except InvalidSignature:
        return "signature"
    except (ValueError, TypeError):
        return "key"
    return "key"


# ═══════════════════════════════════════════════════════════════════════════════
# JWT VERIFIER
# ═══════════════════════════════════════════════════════════════════════════════


@dataclass(frozen=True)
class JwtIssuer:
    """One issuer whose JWT access tokens a :class:`JwtVerifier` accepts."""

    issuer: str
    algorithms: Sequence[SigningAlgorithm]
    keys: KeySource
    alias: str | None = None


@dataclass(frozen=True)
class _CheckedIssuer:
    issuer: str
    alias: str
    algorithms: tuple[SigningAlgorithm, ...]
    keys: KeySource


class JwtVerifier:
    """AFD's verifier of JWT access tokens (RFC 9068), applying ``spec/authorization.md`` M3
    in order.

    A compact JWS goes to the configured issuer its unverified ``iss`` names exactly (else
    ``unknown-issuer``). Any other token goes to ``introspection`` when configured, else
    ``unknown-issuer``. The audience check (M3.1) always runs.
    """

    def __init__(
        self,
        rules: TokenRules,
        issuers: Sequence[JwtIssuer],
        *,
        introspection: TokenVerifier | None = None,
        clock: Clock | None = None,
    ) -> None:
        if not isinstance(rules, TokenRules):
            raise ValueError("[AFD] rules must be a TokenRules instance")
        self.rules = rules
        checked: list[_CheckedIssuer] = []
        seen_issuers: set[str] = set()
        seen_aliases: set[str] = set()
        seen_key_sources: list[KeySource] = []

        for entry in issuers:
            if not isinstance(entry, JwtIssuer):
                raise ValueError("[AFD] each issuer must be a JwtIssuer")
            assert_https_url("issuer", entry.issuer)
            alias = entry.alias if entry.alias is not None else entry.issuer
            if not isinstance(alias, str) or _SAFE_ALIAS.match(alias) is None:
                raise ValueError(f"[AFD] issuer alias {alias!r} is not visible ASCII")
            algs: list[SigningAlgorithm] = []
            for algorithm in entry.algorithms:
                if algorithm not in SIGNING_ALGORITHMS:
                    raise ValueError(f"[AFD] AFD cannot verify {algorithm!r} signatures")
                if algorithm not in algs:
                    algs.append(algorithm)
            if not algs:
                raise ValueError(f"[AFD] issuer {json.dumps(alias)} lists no signing algorithm")
            if not callable(getattr(entry.keys, "key", None)):
                raise ValueError(f"[AFD] issuer {json.dumps(alias)} has no key source")
            if entry.issuer in seen_issuers or alias in seen_aliases:
                raise ValueError(f"[AFD] issuer {json.dumps(alias)} is configured twice")
            if any(existing is entry.keys for existing in seen_key_sources):
                raise ValueError(
                    f"[AFD] issuer {json.dumps(alias)} shares its key source with another issuer; "
                    "give each issuer its own"
                )
            seen_issuers.add(entry.issuer)
            seen_aliases.add(alias)
            seen_key_sources.append(entry.keys)
            checked.append(
                _CheckedIssuer(
                    issuer=entry.issuer,
                    alias=alias,
                    algorithms=tuple(algs),
                    keys=entry.keys,
                )
            )
        if not checked:
            raise ValueError("[AFD] a JWT verifier needs at least one issuer")

        inner_rules = getattr(introspection, "rules", None) if introspection is not None else None
        if isinstance(inner_rules, TokenRules) and (
            inner_rules.resource != rules.resource
            or inner_rules.require_bound_tokens != rules.require_bound_tokens
        ):
            raise ValueError(
                "[AFD] the introspection verifier accepts another audience or binding "
                "requirement than the JWT verifier"
            )

        self._issuers = tuple(checked)
        inner_issuers = (
            tuple(getattr(introspection, "issuers", ()) or ()) if introspection is not None else ()
        )
        self.issuers: tuple[str, ...] = tuple(item.issuer for item in checked) + inner_issuers
        self._introspection = introspection
        self._clock = clock or system_clock

    async def verify(self, token: str, request: TokenRequest = TokenRequest()) -> TokenVerification:
        parts = _compact_jws_parts(token)
        if parts is None:
            if self._introspection is not None:
                return await self._introspection.verify(token, request)
            return TokenRefused(rule="unknown-issuer")

        header_part, payload_part, signature_part = parts

        # 1. Route by unverified `iss`.
        payload = decode_jose_object(payload_part)
        if payload is None:
            return TokenRefused(rule="unknown-issuer")
        iss = payload.get("iss")
        issuer = next((item for item in self._issuers if item.issuer == iss), None)
        if issuer is None:
            return TokenRefused(rule="unknown-issuer")

        def refused(rule: AuthRuleCode) -> TokenRefused:
            return TokenRefused(rule=rule, issuer=issuer.alias)

        # 2. Header.
        header = decode_jose_object(header_part)
        if header is None:
            return refused("typ")
        header_check = check_jws_header(header, issuer.algorithms)
        if not header_check.ok:
            return refused(header_check.rule)
        alg: SigningAlgorithm = header["alg"]
        kid: str = header["kid"]

        # 3. Key.
        try:
            lookup = await issuer.keys.key(issuer.issuer, kid)
        except Exception:
            return refused("unavailable")
        if isinstance(lookup, KeyErrorResult):
            return refused("key" if lookup.error == "unknown" else "unavailable")
        if not isinstance(lookup, KeyFound):
            return refused("unavailable")
        key_check = check_key_fit(header, lookup.key)
        if not key_check.ok:
            return refused(key_check.rule)
        public_key = _import_public_key(alg, lookup.key)
        if public_key is None:
            return refused("key")

        # 4. Signature.
        sig_bytes = decode_base64url(signature_part)
        if sig_bytes is None:
            return refused("signature")
        signing_input = f"{header_part}.{payload_part}".encode("ascii")
        sig_outcome = _verify_jws_signature(alg, public_key, signing_input, sig_bytes)
        if sig_outcome != "ok":
            return refused(sig_outcome)

        # 5 to 10. Claims.
        now = math.floor(self._clock.now() / 1000)
        claims_check = check_claims(payload, issuer.issuer, self.rules, now, request.certificate)
        if not claims_check.ok:
            return refused(claims_check.rule)
        return TokenVerified(credentials=claims_check.value)


# ═══════════════════════════════════════════════════════════════════════════════
# INTROSPECTION VERIFIER (RFC 7662)
# ═══════════════════════════════════════════════════════════════════════════════

_INTROSPECTION_CACHE_MS = 60_000


class _IntrospectionVerifier:
    def __init__(
        self,
        *,
        issuer: str,
        rules: TokenRules,
        introspect: Callable[[str], Any | Awaitable[Any]],
        alias: str,
        clock: Clock,
        cache_size: int,
    ) -> None:
        self.rules = rules
        self.issuers: tuple[str, ...] = (issuer,)
        self._issuer = issuer
        self._introspect = introspect
        self._alias = alias
        self._clock = clock
        self._cache_size = cache_size
        self._cache: dict[str, tuple[Any, float]] = {}

    async def _response(self, token: str) -> Any:
        digest = (
            base64.urlsafe_b64encode(hashlib.sha256(token.encode("utf-8")).digest())
            .rstrip(b"=")
            .decode("ascii")
        )
        cached = self._cache.get(digest)
        if cached is not None and cached[1] > self._clock.now():
            return cached[0]
        self._cache.pop(digest, None)
        answer = self._introspect(token)
        if inspect.isawaitable(answer):
            answer = await answer
        exp = (
            answer.get("exp")
            if isinstance(answer, Mapping) and answer.get("active") is True
            else None
        )
        exp_finite = False
        if isinstance(exp, int) and not isinstance(exp, bool):
            try:
                exp_ms = float(exp) * 1000.0
                exp_finite = math.isfinite(exp_ms)
            except OverflowError:
                exp_ms = math.inf
        elif isinstance(exp, float) and math.isfinite(exp):
            exp_ms = exp * 1000.0
            exp_finite = math.isfinite(exp_ms)
        else:
            exp_ms = math.nan
        if self._cache_size > 0 and exp_finite:
            if len(self._cache) >= self._cache_size:
                oldest = next(iter(self._cache))
                self._cache.pop(oldest, None)
            self._cache[digest] = (
                answer,
                min(exp_ms, self._clock.now() + _INTROSPECTION_CACHE_MS),
            )
        return answer

    async def verify(self, token: str, request: TokenRequest = TokenRequest()) -> TokenVerification:
        if is_compact_jws(token):
            return TokenRefused(rule="unknown-issuer")
        try:
            answer = await self._response(token)
        except Exception:
            return TokenRefused(rule="unavailable", issuer=self._alias)
        now = math.floor(self._clock.now() / 1000)
        checked = check_introspection(answer, self._issuer, self.rules, now, request.certificate)
        if checked.ok:
            return TokenVerified(credentials=checked.value)
        return TokenRefused(rule=checked.rule, issuer=self._alias)


def create_introspection_verifier(
    issuer: str,
    rules: TokenRules,
    introspect: Callable[[str], Any | Awaitable[Any]],
    *,
    alias: str | None = None,
    clock: Clock | None = None,
    cache_size: int = 1000,
) -> TokenVerifier:
    """A :class:`TokenVerifier` for opaque tokens through the host's RFC 7662 introspection
    call (``spec/authorization.md``, M3, "Introspection")."""
    assert_https_url("issuer", issuer)
    if not isinstance(rules, TokenRules):
        raise ValueError("[AFD] rules must be a TokenRules instance")
    if not callable(introspect):
        raise ValueError("[AFD] introspect must be callable")
    resolved_alias = alias if alias is not None else issuer
    if not isinstance(resolved_alias, str) or _SAFE_ALIAS.match(resolved_alias) is None:
        raise ValueError(f"[AFD] issuer alias {resolved_alias!r} is not visible ASCII")
    if isinstance(cache_size, bool) or not isinstance(cache_size, int) or cache_size < 0:
        raise ValueError("[AFD] cache_size must be a non-negative integer")
    return _IntrospectionVerifier(
        issuer=issuer,
        rules=rules,
        introspect=introspect,
        alias=resolved_alias,
        clock=clock or system_clock,
        cache_size=cache_size,
    )


__all__ = [
    "JwtIssuer",
    "JwtVerifier",
    "KeyErrorResult",
    "KeyFound",
    "KeyLookup",
    "KeySource",
    "TokenRefused",
    "TokenRequest",
    "TokenVerification",
    "TokenVerified",
    "TokenVerifier",
    "create_introspection_verifier",
    "decode_base64url",
    "decode_jose_object",
    "is_compact_jws",
    "jwks_key_source",
    "parse_strict_object",
]
