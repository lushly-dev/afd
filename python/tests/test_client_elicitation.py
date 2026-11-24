"""``McpClient`` answering MCP 2026-07-28 ``input_required`` results over
``streamable-http``: an ``on_elicitation`` handler, or an ``INPUT_REQUIRED`` failure
without one. Mirrors packages/client/src/elicitation.test.ts.
"""

import asyncio

import pytest

pytest.importorskip("mcp.client.streamable_http")

from afd.client import (  # noqa: E402
    ElicitationRequest,
    ElicitationResponse,
    McpClient,
    McpClientConfig,
)
from afd.transports.streamable_http import (  # noqa: E402
    StreamableHttpTransport,
    _elicitation_callback,
)
from tests.test_mcp_protocol_live import protocol_server  # noqa: E402

MODERN = "2026-07-28"


def serve():
    return protocol_server("individual", "streamable-http", fixture="elicitation_server.py")


async def test_answers_through_on_elicitation_and_returns_the_final_result():
    asked: list[ElicitationRequest] = []

    async def on_elicitation(request: ElicitationRequest) -> ElicitationResponse:
        asked.append(request)
        return ElicitationResponse(action="accept", content={"confirm": True})

    async with serve() as url:
        client = McpClient(
            McpClientConfig(url=url, auto_reconnect=False, timeout=5, on_elicitation=on_elicitation)
        )
        await client.connect()
        try:
            assert client._transport.protocol_version == MODERN
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
            assert client._transport.protocol_version == MODERN
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


async def test_a_declined_answer_reaches_the_server():
    async def decline(request: ElicitationRequest) -> ElicitationResponse:
        return ElicitationResponse(action="decline")

    async with serve() as url:
        client = McpClient(
            McpClientConfig(url=url, auto_reconnect=False, timeout=5, on_elicitation=decline)
        )
        await client.connect()
        try:
            result = await client.call("wipe-run", {})
            assert result.error.code == "CONFIRMATION_DECLINED"
        finally:
            await client.disconnect()


async def test_a_url_elicitation_is_cancelled_not_refused():
    from mcp.types import ElicitRequestURLParams, ElicitResult

    async def never(request):
        raise AssertionError("a URL elicitation must not reach the handler")

    callback = _elicitation_callback(never)
    answer = await callback(None, ElicitRequestURLParams(message="Sign in", url="https://x.test"))
    assert answer == ElicitResult(action="cancel")


async def test_time_spent_answering_does_not_count_against_the_deadline():
    async def slow(request: ElicitationRequest) -> ElicitationResponse:
        await asyncio.sleep(0.3)
        return ElicitationResponse(action="accept", content={})

    transport = StreamableHttpTransport("http://127.0.0.1:9/mcp", timeout=0.1, on_elicitation=slow)

    async def answered_call():
        await transport._answer(ElicitationRequest("Sure?", {}))
        return "done"

    assert await transport._bounded(answered_call()) == "done"
    with pytest.raises(asyncio.TimeoutError):
        await transport._bounded(asyncio.sleep(0.3))

    # The pause is per call: another call's answering does not extend this one.
    answering = asyncio.ensure_future(transport._bounded(answered_call()))
    with pytest.raises(asyncio.TimeoutError):
        await transport._bounded(asyncio.sleep(0.3))
    assert await answering == "done"


async def test_without_a_handler_a_stale_schema_is_relisted_and_resent_once():
    from mcp import MCPError
    from mcp.types import HEADER_MISMATCH, CallToolResult, ListToolsResult, TextContent, Tool

    class Session:
        def __init__(self):
            self.calls = 0

        async def call_tool(self, name, arguments, **options):
            assert options["allow_input_required"] is True
            self.calls += 1
            if self.calls == 1:
                raise MCPError(HEADER_MISMATCH, "stale")
            return CallToolResult(content=[TextContent(text='{"success": true, "data": 1}')])

    class Client:
        protocol_version = MODERN

        def __init__(self):
            self.session = Session()
            self.listed = 0

        async def list_tools(self, cursor=None, cache_mode="use"):
            self.listed += 1
            return ListToolsResult(tools=[Tool(name="t", input_schema={"type": "object"})])

    client = Client()
    transport = StreamableHttpTransport("http://127.0.0.1:9/mcp", timeout=1)
    payload = await transport._call_tool_payload(client, "t", {})
    assert payload["content"][0]["text"] == '{"success": true, "data": 1}'
    assert (client.session.calls, client.listed) == (2, 1)

    # On a 2025 connection the mismatch is not recoverable and is raised.
    client = Client()
    client.protocol_version = "2025-11-25"
    with pytest.raises(MCPError):
        await transport._call_tool_payload(client, "t", {})


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


async def test_cli_keeps_printable_text_in_any_script():
    handler, prompts = terminal(True)
    await handler(ElicitationRequest("Supprimer tout ? 全部削除?", CONFIRM))
    assert prompts == ["Supprimer tout ? 全部削除? [y/N] "]


async def test_cli_escapes_bidi_and_zero_width_characters():
    handler, prompts = terminal(True)
    await handler(ElicitationRequest("Keep\u202eevil\u200b\u2028", CONFIRM))
    assert prompts == ["Keep\\u202eevil\\u200b\\u2028 [y/N] "]


def test_cli_asks_only_at_a_terminal(monkeypatch):
    from afd.cli.elicitation import interactive_elicitation

    async def confirm(prompt: str) -> bool:
        return True

    monkeypatch.setattr("sys.stdin.isatty", lambda: True, raising=False)
    monkeypatch.setattr("sys.stderr.isatty", lambda: True, raising=False)
    assert interactive_elicitation(confirm) is not None
    monkeypatch.setattr("sys.stdin.isatty", lambda: False, raising=False)
    assert interactive_elicitation(confirm) is None
