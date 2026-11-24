"""Thin host surfaces. All registered commands enter CommandHost.execute()."""

from __future__ import annotations

import asyncio
import json
from collections.abc import Callable
from typing import Any

import click

from botcore.host import CommandHost


def _dump(result: Any) -> dict[str, Any]:
    dumped: dict[str, Any] = result.model_dump(mode="json", exclude_none=True)
    return dumped


def create_host_cli(host: CommandHost) -> click.Group:
    """Build a CLI owned by the host, without mutating the global Botcore registry."""

    @click.group(name=host.name)
    def cli() -> None:
        """Inspect a catalog or call an explicitly admitted host command."""

    @cli.command("catalog")
    def catalog() -> None:
        click.echo(json.dumps(host.catalog(), indent=2))

    @cli.command("call")
    @click.argument("command")
    @click.argument("arguments", default="{}")
    def call(command: str, arguments: str) -> None:
        try:
            args = json.loads(arguments)
        except ValueError as exc:
            raise click.BadParameter("Arguments must be valid JSON") from exc
        result = asyncio.run(host.execute(command, args))
        data = _dump(result)
        click.echo(json.dumps(data, indent=2))
        quality = data.get("metadata", {}).get("quality", {})
        if not result.success or quality.get("status", "passed") != "passed":
            raise click.exceptions.Exit(1)

    return cli


def command_annotations(host: CommandHost, name: str) -> dict[str, bool]:
    """MCP tool annotations from a command's declared effects, in MCP's wire names.

    A command whose every possible effect is ``inspect`` is read-only; any other may change
    state and is marked destructive, the conservative reading MCP clients expect.
    """
    read_only = set(host.policy(name).declared()) <= {"inspect"}
    return {"readOnlyHint": read_only, "destructiveHint": not read_only}


def _meta_tool_names(host: CommandHost) -> set[str]:
    """The meta-tools' names, reserved whether or not ``-run`` is on, so a name never changes
    meaning with the ``raw_python`` option."""
    return {f"{host.name}-{tool}" for tool in ("start", "call", "docs", "run")}


def _with_command_tools(server_class: Any, host: CommandHost, call_tool: str) -> Any:
    """``server_class`` with one more tool per host command, named as the host serves it.

    The SDK never models a command's arguments: each tool publishes the catalog's input schema,
    and a call is handed whole, unread, to the ``call_tool`` meta-tool, whose ``arguments`` is
    any object. So the host is the only validator, as through the meta-tool: a handler may take
    ``**kwargs``, every input type it accepts is served, bad input is refused in AFD's error
    shape, and no key is dropped before the host sees it. Both SDKs route ``tools/list`` and
    ``tools/call`` through the server's ``list_tools`` and ``call_tool``, overridden here.

    Both read the host's commands on each request, so a command registered after the server is
    built is listed and routed alike; one named like a meta-tool is never served as a command.
    """
    from mcp.types import Tool

    reserved = _meta_tool_names(host)

    def command(name: str) -> bool:
        """A command tool's name: registered exactly so, so another spelling of it cannot slip
        past a client rule keyed on the served name, and not a meta-tool's."""
        return name not in reserved and host.resolve(name) == name

    class CommandToolServer(server_class):  # type: ignore[misc]
        async def list_tools(self, *args: Any, **kwargs: Any) -> Any:
            tools = list(await super().list_tools(*args, **kwargs))
            # A command tool answers as the call meta-tool does, so it declares that output.
            meta = next((tool for tool in tools if tool.name == call_tool), None)
            dumped = meta.model_dump(by_alias=True, exclude_none=True) if meta else {}
            output = {"outputSchema": dumped["outputSchema"]} if "outputSchema" in dumped else {}
            for row in host.catalog():
                if row["name"] in reserved:
                    continue
                tools.append(
                    Tool.model_validate(
                        {
                            "name": row["name"],
                            "description": row["description"] or row["name"],
                            "inputSchema": row["input_schema"],
                            "annotations": command_annotations(host, row["name"]),
                            **output,
                        }
                    )
                )
            return tools

        async def call_tool(self, name: str, arguments: Any, *args: Any, **kwargs: Any) -> Any:
            if command(name):
                arguments = {"command": name, "arguments": arguments}
                name = call_tool
            return await super().call_tool(name, arguments, *args, **kwargs)

        def _tool_input_schema(self, name: str) -> Any:
            """SDK 2's transport checks a call's ``Mcp-Param`` headers against the schema this
            returns; a command tool's is the catalog's, as ``tools/list`` publishes it."""
            if command(name):
                for row in host.catalog():
                    if row["name"] == name:
                        return row["input_schema"]
            parent = getattr(super(), "_tool_input_schema", None)  # SDK 2 only.
            return parent(name) if parent else None

    return CommandToolServer


def create_host_mcp_server(
    host: CommandHost,
    *,
    raw_python: bool = False,
    command_tools: bool = False,
    version: str = "0.1.0",
    description: str | None = None,
) -> Any:
    """Raw Python is explicitly opted in and available only to trusted-local.

    Arbitrary Python is fully trusted code, not confined by command metadata.
    Its supplied command functions still dispatch through the host policy.

    ``command_tools`` also serves each command as its own tool, named as the host serves it,
    with the catalog's input schema and read-only and destructive annotations, so a client's
    permission rules can tell a write from a read. The meta-tools stay, ``-call`` still reaching
    every command, and the host stays the only validator of a command's arguments.
    """
    if raw_python and host.context.profile != "trusted-local":
        raise ValueError("Raw Python requires the trusted-local profile")
    from botcore._mcp import sdk_types

    FastMCP, _ = sdk_types()
    if command_tools:
        collisions = sorted(_meta_tool_names(host) & set(host.list_command_names()))
        if collisions:
            raise ValueError(f"Command {collisions[0]} collides with a {host.name} meta-tool")
        FastMCP = _with_command_tools(FastMCP, host, f"{host.name}-call")

    raw_names = {name: name for name in host.list_command_names()}
    if raw_python:
        for name in host.list_command_names():
            alias = name.replace("-", "_")
            if alias.isidentifier() and alias != name:
                if alias in raw_names and raw_names[alias] != name:
                    raise ValueError(f"Ambiguous trusted-local Python alias: {alias}")
                raw_names[alias] = name
    server = FastMCP(host.name)

    async def start() -> dict[str, Any]:
        return {
            "name": host.name,
            "version": version,
            "description": description,
            "profile": host.context.profile,
            "workspace": str(host.context.workspace),
            "target": str(host.context.target),
            "commands": host.catalog(),
            "available_functions": host.list_command_names(),
            "topics": sorted(host.docs),
        }

    server.tool(name=f"{host.name}-start", description="Discover host commands and their effects")(
        start
    )

    async def call(command: str, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
        from afd import Actor
        from afd.core.commands import CommandContext

        # An MCP caller is an agent unless the host names who calls through it.
        context = CommandContext(actor=host.actor or Actor(kind="agent"))
        return _dump(await host.execute(command, arguments, context))

    server.tool(
        name=f"{host.name}-call", description="Call a registered command under host policy"
    )(call)

    async def docs(topic: str = "overview") -> str:
        if topic == "overview":
            return f"# {host.name} — Topics\n" + "\n".join(sorted(host.docs))
        return host.docs.get(topic, f"Unknown topic. Available: {', '.join(sorted(host.docs))}")

    server.tool(name=f"{host.name}-docs", description="Read a host documentation topic")(docs)

    if raw_python:

        async def run(code: str) -> dict[str, Any]:
            from afd import error, success

            from botcore.server import _validate_code

            invalid = _validate_code(code)
            if invalid:
                return _dump(error("INVALID_CODE", invalid, suggestion="Use valid Python"))

            def wrapper(command_name: str) -> Callable[..., Any]:
                async def invoke(*args: Any, **kwargs: Any) -> Any:
                    import inspect

                    signature = inspect.signature(host.handler(command_name))
                    bound = signature.bind(*args, **kwargs)
                    return await host.execute(command_name, dict(bound.arguments))

                return invoke

            namespace: dict[str, Any] = {
                alias: wrapper(command) for alias, command in raw_names.items()
            }
            try:
                wrapped = "async def _run():\n" + "\n".join(
                    "    " + line for line in code.splitlines()
                )
                exec(compile(wrapped, f"<{host.name}-trusted-local>", "exec"), namespace)
                value = await namespace["_run"]()
                return _dump(value if hasattr(value, "model_dump") else success(value))
            except Exception as exc:
                return _dump(error("EXECUTION_ERROR", str(exc), suggestion="Inspect trusted code"))

        server.tool(name=f"{host.name}-run", description="Trusted local Python; no sandbox")(run)

    return server
