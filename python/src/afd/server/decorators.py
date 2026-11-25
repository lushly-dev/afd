"""Command decorator for type-safe command definition.

The @define_command decorator provides a clean way to define commands
with full type safety and automatic schema generation.

Example:
    >>> from afd.server import define_command
    >>> from afd import success
    >>> from pydantic import BaseModel
    >>>
    >>> class GreetInput(BaseModel):
    ...     name: str
    ...
    >>> class GreetOutput(BaseModel):
    ...     message: str
    >>>
    >>> @define_command(
    ...     name="greet",
    ...     description="Greet someone",
    ...     input_schema=GreetInput,
    ...     output_schema=GreetOutput,
    ... )
    ... async def greet(input: GreetInput) -> GreetOutput:
    ...     return success(GreetOutput(message=f"Hello, {input.name}!"))
"""

import inspect
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from functools import wraps
from typing import (
    Any,
    Literal,
    TypeVar,
)

from pydantic import BaseModel
from pydantic import ValidationError as PydanticValidationError

from afd.core.approval import ApprovalPolicy
from afd.core.commands import (
    CommandConfirmationMode,
    CommandDefinition,
    CommandExample,
    CommandParameter,
    ExposeOptions,
    TaskSupport,
    validate_command_scopes,
    validate_confirmation_mode,
    validate_task_declaration,
    warn_invalid_command_name,
)
from afd.core.meta_keys import assert_advertised_input_schema, assert_tool_meta
from afd.core.output_budget import OutputBudget, validate_output_budget_declaration
from afd.core.result import CommandResult
from afd.core.schema_validation import SchemaValidationError, check_schema, validate_schema
from afd.server.validation import _input_validation_failure

TInput = TypeVar("TInput", bound=BaseModel)
TOutput = TypeVar("TOutput")
ExampleInput = CommandExample | dict[str, Any]


@dataclass
class CommandMetadata:
    """Metadata for a decorated command.

    Attributes:
        name: Command name (e.g., "item-create").
        description: Human-readable description.
        input_schema: Pydantic model for input validation.
        output_schema: Pydantic model for output (optional).
        tags: Tags for categorization.
        mutation: Whether this command modifies state.
        examples: Example inputs for documentation.
    """

    name: str
    description: str
    category: str | None = None
    input_schema: type[BaseModel] | dict[str, Any] | None = None
    output_schema: type[BaseModel] | None = None
    tags: list[str] = field(default_factory=list)
    mutation: bool = False
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
    version: str | None = None
    title: str | None = None
    errors: list[str] | None = None
    execution_time: Literal["instant", "fast", "slow", "long-running"] | None = None
    task: TaskSupport | None = None
    tool_meta: dict[str, Any] | None = None
    advertised_input_schema: dict[str, Any] | None = None
    output_budget: OutputBudget | None = None
    scopes: list[str] = field(default_factory=list)
    confirmation_mode: CommandConfirmationMode | None = None


def define_command(
    name: str,
    description: str,
    category: str | None = None,
    input_schema: type[BaseModel] | dict[str, Any] | None = None,
    output_schema: type[BaseModel] | None = None,
    tags: list[str] | None = None,
    mutation: bool = False,
    examples: list[ExampleInput] | None = None,
    requires: list[str] | None = None,
    contexts: list[str] | None = None,
    handoff: bool = False,
    handoff_protocol: str | None = None,
    expose: ExposeOptions | None = None,
    destructive: bool | None = None,
    confirm_prompt: str | None = None,
    undoable: bool | None = None,
    approval: ApprovalPolicy | None = None,
    version: str | None = None,
    title: str | None = None,
    errors: list[str] | None = None,
    execution_time: Literal["instant", "fast", "slow", "long-running"] | None = None,
    task: TaskSupport | None = None,
    tool_meta: dict[str, Any] | None = None,
    advertised_input_schema: dict[str, Any] | None = None,
    output_budget: OutputBudget | dict[str, Any] | None = None,
    scopes: Sequence[str] | None = None,
    confirmation_mode: CommandConfirmationMode | None = None,
    _stacklevel: int = 2,
) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
    """Decorator to define a command with metadata.

    The decorated function becomes a command handler that can be registered
    with an MCP server. The decorator attaches metadata for schema generation.

    Args:
        name: Command name in `domain-action` kebab-case (e.g., "item-create"). Any other name still registers, with a UserWarning.
        description: Human-readable description of what the command does.
        input_schema: Pydantic model class for validating input.
        output_schema: Pydantic model class for the output (optional).
        tags: Tags for categorization and filtering.
        mutation: Whether this command modifies state (default False).
        examples: Example inputs for documentation.
        requires: Related prerequisite commands (metadata only).
        contexts: Context names that scope this command.
        expose: Controls which interfaces this command is exposed to.
        destructive: Whether the command's effects are hard to reverse (unset by default).
        confirm_prompt: The question to ask before running the command. A server may
            enforce it (``spec/command-metadata.md``, "Confirmations").
        undoable: Whether the command's effects can be undone (unset by default).
        approval: Whether a call needs a human's approval before the handler runs:
            ``"required"``, ``"not-required"`` or a function of the validated input and
            context. Decided by ``create_approval_middleware``; without an approval step
            that admitted the call, ``create_server`` and ``create_direct_registry`` refuse
            any policy other than ``"not-required"`` with ``APPROVAL_UNAVAILABLE``.
            Reported as ``_meta.approval`` (``"conditional"`` for a function).
        version: The command's version, reported by ``afd-detail`` and recorded as
            ``metadata.commandVersion`` on its results (and so in journal entries).
        title: A short human-readable label, reported as the MCP tool ``title`` of the
            command's own tool, by ``afd-detail`` and by ``afd-help`` (full). Never derived
            from the name.

    Returns:
        Decorator function that wraps the handler.

    Example:
        >>> @define_command(
        ...     name="user-create",
        ...     description="Create a new user",
        ...     input_schema=CreateUserInput,
        ...     output_schema=User,
        ...     mutation=True,
        ...     expose=ExposeOptions(mcp=True, cli=True),
        ... )
        ... async def create_user(input: CreateUserInput) -> User:
        ...     # Implementation
        ...     pass
    """

    # Advisory, as in TypeScript's defineCommand: the command still registers.
    warn_invalid_command_name(name, stacklevel=_stacklevel)
    if (
        approval is not None
        and approval not in ("required", "not-required")
        and not callable(approval)
    ):
        raise TypeError(
            f"Command '{name}' has an invalid approval policy: "
            "use 'required', 'not-required' or a function"
        )
    normalized_confirmation_mode = validate_confirmation_mode(name, confirmation_mode)
    validate_task_declaration(
        name,
        task,
        confirm_prompt=confirm_prompt,
        approval=approval,
        confirmation_mode=normalized_confirmation_mode,
    )
    checked_tool_meta = assert_tool_meta(name, tool_meta)
    checked_advertised = assert_advertised_input_schema(name, advertised_input_schema)
    normalized_output_budget = validate_output_budget_declaration(name, output_budget)
    normalized_scopes = validate_command_scopes(name, scopes)
    if input_schema is not None:
        check_schema(_advertised_schema(input_schema))

    def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
        # Build tags list, adding handoff tags if needed
        effective_tags = list(tags or [])
        if handoff and "handoff" not in effective_tags:
            effective_tags.append("handoff")
        if handoff_protocol and f"handoff:{handoff_protocol}" not in effective_tags:
            effective_tags.append(f"handoff:{handoff_protocol}")
        normalized_examples = _normalize_examples(examples or [], input_schema)
        # Inspect the signature once, not on every call.
        accepts_context = _accepts_context(func)

        # Attach metadata to the function
        cmd_metadata = CommandMetadata(
            name=name,
            description=description,
            category=category,
            input_schema=input_schema,
            output_schema=output_schema,
            tags=effective_tags,
            mutation=mutation,
            examples=normalized_examples,
            requires=list(requires or []),
            contexts=list(contexts or []),
            scopes=normalized_scopes,
            handoff=handoff,
            handoff_protocol=handoff_protocol,
            expose=expose,
            destructive=destructive,
            confirm_prompt=confirm_prompt,
            undoable=undoable,
            approval=approval,
            version=version,
            title=title,
            errors=list(errors) if errors is not None else None,
            execution_time=execution_time,
            task=task,
            tool_meta=checked_tool_meta,
            advertised_input_schema=checked_advertised,
            output_budget=normalized_output_budget,
            confirmation_mode=normalized_confirmation_mode,
        )
        func.__afd_command__ = cmd_metadata  # type: ignore[attr-defined]

        def _validate_decorated_input(raw_input: Any) -> tuple[bool, Any]:
            try:
                return True, validate_command_input(input_schema, raw_input)
            except (PydanticValidationError, SchemaValidationError) as exc:
                if input_schema is None:
                    raise
                return False, _input_validation_failure(
                    input_schema, {} if raw_input is None else raw_input, exc
                )

        @wraps(func)
        async def wrapper(raw_input: Any, context: Any | None = None) -> CommandResult[Any]:
            """Wrapper that validates input and calls the handler."""
            valid, validated_or_failure = _validate_decorated_input(raw_input)
            if not valid:
                failure_result: CommandResult[Any] = validated_or_failure
                return failure_result
            return await validated_handler(validated_or_failure, context)

        async def validated_handler(
            validated_input: Any, context: Any | None = None
        ) -> CommandResult[Any]:
            if accepts_context:
                result: CommandResult[Any] = await func(validated_input, context)
                return result
            result = await func(validated_input)
            return result

        if input_schema is not None:
            wrapper.__afd_validate_input__ = _validate_decorated_input  # type: ignore[attr-defined]
        wrapper.__afd_validated_handler__ = validated_handler  # type: ignore[attr-defined]
        # Copy metadata to wrapper
        wrapper.__afd_command__ = cmd_metadata  # type: ignore[attr-defined]

        return wrapper

    return decorator


def validate_command_input(
    input_schema: type[BaseModel] | dict[str, Any] | None,
    raw_input: Any,
    *,
    max_issues: int | None = None,
) -> Any:
    """The value a command's handler receives for ``raw_input``.

    Without a schema, ``raw_input`` unchanged. With one, an instance of the
    schema passes through as-is (it is already validated), and anything else
    is validated. ``None`` is validated as ``{}``, as Zod parses an omitted
    input as an empty object, so a schema with required fields fails with
    VALIDATION_ERROR instead of the handler receiving ``None``.

    Raises:
        pydantic.ValidationError: If the input does not match the schema.
    """
    if input_schema is None:
        return raw_input
    if not isinstance(input_schema, dict) and isinstance(raw_input, input_schema):
        return raw_input
    kwargs = {} if max_issues is None else {"max_issues": max_issues}
    data = validate_schema(
        _advertised_schema(input_schema), {} if raw_input is None else raw_input, **kwargs
    )
    if isinstance(input_schema, dict):
        return data
    # Schema defaults are already trusted. Leave absent fields absent for the
    # native parser so Pydantic uses its defaults without treating them as user
    # input (and validating an intentionally unvalidated default a second time).
    return input_schema.model_validate(_present_input(data, {} if raw_input is None else raw_input))


def _present_input(parsed: Any, raw: Any) -> Any:
    if isinstance(parsed, dict) and isinstance(raw, dict):
        return {key: _present_input(value, raw[key]) for key, value in parsed.items() if key in raw}
    if isinstance(parsed, list) and isinstance(raw, list):
        return [
            _present_input(value, original) for value, original in zip(parsed, raw, strict=True)
        ]
    return parsed


def _advertised_schema(input_schema: type[BaseModel] | dict[str, Any]) -> dict[str, Any]:
    if isinstance(input_schema, dict):
        return input_schema
    if not isinstance(input_schema, type) or not issubclass(input_schema, BaseModel):
        raise TypeError("input_schema must be a JSON Schema object or a Pydantic model class")
    return input_schema.model_json_schema()


def _accepts_context(func: Callable[..., Any]) -> bool:
    """Check if function accepts a context parameter."""
    try:
        params = list(inspect.signature(func).parameters)
    except (TypeError, ValueError):  # builtins and some callables have no signature
        return False
    return "context" in params or len(params) > 1


def has_command_metadata(func: Callable[..., Any]) -> bool:
    """Check if a function has command metadata attached."""
    return hasattr(func, "__afd_command__")


def get_command_metadata(func: Callable[..., Any]) -> CommandMetadata | None:
    """Get command metadata from a decorated function."""
    return getattr(func, "__afd_command__", None)


def command_to_definition(func: Callable[..., Any]) -> CommandDefinition | None:
    """Convert a decorated function to a CommandDefinition.

    Args:
        func: Function decorated with @define_command.

    Returns:
        CommandDefinition if the function has metadata, None otherwise.
    """
    metadata = get_command_metadata(func)
    if not metadata:
        return None

    # Generate parameters from the advertised schema when given, else the validation schema (V1).
    parameters = []
    param_source = (
        metadata.advertised_input_schema
        if metadata.advertised_input_schema is not None
        else (
            _advertised_schema(metadata.input_schema) if metadata.input_schema is not None else None
        )
    )
    if param_source:
        raw_properties = param_source.get("properties")
        properties = raw_properties if isinstance(raw_properties, dict) else {}
        raw_required = param_source.get("required")
        required = set(raw_required) if isinstance(raw_required, list) else set()

        for prop_name, prop_schema in properties.items():
            if isinstance(prop_schema, bool):
                parameters.append(
                    CommandParameter(
                        name=prop_name,
                        type="any" if prop_schema else "never",  # type: ignore[arg-type]
                        description=f"Parameter {prop_name}",
                        required=prop_name in required,
                    )
                )
                continue
            if not isinstance(prop_schema, dict):
                continue
            raw_type = prop_schema.get("type", "string")
            if isinstance(raw_type, list):
                json_type = " | ".join(_json_schema_type(item) for item in raw_type) or "string"
            else:
                json_type = _json_schema_type(raw_type)
            parameters.append(
                CommandParameter(
                    name=prop_name,
                    type=json_type,  # type: ignore[arg-type]
                    description=prop_schema.get("description", f"Parameter {prop_name}"),
                    required=prop_name in required,
                    default=prop_schema.get("default"),
                    enum=prop_schema.get("enum"),
                    schema=prop_schema,
                )
            )

    # The output side of the model (serialization aliases, computed fields): what `data` holds.
    returns_schema = (
        metadata.output_schema.model_json_schema(mode="serialization")
        if metadata.output_schema is not None
        else None
    )

    return CommandDefinition(
        name=metadata.name,
        description=metadata.description,
        handler=func,
        category=metadata.category,
        parameters=parameters,
        input_schema=_advertised_schema(metadata.input_schema)
        if metadata.input_schema is not None
        else None,
        returns=returns_schema,
        tags=metadata.tags,
        mutation=metadata.mutation,
        examples=metadata.examples,
        requires=metadata.requires,
        contexts=metadata.contexts,
        scopes=list(metadata.scopes),
        handoff=metadata.handoff,
        handoff_protocol=metadata.handoff_protocol,
        expose=metadata.expose,
        destructive=metadata.destructive,
        confirm_prompt=metadata.confirm_prompt,
        undoable=metadata.undoable,
        approval=metadata.approval,
        version=metadata.version,
        title=metadata.title,
        errors=metadata.errors,
        execution_time=metadata.execution_time,
        task=metadata.task,
        tool_meta=metadata.tool_meta,
        advertised_input_schema=metadata.advertised_input_schema,
        output_budget=metadata.output_budget,
        confirmation_mode=metadata.confirmation_mode,
    )


def _json_schema_type(pydantic_type: str) -> str:
    """Convert Pydantic/JSON Schema type to our type system."""
    type_map = {
        "string": "string",
        "integer": "number",
        "number": "number",
        "boolean": "boolean",
        "array": "array",
        "object": "object",
        "null": "null",
    }
    return type_map.get(pydantic_type, "string") if isinstance(pydantic_type, str) else "string"


def _normalize_examples(
    examples: list[ExampleInput],
    input_schema: type[BaseModel] | dict[str, Any] | None,
) -> list[CommandExample]:
    """Normalize examples and validate their inputs eagerly."""
    normalized: list[CommandExample] = []

    for example in examples:
        if isinstance(example, CommandExample):
            title = example.title
            description = example.description
            input_value: Any = example.input
        elif isinstance(example, dict):
            if "input" in example:
                raw_title = example.get("title")
                title = str(raw_title) if raw_title is not None else None
                raw_description = example.get("description")
                description = str(raw_description) if raw_description is not None else None
                input_value = example.get("input", {})
            else:
                title = None
                description = None
                input_value = example
        else:
            raise TypeError("Command examples must be dicts or CommandExample instances")

        normalized.append(
            CommandExample(
                input=_normalize_example_input(input_value, input_schema),
                title=title,
                description=description,
            )
        )

    return normalized


def _normalize_example_input(
    input_value: Any,
    input_schema: type[BaseModel] | dict[str, Any] | None,
) -> dict[str, Any]:
    """Validate example input against the declared schema when present."""
    if isinstance(input_value, BaseModel):
        raw_input: Any = input_value.model_dump(mode="json")
    else:
        raw_input = input_value

    if raw_input is None:
        raw_input = {}

    if not isinstance(raw_input, dict):
        raise TypeError("Command example input must be a JSON object")

    if input_schema is None:
        return dict(raw_input)

    validated = validate_command_input(input_schema, raw_input)
    return validated if isinstance(validated, dict) else validated.model_dump(mode="json")
