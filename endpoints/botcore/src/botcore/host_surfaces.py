"""Thin host surfaces. All registered commands enter CommandHost.execute()."""

from __future__ import annotations

import asyncio
import contextlib
import inspect
import json
import warnings
from collections.abc import Awaitable, Callable
from typing import TYPE_CHECKING, Any, cast

import click
from afd import Actor, CommandResult, error, success
from afd.core.commands import CommandContext
from afd.core.result import failure

from botcore.host import (
    SECRET_AWARE,
    CommandHost,
    create_host_policy_middleware,
    isolated_call,
)
from botcore.host_inputs import describe_inputs

if TYPE_CHECKING:
    from afd.server.factory import MCPServer as AfdMCPServer
    from afd.server.types import ToolStrategy


def _dump(result: Any) -> dict[str, Any]:
    dumped: dict[str, Any] = result.model_dump(mode="json", exclude_none=True)
    return dumped


def _is_error_result(result: Any) -> bool:
    from afd.core.batch import BatchResult
    from afd.core.pipeline import PipelineResult, StepStatus

    if isinstance(result, (CommandResult, BatchResult)):
        return not result.success
    if isinstance(result, PipelineResult):
        return any(step.status == StepStatus.FAILURE for step in result.steps)
    if isinstance(result, dict) and isinstance(result.get("success"), bool):
        return not result["success"]
    return False


def _tool_call_result(result: Any) -> Any:
    """Wrap a result in an MCP CallToolResult in AFD's wire format (compatible with afd>=0.13)."""
    from afd.core.wire import to_wire
    from mcp.types import CallToolResult, TextContent

    wire = to_wire(result)
    return CallToolResult(
        content=[TextContent(type="text", text=json.dumps(wire))],
        structured_content=wire if isinstance(wire, dict) else None,
        is_error=_is_error_result(result),
    )


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
    """Names no host command may take: ``{name}-run`` whether or not ``raw_python`` is on, so a
    name never changes meaning with the option, and the retired ``-start``, ``-call`` and
    ``-docs`` (#2505), so an old client's call never reaches a different command."""
    return {f"{host.name}-{tool}" for tool in ("start", "call", "docs", "run")}


def _retired_tools(host: CommandHost) -> dict[str, str]:
    """The retired compatibility tools (#2505) and what a client calls instead."""

    def served(name: str) -> str:
        return host.resolve(name) or name

    return {
        f"{host.name}-start": (
            f"afd-discover to list the commands, or {served('info_catalog')} through "
            "afd-call for the catalog with each command's effects and policy"
        ),
        f"{host.name}-call": 'afd-call with {"command": ..., "input": {...}}',
        f"{host.name}-docs": f'afd-call with {{"command": "{served("info_docs")}"}}',
    }


def _afd_reserved_names(afd_server: AfdMCPServer) -> set[str]:
    from afd.core.builtin_names import (
        AFD_BOOTSTRAP_COMMAND_NAMES,
        AFD_CONTEXT_COMMAND_NAMES,
        AFD_META_TOOL_NAMES,
    )

    reserved = set(AFD_META_TOOL_NAMES)
    if afd_server.config.bootstrap:
        reserved |= set(AFD_BOOTSTRAP_COMMAND_NAMES)
    if afd_server.config.contexts:
        reserved |= set(AFD_CONTEXT_COMMAND_NAMES)
    return reserved


def _reserved_names(host: CommandHost, afd_server: AfdMCPServer) -> set[str]:
    return _meta_tool_names(host) | _afd_reserved_names(afd_server)


def _resolve_tool_strategy(
    command_tools: bool,
    tool_strategy: ToolStrategy | None,
) -> ToolStrategy:
    if tool_strategy is None:
        return "individual" if command_tools else "lazy"
    if command_tools and tool_strategy != "individual":
        raise ValueError("command_tools=True requires tool_strategy='individual' (or omitted)")
    return tool_strategy


def _build_raw_names(host: CommandHost) -> dict[str, str]:
    raw_names = {name: name for name in host.list_command_names()}
    for name in host.list_command_names():
        alias = name.replace("-", "_")
        if alias.isidentifier() and alias != name:
            if alias in raw_names and raw_names[alias] != name:
                raise ValueError(f"Ambiguous trusted-local Python alias: {alias}")
            raw_names[alias] = name
    return raw_names


def _register_host_command(afd_server: AfdMCPServer, host: CommandHost, served_name: str) -> None:
    """Register one host command on ``afd_server``, preserving host validation and execution."""
    from afd import ExposeOptions
    from afd.server import define_command

    description, input_schema = describe_inputs(host.handler(served_name))
    policy = host.policy(served_name)
    read_only = set(policy.declared()) <= {"inspect"}

    # When AFD's own journal is in the server's middleware, it keeps a secret call off its
    # parents' tapes and may record it on its own entry, so the host must not strip that tape.
    # Without one (or one it cannot recognise), the host isolates the call itself.
    isolated = bool(getattr(afd_server, "_botcore_journaled", False))

    async def host_command_handler(
        payload: Any = None,
        context: CommandContext | None = None,
        *,
        _name: str = served_name,
    ) -> CommandResult[Any]:
        with isolated_call() if isolated else contextlib.nullcontext():
            return await host.execute(_name, payload, context)

    # Botcore hosts may serve legacy snake_case names (kebab_names=False); suppress the
    # advisory kebab-case warning so construction stays quiet.
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", category=UserWarning, message=r"^\[AFD\] ")
        decorated = define_command(
            name=served_name,
            description=description or served_name,
            input_schema=None,
            advertised_input_schema=input_schema,
            mutation=not read_only,
            destructive=not read_only,
            # Every effect the command may have, so afd-detail shows them and afd-discover
            # filters on them (they were the catalog rows the retired `-start` returned).
            tags=[f"effect:{effect}" for effect in policy.declared()],
            # An afd before 0.14.0 has no `secret` here.
            **cast(dict[str, Any], {"secret": policy.secret} if SECRET_AWARE else {}),
            expose=ExposeOptions(mcp=True),
        )(host_command_handler)
        afd_server.register(decorated)


def _run_tool_schemas(
    host: CommandHost,
    *,
    raw_python: bool,
    afd_reserved: set[str],
) -> list[dict[str, Any]]:
    """The MCP Tool definition of ``{name}-run``, when ``raw_python`` is on.

    It is left out when its name collides with an active AFD built-in, so AFD's own tools are
    never duplicated or shadowed.
    """
    if not raw_python:
        return []
    tool = {
        "name": f"{host.name}-run",
        "description": "Trusted local Python; no sandbox",
        "inputSchema": {
            "type": "object",
            "properties": {"code": {"type": "string", "description": "Python snippet to execute"}},
            "required": ["code"],
        },
    }
    return [tool] if tool["name"] not in afd_reserved else []


async def _run_raw_python(
    host: CommandHost,
    code: Any,
    context: CommandContext | None = None,
) -> CommandResult[Any]:
    from botcore.server import _validate_code

    if not isinstance(code, str):
        return error("INVALID_CODE", "code must be a string", suggestion="Use valid Python")
    invalid = _validate_code(code)
    if invalid:
        return error("INVALID_CODE", invalid, suggestion="Use valid Python")

    raw_names = _build_raw_names(host)

    def wrapper(command_name: str) -> Callable[..., Any]:
        async def invoke(*args: Any, **kwargs: Any) -> Any:
            signature = inspect.signature(host.handler(command_name))
            bound = signature.bind(*args, **kwargs)
            return await host.execute(command_name, dict(bound.arguments), context)

        return invoke

    namespace: dict[str, Any] = {alias: wrapper(command) for alias, command in raw_names.items()}
    try:
        wrapped = "async def _run():\n" + "\n".join("    " + line for line in code.splitlines())
        exec(compile(wrapped, f"<{host.name}-trusted-local>", "exec"), namespace)
        value = await namespace["_run"]()
        if isinstance(value, CommandResult):
            return value
        return success(value)
    except Exception as exc:
        return error("EXECUTION_ERROR", str(exc), suggestion="Inspect trusted code")


def _alias_call_context(afd_server: AfdMCPServer, outcome: Any) -> CommandContext:
    from afd.server.auth import credentials_actor

    if outcome is not None and outcome.context is not None:
        return outcome.context  # type: ignore[no-any-return]
    admitted = afd_server._current_admitted_credentials()
    actor = (
        credentials_actor(admitted)
        if admitted is not None
        else (afd_server.config.actor or Actor(kind="agent"))
    )
    return CommandContext(actor=actor, credentials=admitted)


def _build_run_handlers(
    host: CommandHost,
    afd_server: AfdMCPServer,
    *,
    raw_python: bool,
    afd_reserved: set[str],
) -> dict[str, Callable[[dict[str, Any], Any, Any], Awaitable[Any]]]:
    """The handler of ``{name}-run``, when ``raw_python`` is on and the name is free."""
    if not raw_python or f"{host.name}-run" in afd_reserved:
        return {}

    async def handle_run(arguments: dict[str, Any], _context: Any, outcome: Any) -> Any:
        code = arguments.get("code") if isinstance(arguments, dict) else None
        run_ctx = _alias_call_context(afd_server, outcome)
        return _tool_call_result(await _run_raw_python(host, code, run_ctx))

    return {f"{host.name}-run": handle_run}


def _install_alias_tools(
    sdk_server: Any,
    afd_server: AfdMCPServer,
    alias_defs: list[dict[str, Any]],
) -> None:
    """Give the SDK the extra tools' input schemas (``{name}-run``), for Mcp-Param header checks.

    afd 0.14 answers the SDK's ``_tool_input_schema`` from its own table
    (``_add_tool_input_schemas``, lushly-dev/afd#1756); afd 0.13 read the SDK's tool manager.
    """
    add_schemas = getattr(afd_server, "_add_tool_input_schemas", None)
    if add_schemas is not None:
        add_schemas(alias_defs)
        return
    tool_manager = getattr(sdk_server, "_tool_manager", None)
    create_tool = getattr(afd_server, "_create_fastmcp_tool", None)
    if tool_manager is None or create_tool is None:
        return
    for definition in alias_defs:
        tool_manager._tools[definition["name"]] = create_tool(definition)


def _decide_alias_scope(
    afd_server: AfdMCPServer,
    view: Any,
    alias_name: str,
    arguments: dict[str, Any],
) -> Any:
    """Enforce ``required_scopes`` and any ``ScopeResolver`` on the host's ``-run`` tool."""
    from afd.server.auth_scopes import ScopeMissing, checked_decision, request_decision

    req_dec = view.decide_request()
    if req_dec != "proceed":
        return req_dec
    auth_layer = afd_server._auth_layer
    resolver = auth_layer.resolver if auth_layer is not None else None
    if resolver is None:
        return "proceed"
    try:
        decision = checked_decision(resolver.resolve(alias_name, arguments, view.credentials))
    except Exception:
        decision = ScopeMissing(())
    return request_decision([decision])


def _alias_visible(afd_server: AfdMCPServer, view: Any, alias_name: str) -> bool:
    auth_layer = afd_server._auth_layer
    if auth_layer is None or not auth_layer.filter_tools_by_scope:
        return True
    if view.decide_request() != "proceed":
        return False
    resolver = auth_layer.resolver
    if resolver is not None:
        try:
            if resolver.visible(alias_name, view.credentials) is not True:
                return False
            known_fn = getattr(resolver, "known", None)
            if callable(known_fn) and known_fn(alias_name, view.credentials) is not True:
                return False
        except Exception:
            return False
    return True


def _wrap_transport_methods(sdk_server: Any, afd_server: AfdMCPServer) -> None:
    """Keep ``afd_server._stateless_http`` synced across SDK transport entry points."""
    base_streamable_http_app = sdk_server.streamable_http_app
    base_run = sdk_server.run
    base_run_streamable_http_async = sdk_server.run_streamable_http_async

    def streamable_http_app(**http_options: Any) -> Any:
        afd_server._stateless_http = bool(http_options.get("stateless_http", False))
        return base_streamable_http_app(**http_options)

    def run(transport: str = "stdio", **run_options: Any) -> None:
        afd_server._stateless_http = transport == "streamable-http" and bool(
            run_options.get("stateless_http", False)
        )
        base_run(transport=transport, **run_options)

    async def run_streamable_http_async(
        *, host: str = "127.0.0.1", port: int = 8000, **http_options: Any
    ) -> None:
        afd_server._stateless_http = bool(http_options.get("stateless_http", False))
        await base_run_streamable_http_async(host=host, port=port, **http_options)

    sdk_server.streamable_http_app = streamable_http_app
    sdk_server.run = run
    sdk_server.run_streamable_http_async = run_streamable_http_async


def _wrap_discover_sync(sdk_server: Any, sync_host_commands: Callable[[], None]) -> None:
    lowlevel = getattr(sdk_server, "_lowlevel_server", None)
    get_handler = getattr(lowlevel, "get_request_handler", None) if lowlevel is not None else None
    discover_entry = get_handler("server/discover") if callable(get_handler) else None
    if lowlevel is None or discover_entry is None:
        return
    base_discover = discover_entry.handler

    async def discover_with_sync(ctx: Any, params: Any) -> Any:
        sync_host_commands()
        return await base_discover(ctx, params)

    lowlevel.add_request_handler("server/discover", discover_entry.params_type, discover_with_sync)


def _attach_host_bridge(
    sdk_server: Any,
    afd_server: AfdMCPServer,
    host: CommandHost,
    *,
    raw_python: bool,
) -> Any:
    """Wire dynamic host command sync, read-only annotations and ``{name}-run``."""
    from afd.server.context_hook import bind_hook_outcome, current_hook_outcome
    from afd.server.factory import _CURRENT_REQUEST
    from mcp.types import Tool as MCPTool

    afd_reserved = _afd_reserved_names(afd_server)
    reserved = _meta_tool_names(host) | afd_reserved
    retired = {
        name: replacement
        for name, replacement in _retired_tools(host).items()
        if name not in afd_reserved
    }
    alias_defs = _run_tool_schemas(host, raw_python=raw_python, afd_reserved=afd_reserved)
    alias_tools = [MCPTool.model_validate(definition) for definition in alias_defs]
    registered_names: set[str] = {cmd.name for cmd in afd_server.registry.list()}

    def sync_host_commands() -> None:
        added = False
        for name in host.list_command_names():
            if name in registered_names or name in reserved:
                continue
            _register_host_command(afd_server, host, name)
            registered_names.add(name)
            added = True
        if added:
            _install_alias_tools(sdk_server, afd_server, alias_defs)

    _install_alias_tools(sdk_server, afd_server, alias_defs)

    base_list_tools = sdk_server.list_tools
    base_call_tool = sdk_server.call_tool
    alias_handlers = _build_run_handlers(
        host, afd_server, raw_python=raw_python, afd_reserved=afd_reserved
    )

    async def dispatch_alias(
        name: str,
        arguments: dict[str, Any],
        context: Any,
        outcome: Any,
    ) -> Any:
        if outcome is not None and outcome.refusal is not None:
            return _tool_call_result(failure(outcome.refusal))
        view = afd_server._current_scope_view()
        if view is not None:
            alias_dec = _decide_alias_scope(afd_server, view, name, arguments)
            if alias_dec != "proceed":
                return _tool_call_result(failure(view.insufficient_scope(alias_dec.forbidden)))
        return await alias_handlers[name](arguments, context, outcome)

    async def list_tools() -> list[Any]:
        sync_host_commands()
        raw_tools = list(await base_list_tools())
        tools: list[Any] = []
        for tool in raw_tools:
            if tool.name not in reserved and host.resolve(tool.name) == tool.name:
                dumped = tool.model_dump(by_alias=True, exclude_none=True)
                dumped["annotations"] = command_annotations(host, tool.name)
                tools.append(MCPTool.model_validate(dumped))
            else:
                tools.append(tool)
        view = afd_server._current_scope_view()
        for alias in alias_tools:
            if view is not None and not _alias_visible(afd_server, view, alias.name):
                continue
            tools.append(alias)
        return tools

    async def call_tool(name: Any, arguments: Any = None, context: Any = None) -> Any:
        sync_host_commands()
        if isinstance(name, str) and name in retired:
            if not afd_server._is_auth_admitted():
                return _tool_call_result(failure(afd_server._unauthorized_error()))
            return _tool_call_result(
                error(
                    "TOOL_RETIRED",
                    f"{name} was retired; {host.name} serves AFD's tools instead",
                    suggestion=f"Call {retired[name]}",
                )
            )
        if isinstance(name, str) and name in alias_handlers:
            if not afd_server._is_auth_admitted():
                return _tool_call_result(failure(afd_server._unauthorized_error()))
            payload = arguments if isinstance(arguments, dict) else {}
            outcome = current_hook_outcome()
            if outcome is None and afd_server.config.context_hook is not None:
                outcome = await afd_server._run_context_hook(name, _CURRENT_REQUEST.get())
                with bind_hook_outcome(outcome):
                    return await dispatch_alias(name, payload, context, outcome)
            return await dispatch_alias(name, payload, context, outcome)
        return await base_call_tool(name, {} if arguments is None else arguments, context)

    sdk_server.list_tools = list_tools
    sdk_server.call_tool = call_tool
    _wrap_transport_methods(sdk_server, afd_server)
    sdk_server.afd_server = afd_server
    # Keep transport helpers on `.afd_server` bound to this bridged SDK server instance.
    afd_server._create_mcp_server = lambda: sdk_server  # type: ignore[method-assign]
    _wrap_discover_sync(sdk_server, sync_host_commands)

    return sdk_server


def create_host_mcp_server(
    host: CommandHost,
    *,
    raw_python: bool = False,
    command_tools: bool = False,
    tool_strategy: ToolStrategy | None = None,
    version: str = "0.1.0",
    description: str | None = None,
    **afd_options: Any,
) -> Any:
    """Serve a managed :class:`CommandHost` through ``afd.server.create_server``.

    Applies the host's policy, execution profile and path bounds as AFD middleware
    (``create_host_policy_middleware``), while routing every admitted command through
    ``host.execute``. Requires the ``mcp`` extra (``afd[server]>=0.13.0``, ``mcp>=2.3,<3``).

    - ``command_tools=False`` (default) uses AFD's ``"lazy"`` strategy: AFD's five meta-tools,
      ``afd-discover``, ``afd-detail``, ``afd-call``, ``afd-batch`` and ``afd-pipe``. The
      ``{name}-start``, ``{name}-call`` and ``{name}-docs`` aliases were retired (#2505); their
      names stay reserved (a call is refused as ``TOOL_RETIRED``, naming the
      replacement), and ``build_host``'s ``info_catalog`` and ``info_docs`` commands carry
      what ``-start`` and ``-docs`` returned.
    - ``command_tools=True`` uses AFD's ``"individual"`` strategy, also serving each host
      command as its own tool with the catalog's input schema and ``readOnlyHint`` /
      ``destructiveHint`` annotations derived from its declared effects.
    - ``tool_strategy`` may select any AFD strategy (``"lazy"``, ``"individual"``,
      ``"grouped"``, ``"hybrid"`` with ``first_class_tools``).
    - ``raw_python=True`` requires ``host.context.profile == "trusted-local"`` and adds
      ``{name}-run`` (unconfined Python whose supplied command functions still dispatch
      through ``host.execute``).
    - ``default_timeout_ms`` defaults to ``None`` (no per-command timeout) so long-running
      commands such as ``dev_test`` or ``dev_build`` keep their existing behavior unless a
      caller sets an explicit timeout.
    - ``skills`` defaults to :func:`botcore.host_skills.host_skill_catalog`: Botcore's bundled
      skills and the folders the host's plugins register, filtered by the workspace's
      ``[skills]`` ``include`` and ``skip``, served over ``io.modelcontextprotocol/skills``.
      Pass a ``SkillCatalog`` to serve others, or ``skills=None`` to serve none.
    - Additional keyword arguments (such as ``resources``, ``auth``,
      ``context_hook``, ``context_fields``, ``middleware``, ``first_class_tools``,
      ``instructions``) are forwarded to ``afd.server.create_server``. The returned MCP SDK
      server also exposes ``.afd_server`` for inspecting the underlying AFD server.
    """
    if raw_python and host.context.profile != "trusted-local":
        raise ValueError("Raw Python requires the trusted-local profile")

    strategy = _resolve_tool_strategy(command_tools, tool_strategy)
    if raw_python:
        _build_raw_names(host)

    from afd.server import create_server as create_afd_server

    options = dict(afd_options)
    options.setdefault("default_timeout_ms", None)
    if "skills" not in options:
        from botcore.host_skills import host_skill_catalog

        options["skills"] = host_skill_catalog(host)
    extra_middleware = list(options.pop("middleware", None) or [])
    actor = options.pop("actor", None) or host.actor or Actor(kind="agent")

    afd_server = create_afd_server(
        host.name,
        version=version,
        description=description,
        middleware=[create_host_policy_middleware(host), *extra_middleware],
        tool_strategy=strategy,
        actor=actor,
        **options,
    )
    afd_server._botcore_journaled = any(  # type: ignore[attr-defined]
        getattr(middleware, "__afd_journal__", False) is True for middleware in extra_middleware
    )
    reserved = _reserved_names(host, afd_server)
    for name in host.list_command_names():
        if name in _meta_tool_names(host):
            raise ValueError(f"Command {name} collides with a {host.name} meta-tool")
        if name in reserved:
            raise ValueError(f"Command name '{name}' is reserved")
        _register_host_command(afd_server, host, name)

    sdk_server = afd_server._create_mcp_server()
    return _attach_host_bridge(
        sdk_server,
        afd_server,
        host,
        raw_python=raw_python,
    )
