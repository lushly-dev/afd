"""The language-neutral vectors in spec/vectors/approver-client.json.

Approval evidence from an approver client and the approval display rules
(``spec/approvals.md``; Loam phase 5, step 0c). Every display case runs against
:func:`afd.approval_display`, and every carrier case runs over MCP 2026-07-28
Streamable HTTP behind the bearer authorization layer (``McpAuthOptions`` +
``JwtVerifier``), so each caller's credentials come from a verified JWT.
"""

from __future__ import annotations

import base64
import json
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import pytest

from afd import (
    APPROVAL_DISPLAY_LIMITS,
    ExposeOptions,
    approval_display,
    fixed_clock,
    success,
)
from afd.core.commands import CommandContext
from afd.server import (
    AFD_APPROVAL_META_KEY,
    Credentials,
    JwtIssuer,
    JwtVerifier,
    McpAuthOptions,
    create_approval_middleware,
    create_server,
    create_token_rules,
    jwks_key_source,
)

VECTORS = json.loads(
    (Path(__file__).resolve().parents[2] / "spec" / "vectors" / "approver-client.json").read_text(
        encoding="utf-8"
    )
)
MODERN = "2026-07-28"
RESOURCE = "https://mcp.test.example/mcp"


def test_python_not_in_gaps():
    assert "python" not in VECTORS["gaps"]


def test_display_limits_match():
    limits = VECTORS["display"]["limits"]
    assert limits["maxSerializedLength"] == APPROVAL_DISPLAY_LIMITS.max_serialized_length
    assert limits["maxStringLength"] == APPROVAL_DISPLAY_LIMITS.max_string_length
    assert limits["maxKeyLength"] == APPROVAL_DISPLAY_LIMITS.max_key_length
    assert limits["maxDepth"] == APPROVAL_DISPLAY_LIMITS.max_depth
    assert limits["maxValues"] == APPROVAL_DISPLAY_LIMITS.max_values


@pytest.mark.parametrize("case", VECTORS["display"]["cases"], ids=lambda case: case["description"])
def test_display(case: dict[str, Any]):
    verdict = approval_display(case["input"])
    actual = "shown" if verdict.ok else verdict.refusal
    assert actual == case["expected"], case["description"]


def _payload_of(token: str) -> dict[str, Any]:
    encoded = token.split(".")[1]
    raw = base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4))
    return json.loads(raw.decode("utf-8"))


def _carrier_server(carrier: dict[str, Any]):
    pytest.importorskip("mcp")
    pytest.importorskip("cryptography")
    from tests.test_auth_verifier import JWKS, NOW

    callers = carrier["callers"]
    issuers = sorted({c["credentials"]["issuer"] for c in callers.values()})
    approver_clients = {
        c["credentials"]["clientId"] for c in callers.values() if c["approver"] is True
    }
    verifier = JwtVerifier(
        create_token_rules(RESOURCE),
        [
            JwtIssuer(
                issuer=iss,
                alias=f"as-{idx}",
                algorithms=("ES256",),
                keys=jwks_key_source(JWKS),
            )
            for idx, iss in enumerate(issuers)
        ],
        clock=fixed_clock(NOW * 1000),
    )

    runs = {"count": 0}
    approval_mw = create_approval_middleware(
        secret=carrier["secret"],
        ttl_ms=carrier["ttlMs"],
        clock=fixed_clock(carrier["now"]),
        relay="mcp-elicitation",
        include_token=False,
    )
    server = create_server(
        "approver-client-vectors",
        version="1.0.0",
        tool_strategy="individual",
        instances="single",
        clock=fixed_clock(NOW * 1000),
        middleware=[approval_mw],
        auth=McpAuthOptions(
            resource=RESOURCE,
            authorization_servers=issuers,
            verifier=verifier,
        ),
        approver=lambda ctx: (
            isinstance(ctx.credentials, Credentials)
            and ctx.credentials.client_id in approver_clients
        ),
    )

    @server.command(
        name="todo-delete",
        description="Delete a todo",
        input_schema={
            "type": "object",
            "properties": {"id": {"type": "number"}},
            "required": ["id"],
        },
        mutation=True,
        approval="required",
        expose=ExposeOptions(mcp=True),
    )
    async def todo_delete(inp: dict[str, Any], _ctx: CommandContext):
        runs["count"] += 1
        return success({"deleted": inp["id"]})

    @server.command(
        name="todo-list",
        description="List todos",
        input_schema={"type": "object", "properties": {}},
        expose=ExposeOptions(mcp=True),
    )
    async def todo_list(_inp: dict[str, Any], _ctx: CommandContext):
        runs["count"] += 1
        return success([])

    return server, runs


@asynccontextmanager
async def _http_client(server: Any):
    import httpx

    app = server.streamable_http_app(stateless_http=True, json_response=True)
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://127.0.0.1:8000"
        ) as client:
            yield client


def _bearer_for(caller: dict[str, Any]) -> str:
    from tests.test_auth_verifier import NOW, _sign_jws

    creds = caller["credentials"]
    return _sign_jws(
        "ES256",
        claims={
            "iss": creds["issuer"],
            "aud": RESOURCE,
            "sub": creds["subject"],
            "client_id": creds["clientId"],
            "jti": f"tok-{creds['clientId']}",
            "iat": NOW - 10,
            "exp": NOW + 600,
        },
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("case", VECTORS["carrier"]["cases"], ids=lambda case: case["description"])
async def test_carrier(case: dict[str, Any]):
    carrier = VECTORS["carrier"]
    server, runs = _carrier_server(carrier)
    tokens: list[str | None] = []
    async with _http_client(server) as client:
        for index, step in enumerate(case["steps"]):
            where = f"{case['description']}, step {index}"
            raw_approval = step.get("approval")
            if isinstance(raw_approval, dict):
                approval = tokens[raw_approval["token"]]
                assert approval is not None, f"{where}: missing token from step {raw_approval}"
            else:
                approval = raw_approval

            caller = carrier["callers"][step["caller"]]
            meta: dict[str, Any] = {
                "io.modelcontextprotocol/protocolVersion": MODERN,
                "io.modelcontextprotocol/clientCapabilities": (
                    {"elicitation": {}} if step["elicit"] else {}
                ),
                "io.modelcontextprotocol/clientInfo": {"name": "vectors", "version": "0"},
            }
            if approval is not None:
                meta[AFD_APPROVAL_META_KEY] = approval

            resp = await client.post(
                "/mcp",
                headers={
                    "Accept": "application/json, text/event-stream",
                    "Content-Type": "application/json",
                    "MCP-Protocol-Version": MODERN,
                    "Mcp-Method": "tools/call",
                    "Mcp-Name": step["tool"],
                    "Authorization": f"Bearer {_bearer_for(caller)}",
                },
                json={
                    "jsonrpc": "2.0",
                    "id": index + 1,
                    "method": "tools/call",
                    "params": {
                        "name": step["tool"],
                        "arguments": step["arguments"],
                        "_meta": meta,
                    },
                },
            )
            assert resp.status_code == 200, f"{where}: {resp.text}"
            body = resp.json()
            assert "result" in body, f"{where}: {body}"
            content = body["result"]["content"][0]["text"]
            result = json.loads(content)

            token = (result.get("error") or {}).get("details", {}).get("approvalToken")
            expected = step["expected"]
            if expected.get("success") is True:
                assert result["success"] is True, f"{where}: {result}"
            else:
                assert result["error"]["code"] == expected["code"], f"{where}: {result}"
                if "token" in expected:
                    assert (token is not None) is expected["token"], f"{where}: {result}"
                assert result["error"].get("details", {}).get("reason") == expected.get("reason"), (
                    f"{where}: {result}"
                )

            if "payload" in expected:
                assert isinstance(token, str), f"{where}: missing token"
                payload = _payload_of(token)
                nonce = payload.pop("n")
                assert payload == expected["payload"], where
                nonce_bytes = base64.urlsafe_b64decode(nonce + "=" * (-len(nonce) % 4))
                assert len(nonce_bytes) == 16, where

            assert runs["count"] == step["runs"], where
            tokens.append(token)
