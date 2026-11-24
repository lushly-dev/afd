"""Exercise only an installed wheel and the requested extra's dependencies.

Run with python -I to exclude the checkout and PYTHONPATH from import resolution.
"""

import asyncio
import sys

import afd
from afd import CommandResult, success
from afd.direct import DirectClient, create_registry


async def check(extra: str) -> None:
    registry = create_registry()

    async def local_ping():
        return success({"status": "pong"})

    registry.register("smoke-ping", local_ping)
    result = await DirectClient(registry).call("smoke-ping")
    assert isinstance(result, CommandResult)
    assert result.success and result.data == {"status": "pong"}

    if extra == "base":
        # Optional dependencies must stay absent during the local-only check.
        from importlib.util import find_spec

        assert find_spec("httpx") is None
        assert find_spec("mcp") is None
        # Star import must succeed on a base install without pulling in optional extras.
        namespace: dict[str, object] = {}
        exec("from afd import *", namespace)
        assert "CommandResult" in namespace
        assert "DirectContext" in namespace
        assert "McpClient" not in namespace
    elif extra == "testing":
        from importlib.util import find_spec

        assert find_spec("httpx") is None
        assert find_spec("mcp") is None

        from afd import testing as afd_testing
        from afd.testing import assert_success
        from afd.testing.fixtures import MockServer
        from afd.testing.scenarios import evaluate_result, parse_scenario

        server = MockServer()

        @server.command("smoke-ping")
        async def smoke_ping(input):
            return success({"status": "pong"})

        res = await server.execute("smoke-ping", {})
        assert_success(res)
        parsed = parse_scenario(
            "name: Smoke\ndescription: Smoke\njob: smoke\nsteps:\n"
            "  - command: smoke-ping\n    expect:\n      success: true\n"
            "      data:\n        status: pong\n"
        )
        assert parsed.success is True
        assert evaluate_result({"success": True, "data": {"status": "pong"}}, parsed.scenario.steps[0].expect).passed
        assert afd_testing is not None
    elif extra == "client":
        from afd import McpClient
        from afd.transports import HttpTransport, SseTransport

        assert McpClient and HttpTransport and SseTransport
    elif extra == "server":
        from afd.core.commands import ExposeOptions
        from afd.server import create_server, define_command

        @define_command(
            name="smoke-ping",
            description="Check installed server extra",
            expose=ExposeOptions(mcp=True),
        )
        async def ping(input):
            return success({"status": "pong"})

        server = create_server("wheel-smoke")
        server.register(ping)
        assert "smoke-ping" in {command.name for command in server.list_commands()}
        result = await server.execute("smoke-ping", {})
        assert result.success and result.data == {"status": "pong"}
        # Construction is lazy; exercise the FastMCP registration boundary too,
        # without starting a process or listening on a network port.
        mcp = server._create_mcp_server()
        tools = await mcp.list_tools()
        # The default grouped list: the five meta-tools, then the `smoke` group.
        assert "afd-call" in {tool.name for tool in tools}
        grouped = next(tool for tool in tools if tool.name == "smoke")
        assert [action["command"] for action in grouped.meta["actions"]] == ["smoke-ping"]
    elif extra != "cli":
        raise ValueError(f"Unknown extra: {extra}")

    print(f"Installed afd {afd.__version__} [{extra}] smoke passed")


if __name__ == "__main__":
    asyncio.run(check(sys.argv[1]))
