"""The run-time check of a step an ``afd-batch`` or ``afd-pipe`` approved up front (#1511)."""

from __future__ import annotations

import json
import logging
from typing import Any

from pydantic import ValidationError as PydanticValidationError

from afd.core.result import CommandResult, error
from afd.core.schema_validation import SchemaValidationError
from afd.server.decorators import validate_command_input
from afd.server.validation import _input_validation_failure

logger = logging.getLogger(__name__)


def check_approved_at_run(
    command: str, input_schema: Any, approved: Any, max_issues: int
) -> CommandResult[Any] | None:
    """Validate, as a gated step starts, the approved input it is about to run.

    A validator that reads live state then checks the value that runs, not only a fresh default of
    the input as sent, and the schema must read the approved input back to the same canonical
    JSON. ``None`` when it does; otherwise the ``VALIDATION_ERROR`` to return, and nothing runs. An
    input with no canonical form is let through: no approval binds it.
    """
    from afd.server.approval import _canonical_json, _plain_input

    try:
        canonical = _canonical_json(_plain_input(approved))
    except (TypeError, ValueError, RecursionError):
        return None
    plain = json.loads(canonical)
    try:
        again = validate_command_input(input_schema, plain, max_issues=max_issues)
    except (PydanticValidationError, SchemaValidationError) as exc:
        return _input_validation_failure(input_schema, plain, exc, max_issues=max_issues)
    except Exception as exc:
        # A validator that raises: the step fails as it would on its own validation.
        logger.error("Approved-input validation for '%s' raised", command, exc_info=exc)
        return error(
            "VALIDATION_ERROR",
            "Input validation failed",
            suggestion=(
                f"Check the input against the input schema of '{command}' (afd-detail returns "
                "it) and retry"
            ),
        )
    try:
        same = _canonical_json(_plain_input(again)) == canonical
    except (TypeError, ValueError, RecursionError):
        same = False
    if same:
        return None
    return error(
        "VALIDATION_ERROR",
        "Input validation failed",
        suggestion=(
            f"The approved input of '{command}' no longer validates to itself: the schema changed "
            "it when the step ran. Call the command on its own and retry"
        ),
    )
