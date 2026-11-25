"""Command definition and registry types.

Commands are the core abstraction in AFD. Every application action
is defined as a command with a clear schema.

Example:
    >>> from afd.core.commands import CommandDefinition, create_command_registry
    >>> from afd import success
    >>>
    >>> async def my_handler(input, context=None):
    ...     return success({"id": "123"})
    >>>
    >>> registry = create_command_registry()
    >>> registry.register(CommandDefinition(
    ...     name="my-command",
    ...     description="Does something useful",
    ...     handler=my_handler,
    ... ))
"""

import asyncio
import builtins
import copy
import dataclasses
import logging
import re
import warnings
from collections.abc import AsyncGenerator, Awaitable, Callable, Sequence
from dataclasses import dataclass, field, replace
from typing import (
    Any,
    Literal,
    Protocol,
    TypeVar,
)

from afd.core.actor import Actor, ContextDefaults
from afd.core.approval import ApprovalPolicy, approval_mode
from afd.core.batch import DEFAULT_MAX_BATCH_PARALLELISM, DEFAULT_MAX_BATCH_SIZE, BatchResult
from afd.core.clock import Clock, RandomSource
from afd.core.command_execution import (
    CommandRegistryOptions,
    ExecutorOptions,
    StreamExecutorOptions,
    resolve_batch_limit,
)
from afd.core.command_execution import (
    execute_batch as _execute_core_batch,
)
from afd.core.command_execution import (
    execute_stream as _execute_core_stream,
)
from afd.core.errors import CommandError, ErrorCodes, Recovery
from afd.core.output_budget import (
    AFD_OUTPUT_BUDGET_META_KEY,
    OutputBudget,
    normalize_ask_option,
    validate_output_budget_declaration,
)
from afd.core.result import CommandResult
from afd.core.schema_registration import starts_resource
from afd.core.single_executor import CommandExecutionConfig, execute_command
from afd.core.single_executor import is_exposed_to as is_exposed_to
from afd.core.streaming import StreamChunk, StreamOptions

logger = logging.getLogger("afd.core")

COMMAND_NAME_PATTERN = re.compile(r"^[a-z][a-z0-9]*(-[a-z][a-z0-9]*)+$")

TaskSupport = Literal["never", "optional", "required"]
"""Whether an MCP ``tools/call`` to a command may run as a task (``spec/command-metadata.md``, "Tasks")."""

CommandConfirmationMode = Literal["host-verified"]
"""How a command's confirmation is proved (``spec/command-metadata.md``, "Host-verified confirmation")."""

_VALID_TASK_SUPPORTS = frozenset({"never", "optional", "required"})
_VALID_CONFIRMATION_MODES = frozenset({"host-verified"})
_SCOPE_TOKEN_RE = re.compile(r"\A[\x21\x23-\x5B\x5D-\x7E]+\Z", re.ASCII)


def validate_confirmation_mode(name: str, confirmation_mode: Any) -> CommandConfirmationMode | None:
    """Validate ``confirmation_mode`` metadata (``spec/command-metadata.md``, "Host-verified confirmation")."""
    if confirmation_mode is None:
        return None
    if not isinstance(confirmation_mode, str) or confirmation_mode not in _VALID_CONFIRMATION_MODES:
        raise ValueError(
            f"command '{name}': invalid confirmation_mode {confirmation_mode!r} "
            "(expected 'host-verified')"
        )
    return confirmation_mode  # type: ignore[return-value]


def validate_command_scopes(name: str, scopes: Any) -> list[str]:
    """Validate and deduplicate ``scopes`` (OAuth scope tokens, RFC 6749 3.3)."""
    if scopes is None:
        return []
    if isinstance(scopes, (str, bytes)) or not isinstance(scopes, Sequence):
        raise ValueError(f"command '{name}': scopes must be a sequence of scope tokens")
    kept: list[str] = []
    seen: set[str] = set()
    for scope in scopes:
        if not isinstance(scope, str) or _SCOPE_TOKEN_RE.match(scope) is None:
            raise ValueError(f"command '{name}': scope {scope!r} is not an OAuth scope token")
        if scope not in seen:
            seen.add(scope)
            kept.append(scope)
    return kept


def validate_task_declaration(
    name: str,
    task: TaskSupport | None,
    *,
    confirm_prompt: str | None = None,
    approval: ApprovalPolicy | None = None,
    confirmation_mode: str | None = None,
) -> None:
    """Validate ``task`` metadata against ``spec/command-metadata.md`` ("Tasks").

    Refuses unknown values and refuses ``"optional"`` / ``"required"`` beside
    ``confirm_prompt``, an ``approval`` other than ``"not-required"``, or
    ``confirmation_mode``.
    """
    if task is None:
        return
    if not isinstance(task, str) or task not in _VALID_TASK_SUPPORTS:
        raise ValueError(
            f"command '{name}': invalid task support {task!r} "
            "(expected 'never', 'optional' or 'required')"
        )
    if task not in ("optional", "required"):
        return
    conflicts: list[str] = []
    if confirm_prompt is not None:
        conflicts.append("confirm_prompt")
    if approval is not None and approval != "not-required":
        conflicts.append("approval")
    if confirmation_mode is not None:
        conflicts.append("confirmation_mode")
    if conflicts:
        raise ValueError(
            f"command '{name}': task='{task}' cannot be combined with {', '.join(conflicts)}"
        )


@dataclass(frozen=True)
class ExposeOptions:
    """Controls which interfaces a command is exposed to.

    Security-first defaults: palette and agent are on by default,
    MCP, CLI and apps are opt-in.

    Attributes:
        palette: Expose to command palette (default: True).
        mcp: Expose to external MCP agents (default: False -- opt-in for security).
        agent: Expose to in-app AI assistant (default: True).
        cli: Expose to terminal/CLI (default: False).
        apps: Expose to other apps under a host's call grant (default: False -- opt-in).
    """

    palette: bool = True
    mcp: bool = False
    agent: bool = True
    cli: bool = False
    apps: bool = False


DEFAULT_EXPOSE = ExposeOptions()
"""Default exposure options. Frozen dataclass prevents accidental mutation."""

_VALID_INTERFACES = frozenset({"palette", "mcp", "agent", "cli", "apps"})

TInput = TypeVar("TInput")
TOutput = TypeVar("TOutput")
JsonSchema = dict[str, Any]


@dataclass(frozen=True)
class CommandExample:
    """Normalized command example for docs and MCP metadata.

    Attributes:
        input: Example input payload.
        title: Optional short label for the example.
        description: Optional longer explanation for the example.
    """

    input: dict[str, Any]
    title: str | None = None
    description: str | None = None


@dataclass
class CommandParameter:
    """Definition for a single command parameter.

    Attributes:
        name: Parameter name.
        type: JSON Schema type.
        description: Human-readable description.
        required: Whether this parameter is required.
        default: Default value if not provided.
        enum: Allowed values for enum types.
    """

    name: str
    type: Literal["string", "number", "boolean", "object", "array", "null"]
    description: str
    required: bool = False
    default: Any | None = None
    enum: list[Any] | None = None
    schema: JsonSchema | None = None


@dataclass
class CommandContext:
    """Context provided to command handlers.

    Attributes:
        trace_id: Unique ID for this command invocation.
        timeout: Timeout in milliseconds.
        extra: Additional custom context values.
        actor: Who is calling: a human, an agent, a service, a script or a
            test. Filled in by the surface (DirectClient: ``human``; MCP
            server: ``agent``; testing helpers: ``test``) unless the caller
            sets it.
        clock: Source of the current time. Read time from here instead of
            ``time.time()`` so tests and replays can control it. The MCP
            server and the core registry always set it (to ``system_clock``
            unless overridden).
        random: Source of randomness. Read random numbers from here instead
            of ``random.random()`` so tests and replays can seed them. Set by
            the same surfaces as ``clock`` (to ``system_random`` unless
            overridden).
        approval: Approval evidence for a command whose approval policy
            requires it: the ``approvalToken`` from an ``APPROVAL_REQUIRED``
            result, set by the surface once a human approved. Only trusted
            surface code sets it, never tool arguments.
        credentials: Verified OAuth access-token claims (``afd.server.Credentials``,
            ``spec/authorization.md``, M4), set by the server's authorization layer
            on verified HTTP requests. Never the raw token; never journaled or
            forwarded.
    """

    trace_id: str | None = None
    timeout: int | float | None = None
    extra: dict[str, Any] = field(default_factory=dict)
    actor: Actor | None = None
    clock: Clock | None = None
    random: RandomSource | None = None
    approval: str | None = None
    report_progress: Callable[[str], None] | None = None
    cancel: asyncio.Event | None = None
    signal: asyncio.Event | None = None
    credentials: Any | None = None
    output_budget: int | None = None
    _direct_approval: Any = field(default=None, repr=False, compare=False)
    _direct_allow: Any = field(default=None, repr=False, compare=False)
    _server_signal: asyncio.Event | None = field(default=None, repr=False, compare=False)
    _server_signal_fields: tuple[str, ...] = field(default=(), repr=False, compare=False)
    _output_budget_ask: Any = field(default=None, repr=False, compare=False)
    _scope_view: Any = field(default=None, repr=False, compare=False)
    _skip_output_budget: bool = field(default=False, repr=False, compare=False)

    def is_cancelled(self) -> bool:
        """Whether cooperative cancellation has been signalled on this context."""
        return bool(
            (self.cancel is not None and self.cancel.is_set())
            or (self.signal is not None and self.signal.is_set())
        )

    def with_output_budget_ask(self, max_bytes: Any) -> "CommandContext":
        """Return a copy of this context carrying an output budget ask (B2)."""
        return dataclasses.replace(self, _output_budget_ask=normalize_ask_option(max_bytes))


# Type alias for command handler functions
CommandHandler = Callable[
    [Any, CommandContext | None],
    Awaitable[CommandResult[Any]],
]

# Middleware types, matching TypeScript's CommandMiddleware. ``afd.server``
# re-exports these same objects; the server runs the chain.
NextFn = Callable[[], Awaitable[CommandResult[Any]]]
"""Runs the rest of the middleware chain and then the handler."""

CommandMiddleware = Callable[
    [str, Any, CommandContext, NextFn],
    Awaitable[CommandResult[Any]],
]
"""Middleware: ``(command_name, input, context, next_fn) -> CommandResult``."""

CallGrant = Callable[[str, CommandContext], bool]
"""Host grant predicate for app-to-app calls: ``(command_name, context) -> bool``."""


def call_not_granted() -> CommandError:
    """The fixed ``CALL_NOT_GRANTED`` refusal for app-to-app calls.

    Names neither the command nor the reason (``spec/command-metadata.md``,
    "App-to-app calls").
    """
    return CommandError(
        code=ErrorCodes.CALL_NOT_GRANTED,
        message="This app may not call that command",
        suggestion=(
            "Ask the deployer for a calls grant that names the command; "
            "the command must also set expose.apps"
        ),
        retryable=False,
        # The deployer adds a calls grant (spec/recovery.md, "Engine errors").
        recovery=Recovery(kind="external"),
    )


def app_call_granted(
    command: "CommandDefinition | None",
    name: str,
    context: CommandContext,
    call_grant: CallGrant | None,
) -> bool:
    """Whether an ``interface == 'apps'`` call to ``name`` is admitted.

    Runs only when the command exists, sets ``expose.apps`` to ``True``, and
    ``call_grant(name, context)`` returns strictly ``True``. Missing grants,
    any other return value, or an exception all refuse.
    """
    if command is None or call_grant is None:
        return False
    expose = command.expose if command.expose is not None else DEFAULT_EXPOSE
    if expose.apps is not True:
        return False
    try:
        return call_grant(name, context) is True
    except Exception:
        return False


@dataclass
class CommandDefinition:
    """Full command definition with schema, handler, and metadata.

    Attributes:
        name: Unique command name using kebab-case (domain-action).
        description: Human-readable description of what the command does.
        handler: The async command implementation.
        category: Category for grouping related commands.
        parameters: Command parameters with types and descriptions.
        returns_description: Description of the return type.
        errors: Error codes this command may return.
        version: Command version for tracking changes.
        tags: Tags for additional categorization.
        mutation: Whether this command performs side effects.
        execution_time: Estimated execution time category.
        destructive: Whether the command's effects are hard to reverse. ``None`` is unset.
        confirm_prompt: The question a frontend asks before running the command. A server
            may enforce it (``spec/command-metadata.md``, "Confirmations").
        undoable: Whether the command's effects can be undone. ``None`` is unset.
        approval: Whether a call needs a human's approval before the handler runs:
            ``"required"``, ``"not-required"`` (the default when unset) or a function of
            the validated input and context. Decided by ``create_approval_middleware``;
            ``create_server`` and ``create_direct_registry`` refuse a declared policy other
            than ``"not-required"`` with ``APPROVAL_UNAVAILABLE`` when no approval step
            admitted the call, while ``create_command_registry`` has no check. Reported as
            ``_meta.approval``.
        title: A short human-readable label, the MCP tool ``title`` of the command's own
            tool. Display text, never derived from the name and never in ``_meta``.

    Example:
        >>> async def create_doc(input, context=None):
        ...     return success({"id": "doc-123", "title": input.get("title")})
        >>>
        >>> cmd = CommandDefinition(
        ...     name="document-create",
        ...     description="Creates a new document",
        ...     handler=create_doc,
        ...     category="documents",
        ...     parameters=[
        ...         CommandParameter(
        ...             name="title",
        ...             type="string",
        ...             description="Document title",
        ...             required=True,
        ...         ),
        ...     ],
        ...     mutation=True,
        ... )
    """

    name: str
    description: str
    handler: CommandHandler
    category: str | None = None
    parameters: list[CommandParameter] = field(default_factory=list)
    input_schema: JsonSchema | None = None
    returns_description: str | None = None
    returns: JsonSchema | None = None
    errors: list[str] | None = None
    version: str | None = None
    tags: list[str] | None = None
    mutation: bool = False
    execution_time: Literal["instant", "fast", "slow", "long-running"] | None = None
    examples: list[CommandExample] = field(default_factory=list)
    requires: list[str] = field(default_factory=list)
    contexts: list[str] = field(default_factory=list)
    handoff: bool = False
    handoff_protocol: str | None = None
    expose: ExposeOptions | None = None
    destructive: bool | None = None
    confirm_prompt: str | None = None
    undoable: bool | None = None
    approval: ApprovalPolicy | None = None
    title: str | None = None
    task: TaskSupport | None = None
    tool_meta: dict[str, Any] | None = None
    advertised_input_schema: JsonSchema | None = None
    output_budget: OutputBudget | None = None
    scopes: list[str] = field(default_factory=list)
    confirmation_mode: CommandConfirmationMode | None = None


class CommandRegistry(Protocol):
    """Protocol for command registry implementations."""

    def register(self, command: CommandDefinition) -> None:
        """Register a command.

        Args:
            command: The command definition to register.

        Raises:
            ValueError: If a command with the same name already exists.
        """
        ...

    def get(self, name: str) -> CommandDefinition | None:
        """Get a command by name.

        Args:
            name: The command name.

        Returns:
            The command definition or None if not found.
        """
        ...

    def has(self, name: str) -> bool:
        """Check if a command exists.

        Args:
            name: The command name.

        Returns:
            True if the command exists.
        """
        ...

    def list(self) -> list[CommandDefinition]:
        """Get all registered commands.

        Returns:
            List of all command definitions.
        """
        ...

    def list_by_category(self, category: str) -> builtins.list[CommandDefinition]:
        """Get commands by category.

        Args:
            category: The category to filter by.

        Returns:
            List of commands in the category.
        """
        ...

    def list_by_exposure(self, interface: str) -> builtins.list[CommandDefinition]:
        """Get commands exposed to ``interface``.

        Args:
            interface: Surface name (``palette``, ``mcp``, ``agent``, ``cli``, or ``apps``).

        Returns:
            List of commands exposed to that interface.
        """
        ...

    async def execute(
        self,
        name: str,
        input: Any,
        context: CommandContext | None = None,
        *,
        output_budget: Any = None,
    ) -> CommandResult[Any]:
        """Execute a command by name.

        Args:
            name: The command name.
            input: The command input.
            context: Optional execution context.

        Returns:
            The command result.
        """
        ...

    async def execute_batch(
        self,
        request: Any,
        context: CommandContext | None = None,
    ) -> BatchResult[Any]:
        """Execute a batch of commands through this registry's ``execute``."""
        ...

    def execute_stream(
        self,
        name: str,
        input: Any,
        options: StreamOptions | None = None,
        context: CommandContext | None = None,
    ) -> AsyncGenerator[StreamChunk, None]:
        """Execute a command through this registry's ``execute`` and stream its result."""
        ...


class _CommandRegistryImpl:
    """Default command registry implementation backed by the shared core executor."""

    def __init__(
        self,
        *,
        dev_mode: bool = False,
        call_grant: CallGrant | None = None,
        max_batch_size: int = DEFAULT_MAX_BATCH_SIZE,
        max_batch_parallelism: int = DEFAULT_MAX_BATCH_PARALLELISM,
        middleware: Sequence[CommandMiddleware] | None = None,
        clock: Clock | None = None,
        random: RandomSource | None = None,
    ) -> None:
        if call_grant is not None and not callable(call_grant):
            raise TypeError("call_grant must be callable")
        self._commands: dict[str, CommandDefinition] = {}
        self._dev_mode = dev_mode
        self._call_grant = call_grant
        self._max_batch_size = resolve_batch_limit(
            max_batch_size, DEFAULT_MAX_BATCH_SIZE, "max_batch_size"
        )
        self._max_batch_parallelism = resolve_batch_limit(
            max_batch_parallelism, DEFAULT_MAX_BATCH_PARALLELISM, "max_batch_parallelism"
        )
        self._middleware: list[CommandMiddleware] = list(middleware or [])
        self._context_defaults = ContextDefaults(clock=clock, random=random)

    def register(self, command: CommandDefinition) -> None:
        if command.name in self._commands:
            raise ValueError(f"Command '{command.name}' is already registered")
        # define_command already warned about a decorated handler's own name.
        decorated = getattr(command.handler, "__afd_command__", None)
        if getattr(decorated, "name", None) != command.name:
            warn_invalid_command_name(command.name)
        if command.input_schema is not None:
            from afd.core.schema_validation import check_schema

            check_schema(command.input_schema)
        normalized_confirmation_mode = validate_confirmation_mode(
            command.name, command.confirmation_mode
        )
        validate_task_declaration(
            command.name,
            command.task,
            confirm_prompt=command.confirm_prompt,
            approval=command.approval,
            confirmation_mode=normalized_confirmation_mode,
        )
        from afd.core.meta_keys import assert_advertised_input_schema, assert_tool_meta

        clean_tool_meta = assert_tool_meta(command.name, command.tool_meta)
        clean_advertised = assert_advertised_input_schema(
            command.name, command.advertised_input_schema
        )
        normalized_budget = validate_output_budget_declaration(command.name, command.output_budget)
        normalized_scopes = validate_command_scopes(command.name, command.scopes)
        if command.tool_meta is not None or command.advertised_input_schema is not None:
            command = replace(
                command,
                tool_meta=clean_tool_meta,
                advertised_input_schema=clean_advertised,
                output_budget=normalized_budget,
                scopes=normalized_scopes,
            )
        else:
            command.output_budget = normalized_budget
            command.scopes = normalized_scopes
        self._commands[command.name] = command

    def get(self, name: str) -> CommandDefinition | None:
        return self._commands.get(name)

    def has(self, name: str) -> bool:
        return name in self._commands

    def list(self) -> list[CommandDefinition]:
        return list(self._commands.values())

    def list_by_category(self, category: str) -> builtins.list[CommandDefinition]:
        return [cmd for cmd in self._commands.values() if cmd.category == category]

    def list_by_exposure(self, interface: str) -> builtins.list[CommandDefinition]:
        if interface not in _VALID_INTERFACES:
            return []
        return [cmd for cmd in self._commands.values() if is_exposed_to(cmd, interface)]

    def _execution_config(self) -> CommandExecutionConfig:
        return CommandExecutionConfig(
            lookup=self._commands.get,
            list_commands=self.list,
            middleware=self._middleware,
            dev_mode=self._dev_mode,
            call_grant=self._call_grant,
            context_defaults=self._context_defaults,
            logger=logger,
            suggest_tools=False,
            stamp_metadata=False,
        )

    async def execute(
        self,
        name: str,
        input: Any,
        context: CommandContext | None = None,
        *,
        output_budget: Any = None,
    ) -> CommandResult[Any]:
        result: CommandResult[Any] = await execute_command(
            name,
            input,
            context,
            config=self._execution_config(),
            output_budget=output_budget,
        )
        return result

    async def execute_batch(
        self,
        request: Any,
        context: CommandContext | None = None,
    ) -> BatchResult[Any]:
        return await _execute_core_batch(
            request,
            self.execute,
            context,
            ExecutorOptions(
                dev_mode=self._dev_mode,
                max_batch_size=self._max_batch_size,
                max_batch_parallelism=self._max_batch_parallelism,
            ),
        )

    def execute_stream(
        self,
        name: str,
        input: Any,
        options: StreamOptions | None = None,
        context: CommandContext | None = None,
    ) -> AsyncGenerator[StreamChunk, None]:
        timeout = options.timeout if options is not None else None
        return _execute_core_stream(
            name,
            input,
            self.execute,
            context,
            StreamExecutorOptions(dev_mode=self._dev_mode, timeout=timeout),
        )


def create_command_registry(
    options: CommandRegistryOptions | None = None,
    *,
    dev_mode: bool | None = None,
    call_grant: CallGrant | None = None,
    max_batch_size: int | None = None,
    max_batch_parallelism: int | None = None,
    middleware: Sequence[CommandMiddleware] | None = None,
    clock: Clock | None = None,
    random: RandomSource | None = None,
) -> CommandRegistry:
    """Create a new command registry.

    ``execute``, ``execute_batch`` and ``execute_stream`` share one execution
    path through the core executors, matching TypeScript's
    ``createCommandRegistry``.

    Args:
        options: Optional :class:`CommandRegistryOptions`. Keyword arguments
            override fields on ``options``.
        dev_mode: Return a raising handler's exception text in its
            COMMAND_EXECUTION_ERROR result. When False (the default), the
            message is "An internal error occurred" and the exception is only
            logged to the ``afd.core`` logger, as in the MCP server.
        call_grant: Host predicate ``(command_name, context) -> bool`` for
            app-to-app calls (``context.extra["interface"] == "apps"``). When
            omitted, every ``apps`` call is refused with ``CALL_NOT_GRANTED``.
        max_batch_size: Maximum commands accepted in one batch (default: 500).
        max_batch_parallelism: Maximum batch parallelism (default: 16).
        middleware: Optional middleware chain wrapping each executed handler.
        clock: Default clock for handlers when the call context has none.
        random: Default random source for handlers when the call context has none.

    Returns:
        A CommandRegistry instance for registering and executing commands.
    """
    opts = options or CommandRegistryOptions()
    return _CommandRegistryImpl(
        dev_mode=opts.dev_mode if dev_mode is None else dev_mode,
        call_grant=opts.call_grant if call_grant is None else call_grant,
        max_batch_size=opts.max_batch_size if max_batch_size is None else max_batch_size,
        max_batch_parallelism=(
            opts.max_batch_parallelism if max_batch_parallelism is None else max_batch_parallelism
        ),
        middleware=opts.middleware if middleware is None else middleware,
        clock=opts.clock if clock is None else clock,
        random=opts.random if random is None else random,
    )


def is_mcp_exposed(command: CommandDefinition) -> bool:
    """Whether ``command`` is exposed on the ``mcp`` interface."""
    return is_exposed_to(command, "mcp")


def commands_to_mcp_tools(commands: Sequence[CommandDefinition]) -> list[dict[str, Any]]:
    """Convert MCP-exposed commands to MCP tool definitions."""
    return [command_to_mcp_tool(cmd) for cmd in commands if is_mcp_exposed(cmd)]


def validate_command_name(name: str) -> dict[str, Any]:
    """Validate command naming against the shared `domain-action` contract."""

    if not name:
        return {"valid": False, "reason": "Command name must not be empty"}
    if not COMMAND_NAME_PATTERN.fullmatch(name):
        return {
            "valid": False,
            "reason": (
                f"Command name '{name}' must use kebab-case with at least two "
                "segments (e.g., 'domain-action')."
            ),
        }
    return {"valid": True}


def warn_invalid_command_name(name: str, *, stacklevel: int = 2) -> bool:
    """Warn when ``name`` breaks the ``domain-action`` naming rule.

    The rule is advisory, as in TypeScript's ``defineCommand``: the command
    still registers. ``define_command`` (and so ``MCPServer.command`` and
    ``MCPServer.register``) and the core ``CommandRegistry.register`` call
    this, once per command. ``afd.direct.SimpleRegistry`` does not.

    Returns:
        True when the name is valid.
    """
    check = validate_command_name(name)
    if not check["valid"]:
        warnings.warn(f"[AFD] {check['reason']}", UserWarning, stacklevel=stacklevel + 1)
        return False
    return True


def command_to_mcp_tool(command: CommandDefinition) -> dict[str, Any]:
    """Convert a CommandDefinition to MCP tool format.

    This is used by the server module to expose commands as MCP tools.

    Args:
        command: The command definition.

    Returns:
        A dict in MCP tool format with name, description, and inputSchema.

    Example:
        >>> tool = command_to_mcp_tool(my_command)
        >>> tool["name"]
        'my-command'
    """
    if command.advertised_input_schema is not None:
        input_schema = copy.deepcopy(command.advertised_input_schema)
    elif command.input_schema is not None:
        input_schema = copy.deepcopy(command.input_schema)
    else:
        properties: dict[str, dict[str, Any]] = {}
        required: list[str] = []

        for param in command.parameters:
            prop: dict[str, Any] = dict(param.schema or {})
            prop.setdefault("type", param.type)
            prop.setdefault("description", param.description)
            if param.default is not None and "default" not in prop:
                prop["default"] = param.default
            if param.enum is not None and "enum" not in prop:
                prop["enum"] = param.enum
            properties[param.name] = prop

            if param.required:
                required.append(param.name)

        input_schema = {
            "type": "object",
            "properties": properties,
            "required": required,
        }

    tool: dict[str, Any] = {"name": command.name}
    # Display label only (spec/command-metadata.md, "Tool titles"); none when unset.
    if command.title is not None:
        tool["title"] = command.title
    tool["description"] = command.description
    tool["inputSchema"] = input_schema
    annotations = command_tool_annotations(command)
    if annotations:
        tool["annotations"] = annotations

    # Extra tool _meta entries (spec/mcp-resources.md, T1) go before the server's own fields so
    # they can never replace one; the key rule already forbids reserved and unprefixed keys.
    meta: dict[str, Any] = (
        {key: copy.deepcopy(val) for key, val in command.tool_meta.items()}
        if command.tool_meta
        else {}
    )
    # spec/command-metadata.md: tools/list _meta leads with the category, as TypeScript's does.
    if command.category is not None:
        meta["category"] = command.category
    meta["mutation"] = command.mutation
    # Planning signals only: title and confirm_prompt are display text and stay out of _meta.
    if command.destructive is not None:
        meta["destructive"] = command.destructive
    if command.undoable is not None:
        meta["undoable"] = command.undoable
    approval = approval_mode(command.approval)
    if approval is not None:
        meta["approval"] = approval
    if command.confirmation_mode is not None:
        meta["confirmationMode"] = command.confirmation_mode
    if command.requires:
        meta["requires"] = list(command.requires)
    if command.examples:
        meta["examples"] = serialize_command_examples(command.examples)
    if command.returns:
        meta["outputSchema"] = command.returns
    if command.contexts:
        meta["contexts"] = list(command.contexts)
    if command.scopes:
        meta["scopes"] = list(command.scopes)
    if command.task is not None:
        meta["task"] = command.task
    if command.output_budget is not None:
        budget = validate_output_budget_declaration(command.name, command.output_budget)
        if budget is not None:
            meta[AFD_OUTPUT_BUDGET_META_KEY] = budget.to_wire_dict()

    if meta:
        tool["_meta"] = meta

    return tool


def command_tool_annotations(command: CommandDefinition) -> dict[str, bool] | None:
    """MCP tool annotations for a command (``spec/command-metadata.md``, "Annotations").

    Only what the command declares is reported. ``mutation`` has no unset state in
    Python, so a mutation gives ``readOnlyHint: False`` and ``destructiveHint`` from
    ``destructive`` (``False`` when unset), and anything else gives ``None``.
    """
    if command.mutation:
        return {"readOnlyHint": False, "destructiveHint": bool(command.destructive)}
    return None


# Keywords of the schema subset (spec/validation.md) whose value is a schema, an array of
# schemas, or a map from names to schemas.
_SCHEMA_KEYWORDS = frozenset(
    {
        "items",
        "additionalProperties",
        "not",
        "if",
        "then",
        "else",
        "contains",
        "propertyNames",
        "additionalItems",
        "unevaluatedItems",
        "unevaluatedProperties",
    }
)
_SCHEMA_LIST_KEYWORDS = frozenset({"allOf", "anyOf", "oneOf", "prefixItems", "items"})
# `dependencies` (draft-07) maps a name to a schema or to a list of property names; only a
# schema is walked.
_SCHEMA_MAP_KEYWORDS = frozenset(
    {"properties", "patternProperties", "$defs", "definitions", "dependentSchemas", "dependencies"}
)


def _retarget_root(schema: Any, target: str, root: bool = True) -> Any:
    """A copy of ``schema`` in which every ``"$ref": "#"`` naming its root, outside any nested
    schema resource, names ``target``. Values and annotations (``const``, ``enum``,
    ``default``, ``examples``) are left as they are."""
    if not isinstance(schema, dict) or (not root and starts_resource(schema)):
        return schema
    out: dict[str, Any] = {}
    for key, value in schema.items():
        if key == "$ref" and value == "#":
            out[key] = target
        elif key in _SCHEMA_LIST_KEYWORDS and isinstance(value, list):
            out[key] = [_retarget_root(item, target, False) for item in value]
        elif key in _SCHEMA_KEYWORDS:
            out[key] = _retarget_root(value, target, False)
        elif key in _SCHEMA_MAP_KEYWORDS and isinstance(value, dict):
            out[key] = {name: _retarget_root(item, target, False) for name, item in value.items()}
        else:
            out[key] = value
    return out


def command_result_output_schema(data_schema: dict[str, Any]) -> dict[str, Any]:
    """The MCP ``outputSchema`` of a command tool: the CommandResult envelope, with
    ``data`` typed by ``data_schema`` (``spec/command-metadata.md``, "Structured results").

    When ``data`` starts a schema resource (a string ``$id`` that is not a bare fragment, the
    validators' test), its local references resolve against it, so its definitions stay
    inside it. Otherwise its definitions move to the envelope, and a ``"$ref": "#"`` that
    named ``data`` becomes ``"#/properties/data"``, since ``#`` now names the envelope. The
    wire format omits a model field set to ``None``, so a property that accepts ``null`` is
    not listed as required."""
    data = _optional_nullable_properties(data_schema)
    data.pop("$schema", None)
    resource = starts_resource(data)
    if not resource:
        data = _retarget_root(data, "#/properties/data")
    envelope: dict[str, Any] = {
        "type": "object",
        "properties": {
            "success": {"type": "boolean"},
            "data": data,
            "error": {
                "type": "object",
                "properties": {
                    "code": {"type": "string"},
                    "message": {"type": "string"},
                    "suggestion": {"type": "string"},
                    "retryable": {"type": "boolean"},
                },
                "required": ["code", "message"],
            },
            "metadata": {"type": "object"},
        },
        "required": ["success"],
    }
    if not resource:
        for key in ("$defs", "definitions"):
            if key in data:
                envelope[key] = data.pop(key)
    return envelope


def _local_pointer(root: dict[str, Any], ref: str) -> Any:
    """The value a local JSON Pointer reference (``#`` or ``#/...``) names, or None."""
    if ref == "#":
        return root
    if not ref.startswith("#/"):
        return None
    target: Any = root
    for token in ref[2:].split("/"):
        token = token.replace("~1", "/").replace("~0", "~")
        if isinstance(target, dict) and token in target:
            target = target[token]
        elif (
            isinstance(target, list)
            and token.isascii()
            and token.isdigit()
            and int(token) < len(target)
        ):
            target = target[int(token)]
        else:
            return None
    return target


def _accepts_null(schema: Any, root: dict[str, Any], seen: frozenset[int] = frozenset()) -> bool:
    """Whether ``schema`` admits ``null``: a ``null`` type, enum value or const, a schema
    that constrains nothing (``{}``, as for ``Any``), a nullable ``anyOf``/``oneOf`` branch,
    or a local ``$ref`` to one of those."""
    if schema is True:
        return True
    if not isinstance(schema, dict):
        return False
    # A local `$ref` resolves against the nearest schema resource (spec/validation.md).
    if starts_resource(schema):
        root = schema
    ref = schema.get("$ref")
    if isinstance(ref, str):
        # Output schemas are not checked against the `$ref` subset, so any local pointer is
        # followed, its tokens decoded (`~1` is "/", `~0` is "~").
        target: Any = _local_pointer(root, ref)
        # Visited by target, since the same reference text names a target in each resource.
        if (
            target is not None
            and id(target) not in seen
            and _accepts_null(target, root, seen | {id(target)})
        ):
            return True
    kind = schema.get("type")
    if kind == "null" or (isinstance(kind, list) and "null" in kind):
        return True
    if None in (schema.get("enum") or []) or ("const" in schema and schema["const"] is None):
        return True
    branches = [*(schema.get("anyOf") or []), *(schema.get("oneOf") or [])]
    if any(_accepts_null(branch, root, seen) for branch in branches):
        return True
    constraining = {"type", "enum", "const", "$ref", "anyOf", "oneOf", "allOf", "not"}
    return not constraining & schema.keys()


def _optional_nullable_properties(node: Any, root: dict[str, Any] | None = None) -> Any:
    """A copy of a schema whose objects no longer require a property that accepts ``null``.

    Only schema positions are walked: a value (``const``, ``enum``, ``default``, ``examples``)
    is data, left as it is."""
    if not isinstance(node, dict):
        return node
    if root is None or starts_resource(node):
        root = node
    out: dict[str, Any] = {}
    for key, value in node.items():
        if key in _SCHEMA_LIST_KEYWORDS and isinstance(value, list):
            out[key] = [_optional_nullable_properties(item, root) for item in value]
        elif key in _SCHEMA_KEYWORDS:
            out[key] = _optional_nullable_properties(value, root)
        elif key in _SCHEMA_MAP_KEYWORDS and isinstance(value, dict):
            out[key] = {
                name: _optional_nullable_properties(item, root) for name, item in value.items()
            }
        else:
            out[key] = value
    properties, required = node.get("properties"), node.get("required")
    if isinstance(properties, dict) and isinstance(required, list):
        out["required"] = [
            name for name in required if not _accepts_null(properties.get(name), root)
        ]
        if not out["required"]:
            del out["required"]
    return out


def serialize_command_examples(examples: list[CommandExample]) -> list[dict[str, Any]]:
    """Convert normalized examples to JSON-serializable dictionaries."""
    return [
        {
            **({"title": example.title} if example.title else {}),
            **({"description": example.description} if example.description else {}),
            "input": example.input,
        }
        for example in examples
    ]
