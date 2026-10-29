"""Thin host surfaces. All registered commands enter CommandHost.execute()."""

from __future__ import annotations

import asyncio
import json
from typing import Any

import click

from botcore.host import CommandHost


def _dump(result) -> dict:
    return result.model_dump(mode="json", exclude_none=True)


def create_host_cli(host: CommandHost) -> click.Group:
    """Build a CLI owned by the host, without mutating the global Botcore registry."""

    @click.group(name=host.name)
    def cli():
        """Inspect a catalog or call an explicitly admitted host command."""

    @cli.command("catalog")
    def catalog():
        click.echo(json.dumps(host.catalog(), indent=2))

    @cli.command("call")
    @click.argument("command")
    @click.argument("arguments", default="{}")
    def call(command: str, arguments: str):
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


def create_host_mcp_server(
    host: CommandHost,
    *,
    raw_python: bool = False,
    version: str = "0.1.0",
    description: str | None = None,
) -> Any:
    """Raw Python is explicitly opted in and available only to trusted-local.

    Arbitrary Python is fully trusted code, not confined by command metadata.
    Its supplied command functions still dispatch through the host policy.
    """
    if raw_python and host.context.profile != "trusted-local":
        raise ValueError("Raw Python requires the trusted-local profile")
    from botcore._mcp import sdk_types

    FastMCP, _ = sdk_types()

    raw_names = {name: name for name in host.list_command_names()}
    if raw_python:
        for name in host.list_command_names():
            alias = name.replace("-", "_")
            if alias.isidentifier() and alias != name:
                if alias in raw_names and raw_names[alias] != name:
                    raise ValueError(f"Ambiguous trusted-local Python alias: {alias}")
                raw_names[alias] = name
    server = FastMCP(host.name)

    @server.tool(name=f"{host.name}-start", description="Discover host commands and their effects")
    async def start() -> dict:
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

    @server.tool(
        name=f"{host.name}-call", description="Call a registered command under host policy"
    )
    async def call(command: str, arguments: dict | None = None) -> dict:
        return _dump(await host.execute(command, arguments))

    @server.tool(name=f"{host.name}-docs", description="Read a host documentation topic")
    async def docs(topic: str = "overview") -> str:
        if topic == "overview":
            return f"# {host.name} — Topics\n" + "\n".join(sorted(host.docs))
        return host.docs.get(topic, f"Unknown topic. Available: {', '.join(sorted(host.docs))}")

    if raw_python:

        @server.tool(name=f"{host.name}-run", description="Trusted local Python; no sandbox")
        async def run(code: str) -> dict:
            from afd import error, success

            from botcore.server import _validate_code

            invalid = _validate_code(code)
            if invalid:
                return _dump(error("INVALID_CODE", invalid, suggestion="Use valid Python"))

            def wrapper(command_name):
                async def invoke(*args, **kwargs):
                    import inspect

                    signature = inspect.signature(host._commands[command_name])
                    bound = signature.bind(*args, **kwargs)
                    return await host.execute(command_name, dict(bound.arguments))

                return invoke

            namespace = {alias: wrapper(command) for alias, command in raw_names.items()}
            try:
                wrapped = "async def _run():\n" + "\n".join(
                    "    " + line for line in code.splitlines()
                )
                exec(compile(wrapped, f"<{host.name}-trusted-local>", "exec"), namespace)
                value = await namespace["_run"]()
                return _dump(value if hasattr(value, "model_dump") else success(value))
            except Exception as exc:
                return _dump(error("EXECUTION_ERROR", str(exc), suggestion="Inspect trusted code"))

    return server
