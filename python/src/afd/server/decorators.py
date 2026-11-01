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
from dataclasses import dataclass, field
from functools import wraps
from typing import (
    Any,
    Callable,
    Dict,
    List,
    Optional,
    Type,
    TypeVar,
    Union,
)

from pydantic import BaseModel
from pydantic import ValidationError as PydanticValidationError

from afd.core.approval import ApprovalPolicy
from afd.core.commands import (
    CommandDefinition,
    CommandExample,
    CommandParameter,
    ExposeOptions,
    warn_invalid_command_name,
)
from afd.core.result import CommandResult
from afd.core.schema_validation import SchemaValidationError, check_schema, validate_schema
from afd.server.validation import _input_validation_failure

TInput = TypeVar("TInput", bound=BaseModel)
TOutput = TypeVar("TOutput")
ExampleInput = Union[CommandExample, Dict[str, Any]]


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
    category: Optional[str] = None
    input_schema: Optional[Union[Type[BaseModel], Dict[str, Any]]] = None
    output_schema: Optional[Type[BaseModel]] = None
    tags: List[str] = field(default_factory=list)
    mutation: bool = False
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
    version: Optional[str] = None
    title: Optional[str] = None


def define_command(
    name: str,
    description: str,
    category: Optional[str] = None,
    input_schema: Optional[Union[Type[BaseModel], Dict[str, Any]]] = None,
    output_schema: Optional[Type[BaseModel]] = None,
    tags: Optional[List[str]] = None,
    mutation: bool = False,
    examples: Optional[List[ExampleInput]] = None,
    requires: Optional[List[str]] = None,
    contexts: Optional[List[str]] = None,
    handoff: bool = False,
    handoff_protocol: Optional[str] = None,
    expose: Optional[ExposeOptions] = None,
    destructive: Optional[bool] = None,
    confirm_prompt: Optional[str] = None,
    undoable: Optional[bool] = None,
    approval: Optional[ApprovalPolicy] = None,
    version: Optional[str] = None,
    title: Optional[str] = None,
    _stacklevel: int = 2,
) -> Callable:
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
            context. Enforced by ``create_approval_middleware``; reported as
            ``_meta.approval`` (``"conditional"`` for a function).
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
    if approval is not None and approval not in ("required", "not-required") and not callable(approval):
        raise TypeError(
            f"Command '{name}' has an invalid approval policy: "
            "use 'required', 'not-required' or a function"
        )
    if input_schema is not None:
        check_schema(_advertised_schema(input_schema))

    def decorator(func: Callable) -> Callable:
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
        func.__afd_command__ = CommandMetadata(
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
            handoff=handoff,
            handoff_protocol=handoff_protocol,
            expose=expose,
            destructive=destructive,
            confirm_prompt=confirm_prompt,
            undoable=undoable,
            approval=approval,
            version=version,
            title=title,
        )
        
        @wraps(func)
        async def wrapper(raw_input: Any, context: Optional[Any] = None) -> CommandResult:
            """Wrapper that validates input and calls the handler."""
            try:
                validated_input = validate_command_input(input_schema, raw_input)
            except (PydanticValidationError, SchemaValidationError) as exc:
                return _input_validation_failure(
                    input_schema, {} if raw_input is None else raw_input, exc
                )

            return await validated_handler(validated_input, context)

        async def validated_handler(validated_input: Any, context: Optional[Any] = None) -> CommandResult:
            if accepts_context:
                return await func(validated_input, context)
            return await func(validated_input)

        wrapper.__afd_validated_handler__ = validated_handler
        # Copy metadata to wrapper
        wrapper.__afd_command__ = func.__afd_command__
        
        return wrapper
    
    return decorator


def validate_command_input(input_schema: Optional[Union[Type[BaseModel], Dict[str, Any]]], raw_input: Any) -> Any:
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
    data = validate_schema(_advertised_schema(input_schema), {} if raw_input is None else raw_input)
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
        return [_present_input(value, original) for value, original in zip(parsed, raw, strict=True)]
    return parsed


def _advertised_schema(input_schema: Union[Type[BaseModel], Dict[str, Any]]) -> Dict[str, Any]:
    if isinstance(input_schema, dict):
        return input_schema
    if not isinstance(input_schema, type) or not issubclass(input_schema, BaseModel):
        raise TypeError("input_schema must be a JSON Schema object or a Pydantic model class")
    return input_schema.model_json_schema()


def _accepts_context(func: Callable) -> bool:
    """Check if function accepts a context parameter."""
    try:
        params = list(inspect.signature(func).parameters)
    except (TypeError, ValueError):  # builtins and some callables have no signature
        return False
    return "context" in params or len(params) > 1


def has_command_metadata(func: Callable) -> bool:
    """Check if a function has command metadata attached."""
    return hasattr(func, "__afd_command__")


def get_command_metadata(func: Callable) -> Optional[CommandMetadata]:
    """Get command metadata from a decorated function."""
    return getattr(func, "__afd_command__", None)


def command_to_definition(func: Callable) -> Optional[CommandDefinition]:
    """Convert a decorated function to a CommandDefinition.
    
    Args:
        func: Function decorated with @define_command.
    
    Returns:
        CommandDefinition if the function has metadata, None otherwise.
    """
    metadata = get_command_metadata(func)
    if not metadata:
        return None
    
    # Generate parameters from input schema
    parameters = []
    if metadata.input_schema:
        schema = _advertised_schema(metadata.input_schema)
        properties = schema.get("properties", {})
        required = set(schema.get("required", []))
        
        for prop_name, prop_schema in properties.items():
            json_type = _json_schema_type(prop_schema.get("type", "string"))
            parameters.append(CommandParameter(
                name=prop_name,
                type=json_type,
                description=prop_schema.get("description", f"Parameter {prop_name}"),
                required=prop_name in required,
                default=prop_schema.get("default"),
                enum=prop_schema.get("enum"),
                schema=prop_schema,
            ))

    returns_schema = (
        metadata.output_schema.model_json_schema()
        if metadata.output_schema is not None
        else None
    )

    return CommandDefinition(
        name=metadata.name,
        description=metadata.description,
        handler=func,
        category=metadata.category,
        parameters=parameters,
        input_schema=_advertised_schema(metadata.input_schema) if metadata.input_schema is not None else None,
        returns=returns_schema,
        tags=metadata.tags,
        mutation=metadata.mutation,
        examples=metadata.examples,
        requires=metadata.requires,
        contexts=metadata.contexts,
        handoff=metadata.handoff,
        handoff_protocol=metadata.handoff_protocol,
        expose=metadata.expose,
        destructive=metadata.destructive,
        confirm_prompt=metadata.confirm_prompt,
        undoable=metadata.undoable,
        approval=metadata.approval,
        version=metadata.version,
        title=metadata.title,
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
    examples: List[ExampleInput],
    input_schema: Optional[Union[Type[BaseModel], Dict[str, Any]]],
) -> List[CommandExample]:
    """Normalize examples and validate their inputs eagerly."""
    normalized: List[CommandExample] = []

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
                description = (
                    str(raw_description) if raw_description is not None else None
                )
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
    input_schema: Optional[Union[Type[BaseModel], Dict[str, Any]]],
) -> Dict[str, Any]:
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
