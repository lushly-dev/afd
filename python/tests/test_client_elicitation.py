"""``McpClient`` answering MCP 2026-07-28 ``input_required`` results over
``streamable-http``: an ``on_elicitation`` handler, or an ``INPUT_REQUIRED`` failure
without one. Mirrors packages/client/src/elicitation.test.ts.
"""

import pytest

pytest.importorskip("mcp.client.streamable_http")

from afd.client import (  # noqa: E402
    ElicitationRequest,
    ElicitationResponse,
    McpClient,
    McpClientConfig,
)
from tests.test_mcp_protocol_live import protocol_server  # noqa: E402


def serve():
    return protocol_server(
        "individual", "streamable-http", fixture="elicitation_server.py"
    )


async def test_answers_through_on_elicitation_and_returns_the_final_result():
    asked: list[ElicitationRequest] = []

    async def on_elicitation(request: ElicitationRequest) -> ElicitationResponse:
        asked.append(request)
        return ElicitationResponse(action="accept", content={"confirm": True})

    async with serve() as url:
        client = McpClient(
            McpClientConfig(
                url=url, auto_reconnect=False, timeout=5, on_elicitation=on_elicitation
            )
        )
        await client.connect()
        try:
            result = await client.call("wipe-run", {})
            assert result.success is True
            assert result.data == {"wiped": True}
        finally:
            await client.disconnect()

    assert asked == [
        ElicitationRequest(
            message="Wipe everything?",
            requested_schema={
                "type": "object",
                "properties": {"confirm": {"type": "boolean"}},
                "required": ["confirm"],
            },
        )
    ]


async def test_returns_input_required_with_what_the_server_asked_without_a_handler():
    async with serve() as url:
        client = McpClient(McpClientConfig(url=url, auto_reconnect=False, timeout=5))
        await client.connect()
        try:
            result = await client.call("state-run", {})
            assert result.success is False
            assert result.error.code == "INPUT_REQUIRED"
            assert result.error.retryable is False
            assert result.error.suggestion
            assert result.data == {"inputRequests": {}}

            # A form elicitation comes back unanswered too, carrying the request.
            wipe = await client.call("wipe-run", {})
            assert wipe.error.code == "INPUT_REQUIRED"
            confirm = wipe.data["inputRequests"]["confirm"]
            assert confirm["method"] == "elicitation/create"
            assert confirm["params"]["message"] == "Wipe everything?"
        finally:
            await client.disconnect()


# ── CLI terminal prompt (mirrors packages/cli/src/elicitation.test.ts) ──────────

CONFIRM = {
    "type": "object",
    "properties": {"confirm": {"type": "boolean"}},
    "required": ["confirm"],
}


def terminal(reply: bool):
    from afd.cli.elicitation import terminal_elicitation

    prompts: list[str] = []

    async def confirm(prompt: str) -> bool:
        prompts.append(prompt)
        return reply

    return terminal_elicitation(confirm), prompts


async def test_cli_accepts_a_yes_with_every_boolean_set():
    handler, prompts = terminal(True)
    answer = await handler(ElicitationRequest("Delete every todo?", CONFIRM))
    assert answer == ElicitationResponse(action="accept", content={"confirm": True})
    assert prompts == ["Delete every todo? [y/N] "]


async def test_cli_declines_anything_else():
    handler, _ = terminal(False)
    assert await handler(ElicitationRequest("Sure?", CONFIRM)) == ElicitationResponse("decline")


async def test_cli_cancels_a_form_it_cannot_collect_and_escapes_the_message(capsys):
    handler, prompts = terminal(True)
    answer = await handler(
        ElicitationRequest(
            "Name?\u001b]0;pwned\u0007",
            {"type": "object", "properties": {"name": {"type": "string"}}},
        )
    )
    assert answer == ElicitationResponse("cancel")
    assert prompts == []
    assert "\u001b" not in capsys.readouterr().err


def test_cli_asks_only_at_a_terminal(monkeypatch):
    from afd.cli.elicitation import interactive_elicitation

    async def confirm(prompt: str) -> bool:
        return True

    monkeypatch.setattr("sys.stdin.isatty", lambda: False, raising=False)
    assert interactive_elicitation(confirm) is None
