"""AFD's Python token verifiers (``spec/authorization.md``, M3): one test per rule,
with keys generated in-process via ``cryptography`` (RSA, EC P-256/P-384, Ed25519),
``JwtVerifier``, ``jwks_key_source``, ``create_introspection_verifier`` and verified
credentials branding.
"""

from __future__ import annotations

import asyncio
import base64
import copy
import json
from dataclasses import dataclass
from typing import Any

import pytest

cryptography = pytest.importorskip("cryptography")

from cryptography.hazmat.primitives import hashes, serialization  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import ec, ed25519, padding, rsa, utils  # noqa: E402

from afd.core.clock import fixed_clock  # noqa: E402
from afd.server import (  # noqa: E402
    Credentials,
    JwtIssuer,
    JwtVerifier,
    KeyErrorResult,
    KeyFound,
    SigningAlgorithm,
    TokenRefused,
    TokenRequest,
    TokenVerified,
    create_introspection_verifier,
    create_token_rules,
    is_compact_jws,
    is_verified_credentials,
    jwks_key_source,
)
from afd.server.auth_jwt import decode_base64url, parse_strict_object  # noqa: E402
from afd.server.auth_rules import (  # noqa: E402
    _brand_verified_credentials,
    _clone_verified_credentials,
    _unbrand_verified_credentials,
)

ISSUER = "https://auth.test.example"
RESOURCE = "https://mcp.test.example/mcp"
NOW = 1_700_000_000
ALL_ALGS: tuple[SigningAlgorithm, ...] = (
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


def _b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64u_json(value: Any) -> str:
    return _b64u(json.dumps(value, separators=(",", ":")).encode("utf-8"))


def _int_b64u(n: int, length: int | None = None) -> str:
    size = length if length is not None else max(1, (n.bit_length() + 7) // 8)
    return _b64u(n.to_bytes(size, "big"))


@dataclass
class _KeyPair:
    alg: SigningAlgorithm
    kid: str
    private_key: Any
    public_jwk: dict[str, Any]


def _make_keys() -> dict[SigningAlgorithm, _KeyPair]:
    rsa_priv = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    rsa_pub = rsa_priv.public_key().public_numbers()
    p256_priv = ec.generate_private_key(ec.SECP256R1())
    p256_pub = p256_priv.public_key().public_numbers()
    p384_priv = ec.generate_private_key(ec.SECP384R1())
    p384_pub = p384_priv.public_key().public_numbers()
    ed_priv = ed25519.Ed25519PrivateKey.generate()
    ed_pub_bytes = ed_priv.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )

    pairs: dict[SigningAlgorithm, _KeyPair] = {}
    for alg in ("RS256", "RS384", "RS512", "PS256", "PS384", "PS512"):
        kid = f"key-{alg.lower()}"
        pairs[alg] = _KeyPair(
            alg=alg,
            kid=kid,
            private_key=rsa_priv,
            public_jwk={
                "kty": "RSA",
                "kid": kid,
                "alg": alg,
                "use": "sig",
                "n": _int_b64u(rsa_pub.n),
                "e": _int_b64u(rsa_pub.e),
            },
        )
    pairs["ES256"] = _KeyPair(
        alg="ES256",
        kid="key-es256",
        private_key=p256_priv,
        public_jwk={
            "kty": "EC",
            "crv": "P-256",
            "kid": "key-es256",
            "alg": "ES256",
            "use": "sig",
            "x": _int_b64u(p256_pub.x, 32),
            "y": _int_b64u(p256_pub.y, 32),
        },
    )
    pairs["ES384"] = _KeyPair(
        alg="ES384",
        kid="key-es384",
        private_key=p384_priv,
        public_jwk={
            "kty": "EC",
            "crv": "P-384",
            "kid": "key-es384",
            "alg": "ES384",
            "use": "sig",
            "x": _int_b64u(p384_pub.x, 48),
            "y": _int_b64u(p384_pub.y, 48),
        },
    )
    pairs["EdDSA"] = _KeyPair(
        alg="EdDSA",
        kid="key-eddsa",
        private_key=ed_priv,
        public_jwk={
            "kty": "OKP",
            "crv": "Ed25519",
            "kid": "key-eddsa",
            "alg": "EdDSA",
            "use": "sig",
            "x": _b64u(ed_pub_bytes),
        },
    )
    return pairs


KEYS = _make_keys()
JWKS = {"keys": [pair.public_jwk for pair in KEYS.values()]}


def _default_claims(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "iss": ISSUER,
        "aud": RESOURCE,
        "sub": "user-1",
        "client_id": "agent-1",
        "jti": "tok-1",
        "iat": NOW - 10,
        "exp": NOW + 600,
        "scope": "todo:read",
    }
    base.update(overrides)
    return base


def _sign_jws(
    alg: SigningAlgorithm = "RS256",
    *,
    header: dict[str, Any] | None = None,
    claims: dict[str, Any] | None = None,
    private_key: Any = None,
) -> str:
    pair = KEYS[alg]
    hdr: dict[str, Any] = {"alg": alg, "typ": "at+jwt", "kid": pair.kid}
    if header:
        hdr.update(header)
    payload = _default_claims()
    if claims:
        payload.update(claims)
    signing_input = f"{_b64u_json(hdr)}.{_b64u_json(payload)}".encode("ascii")
    key = private_key if private_key is not None else pair.private_key

    hash_for = {
        "RS256": hashes.SHA256(),
        "RS384": hashes.SHA384(),
        "RS512": hashes.SHA512(),
        "PS256": hashes.SHA256(),
        "PS384": hashes.SHA384(),
        "PS512": hashes.SHA512(),
        "ES256": hashes.SHA256(),
        "ES384": hashes.SHA384(),
    }
    if alg in ("RS256", "RS384", "RS512"):
        sig = key.sign(signing_input, padding.PKCS1v15(), hash_for[alg])
    elif alg in ("PS256", "PS384", "PS512"):
        digest = hash_for[alg]
        sig = key.sign(
            signing_input,
            padding.PSS(mgf=padding.MGF1(digest), salt_length=digest.digest_size),
            digest,
        )
    elif alg in ("ES256", "ES384"):
        coord = 32 if alg == "ES256" else 48
        der = key.sign(signing_input, ec.ECDSA(hash_for[alg]))
        r, s = utils.decode_dss_signature(der)
        sig = r.to_bytes(coord, "big") + s.to_bytes(coord, "big")
    else:
        sig = key.sign(signing_input)
    return f"{signing_input.decode('ascii')}.{_b64u(sig)}"


def _raw_jws(header: Any, payload: Any = None, signature: str = "c2ln") -> str:
    return f"{_b64u_json(header)}.{_b64u_json(_default_claims() if payload is None else payload)}.{signature}"


def _verifier(
    *,
    rules_kwargs: dict[str, Any] | None = None,
    algorithms: tuple[SigningAlgorithm, ...] = ALL_ALGS,
    keys: Any = None,
    introspection: Any = None,
    now: int = NOW,
) -> JwtVerifier:
    rules = create_token_rules(RESOURCE, **(rules_kwargs or {}))
    return JwtVerifier(
        rules,
        [
            JwtIssuer(
                issuer=ISSUER,
                alias="test-as",
                algorithms=algorithms,
                keys=keys if keys is not None else jwks_key_source(JWKS),
            )
        ],
        introspection=introspection,
        clock=fixed_clock(now * 1000),
    )


# ── Strict JOSE helpers ────────────────────────────────────────────────────────


def test_decode_base64url_rejects_padding_and_nonzero_trailing_bits() -> None:
    assert decode_base64url("c2ln") == b"sig"
    assert decode_base64url("c2ln=") is None
    assert decode_base64url("a") is None
    # "AB" -> 0x00, 0x01; trailing 4 bits non-zero ("AB" decodes to b'\x00' which re-encodes to "AA").
    assert decode_base64url("AA") == b"\x00"
    assert decode_base64url("AB") is None


def test_parse_strict_object_rejects_duplicate_keys_and_non_finite_constants() -> None:
    assert parse_strict_object('{"a":1,"b":2}') == {"a": 1, "b": 2}
    assert parse_strict_object('{"a":1,"a":2}') is None
    assert parse_strict_object('{"a":1,"\\u0061":2}') is None
    assert parse_strict_object('{"outer":{"k":1,"k":2}}') is None
    assert parse_strict_object('{"x":NaN}') is None
    assert parse_strict_object("[1,2]") is None


# ── M3 Rule 1: route by shape ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_verifies_every_supported_signing_algorithm() -> None:
    v = _verifier()
    for alg in ALL_ALGS:
        result = await v.verify(_sign_jws(alg))
        assert isinstance(result, TokenVerified), f"{alg}: {result}"
        assert result.credentials.issuer == ISSUER
        assert result.credentials.subject == "user-1"
        assert result.credentials.client_id == "agent-1"
        assert result.credentials.scopes == ("todo:read",)


@pytest.mark.asyncio
async def test_rule1_unknown_issuer_and_duplicate_payload_claims() -> None:
    v = _verifier()
    other = _sign_jws(claims={"iss": "https://elsewhere.example"})
    assert await v.verify(other) == TokenRefused(rule="unknown-issuer")

    header = {"alg": "RS256", "typ": "at+jwt", "kid": KEYS["RS256"].kid}
    dup_payload = _b64u(f'{{"iss":"https://elsewhere.example","iss":"{ISSUER}"}}'.encode())
    assert await v.verify(f"{_b64u_json(header)}.{dup_payload}.c2ln") == TokenRefused(
        rule="unknown-issuer"
    )
    assert await v.verify(
        f"{_b64u_json(header)}.{_b64u_json([_default_claims()])}.c2ln"
    ) == TokenRefused(rule="unknown-issuer")


@pytest.mark.asyncio
async def test_rule1_routes_opaque_only_to_introspection() -> None:
    opaque = "opaque-token-without-dots"
    assert is_compact_jws(opaque) is False
    assert await _verifier().verify(opaque) == TokenRefused(rule="unknown-issuer")

    called = 0

    class _StubIntrospection:
        async def verify(self, token: str, request: TokenRequest | None = None):
            nonlocal called
            called += 1
            return TokenRefused(rule="inactive", issuer="introspect")

    v = _verifier(introspection=_StubIntrospection())
    await v.verify(_sign_jws())
    assert called == 0
    res = await v.verify(opaque)
    assert called == 1
    assert res == TokenRefused(rule="inactive", issuer="introspect")


def test_is_compact_jws_shapes() -> None:
    assert is_compact_jws("a.b.c") is True
    assert is_compact_jws("a.b.") is True
    for bad in ("a.b", "a.b.c.d", ".b.c", "a..c", "a+.b.c", "a.b.c=", "abc"):
        assert is_compact_jws(bad) is False, bad


# ── M3 Rule 2: header ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_rule2_header_checks_in_order() -> None:
    v = _verifier()
    kid = KEYS["RS256"].kid
    assert await v.verify(_sign_jws(header={"typ": "JWT"})) == TokenRefused(
        rule="typ", issuer="test-as"
    )
    assert await v.verify(_raw_jws({"alg": "RS256", "kid": kid})) == TokenRefused(
        rule="typ", issuer="test-as"
    )
    dup_hdr = _b64u(f'{{"alg":"RS256","typ":"at+jwt","kid":"{kid}","kid":"other"}}'.encode())
    assert await v.verify(f"{dup_hdr}.{_b64u_json(_default_claims())}.c2ln") == TokenRefused(
        rule="typ", issuer="test-as"
    )

    for alg in ("none", "HS256"):
        assert await v.verify(_raw_jws({"alg": alg, "typ": "at+jwt", "kid": kid})) == TokenRefused(
            rule="alg", issuer="test-as"
        )
    assert await _verifier(algorithms=("RS256",)).verify(_sign_jws("ES256")) == TokenRefused(
        rule="alg", issuer="test-as"
    )
    with pytest.raises(ValueError, match="cannot verify"):
        JwtVerifier(
            create_token_rules(RESOURCE),
            [JwtIssuer(issuer=ISSUER, algorithms=("HS256",), keys=jwks_key_source(JWKS))],  # type: ignore[arg-type]
        )

    assert await v.verify(_raw_jws({"alg": "RS256", "typ": "at+jwt", "kid": ""})) == TokenRefused(
        rule="kid", issuer="test-as"
    )
    assert await v.verify(
        _raw_jws({"alg": "RS256", "typ": "at+jwt", "kid": kid, "crit": ["b64"], "b64": False})
    ) == TokenRefused(rule="crit", issuer="test-as")
    for member in ("jku", "x5u", "x5c", "jwk"):
        val: Any = ["MIIB"] if member == "x5c" else "https://evil.example/jwks"
        assert await v.verify(_sign_jws(header={member: val})) == TokenRefused(
            rule="key-reference", issuer="test-as"
        )


# ── M3 Rule 3: key & KeySource ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_rule3_key_checks_and_material_limits() -> None:
    assert await _verifier().verify(_sign_jws(header={"kid": "missing"})) == TokenRefused(
        rule="key", issuer="test-as"
    )
    rs = KEYS["RS256"].public_jwk
    es = KEYS["ES256"].public_jwk
    token = _sign_jws("RS256")
    for bad_key in (
        {**es, "kid": rs["kid"]},
        {**rs, "alg": "PS256"},
        {**rs, "use": "enc"},
        {**{k: v for k, v in rs.items() if k != "use"}, "key_ops": ["sign"]},
    ):
        v = _verifier(keys=jwks_key_source({"keys": [bad_key]}))
        assert await v.verify(token) == TokenRefused(rule="key", issuer="test-as")

    # Short EC coordinate.
    short_ec = {**es, "x": _b64u(b"\x01" * 31)}
    assert await _verifier(keys=jwks_key_source({"keys": [short_ec]})).verify(
        _sign_jws("ES256")
    ) == TokenRefused(rule="key", issuer="test-as")

    # Weak 1024-bit RSA key must be refused as unusable key material.
    weak = rsa.generate_private_key(public_exponent=65537, key_size=1024)
    weak_pub = weak.public_key().public_numbers()
    weak_jwk = {
        "kty": "RSA",
        "kid": "weak-rsa",
        "n": _int_b64u(weak_pub.n),
        "e": _int_b64u(weak_pub.e),
    }
    weak_tok = _sign_jws("RS256", header={"kid": "weak-rsa"}, private_key=weak)
    assert await _verifier(keys=jwks_key_source({"keys": [weak_jwk]})).verify(
        weak_tok
    ) == TokenRefused(rule="key", issuer="test-as")

    # Extra private JWK members are ignored (public members only).
    leaked = {**es, "d": _b64u(b"\x02" * 32)}
    res = await _verifier(keys=jwks_key_source({"keys": [leaked]})).verify(_sign_jws("ES256"))
    assert isinstance(res, TokenVerified)


@pytest.mark.asyncio
async def test_rule3_key_source_unavailable_and_dynamic_jwks_caching() -> None:
    class _BrokenKeys:
        async def key(self, issuer: str, kid: str):
            raise RuntimeError("network down")

    assert await _verifier(keys=_BrokenKeys()).verify(_sign_jws()) == TokenRefused(
        rule="unavailable", issuer="test-as"
    )

    class _UnavailableKeys:
        async def key(self, issuer: str, kid: str):
            return KeyErrorResult("unavailable")

    assert await _verifier(keys=_UnavailableKeys()).verify(_sign_jws()) == TokenRefused(
        rule="unavailable", issuer="test-as"
    )

    clock = fixed_clock(1_000_000)
    loads = 0
    fail_next = False

    async def load():
        nonlocal loads
        loads += 1
        await asyncio.sleep(0)
        if fail_next:
            raise OSError("jwks unreachable")
        return JWKS

    source = jwks_key_source(
        load,
        min_refetch_interval_ms=30_000,
        max_age_ms=300_000,
        max_stale_ms=600_000,
        clock=clock,
    )
    # Concurrent callers share one initial load.
    r1, r2 = await asyncio.gather(source.key(ISSUER, "key-rs256"), source.key(ISSUER, "key-es256"))
    assert isinstance(r1, KeyFound) and isinstance(r2, KeyFound)
    assert loads == 1

    # Unknown kid within min_refetch_interval does not refetch.
    assert await source.key(ISSUER, "unknown-kid") == KeyErrorResult("unknown")
    assert loads == 1

    # Past min_refetch_interval, unknown kid triggers refetch; if that fails -> unavailable.
    clock.advance(31_000)
    fail_next = True
    assert await source.key(ISSUER, "unknown-kid") == KeyErrorResult("unavailable")
    assert loads == 2

    # Known kid still served from stale cache until max_stale_ms.
    assert isinstance(await source.key(ISSUER, "key-rs256"), KeyFound)

    # Past max_stale_ms with failing loader -> unavailable even for known kid.
    clock.advance(600_000)
    assert await source.key(ISSUER, "key-rs256") == KeyErrorResult("unavailable")


@pytest.mark.asyncio
async def test_dynamic_jwks_cancelling_first_waiter_does_not_cancel_concurrent_waiter() -> None:
    started = asyncio.Event()
    release = asyncio.Event()
    loads = 0

    async def slow_load():
        nonlocal loads
        loads += 1
        started.set()
        await release.wait()
        return JWKS

    source = jwks_key_source(slow_load, clock=fixed_clock(1_000_000))
    task_a = asyncio.create_task(source.key(ISSUER, "key-rs256"))
    await started.wait()
    task_b = asyncio.create_task(source.key(ISSUER, "key-es256"))
    await asyncio.sleep(0)

    task_a.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task_a

    release.set()
    res_b = await task_b
    assert isinstance(res_b, KeyFound)
    assert res_b.key["kid"] == "key-es256"
    assert loads == 1


def test_jwt_verifier_refuses_shared_key_source_between_issuers() -> None:
    shared = jwks_key_source(JWKS)
    with pytest.raises(ValueError, match="shares its key source"):
        JwtVerifier(
            create_token_rules(RESOURCE),
            [
                JwtIssuer(issuer="https://a.example", algorithms=("RS256",), keys=shared),
                JwtIssuer(issuer="https://b.example", algorithms=("RS256",), keys=shared),
            ],
        )


# ── M3 Rule 4: signature ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_rule4_signature_refusals() -> None:
    v = _verifier()
    tok = _sign_jws("ES256")
    h, p, s = tok.split(".")
    # Tamper payload.
    tampered_payload = _b64u_json(_default_claims(sub="attacker"))
    assert await v.verify(f"{h}.{tampered_payload}.{s}") == TokenRefused(
        rule="signature", issuer="test-as"
    )
    # Truncated signature.
    assert await v.verify(f"{h}.{p}.{_b64u(b'short')}") == TokenRefused(
        rule="signature", issuer="test-as"
    )
    # Wrong key of same family.
    other_es = ec.generate_private_key(ec.SECP256R1())
    wrong_sig = _sign_jws("ES256", private_key=other_es)
    assert await v.verify(wrong_sig) == TokenRefused(rule="signature", issuer="test-as")


# ── M3 Rules 5 to 10 & Introspection ───────────────────────────────────────────


@pytest.mark.asyncio
async def test_rules_5_to_10_end_to_end() -> None:
    v = _verifier()
    assert await v.verify(_sign_jws(claims={"aud": "https://other.example/mcp"})) == TokenRefused(
        rule="audience", issuer="test-as"
    )
    assert await v.verify(_sign_jws(claims={"exp": NOW - 60})) == TokenRefused(
        rule="expired", issuer="test-as"
    )
    assert await v.verify(_sign_jws(claims={"nbf": NOW + 61})) == TokenRefused(
        rule="not-yet-valid", issuer="test-as"
    )
    assert await v.verify(_sign_jws(claims={"iat": NOW, "exp": NOW + 3601})) == TokenRefused(
        rule="lifetime", issuer="test-as"
    )
    assert await v.verify(_sign_jws(claims={"scope": "bad  space"})) == TokenRefused(
        rule="scope-malformed", issuer="test-as"
    )
    assert await v.verify(_sign_jws(claims={"cnf": {"jkt": "dpop-key"}})) == TokenRefused(
        rule="dpop-unsupported", issuer="test-as"
    )

    bound = _sign_jws(claims={"cnf": {"x5t#S256": "cert-thumb-1"}})
    assert await v.verify(bound) == TokenRefused(rule="binding", issuer="test-as")
    assert await v.verify(bound, TokenRequest(certificate="wrong")) == TokenRefused(
        rule="binding", issuer="test-as"
    )
    ok = await v.verify(bound, TokenRequest(certificate="cert-thumb-1"))
    assert isinstance(ok, TokenVerified)
    assert ok.credentials.cnf == {"x5t#S256": "cert-thumb-1"}

    v_bound = _verifier(rules_kwargs={"require_bound_tokens": True})
    assert await v_bound.verify(_sign_jws()) == TokenRefused(rule="binding", issuer="test-as")


@pytest.mark.asyncio
async def test_introspection_verifier_rules_and_caching() -> None:
    clock = fixed_clock(NOW * 1000)
    calls = 0
    response: Any = {"active": True, **_default_claims()}

    async def introspect(token: str) -> Any:
        nonlocal calls
        calls += 1
        if isinstance(response, Exception):
            raise response
        return response

    v = create_introspection_verifier(
        ISSUER,
        create_token_rules(RESOURCE),
        introspect,
        alias="introspect-as",
        clock=clock,
        cache_size=2,
    )
    res1 = await v.verify("opaque-1")
    res2 = await v.verify("opaque-1")
    assert isinstance(res1, TokenVerified) and isinstance(res2, TokenVerified)
    assert calls == 1  # cached for up to 60s

    clock.advance(60_000)
    await v.verify("opaque-1")
    assert calls == 2

    response = {"active": False}
    assert await v.verify("opaque-2") == TokenRefused(rule="inactive", issuer="introspect-as")

    response = {"active": True, "iss": ISSUER}
    assert await v.verify("opaque-3") == TokenRefused(rule="claims", issuer="introspect-as")

    response = RuntimeError("timeout")
    assert await v.verify("opaque-4") == TokenRefused(rule="unavailable", issuer="introspect-as")

    # Standalone introspection verifier must never forward a compact JWS (M3 rule 1).
    before = calls
    assert await v.verify(_sign_jws()) == TokenRefused(rule="unknown-issuer")
    assert calls == before

    # Huge JSON integers in introspection `exp` must refuse cleanly with `claims`, never OverflowError.
    response = {"active": True, **_default_claims(exp=10**400)}
    assert await v.verify("opaque-huge-exp") == TokenRefused(rule="claims", issuer="introspect-as")


@pytest.mark.asyncio
async def test_huge_json_integer_timestamps_never_overflow() -> None:
    v = _verifier()
    huge = 10**400
    assert await v.verify(_sign_jws(claims={"exp": huge})) == TokenRefused(
        rule="claims", issuer="test-as"
    )
    assert await v.verify(_sign_jws(claims={"iat": huge})) == TokenRefused(
        rule="claims", issuer="test-as"
    )
    assert await v.verify(_sign_jws(claims={"nbf": huge})) == TokenRefused(
        rule="claims", issuer="test-as"
    )

    # Even if a custom verifier constructs Credentials with a huge int expires_at,
    # branding and verification never raise OverflowError.
    huge_creds = Credentials(
        issuer=ISSUER,
        subject="user-1",
        client_id="agent-1",
        scopes=(),
        resource=RESOURCE,
        expires_at=huge,
        issued_at=NOW,
    )
    _brand_verified_credentials(huge_creds, skew_s=60)
    try:
        assert is_verified_credentials(huge_creds, NOW * 1000) is True
    finally:
        _unbrand_verified_credentials(huge_creds)


# ── M4 verified credentials brand ──────────────────────────────────────────────


def test_verified_credentials_brand_uses_object_identity_and_expiry() -> None:
    creds = Credentials(
        issuer=ISSUER,
        subject="user-1",
        client_id="agent-1",
        scopes=("todo:read",),
        resource=RESOURCE,
        expires_at=NOW + 60,
        issued_at=NOW,
    )
    twin = Credentials(
        issuer=ISSUER,
        subject="user-1",
        client_id="agent-1",
        scopes=("todo:read",),
        resource=RESOURCE,
        expires_at=NOW + 60,
        issued_at=NOW,
    )
    assert creds == twin
    assert is_verified_credentials(creds, NOW * 1000) is False

    _brand_verified_credentials(creds, skew_s=10)
    assert is_verified_credentials(creds, NOW * 1000) is True
    # Equal-field twin and shallow copy are NEVER verified!
    assert is_verified_credentials(twin, NOW * 1000) is False
    assert is_verified_credentials(copy.copy(creds), NOW * 1000) is False
    # Still valid during skew, expired at expires_at + skew_s.
    assert is_verified_credentials(creds, (NOW + 69) * 1000) is True
    assert is_verified_credentials(creds, (NOW + 70) * 1000) is False

    cloned = _clone_verified_credentials(creds)
    assert cloned is not None and cloned is not creds
    assert is_verified_credentials(cloned, NOW * 1000) is True

    _unbrand_verified_credentials(creds)
    assert is_verified_credentials(creds, NOW * 1000) is False
    assert is_verified_credentials(cloned, NOW * 1000) is True
    _unbrand_verified_credentials(cloned)
    assert is_verified_credentials(cloned, NOW * 1000) is False
