"""Guard tests for each private MCP SDK internal the AFD server uses (#1756).

``afd.server.sdk_internals`` lists them. Each test here checks one against the installed SDK
and fails with the internal's name, what AFD uses it for and what breaks, so an SDK upgrade
that changes one fails loudly here instead of quietly changing what AFD's callers see.
"""

from __future__ import annotations

from typing import Any

import pytest

pytest.importorskip("mcp")

from mcp import Client  # noqa: E402
from mcp.server.lowlevel import Server as LowLevelServer  # noqa: E402
from mcp.server.mcpserver import MCPServer as SdkMCPServer  # noqa: E402

from afd import ExposeOptions, success  # noqa: E402
from afd.server import create_server  # noqa: E402
from afd.server.sdk_internals import (  # noqa: E402
    GET_CAPABILITIES,
    LOWLEVEL_SERVER,
    REQUEST_HANDLERS,
    REQUEST_STATE_BOUNDARY,
    SDK_INTERNALS,
    SESSION_CONNECTION,
    TOOL_INPUT_SCHEMA,
    lowlevel_server,
    request_handlers,
)

MCP = ExposeOptions(mcp=True)

ECHO_SCHEMA = {
    "type": "object",
    "properties": {"text": {"type": "string"}},
    "required": ["text"],
}


def _server(**kwargs: Any) -> Any:
    server = create_server("sdk-internals", tool_strategy="individual", **kwargs)

    @server.command(name="echo-say", description="Echo", input_schema=ECHO_SCHEMA, expose=MCP)
    async def echo(input: Any) -> Any:
        return success(input)

    return server


def test_every_internal_says_what_breaks():
    names = [internal.name for internal in SDK_INTERNALS]
    assert len(names) == len(set(names))
    for internal in SDK_INTERNALS:
        message = internal.failure("example")
        assert internal.name in message
        assert internal.breaks in message
        assert "python/pyproject.toml" in message


def test_lowlevel_server():
    sdk = _server()._create_mcp_server()
    lowlevel = lowlevel_server(sdk)
    assert isinstance(lowlevel, LowLevelServer), LOWLEVEL_SERVER.failure(
        f"MCPServer._lowlevel_server is {type(lowlevel).__name__}, not mcp.server.lowlevel.Server"
    )
    for method in ("get_request_handler", "add_request_handler", "get_capabilities"):
        assert callable(getattr(lowlevel, method, None)), LOWLEVEL_SERVER.failure(
            f"the low-level Server has no {method}()"
        )


def test_request_handlers_decide_capabilities():
    sdk = _server()._create_mcp_server()
    lowlevel = lowlevel_server(sdk)
    handlers = request_handlers(lowlevel)
    assert handlers is not None, REQUEST_HANDLERS.failure("Server._request_handlers is not a dict")
    assert "tools/list" in handlers, REQUEST_HANDLERS.failure("tools/list is not in the table")
    # AFD removed the SDK's prompt handlers, and the SDK derives capabilities from the table.
    assert "prompts/list" not in handlers, REQUEST_HANDLERS.failure(
        "removing prompts/list from the table did not stick"
    )
    capabilities = lowlevel.get_capabilities()
    assert capabilities.prompts is None, REQUEST_HANDLERS.failure(
        "capabilities still list prompts after their handler was removed from the table"
    )


async def test_get_capabilities_is_read_from_the_instance():
    sdk = _server()._create_mcp_server()
    lowlevel = lowlevel_server(sdk)
    assert "get_capabilities" in vars(lowlevel), GET_CAPABILITIES.failure(
        "AFD's replacement was not installed on the instance"
    )
    for mode in ("legacy", "auto"):
        async with Client(sdk, mode=mode) as client:
            tools = client.server_capabilities.tools
            assert tools is not None and tools.list_changed is False, GET_CAPABILITIES.failure(
                f"a {mode} client was told tools.listChanged={getattr(tools, 'list_changed', None)}"
                ", so the SDK no longer asks the instance's get_capabilities"
            )


def test_tool_input_schema_feeds_mcp_param_validation():
    assert callable(getattr(SdkMCPServer, "_tool_input_schema", None)), TOOL_INPUT_SCHEMA.failure(
        "MCPServer has no _tool_input_schema method to override"
    )
    sdk = _server()._create_mcp_server()
    lookup = getattr(lowlevel_server(sdk), "get_tool_input_schema", None)
    assert callable(lookup), TOOL_INPUT_SCHEMA.failure(
        "the low-level Server has no get_tool_input_schema"
    )
    assert lookup("echo-say") == ECHO_SCHEMA, TOOL_INPUT_SCHEMA.failure(
        "the low-level Server's get_tool_input_schema is not AFD's override"
    )
    assert lookup("afd-call") is not None
    assert lookup("no-such-tool") is None


async def test_session_connection_identifies_a_2025_connection():
    sessions: list[Any] = []

    async def capture(ctx: Any, call_next: Any) -> Any:
        if getattr(ctx, "method", None) == "tools/call":
            sessions.append(getattr(ctx, "session", None))
        return await call_next(ctx)

    sdk = _server()._create_mcp_server()
    sdk.middleware.insert(0, capture)
    async with Client(sdk, mode="legacy") as client:
        await client.call_tool("echo-say", {"text": "one"})
        await client.call_tool("echo-say", {"text": "two"})
    assert len(sessions) == 2
    for session in sessions:
        assert hasattr(session, "_connection"), SESSION_CONNECTION.failure(
            f"{type(session).__name__} has no _connection"
        )
    assert sessions[0]._connection is sessions[1]._connection, SESSION_CONNECTION.failure(
        "two requests on one connection had different _connection objects"
    )


async def test_context_state_persists_across_a_2025_connection():
    """The behaviour SESSION_CONNECTION protects, end to end."""
    from afd.server import ContextConfig

    server = _server(contexts=[ContextConfig(name="planning")])
    async with Client(server._create_mcp_server(), mode="legacy") as client:
        entered = await client.call_tool("afd-context-enter", {"context": "planning"})
        assert entered.structured_content["success"] is True
        listed = await client.call_tool("afd-context-list", {})
        active = listed.structured_content["data"]
        assert "planning" in str(active), SESSION_CONNECTION.failure(
            "afd-context-enter did not persist to the next call on the same connection"
        )


def test_afd_middleware_runs_just_before_the_request_state_boundary():
    from mcp.server.request_state import RequestStateBoundary

    sdk = _server()._create_mcp_server()
    chain = list(sdk.middleware)
    boundaries = [i for i, item in enumerate(chain) if isinstance(item, RequestStateBoundary)]
    assert len(boundaries) == 1, REQUEST_STATE_BOUNDARY.failure(
        f"MCPServer.middleware holds {len(boundaries)} RequestStateBoundary entries"
    )
    before = chain[boundaries[0] - 1] if boundaries[0] > 0 else None
    assert getattr(before, "__name__", None) == "pre_boundary", REQUEST_STATE_BOUNDARY.failure(
        f"the entry before the boundary is {before!r}, not AFD's pre_boundary middleware"
    )
