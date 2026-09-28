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

from dataclasses import dataclass, field
import logging
import re
from typing import (
    Any,
    Awaitable,
    Callable,
    Dict,
    List,
    Literal,
    Optional,
    Protocol,
    TypeVar,
)

from afd.core.result import CommandResult, execution_failure

logger = logging.getLogger("afd.core")

COMMAND_NAME_PATTERN = re.compile(r"^[a-z][a-z0-9]*(-[a-z][a-z0-9]*)+$")


@dataclass(frozen=True)
class ExposeOptions:
    """Controls which interfaces a command is exposed to.

    Security-first defaults: palette and agent are on by default,
    MCP and CLI are opt-in.

    Attributes:
        palette: Expose to command palette (default: True).
        mcp: Expose to external MCP agents (default: False -- opt-in for security).
        agent: Expose to in-app AI assistant (default: True).
        cli: Expose to terminal/CLI (default: False).
    """

    palette: bool = True
    mcp: bool = False
    agent: bool = True
    cli: bool = False


DEFAULT_EXPOSE = ExposeOptions()
"""Default exposure options. Frozen dataclass prevents accidental mutation."""

TInput = TypeVar("TInput")
TOutput = TypeVar("TOutput")
JsonSchema = Dict[str, Any]


@dataclass(frozen=True)
class CommandExample:
    """Normalized command example for docs and MCP metadata.

    Attributes:
        input: Example input payload.
        title: Optional short label for the example.
        description: Optional longer explanation for the example.
    """

    input: Dict[str, Any]
    title: Optional[str] = None
    description: Optional[str] = None


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
    default: Optional[Any] = None
    enum: Optional[List[Any]] = None
    schema: Optional[JsonSchema] = None


@dataclass
class CommandContext:
    """Context provided to command handlers.
    
    Attributes:
        trace_id: Unique ID for this command invocation.
        timeout: Timeout in milliseconds.
        extra: Additional custom context values.
    """

    trace_id: Optional[str] = None
    timeout: Optional[int] = None
    extra: Dict[str, Any] = field(default_factory=dict)


# Type alias for command handler functions
CommandHandler = Callable[
    [Any, Optional[CommandContext]],
    Awaitable[CommandResult[Any]],
]


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
    category: Optional[str] = None
    parameters: List[CommandParameter] = field(default_factory=list)
    input_schema: Optional[JsonSchema] = None
    returns_description: Optional[str] = None
    returns: Optional[JsonSchema] = None
    errors: Optional[List[str]] = None
    version: Optional[str] = None
    tags: Optional[List[str]] = None
    mutation: bool = False
    execution_time: Optional[Literal["instant", "fast", "slow", "long-running"]] = None
    examples: List[CommandExample] = field(default_factory=list)
    requires: List[str] = field(default_factory=list)
    contexts: List[str] = field(default_factory=list)
    handoff: bool = False
    handoff_protocol: Optional[str] = None
    expose: Optional[ExposeOptions] = None


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

    def get(self, name: str) -> Optional[CommandDefinition]:
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

    def list(self) -> List[CommandDefinition]:
        """Get all registered commands.
        
        Returns:
            List of all command definitions.
        """
        ...

    def list_by_category(self, category: str) -> List[CommandDefinition]:
        """Get commands by category.
        
        Args:
            category: The category to filter by.
            
        Returns:
            List of commands in the category.
        """
        ...

    async def execute(
        self,
        name: str,
        input: Any,
        context: Optional[CommandContext] = None,
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


class _CommandRegistryImpl:
    """Default command registry implementation."""

    def __init__(self, *, dev_mode: bool = False) -> None:
        self._commands: Dict[str, CommandDefinition] = {}
        self._dev_mode = dev_mode

    def register(self, command: CommandDefinition) -> None:
        if command.name in self._commands:
            raise ValueError(f"Command '{command.name}' is already registered")
        self._commands[command.name] = command

    def get(self, name: str) -> Optional[CommandDefinition]:
        return self._commands.get(name)

    def has(self, name: str) -> bool:
        return name in self._commands

    def list(self) -> List[CommandDefinition]:
        return list(self._commands.values())

    def list_by_category(self, category: str) -> List[CommandDefinition]:
        return [cmd for cmd in self._commands.values() if cmd.category == category]

    async def execute(
        self,
        name: str,
        input: Any,
        context: Optional[CommandContext] = None,
    ) -> CommandResult[Any]:
        command = self._commands.get(name)
        from afd.core.result import CommandError as CmdError

        if not command:
            return CommandResult(
                success=False,
                error=CmdError(
                    code="COMMAND_NOT_FOUND",
                    message=f"Command '{name}' not found",
                    suggestion="List available commands to see valid options",
                ),
            )

        # Check exposure if interface context is provided
        if context and "interface" in context.extra:
            interface = context.extra["interface"]
            _VALID_INTERFACES = frozenset({"palette", "mcp", "agent", "cli"})
            if not isinstance(interface, str) or not interface:
                return CommandResult(
                    success=False,
                    error=CmdError(
                        code="INVALID_INTERFACE",
                        message=f"Unknown interface '{interface}'",
                        suggestion=f"Valid interfaces: {', '.join(sorted(_VALID_INTERFACES))}",
                    ),
                )
            if interface not in _VALID_INTERFACES:
                return CommandResult(
                    success=False,
                    error=CmdError(
                        code="INVALID_INTERFACE",
                        message=f"Unknown interface '{interface}'",
                        suggestion=f"Valid interfaces: {', '.join(sorted(_VALID_INTERFACES))}",
                    ),
                )
            expose = command.expose if command.expose is not None else DEFAULT_EXPOSE
            if not getattr(expose, interface, False):
                return CommandResult(
                    success=False,
                    error=CmdError(
                        code="COMMAND_NOT_EXPOSED",
                        message=f"Command '{name}' is not exposed to {interface}",
                        suggestion="Check command exposure settings or use a different interface",
                    ),
                )

        if context and "active_context" in context.extra:
            active_context = context.extra["active_context"]
            if active_context and command.contexts and active_context not in command.contexts:
                return CommandResult(
                    success=False,
                    error=CmdError(
                        code="COMMAND_NOT_IN_CONTEXT",
                        message=(
                            f"Command '{name}' is not available in context "
                            f"'{active_context}'"
                        ),
                        suggestion=(
                            "Use afd-context-list to inspect available contexts or "
                            "afd-context-enter to switch."
                        ),
                    ),
                )

        try:
            result = await command.handler(input, context)
            return result
        except Exception as exc:
            logger.error("Command '%s' raised an unhandled exception", name, exc_info=exc)
            return execution_failure(exc, self._dev_mode)


def create_command_registry(*, dev_mode: bool = False) -> CommandRegistry:
    """Create a new command registry.

    Args:
        dev_mode: Return a raising handler's exception text in its
            COMMAND_EXECUTION_ERROR result. When False (the default), the
            message is "An internal error occurred" and the exception is only
            logged to the ``afd.core`` logger, as in the MCP server.

    Returns:
        A CommandRegistry instance for registering and executing commands.
    
    Example:
        >>> registry = create_command_registry()
        >>> registry.register(my_command)
        >>> result = await registry.execute("my-command", {"arg": "value"})
    """
    return _CommandRegistryImpl(dev_mode=dev_mode)


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
    if command.input_schema is not None:
        input_schema = command.input_schema
    else:
        properties: Dict[str, Dict[str, Any]] = {}
        required: List[str] = []

        for param in command.parameters:
            prop: Dict[str, Any] = dict(param.schema or {})
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

    tool = {
        "name": command.name,
        "description": command.description,
        "inputSchema": input_schema,
    }

    meta: Dict[str, Any] = {"mutation": command.mutation}
    if command.requires:
        meta["requires"] = list(command.requires)
    if command.examples:
        meta["examples"] = serialize_command_examples(command.examples)
    if command.returns:
        meta["outputSchema"] = command.returns
    if command.contexts:
        meta["contexts"] = list(command.contexts)

    if meta:
        tool["_meta"] = meta

    return tool


def serialize_command_examples(examples: List[CommandExample]) -> List[Dict[str, Any]]:
    """Convert normalized examples to JSON-serializable dictionaries."""
    return [
        {
            **({"title": example.title} if example.title else {}),
            **({"description": example.description} if example.description else {}),
            "input": example.input,
        }
        for example in examples
    ]
