"""The language-neutral vectors in spec/vectors/human-relay.json.

The relay's pending list (spec/command-metadata.md, "The pending list"): each ``pending`` case is
answered over MCP 2026-07-28 HTTP, from a client without URL-mode elicitation, with exactly its
``error``; each ``invalid`` case is an internal error (``-32603``) and runs nothing.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

pytest.importorskip("mcp")

import httpx  # noqa: E402

from afd import CommandError, ExposeOptions, success  # noqa: E402
from afd.server import (  # noqa: E402
    RelayCall,
    RelayInvalid,
    RelayPendingDecision,
    create_server,
)

MODERN = "2026-07-28"
MCP = ExposeOptions(mcp=True)

VECTORS = json.loads(
    (Path(__file__).resolve().parents[2] / "spec" / "vectors" / "human-relay.json").read_text(
        encoding="utf-8"
    )
)


class _ListingRelay:
    def __init__(self, pending: RelayPendingDecision) -> None:
        self._pending = pending

    def begin(self, call: RelayCall) -> CommandError:
        return CommandError(code="UNEXPECTED", message="begin is never asked here")

    def resume(self, state: str, call: RelayCall) -> RelayInvalid:
        return RelayInvalid()

    def pending_list(self, call: RelayCall) -> RelayPendingDecision:
        return self._pending


async def _call_without_url(command_name: str, entry: dict[str, str]) -> tuple[dict[str, Any], int]:
    runs = 0
    relay = _ListingRelay(
        RelayPendingDecision(
            decision=entry["decision"],
            url=entry["url"],
            list=entry["list"],
        )
    )
    server = create_server(
        "human-relay-vectors",
        tool_strategy="individual",
        human_relay=relay,
    )

    @server.command(
        name=command_name,
        description="A command only the host confirms",
        mutation=True,
        confirmation_mode="host-verified",
        expose=MCP,
    )
    async def run_cmd(input: Any) -> Any:
        nonlocal runs
        runs += 1
        return success({"ran": True})

    app = server.streamable_http_app(stateless_http=True, json_response=True)
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1:8000"
        ) as http,
    ):
        response = await http.post(
            "/mcp",
            headers={
                "Accept": "application/json, text/event-stream",
                "Content-Type": "application/json",
                "MCP-Protocol-Version": MODERN,
                "Mcp-Method": "tools/call",
                "Mcp-Name": command_name,
            },
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {
                    "name": command_name,
                    "arguments": {},
                    "_meta": {
                        "io.modelcontextprotocol/protocolVersion": MODERN,
                        "io.modelcontextprotocol/clientCapabilities": {"elicitation": {"form": {}}},
                    },
                },
            },
        )
        assert response.status_code == 200, response.text
        return response.json(), runs


def _command_result(response: dict[str, Any]) -> dict[str, Any]:
    result = response["result"]
    if isinstance(result.get("structuredContent"), dict):
        return result["structuredContent"]
    return json.loads(result["content"][0]["text"])


def test_python_is_not_a_gap() -> None:
    assert "python" not in VECTORS["gaps"]
    assert VECTORS["pending"]
    assert VECTORS["invalid"]


async def test_each_pending_case_is_refused_with_exactly_its_error() -> None:
    for case in VECTORS["pending"]:
        response, runs = await _call_without_url(case["command"], case["relay"])
        refused = _command_result(response)
        assert refused["success"] is False, case["name"]
        assert refused["error"] == case["error"], case["name"]
        assert runs == 0, case["name"]


async def test_each_invalid_case_is_an_internal_error() -> None:
    for case in VECTORS["invalid"]:
        response, runs = await _call_without_url("memory-erase", case["relay"])
        assert response["error"]["code"] == -32603, f"{case['name']}: {response}"
        assert runs == 0, case["name"]
