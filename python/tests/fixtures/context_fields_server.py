"""AFD server with declared context fields, for ``tests/test_context_fields_mcp.py``.

Run as a script, it serves over a real transport (argv: port, strategy, transport, and
``stateless`` or ``stateful``), like ``protocol_server.py``. The tests also import
``build_server`` to serve it in process.
"""

import asyncio
import sys
from typing import Annotated, Any

from pydantic import BaseModel, StringConstraints

from afd import ExposeOptions, success
from afd.core.commands import CommandContext
from afd.server import ContextField, MCPServer, create_server


class Scope(BaseModel):
    project: str


class Empty(BaseModel):
    pass


FIELDS = [
    ContextField(name="scope", meta="dev.example/scope", schema=Scope),
    ContextField(
        name="locale",
        meta="dev.example/locale",
        schema=Annotated[str, StringConstraints(max_length=35)],
    ),
]

MCP = ExposeOptions(mcp=True)


def seen(context: CommandContext) -> dict[str, Any]:
    """The declared fields a call sees, and every key of its ``context.extra``."""
    extra = context.extra or {}
    scope = extra.get("scope")
    return {
        "scope": scope.model_dump() if isinstance(scope, BaseModel) else scope,
        "locale": extra.get("locale"),
        "undeclared": extra.get("dev.example/other"),
        "keys": sorted(extra),
    }


def build_server(
    strategy: str = "individual", fields: list[ContextField] | None = None
) -> MCPServer:
    server = create_server(
        "fields-fixture",
        tool_strategy=strategy,  # type: ignore[arg-type]
        context_fields=FIELDS if fields is None else fields,
        # scope-peek stays off the hybrid list, so it is reached by name.
        **({"first_class_tools": ["scope-echo"]} if strategy == "hybrid" else {}),
    )

    @server.command(
        name="scope-echo",
        description="Return the declared fields the call sees",
        input_schema=Empty,
        expose=MCP,
    )
    async def scope_echo(input: Empty, context: CommandContext):
        return success(seen(context))

    @server.command(
        name="scope-peek",
        description="Return the declared fields the call sees",
        input_schema=Empty,
        expose=MCP,
    )
    async def scope_peek(input: Empty, context: CommandContext):
        return success(seen(context))

    return server


async def main() -> None:
    server = build_server(sys.argv[2])
    if sys.argv[3] == "stdio":
        await server.run_async("stdio")
        return
    port = int(sys.argv[1])
    if sys.argv[3] == "sse":
        await server.run_async("sse", port=port)
    else:
        stateless = len(sys.argv) > 4 and sys.argv[4] == "stateless"
        await server.run_async("streamable-http", port=port, stateless_http=stateless)


if __name__ == "__main__":
    asyncio.run(main())
