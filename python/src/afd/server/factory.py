"""Server factory for creating AFD MCP servers."""

from __future__ import annotations

import asyncio
import copy
import json
import logging
import time
from collections.abc import Callable, Iterator, Mapping, Sequence
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import (
    Any,
    Protocol,
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
from afd.core.actor import Actor, ContextDefaults, actor_kind_of, with_context_defaults
from afd.core.approval import ApprovalPolicy
from afd.core.clock import Clock, RandomSource, system_clock
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
from afd.core.result import (
    CommandResult,
    ResultMetadata,
    coerce_command_result,
    error,
    execution_failure,
)
from afd.core.schema_validation import SchemaValidationError
from afd.core.similarity import truncate_name
from afd.core.wire import WIRE_ENVELOPE, to_wire
from afd.server.bootstrap import ContextState, get_bootstrap_commands
from afd.server.bootstrap.afd_context import AFD_CONTEXT_META_KEY
from afd.server.decorators import (
    CommandMetadata,
    command_to_definition,
    define_command,
    get_command_metadata,
    has_command_metadata,
    validate_command_input,
)
from afd.core.builtin_names import AFD_META_TOOL_NAMES
from afd.server.context_fields import (
    AFD_CONTEXT_FIELDS_META_KEY,
    ContextField,
    apply_context_fields,
    bind_context_field_values,
    check_context_fields,
    context_field_values,
    describe_context_fields,
)
from afd.server.first_class import check_first_class_tools, normalize_first_class_tools
from afd.server.lazy_tools import not_found_suggestion
from afd.server.middleware import CommandMiddleware
from afd.server.confirmations import (
    AFD_CONFIRM_META_KEY,
    CONFIRM_INPUT_KEY,
    CONFIRM_REQUESTED_SCHEMA,
    CONFIRMATION_MODES,
    ConfirmationGate,
    bind_confirmation_channel,
)
from afd.server.session_context import (
    SessionContextState,
    UnknownContextError,
    is_modern_protocol,
)
from afd.server.tool_router import (
    NOT_IN_CONTEXT_SUGGESTION,
    ToolRouterDeps,
    create_tool_router,
    new_trace_id,
)
from afd.server.tools import get_tools_list
from afd.server.types import ContextConfig, GroupByFn, ToolStrategy
from afd.server.validation import _input_validation_failure

TInput = TypeVar("TInput", bound=BaseModel)
TOutput = TypeVar("TOutput")

# Never log to stdout: the stdio transport uses it for JSON-RPC.
logger = logging.getLogger("afd.server")

META_TOOL_NAMES: frozenset[str] = AFD_META_TOOL_NAMES
"""Tools the router handles itself (defined in ``afd.core.builtin_names``). They are not commands: a command cannot use
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
    description: str | None = None
    transport: str | None = "fastmcp"
    middleware: list[CommandMiddleware] = field(default_factory=list)
    tool_strategy: ToolStrategy = "individual"
    contexts: list[ContextConfig] = field(default_factory=list)
    group_by: GroupByFn | None = None
    dev_mode: bool = False
    max_batch_size: int = DEFAULT_MAX_BATCH_SIZE
    max_batch_parallelism: int = DEFAULT_MAX_BATCH_PARALLELISM
    instructions: str | None = None
    tools_list_ttl_ms: int | None = None
    clock: Clock | None = None
    random: RandomSource | None = None
    actor: Actor | None = None
    confirmations: str = "off"
    confirmation_key: bytes | str | None = None
    first_class_tools: list[str] | None = None
    """``tool_strategy="hybrid"`` only: the commands listed as tools after the meta-tools, in
    order (1 to 8 names). Checked against the registered commands before the first request."""
    context_fields: list[ContextField] = field(default_factory=list)
    """Request values the host declares (``spec/context-fields.md``), checked at construction.
    MCP ``tools/call`` reads them from ``params._meta``; ``server/discover`` and ``afd-help``
    list them."""


DEFAULT_TOOLS_LIST_TTL_MS = 300_000
"""Default ``ttlMs`` of MCP 2026-07-28 ``tools/list`` and ``server/discover`` results."""

# The SDK request context (``ServerRequestContext``) of the MCP request being handled,
# captured by middleware so tools/list and tools/call can bind its context state.
_CURRENT_REQUEST: ContextVar[Any] = ContextVar("afd_mcp_request", default=None)


def default_instructions(
    name: str, tool_strategy: str, contexts: list[ContextConfig]
) -> str:
    """The ``server/discover`` instructions: how an agent should use this server's tools."""
    lines = [
        f"{name} is an AFD server. Every tool returns a CommandResult as JSON text: "
        "{ success, data, error: { code, message, suggestion } }; follow error.suggestion "
        "to recover."
    ]
    if tool_strategy == "lazy":
        lines.append(
            "Call afd-discover to find commands, afd-detail for a command schema, and "
            "afd-call to run one."
        )
    elif tool_strategy == "grouped":
        lines.append(
            "Each tool groups related commands: pass { action, params }. afd-detail returns "
            "a command schema; afd-call runs any command by name."
        )
    elif tool_strategy == "hybrid":
        lines.append(
            "The command tools listed are the common ones. Call afd-discover to find others, "
            "afd-detail for a schema, and afd-call to run one."
        )
    else:
        lines.append("Each command is its own tool; afd-call also runs any command by name.")
    lines.append("Use afd-batch for several independent commands and afd-pipe to chain them.")
    if contexts:
        lines.append(
            "Commands are scoped by context (afd-context-list lists them). Send "
            f'_meta["{AFD_CONTEXT_META_KEY}"] with a context name on tools/list and '
            "tools/call to work in that context."
        )
    return " ".join(lines)


class MCPServer:
    """AFD MCP server for exposing commands and built-in tools."""

    def __init__(self, config: ServerConfig):
        if config.max_batch_size < 1 or config.max_batch_parallelism < 1:
            raise ValueError("max_batch_size and max_batch_parallelism must be at least 1")
        # The set's options are checked here; its entries once the commands are registered.
        first_class = normalize_first_class_tools(config.tool_strategy, config.first_class_tools)
        config.first_class_tools = first_class
        config.context_fields = check_context_fields(config.context_fields)
        self.config = config
        self._registry = create_command_registry()
        self._commands: dict[str, Callable] = {}
        self._metadata: dict[str, CommandMetadata] = {}
        self._mcp_server = None
        self._stateless_http = False
        self._middleware: list[CommandMiddleware] = list(config.middleware)
        self._context_state = SessionContextState()
        self._bootstrap_commands: list[CommandDefinition] | None = None
        # Per-call caches, rebuilt after register() or a context change.
        self._command_index: dict[str, CommandDefinition] | None = None
        self._router: Callable[[str, Any], Any] | None = None
        self._first_class_checked = False

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

    @property
    def context_fields(self) -> tuple[ContextField, ...]:
        """The declared context fields, so ``replay_journal`` can tell which recorded values
        still apply."""
        return tuple(self.config.context_fields)

    def list_contexts(self) -> list[ContextConfig]:
        return list(self.config.contexts)

    def command(
        self,
        name: str,
        description: str,
        category: str | None = None,
        input_schema: type[BaseModel] | dict[str, Any] | None = None,
        output_schema: type[BaseModel] | None = None,
        tags: list[str] | None = None,
        mutation: bool = False,
        examples: list[CommandExample | dict[str, Any]] | None = None,
        requires: list[str] | None = None,
        contexts: list[str] | None = None,
        expose: ExposeOptions | None = None,
        destructive: bool | None = None,
        confirm_prompt: str | None = None,
        undoable: bool | None = None,
        approval: ApprovalPolicy | None = None,
        version: str | None = None,
    ) -> Callable:
        """Decorator to register a command with this server (arguments as ``define_command``)."""

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
                destructive=destructive,
                confirm_prompt=confirm_prompt,
                undoable=undoable,
                approval=approval,
                version=version,
                # Point a name warning at the user's @server.command line.
                _stacklevel=3,
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

        first_class = self.config.first_class_tools or []
        if definition.name in first_class and not self._is_exposed_to(definition, "mcp"):
            # The first-class set cannot change while the server runs (H2).
            raise ValueError(
                f"Command '{definition.name}' is in first_class_tools, so it must stay exposed "
                "to MCP (expose.mcp true): listing it would reveal a private command."
            )

        self._registry.register(definition)
        self._commands[definition.name] = func
        self._metadata[definition.name] = metadata
        self._invalidate_caches()
        self._sync_mcp_tool_definitions()

    def _invalidate_caches(self) -> None:
        self._command_index = None
        self._router = None
        self._first_class_checked = False

    def _check_first_class_tools(self) -> None:
        """Check a hybrid server's first-class set against its commands (spec H2).

        Run before the server answers a request, and again after each registration.
        """
        if self._first_class_checked or self.config.tool_strategy != "hybrid":
            return
        check_first_class_tools(
            self.config.first_class_tools or [],
            self._get_command_index(),
            lambda command: self._is_exposed_to(command, "mcp"),
        )
        self._first_class_checked = True

    def _get_bootstrap_commands(self) -> list[CommandDefinition]:
        if self._bootstrap_commands is None:
            options: dict[str, Any] = {
                "get_json_schema": lambda command: command.input_schema or {},
            }
            options["tool_strategy"] = self.config.tool_strategy
            if self.config.tool_strategy == "hybrid":
                options["first_class_tools"] = list(self.config.first_class_tools or [])
            if self.config.context_fields:
                options["context_fields"] = list(self.config.context_fields)
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

    def _get_command_index(self) -> dict[str, CommandDefinition]:
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
    ) -> list[CommandDefinition]:
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
    ) -> CommandDefinition | None:
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

    def _is_exposed_to(self, command: CommandDefinition, interface: Any) -> bool:
        # An unknown interface exposes nothing, and is never looked up as an attribute.
        if interface not in ("palette", "mcp", "agent", "cli"):
            return False
        expose = command.expose if command.expose is not None else DEFAULT_EXPOSE
        return bool(getattr(expose, interface, False))

    def list_exposed_commands(
        self,
        *,
        interface: str = "mcp",
        include_bootstrap: bool = True,
        context_filtered: bool = False,
    ) -> list[CommandDefinition]:
        """List commands exposed on a specific interface."""

        return [
            command
            for command in self.list_commands(
                include_bootstrap=include_bootstrap,
                context_filtered=context_filtered,
            )
            if self._is_exposed_to(command, interface)
        ]

    def _prepare_command(
        self,
        name: str,
        input: Any,
        context: CommandContext,
    ) -> tuple[CommandDefinition, Any] | CommandResult:
        """Check a call before any middleware runs.

        Lookup (with a "did you mean" suggestion), exposure, active context and
        input validation, in the order of ``packages/server/src/execution.ts``.
        Returns the command and the validated input that the middleware chain
        and the handler receive, or the failure that rejects the call.
        """
        interface = context.extra.get("interface") if context.extra else None
        active_context = self._context_state.get_active()

        command = self._find_command(name)
        # A remote caller (the MCP router) gets the unknown-command answer for a
        # command hidden from it, so it cannot learn that the command exists
        # (spec/error-codes.md, D4). In-process callers get COMMAND_NOT_EXPOSED.
        remote = bool(context.extra.get("remote")) if context.extra else False
        if command is not None and remote and not self._is_exposed_to(command, interface):
            command = None
        if command is None:
            # Only names the caller could call: a few close matches, never the
            # whole list, and never a command hidden from this interface.
            callable_names = [
                candidate.name
                for candidate in self._get_command_index().values()
                if _in_context(candidate, active_context)
                and (not interface or self._is_exposed_to(candidate, interface))
            ]
            return error(
                "COMMAND_NOT_FOUND",
                f"Command '{truncate_name(name)}' not found",
                suggestion=not_found_suggestion(name, callable_names),
            )

        # An unknown interface exposes nothing, as in TypeScript's isExposedTo.
        if interface is not None and interface != "" and not self._is_exposed_to(command, interface):
            return error(
                "COMMAND_NOT_EXPOSED",
                f"Command '{command.name}' is not exposed to {interface}",
                suggestion=(
                    "Call it from an interface it is exposed to, or set "
                    f"expose.{interface} to true in its definition"
                ),
                retryable=False,
            )

        if not _in_context(command, active_context):
            return error(
                "COMMAND_NOT_IN_CONTEXT",
                f"Command '{command.name}' is not available in context '{active_context}'",
                suggestion=NOT_IN_CONTEXT_SUGGESTION,
            )

        metadata = get_command_metadata(command.handler)
        input_schema = metadata.input_schema if metadata is not None else command.input_schema
        try:
            data = validate_command_input(input_schema, input)
        except (PydanticValidationError, SchemaValidationError) as exc:
            return _input_validation_failure(input_schema, {} if input is None else input, exc)
        except Exception as exc:
            # A validator that raises something other than ValueError or
            # AssertionError: the input is still what failed, as in TypeScript.
            logger.error("Input validation for '%s' raised", command.name, exc_info=exc)
            return error(
                "VALIDATION_ERROR",
                "Input validation failed",
                suggestion=(
                    f"Input validation threw: {exc}"
                    if self.config.dev_mode
                    else f"Check the input against the input schema of '{command.name}' "
                    "(afd-detail returns it) and retry"
                ),
            )
        return command, data

    async def _run_handler(
        self,
        command: CommandDefinition,
        data: Any,
        context: CommandContext,
    ) -> Any:
        """Call the handler with validated input and stamp its result's metadata."""
        clock = getattr(context, "clock", None) or system_clock
        start = clock.now()
        handler = getattr(command.handler, "__afd_validated_handler__", command.handler)
        result = await handler(data, context)
        if isinstance(result, CommandResult):
            # Server metadata, as in TypeScript: executionTimeMs, commandVersion, traceId,
            # actorKind. Read the actor after the handler: middleware may have refined it.
            result = _with_execution_metadata(
                result,
                execution_time_ms=max(0, clock.now() - start),
                command_version=command.version,
                trace_id=context.trace_id,
                actor_kind=actor_kind_of(getattr(context, "actor", None)),
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
        return execution_failure(exc, self.config.dev_mode)

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

    async def _execute_command(
        self,
        name: str,
        input: Any,
        context: CommandContext | None = None,
    ) -> Any:
        """Run a command (never a built-in tool) in the reference order.

        As in ``packages/server/src/execution.ts``: lookup, exposure, active
        context and input validation run first (``_prepare_command``), so
        middleware only sees calls that reach a handler, and sees their
        validated input. The middleware chain then wraps the handler, whose
        result is stamped with execution metadata.

        An exception from a handler or a middleware passes back out through
        the middleware and becomes a sanitized COMMAND_EXECUTION_ERROR result
        (see ``_internal_error``), so it never reaches the transport with its
        text.
        """
        # One context object, with a clock and a random source, flows through every
        # middleware into the handler.
        context = with_context_defaults(
            context, ContextDefaults(clock=self.config.clock, random=self.config.random)
        )
        prepared = self._prepare_command(name, input, context)
        if isinstance(prepared, CommandResult):
            return prepared
        command, data = prepared

        # Declared context fields, validated in context.extra before any middleware runs.
        invalid_field = apply_context_fields(self.config.context_fields, context, command.name)
        if invalid_field is not None:
            return invalid_field

        async def run_handler() -> Any:
            return await self._run_handler(command, data, context)

        next_fn: Callable[[], Any] = run_handler
        for middleware in reversed(self._middleware):
            next_fn = (lambda mw, nxt: (lambda: mw(name, data, context, nxt)))(middleware, next_fn)

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
        context: CommandContext | None = None,
    ) -> Any:
        """Execute a command or built-in tool by name."""

        self._check_first_class_tools()
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
            # The shared FastMCP registry stays complete; tools/list filters per session.

    def _advertise_fixed_tools_list(self) -> None:
        """Report ``capabilities.tools.listChanged`` as false, as the spec says (H6).

        No AFD server sends ``notifications/tools/list_changed``, but the SDK derives the flag
        from the methods it serves (``subscriptions/listen`` on 2026-07-28), which would
        promise a notification that never comes.
        """
        lowlevel = getattr(self._mcp_server, "_lowlevel_server", None)
        get_capabilities = getattr(lowlevel, "get_capabilities", None)
        if get_capabilities is None or getattr(lowlevel, "_afd_fixed_tools_list", False):
            return

        def fixed(*args: Any, **kwargs: Any) -> Any:
            capabilities = get_capabilities(*args, **kwargs)
            if capabilities.tools is not None:
                capabilities.tools = capabilities.tools.model_copy(update={"list_changed": False})
            return capabilities

        lowlevel.get_capabilities = fixed
        lowlevel._afd_fixed_tools_list = True

    def _advertise_context_fields(self) -> None:
        """List the declared context fields in ``server/discover`` (``spec/context-fields.md``).

        The SDK answers ``server/discover`` with the low-level server's registered handler
        (by default ``Server._handle_discover``, derived from server state per request). This
        wraps that entry, through the SDK's own ``get_request_handler`` and
        ``add_request_handler``, and adds ``_meta["dev.afd/context-fields"]`` to its result.
        ``tests/test_context_fields_mcp.py`` fails if an SDK upgrade serves discover another way.
        """
        if not self.config.context_fields:
            return
        lowlevel = getattr(self._mcp_server, "_lowlevel_server", None)
        get_handler = getattr(lowlevel, "get_request_handler", None)
        entry = get_handler("server/discover") if get_handler is not None else None
        if entry is None or getattr(lowlevel, "_afd_context_fields_discover", False):
            return
        described = describe_context_fields(self.config.context_fields)
        discover = entry.handler

        async def discover_with_fields(ctx: Any, params: Any) -> Any:
            result = await discover(ctx, params)
            # A copy per answer, so a response never aliases the server's description.
            listed = {AFD_CONTEXT_FIELDS_META_KEY: copy.deepcopy(described)}
            if isinstance(result, BaseModel):
                meta = getattr(result, "meta", None)
                return result.model_copy(update={"meta": {**(meta or {}), **listed}})
            if isinstance(result, Mapping):
                meta = result.get("_meta")
                return {**result, "_meta": {**(meta if isinstance(meta, Mapping) else {}), **listed}}
            return result

        lowlevel.add_request_handler("server/discover", entry.params_type, discover_with_fields)
        lowlevel._afd_context_fields_discover = True

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
                    and server._is_exposed_to(registered, "mcp")
                    and visible is None
                    and registered.contexts
                    and active_context not in registered.contexts
                ):
                    return _tool_call_result(
                        error(
                            "COMMAND_NOT_IN_CONTEXT",
                            f"Command '{name}' is not available in context '{active_context}'",
                            suggestion=NOT_IN_CONTEXT_SUGGESTION,
                        )
                    )

                # FastMCP otherwise returns an unstructured ToolError. Route
                # through AFD so unknown and private names share the D4 result.
                return _tool_call_result(await server.route_tool_call(name, arguments))

            return await original_call_tool(
                name,
                arguments,
                context=context,
                convert_result=convert_result,
            )

        tool_manager.call_tool = wrapped_call_tool
        tool_manager._afd_context_error_translation = True

    # ── Batch ──────────────────────────────────────────────────────────────

    def _batch_problems(self, request: BatchRequest) -> list[dict[str, Any]]:
        """Envelope problems that reject a whole batch before any command runs."""
        problems: list[dict[str, Any]] = []
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
        request: Any,
        context: CommandContext | None = None,
    ) -> BatchResult:
        """Run a batch with partial-success semantics.

        Any request that is not a valid envelope (see ``WIRE_ENVELOPE``), is
        empty or exceeds the server's limits returns a failed BatchResult with
        ``INVALID_BATCH_REQUEST`` before any command runs, as TypeScript's
        ``executeBatch()`` does.

        A stopOnError failure prevents new starts; commands already in flight
        finish normally. A timeout or cancellation cancels and awaits them.
        Every item is coerced to a CommandResult, so aggregation never raises
        after commands have run.
        """
        start_time = time.perf_counter()
        started_at = datetime.now(timezone.utc).isoformat()
        context = context or CommandContext()
        if not isinstance(request, BatchRequest):
            payload = request
            options = request.get("options") if isinstance(request, dict) else None
            if isinstance(options, dict) and "timeoutMs" in options:
                if "timeout" in options:
                    return _invalid_batch("Specify only one of timeout or timeoutMs")
                options = dict(options)
                options["timeout"] = options.pop("timeoutMs")
                payload = {**request, "options": options}
            try:
                request = BatchRequest.model_validate(payload, context=WIRE_ENVELOPE)
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
        results: list[BatchCommandResult | None] = [None] * total
        in_flight: dict[asyncio.Task[CommandResult], tuple[int, float]] = {}
        next_index = 0
        stopped = False
        timed_out = False
        timeout_error = CommandError(
            code="BATCH_TIMEOUT",
            message=f"Batch timeout exceeded ({options.timeout}ms)",
            suggestion="Increase timeout or reduce the number of commands",
            retryable=True,
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
                        actor=context.actor,
                        clock=context.clock,
                        random=context.random,
                        approval=getattr(context, "approval", None),
                    )
                    task = asyncio.ensure_future(
                        self._run_batch_item(commands[index], item_context)
                    )
                    in_flight[task] = (index, time.perf_counter())
                if not in_flight or timed_out:
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
                        failed = timeout_error
                        record(index, CommandResult(success=False, error=failed), started)
        finally:
            # Reached with tasks in flight only when the batch itself is
            # cancelled (for example, the client went away).
            if in_flight:
                await _cancel_and_wait(in_flight)

        final: list[BatchCommandResult] = []
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
        request: Any,
        context: CommandContext | None = None,
    ) -> PipelineResult[Any]:
        """Run a pipeline of commands.

        An invalid envelope (see ``WIRE_ENVELOPE``) returns a PipelineResult
        whose one synthetic step (index -1, command "") carries
        ``INVALID_PIPELINE_REQUEST``, before any step runs, as in TypeScript.
        """
        if not isinstance(request, PipelineRequest):
            # Options accept camelCase (continueOnFailure, timeoutMs) and snake_case.
            # Conditions are validated here too, so a malformed `when` rejects
            # the whole pipeline before any step runs.
            try:
                request = PipelineRequest.model_validate(request, context=WIRE_ENVELOPE)
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

        async def executor(command_name: str, payload: dict[str, Any]) -> CommandResult:
            try:
                result = await self._execute_command(command_name, payload, step_context)
            except Exception as exc:
                result = self._internal_error(command_name, exc)
            return self._as_command_result(command_name, result)

        return await execute_pipeline(request, executor, dev_mode=self.config.dev_mode)

    # ── Tool routing ───────────────────────────────────────────────────────

    def _get_router(self) -> Callable[[str, Any], Any]:
        """The tool router, built once and rebuilt after register() or a context change."""
        self._check_first_class_tools()
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
                    actor=self.config.actor or Actor(kind="agent"),
                    confirmations=ConfirmationGate(self.config.confirmations, commands),
                )
            )
        return self._router

    def _create_router(self) -> Callable[[str, Any], Any]:
        """Compatibility alias for :meth:`_get_router`."""
        return self._get_router()

    async def route_tool_call(self, tool_name: str, args: Any = None) -> Any:
        """Route a tool call through the shared tool router."""

        return await self._get_router()(tool_name, {} if args is None else args)

    async def call_tool(self, tool_name: str, args: Any = None) -> Any:
        """Compatibility wrapper for invoking an MCP-visible tool directly."""

        return await self.route_tool_call(tool_name, {} if args is None else args)

    def get_tool_definitions(self) -> list[dict[str, Any]]:
        """Return the MCP-visible tool definitions for the current strategy."""

        self._check_first_class_tools()
        return get_tools_list(
            self.list_exposed_commands(interface="mcp", include_bootstrap=True, context_filtered=False),
            self.config.tool_strategy,
            group_by_fn=self.config.group_by,
            active_context=self._context_state.get_active(),
            confirmations=self.config.confirmations,
            first_class_tools=self.config.first_class_tools,
        )

    def get_mcp_tools(self) -> list[dict[str, Any]]:
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
        # Session context must never mutate the globally shared tool registry.
        definitions = get_tools_list(
            self.list_exposed_commands(interface="mcp", include_bootstrap=True),
            self.config.tool_strategy,
            group_by_fn=self.config.group_by,
            active_context=None,
            confirmations=self.config.confirmations,
            first_class_tools=self.config.first_class_tools,
        )
        for tool_definition in definitions:
            tool = self._create_fastmcp_tool(tool_definition)
            tool_manager._tools[tool.name] = tool

    def _build_input_model(self, tool_name: str, schema: dict[str, Any]) -> type[BaseModel]:
        """Build a FastMCP argument model that passes arguments through unchanged.

        The advertised ``inputSchema`` is the command's schema, but FastMCP does
        not validate against it: a missing or mistyped argument must reach the
        command, whose own validation returns a structured VALIDATION_ERROR
        result (as the TypeScript server does) instead of a raw FastMCP error.
        """
        from mcp.server.mcpserver.utilities.func_metadata import ArgModelBase

        class PassthroughArgs(ArgModelBase):
            model_config = ConfigDict(arbitrary_types_allowed=True, extra="allow")

            def model_dump_one_level(self) -> dict[str, Any]:
                return dict(self.model_extra or {})

        return create_model(
            f"{tool_name.replace('-', '_')}_Input",
            __base__=PassthroughArgs,
        )

    def _create_fastmcp_tool(self, tool_definition: dict[str, Any]):
        from mcp.server.mcpserver.tools import Tool
        from mcp.server.mcpserver.utilities.func_metadata import FuncMetadata

        input_schema = tool_definition.get("inputSchema", {"type": "object", "properties": {}})
        input_model = self._build_input_model(
            tool_definition["name"],
            input_schema,
        )

        tool_name = tool_definition["name"]

        async def handler(afd_ctx: Any = None, **payload: Any) -> Any:
            # The SDK request this call serves decides how it can be confirmed.
            channel = (
                _SdkConfirmationChannel(afd_ctx, self._stateless_http, _CURRENT_REQUEST.get())
                if afd_ctx is not None and self.config.confirmations != "off"
                else None
            )
            try:
                with bind_confirmation_channel(channel):
                    result = await self.route_tool_call(tool_name, payload)
                if _is_input_required(result):
                    return result
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
            context_kwarg="afd_ctx",
            meta=tool_definition.get("_meta"),
        )

    def _create_mcp_server(self):
        """Create the underlying MCP SDK server (``mcp.server.mcpserver.MCPServer``)."""

        try:
            from mcp.server import CacheHint
            from mcp.server.mcpserver import MCPServer as SdkMCPServer
            from mcp.server.request_state import RequestStateSecurity
        except ImportError as exc:  # pragma: no cover - optional dependency
            raise ImportError("mcp not installed. Install with: pip install afd[server]") from exc

        self._check_first_class_tools()
        server = self
        context_names = {item.name for item in self.config.contexts}
        ttl_ms = self.config.tools_list_ttl_ms
        if ttl_ms is None:
            # With contexts, tools/list varies by _meta["dev.afd/context"], which SDK
            # clients leave out of their cache key, so the default is "always stale". The
            # hybrid list never varies by context (H4), so it keeps the default.
            varies = bool(self.config.contexts) and self.config.tool_strategy != "hybrid"
            ttl_ms = 0 if varies else DEFAULT_TOOLS_LIST_TTL_MS
        if isinstance(ttl_ms, bool) or not isinstance(ttl_ms, int) or ttl_ms < 0:
            raise ValueError("tools_list_ttl_ms must be a non-negative integer")
        hint = CacheHint(ttl_ms=ttl_ms, scope="public")

        async def capture_request(ctx: Any, call_next: Any) -> Any:
            token = _CURRENT_REQUEST.set(ctx)
            try:
                return await call_next(ctx)
            finally:
                _CURRENT_REQUEST.reset(token)

        @contextmanager
        def bound_request() -> Iterator[None]:
            try:
                with server._context_state.bind(
                    _CURRENT_REQUEST.get(),
                    stateless=server._stateless_http,
                    contexts=context_names,
                ):
                    yield
            except UnknownContextError as exc:
                from mcp import MCPError
                from mcp.types import INVALID_PARAMS

                raise MCPError(
                    INVALID_PARAMS,
                    str(exc),
                    {"suggestion": f"Use one of: {', '.join(sorted(context_names))}"},
                ) from exc

        class SessionMCPServer(SdkMCPServer):
            async def list_tools(self):
                from mcp.types import Tool as MCPTool

                with bound_request():
                    return [MCPTool(**definition) for definition in server.get_tool_definitions()]

            async def call_tool(self, name, arguments, context=None):
                # Declared context fields come from this request's _meta, on both eras and
                # every transport; undeclared keys are dropped. The router puts them in
                # context.extra and the command's execution validates them.
                values = context_field_values(
                    server.config.context_fields, _request_meta(_CURRENT_REQUEST.get())
                )
                with bound_request(), bind_context_field_values(values):
                    return await super().call_tool(name, arguments, context)

        self._mcp_server = SessionMCPServer(
            self.config.name,
            description=self.config.description,
            instructions=self.config.instructions
            or default_instructions(
                self.config.name, self.config.tool_strategy, self.config.contexts
            ),
            version=self.config.version,
            cache_hints={"tools/list": hint, "server/discover": hint},
            middleware=[capture_request],
            **(
                {"request_state_security": RequestStateSecurity(keys=[self.config.confirmation_key])}
                if self.config.confirmation_key is not None
                else {}
            ),
        )
        self._sync_mcp_tool_definitions()
        self._install_fastmcp_context_error_translation()
        self._advertise_fixed_tools_list()
        self._advertise_context_fields()
        return self._mcp_server

    def streamable_http_app(self, **options: Any) -> Any:
        """The Streamable HTTP ASGI app, for mounting in a host application.

        ``options`` are those of the SDK's ``MCPServer.streamable_http_app``, such as
        ``stateless_http``, ``json_response``, ``transport_security`` and
        ``max_request_body_size``. One app serves MCP 2026-07-28 statelessly and 2025
        clients that send ``initialize``.
        """
        mcp = self._create_mcp_server()
        self._stateless_http = bool(options.get("stateless_http", False))
        return mcp.streamable_http_app(**options)

    def run(self, transport: str = "stdio", **options: Any) -> None:
        """Run the server.

        Args:
            transport: "stdio", "sse" or "streamable-http".
            options: Transport options passed to the SDK, such as ``host``, ``port``,
                ``stateless_http`` or ``transport_security`` for "streamable-http".
        """
        if transport not in {"stdio", "sse", "streamable-http"}:
            raise ValueError(f"Unknown transport: {transport}")
        mcp = self._create_mcp_server()
        self._stateless_http = transport == "streamable-http" and bool(
            options.get("stateless_http", False)
        )
        mcp.run(transport=transport, **options)

    async def run_async(self, transport: str = "stdio", **options: Any) -> None:
        """Run the server in the current event loop; see :meth:`run` for ``options``."""
        if transport not in {"stdio", "sse", "streamable-http"}:
            raise ValueError(f"Unknown transport: {transport}")
        mcp = self._create_mcp_server()
        self._stateless_http = transport == "streamable-http" and bool(
            options.get("stateless_http", False)
        )
        if transport == "stdio":
            await mcp.run_stdio_async(**options)
        elif transport == "sse":
            await mcp.run_sse_async(**options)
        else:
            await mcp.run_streamable_http_async(**options)


def _request_meta(request: Any) -> Any:
    """The raw ``_meta`` of an SDK request (``ServerRequestContext.params``), or ``None``."""
    params = getattr(request, "params", None)
    return params.get("_meta") if isinstance(params, Mapping) else None


def _in_context(command: CommandDefinition, active_context: str | None) -> bool:
    """Whether a command is visible in the active context (universal commands always are)."""
    return not active_context or not command.contexts or active_context in command.contexts


def _with_execution_metadata(
    result: CommandResult,
    *,
    execution_time_ms: float,
    command_version: str | None,
    trace_id: str | None,
    actor_kind: str | None = None,
) -> CommandResult:
    """A copy of ``result`` whose metadata carries the server's execution fields.

    The handler's own result object is never mutated (it may be shared).
    """
    updates: dict[str, Any] = {"execution_time_ms": round(execution_time_ms, 2)}
    if command_version:
        updates["command_version"] = command_version
    if trace_id:
        updates["trace_id"] = trace_id
    if actor_kind:
        updates["actor_kind"] = actor_kind
    metadata = (
        result.metadata.model_copy(update=updates)
        if result.metadata is not None
        else ResultMetadata(**updates)
    )
    return result.model_copy(update={"metadata": metadata})


async def _cancel_and_wait(tasks: dict[asyncio.Task[Any], Any]) -> None:
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


def _is_input_required(result: Any) -> bool:
    return type(result).__name__ == "InputRequiredResult"


class _SdkConfirmationChannel:
    """What one SDK ``tools/call`` can carry for confirmations (``afd.server.confirmations``).

    A 2026-07-28 request elicits through ``input_required`` when it declares form
    elicitation; the SDK seals the ``requestState`` and binds it to the request. A 2025
    request elicits with a server-sent request when its connection has a back channel
    (stdio, stateful HTTP), never over stateless HTTP.
    """

    def __init__(self, ctx: Any, stateless_http: bool, request: Any) -> None:
        self._ctx = ctx
        self._modern = is_modern_protocol(getattr(ctx, "protocol_version", None))
        capabilities = getattr(ctx, "client_capabilities", None)
        elicitation = getattr(capabilities, "elicitation", None) if capabilities else None
        form = elicitation is not None and (
            getattr(elicitation, "form", None) is not None or getattr(elicitation, "url", None) is None
        )
        self.can_elicit = form and (self._modern or not stateless_http)
        params = getattr(request, "params", None)
        meta = params.get("_meta") if isinstance(params, dict) else None
        self.acknowledged = isinstance(meta, dict) and meta.get(AFD_CONFIRM_META_KEY) is True

    @staticmethod
    def _answer(action: Any, content: Any) -> str:
        confirmed = isinstance(content, dict) and content.get("confirm") is True
        return "accept" if action == "accept" and confirmed else "decline"

    async def response(self, binding: str) -> str:
        if not self._modern:
            return "missing"
        answer = (self._ctx.input_responses or {}).get(CONFIRM_INPUT_KEY)
        if answer is None or not hasattr(answer, "action"):
            return "missing"
        if self._ctx.request_state != binding:
            return "missing"
        return self._answer(answer.action, getattr(answer, "content", None))

    async def ask(self, message: str, binding: str) -> Any:
        if self._modern:
            from mcp_types import ElicitRequest, ElicitRequestFormParams, InputRequiredResult

            return InputRequiredResult(
                input_requests={
                    CONFIRM_INPUT_KEY: ElicitRequest(
                        params=ElicitRequestFormParams(
                            message=message, requested_schema=CONFIRM_REQUESTED_SCHEMA
                        )
                    )
                },
                request_state=binding,
            )
        result = await self._ctx.session.elicit_form(
            message, CONFIRM_REQUESTED_SCHEMA, related_request_id=self._ctx.request_id
        )
        return self._answer(result.action, result.content)


def _tool_call_result(result: Any) -> Any:
    """Wrap a routed result in an MCP CallToolResult in the AFD wire format."""
    from mcp.types import CallToolResult, TextContent

    return CallToolResult(
        content=[TextContent(type="text", text=json.dumps(to_wire(result)))],
        isError=_is_error_result(result),
    )


def _describe_validation_error(exc: PydanticValidationError) -> list[dict[str, Any]]:
    """Field paths and messages of a pydantic error, without input values."""
    return [
        {
            "path": ".".join(str(part) for part in issue.get("loc", ())) or "(root)",
            "message": issue.get("msg", "Invalid value"),
            "code": issue.get("type", "validation_error"),
        }
        for issue in exc.errors()
    ]


def _invalid_batch(problem: Any, *, suggestion: str | None = None) -> BatchResult:
    """A failed BatchResult for a request whose envelope is invalid."""
    return create_failed_batch_result(
        CommandError(
            code="INVALID_BATCH_REQUEST",
            message="Invalid batch request envelope",
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
    description: str | None = None,
    middleware: list[CommandMiddleware] | None = None,
    *,
    tool_strategy: ToolStrategy = "individual",
    contexts: list[ContextConfig] | None = None,
    group_by: GroupByFn | None = None,
    dev_mode: bool = False,
    max_batch_size: int = DEFAULT_MAX_BATCH_SIZE,
    max_batch_parallelism: int = DEFAULT_MAX_BATCH_PARALLELISM,
    instructions: str | None = None,
    tools_list_ttl_ms: int | None = None,
    clock: Clock | None = None,
    random: RandomSource | None = None,
    actor: Actor | None = None,
    confirmations: str = "off",
    confirmation_key: bytes | str | None = None,
    first_class_tools: Sequence[str] | None = None,
    context_fields: Sequence[ContextField | dict[str, Any]] | None = None,
) -> MCPServer:
    """Create a new AFD MCP server.

    Args:
        context_fields: Request values the host declares (``spec/context-fields.md``): each
            one's name, ``_meta`` key, schema (a Pydantic model or any type
            ``pydantic.TypeAdapter`` accepts), and whether the journal keeps it
            (``journal=True``) or a call needs it (``required=True``). A call carries a
            field's value in ``context.extra[name]``: in process on the call's context, and
            over MCP from ``tools/call``'s ``params._meta[meta]`` (both eras, every transport;
            undeclared ``_meta`` keys are dropped, and HTTP headers are never read). It is
            validated before middleware runs and replaced with the schema's output, and an
            invalid or missing required value fails the call with ``VALIDATION_ERROR``
            (``required`` is not enforced for AFD's own ``afd-*`` commands, so a client can
            discover the fields first). ``server/discover`` lists the fields under
            ``_meta["dev.afd/context-fields"]`` and ``afd-help`` as ``contextFields``; neither
            ``tools/list`` nor its cache hint varies by a field. A bad declaration (an empty,
            reserved or repeated name, a ``meta`` key without a reverse-DNS prefix, with a
            reserved one or repeated) raises ``ValueError`` naming the field; a schema pydantic
            cannot use raises ``TypeError``.
        tool_strategy: How commands become MCP tools: ``"individual"`` (the default), ``"grouped"``,
            ``"lazy"`` or ``"hybrid"`` (``spec/tool-strategies.md``).
        first_class_tools: With ``tool_strategy="hybrid"`` (required there, and refused with any
            other strategy), the commands to list as tools after the five meta-tools and the
            context tools, in order: 1 to 8 registered commands exposed to MCP, none a built-in
            tool, none repeated. Every other command is reached with ``afd-discover``,
            ``afd-detail`` and ``afd-call``. The list does not vary by context, so
            ``tools_list_ttl_ms`` defaults to 300000 even with ``contexts``. The set is checked
            against the registered commands before the first request, so ``@server.command``
            may follow ``create_server``.
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
        instructions: Agent guidance returned by MCP ``server/discover``. Defaults to
            a description of the tool strategy, the meta-tools and the contexts.
        tools_list_ttl_ms: ``ttlMs`` freshness hint of MCP 2026-07-28 ``tools/list``
            and ``server/discover`` results (default 300000, or 0 when ``contexts``
            are configured, because clients cache ``tools/list`` without its
            ``_meta``; the hybrid strategy's list does not vary, so it keeps 300000).
        clock: Clock given to handlers as ``context.clock`` when the context has
            none. Default: ``system_clock``. Pass ``fixed_clock()`` in tests.
        random: Random source given to handlers as ``context.random`` when the
            context has none. Default: ``system_random``.
        actor: Actor for commands called over MCP when the context has none.
            Default: ``Actor(kind="agent")``. Direct ``server.execute()`` calls
            get no default actor.
        confirmations: Enforce ``confirm_prompt`` on MCP calls
            (``spec/command-metadata.md``, "Confirmations"): ``"off"`` (the default),
            ``"enforce"`` (an accepted elicitation, or an acknowledgement:
            ``confirm: true`` or ``_meta["dev.afd/confirm"]``) or ``"require-human"``
            (an accepted elicitation only). Otherwise the call fails with
            ``CONFIRMATION_REQUIRED`` or ``CONFIRMATION_DECLINED`` before the handler
            runs. ``server.execute()`` and DirectClient calls are never gated.
        confirmation_key: Key (32 bytes or more) that seals the ``requestState`` of
            confirmation elicitations, shared by every instance behind one URL.
            Default: a random key per process.
    """
    if confirmations not in CONFIRMATION_MODES:
        raise ValueError("confirmations must be 'off', 'enforce' or 'require-human'")

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
        instructions=instructions,
        tools_list_ttl_ms=tools_list_ttl_ms,
        clock=clock,
        random=random,
        actor=actor,
        confirmations=confirmations,
        confirmation_key=confirmation_key,
        first_class_tools=first_class_tools,  # type: ignore[arg-type]  # MCPServer checks it
        # MCPServer checks the declarations and converts mappings.
        context_fields=[] if context_fields is None else context_fields,  # type: ignore[arg-type]
    )
    return MCPServer(config)
