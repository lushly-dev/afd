"""Server factory for creating AFD MCP servers."""

from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Protocol, Type, TypeVar, runtime_checkable

from pydantic import BaseModel, ConfigDict, create_model
from pydantic import ValidationError as PydanticValidationError

from afd.core.batch import (
    BatchCommandResult,
    BatchRequest,
    BatchResult,
    BatchTiming,
    create_batch_result,
    create_failed_batch_result,
)
from afd.core.commands import (
    CommandContext,
    CommandDefinition,
    CommandExample,
    CommandRegistry,
    DEFAULT_EXPOSE,
    ExposeOptions,
    create_command_registry,
)
from afd.core.errors import CommandError
from afd.core.pipeline import PipelineRequest, PipelineResult, StepStatus, execute_pipeline
from afd.core.result import CommandResult, error
from afd.core.wire import to_wire
from afd.server.bootstrap import ContextState, create_context_state, get_bootstrap_commands
from afd.server.decorators import (
    CommandMetadata,
    command_to_definition,
    define_command,
    get_command_metadata,
    has_command_metadata,
)
from afd.server.middleware import CommandMiddleware
from afd.server.tool_router import ToolRouterDeps, create_tool_router
from afd.server.tools import filter_commands_by_context, get_tools_list
from afd.server.types import ContextConfig, GroupByFn, ToolStrategy

TInput = TypeVar("TInput", bound=BaseModel)
TOutput = TypeVar("TOutput")

# Never log to stdout: the stdio transport uses it for JSON-RPC.
logger = logging.getLogger("afd.server")


@runtime_checkable
class MCPTransport(Protocol):
    """Protocol for MCP transport implementations."""

    async def start(self) -> None:
        ...

    async def stop(self) -> None:
        ...


@dataclass
class ServerConfig:
    """Configuration for an AFD server."""

    name: str
    version: str = "1.0.0"
    description: Optional[str] = None
    transport: Optional[str] = "fastmcp"
    middleware: List[CommandMiddleware] = field(default_factory=list)
    tool_strategy: ToolStrategy = "individual"
    contexts: List[ContextConfig] = field(default_factory=list)
    group_by: Optional[GroupByFn] = None
    dev_mode: bool = False


class MCPServer:
    """AFD MCP server for exposing commands and built-in tools."""

    def __init__(self, config: ServerConfig):
        self.config = config
        self._registry = create_command_registry()
        self._commands: Dict[str, Callable] = {}
        self._metadata: Dict[str, CommandMetadata] = {}
        self._mcp_server = None
        self._middleware: List[CommandMiddleware] = list(config.middleware)
        self._context_state: ContextState = create_context_state()
        self._bootstrap_commands: Optional[List[CommandDefinition]] = None

    @property
    def name(self) -> str:
        return self.config.name

    @property
    def version(self) -> str:
        return self.config.version

    @property
    def registry(self) -> CommandRegistry:
        return self._registry

    @property
    def context_state(self) -> ContextState:
        return self._context_state

    def list_contexts(self) -> List[ContextConfig]:
        return list(self.config.contexts)

    def command(
        self,
        name: str,
        description: str,
        category: Optional[str] = None,
        input_schema: Optional[Type[BaseModel]] = None,
        output_schema: Optional[Type[BaseModel]] = None,
        tags: Optional[List[str]] = None,
        mutation: bool = False,
        examples: Optional[List[CommandExample | Dict[str, Any]]] = None,
        requires: Optional[List[str]] = None,
        contexts: Optional[List[str]] = None,
        expose: Optional[ExposeOptions] = None,
    ) -> Callable:
        """Decorator to register a command with this server."""

        def decorator(func: Callable) -> Callable:
            decorated = define_command(
                name=name,
                description=description,
                category=category,
                input_schema=input_schema,
                output_schema=output_schema,
                tags=tags,
                mutation=mutation,
                examples=examples,
                requires=requires,
                contexts=contexts,
                expose=expose,
            )(func)
            self.register(decorated)
            return decorated

        return decorator

    def register(self, func: Callable) -> None:
        """Register an already-decorated command function."""

        if not has_command_metadata(func):
            raise ValueError(f"Function {func.__name__} is not decorated with @define_command")

        definition = command_to_definition(func)
        metadata = get_command_metadata(func)
        if definition is None or metadata is None:
            raise ValueError(f"Function {func.__name__} is missing command metadata")

        self._registry.register(definition)
        self._commands[definition.name] = func
        self._metadata[definition.name] = metadata
        self._sync_mcp_tool_definitions()

    def _get_bootstrap_commands(self) -> List[CommandDefinition]:
        if self._bootstrap_commands is None:
            options: Dict[str, Any] = {
                "get_json_schema": lambda command: command.input_schema or {},
            }
            if self.config.contexts:
                options["get_contexts"] = self.list_contexts
                options["context_state"] = self._context_state
            # Discovery commands are served over MCP, so they only see
            # MCP-exposed commands.
            self._bootstrap_commands = get_bootstrap_commands(
                lambda: self.list_exposed_commands(
                    interface="mcp", include_bootstrap=True, context_filtered=True
                ),
                options=options,
            )
        return list(self._bootstrap_commands)

    def list_commands(
        self,
        *,
        include_bootstrap: bool = False,
        context_filtered: bool = False,
    ) -> List[CommandDefinition]:
        """List registered commands."""

        commands = list(self._registry.list())
        if include_bootstrap:
            commands.extend(self._get_bootstrap_commands())
        if context_filtered:
            commands = filter_commands_by_context(commands, self._context_state.get_active())
        return commands

    def _find_command(
        self,
        name: str,
        *,
        include_bootstrap: bool = True,
        context_filtered: bool = False,
    ) -> Optional[CommandDefinition]:
        for command in self.list_commands(include_bootstrap=include_bootstrap, context_filtered=context_filtered):
            if command.name == name:
                return command
        return None

    def _is_exposed_to(self, command: CommandDefinition, interface: str) -> bool:
        expose = command.expose if command.expose is not None else DEFAULT_EXPOSE
        return bool(getattr(expose, interface, False))

    def list_exposed_commands(
        self,
        *,
        interface: str = "mcp",
        include_bootstrap: bool = True,
        context_filtered: bool = False,
    ) -> List[CommandDefinition]:
        """List commands exposed on a specific interface."""

        return [
            command
            for command in self.list_commands(
                include_bootstrap=include_bootstrap,
                context_filtered=context_filtered,
            )
            if self._is_exposed_to(command, interface)
        ]

    async def _invoke_command(
        self,
        command: CommandDefinition,
        input: Any,
        context: Optional[CommandContext] = None,
    ) -> CommandResult:
        context = context or CommandContext()

        interface = context.extra.get("interface") if context.extra else None
        if interface:
            if interface not in {"palette", "mcp", "agent", "cli"}:
                return error(
                    "INVALID_INTERFACE",
                    f"Unknown interface '{interface}'",
                    suggestion="Valid interfaces: agent, cli, mcp, palette",
                )
            if not self._is_exposed_to(command, interface):
                return error(
                    "COMMAND_NOT_EXPOSED",
                    f"Command '{command.name}' is not exposed to {interface}",
                    suggestion="Check command exposure settings or use a different interface.",
                )

        active_context = self._context_state.get_active()
        if active_context and command.contexts and active_context not in command.contexts:
            return error(
                "COMMAND_NOT_IN_CONTEXT",
                f"Command '{command.name}' is not available in context '{active_context}'",
                suggestion="Use afd-context-list to inspect contexts, or afd-context-enter to switch.",
            )

        try:
            return await command.handler(input, context)
        except Exception as exc:
            return self._internal_error(command.name, exc)

    def _internal_error(self, command_name: str, exc: Exception) -> CommandResult:
        """Log an unexpected exception and return a failure that is safe to send remotely.

        The exception text is only returned when ``dev_mode`` is enabled.
        """
        logger.error(
            "Command '%s' raised an unhandled exception",
            command_name,
            exc_info=exc,
        )
        if self.config.dev_mode:
            return error(
                "COMMAND_EXECUTION_ERROR",
                str(exc),
                suggestion="Check the command implementation",
            )
        return error(
            "COMMAND_EXECUTION_ERROR",
            "An internal error occurred",
            suggestion="Contact support if this persists",
        )

    async def _execute_command_direct(
        self,
        name: str,
        input: Any,
        context: Optional[CommandContext] = None,
    ) -> CommandResult:
        command = self._find_command(name, include_bootstrap=True, context_filtered=True)
        if command is None:
            if self._find_command(name, include_bootstrap=True, context_filtered=False) is not None:
                active_context = self._context_state.get_active() or "unknown"
                return error(
                    "COMMAND_NOT_IN_CONTEXT",
                    f"Command '{name}' is not available in context '{active_context}'",
                    suggestion="Use afd-context-list to inspect contexts, or afd-context-enter to switch.",
                )
            return error(
                "COMMAND_NOT_FOUND",
                f"Command '{name}' not found",
                suggestion="Use afd-help or afd-discover to inspect available commands.",
            )
        return await self._invoke_command(command, input, context)

    async def execute(
        self,
        name: str,
        input: Any,
        context: Optional[CommandContext] = None,
    ) -> Any:
        """Execute a command or built-in tool by name."""

        if name in {"afd-call", "afd-batch", "afd-pipe", "afd-discover", "afd-detail"}:
            return await self.route_tool_call(name, input)

        context = context or CommandContext()

        if not self._middleware:
            result = await self._execute_command_direct(name, input, context)
            self._refresh_dynamic_tools(name, result)
            return result

        async def run_handler() -> CommandResult:
            return await self._execute_command_direct(name, input, context)

        next_fn = run_handler
        for middleware in reversed(self._middleware):
            current_next = next_fn
            next_fn = (lambda mw, nxt: (lambda: mw(name, input, context, nxt)))(middleware, current_next)

        result = await next_fn()
        self._refresh_dynamic_tools(name, result)
        return result

    def _refresh_dynamic_tools(self, name: str, result: Any) -> None:
        """Refresh live MCP tool registration after context-changing commands."""

        if (
            self._mcp_server is not None
            and name in {"afd-context-enter", "afd-context-exit"}
            and isinstance(result, CommandResult)
            and result.success
        ):
            self._sync_mcp_tool_definitions()

    def _install_fastmcp_context_error_translation(self) -> None:
        """Translate stale direct tool calls into actionable context errors when possible."""

        if self._mcp_server is None:
            return

        tool_manager = getattr(self._mcp_server, "_tool_manager", None)
        if tool_manager is None or getattr(tool_manager, "_afd_context_error_translation", False):
            return

        original_call_tool = tool_manager.call_tool
        server = self

        async def wrapped_call_tool(
            name: str,
            arguments: dict[str, Any],
            context: Any = None,
            convert_result: bool = False,
        ) -> Any:
            tool = tool_manager.get_tool(name)
            if tool is None:
                active_context = server._context_state.get_active()
                registered = server._find_command(name, include_bootstrap=True, context_filtered=False)
                visible = server._find_command(name, include_bootstrap=True, context_filtered=True)
                if (
                    active_context
                    and registered is not None
                    and visible is None
                    and registered.contexts
                    and active_context not in registered.contexts
                ):
                    return _tool_call_result(
                        error(
                            "COMMAND_NOT_IN_CONTEXT",
                            f"Command '{name}' is not available in context '{active_context}'",
                            suggestion=(
                                "Use afd-context-list to inspect contexts, "
                                "or afd-context-enter to switch."
                            ),
                        )
                    )

            return await original_call_tool(
                name,
                arguments,
                context=context,
                convert_result=convert_result,
            )

        tool_manager.call_tool = wrapped_call_tool
        tool_manager._afd_context_error_translation = True

    async def _execute_batch(
        self,
        request: BatchRequest | dict[str, Any],
        context: Optional[CommandContext] = None,
    ):
        start_time = time.perf_counter()
        started_at = datetime.now(timezone.utc).isoformat()
        results: List[BatchCommandResult] = []
        if not isinstance(request, BatchRequest):
            payload = dict(request)
            options = dict(payload.get("options") or {})
            if "timeoutMs" in options:
                if "timeout" in options:
                    return _invalid_batch("Specify only one of timeout or timeoutMs")
                options["timeout"] = options.pop("timeoutMs")
            payload["options"] = options
            try:
                request = BatchRequest.model_validate(payload)
            except PydanticValidationError as exc:
                return _invalid_batch(_describe_validation_error(exc))

        options = request.options
        parallelism = options.parallelism if options else 1
        timeout_ms = options.timeout if options else None
        semaphore = asyncio.Semaphore(parallelism)
        stopped = False
        timed_out = False

        async def run_command(index: int):
            nonlocal stopped, timed_out
            batch_command = request.commands[index]
            async with semaphore:
                if stopped or timed_out:
                    return None
                command_start = time.perf_counter()
                remaining = None
                if timeout_ms is not None:
                    remaining = (timeout_ms / 1000) - (time.perf_counter() - start_time)
                try:
                    if remaining is not None and remaining <= 0:
                        raise asyncio.TimeoutError
                    execution = self.execute(batch_command.command, batch_command.input, context)
                    command_result = (
                        await asyncio.wait_for(execution, timeout=remaining)
                        if remaining is not None
                        else await execution
                    )
                except asyncio.TimeoutError:
                    timed_out = True
                    command_result = CommandResult(
                        success=False,
                        error=CommandError(
                            code="BATCH_TIMEOUT",
                            message=f"Batch timeout exceeded ({timeout_ms}ms)",
                            suggestion="Increase timeout or reduce the number of commands",
                            retryable=True,
                        ),
                    )
                except Exception as exc:
                    command_result = self._internal_error(batch_command.command, exc)
                duration_ms = (time.perf_counter() - command_start) * 1000
                if options and options.stop_on_error and not command_result.success:
                    stopped = True
                return BatchCommandResult(
                    id=batch_command.id or f"cmd-{index}",
                    index=index,
                    command=batch_command.command,
                    result=command_result,
                    duration_ms=duration_ms,
                )

        scheduled = await asyncio.gather(
            *(run_command(index) for index in range(len(request.commands)))
        )
        for index, result in enumerate(scheduled):
            if result is not None:
                results.append(result)
                continue
            batch_command = request.commands[index]
            command_error = CommandError(
                code="BATCH_TIMEOUT" if timed_out else "COMMAND_SKIPPED",
                message=(
                    f"Batch timeout exceeded ({timeout_ms}ms)"
                    if timed_out
                    else "Command skipped because batch execution stopped after a failure"
                ),
                suggestion=(
                    "Increase timeout or reduce the number of commands"
                    if timed_out
                    else "Disable stop_on_error to execute every command"
                ),
                retryable=True if timed_out else None,
            )
            results.append(
                BatchCommandResult(
                    id=batch_command.id or f"cmd-{index}",
                    index=index,
                    command=batch_command.command,
                    result=CommandResult(success=False, error=command_error),
                    duration_ms=0,
                )
            )

        total_ms = (time.perf_counter() - start_time) * 1000
        timing = BatchTiming(
            total_ms=total_ms,
            average_ms=(total_ms / len(results)) if results else 0,
            started_at=started_at,
            completed_at=datetime.now(timezone.utc).isoformat(),
        )
        return create_batch_result(results, timing)

    async def _execute_pipeline(
        self,
        request: PipelineRequest | dict[str, Any],
        context: Optional[CommandContext] = None,
    ):
        if not isinstance(request, PipelineRequest):
            payload = dict(request)
            options = dict(payload.get("options") or {})
            if "continueOnFailure" in options and "continue_on_failure" not in options:
                options["continue_on_failure"] = options.pop("continueOnFailure")
            if "timeoutMs" in options and "timeout_ms" not in options:
                options["timeout_ms"] = options.pop("timeoutMs")
            payload["options"] = options
            request = PipelineRequest.model_validate(payload)

        async def executor(command_name: str, payload: Dict[str, Any]) -> CommandResult:
            try:
                result = await self.execute(command_name, payload, context)
            except Exception as exc:
                return self._internal_error(command_name, exc)
            if not isinstance(result, CommandResult):
                raise TypeError(f"Pipeline step '{command_name}' did not return a CommandResult")
            return result

        return await execute_pipeline(request, executor)

    def _create_router(self) -> Callable[[str, Any], Any]:
        commands = self.list_exposed_commands(interface="mcp", include_bootstrap=True, context_filtered=False)
        return create_tool_router(
            ToolRouterDeps(
                execute_command=self.execute,
                execute_batch=self._execute_batch,
                execute_pipeline=self._execute_pipeline,
                commands=commands,
                tool_strategy=self.config.tool_strategy,
                group_by_fn=self.config.group_by,
                # Only MCP-exposed commands are visible to MCP routing and
                # discovery (afd-call, afd-detail), as in the TS server.
                all_commands=commands,
                exposed_command_names={command.name for command in commands},
                context_state=self._context_state,
            )
        )

    async def route_tool_call(self, tool_name: str, args: Any = None) -> Any:
        """Route a tool call through the shared tool router."""

        router = self._create_router()
        return await router(tool_name, args or {})

    async def call_tool(self, tool_name: str, args: Any = None) -> Any:
        """Compatibility wrapper for invoking an MCP-visible tool directly."""

        return await self.route_tool_call(tool_name, args or {})

    def get_tool_definitions(self) -> List[Dict[str, Any]]:
        """Return the MCP-visible tool definitions for the current strategy."""

        return get_tools_list(
            self.list_exposed_commands(interface="mcp", include_bootstrap=True, context_filtered=False),
            self.config.tool_strategy,
            group_by_fn=self.config.group_by,
            active_context=self._context_state.get_active(),
        )

    def get_mcp_tools(self) -> List[Dict[str, Any]]:
        """Compatibility wrapper returning current MCP-visible tool definitions."""

        return self.get_tool_definitions()

    def _sync_mcp_tool_definitions(self) -> None:
        """Rebuild the live FastMCP tool registry from the current visible surface."""

        if not self._mcp_server:
            return

        tool_manager = getattr(self._mcp_server, "_tool_manager", None)
        if tool_manager is None:
            return

        tool_manager._tools.clear()
        for tool_definition in self.get_tool_definitions():
            tool = self._create_fastmcp_tool(tool_definition)
            tool_manager._tools[tool.name] = tool

    def _build_input_model(self, tool_name: str, schema: Dict[str, Any]) -> Type[BaseModel]:
        """Build a FastMCP argument model that passes arguments through unchanged.

        The advertised ``inputSchema`` is the command's schema, but FastMCP does
        not validate against it: a missing or mistyped argument must reach the
        command, whose own validation returns a structured VALIDATION_ERROR
        result (as the TypeScript server does) instead of a raw FastMCP error.
        """
        from mcp.server.fastmcp.utilities.func_metadata import ArgModelBase

        class PassthroughArgs(ArgModelBase):
            model_config = ConfigDict(arbitrary_types_allowed=True, extra="allow")

            def model_dump_one_level(self) -> dict[str, Any]:
                return dict(self.model_extra or {})

        return create_model(
            f"{tool_name.replace('-', '_')}_Input",
            __base__=PassthroughArgs,
        )

    def _create_fastmcp_tool(self, tool_definition: Dict[str, Any]):
        from mcp.server.fastmcp.tools import Tool
        from mcp.server.fastmcp.utilities.func_metadata import FuncMetadata

        input_schema = tool_definition.get("inputSchema", {"type": "object", "properties": {}})
        input_model = self._build_input_model(
            tool_definition["name"],
            input_schema,
        )

        tool_name = tool_definition["name"]

        async def handler(**payload: Any) -> Any:
            try:
                result = await self.route_tool_call(tool_name, payload)
                return _tool_call_result(result)
            except Exception as exc:
                return _tool_call_result(self._internal_error(tool_name, exc))

        return Tool(
            fn=handler,
            name=tool_definition["name"],
            description=tool_definition.get("description", ""),
            parameters=input_schema,
            fn_metadata=FuncMetadata(arg_model=input_model),
            is_async=True,
            context_kwarg=None,
            meta=tool_definition.get("_meta"),
        )

    def _create_mcp_server(self):
        """Create the underlying FastMCP server."""

        try:
            from mcp.server.fastmcp import FastMCP
        except ImportError as exc:  # pragma: no cover - optional dependency
            raise ImportError("FastMCP not installed. Install with: pip install afd[server]") from exc

        self._mcp_server = FastMCP(self.config.name)
        self._sync_mcp_tool_definitions()
        self._install_fastmcp_context_error_translation()
        return self._mcp_server

    def run(self, transport: str = "stdio") -> None:
        mcp = self._create_mcp_server()
        if transport not in {"stdio", "sse"}:
            raise ValueError(f"Unknown transport: {transport}")
        mcp.run(transport=transport)

    async def run_async(self, transport: str = "stdio") -> None:
        mcp = self._create_mcp_server()
        if transport == "stdio":
            await mcp.run_stdio_async()
        elif transport == "sse":
            await mcp.run_sse_async()
        elif transport == "streamable-http":
            await mcp.run_streamable_http_async()
        else:
            raise ValueError(f"Unknown transport: {transport}")


def _is_error_result(result: Any) -> bool:
    """Return the MCP ``isError`` flag for a routed tool result.

    Matches the TypeScript server: a failed CommandResult or BatchResult, or a
    pipeline with a failed step, is an error.
    """
    if isinstance(result, (CommandResult, BatchResult)):
        return not result.success
    if isinstance(result, PipelineResult):
        return any(step.status == StepStatus.FAILURE for step in result.steps)
    if isinstance(result, dict) and isinstance(result.get("success"), bool):
        return not result["success"]
    return False


def _tool_call_result(result: Any) -> Any:
    """Wrap a routed result in an MCP CallToolResult in the AFD wire format."""
    from mcp.types import CallToolResult, TextContent

    return CallToolResult(
        content=[TextContent(type="text", text=json.dumps(to_wire(result)))],
        isError=_is_error_result(result),
    )


def _describe_validation_error(exc: PydanticValidationError) -> List[Dict[str, Any]]:
    """Field paths and messages of a pydantic error, without input values."""
    return [
        {
            "path": ".".join(str(part) for part in issue.get("loc", ())) or "(root)",
            "message": issue.get("msg", "Invalid value"),
            "code": issue.get("type", "validation_error"),
        }
        for issue in exc.errors()
    ]


def _invalid_batch(problem: Any) -> BatchResult:
    """A failed BatchResult for a request whose envelope is invalid."""
    return create_failed_batch_result(
        CommandError(
            code="INVALID_BATCH_REQUEST",
            message="Invalid batch request",
            suggestion=(
                "Provide { commands: [{ command, input }], options: { stopOnError, "
                "timeout (or timeoutMs), parallelism } }"
            ),
            retryable=False,
            details={"errors": problem if isinstance(problem, list) else [{"message": problem}]},
        )
    )


def create_server(
    name: str,
    version: str = "1.0.0",
    description: Optional[str] = None,
    middleware: Optional[List[CommandMiddleware]] = None,
    *,
    tool_strategy: ToolStrategy = "individual",
    contexts: Optional[List[ContextConfig]] = None,
    group_by: Optional[GroupByFn] = None,
    dev_mode: bool = False,
) -> MCPServer:
    """Create a new AFD MCP server.

    Args:
        dev_mode: Development mode. When False (the default), a command that
            raises returns the generic message "An internal error occurred"
            instead of the exception text. The exception and its traceback are
            logged to the ``afd.server`` logger either way. Mirrors the
            TypeScript server's ``devMode`` option.
    """

    normalized_contexts = [
        item
        if isinstance(item, ContextConfig)
        else ContextConfig(**item)
        if isinstance(item, dict)
        else ContextConfig(
            name=getattr(item, "name"),
            description=getattr(item, "description", None),
            triggers=list(getattr(item, "triggers", []) or []),
            priority=getattr(item, "priority", None),
        )
        for item in (contexts or [])
    ]

    config = ServerConfig(
        name=name,
        version=version,
        description=description,
        middleware=middleware or [],
        tool_strategy=tool_strategy,
        contexts=normalized_contexts,
        group_by=group_by,
        dev_mode=dev_mode,
    )
    return MCPServer(config)
