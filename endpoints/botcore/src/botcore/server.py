"""MCP server factory — builds namespace, docs, and FastMCP server from the plugin registry.

Public API:
    build_namespace()      → (namespace dict, populated PluginRegistry)
    build_docs(registry)   → merged docs dict
    create_mcp_server(name, ...) → FastMCP instance with {name}-start/docs/run tools
"""

from __future__ import annotations

import ast
import io
import json
import traceback
from collections.abc import Callable
from contextlib import redirect_stderr, redirect_stdout
from typing import Any

from botcore.config import load_config
from botcore.docs import CORE_DOCS
from botcore.plugin import PluginRegistry, discover_plugins
from botcore.utils.runner import MAX_OUTPUT_LENGTH, smart_truncate


def build_namespace(
    extra_commands: list[Callable[..., Any]] | None = None,
) -> tuple[dict[str, Callable[..., Any]], PluginRegistry]:
    """Build the execution namespace from botcore core commands + plugin commands.

    Returns:
        Tuple of (namespace dict, populated PluginRegistry).
    """
    from botcore import commands as cmd_module

    namespace: dict[str, Callable[..., Any]] = {}

    # 1. All botcore core commands
    for name in cmd_module.__all__:
        namespace[name] = getattr(cmd_module, name)

    # 2. Plugin commands via discovery
    plugins = discover_plugins()
    config = load_config(discovered_plugins=plugins)
    registry = PluginRegistry()
    for name, plugin in plugins.items():
        plugin_config = config.plugins.get(name)
        configure = getattr(plugin, "configure", None)
        if plugin_config is not None and callable(configure):
            configure(plugin_config)
        plugin.register(registry)
    for cmd in registry.commands:
        if cmd.__name__ in namespace:
            raise ValueError(f"Duplicate command: {cmd.__name__}")
        namespace[cmd.__name__] = cmd

    # 3. Extra commands passed directly (escape hatch)
    if extra_commands:
        for cmd in extra_commands:
            if cmd.__name__ in namespace:
                raise ValueError(f"Duplicate command: {cmd.__name__}")
            namespace[cmd.__name__] = cmd

    return namespace, registry


def build_docs(
    registry: PluginRegistry,
    extra_docs: dict[str, str] | None = None,
) -> dict[str, str]:
    """Merge core docs + plugin docs + extras.

    Returns:
        Combined docs dict keyed by topic name.
    """
    docs = dict(CORE_DOCS)
    overlap = set(docs) & set(registry.docs)
    if overlap:
        raise ValueError(f"Duplicate documentation topics: {sorted(overlap)}")
    docs.update(registry.docs)
    if extra_docs:
        overlap = set(docs) & set(extra_docs)
        if overlap:
            raise ValueError(f"Duplicate documentation topics: {sorted(overlap)}")
        docs.update(extra_docs)
    return docs


# Input guard for ``{name}-run`` code. It bounds abuse of the exec surface, not the model's
# context: a run's output is bounded separately by MAX_OUTPUT_LENGTH.
MAX_RUN_CODE_LENGTH = 32_000


def _validate_code(code: str) -> str | None:
    """Basic AST validation — returns error message or None if OK."""
    if len(code) > MAX_RUN_CODE_LENGTH:
        return f"Code too long (max {MAX_RUN_CODE_LENGTH} chars)"
    try:
        ast.parse(code)
    except SyntaxError as e:
        return f"Syntax error: {e}"
    return None


def create_mcp_server(
    name: str,
    *,
    version: str = "0.1.0",
    description: str | None = None,
    include_research: bool = False,
    extra_commands: list[Callable[..., Any]] | None = None,
    extra_docs: dict[str, str] | None = None,
) -> Any:
    """Create the legacy trusted-local FastMCP server.

    This compatibility API executes unrestricted Python and has no restricted
    profile. New managed hosts use create_host_mcp_server with explicit policy.

    Create a fully-wired FastMCP server driven by the plugin registry.

    Args:
        name: Server name and tool prefix (e.g. "lib" → lib-start, lib-docs, lib-run).
        version: Server version string.
        description: Server description (auto-generated if None).
        include_research: Whether to register {name}-research tool.
        extra_commands: Additional commands to include in namespace.
        extra_docs: Additional doc topics to include.

    Returns:
        FastMCP server instance (call ``.run(transport="stdio")`` to start).
    """
    try:
        from botcore._mcp import sdk_types

        FastMCP, _ = sdk_types()
    except ImportError:
        raise ImportError("FastMCP not available. Install with: pip install 'botcore[mcp]'")

    namespace, registry = build_namespace(extra_commands)
    docs = build_docs(registry, extra_docs)
    desc = description or f"{name} bot — built on botcore"

    server = FastMCP(name)

    # ── {name}-start ──────────────────────────────────────────────────
    @server.tool(
        name=f"{name}-start",
        description="Discovery — version, available functions, quick start",
    )
    async def _start() -> str:
        return json.dumps(
            {
                "name": name,
                "version": version,
                "description": desc,
                "available_functions": sorted(namespace.keys()),
                "topics": sorted(docs.keys()),
            },
            indent=2,
        )

    # ── {name}-docs ───────────────────────────────────────────────────
    @server.tool(
        name=f"{name}-docs",
        description=f"Reference docs by topic ({', '.join(sorted(docs.keys()))})",
    )
    async def _docs(topic: str = "overview") -> str:
        if topic == "overview":
            lines = [f"# {name} — Topics\n"]
            for t in sorted(docs.keys()):
                first_line = docs[t].strip().splitlines()[0] if docs[t].strip() else t
                lines.append(f"- **{t}**: {first_line}")
            return "\n".join(lines)
        if topic not in docs:
            avail = ", ".join(sorted(docs.keys()))
            return f"Unknown topic: '{topic}'. Available: overview, {avail}"
        return docs[topic]

    # ── {name}-run ────────────────────────────────────────────────────
    @server.tool(
        name=f"{name}-run",
        description="Execute Python code with all functions available. Use await.",
    )
    async def _run(code: str) -> str:
        validation_error = _validate_code(code)
        if validation_error:
            return json.dumps({"error": validation_error})

        run_ns = dict(namespace)
        run_ns["help"] = lambda: print("Available functions:", sorted(namespace.keys()))
        run_ns["list_functions"] = lambda: sorted(namespace.keys())

        stdout_buf = io.StringIO()
        stderr_buf = io.StringIO()

        try:
            wrapped = "async def __run__():\n"
            for line in code.splitlines():
                wrapped += f"    {line}\n"
            wrapped += "\n__result__ = __run__()"

            exec(compile(wrapped, f"<{name}-run>", "exec"), run_ns)

            with redirect_stdout(stdout_buf), redirect_stderr(stderr_buf):
                result = await run_ns["__result__"]

            captured = stdout_buf.getvalue()
            if result is not None:
                output = json.dumps(result, indent=2, default=str)
            elif captured:
                output = captured
            else:
                output = "OK"
        except Exception:
            output = traceback.format_exc()

        return smart_truncate(output, max_len=MAX_OUTPUT_LENGTH)

    # ── {name}-research (optional) ────────────────────────────────────
    if include_research:
        _, Context = sdk_types()

        async def _research(query: str, ctx: Context, mode: str = "fast") -> str:
            from afd import error

            from botcore.commands.research import research_result, research_stream

            # Forward the stream as MCP progress notifications. Progress must increase
            # with every notification, so it counts notifications; the message carries
            # the status text or the next piece of the answer.
            step = 0
            async for chunk in research_stream(query, mode):
                result = research_result(chunk)
                if result is not None:
                    return json.dumps(result.model_dump(mode="json", exclude_none=True), indent=2)
                step += 1
                message = chunk.message if chunk.type == "progress" else chunk.data["text"]
                await ctx.report_progress(step, message=message)
            result = error(
                "RESEARCH_FAILED",
                "Research stream ended without a result",
                suggestion="Retry the query",
            )
            return json.dumps(result.model_dump(mode="json", exclude_none=True), indent=2)

        # FastMCP finds the Context parameter through type hints, which cannot resolve
        # this module's string annotations for a function-local import.
        _research.__annotations__["ctx"] = Context
        server.add_tool(
            _research,
            name=f"{name}-research",
            description="Web research with GPT models. Modes: fast, deep, thinking.",
        )

    return server
