"""Tests for the AFD testing validators."""

import pytest
from afd.core import (
    CommandResult,
    success,
    error,
    failure,
    PlanStep,
    PlanStepStatus,
    Source,
)
from afd.core.commands import CommandDefinition, CommandParameter
from afd.core.errors import CommandError, not_found_error
from afd.testing.validators import (
    ValidationError,
    ValidationWarning,
    ValidationResult,
    ResultValidationOptions,
    validate_result,
    validate_error,
    validate_command_definition,
)


# ==============================================================================
# Test validate_result
# ==============================================================================

class TestValidateResult:
    """Tests for validate_result validator."""

    def test_valid_success_result(self):
        """Should pass for a well-formed success result."""
        result = success({"id": 1})
        vr = validate_result(result)
        assert vr.valid
        assert len(vr.errors) == 0

    def test_valid_error_result(self):
        """Should pass for a well-formed error result."""
        result = error(
            "NOT_FOUND", "Not found",
            suggestion="Check the ID", retryable=False,
        )
        vr = validate_result(result)
        assert vr.valid

    def test_invalid_success_type(self):
        """Should error when success is not a boolean."""
        result = {"success": "yes", "data": 1}
        vr = validate_result(result)
        assert not vr.valid
        assert any(e.code == "INVALID_SUCCESS_TYPE" for e in vr.errors)

    def test_missing_error_on_failure(self):
        """Should error when failure has no error details."""
        result = {"success": False}
        vr = validate_result(result)
        assert not vr.valid
        assert any(e.code == "MISSING_ERROR" for e in vr.errors)

    def test_missing_data_warning(self):
        """Should warn when require_data is set but data is None."""
        result = CommandResult(success=True)
        vr = validate_result(result, ResultValidationOptions(require_data=True))
        assert vr.valid  # warnings don't make it invalid
        assert any(w.code == "MISSING_DATA" for w in vr.warnings)

    def test_confidence_range_valid(self):
        """Should pass for confidence in [0, 1]."""
        result = CommandResult(success=True, data="test", confidence=0.5)
        vr = validate_result(result)
        assert vr.valid
        assert not any(e.code == "INVALID_CONFIDENCE_RANGE" for e in vr.errors)

    def test_confidence_out_of_range(self):
        """Should error for confidence outside [0, 1]."""
        result = {"success": True, "data": "test", "confidence": 1.5}
        vr = validate_result(result)
        assert not vr.valid
        assert any(e.code == "INVALID_CONFIDENCE_RANGE" for e in vr.errors)

    def test_confidence_negative(self):
        """Should error for negative confidence."""
        result = {"success": True, "data": "test", "confidence": -0.1}
        vr = validate_result(result)
        assert not vr.valid
        assert any(e.code == "INVALID_CONFIDENCE_RANGE" for e in vr.errors)

    def test_confidence_not_number(self):
        """Should error for non-numeric confidence."""
        result = {"success": True, "data": "test", "confidence": "high"}
        vr = validate_result(result)
        assert not vr.valid
        assert any(e.code == "INVALID_CONFIDENCE_TYPE" for e in vr.errors)

    def test_require_confidence_warning(self):
        """Should warn when require_confidence is set but missing."""
        result = success("test")
        vr = validate_result(result, ResultValidationOptions(require_confidence=True))
        assert any(w.code == "MISSING_CONFIDENCE" for w in vr.warnings)

    def test_require_reasoning_warning(self):
        """Should warn when require_reasoning is set but missing."""
        result = success("test")
        vr = validate_result(result, ResultValidationOptions(require_reasoning=True))
        assert any(w.code == "MISSING_REASONING" for w in vr.warnings)

    def test_require_sources_warning(self):
        """Should warn when require_sources is set but missing."""
        result = success("test")
        vr = validate_result(result, ResultValidationOptions(require_sources=True))
        assert any(w.code == "MISSING_SOURCES" for w in vr.warnings)

    def test_plan_step_integrity(self):
        """Should error for plan steps missing required fields."""
        result = {
            "success": True,
            "data": "test",
            "plan": [
                {"id": "", "action": "", "status": ""},  # all empty
            ],
        }
        vr = validate_result(result)
        assert not vr.valid
        assert any(e.code == "MISSING_STEP_ID" for e in vr.errors)
        assert any(e.code == "MISSING_STEP_ACTION" for e in vr.errors)
        assert any(e.code == "MISSING_STEP_STATUS" for e in vr.errors)

    def test_valid_plan_steps(self):
        """Should pass for valid plan steps."""
        result = CommandResult(
            success=True, data="test",
            plan=[
                PlanStep(id="s1", action="fetch", status=PlanStepStatus.PENDING),
                PlanStep(id="s2", action="process", status=PlanStepStatus.COMPLETE),
            ],
        )
        vr = validate_result(result)
        assert vr.valid

    def test_error_validation_nested(self):
        """Should include nested error validation results."""
        result = error("", "")  # empty code and message
        vr = validate_result(result)
        assert not vr.valid
        assert any("error." in e.path for e in vr.errors)

    def test_works_with_dict_input(self):
        """Should work with plain dict input."""
        result = {"success": True, "data": {"key": "val"}}
        vr = validate_result(result)
        assert vr.valid


# ==============================================================================
# Test validate_error
# ==============================================================================

class TestValidateError:
    """Tests for validate_error validator."""

    def test_valid_error(self):
        """Should pass for a complete CommandError."""
        err = CommandError(
            code="NOT_FOUND", message="Not found",
            suggestion="Check ID", retryable=False,
        )
        vr = validate_error(err)
        assert vr.valid
        assert len(vr.warnings) == 0

    def test_missing_code(self):
        """Should error when code is missing."""
        err = {"code": "", "message": "Something"}
        vr = validate_error(err)
        assert not vr.valid
        assert any(e.code == "INVALID_ERROR_CODE" for e in vr.errors)

    def test_missing_message(self):
        """Should error when message is missing."""
        err = {"code": "ERR", "message": ""}
        vr = validate_error(err)
        assert not vr.valid
        assert any(e.code == "INVALID_ERROR_MESSAGE" for e in vr.errors)

    def test_missing_suggestion_warning(self):
        """Should warn when suggestion is missing."""
        err = CommandError(code="ERR", message="Error")
        vr = validate_error(err)
        assert vr.valid  # warnings only
        assert any(w.code == "MISSING_SUGGESTION" for w in vr.warnings)

    def test_missing_retryable_warning(self):
        """Should warn when retryable is missing."""
        err = CommandError(code="ERR", message="Error")
        vr = validate_error(err)
        assert any(w.code == "MISSING_RETRYABLE" for w in vr.warnings)

    def test_no_warnings_when_complete(self):
        """Should have no warnings when all fields provided."""
        err = not_found_error("Doc", "123")
        vr = validate_error(err)
        assert vr.valid
        # not_found_error sets suggestion and retryable=False
        assert not any(w.code == "MISSING_SUGGESTION" for w in vr.warnings)
        assert not any(w.code == "MISSING_RETRYABLE" for w in vr.warnings)

    def test_works_with_dict(self):
        """Should work with dict-based errors."""
        err = {"code": "ERR", "message": "Bad", "suggestion": "Fix", "retryable": True}
        vr = validate_error(err)
        assert vr.valid
        assert len(vr.warnings) == 0


# ==============================================================================
# Test validate_command_definition
# ==============================================================================

class TestValidateCommandDefinition:
    """Tests for validate_command_definition validator."""

    @staticmethod
    async def _dummy_handler(input, context=None):
        return success("ok")

    def test_valid_definition(self):
        """Should pass for a well-formed command definition."""
        cmd = CommandDefinition(
            name="todo-create",
            description="Create a new todo item in the list",
            handler=self._dummy_handler,
            category="todos",
            parameters=[
                CommandParameter(
                    name="title", type="string",
                    description="The todo title", required=True,
                ),
            ],
            errors=["VALIDATION_ERROR", "CONFLICT"],
        )
        vr = validate_command_definition(cmd)
        assert vr.valid

    def test_missing_name(self):
        """Should error when name is missing."""
        cmd = CommandDefinition(
            name="",
            description="Does something useful",
            handler=self._dummy_handler,
        )
        vr = validate_command_definition(cmd)
        assert not vr.valid
        assert any(e.code == "MISSING_NAME" for e in vr.errors)

    def test_invalid_name_format(self):
        """Should warn for non-kebab-case names."""
        cmd = CommandDefinition(
            name="todoCreate",
            description="Create a new todo item",
            handler=self._dummy_handler,
        )
        vr = validate_command_definition(cmd)
        # Name format is a warning, not error
        assert any(w.code == "INVALID_NAME_FORMAT" for w in vr.warnings)

    def test_single_word_name_warns(self):
        """Should warn for single-word names (not domain-action)."""
        cmd = CommandDefinition(
            name="create",
            description="Create something useful",
            handler=self._dummy_handler,
        )
        vr = validate_command_definition(cmd)
        assert any(w.code == "INVALID_NAME_FORMAT" for w in vr.warnings)

    def test_missing_description(self):
        """Should error when description is missing."""
        cmd = CommandDefinition(
            name="todo-create",
            description="",
            handler=self._dummy_handler,
        )
        vr = validate_command_definition(cmd)
        assert not vr.valid
        assert any(e.code == "MISSING_DESCRIPTION" for e in vr.errors)

    def test_short_description_warning(self):
        """Should warn for descriptions under 10 chars."""
        cmd = CommandDefinition(
            name="todo-create",
            description="Create",
            handler=self._dummy_handler,
        )
        vr = validate_command_definition(cmd)
        assert any(w.code == "SHORT_DESCRIPTION" for w in vr.warnings)

    def test_missing_handler(self):
        """Should error when handler is not callable."""
        cmd = {"name": "todo-create", "description": "Create a todo", "handler": None, "parameters": []}
        vr = validate_command_definition(cmd)
        assert not vr.valid
        assert any(e.code == "MISSING_HANDLER" for e in vr.errors)

    def test_missing_parameters(self):
        """Should error when parameters is None."""
        cmd = {"name": "todo-create", "description": "Create a todo", "handler": self._dummy_handler, "parameters": None}
        vr = validate_command_definition(cmd)
        assert not vr.valid
        assert any(e.code == "MISSING_PARAMETERS" for e in vr.errors)

    def test_parameter_validation(self):
        """Should validate individual parameter fields."""
        cmd = CommandDefinition(
            name="todo-create",
            description="Create a todo item in list",
            handler=self._dummy_handler,
            parameters=[
                CommandParameter(name="", type="string", description="No name"),
            ],
        )
        vr = validate_command_definition(cmd)
        assert not vr.valid
        assert any(e.code == "MISSING_PARAM_NAME" for e in vr.errors)

    def test_missing_category_warning(self):
        """Should warn when category is missing."""
        cmd = CommandDefinition(
            name="todo-create",
            description="Create a new todo item",
            handler=self._dummy_handler,
        )
        vr = validate_command_definition(cmd)
        assert any(w.code == "MISSING_CATEGORY" for w in vr.warnings)

    def test_missing_error_docs_warning(self):
        """Should warn when error docs are missing."""
        cmd = CommandDefinition(
            name="todo-create",
            description="Create a new todo item",
            handler=self._dummy_handler,
        )
        vr = validate_command_definition(cmd)
        assert any(w.code == "MISSING_ERROR_DOCS" for w in vr.warnings)

    def test_works_with_dict(self):
        """Should work with dict-based definitions."""
        cmd = {
            "name": "todo-create",
            "description": "Create a new todo item in the list",
            "handler": self._dummy_handler,
            "parameters": [],
            "category": "todos",
            "errors": ["VALIDATION_ERROR"],
        }
        vr = validate_command_definition(cmd)
        assert vr.valid
