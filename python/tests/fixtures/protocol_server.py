"""Real AFD/FastMCP subprocess used by the bounded protocol regression tier."""

import asyncio
import sys

from pydantic import BaseModel

from afd import ExposeOptions, success
from afd.server import create_server
from afd.server.types import ContextConfig


class ValueInput(BaseModel):
    value: int


server = create_server(
    "protocol-fixture",
    tool_strategy=sys.argv[2],
    contexts=[ContextConfig(name="alpha"), ContextConfig(name="beta")],
)
writes = 0


@server.command(
    name="alpha-run",
    description="Run alpha",
    contexts=["alpha"],
    input_schema=ValueInput,
    requires=["probe-read"],
    expose=ExposeOptions(mcp=True),
)
async def alpha_run(value):
    return success({"value": value.value, "context": "alpha"})


@server.command(
    name="beta-run",
    description="Run beta",
    contexts=["beta"],
    input_schema=ValueInput,
    expose=ExposeOptions(mcp=True),
)
async def beta_run(value):
    return success({"value": value.value, "context": "beta"})


@server.command(name="private-rotate", description="Private operation")
async def private_rotate(value):
    return success(value)


@server.command(name="probe-write", description="Record a write", expose=ExposeOptions(mcp=True))
async def probe_write(value):
    global writes
    writes += 1
    return success({"writes": writes})


@server.command(name="probe-read", description="Read writes", expose=ExposeOptions(mcp=True))
async def probe_read(value):
    return success({"writes": writes})


async def main():
    port = int(sys.argv[1])
    if sys.argv[3] == "sse":
        await server.run_async("sse", port=port)
    else:
        stateless = len(sys.argv) > 4 and sys.argv[4] == "stateless"
        await server.run_async("streamable-http", port=port, stateless_http=stateless)


if __name__ == "__main__":
    asyncio.run(main())
