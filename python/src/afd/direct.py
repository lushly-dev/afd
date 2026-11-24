"""Direct Transport for zero-overhead in-process command execution.

This module enables co-located agents to execute commands directly
without any transport overhead (no JSON-RPC, no IPC, no network).

Example:
    >>> from afd.direct import DirectClient, create_registry
    >>> from my_app import registry
    >>>
    >>> client = DirectClient(registry)
    >>> result = await client.call('todo-create', {'title': 'Fast!'})
    >>> # ~0.1ms latency vs 10-100ms for MCP

Pipeline Example:
    >>> result = await client.pipe([
    ...     {'command': 'user-get', 'input': {'id': 123}, 'as': 'user'},
    ...     {'command': 'order-list', 'input': {'user_id': '$steps.user.id'}},
    ... ])
"""

from __future__ import annotations

import asyncio
import copy
import dataclasses
import inspect
import logging
import math
import time
import uuid
import warnings
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import (
    Any,
    Protocol,
    TypeVar,
    runtime_checkable,
)

from afd.core.actor import Actor, ContextDefaults, with_context_defaults
from afd.core.clock import Clock, RandomSource
from afd.core.commands import call_not_granted
from afd.core.direct_allow import _bind_allow, _direct_allows, _is_allowed, _not_allowed
from afd.core.direct_approval import (
    DirectApprovalRequest,
    _DirectApprovalExchange,
    _public_result,
)
from afd.core.errors import CommandError, not_found_error, validation_error
from afd.core.output_budget import ask_validation_failure, normalize_ask_option, parse_ask

# Importable from afd.direct before DirectClient.pipe's runner moved to afd.direct_pipeline.
from afd.core.pipeline import (  # noqa: F401
    condition_error,
    evaluate_condition,
    resolution_limit_failure,
    resolve_variable,
    resolve_variables,
)
from afd.core.pipeline_variables import (  # noqa: F401
    MAX_INPUT_DEPTH,
    PipelineResolutionLimitError,
    exceeds_depth,
)
from afd.core.result import (
    CommandResult,
    coerce_command_result,  # noqa: F401 (importable from afd.direct before the pipeline moved)
    execution_failure,
    failure,
    success,  # noqa: F401 (importable from afd.direct before the pipeline moved)
)
from afd.core.similarity import find_similar_tools, truncate_name
from afd.direct_pipeline import (
    DirectPipelineResult,
    DirectPipelineStep,
    DirectPipelineStepResult,  # noqa: F401 (re-exported)
    run_direct_pipeline,
)

logger = logging.getLogger("afd.direct")


# ═══════════════════════════════════════════════════════════════════════════════
# TYPES
# ═══════════════════════════════════════════════════════════════════════════════

T = TypeVar("T")

_HUMAN_ACTOR = Actor(kind="human")
"""The default actor of a DirectClient call."""


@dataclass
class DirectContext:
    """Context for direct command execution; ``timeout`` is in milliseconds.

    ``actor`` is who is calling (``human`` unless the client or call sets
    another). ``clock`` and ``random`` are set only when the client or call
    configures them, so a registry can apply its own defaults (see
    :func:`afd.core.with_context_defaults`). ``approval`` is the call's approval
    evidence for trusted host execution. DirectClient ignores caller-provided evidence.
    """

    trace_id: str
    source: str | None = None
    timeout: float | None = None
    extra: dict[str, Any] = field(default_factory=dict)
    actor: Actor | None = None
    clock: Clock | None = None
    random: RandomSource | None = None
    approval: str | None = None
    cancel: asyncio.Event | None = None
    signal: asyncio.Event | None = None
    output_budget: int | None = None
    _direct_approval: Any = field(default=None, repr=False, compare=False)
    _direct_allow: Any = field(default=None, repr=False, compare=False)
    _server_signal: asyncio.Event | None = field(default=None, repr=False, compare=False)
    _server_signal_fields: tuple[str, ...] = field(default=(), repr=False, compare=False)
    _output_budget_ask: Any = field(default=None, repr=False, compare=False)

    def is_cancelled(self) -> bool:
        """Whether cooperative cancellation has been signalled on this context."""
        return bool(
            (self.cancel is not None and self.cancel.is_set())
            or (self.signal is not None and self.signal.is_set())
        )

    def with_output_budget_ask(self, max_bytes: Any) -> DirectContext:
        """Return a copy of this context carrying an output budget ask (B2)."""
        return dataclasses.replace(self, _output_budget_ask=normalize_ask_option(max_bytes))


@dataclass
class CommandInfo:
    """Information about a registered command."""

    name: str
    description: str


@dataclass
class DirectCommandParameter:
    """Direct command parameter definition for validation."""

    name: str
    type: str  # 'string', 'number', 'boolean', 'object', 'array'
    description: str = ""
    required: bool = True
    default: Any = None
    enum: list[Any] | None = None


@dataclass
class DirectCommandDefinition:
    """Full direct command definition with parameters."""

    name: str
    description: str
    parameters: list[DirectCommandParameter] = field(default_factory=list)


@dataclass
class DirectClientOptions:
    """Options for DirectClient.

    Attributes:
        actor: Actor of every call that sets none. Default: ``Actor(kind="human")``.
            Each call gets its own copy.
        clock: ``context.clock`` of every call that sets none. Default: none, so
            the registry's own default applies.
        random: ``context.random`` of every call that sets none. Default: none.
    """

    source: str | None = None
    debug: bool = False
    validate_inputs: bool = True
    actor: Actor | None = None
    clock: Clock | None = None
    random: RandomSource | None = None
    on_approval_needed: Callable[[DirectApprovalRequest], Any] | None = None
    """Trusted host hook. Only an explicit True permits one private retry."""
    allow: Callable[[str], bool] | None = None
    """Permit only names for which this predicate returns True; exceptions deny."""
    middleware: list[Callable] = field(default_factory=list)
    """Client middleware wraps each registry attempt, in list order."""


@dataclass
class DirectCallContext:
    """Context for individual command calls.

    ``timeout`` is a positive, finite deadline in milliseconds, as in the
    TypeScript DirectClient. Cancellation is cooperative: a handler that
    suppresses cancellation may still finish after the call times out.
    """

    trace_id: str | None = None
    timeout: float | None = None
    extra: dict[str, Any] = field(default_factory=dict)
    actor: Actor | None = None
    """Who is calling; wins over the client's actor."""
    clock: Clock | None = None
    """Clock for this call; wins over the client's."""
    random: RandomSource | None = None
    """Random source for this call; wins over the client's."""
    approval: str | None = None
    """Ignored on public calls; configure on_approval_needed to approve."""
    output_budget: int | None = None
    """Per-call output budget ask in bytes (spec/output-budgets.md, B2)."""


# ═══════════════════════════════════════════════════════════════════════════════
# UNKNOWN TOOL ERROR
# ═══════════════════════════════════════════════════════════════════════════════


@dataclass
class UnknownToolError:
    """Structured error when an agent calls a non-existent tool."""

    error: str = "UNKNOWN_TOOL"
    message: str = ""
    requested_tool: str = ""
    available_tools: list[str] = field(default_factory=list)
    suggestions: list[str] = field(default_factory=list)
    hint: str | None = None


def _create_unknown_tool_error(requested: str, available: list[str]) -> UnknownToolError:
    """Create a structured unknown tool error."""
    suggestions = find_similar_tools(requested, available)
    hint = f"Did you mean '{suggestions[0]}'?" if suggestions else None
    # The requested name is untrusted: echo a bounded copy.
    requested = truncate_name(requested)

    return UnknownToolError(
        error="UNKNOWN_TOOL",
        message=f"Tool '{requested}' not found in registry",
        requested_tool=requested,
        available_tools=available,
        suggestions=suggestions,
        hint=hint,
    )


# ═══════════════════════════════════════════════════════════════════════════════
# DIRECT REGISTRY PROTOCOL
# ═══════════════════════════════════════════════════════════════════════════════


@runtime_checkable
class DirectRegistry(Protocol):
    """Protocol for registries that support direct execution.

    Implement this in your application to enable DirectClient.

    Example:
        >>> class MyRegistry:
        ...     def __init__(self):
        ...         self._commands = {}
        ...
        ...     async def execute(self, name, args, context):
        ...         handler = self._commands.get(name)
        ...         return await handler(args)
        ...
        ...     def has_command(self, name):
        ...         return name in self._commands
        ...
        ...     def list_commands(self):
        ...         return [{'name': n, 'description': ''} for n in self._commands]
        ...
        ...     def list_command_names(self):
        ...         return list(self._commands.keys())
    """

    async def execute(
        self,
        name: str,
        args: dict[str, Any] | None = None,
        context: DirectContext | None = None,
    ) -> CommandResult:
        """Execute a command by name."""
        ...

    def has_command(self, name: str) -> bool:
        """Check if command exists."""
        ...

    def list_commands(self) -> list[CommandInfo]:
        """List all registered commands."""
        ...

    def list_command_names(self) -> list[str]:
        """List command names only."""
        ...

    # Optional method for validation support
    def get_command(self, name: str) -> DirectCommandDefinition | None:
        """Get command definition for validation (optional)."""
        ...


# ═══════════════════════════════════════════════════════════════════════════════
# SIMPLE REGISTRY IMPLEMENTATION
# ═══════════════════════════════════════════════════════════════════════════════


@dataclass
class RegisteredCommand:
    """A registered command with its handler and metadata."""

    name: str
    description: str
    handler: Callable
    parameters: list[DirectCommandParameter] = field(default_factory=list)


def _takes_context(handler: Callable) -> bool:
    """Whether ``handler`` declares a keyword-only ``context`` parameter."""
    try:
        parameter = inspect.signature(handler).parameters.get("context")
    except (TypeError, ValueError):
        return False
    return parameter is not None and parameter.kind is inspect.Parameter.KEYWORD_ONLY


class SimpleRegistry:
    """Simple in-memory command registry.

    Handlers take the command's arguments as keyword arguments. A handler
    that also declares a keyword-only ``context`` parameter (after ``*``)
    receives the call's context, with ``clock``, ``random`` and ``actor``
    (``human`` from a :class:`DirectClient`); ``clock`` and ``random`` default
    to the registry's, then to the real ones. Handlers without it are called
    as before. Arguments cannot be named ``context`` for such a handler.

    A handler that raises returns COMMAND_EXECUTION_ERROR with the message
    "An internal error occurred", and the exception is logged to the
    ``afd.direct`` logger. Pass ``dev_mode=True`` to return the exception
    text instead.

    Example:
        >>> registry = SimpleRegistry()
        >>>
        >>> @registry.command(name='hello', description='Say hello')
        ... async def hello(name: str = 'World'):
        ...     return success({'message': f'Hello, {name}!'})
        >>>
        >>> client = DirectClient(registry)
        >>> result = await client.call('hello', {'name': 'Agent'})
        >>>
        >>> @registry.command(name='dice-roll', description='Roll a die')
        ... async def roll(*, context):
        ...     return success({'roll': 1 + int(context.random.next() * 6)})
    """

    def __init__(
        self,
        *,
        dev_mode: bool = False,
        clock: Clock | None = None,
        random: RandomSource | None = None,
    ):
        """
        Args:
            dev_mode: Return a raising handler's exception text.
            clock: Clock for handlers when the call's context has none.
            random: Random source for handlers when the call's context has none.
        """
        self._commands: dict[str, RegisteredCommand] = {}
        self._dev_mode = dev_mode
        self._context_defaults = ContextDefaults(clock=clock, random=random)

    def command(
        self,
        name: str,
        description: str = "",
        parameters: list[DirectCommandParameter] | None = None,
    ) -> Callable:
        """Decorator to register a command.

        Args:
            name: Command name (use dot.notation for namespacing)
            description: What the command does
            parameters: Parameter definitions for validation
        """

        def decorator(func: Callable) -> Callable:
            self._commands[name] = RegisteredCommand(
                name=name,
                description=description or func.__doc__ or "",
                handler=func,
                parameters=parameters or [],
            )
            return func

        return decorator

    def register(
        self,
        name: str,
        handler: Callable,
        description: str = "",
        parameters: list[DirectCommandParameter] | None = None,
    ) -> None:
        """Register a command imperatively."""
        self._commands[name] = RegisteredCommand(
            name=name,
            description=description or handler.__doc__ or "",
            handler=handler,
            parameters=parameters or [],
        )

    async def execute(
        self,
        name: str,
        args: dict[str, Any] | None = None,
        context: DirectContext | None = None,
    ) -> CommandResult:
        """Execute a command by name."""
        if _is_apps_context(context):
            return failure(call_not_granted())
        if not _is_allowed(context, name):
            return failure(_not_allowed(name))
        cmd = self._commands.get(name)
        if not cmd:
            return failure(not_found_error("Command", name))
        raw_ask = getattr(context, "_output_budget_ask", None) if context is not None else None
        if raw_ask is not None and parse_ask(raw_ask) is None:
            return ask_validation_failure()

        kwargs = dict(args or {})
        if _takes_context(cmd.handler):
            if "context" in kwargs:
                return failure(
                    validation_error(
                        f"Invalid arguments for '{name}': 'context' is reserved for the command context"
                    )
                )
            kwargs["context"] = with_context_defaults(context, self._context_defaults)
        try:
            inspect.signature(cmd.handler).bind(**kwargs)
        except TypeError as e:
            return failure(validation_error(f"Invalid arguments for '{name}': {e}"))
        except ValueError:
            pass  # no introspectable signature: let the call decide
        try:
            return await cmd.handler(**kwargs)
        except Exception as exc:
            # The handler itself failed: not the caller's input.
            logger.error("Command '%s' raised an unhandled exception", name, exc_info=exc)
            return execution_failure(exc, self._dev_mode)

    def has_command(self, name: str) -> bool:
        """Check if command exists."""
        return name in self._commands

    def list_commands(self) -> list[CommandInfo]:
        """List all registered commands."""
        return [
            CommandInfo(name=cmd.name, description=cmd.description)
            for cmd in self._commands.values()
        ]

    def list_command_names(self) -> list[str]:
        """List command names only."""
        return list(self._commands.keys())

    def get_command(self, name: str) -> DirectCommandDefinition | None:
        """Get command definition for validation."""
        cmd = self._commands.get(name)
        if not cmd:
            return None
        return DirectCommandDefinition(
            name=cmd.name,
            description=cmd.description,
            parameters=cmd.parameters,
        )


# ═══════════════════════════════════════════════════════════════════════════════
# DIRECT CLIENT
# ═══════════════════════════════════════════════════════════════════════════════


def _consume_execution(task: asyncio.Task) -> None:
    """Retrieve late failures after cancellation without delaying the deadline."""
    if not task.cancelled():
        task.exception()


def _is_apps_context(context: Any) -> bool:
    """Whether a direct call context names the ``apps`` interface."""
    extra = getattr(context, "extra", None)
    return bool(extra and extra.get("interface") == "apps")


def _generate_trace_id() -> str:
    """Generate a unique trace ID."""
    return f"trace-{uuid.uuid4().hex[:12]}"


class DirectClient:
    """Zero-overhead command execution client.

    Calls commands directly via the registry without MCP transport.
    Provides ~0.1ms latency vs 10-100ms for MCP.

    Example:
        >>> client = DirectClient(registry)
        >>> result = await client.call('todo-create', {'title': 'Fast task'})
        >>> print(result.data)

    Pipeline Example:
        >>> result = await client.pipe([
        ...     {'command': 'user-get', 'input': {'id': 123}, 'as': 'user'},
        ...     {'command': 'order-list', 'input': {'user_id': '$steps.user.id'}},
        ... ])
    """

    def __init__(
        self,
        registry: DirectRegistry,
        options: DirectClientOptions | None = None,
    ):
        self.registry = registry
        self.options = options or DirectClientOptions()

    def _is_allowed(self, name: str) -> bool:
        return self.options.allow is None or _direct_allows(self.options.allow, name)

    async def _execute(self, name: str, args: Any, context: DirectContext) -> CommandResult:
        # A fresh context per attempt keeps a middleware's mutations out of a retry.
        context = copy.copy(context)
        context.extra = dict(context.extra)
        context.actor = copy.copy(context.actor)
        context = _bind_allow(context, self.options.allow)

        async def execute() -> CommandResult:
            return _public_result(await self.registry.execute(name, args, context), name)

        next_fn = execute
        for middleware in reversed(self.options.middleware):
            next_fn = (
                lambda mw, nxt: lambda: mw(name, args if args is not None else {}, context, nxt)
            )(middleware, next_fn)
        try:
            return await next_fn()
        except Exception as exc:
            logger.error("Command '%s' raised an unhandled exception", name, exc_info=exc)
            return execution_failure(exc)

    async def call(
        self,
        name: str,
        args: dict[str, Any] | None = None,
        context: DirectCallContext | None = None,
        *,
        output_budget: Any = None,
    ) -> CommandResult:
        """Execute a command with zero transport overhead.

        Args:
            name: Command name
            args: Command arguments
            context: Optional call context for tracing

        Returns:
            CommandResult from the command handler
        """
        start_time = time.perf_counter() if self.options.debug else 0
        trace_id = (context.trace_id if context else None) or _generate_trace_id()

        self._debug(f"[{trace_id}] Calling {name}", args)

        # App-to-app calls (spec/command-metadata.md, "App-to-app calls") go directly
        # through CommandRegistry or MCPServer, never DirectClient or DirectCommandRegistry.
        if _is_apps_context(context):
            return failure(call_not_granted())

        if not self._is_allowed(name):
            return failure(_not_allowed(name))

        # Check if command exists
        if not self.registry.has_command(name):
            available = self.list_command_names()
            error_data = _create_unknown_tool_error(name, available)

            self._debug(f"[{trace_id}] Unknown command: {name}")

            return CommandResult(
                success=False,
                data=error_data,
                error=CommandError(
                    code="UNKNOWN_TOOL",
                    message=error_data.message,
                    # Always a suggestion (spec/error-codes.md, D4): the closest
                    # match, or where to find valid names.
                    suggestion=error_data.hint
                    or "Call one of the commands returned by list_command_names()",
                    retryable=False,
                ),
            )

        # Input validation (if registry supports getCommand)
        if self.options.validate_inputs and hasattr(self.registry, "get_command"):
            cmd_def = self.registry.get_command(name)
            if cmd_def:
                issues = self._validate_input(args, cmd_def.parameters)
                if issues:
                    self._debug(f"[{trace_id}] Validation failed: {issues}")
                    return failure(
                        validation_error(f"Invalid input for '{name}': {'; '.join(issues)}")
                    )

        # Build command context. The call's actor, clock and random win over the client's.
        # Clock and random are only set when configured, so a registry's own defaults
        # still apply.
        actor = (context.actor if context else None) or self.options.actor or _HUMAN_ACTOR
        ask_source = (
            output_budget
            if output_budget is not None
            else (context.output_budget if context is not None else None)
        )
        raw_ask = normalize_ask_option(ask_source)
        if raw_ask is not None and parse_ask(raw_ask) is None:
            return ask_validation_failure()
        cmd_context = DirectContext(
            trace_id=trace_id,
            source=self.options.source,
            timeout=context.timeout if context else None,
            extra=context.extra if context else {},
            actor=copy.copy(actor),
            clock=(context.clock if context else None) or self.options.clock,
            random=(context.random if context else None) or self.options.random,
            approval=None,
            _output_budget_ask=raw_ask,
        )

        # The exchange survives context copies, but credentials never enter public contexts.
        exchange = _DirectApprovalExchange()
        cmd_context._direct_approval = exchange

        timeout = cmd_context.timeout
        seconds = (
            min(timeout, 2_147_483_647) / 1000
            if isinstance(timeout, (int, float))
            and not isinstance(timeout, bool)
            and (isinstance(timeout, int) or math.isfinite(timeout))
            and timeout > 0
            else None
        )
        loop = asyncio.get_running_loop()
        deadline = loop.time() + seconds if seconds is not None else None

        def expired():
            return deadline is not None and loop.time() >= deadline

        def timed_out():
            return failure(
                CommandError(
                    code="TIMEOUT",
                    message=f"Command '{truncate_name(name)}' timed out after {timeout}ms",
                    suggestion=(
                        "Retry with a larger timeout. The command was signalled to abort "
                        "but may have completed, so check its effect before retrying a mutation."
                    ),
                    retryable=True,
                    details={"command": name, "timeoutMs": timeout},
                )
            )

        async def run():
            result = _public_result(await self._execute(name, args, cmd_context), name)
            if expired():
                return timed_out()
            pending = exchange.pending()
            hook = self.options.on_approval_needed
            if (
                not result.success
                and result.error is not None
                and result.error.code == "APPROVAL_REQUIRED"
                and pending
                and hook
            ):
                request = DirectApprovalRequest(command=name, input=copy.deepcopy(args), **pending)
                try:
                    answer = hook(request)
                    if inspect.isawaitable(answer):
                        answer = await answer
                except Exception:
                    answer = False
                # A blocking hook may prevent the event-loop timer from firing on time.
                if expired():
                    return timed_out()
                if answer is True and exchange.approve():
                    result = _public_result(await self._execute(name, args, cmd_context), name)
            return timed_out() if expired() else result

        # Shield the worker so caller cancellation disposes authority immediately, even
        # when trusted middleware or a hook catches CancelledError and finishes later.
        execution = asyncio.create_task(run())
        try:
            if seconds is None:
                result = await asyncio.shield(execution)
            else:
                done, _ = await asyncio.wait({execution}, timeout=seconds)
                if execution in done:
                    result = execution.result()
                else:
                    exchange.dispose()
                    execution.cancel()
                    execution.add_done_callback(_consume_execution)
                    result = timed_out()
        except BaseException:
            exchange.dispose()
            execution.cancel()
            execution.add_done_callback(_consume_execution)
            raise
        finally:
            exchange.dispose()

        if self.options.debug:
            duration = (time.perf_counter() - start_time) * 1000
            self._debug(
                f"[{trace_id}] Completed in {duration:.3f}ms",
                {
                    "success": result.success,
                },
            )

        return result

    def list_commands(self) -> list[CommandInfo]:
        """List available commands."""
        return [
            command for command in self.registry.list_commands() if self._is_allowed(command.name)
        ]

    def list_command_names(self) -> list[str]:
        """List command names."""
        return [name for name in self.registry.list_command_names() if self._is_allowed(name)]

    def has_command(self, name: str) -> bool:
        """Check if a command exists."""
        return self._is_allowed(name) and self.registry.has_command(name)

    def get_source(self) -> str | None:
        """Get the source identifier for this client."""
        return self.options.source

    def _validate_input(
        self,
        args: dict[str, Any] | None,
        parameters: list[DirectCommandParameter],
    ) -> list[str]:
        """Validate input against parameter definitions."""
        issues = []
        args = args or {}

        for param in parameters:
            if param.required and param.name not in args:
                issues.append(f"Missing required parameter: '{param.name}'")
                continue

            if param.name in args:
                value = args[param.name]
                # Type checking (basic)
                if param.type == "string" and not isinstance(value, str):
                    issues.append(f"'{param.name}' must be a string")
                elif param.type == "number" and (
                    isinstance(value, bool) or not isinstance(value, (int, float))
                ):
                    issues.append(f"'{param.name}' must be a number")
                elif param.type == "boolean" and not isinstance(value, bool):
                    issues.append(f"'{param.name}' must be a boolean")
                elif param.type == "object" and not isinstance(value, dict):
                    issues.append(f"'{param.name}' must be an object")
                elif param.type == "array" and not isinstance(value, list):
                    issues.append(f"'{param.name}' must be an array")

                # Enum validation
                if param.enum and value not in param.enum:
                    issues.append(f"'{param.name}' must be one of: {param.enum}")

        return issues

    async def connect_handoff(
        self,
        handoff: dict[str, Any],
        options: Any | None = None,
    ) -> Any:
        """Connect to a handoff endpoint.

        Convenience method that delegates to the handoff client module.

        Args:
            handoff: HandoffResult dict from a command.
            options: HandoffConnectionOptions for callbacks.

        Returns:
            A HandoffConnection for the protocol.
        """
        from afd.handoff_client import connect_handoff as _connect_handoff

        return await _connect_handoff(handoff, options)

    async def create_reconnecting_handoff(
        self,
        handoff: dict[str, Any],
        options: Any | None = None,
    ) -> Any:
        """Create a reconnecting handoff connection.

        Convenience method that delegates to the handoff client module.

        Args:
            handoff: HandoffResult dict from a command.
            options: ReconnectionOptions for reconnection behavior.

        Returns:
            A ReconnectingHandoffConnection with auto-reconnect.
        """
        from afd.handoff_client import create_reconnecting_handoff as _create

        return await _create(self, handoff, options)

    def _debug(self, message: str, data: Any = None) -> None:
        """Debug logging helper."""
        if self.options.debug:
            print(f"[DirectClient] {message}", data if data else "")

    async def pipe(
        self,
        steps: list[DirectPipelineStep | dict[str, Any]],
        context: DirectCallContext | None = None,
        *,
        input: dict[str, Any] | None = None,
        output_budget: Any = None,
    ) -> DirectPipelineResult:
        """Execute a pipeline of commands with variable resolution.

        Step inputs and conditions use the pipeline variable references of
        ``spec/pipeline-variables.md``, the same as ``afd-pipe``:

        - ``$prev`` / ``$prev.field``: data of the previous successful step
        - ``$first`` / ``$first.field``: data of the first step
        - ``$steps[N]`` / ``$steps[N].field``: data of step N (0-based)
        - ``$steps.alias`` / ``$steps.alias.field``: data of the step named
          ``alias`` (via its ``as`` property)
        - ``$input`` / ``$input.field``: the ``input`` argument

        Other strings starting with ``$`` are literals, ``$$`` escapes a
        literal ``$``, and an unresolved reference is omitted from objects
        (``None`` in lists). The pipeline stops at the first failed step.

        Streaming steps are not implemented: the first step with
        ``stream: True`` fails with UNSUPPORTED_OPTION and every other step
        is skipped, before any command runs.

        Args:
            steps: List of pipeline steps (dicts or DirectPipelineStep objects)
            context: Optional context for tracing
            input: Optional pipeline input, referenced as ``$input``

        Returns:
            DirectPipelineResult with all step results and outputs

        Example:
            >>> result = await client.pipe([
            ...     {'command': 'user-get', 'input': {'id': 123}, 'as': 'user'},
            ...     {'command': 'order-list', 'input': {'user_id': '$steps.user.id'}},
            ... ])
        """
        start_time = time.perf_counter()
        trace_id = (context.trace_id if context else None) or _generate_trace_id()
        if _is_apps_context(context):
            return DirectPipelineResult(
                success=False,
                steps=[],
                outputs={},
                final=failure(call_not_granted()),
                total_duration_ms=(time.perf_counter() - start_time) * 1000,
            )
        ask_source = (
            output_budget
            if output_budget is not None
            else (context.output_budget if context is not None else None)
        )
        raw_ask = normalize_ask_option(ask_source)
        if raw_ask is not None and parse_ask(raw_ask) is None:
            return DirectPipelineResult(
                success=False,
                steps=[],
                outputs={},
                final=ask_validation_failure(),
                total_duration_ms=(time.perf_counter() - start_time) * 1000,
            )

        async def call(command: str, args: dict[str, Any] | None) -> Any:
            return await self.call(command, args, context, output_budget=output_budget)

        return await run_direct_pipeline(
            steps,
            input,
            call=call,
            debug=self._debug,
            trace_id=trace_id,
            start_time=start_time,
        )


# ═══════════════════════════════════════════════════════════════════════════════
# FACTORY FUNCTIONS
# ═══════════════════════════════════════════════════════════════════════════════


def create_registry(
    *,
    dev_mode: bool = False,
    clock: Clock | None = None,
    random: RandomSource | None = None,
) -> SimpleRegistry:
    """Create a new SimpleRegistry instance.

    Args:
        dev_mode: Return a raising handler's exception text instead of
            "An internal error occurred" (see :class:`SimpleRegistry`).
        clock: Clock for handlers that take a ``context``, when the call's
            context has none.
        random: Random source for those handlers, when the call's context has none.

    Example:
        >>> registry = create_registry()
        >>>
        >>> @registry.command(name='ping', description='Health check')
        ... async def ping():
        ...     return success({'status': 'ok'})
    """
    return SimpleRegistry(dev_mode=dev_mode, clock=clock, random=random)


def create_direct_client(
    registry: DirectRegistry,
    source: str | None = None,
    debug: bool = False,
    validate_inputs: bool = True,
    *,
    on_approval_needed: Callable[[DirectApprovalRequest], Any] | None = None,
    allow: Callable[[str], bool] | None = None,
    middleware: list[Callable] | None = None,
) -> DirectClient:
    """Create a DirectClient for zero-overhead command execution.

    Args:
        registry: The command registry to execute against
        source: Optional source identifier (e.g., 'my-agent')
        debug: Enable debug logging
        validate_inputs: Validate inputs against schemas

    Returns:
        Configured DirectClient instance

    Example:
        >>> client = create_direct_client(registry, source='api-server')
        >>> result = await client.call('user-get', {'id': 123})
    """
    return DirectClient(
        registry,
        DirectClientOptions(
            source=source,
            debug=debug,
            validate_inputs=validate_inputs,
            on_approval_needed=on_approval_needed,
            allow=allow,
            middleware=list(middleware or []),
        ),
    )


class DirectCommandRegistry:
    """Validating agent registry over the server engine, with private approval results.

    Use this boundary for untrusted in-process callers. The server's own execute
    remains a trusted host API and preserves out-of-band approval evidence.
    """

    def __init__(self, server: Any, *, interface: str = "agent") -> None:
        if interface == "apps":
            raise ValueError(
                "create_direct_registry cannot use interface='apps'; pass call_grant to "
                "create_command_registry or create_server instead"
            )
        self._server = server
        self._interface = interface

    def list_commands(self) -> list[CommandInfo]:
        return [
            CommandInfo(c.name, c.description)
            for c in self._server.list_exposed_commands(
                interface=self._interface, include_bootstrap=False
            )
        ]

    def list_command_names(self) -> list[str]:
        return [c.name for c in self.list_commands()]

    def has_command(self, name: str) -> bool:
        return name in self.list_command_names()

    async def execute(
        self,
        name: str,
        args: Any = None,
        context: Any = None,
        *,
        allow: Callable[[str], bool] | None = None,
        output_budget: Any = None,
    ) -> CommandResult:
        from afd.core.direct_approval import _exchange, _public_context

        if _is_apps_context(context):
            return failure(call_not_granted())
        context = _bind_allow(context or DirectContext(trace_id=_generate_trace_id()), allow)
        if not _is_allowed(context, name):
            return failure(_not_allowed(name))
        # server.execute also routes MCP meta-tools, which build a fresh MCP context.
        # Only registered commands may cross this direct boundary; never dispatch a router.
        if not any(command.name == name for command in self._server.list_commands()):
            return failure(
                CommandError(
                    code="COMMAND_NOT_FOUND",
                    message=f"Command '{truncate_name(name)}' not found",
                    suggestion="List available commands to see valid options",
                    retryable=False,
                )
            )
        definition = next(
            command for command in self._server.list_commands() if command.name == name
        )
        if not self._server._is_exposed_to(definition, self._interface):
            return failure(
                CommandError(
                    code="COMMAND_NOT_EXPOSED",
                    message=f"Command '{truncate_name(name)}' is not exposed to {self._interface}",
                    suggestion="Call a command exposed to the registry's configured interface",
                    retryable=False,
                )
            )
        exchange = _exchange(context)
        owned = exchange is None
        exchange = exchange or _DirectApprovalExchange()
        clean = _public_context(context)
        clean._direct_approval = exchange
        clean.extra["interface"] = self._interface
        clean.extra.pop("remote", None)
        try:
            return _public_result(
                await self._server.execute(
                    name, {} if args is None else args, clean, output_budget=output_budget
                ),
                name,
            )
        finally:
            if owned:
                exchange.dispose()


def create_direct_registry(
    commands: list[Callable],
    *,
    middleware: list[Any] | None = None,
    interface: str = "agent",
    **options: Any,
) -> DirectCommandRegistry:
    """Create an agent boundary for decorated commands using the validating server engine."""
    from afd.server import create_server

    server = create_server("direct-registry", middleware=middleware, **options)
    for command in commands:
        server.register(command)
    return DirectCommandRegistry(server, interface=interface)


_DEPRECATED_NAMES = {
    "CommandContext": DirectContext,
    "CommandDefinition": DirectCommandDefinition,
    "CommandParameter": DirectCommandParameter,
    "PipelineStep": DirectPipelineStep,
    "PipelineStepResult": DirectPipelineStepResult,
    "PipelineResult": DirectPipelineResult,
}


def __getattr__(name: str) -> Any:
    target = _DEPRECATED_NAMES.get(name)
    if target is None:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    warnings.warn(
        f"afd.direct.{name} is deprecated and will be removed in the next minor release; "
        f"use afd.direct.{target.__name__} instead.",
        DeprecationWarning,
        stacklevel=2,
    )
    return target
