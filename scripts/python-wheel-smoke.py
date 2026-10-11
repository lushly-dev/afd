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
        assert "smoke-ping" in {tool.name for tool in await mcp.list_tools()}
    elif extra != "cli":
        raise ValueError(f"Unknown extra: {extra}")

    print(f"Installed afd {afd.__version__} [{extra}] smoke passed")


if __name__ == "__main__":
    asyncio.run(check(sys.argv[1]))
