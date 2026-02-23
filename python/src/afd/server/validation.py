"""Enhanced validation utilities for AFD servers.

Mirrors the TypeScript validation.ts in @lushly-dev/afd-server,
providing field introspection, common patterns, and agent-friendly
error formatting on top of Pydantic validation.

Example:
    >>> from pydantic import BaseModel
    >>> from afd.server.validation import validate_input, is_valid
    >>>
    >>> class CreateInput(BaseModel):
    ...     title: str
    ...     count: int = 0
    >>>
    >>> result = validate_input(CreateInput, {"title": "hello"})
    >>> result.success
    True
    >>> is_valid(CreateInput, {"title": 123})
    False
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Annotated, Generic, Literal, TypeVar

from pydantic import BaseModel, Field, field_validator
from pydantic import ValidationError as PydanticValidationError

from afd.core.errors import CommandError

T = TypeVar("T")

# ═══════════════════════════════════════════════════════════════════════════════
# TYPES
# ═══════════════════════════════════════════════════════════════════════════════

UUID_REGEX = r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"


@dataclass
class ValidationError:
    """A single validation error with path and metadata."""

    path: str
    message: str
    code: str
    expected: str | None = None
    received: str | None = None


@dataclass
class ValidationResult(Generic[T]):
    """Result of basic input validation."""

    success: bool
    data: T | None = None
    errors: list[ValidationError] = field(default_factory=list)


@dataclass
class EnhancedValidationResult(Generic[T]):
    """Result of enhanced validation with field introspection."""

    success: bool
    data: T | None = None
    errors: list[ValidationError] = field(default_factory=list)
    expected_fields: list[str] | None = None
    unexpected_fields: list[str] | None = None
    missing_fields: list[str] | None = None


class ValidationException(Exception):  # noqa: N818 — matches TypeScript API name
    """Exception raised by validate_or_throw with structured error details."""

    def __init__(self, errors: list[ValidationError]) -> None:
        self.errors = errors
        self.code = "VALIDATION_ERROR"
        super().__init__(format_validation_errors(errors))

    def to_command_error(self) -> CommandError:
        """Convert to a CommandError for use in failure responses."""
        return CommandError(
            code=self.code,
            message="Input validation failed",
            suggestion=str(self),
            details={"errors": [_error_to_dict(e) for e in self.errors]},
        )


# ═══════════════════════════════════════════════════════════════════════════════
# VALIDATION FUNCTIONS
# ═══════════════════════════════════════════════════════════════════════════════


def validate_input(model_class: type[BaseModel], input_data: object) -> ValidationResult:
    """Validate input data against a Pydantic model.

    Args:
        model_class: The Pydantic model class to validate against.
        input_data: The data to validate (dict or similar mapping).

    Returns:
        A ValidationResult with success/data or errors.

    Example:
        >>> from pydantic import BaseModel
        >>> class MyInput(BaseModel):
        ...     name: str
        >>> result = validate_input(MyInput, {"name": "Alice"})
        >>> result.success
        True
    """
    try:
        data = model_class.model_validate(input_data)
        return ValidationResult(success=True, data=data, errors=[])
    except PydanticValidationError as exc:
        return ValidationResult(
            success=False,
            data=None,
            errors=_convert_pydantic_errors(exc),
        )


def validate_input_enhanced(
    model_class: type[BaseModel], input_data: object
) -> EnhancedValidationResult:
    """Validate input with field introspection (expected/unexpected/missing).

    Like validate_input but also reports which fields were expected,
    which were unexpected, and which required fields are missing.

    Args:
        model_class: The Pydantic model class to validate against.
        input_data: The data to validate.

    Returns:
        An EnhancedValidationResult with field introspection details.

    Example:
        >>> from pydantic import BaseModel
        >>> class MyInput(BaseModel):
        ...     name: str
        ...     age: int = 0
        >>> result = validate_input_enhanced(MyInput, {"name": "Alice", "extra": 1})
        >>> result.unexpected_fields
        ['extra']
    """
    try:
        data = model_class.model_validate(input_data)
        return EnhancedValidationResult(success=True, data=data, errors=[])
    except PydanticValidationError as exc:
        errors = _convert_pydantic_errors(exc)
        schema_info = _extract_schema_info(model_class, input_data)
        return EnhancedValidationResult(
            success=False,
            data=None,
            errors=errors,
            expected_fields=schema_info["expected_fields"] or None,
            unexpected_fields=schema_info["unexpected_fields"] or None,
            missing_fields=schema_info["missing_fields"] or None,
        )


def validate_or_throw(model_class: type[BaseModel], input_data: object) -> BaseModel:
    """Validate input and return the model, or raise ValidationException.

    Args:
        model_class: The Pydantic model class to validate against.
        input_data: The data to validate.

    Returns:
        The validated Pydantic model instance.

    Raises:
        ValidationException: If validation fails.

    Example:
        >>> from pydantic import BaseModel
        >>> class MyInput(BaseModel):
        ...     name: str
        >>> model = validate_or_throw(MyInput, {"name": "Alice"})
        >>> model.name
        'Alice'
    """
    result = validate_input(model_class, input_data)
    if not result.success:
        raise ValidationException(result.errors)
    return result.data  # type: ignore[return-value]


def is_valid(model_class: type[BaseModel], input_data: object) -> bool:
    """Check if input data is valid against a Pydantic model.

    Args:
        model_class: The Pydantic model class to validate against.
        input_data: The data to validate.

    Returns:
        True if valid, False otherwise.

    Example:
        >>> from pydantic import BaseModel
        >>> class MyInput(BaseModel):
        ...     name: str
        >>> is_valid(MyInput, {"name": "Alice"})
        True
        >>> is_valid(MyInput, {})
        False
    """
    try:
        model_class.model_validate(input_data)
        return True
    except PydanticValidationError:
        return False


# ═══════════════════════════════════════════════════════════════════════════════
# FORMATTING
# ═══════════════════════════════════════════════════════════════════════════════


def format_validation_errors(errors: list[ValidationError]) -> str:
    """Format validation errors as a human-readable string.

    Args:
        errors: List of validation errors.

    Returns:
        Formatted string describing the errors.

    Example:
        >>> err = ValidationError(path="name", message="required", code="missing")
        >>> format_validation_errors([err])
        'name: required'
    """
    if not errors:
        return "No validation errors"

    if len(errors) == 1:
        err = errors[0]
        if err.path == "(root)":
            return err.message
        return f"{err.path}: {err.message}"

    lines: list[str] = []
    for err in errors:
        if err.path == "(root)":
            lines.append(f"- {err.message}")
        else:
            lines.append(f"- {err.path}: {err.message}")
    return "\n".join(lines)


def format_enhanced_validation_error(
    errors: list[ValidationError],
    schema_info: dict[str, list[str] | None] | None = None,
) -> str:
    """Format validation errors with field introspection details.

    Produces agent-friendly output including unknown/missing/expected fields.

    Args:
        errors: List of validation errors.
        schema_info: Optional dict with expectedFields, unexpectedFields, missingFields.

    Returns:
        Formatted string with all available context.

    Example:
        >>> err = ValidationError(path="x", message="bad", code="err")
        >>> info = {"unexpected_fields": ["x"], "missing_fields": ["name"],
        ...         "expected_fields": ["name", "age"]}
        >>> format_enhanced_validation_error([err], info)
        'x: bad. Unknown field(s): x. Missing required field(s): name. Expected fields: name, age'
    """
    parts: list[str] = []
    if errors:
        parts.append(format_validation_errors(errors))
    if schema_info:
        unexpected = schema_info.get("unexpected_fields")
        if unexpected:
            parts.append(f"Unknown field(s): {', '.join(unexpected)}")
        missing = schema_info.get("missing_fields")
        if missing:
            parts.append(f"Missing required field(s): {', '.join(missing)}")
        expected = schema_info.get("expected_fields")
        if expected:
            parts.append(f"Expected fields: {', '.join(expected)}")
    return ". ".join(parts)


# ═══════════════════════════════════════════════════════════════════════════════
# PATTERNS (Annotated types & Pydantic models)
# ═══════════════════════════════════════════════════════════════════════════════

UuidStr = Annotated[str, Field(pattern=UUID_REGEX)]
"""String validated as a UUID v4 format."""

EmailStr = Annotated[str, Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")]
"""String validated as a basic email format."""


class PaginationParams(BaseModel):
    """Pagination parameters with sensible defaults.

    Example:
        >>> params = PaginationParams()
        >>> params.limit
        20
        >>> params.offset
        0
    """

    limit: int = Field(default=20, ge=1, le=100)
    offset: int = Field(default=0, ge=0)


class SortParams(BaseModel):
    """Sorting parameters.

    Example:
        >>> params = SortParams(sort_by="created_at")
        >>> params.sort_order
        'asc'
    """

    sort_by: str
    sort_order: Literal["asc", "desc"] = "asc"


class SearchParams(BaseModel):
    """Search query parameters.

    Example:
        >>> params = SearchParams(query="hello world")
        >>> params.query
        'hello world'
    """

    query: str = Field(min_length=1, max_length=500)


class DateRangeParams(BaseModel):
    """Date range parameters with end > start validation.

    Dates should be ISO 8601 format strings.

    Example:
        >>> params = DateRangeParams(start="2025-01-01", end="2025-12-31")
    """

    start: str
    end: str

    @field_validator("end")
    @classmethod
    def end_must_be_after_start(cls, v: str, info: object) -> str:
        """Validate that end date is after start date."""
        # info.data contains already-validated fields
        data = getattr(info, "data", {})
        start = data.get("start")
        if start is not None:
            try:
                start_dt = datetime.fromisoformat(start)
                end_dt = datetime.fromisoformat(v)
                if end_dt <= start_dt:
                    raise ValueError("end must be after start")
            except (ValueError, TypeError) as e:
                if "end must be after start" in str(e):
                    raise
                # If dates can't be parsed, skip the comparison
                # (the format itself would be caught by other validators if needed)
        return v


# ═══════════════════════════════════════════════════════════════════════════════
# INTERNAL HELPERS
# ═══════════════════════════════════════════════════════════════════════════════


def _convert_pydantic_errors(exc: PydanticValidationError) -> list[ValidationError]:
    """Convert Pydantic ValidationError issues to our ValidationError list."""
    errors: list[ValidationError] = []
    for issue in exc.errors():
        loc = issue.get("loc", ())
        path = ".".join(str(p) for p in loc) if loc else "(root)"
        msg = issue.get("msg", "Validation error")
        code = issue.get("type", "validation_error")

        error = ValidationError(path=path, message=msg, code=code)

        # Add expected/received for type errors
        ctx = issue.get("ctx", {})
        if "expected" in ctx:
            error.expected = str(ctx["expected"])
        if "received" in ctx:
            error.received = str(ctx["received"])

        errors.append(error)
    return errors


def _extract_schema_info(
    model_class: type[BaseModel], input_data: object
) -> dict[str, list[str]]:
    """Extract field introspection info from a model class and input data."""
    expected_fields: list[str] = list(model_class.model_fields.keys())
    unexpected_fields: list[str] = []
    missing_fields: list[str] = []

    if isinstance(input_data, dict):
        input_keys = set(input_data.keys())
        expected_set = set(expected_fields)

        # Unexpected: keys in input but not in model
        unexpected_fields = sorted(input_keys - expected_set)

        # Missing: required fields not in input
        for name, field_info in model_class.model_fields.items():
            if field_info.is_required() and name not in input_keys:
                missing_fields.append(name)

    return {
        "expected_fields": expected_fields,
        "unexpected_fields": unexpected_fields,
        "missing_fields": missing_fields,
    }


def _error_to_dict(error: ValidationError) -> dict[str, object]:
    """Convert a ValidationError dataclass to a plain dict."""
    result: dict[str, object] = {
        "path": error.path,
        "message": error.message,
        "code": error.code,
    }
    if error.expected is not None:
        result["expected"] = error.expected
    if error.received is not None:
        result["received"] = error.received
    return result
