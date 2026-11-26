"""Time the per-call work an AFD MCP server does before and after a handler runs.

Run from ``python/``::

    uv run python benchmarks/per_call_overhead.py

It registers ``COMMANDS`` commands with Pydantic input models on one server and reports the
median time per operation for:

- ``execute``: one ``server.execute`` call, which validates the input against the command's
  JSON Schema and its Pydantic model;
- ``input validation alone``: that validation step on its own;
- ``tool definitions``: one ``server.get_tool_definitions()`` under each tool strategy;
- ``sdk tools/list``: the SDK server's ``list_tools()``, which builds an ``MCPTool`` per tool.

It needs the ``server`` extra and no network. Timings vary by machine: compare a before and an
after run on the same machine, not against another's numbers.
"""

from __future__ import annotations

import argparse
import asyncio
import statistics
import time
from collections.abc import Awaitable, Callable
from typing import Any

from pydantic import BaseModel, Field

from afd import success
from afd.core.commands import ExposeOptions
from afd.server import create_server, define_command
from afd.server.decorators import validate_command_input

COMMANDS = 50


class Address(BaseModel):
    street: str
    city: str
    postcode: str = Field(pattern=r"^[0-9A-Z ]{3,10}$")


class Input(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    count: int = Field(ge=0, le=1000)
    tags: list[str] = []
    address: Address | None = None
    ratio: float = 0.5


def build_server(strategy: str) -> Any:
    server = create_server("bench", tool_strategy=strategy)  # type: ignore[arg-type]
    for index in range(COMMANDS):

        @define_command(
            name=f"group{index % 5}-item{index}",
            description=f"Benchmark command {index}",
            input_schema=Input,
            expose=ExposeOptions(mcp=True),
        )
        async def handler(data: Input) -> Any:
            return success({"name": data.name})

        server.register(handler)
    return server


INPUT = {
    "name": "widget",
    "count": 3,
    "tags": ["a", "b"],
    "address": {"street": "1 Main", "city": "Town", "postcode": "AB1 2CD"},
}


def time_sync(fn: Callable[[], Any], rounds: int) -> float:
    samples = []
    for _ in range(rounds):
        start = time.perf_counter()
        fn()
        samples.append(time.perf_counter() - start)
    return statistics.median(samples) * 1e6


async def time_async(fn: Callable[[], Awaitable[Any]], rounds: int) -> float:
    samples = []
    for _ in range(rounds):
        start = time.perf_counter()
        await fn()
        samples.append(time.perf_counter() - start)
    return statistics.median(samples) * 1e6


async def main(rounds: int) -> None:
    server = build_server("individual")
    # Warm up once so first-call imports are not timed.
    first = await server.execute("group0-item0", INPUT)
    assert first.success, first
    execute = await time_async(lambda: server.execute("group0-item0", INPUT), rounds)
    print(f"execute (validated input)            {execute:10.1f} us/call")
    validate = time_sync(lambda: validate_command_input(Input, INPUT), rounds)
    print(f"input validation alone               {validate:10.1f} us/call")

    for strategy in ("individual", "grouped", "lazy"):
        strategy_server = build_server(strategy)
        strategy_server.get_tool_definitions()
        listed = time_sync(strategy_server.get_tool_definitions, rounds)
        print(f"tool definitions ({strategy:10s})      {listed:10.1f} us/call")

    sdk = server._create_mcp_server()
    await sdk.list_tools()
    sdk_listed = await time_async(sdk.list_tools, rounds)
    print(f"sdk tools/list (individual)          {sdk_listed:10.1f} us/call")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--rounds", type=int, default=300, help="timed calls per operation")
    asyncio.run(main(parser.parse_args().rounds))
