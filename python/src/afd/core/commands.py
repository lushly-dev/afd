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
from dataclasses import dataclass, field
import logging
import re
import warnings
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

from afd.core.actor import Actor, with_context_defaults
from afd.core.approval import ApprovalPolicy, approval_mode
from afd.core.clock import Clock, RandomSource
from afd.core.result import CommandResult, execution_failure
from afd.core.schema_registration import starts_resource

logger = logging.getLogger("afd.core")

COMMAND_NAME_PATTERN = re.compile(r"^[a-z][a-z0-9]*(-[a-z][a-z0-9]*)+$")

TaskSupport = Literal["never", "optional", "required"]
"""Whether an MCP ``tools/call`` to a command may run as a task (``spec/command-metadata.md``, "Tasks")."""

_VALID_TASK_SUPPORTS = frozenset({"never", "optional", "required"})


def validate_task_declaration(
    name: str,
    task: Optional[TaskSupport],
    *,
    confirm_prompt: Optional[str] = None,
    approval: Optional[ApprovalPolicy] = None,
    confirmation_mode: Optional[str] = None,
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

_VALID_INTERFACES = frozenset({"palette", "mcp", "agent", "cli"})

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

    trace_id: Optional[str] = None
    timeout: Optional[int] = None
    extra: Dict[str, Any] = field(default_factory=dict)
    actor: Optional[Actor] = None
    clock: Optional[Clock] = None
    random: Optional[RandomSource] = None
    approval: Optional[str] = None
    report_progress: Optional[Callable[[str], None]] = None
    cancel: Optional[asyncio.Event] = None
    credentials: Optional[Any] = None
    _direct_approval: Any = field(default=None, repr=False, compare=False)
    _direct_allow: Any = field(default=None, repr=False, compare=False)


# Type alias for command handler functions
CommandHandler = Callable[
    [Any, Optional[CommandContext]],
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
    destructive: Optional[bool] = None
    confirm_prompt: Optional[str] = None
    undoable: Optional[bool] = None
    approval: Optional[ApprovalPolicy] = None
    title: Optional[str] = None
    task: Optional[TaskSupport] = None


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
        # define_command already warned about a decorated handler's own name.
        decorated = getattr(command.handler, "__afd_command__", None)
        if getattr(decorated, "name", None) != command.name:
            warn_invalid_command_name(command.name)
        if command.input_schema is not None:
            from afd.core.schema_validation import check_schema

            check_schema(command.input_schema)
        validate_task_declaration(
            command.name,
            command.task,
            confirm_prompt=command.confirm_prompt,
            approval=command.approval,
            confirmation_mode=getattr(command, "confirmation_mode", None),
        )
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
        from afd.core.direct_allow import _is_allowed, _not_allowed
        from afd.core.result import failure

        if not _is_allowed(context, name):
            return failure(_not_allowed(name))
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

        # Check exposure if interface context is provided. An empty interface is
        # no interface, and an unknown one exposes nothing, as in TypeScript's
        # isExposedTo (spec/error-codes.md, D4).
        interface = context.extra.get("interface") if context else None
        if interface is not None and interface != "":
            known = isinstance(interface, str) and interface in _VALID_INTERFACES
            expose = command.expose if command.expose is not None else DEFAULT_EXPOSE
            if not known or not getattr(expose, interface, False):
                return CommandResult(
                    success=False,
                    error=CmdError(
                        code="COMMAND_NOT_EXPOSED",
                        message=f"Command '{name}' is not exposed to {interface}",
                        suggestion=(
                            "Call it from an interface it is exposed to, or set "
                            f"expose.{interface} to true in its definition"
                            if known
                            else "Use one of the interfaces "
                            + ", ".join(sorted(_VALID_INTERFACES))
                        ),
                        retryable=False,
                    ),
                )

        if context and "active_context" in context.extra:
            active_context = context.extra["active_context"]
            if active_context and command.contexts and active_context not in command.contexts:
                # The core registry has no afd-context-* tools, so name the
                # command's own contexts (spec/error-codes.md, D4).
                contexts = ", ".join(f"'{c}'" for c in command.contexts)
                return CommandResult(
                    success=False,
                    error=CmdError(
                        code="COMMAND_NOT_IN_CONTEXT",
                        message=(
                            f"Command '{name}' is not available in context "
                            f"'{active_context}'"
                        ),
                        suggestion=(
                            f"Switch to a context this command belongs to ({contexts}), "
                            "or call it with no active context."
                        ),
                    ),
                )

        # Decorated handlers already own advertised-schema validation and
        # native model conversion. Raw definitions need the same boundary here.
        if command.input_schema is not None and not hasattr(command.handler, "__afd_command__"):
            from afd.core.schema_validation import SchemaValidationError, schema_validation_failure, validate_schema

            try:
                input = validate_schema(command.input_schema, {} if input is None else input)
            except SchemaValidationError as exc:
                return schema_validation_failure(exc)
            except Exception as exc:
                logger.error("Input validation for '%s' raised", name, exc_info=exc)
                return CommandResult(success=False, error=CmdError(
                    code="VALIDATION_ERROR",
                    message="Input validation failed",
                    suggestion="Check the input against the command's registered schema and retry",
                ))

        try:
            # Handlers always get a context with a clock and a random source.
            result = await command.handler(input, with_context_defaults(context))
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

    tool: Dict[str, Any] = {"name": command.name}
    # Display label only (spec/command-metadata.md, "Tool titles"); none when unset.
    if command.title is not None:
        tool["title"] = command.title
    tool["description"] = command.description
    tool["inputSchema"] = input_schema
    annotations = command_tool_annotations(command)
    if annotations:
        tool["annotations"] = annotations

    # spec/command-metadata.md: tools/list _meta leads with the category, as TypeScript's does.
    meta: Dict[str, Any] = {} if command.category is None else {"category": command.category}
    meta["mutation"] = command.mutation
    # Planning signals only: title and confirm_prompt are display text and stay out of _meta.
    if command.destructive is not None:
        meta["destructive"] = command.destructive
    if command.undoable is not None:
        meta["undoable"] = command.undoable
    approval = approval_mode(command.approval)
    if approval is not None:
        meta["approval"] = approval
    if command.requires:
        meta["requires"] = list(command.requires)
    if command.examples:
        meta["examples"] = serialize_command_examples(command.examples)
    if command.returns:
        meta["outputSchema"] = command.returns
    if command.contexts:
        meta["contexts"] = list(command.contexts)
    if command.task is not None:
        meta["task"] = command.task

    if meta:
        tool["_meta"] = meta

    return tool


def command_tool_annotations(command: CommandDefinition) -> Optional[Dict[str, bool]]:
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
    out: Dict[str, Any] = {}
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


def command_result_output_schema(data_schema: Dict[str, Any]) -> Dict[str, Any]:
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
    envelope: Dict[str, Any] = {
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


def _local_pointer(root: Dict[str, Any], ref: str) -> Any:
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


def _accepts_null(schema: Any, root: Dict[str, Any], seen: frozenset = frozenset()) -> bool:
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
        if target is not None and id(target) not in seen and _accepts_null(
            target, root, seen | {id(target)}
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


def _optional_nullable_properties(node: Any, root: Optional[Dict[str, Any]] = None) -> Any:
    """A copy of a schema whose objects no longer require a property that accepts ``null``.

    Only schema positions are walked: a value (``const``, ``enum``, ``default``, ``examples``)
    is data, left as it is."""
    if not isinstance(node, dict):
        return node
    if root is None or starts_resource(node):
        root = node
    out: Dict[str, Any] = {}
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
