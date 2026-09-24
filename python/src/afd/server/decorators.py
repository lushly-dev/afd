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

from afd.core.commands import (
    CommandDefinition,
    CommandExample,
    CommandParameter,
    ExposeOptions,
)
from afd.core.result import CommandResult
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
    input_schema: Optional[Type[BaseModel]] = None
    output_schema: Optional[Type[BaseModel]] = None
    tags: List[str] = field(default_factory=list)
    mutation: bool = False
    examples: List[CommandExample] = field(default_factory=list)
    requires: List[str] = field(default_factory=list)
    contexts: List[str] = field(default_factory=list)
    handoff: bool = False
    handoff_protocol: Optional[str] = None
    expose: Optional[ExposeOptions] = None


def define_command(
    name: str,
    description: str,
    category: Optional[str] = None,
    input_schema: Optional[Type[BaseModel]] = None,
    output_schema: Optional[Type[BaseModel]] = None,
    tags: Optional[List[str]] = None,
    mutation: bool = False,
    examples: Optional[List[ExampleInput]] = None,
    requires: Optional[List[str]] = None,
    contexts: Optional[List[str]] = None,
    handoff: bool = False,
    handoff_protocol: Optional[str] = None,
    expose: Optional[ExposeOptions] = None,
) -> Callable:
    """Decorator to define a command with metadata.

    The decorated function becomes a command handler that can be registered
    with an MCP server. The decorator attaches metadata for schema generation.

    Args:
        name: Command name (use kebab-case, e.g., "item-create").
        description: Human-readable description of what the command does.
        input_schema: Pydantic model class for validating input.
        output_schema: Pydantic model class for the output (optional).
        tags: Tags for categorization and filtering.
        mutation: Whether this command modifies state (default False).
        examples: Example inputs for documentation.
        requires: Related prerequisite commands (metadata only).
        contexts: Context names that scope this command.
        expose: Controls which interfaces this command is exposed to.

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
        )
        
        @wraps(func)
        async def wrapper(raw_input: Any, context: Optional[Any] = None) -> CommandResult:
            """Wrapper that validates input and calls the handler."""
            # Validate input using Pydantic schema if provided
            if input_schema and raw_input is not None:
                try:
                    if isinstance(raw_input, dict):
                        validated_input = input_schema.model_validate(raw_input)
                    elif isinstance(raw_input, input_schema):
                        validated_input = raw_input
                    else:
                        validated_input = input_schema.model_validate(raw_input)
                except PydanticValidationError as exc:
                    return _input_validation_failure(input_schema, raw_input, exc)
            else:
                validated_input = raw_input
            
            if accepts_context:
                return await func(validated_input, context)
            return await func(validated_input)
        
        # Copy metadata to wrapper
        wrapper.__afd_command__ = func.__afd_command__
        
        return wrapper
    
    return decorator


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
        schema = metadata.input_schema.model_json_schema()
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
        input_schema=metadata.input_schema.model_json_schema() if metadata.input_schema else None,
        returns=returns_schema,
        tags=metadata.tags,
        mutation=metadata.mutation,
        examples=metadata.examples,
        requires=metadata.requires,
        contexts=metadata.contexts,
        handoff=metadata.handoff,
        handoff_protocol=metadata.handoff_protocol,
        expose=metadata.expose,
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
    return type_map.get(pydantic_type, "string")


def _normalize_examples(
    examples: List[ExampleInput],
    input_schema: Optional[Type[BaseModel]],
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
    input_schema: Optional[Type[BaseModel]],
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

    validated = input_schema.model_validate(raw_input)
    return validated.model_dump(mode="json")
