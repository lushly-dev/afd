"""Tests for afd.server.validation module."""

import pytest
from pydantic import BaseModel, Field

from afd.server.validation import (
    DateRangeParams,
    EmailStr,
    EnhancedValidationResult,
    PaginationParams,
    SearchParams,
    SortParams,
    UuidStr,
    ValidationError,
    ValidationException,
    ValidationResult,
    format_enhanced_validation_error,
    format_validation_errors,
    is_valid,
    validate_input,
    validate_input_enhanced,
    validate_or_throw,
)


# ── Test helpers ──────────────────────────────────────────────────────────────


class SampleInput(BaseModel):
    name: str
    age: int
    email: str = "default@example.com"


class StrictInput(BaseModel):
    title: str
    count: int = Field(ge=0)


# ═══════════════════════════════════════════════════════════════════════════════
# validate_input
# ═══════════════════════════════════════════════════════════════════════════════


class TestValidateInput:
    def test_valid_data(self):
        result = validate_input(SampleInput, {"name": "Alice", "age": 30})
        assert result.success is True
        assert result.data is not None
        assert result.data.name == "Alice"
        assert result.data.age == 30
        assert result.errors == []

    def test_valid_data_with_defaults(self):
        result = validate_input(SampleInput, {"name": "Bob", "age": 25})
        assert result.success is True
        assert result.data.email == "default@example.com"

    def test_invalid_data_missing_required(self):
        result = validate_input(SampleInput, {"name": "Alice"})
        assert result.success is False
        assert result.data is None
        assert len(result.errors) > 0
        assert any("age" in e.path for e in result.errors)

    def test_invalid_data_wrong_type(self):
        result = validate_input(SampleInput, {"name": "Alice", "age": "not-a-number"})
        assert result.success is False
        assert len(result.errors) > 0

    def test_empty_input(self):
        result = validate_input(SampleInput, {})
        assert result.success is False
        assert len(result.errors) >= 2  # name and age both missing


# ═══════════════════════════════════════════════════════════════════════════════
# validate_input_enhanced
# ═══════════════════════════════════════════════════════════════════════════════


class TestValidateInputEnhanced:
    def test_valid_data(self):
        result = validate_input_enhanced(SampleInput, {"name": "Alice", "age": 30})
        assert result.success is True
        assert result.data is not None
        assert result.errors == []

    def test_detects_unexpected_fields(self):
        result = validate_input_enhanced(
            SampleInput, {"name": "Alice", "age": 30, "extra": "field"}
        )
        # Pydantic ignores extra fields by default, so this may still succeed
        # but if it fails for other reasons, unexpected_fields is populated
        # For strict detection, check with invalid data that also has extras
        result2 = validate_input_enhanced(
            SampleInput, {"extra_field": "val"}
        )
        assert result2.success is False
        assert result2.unexpected_fields is not None
        assert "extra_field" in result2.unexpected_fields

    def test_detects_missing_required_fields(self):
        result = validate_input_enhanced(SampleInput, {})
        assert result.success is False
        assert result.missing_fields is not None
        assert "name" in result.missing_fields
        assert "age" in result.missing_fields
        # 'email' has a default, so it should NOT be in missing_fields
        assert "email" not in result.missing_fields

    def test_reports_expected_fields(self):
        result = validate_input_enhanced(SampleInput, {})
        assert result.success is False
        assert result.expected_fields is not None
        assert "name" in result.expected_fields
        assert "age" in result.expected_fields
        assert "email" in result.expected_fields

    def test_no_field_info_on_success(self):
        result = validate_input_enhanced(SampleInput, {"name": "Alice", "age": 30})
        assert result.success is True
        assert result.expected_fields is None
        assert result.unexpected_fields is None
        assert result.missing_fields is None


# ═══════════════════════════════════════════════════════════════════════════════
# validate_or_throw
# ═══════════════════════════════════════════════════════════════════════════════


class TestValidateOrThrow:
    def test_returns_model_on_success(self):
        model = validate_or_throw(SampleInput, {"name": "Alice", "age": 30})
        assert isinstance(model, SampleInput)
        assert model.name == "Alice"
        assert model.age == 30

    def test_raises_validation_exception_on_failure(self):
        with pytest.raises(ValidationException) as exc_info:
            validate_or_throw(SampleInput, {})
        assert len(exc_info.value.errors) > 0
        assert exc_info.value.code == "VALIDATION_ERROR"


# ═══════════════════════════════════════════════════════════════════════════════
# is_valid
# ═══════════════════════════════════════════════════════════════════════════════


class TestIsValid:
    def test_returns_true_for_valid_data(self):
        assert is_valid(SampleInput, {"name": "Alice", "age": 30}) is True

    def test_returns_false_for_invalid_data(self):
        assert is_valid(SampleInput, {}) is False

    def test_returns_false_for_wrong_types(self):
        assert is_valid(SampleInput, {"name": 123, "age": "not-a-number"}) is False


# ═══════════════════════════════════════════════════════════════════════════════
# format_validation_errors
# ═══════════════════════════════════════════════════════════════════════════════


class TestFormatValidationErrors:
    def test_no_errors(self):
        assert format_validation_errors([]) == "No validation errors"

    def test_single_field_error(self):
        err = ValidationError(path="name", message="Field required", code="missing")
        result = format_validation_errors([err])
        assert result == "name: Field required"

    def test_single_root_error(self):
        err = ValidationError(path="(root)", message="Invalid input", code="invalid")
        result = format_validation_errors([err])
        assert result == "Invalid input"

    def test_multiple_errors(self):
        errors = [
            ValidationError(path="name", message="required", code="missing"),
            ValidationError(path="age", message="must be int", code="type_error"),
        ]
        result = format_validation_errors(errors)
        assert "- name: required" in result
        assert "- age: must be int" in result

    def test_multiple_errors_with_root(self):
        errors = [
            ValidationError(path="(root)", message="bad input", code="invalid"),
            ValidationError(path="field", message="wrong", code="err"),
        ]
        result = format_validation_errors(errors)
        assert "- bad input" in result
        assert "- field: wrong" in result


# ═══════════════════════════════════════════════════════════════════════════════
# format_enhanced_validation_error
# ═══════════════════════════════════════════════════════════════════════════════


class TestFormatEnhancedValidationError:
    def test_with_errors_and_schema_info(self):
        errors = [ValidationError(path="x", message="bad", code="err")]
        info = {
            "unexpected_fields": ["x"],
            "missing_fields": ["name"],
            "expected_fields": ["name", "age"],
        }
        result = format_enhanced_validation_error(errors, info)
        assert "x: bad" in result
        assert "Unknown field(s): x" in result
        assert "Missing required field(s): name" in result
        assert "Expected fields: name, age" in result

    def test_with_errors_only(self):
        errors = [ValidationError(path="a", message="msg", code="c")]
        result = format_enhanced_validation_error(errors)
        assert "a: msg" in result

    def test_with_empty_schema_info(self):
        errors = [ValidationError(path="a", message="msg", code="c")]
        result = format_enhanced_validation_error(
            errors, {"unexpected_fields": None, "missing_fields": None, "expected_fields": None}
        )
        assert result == "a: msg"


# ═══════════════════════════════════════════════════════════════════════════════
# ValidationException
# ═══════════════════════════════════════════════════════════════════════════════


class TestValidationException:
    def test_construction(self):
        errors = [
            ValidationError(path="name", message="required", code="missing"),
        ]
        exc = ValidationException(errors)
        assert exc.code == "VALIDATION_ERROR"
        assert len(exc.errors) == 1
        assert "name: required" in str(exc)

    def test_to_command_error(self):
        errors = [
            ValidationError(path="name", message="required", code="missing"),
        ]
        exc = ValidationException(errors)
        cmd_err = exc.to_command_error()
        assert cmd_err.code == "VALIDATION_ERROR"
        assert cmd_err.message == "Input validation failed"
        assert cmd_err.suggestion is not None
        assert cmd_err.details is not None
        assert len(cmd_err.details["errors"]) == 1


# ═══════════════════════════════════════════════════════════════════════════════
# PATTERNS
# ═══════════════════════════════════════════════════════════════════════════════


class TestUuidStr:
    def test_valid_uuid(self):
        class M(BaseModel):
            id: UuidStr

        m = M(id="550e8400-e29b-41d4-a716-446655440000")
        assert m.id == "550e8400-e29b-41d4-a716-446655440000"

    def test_invalid_uuid(self):
        class M(BaseModel):
            id: UuidStr

        with pytest.raises(Exception):
            M(id="not-a-uuid")


class TestEmailStr:
    def test_valid_email(self):
        class M(BaseModel):
            email: EmailStr

        m = M(email="alice@example.com")
        assert m.email == "alice@example.com"

    def test_invalid_email(self):
        class M(BaseModel):
            email: EmailStr

        with pytest.raises(Exception):
            M(email="not-an-email")


class TestPaginationParams:
    def test_defaults(self):
        params = PaginationParams()
        assert params.limit == 20
        assert params.offset == 0

    def test_custom_values(self):
        params = PaginationParams(limit=50, offset=10)
        assert params.limit == 50
        assert params.offset == 10

    def test_limit_lower_bound(self):
        with pytest.raises(Exception):
            PaginationParams(limit=0)

    def test_limit_upper_bound(self):
        with pytest.raises(Exception):
            PaginationParams(limit=101)

    def test_offset_non_negative(self):
        with pytest.raises(Exception):
            PaginationParams(offset=-1)


class TestSortParams:
    def test_defaults(self):
        params = SortParams(sort_by="created_at")
        assert params.sort_by == "created_at"
        assert params.sort_order == "asc"

    def test_desc_order(self):
        params = SortParams(sort_by="name", sort_order="desc")
        assert params.sort_order == "desc"

    def test_invalid_order(self):
        with pytest.raises(Exception):
            SortParams(sort_by="name", sort_order="invalid")


class TestSearchParams:
    def test_valid_query(self):
        params = SearchParams(query="hello world")
        assert params.query == "hello world"

    def test_empty_query_rejected(self):
        with pytest.raises(Exception):
            SearchParams(query="")

    def test_long_query_rejected(self):
        with pytest.raises(Exception):
            SearchParams(query="x" * 501)


class TestDateRangeParams:
    def test_valid_range(self):
        params = DateRangeParams(start="2025-01-01", end="2025-12-31")
        assert params.start == "2025-01-01"
        assert params.end == "2025-12-31"

    def test_end_before_start_rejected(self):
        with pytest.raises(Exception):
            DateRangeParams(start="2025-12-31", end="2025-01-01")

    def test_equal_dates_rejected(self):
        with pytest.raises(Exception):
            DateRangeParams(start="2025-06-15", end="2025-06-15")

    def test_non_iso_dates_pass_through(self):
        # Non-parseable dates skip the comparison validator
        params = DateRangeParams(start="not-a-date", end="also-not-a-date")
        assert params.start == "not-a-date"
