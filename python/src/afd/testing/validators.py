"""Non-throwing validators for AFD command results and definitions.

Unlike assertions (which raise on failure), validators return a
ValidationResult containing errors and warnings for programmatic use.

Example:
    >>> from afd.testing.validators import validate_result, validate_error
    >>>
    >>> vr = validate_result(result)
    >>> assert vr.valid
    >>> assert len(vr.warnings) == 0
"""

import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Union


@dataclass
class ValidationError:
    """A hard validation error that must be fixed.

    Attributes:
        path: JSONPath-like location (e.g. "error.code", "plan[0].status").
        message: Human-readable description.
        code: Machine-readable error code for programmatic handling.
    """

    path: str
    message: str
    code: str


@dataclass
class ValidationWarning:
    """A soft validation warning / recommendation.

    Attributes:
        path: JSONPath-like location.
        message: Human-readable description.
        code: Machine-readable warning code.
    """

    path: str
    message: str
    code: str


@dataclass
class ValidationResult:
    """Result of a validation check.

    Attributes:
        valid: True when there are zero errors.
        errors: Hard errors that must be fixed.
        warnings: Soft warnings / recommendations.
    """

    valid: bool
    errors: List[ValidationError] = field(default_factory=list)
    warnings: List[ValidationWarning] = field(default_factory=list)


@dataclass
class ResultValidationOptions:
    """Options controlling what validate_result checks.

    Attributes:
        require_data: Warn when a successful result has no data.
        require_confidence: Warn when confidence is missing.
        require_reasoning: Warn when reasoning is missing.
        require_sources: Warn when sources are missing.
    """

    require_data: bool = False
    require_confidence: bool = False
    require_reasoning: bool = False
    require_sources: bool = False


# kebab-case domain-action: e.g. "todo-create", "user-get-by-id"
_KEBAB_CASE_RE = re.compile(r"^[a-z][a-z0-9]*(-[a-z][a-z0-9]*)+$")


def validate_result(
    result: Any,
    options: Optional[ResultValidationOptions] = None,
) -> ValidationResult:
    """Validate a CommandResult structure.

    Checks required fields, success/error consistency, confidence
    range, and plan step integrity.

    Args:
        result: A CommandResult or dict to validate.
        options: Optional validation strictness options.

    Returns:
        A ValidationResult with any errors and warnings found.

    Example:
        >>> from afd import success
        >>> vr = validate_result(success({"id": 1}))
        >>> assert vr.valid
    """
    opts = options or ResultValidationOptions()
    errors: List[ValidationError] = []
    warnings: List[ValidationWarning] = []

    # -- Extract fields (support both objects and dicts) -------------------
    if isinstance(result, dict):
        success_val = result.get("success")
        data = result.get("data")
        error_val = result.get("error")
        confidence = result.get("confidence")
        reasoning = result.get("reasoning")
        sources = result.get("sources")
        plan = result.get("plan")
    else:
        success_val = getattr(result, "success", None)
        data = getattr(result, "data", None)
        error_val = getattr(result, "error", None)
        confidence = getattr(result, "confidence", None)
        reasoning = getattr(result, "reasoning", None)
        sources = getattr(result, "sources", None)
        plan = getattr(result, "plan", None)

    # -- success must be a boolean -----------------------------------------
    if not isinstance(success_val, bool):
        errors.append(ValidationError(
            path="success",
            message="success must be a boolean",
            code="INVALID_SUCCESS_TYPE",
        ))

    # -- success / data consistency ----------------------------------------
    if success_val is True and data is None and opts.require_data:
        warnings.append(ValidationWarning(
            path="data",
            message="Successful result has no data",
            code="MISSING_DATA",
        ))

    # -- failure / error consistency ---------------------------------------
    if success_val is False and error_val is None:
        errors.append(ValidationError(
            path="error",
            message="Failed result must have error details",
            code="MISSING_ERROR",
        ))

    # -- validate error structure if present -------------------------------
    if error_val is not None:
        err_validation = validate_error(error_val)
        for e in err_validation.errors:
            errors.append(ValidationError(
                path=f"error.{e.path}" if e.path else "error",
                message=e.message,
                code=e.code,
            ))
        for w in err_validation.warnings:
            warnings.append(ValidationWarning(
                path=f"error.{w.path}" if w.path else "error",
                message=w.message,
                code=w.code,
            ))

    # -- confidence --------------------------------------------------------
    if opts.require_confidence and confidence is None:
        warnings.append(ValidationWarning(
            path="confidence",
            message="AI-powered commands should include confidence score",
            code="MISSING_CONFIDENCE",
        ))

    if confidence is not None:
        if not isinstance(confidence, (int, float)):
            errors.append(ValidationError(
                path="confidence",
                message="confidence must be a number",
                code="INVALID_CONFIDENCE_TYPE",
            ))
        elif confidence < 0 or confidence > 1:
            errors.append(ValidationError(
                path="confidence",
                message="confidence must be between 0 and 1",
                code="INVALID_CONFIDENCE_RANGE",
            ))

    # -- reasoning ---------------------------------------------------------
    if opts.require_reasoning and not reasoning:
        warnings.append(ValidationWarning(
            path="reasoning",
            message="AI-powered commands should include reasoning",
            code="MISSING_REASONING",
        ))

    # -- sources -----------------------------------------------------------
    if opts.require_sources and (not sources or len(sources) == 0):
        warnings.append(ValidationWarning(
            path="sources",
            message="Commands using external data should include sources",
            code="MISSING_SOURCES",
        ))

    # -- plan step integrity -----------------------------------------------
    if plan is not None:
        for i, step in enumerate(plan):
            if isinstance(step, dict):
                step_id = step.get("id")
                step_action = step.get("action")
                step_status = step.get("status")
            else:
                step_id = getattr(step, "id", None)
                step_action = getattr(step, "action", None)
                step_status = getattr(step, "status", None)

            if not step_id:
                errors.append(ValidationError(
                    path=f"plan[{i}].id",
                    message="Plan step must have an id",
                    code="MISSING_STEP_ID",
                ))
            if not step_action:
                errors.append(ValidationError(
                    path=f"plan[{i}].action",
                    message="Plan step must have an action",
                    code="MISSING_STEP_ACTION",
                ))
            if not step_status:
                errors.append(ValidationError(
                    path=f"plan[{i}].status",
                    message="Plan step must have a status",
                    code="MISSING_STEP_STATUS",
                ))

    return ValidationResult(
        valid=len(errors) == 0,
        errors=errors,
        warnings=warnings,
    )


def validate_error(error: Any) -> ValidationResult:
    """Validate a CommandError structure.

    Checks that code and message are present (errors) and that
    suggestion and retryable are provided (warnings).

    Args:
        error: A CommandError, dict, or other value to validate.

    Returns:
        A ValidationResult with any errors and warnings found.

    Example:
        >>> from afd.core.errors import not_found_error
        >>> vr = validate_error(not_found_error("Doc", "123"))
        >>> assert vr.valid
    """
    errors: List[ValidationError] = []
    warnings: List[ValidationWarning] = []

    # Extract fields
    if isinstance(error, dict):
        code = error.get("code")
        message = error.get("message")
        suggestion = error.get("suggestion")
        retryable = error.get("retryable")
    else:
        code = getattr(error, "code", None)
        message = getattr(error, "message", None)
        suggestion = getattr(error, "suggestion", None)
        retryable = getattr(error, "retryable", None)

    # code is required
    if not code or not isinstance(code, str):
        errors.append(ValidationError(
            path="code",
            message="Error code must be a non-empty string",
            code="INVALID_ERROR_CODE",
        ))

    # message is required
    if not message or not isinstance(message, str):
        errors.append(ValidationError(
            path="message",
            message="Error message must be a non-empty string",
            code="INVALID_ERROR_MESSAGE",
        ))

    # suggestion is recommended
    if not suggestion:
        warnings.append(ValidationWarning(
            path="suggestion",
            message="Errors should include a suggestion for recovery",
            code="MISSING_SUGGESTION",
        ))

    # retryable is recommended
    if retryable is None:
        warnings.append(ValidationWarning(
            path="retryable",
            message="Errors should indicate if they are retryable",
            code="MISSING_RETRYABLE",
        ))

    return ValidationResult(
        valid=len(errors) == 0,
        errors=errors,
        warnings=warnings,
    )


def validate_command_definition(command: Any) -> ValidationResult:
    """Validate a CommandDefinition's metadata.

    Checks name (kebab-case), description (10+ chars), parameters
    array, handler callable, and recommended fields.

    Args:
        command: A CommandDefinition or dict to validate.

    Returns:
        A ValidationResult with any errors and warnings found.

    Example:
        >>> from afd.core.commands import CommandDefinition
        >>> cmd = CommandDefinition(
        ...     name="todo-create",
        ...     description="Create a new todo item",
        ...     handler=my_handler,
        ... )
        >>> vr = validate_command_definition(cmd)
        >>> assert vr.valid
    """
    errors: List[ValidationError] = []
    warnings: List[ValidationWarning] = []

    # Extract fields
    if isinstance(command, dict):
        name = command.get("name")
        description = command.get("description")
        parameters = command.get("parameters")
        handler = command.get("handler")
        category = command.get("category")
        cmd_errors = command.get("errors")
    else:
        name = getattr(command, "name", None)
        description = getattr(command, "description", None)
        parameters = getattr(command, "parameters", None)
        handler = getattr(command, "handler", None)
        category = getattr(command, "category", None)
        cmd_errors = getattr(command, "errors", None)

    # -- name --------------------------------------------------------------
    if not name or not isinstance(name, str):
        errors.append(ValidationError(
            path="name",
            message="Command must have a name",
            code="MISSING_NAME",
        ))
    elif not _KEBAB_CASE_RE.match(name):
        warnings.append(ValidationWarning(
            path="name",
            message='Command name should use kebab-case domain-action format (e.g., "todo-create")',
            code="INVALID_NAME_FORMAT",
        ))

    # -- description -------------------------------------------------------
    if not description or not isinstance(description, str):
        errors.append(ValidationError(
            path="description",
            message="Command must have a description",
            code="MISSING_DESCRIPTION",
        ))
    elif len(description) < 10:
        warnings.append(ValidationWarning(
            path="description",
            message="Description should be more detailed",
            code="SHORT_DESCRIPTION",
        ))

    # -- parameters --------------------------------------------------------
    if parameters is None or not isinstance(parameters, list):
        errors.append(ValidationError(
            path="parameters",
            message="Command must have a parameters array",
            code="MISSING_PARAMETERS",
        ))
    else:
        for i, param in enumerate(parameters):
            if isinstance(param, dict):
                p_name = param.get("name")
                p_type = param.get("type")
                p_desc = param.get("description")
            else:
                p_name = getattr(param, "name", None)
                p_type = getattr(param, "type", None)
                p_desc = getattr(param, "description", None)

            if not p_name:
                errors.append(ValidationError(
                    path=f"parameters[{i}].name",
                    message="Parameter must have a name",
                    code="MISSING_PARAM_NAME",
                ))
            if not p_type:
                errors.append(ValidationError(
                    path=f"parameters[{i}].type",
                    message="Parameter must have a type",
                    code="MISSING_PARAM_TYPE",
                ))
            if not p_desc:
                warnings.append(ValidationWarning(
                    path=f"parameters[{i}].description",
                    message="Parameter should have a description",
                    code="MISSING_PARAM_DESCRIPTION",
                ))

    # -- handler -----------------------------------------------------------
    if not handler or not callable(handler):
        errors.append(ValidationError(
            path="handler",
            message="Command must have a handler function",
            code="MISSING_HANDLER",
        ))

    # -- recommended fields ------------------------------------------------
    if not category:
        warnings.append(ValidationWarning(
            path="category",
            message="Command should have a category for organization",
            code="MISSING_CATEGORY",
        ))

    if not cmd_errors or (isinstance(cmd_errors, list) and len(cmd_errors) == 0):
        warnings.append(ValidationWarning(
            path="errors",
            message="Command should document possible error codes",
            code="MISSING_ERROR_DOCS",
        ))

    return ValidationResult(
        valid=len(errors) == 0,
        errors=errors,
        warnings=warnings,
    )
