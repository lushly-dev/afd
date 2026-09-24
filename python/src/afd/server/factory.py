"""Server factory for creating AFD MCP servers."""

from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import (
    Any,
    Callable,
    Dict,
    FrozenSet,
    List,
    Optional,
    Protocol,
    Tuple,
    Type,
    TypeVar,
    runtime_checkable,
)

from pydantic import BaseModel, ConfigDict, create_model
from pydantic import ValidationError as PydanticValidationError

from afd.core.batch import (
    BatchCommand,
    BatchCommandResult,
    BatchOptions,
    BatchRequest,
    BatchResult,
    BatchTiming,
    create_batch_result,
    create_failed_batch_result,
)
from afd.core.commands import (
    DEFAULT_EXPOSE,
    CommandContext,
    CommandDefinition,
    CommandExample,
    CommandRegistry,
    ExposeOptions,
    create_command_registry,
)
from afd.core.errors import CommandError
from afd.core.pipeline import (
    PipelineRequest,
    PipelineResult,
    StepStatus,
    create_pipeline_failure,
    execute_pipeline,
)
from afd.core.result import CommandResult, ResultMetadata, coerce_command_result, error
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
from afd.server.tool_router import ToolRouterDeps, create_tool_router, new_trace_id
from afd.server.tools import get_tools_list
from afd.server.types import ContextConfig, GroupByFn, ToolStrategy

TInput = TypeVar("TInput", bound=BaseModel)
TOutput = TypeVar("TOutput")

# Never log to stdout: the stdio transport uses it for JSON-RPC.
logger = logging.getLogger("afd.server")

META_TOOL_NAMES: FrozenSet[str] = frozenset(
    {"afd-call", "afd-batch", "afd-pipe", "afd-discover", "afd-detail"}
)
"""Tools the router handles itself. They are not commands: a command cannot use
these names, and batch items and pipeline steps cannot call them."""

_CONTEXT_COMMAND_NAMES = frozenset({"afd-context-enter", "afd-context-exit"})

DEFAULT_MAX_BATCH_SIZE = 500
"""Default maximum number of commands in one ``afd-batch`` request."""

DEFAULT_MAX_BATCH_PARALLELISM = 16
"""Default maximum ``options.parallelism`` of one ``afd-batch`` request."""


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
    max_batch_size: int = DEFAULT_MAX_BATCH_SIZE
    max_batch_parallelism: int = DEFAULT_MAX_BATCH_PARALLELISM


class MCPServer:
    """AFD MCP server for exposing commands and built-in tools."""

    def __init__(self, config: ServerConfig):
        if config.max_batch_size < 1 or config.max_batch_parallelism < 1:
            raise ValueError("max_batch_size and max_batch_parallelism must be at least 1")
        self.config = config
        self._registry = create_command_registry()
        self._commands: Dict[str, Callable] = {}
        self._metadata: Dict[str, CommandMetadata] = {}
        self._mcp_server = None
        self._middleware: List[CommandMiddleware] = list(config.middleware)
        self._context_state: ContextState = create_context_state()
        self._bootstrap_commands: Optional[List[CommandDefinition]] = None
        # Per-call caches, rebuilt after register() or a context change.
        self._command_index: Optional[Dict[str, CommandDefinition]] = None
        self._router: Optional[Callable[[str, Any], Any]] = None

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
        """Register an already-decorated command function.

        Raises:
            ValueError: If the function is not decorated, or its name is one of
                the router's built-in tools (``afd-call``, ``afd-batch``,
                ``afd-pipe``, ``afd-discover``, ``afd-detail``), which would
                make the command unreachable.
        """

        if not has_command_metadata(func):
            raise ValueError(f"Function {func.__name__} is not decorated with @define_command")

        definition = command_to_definition(func)
        metadata = get_command_metadata(func)
        if definition is None or metadata is None:
            raise ValueError(f"Function {func.__name__} is missing command metadata")
        if definition.name in META_TOOL_NAMES:
            raise ValueError(
                f"Command name '{definition.name}' is reserved: the tool router handles "
                f"'{definition.name}' itself, so the command would be unreachable. "
                "Rename the command."
            )

        self._registry.register(definition)
        self._commands[definition.name] = func
        self._metadata[definition.name] = metadata
        self._invalidate_caches()
        self._sync_mcp_tool_definitions()

    def _invalidate_caches(self) -> None:
        self._command_index = None
        self._router = None

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

    def _get_command_index(self) -> Dict[str, CommandDefinition]:
        """Name -> definition for registered and bootstrap commands (cached)."""
        if self._command_index is None:
            index = {command.name: command for command in self._get_bootstrap_commands()}
            # A registered command shadows a bootstrap command of the same name.
            index.update({command.name: command for command in self._registry.list()})
            self._command_index = index
        return self._command_index

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
            active_context = self._context_state.get_active()
            commands = [
                command for command in commands if _in_context(command, active_context)
            ]
        return commands

    def _find_command(
        self,
        name: str,
        *,
        include_bootstrap: bool = True,
        context_filtered: bool = False,
    ) -> Optional[CommandDefinition]:
        command = (
            self._get_command_index().get(name)
            if include_bootstrap
            else self._registry.get(name)
        )
        if command is None:
            return None
        if context_filtered and not _in_context(command, self._context_state.get_active()):
            return None
        return command

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

        start = time.perf_counter()
        try:
            result = await command.handler(input, context)
        except Exception as exc:
            return self._internal_error(command.name, exc)
        if isinstance(result, CommandResult):
            # Server metadata, as in TypeScript: executionTimeMs, commandVersion, traceId.
            result = _with_execution_metadata(
                result,
                execution_time_ms=(time.perf_counter() - start) * 1000,
                command_version=command.version,
                trace_id=context.trace_id,
            )
        return result

    def _internal_error(self, command_name: str, exc: BaseException) -> CommandResult:
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

    def _as_command_result(self, command_name: str, result: Any) -> CommandResult:
        """Coerce a batch item or pipeline step result (see coerce_command_result)."""
        if isinstance(result, CommandResult):
            return result
        logger.warning(
            "Command '%s' returned %s instead of a CommandResult",
            command_name,
            type(result).__name__,
        )
        return coerce_command_result(result, command_name)

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
                f"Command '{name[:128]}' not found",
                suggestion="Use afd-help or afd-discover to inspect available commands.",
            )
        return await self._invoke_command(command, input, context)

    async def _execute_command(
        self,
        name: str,
        input: Any,
        context: Optional[CommandContext] = None,
    ) -> Any:
        """Run a command (never a built-in tool) through the middleware chain.

        An exception from a handler or a middleware becomes a sanitized
        COMMAND_EXECUTION_ERROR result (see ``_internal_error``), as in the
        TypeScript server, so it never reaches the transport with its text.
        """
        context = context or CommandContext()

        async def run_handler() -> CommandResult:
            return await self._execute_command_direct(name, input, context)

        next_fn: Callable[[], Any] = run_handler
        for middleware in reversed(self._middleware):
            next_fn = (lambda mw, nxt: (lambda: mw(name, input, context, nxt)))(middleware, next_fn)

        try:
            result = await next_fn()
        except Exception as exc:
            result = self._internal_error(name, exc)
        self._refresh_dynamic_tools(name, result)
        return result

    async def execute(
        self,
        name: str,
        input: Any,
        context: Optional[CommandContext] = None,
    ) -> Any:
        """Execute a command or built-in tool by name."""

        if name in META_TOOL_NAMES:
            return await self.route_tool_call(name, input)
        return await self._execute_command(name, input, context)

    def _refresh_dynamic_tools(self, name: str, result: Any) -> None:
        """Refresh caches and live MCP tools after context-changing commands."""

        if (
            name in _CONTEXT_COMMAND_NAMES
            and isinstance(result, CommandResult)
            and result.success
        ):
            self._router = None
            if self._mcp_server is not None:
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

    # ── Batch ──────────────────────────────────────────────────────────────

    def _batch_problems(self, request: BatchRequest) -> List[Dict[str, Any]]:
        """Envelope problems that reject a whole batch before any command runs."""
        problems: List[Dict[str, Any]] = []
        count = len(request.commands)
        if count == 0:
            problems.append(
                {"path": "commands", "message": "A batch needs at least one command", "code": "too_short"}
            )
        elif count > self.config.max_batch_size:
            problems.append(
                {
                    "path": "commands",
                    "message": (
                        f"A batch accepts at most {self.config.max_batch_size} commands "
                        f"(got {count})"
                    ),
                    "code": "too_long",
                }
            )
        parallelism = request.options.parallelism if request.options else 1
        if parallelism > self.config.max_batch_parallelism:
            problems.append(
                {
                    "path": "options.parallelism",
                    "message": (
                        f"parallelism must be at most {self.config.max_batch_parallelism} "
                        f"(got {parallelism})"
                    ),
                    "code": "less_than_equal",
                }
            )
        for index, item in enumerate(request.commands):
            if item.command in META_TOOL_NAMES:
                problems.append(
                    {
                        "path": f"commands.{index}.command",
                        "message": (
                            f"'{item.command}' is a built-in tool, not a command, "
                            "and cannot run inside a batch"
                        ),
                        "code": "reserved_tool",
                    }
                )
        return problems

    async def _execute_batch(
        self,
        request: BatchRequest | dict[str, Any],
        context: Optional[CommandContext] = None,
    ) -> BatchResult:
        """Run a batch with partial-success semantics.

        Nothing keeps running after the result is returned: when the batch
        stops (``stopOnError`` failure or the ``timeout`` deadline) or is
        itself cancelled, commands still in flight are cancelled and awaited.
        Every item is coerced to a CommandResult, so aggregation never raises
        after commands have run.
        """
        start_time = time.perf_counter()
        started_at = datetime.now(timezone.utc).isoformat()
        context = context or CommandContext()
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

        problems = self._batch_problems(request)
        if problems:
            return _invalid_batch(
                problems,
                suggestion=(
                    f"Send 1 to {self.config.max_batch_size} commands with parallelism at most "
                    f"{self.config.max_batch_parallelism}. Batch only commands: call afd-batch, "
                    "afd-pipe, afd-call, afd-discover and afd-detail as separate tool calls."
                ),
            )

        options = request.options or BatchOptions()
        commands = request.commands
        total = len(commands)
        parallelism = min(options.parallelism, total)
        deadline = None if options.timeout is None else start_time + options.timeout / 1000
        batch_trace_id = context.trace_id or new_trace_id("batch")
        results: List[Optional[BatchCommandResult]] = [None] * total
        in_flight: Dict["asyncio.Task[CommandResult]", Tuple[int, float]] = {}
        next_index = 0
        stopped = False
        timed_out = False
        timeout_error = CommandError(
            code="BATCH_TIMEOUT",
            message=f"Batch timeout exceeded ({options.timeout}ms)",
            suggestion="Increase timeout or reduce the number of commands",
            retryable=True,
        )
        cancelled_error = CommandError(
            code="COMMAND_CANCELLED",
            message="Command cancelled because the batch stopped after a failure",
            suggestion=(
                "It may have partially run: check its effects, then retry it on its own "
                "or disable stopOnError"
            ),
        )

        def record(index: int, result: CommandResult, started: float) -> None:
            item = commands[index]
            results[index] = BatchCommandResult(
                id=item.id or f"cmd-{index}",
                index=index,
                command=item.command,
                result=result,
                duration_ms=(time.perf_counter() - started) * 1000,
            )

        try:
            while True:
                while (
                    not stopped
                    and not timed_out
                    and next_index < total
                    and len(in_flight) < parallelism
                ):
                    if deadline is not None and time.perf_counter() >= deadline:
                        timed_out = True
                        break
                    index = next_index
                    next_index += 1
                    item_context = CommandContext(
                        trace_id=f"{batch_trace_id}-{index}",
                        timeout=context.timeout,
                        extra=dict(context.extra),
                    )
                    task = asyncio.ensure_future(
                        self._run_batch_item(commands[index], item_context)
                    )
                    in_flight[task] = (index, time.perf_counter())
                if not in_flight or stopped or timed_out:
                    break
                wait_s = None if deadline is None else max(0.0, deadline - time.perf_counter())
                done, _ = await asyncio.wait(
                    in_flight, timeout=wait_s, return_when=asyncio.FIRST_COMPLETED
                )
                if not done:
                    timed_out = True
                    break
                for task in done:
                    index, started = in_flight.pop(task)
                    result = task.result()
                    record(index, result, started)
                    if options.stop_on_error and not result.success:
                        stopped = True

            # The batch has stopped: cancel what is still running and wait for
            # it, so that no command keeps running after the result is sent.
            if in_flight:
                pending = dict(in_flight)
                in_flight.clear()
                await _cancel_and_wait(pending)
                for task, (index, started) in pending.items():
                    if not task.cancelled() and task.exception() is None:
                        record(index, task.result(), started)  # finished first
                    else:
                        failed = timeout_error if timed_out else cancelled_error
                        record(index, CommandResult(success=False, error=failed), started)
        finally:
            # Reached with tasks in flight only when the batch itself is
            # cancelled (for example, the client went away).
            if in_flight:
                await _cancel_and_wait(in_flight)

        final: List[BatchCommandResult] = []
        for index, item_result in enumerate(results):
            if item_result is None:
                item = commands[index]
                skipped = timeout_error if timed_out else CommandError(
                    code="COMMAND_SKIPPED",
                    message="Command skipped because batch execution stopped after a failure",
                    suggestion="Disable stopOnError to execute every command",
                )
                item_result = BatchCommandResult(
                    id=item.id or f"cmd-{index}",
                    index=index,
                    command=item.command,
                    result=CommandResult(success=False, error=skipped),
                    duration_ms=0,
                )
            final.append(item_result)

        total_ms = (time.perf_counter() - start_time) * 1000
        timing = BatchTiming(
            total_ms=total_ms,
            average_ms=total_ms / len(final),
            started_at=started_at,
            completed_at=datetime.now(timezone.utc).isoformat(),
        )
        return create_batch_result(final, timing, metadata=ResultMetadata(trace_id=batch_trace_id))

    async def _run_batch_item(
        self, item: BatchCommand, context: CommandContext
    ) -> CommandResult:
        """Run one batch command. Never raises, except when cancelled."""
        try:
            result = await self._execute_command(item.command, item.input, context)
        except Exception as exc:
            result = self._internal_error(item.command, exc)
        return self._as_command_result(item.command, result)

    # ── Pipeline ───────────────────────────────────────────────────────────

    async def _execute_pipeline(
        self,
        request: PipelineRequest | dict[str, Any],
        context: Optional[CommandContext] = None,
    ) -> PipelineResult[Any]:
        if not isinstance(request, PipelineRequest):
            # Options accept camelCase (continueOnFailure, timeoutMs) and snake_case.
            # Conditions are validated here too, so a malformed `when` rejects
            # the whole pipeline before any step runs.
            try:
                request = PipelineRequest.model_validate(request)
            except PydanticValidationError as exc:
                return create_pipeline_failure(
                    CommandError(
                        code="INVALID_PIPELINE_REQUEST",
                        message="Invalid pipeline request envelope",
                        suggestion=(
                            "Provide steps with nonempty command names, object inputs, "
                            "valid conditions, and correctly typed options"
                        ),
                        retryable=False,
                        details={"errors": _describe_validation_error(exc)},
                    )
                )

        reserved = [
            {
                "path": f"steps.{index}.command",
                "message": (
                    f"'{step.command}' is a built-in tool, not a command, "
                    "and cannot run as a pipeline step"
                ),
                "code": "reserved_tool",
            }
            for index, step in enumerate(request.steps)
            if step.command in META_TOOL_NAMES
        ]
        if reserved:
            return create_pipeline_failure(
                CommandError(
                    code="INVALID_PIPELINE_REQUEST",
                    message="Pipeline steps cannot call built-in tools",
                    suggestion=(
                        "Use command names in steps. Call afd-batch, afd-pipe, afd-call, "
                        "afd-discover and afd-detail as separate tool calls."
                    ),
                    retryable=False,
                    details={"errors": reserved},
                )
            )

        step_context = context or CommandContext()

        async def executor(command_name: str, payload: Dict[str, Any]) -> CommandResult:
            try:
                result = await self._execute_command(command_name, payload, step_context)
            except Exception as exc:
                result = self._internal_error(command_name, exc)
            return self._as_command_result(command_name, result)

        return await execute_pipeline(request, executor)

    # ── Tool routing ───────────────────────────────────────────────────────

    def _get_router(self) -> Callable[[str, Any], Any]:
        """The tool router, built once and rebuilt after register() or a context change."""
        if self._router is None:
            commands = self.list_exposed_commands(
                interface="mcp", include_bootstrap=True, context_filtered=False
            )
            self._router = create_tool_router(
                ToolRouterDeps(
                    execute_command=self._execute_command,
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
        return self._router

    def _create_router(self) -> Callable[[str, Any], Any]:
        """Compatibility alias for :meth:`_get_router`."""
        return self._get_router()

    async def route_tool_call(self, tool_name: str, args: Any = None) -> Any:
        """Route a tool call through the shared tool router."""

        return await self._get_router()(tool_name, args or {})

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


def _in_context(command: CommandDefinition, active_context: Optional[str]) -> bool:
    """Whether a command is visible in the active context (universal commands always are)."""
    return not active_context or not command.contexts or active_context in command.contexts


def _with_execution_metadata(
    result: CommandResult,
    *,
    execution_time_ms: float,
    command_version: Optional[str],
    trace_id: Optional[str],
) -> CommandResult:
    """A copy of ``result`` whose metadata carries the server's execution fields.

    The handler's own result object is never mutated (it may be shared).
    """
    updates: Dict[str, Any] = {"execution_time_ms": round(execution_time_ms, 2)}
    if command_version:
        updates["command_version"] = command_version
    if trace_id:
        updates["trace_id"] = trace_id
    metadata = (
        result.metadata.model_copy(update=updates)
        if result.metadata is not None
        else ResultMetadata(**updates)
    )
    return result.model_copy(update={"metadata": metadata})


async def _cancel_and_wait(tasks: Dict["asyncio.Task[Any]", Any]) -> None:
    """Cancel tasks and wait until every one of them has finished."""
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)


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


def _invalid_batch(problem: Any, *, suggestion: Optional[str] = None) -> BatchResult:
    """A failed BatchResult for a request whose envelope is invalid."""
    return create_failed_batch_result(
        CommandError(
            code="INVALID_BATCH_REQUEST",
            message="Invalid batch request",
            suggestion=suggestion
            or (
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
    max_batch_size: int = DEFAULT_MAX_BATCH_SIZE,
    max_batch_parallelism: int = DEFAULT_MAX_BATCH_PARALLELISM,
) -> MCPServer:
    """Create a new AFD MCP server.

    Args:
        dev_mode: Development mode. When False (the default), a command that
            raises returns the generic message "An internal error occurred"
            instead of the exception text. The exception and its traceback are
            logged to the ``afd.server`` logger either way. Mirrors the
            TypeScript server's ``devMode`` option.
        max_batch_size: Most commands one ``afd-batch`` request may hold
            (default 500). A larger batch returns ``INVALID_BATCH_REQUEST``
            without running anything.
        max_batch_parallelism: Highest ``options.parallelism`` an ``afd-batch``
            request may ask for (default 16). A higher value returns
            ``INVALID_BATCH_REQUEST``.
    """

    normalized_contexts = [
        item
        if isinstance(item, ContextConfig)
        else ContextConfig(**item)
        if isinstance(item, dict)
        else ContextConfig(
            name=item.name,
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
        max_batch_size=max_batch_size,
        max_batch_parallelism=max_batch_parallelism,
    )
    return MCPServer(config)
