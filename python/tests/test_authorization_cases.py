"""Shared MCP authorization conformance cases (``spec/authorization.json``) covering
M2, M3 (rules 2–3 and 5–10), M3.1, M3.2, M4, M5 and M7.

``test_principal_binding.py`` loads ``principalBindings``; M6 (``staticScopes`` and
``batches``) is tracked in the companion scope-enforcement issue.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import pytest

from afd.server import (
    Credentials,
    audience_accepts,
    check_claims,
    check_jws_header,
    check_key_fit,
    create_protected_resource,
    create_token_rules,
    extract_bearer,
    parse_scope_claim,
)
from afd.server.auth_rules import _ABSENT

CASES_PATH = Path(__file__).resolve().parents[2] / "spec" / "authorization.json"
CASES: dict[str, Any] = json.loads(CASES_PATH.read_text(encoding="utf-8"))


def test_loads_every_case_of_the_nine_sections() -> None:
    counts = [
        len(CASES[section])
        for section in (
            "bearer",
            "challenges",
            "metadataUrls",
            "metadataDocuments",
            "audience",
            "scopeClaims",
            "jwtHeaders",
            "keys",
            "claims",
        )
    ]
    assert counts == [19, 5, 4, 3, 20, 22, 24, 17, 43]


@pytest.mark.parametrize(
    "case", CASES["bearer"], ids=[case["description"] for case in CASES["bearer"]]
)
def test_bearer_cases(case: dict[str, Any]) -> None:
    result = extract_bearer(
        case["authorization"],
        case.get("query"),
        case.get("formBody"),
    )
    if "token" in case["expected"]:
        assert result.ok is True
        assert result.token == case["expected"]["token"]
    else:
        assert result.ok is False
        assert result.refused == case["expected"]["refused"]


@pytest.mark.parametrize(("name", "blank"), [("spaces", " "), ("tabs", "\t")])
def test_bearer_parser_runs_in_linear_time(name: str, blank: str) -> None:
    for value in (
        f"Bearer abc{blank * 15_000}def",
        f"Bearer{blank * 15_000}x y",
        f"{blank * 15_000}x",
    ):
        started = time.perf_counter()
        result = extract_bearer([value])
        elapsed_ms = (time.perf_counter() - started) * 1000.0
        assert result.ok is False
        assert result.refused == "token-malformed"
        assert elapsed_ms < 50.0, f"{name} took {elapsed_ms:.2f} ms"


def test_bearer_rejects_trailing_newline() -> None:
    result = extract_bearer(["Bearer abc\n"])
    assert result.ok is False
    assert result.refused == "token-malformed"


@pytest.mark.parametrize(
    "case", CASES["challenges"], ids=[case["description"] for case in CASES["challenges"]]
)
def test_challenge_cases(case: dict[str, Any]) -> None:
    metadata = create_protected_resource(
        case["resource"],
        ["https://auth.example.com"],
        scopes_supported=case.get("scopesSupported", ()),
    )
    assert metadata.metadata_urls[0] == case["resourceMetadata"]
    if case["status"] == 401:
        assert metadata.unauthorized_challenge(case.get("tokenSent") is True) == case["header"]
        assert metadata.unauthorized_body() == case["body"]
    else:
        assert metadata.forbidden_challenge(case.get("missing", ())) == case["header"]
        assert metadata.forbidden_body(case.get("missing", ())) == case["body"]


@pytest.mark.parametrize(
    "case", CASES["metadataUrls"], ids=[case["resource"] for case in CASES["metadataUrls"]]
)
def test_metadata_url_cases(case: dict[str, Any]) -> None:
    metadata = create_protected_resource(case["resource"], ["https://auth.example.com"])
    assert list(metadata.metadata_urls) == case["urls"]
    assert list(metadata.metadata_paths) == [urlparse(url).path for url in case["urls"]]


@pytest.mark.parametrize(
    "case",
    CASES["metadataDocuments"],
    ids=[case["description"] for case in CASES["metadataDocuments"]],
)
def test_metadata_document_cases(case: dict[str, Any]) -> None:
    opts = case["options"]
    metadata = create_protected_resource(
        opts["resource"],
        opts["authorizationServers"],
        scopes_supported=opts["scopesSupported"],
        resource_name=opts.get("resourceName"),
        require_bound_tokens=opts["requireBoundTokens"],
    )
    assert metadata.document() == case["expected"]


@pytest.mark.parametrize(
    "case", CASES["audience"], ids=[case["description"] for case in CASES["audience"]]
)
def test_audience_cases(case: dict[str, Any]) -> None:
    assert audience_accepts(case.get("aud"), case["resource"]) is case["accepted"]


@pytest.mark.parametrize(
    "case", CASES["scopeClaims"], ids=[case["description"] for case in CASES["scopeClaims"]]
)
def test_scope_claim_cases(case: dict[str, Any]) -> None:
    scope = case["scope"] if "scope" in case else _ABSENT
    result = parse_scope_claim(scope, case["prefix"], case["limit"])
    if "refused" in case:
        assert result.ok is False
        assert result.rule == case["refused"]
    else:
        assert result.ok is True
        assert result.value == case["scopes"]


@pytest.mark.parametrize(
    "case", CASES["jwtHeaders"], ids=[case["description"] for case in CASES["jwtHeaders"]]
)
def test_jwt_header_cases(case: dict[str, Any]) -> None:
    result = check_jws_header(case["header"], case["algorithms"])
    if case["expected"] == "accepted":
        assert result.ok is True
    else:
        assert result.ok is False
        assert result.rule == case["expected"]["refused"]


@pytest.mark.parametrize("case", CASES["keys"], ids=[case["description"] for case in CASES["keys"]])
def test_key_fit_cases(case: dict[str, Any]) -> None:
    result = check_key_fit(case["header"], case["key"])
    if case["expected"] == "accepted":
        assert result.ok is True
    else:
        assert result.ok is False
        assert result.rule == case["expected"]["refused"]


def _rules_from_config(config: dict[str, Any]):
    return create_token_rules(
        config["resource"],
        clock_skew_s=config["clockSkewS"],
        max_token_lifetime_s=config["maxTokenLifetimeS"],
        scope_prefix=config.get("scopePrefix"),
        scope_limit=config["scopeLimit"],
        require_bound_tokens=config["requireBoundTokens"],
    )


@pytest.mark.parametrize(
    "case", CASES["claims"], ids=[case["description"] for case in CASES["claims"]]
)
def test_claims_cases(case: dict[str, Any]) -> None:
    config = {**CASES["config"], **(case.get("config") or {})}
    result = check_claims(
        case["claims"],
        config["issuer"],
        _rules_from_config(config),
        CASES["now"],
        case["certificate"],
    )
    if "refused" in case["expected"]:
        assert result.ok is False
        assert result.rule == case["expected"]["refused"]
    else:
        assert result.ok is True
        assert result.value.to_wire() == case["expected"]["credentials"]


def test_credentials_repr_redacts_everything_except_issuer_and_expires_at() -> None:
    creds = Credentials(
        issuer="https://auth.example.com",
        subject="sensitive-subject-99",
        client_id="secret-client-42",
        scopes=("todo:read", "todo:write"),
        resource="https://todo.example.com/mcp",
        expires_at=1_700_003_600,
        issued_at=1_700_000_000,
        auth_time=1_699_999_900,
        acr="phr",
        cnf={"x5t#S256": "thumbprint-xyz"},
    )
    for text in (repr(creds), str(creds)):
        assert "https://auth.example.com" in text
        assert "1700003600" in text
        assert "[redacted]" in text
        for forbidden in (
            "sensitive-subject-99",
            "secret-client-42",
            "todo:read",
            "todo:write",
            "https://todo.example.com/mcp",
            "1700000000",
            "1699999900",
            "phr",
            "thumbprint-xyz",
        ):
            assert forbidden not in text


def test_bearer_token_repr_redacts_raw_token() -> None:
    secret = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJzZWNyZXQifQ.canary-sig-value"
    extracted = extract_bearer([f"Bearer {secret}"])
    assert extracted.ok is True
    for text in (repr(extracted), str(extracted)):
        assert secret not in text
        assert "canary-sig-value" not in text
        assert "[redacted]" in text
