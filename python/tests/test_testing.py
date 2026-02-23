"""Tests for the AFD testing utilities."""

import pytest
from afd.testing import (
    assert_success,
    assert_error,
    assert_has_confidence,
    assert_has_reasoning,
    assert_has_sources,
    assert_has_plan,
    assert_has_warnings,
    assert_has_alternatives,
    assert_has_suggestion,
    assert_retryable,
    assert_step_status,
    assert_ai_result,
    command_context,
    mock_server,
    isolated_registry,
)
from afd.core import (
    CommandResult,
    CommandError,
    success,
    error,
    Source,
    PlanStep,
    PlanStepStatus,
    Warning,
    Alternative,
)


# ==============================================================================
# Test assert_success
# ==============================================================================

class TestAssertSuccess:
    """Tests for assert_success helper."""
    
    def test_returns_data_on_success(self):
        """Should return data from successful result."""
        result = success({"id": 1, "name": "Alice"})
        data = assert_success(result)
        assert data["id"] == 1
        assert data["name"] == "Alice"
    
    def test_works_with_dict_result(self):
        """Should work with dict-based results."""
        result = {"success": True, "data": {"value": 42}}
        data = assert_success(result)
        assert data["value"] == 42
    
    def test_raises_on_failure(self):
        """Should raise AssertionError on failure result."""
        result = error("TEST_ERROR", "Something went wrong")
        with pytest.raises(AssertionError) as exc_info:
            assert_success(result)
        assert "TEST_ERROR" in str(exc_info.value)
        assert "Something went wrong" in str(exc_info.value)
    
    def test_raises_with_custom_message(self):
        """Should use custom message when provided."""
        result = error("TEST_ERROR", "Failed")
        with pytest.raises(AssertionError) as exc_info:
            assert_success(result, message="Custom failure message")
        assert "Custom failure message" in str(exc_info.value)
    
    def test_works_with_dict_error(self):
        """Should handle dict error structure."""
        result = {
            "success": False,
            "error": {"code": "DICT_ERROR", "message": "Dict error message"}
        }
        with pytest.raises(AssertionError) as exc_info:
            assert_success(result)
        assert "DICT_ERROR" in str(exc_info.value)


class TestAssertError:
    """Tests for assert_error helper."""
    
    def test_returns_error_on_failure(self):
        """Should return error from failure result."""
        result = error("TEST_ERROR", "Something went wrong")
        err = assert_error(result)
        assert err.code == "TEST_ERROR"
        assert err.message == "Something went wrong"
    
    def test_validates_error_code(self):
        """Should validate error code when provided."""
        result = error("SPECIFIC_ERROR", "Message")
        err = assert_error(result, expected_code="SPECIFIC_ERROR")
        assert err.code == "SPECIFIC_ERROR"
    
    def test_raises_on_wrong_code(self):
        """Should raise if error code doesn't match."""
        result = error("ACTUAL_ERROR", "Message")
        with pytest.raises(AssertionError) as exc_info:
            assert_error(result, expected_code="EXPECTED_ERROR")
        assert "EXPECTED_ERROR" in str(exc_info.value)
        assert "ACTUAL_ERROR" in str(exc_info.value)
    
    def test_raises_on_success(self):
        """Should raise AssertionError on success result."""
        result = success({"data": "value"})
        with pytest.raises(AssertionError) as exc_info:
            assert_error(result)
        assert "success" in str(exc_info.value).lower()
    
    def test_works_with_dict_result(self):
        """Should work with dict-based results."""
        result = {
            "success": False,
            "error": {"code": "DICT_ERROR", "message": "Dict message"}
        }
        err = assert_error(result)
        assert err.code == "DICT_ERROR"


class TestAssertHasConfidence:
    """Tests for assert_has_confidence helper."""
    
    def test_returns_confidence(self):
        """Should return confidence value."""
        result = CommandResult(success=True, data="test", confidence=0.85)
        confidence = assert_has_confidence(result)
        assert confidence == 0.85
    
    def test_validates_min_confidence(self):
        """Should validate minimum confidence."""
        result = CommandResult(success=True, data="test", confidence=0.95)
        confidence = assert_has_confidence(result, min_confidence=0.9)
        assert confidence >= 0.9
    
    def test_validates_max_confidence(self):
        """Should validate maximum confidence."""
        result = CommandResult(success=True, data="test", confidence=0.5)
        confidence = assert_has_confidence(result, max_confidence=0.6)
        assert confidence <= 0.6
    
    def test_raises_when_missing(self):
        """Should raise when confidence is None."""
        result = CommandResult(success=True, data="test")
        with pytest.raises(AssertionError) as exc_info:
            assert_has_confidence(result)
        assert "confidence" in str(exc_info.value).lower()
    
    def test_raises_when_out_of_range(self):
        """Should raise when confidence is out of range."""
        result = CommandResult(success=True, data="test", confidence=0.5)
        with pytest.raises(AssertionError):
            assert_has_confidence(result, min_confidence=0.8)


class TestAssertHasReasoning:
    """Tests for assert_has_reasoning helper."""
    
    def test_returns_reasoning(self):
        """Should return reasoning string."""
        result = CommandResult(success=True, data="test", reasoning="Because reasons")
        reasoning = assert_has_reasoning(result)
        assert reasoning == "Because reasons"
    
    def test_validates_contains(self):
        """Should validate substring in reasoning."""
        result = CommandResult(
            success=True, data="test",
            reasoning="Used key points from the document"
        )
        reasoning = assert_has_reasoning(result, contains="key points")
        assert "key points" in reasoning
    
    def test_raises_when_missing(self):
        """Should raise when reasoning is None."""
        result = CommandResult(success=True, data="test")
        with pytest.raises(AssertionError) as exc_info:
            assert_has_reasoning(result)
        assert "reasoning" in str(exc_info.value).lower()
    
    def test_raises_when_not_contains(self):
        """Should raise when substring not in reasoning."""
        result = CommandResult(success=True, data="test", reasoning="Simple reason")
        with pytest.raises(AssertionError):
            assert_has_reasoning(result, contains="complex")


class TestAssertHasSources:
    """Tests for assert_has_sources helper."""
    
    def test_returns_sources(self):
        """Should return list of sources."""
        result = CommandResult(
            success=True, data="test",
            sources=[Source(type="url", title="Doc 1", url="http://example.com")]
        )
        sources = assert_has_sources(result)
        assert len(sources) == 1
        assert sources[0].title == "Doc 1"
    
    def test_validates_min_count(self):
        """Should validate minimum source count."""
        result = CommandResult(
            success=True, data="test",
            sources=[
                Source(type="document", title="Doc 1"),
                Source(type="document", title="Doc 2"),
            ]
        )
        sources = assert_has_sources(result, min_count=2)
        assert len(sources) >= 2
    
    def test_raises_when_missing(self):
        """Should raise when sources is None."""
        result = CommandResult(success=True, data="test")
        with pytest.raises(AssertionError):
            assert_has_sources(result)
    
    def test_raises_when_too_few(self):
        """Should raise when too few sources."""
        result = CommandResult(
            success=True, data="test",
            sources=[Source(type="document", title="Only one")]
        )
        with pytest.raises(AssertionError):
            assert_has_sources(result, min_count=3)


class TestAssertHasPlan:
    """Tests for assert_has_plan helper."""
    
    def test_returns_plan_steps(self):
        """Should return list of plan steps."""
        result = CommandResult(
            success=True, data="test",
            plan=[PlanStep(id="1", action="fetch", status="pending")]
        )
        steps = assert_has_plan(result)
        assert len(steps) == 1
        assert steps[0].id == "1"
    
    def test_validates_min_steps(self):
        """Should validate minimum step count."""
        result = CommandResult(
            success=True, data="test",
            plan=[
                PlanStep(id="1", action="fetch", status="pending"),
                PlanStep(id="2", action="process", status="pending"),
            ]
        )
        steps = assert_has_plan(result, min_steps=2)
        assert len(steps) >= 2
    
    def test_raises_when_missing(self):
        """Should raise when plan is None."""
        result = CommandResult(success=True, data="test")
        with pytest.raises(AssertionError):
            assert_has_plan(result)


class TestAssertHasWarnings:
    """Tests for assert_has_warnings helper."""
    
    def test_returns_warnings(self):
        """Should return list of warnings."""
        result = CommandResult(
            success=True, data="test",
            warnings=[Warning(code="WARN001", message="Be careful")]
        )
        warnings = assert_has_warnings(result)
        assert len(warnings) == 1
        assert warnings[0].message == "Be careful"
    
    def test_raises_when_missing(self):
        """Should raise when warnings is None."""
        result = CommandResult(success=True, data="test")
        with pytest.raises(AssertionError):
            assert_has_warnings(result)


class TestAssertHasAlternatives:
    """Tests for assert_has_alternatives helper."""
    
    def test_returns_alternatives(self):
        """Should return list of alternatives."""
        result = CommandResult(
            success=True, data="primary",
            alternatives=[Alternative(data="alt1", reason="Another option")]
        )
        alts = assert_has_alternatives(result)
        assert len(alts) == 1
        assert alts[0].data == "alt1"
    
    def test_raises_when_missing(self):
        """Should raise when alternatives is None."""
        result = CommandResult(success=True, data="test")
        with pytest.raises(AssertionError):
            assert_has_alternatives(result)


# ==============================================================================
# Test assert_has_suggestion
# ==============================================================================

class TestAssertHasSuggestion:
    """Tests for assert_has_suggestion helper."""

    def test_returns_suggestion(self):
        """Should return the suggestion string."""
        result = error("NOT_FOUND", "Missing", suggestion="Check the ID")
        suggestion = assert_has_suggestion(result)
        assert suggestion == "Check the ID"

    def test_raises_on_success(self):
        """Should raise on a success result (not a failure)."""
        result = success({"id": 1})
        with pytest.raises(AssertionError):
            assert_has_suggestion(result)

    def test_raises_when_no_suggestion(self):
        """Should raise when error has no suggestion."""
        result = error("BROKEN", "Something broke")
        with pytest.raises(AssertionError) as exc_info:
            assert_has_suggestion(result)
        assert "suggestion" in str(exc_info.value).lower()

    def test_custom_message(self):
        """Should use custom message when provided."""
        result = error("BROKEN", "Something broke")
        with pytest.raises(AssertionError) as exc_info:
            assert_has_suggestion(result, message="Custom msg")
        assert "Custom msg" in str(exc_info.value)

    def test_works_with_dict_result(self):
        """Should work with dict-based results."""
        result = {
            "success": False,
            "error": {"code": "ERR", "message": "Bad", "suggestion": "Fix it"},
        }
        suggestion = assert_has_suggestion(result)
        assert suggestion == "Fix it"


# ==============================================================================
# Test assert_retryable
# ==============================================================================

class TestAssertRetryable:
    """Tests for assert_retryable helper."""

    def test_retryable_true(self):
        """Should pass when retryable matches expected True."""
        result = error("TIMEOUT", "Timed out", retryable=True)
        val = assert_retryable(result, expected=True)
        assert val is True

    def test_retryable_false(self):
        """Should pass when retryable matches expected False."""
        result = error("INVALID", "Bad input", retryable=False)
        val = assert_retryable(result, expected=False)
        assert val is False

    def test_raises_on_mismatch(self):
        """Should raise when retryable doesn't match."""
        result = error("TIMEOUT", "Timed out", retryable=False)
        with pytest.raises(AssertionError) as exc_info:
            assert_retryable(result, expected=True)
        assert "True" in str(exc_info.value)
        assert "False" in str(exc_info.value)

    def test_raises_on_success(self):
        """Should raise on a success result."""
        result = success({"id": 1})
        with pytest.raises(AssertionError):
            assert_retryable(result)

    def test_default_expected_is_true(self):
        """Default expected value should be True."""
        result = error("TIMEOUT", "Timed out", retryable=True)
        val = assert_retryable(result)
        assert val is True


# ==============================================================================
# Test assert_step_status
# ==============================================================================

class TestAssertStepStatus:
    """Tests for assert_step_status helper."""

    def test_returns_matching_step(self):
        """Should return the step when status matches."""
        result = CommandResult(
            success=True, data="test",
            plan=[
                PlanStep(id="fetch", action="fetch", status=PlanStepStatus.COMPLETE),
                PlanStep(id="process", action="process", status=PlanStepStatus.PENDING),
            ],
        )
        step = assert_step_status(result, "fetch", "complete")
        assert step.id == "fetch"
        assert step.action == "fetch"

    def test_raises_when_step_not_found(self):
        """Should raise when step ID doesn't exist."""
        result = CommandResult(
            success=True, data="test",
            plan=[PlanStep(id="fetch", action="fetch", status=PlanStepStatus.PENDING)],
        )
        with pytest.raises(AssertionError) as exc_info:
            assert_step_status(result, "missing", "pending")
        assert "missing" in str(exc_info.value)

    def test_raises_when_status_mismatch(self):
        """Should raise when step status doesn't match."""
        result = CommandResult(
            success=True, data="test",
            plan=[PlanStep(id="fetch", action="fetch", status=PlanStepStatus.PENDING)],
        )
        with pytest.raises(AssertionError) as exc_info:
            assert_step_status(result, "fetch", "complete")
        assert "complete" in str(exc_info.value)
        assert "pending" in str(exc_info.value)

    def test_raises_when_no_plan(self):
        """Should raise when result has no plan."""
        result = CommandResult(success=True, data="test")
        with pytest.raises(AssertionError):
            assert_step_status(result, "fetch", "pending")

    def test_works_with_dict_plan(self):
        """Should work with dict-based plan steps."""
        result = {
            "success": True,
            "data": "test",
            "plan": [{"id": "s1", "action": "fetch", "title": "Step 1", "status": "complete"}],
        }
        step = assert_step_status(result, "s1", "complete")
        assert step.id == "s1"


# ==============================================================================
# Test assert_ai_result
# ==============================================================================

class TestAssertAiResult:
    """Tests for assert_ai_result helper."""

    def test_passes_with_valid_ai_result(self):
        """Should pass with confidence and reasoning."""
        result = CommandResult(
            success=True, data={"answer": "42"},
            confidence=0.95, reasoning="Computed from input",
        )
        data = assert_ai_result(result)
        assert data["answer"] == "42"

    def test_raises_when_no_confidence(self):
        """Should raise when confidence is missing."""
        result = CommandResult(
            success=True, data={"answer": "42"},
            reasoning="Because",
        )
        with pytest.raises(AssertionError) as exc_info:
            assert_ai_result(result)
        assert "confidence" in str(exc_info.value).lower()

    def test_raises_when_no_reasoning(self):
        """Should raise when reasoning is missing."""
        result = CommandResult(
            success=True, data={"answer": "42"},
            confidence=0.9,
        )
        with pytest.raises(AssertionError) as exc_info:
            assert_ai_result(result)
        assert "reasoning" in str(exc_info.value).lower()

    def test_min_confidence_threshold(self):
        """Should raise when confidence below minimum."""
        result = CommandResult(
            success=True, data={"answer": "42"},
            confidence=0.5, reasoning="Low confidence",
        )
        with pytest.raises(AssertionError) as exc_info:
            assert_ai_result(result, min_confidence=0.8)
        assert "0.5" in str(exc_info.value)
        assert "0.8" in str(exc_info.value)

    def test_require_sources(self):
        """Should raise when sources required but missing."""
        result = CommandResult(
            success=True, data="test",
            confidence=0.9, reasoning="Reason",
        )
        with pytest.raises(AssertionError) as exc_info:
            assert_ai_result(result, require_sources=True)
        assert "sources" in str(exc_info.value).lower()

    def test_require_alternatives(self):
        """Should raise when alternatives required but missing."""
        result = CommandResult(
            success=True, data="test",
            confidence=0.9, reasoning="Reason",
        )
        with pytest.raises(AssertionError) as exc_info:
            assert_ai_result(result, require_alternatives=True)
        assert "alternatives" in str(exc_info.value).lower()

    def test_passes_with_sources_and_alternatives(self):
        """Should pass when all optional fields are provided."""
        result = CommandResult(
            success=True, data="test",
            confidence=0.95, reasoning="Reason",
            sources=[Source(type="url", title="Doc")],
            alternatives=[Alternative(data="alt", reason="Another option")],
        )
        data = assert_ai_result(
            result,
            min_confidence=0.9,
            require_sources=True,
            require_alternatives=True,
        )
        assert data == "test"

    def test_raises_on_failure_result(self):
        """Should raise on a failure result."""
        result = error("BROKEN", "Nope")
        with pytest.raises(AssertionError):
            assert_ai_result(result)


# ==============================================================================
# Test Fixtures
# ==============================================================================

class TestCommandContextFixture:
    """Tests for the command_context fixture."""
    
    def test_creates_context(self, command_context):
        """Should create a valid context."""
        assert command_context.trace_id == "test-trace-001"
        assert command_context.extra["environment"] == "test"


class TestMockServerFixture:
    """Tests for the mock_server fixture."""
    
    def test_creates_server(self, mock_server):
        """Should create a mock server."""
        assert mock_server is not None
    
    @pytest.mark.asyncio
    async def test_register_and_execute_command(self, mock_server):
        """Should register and execute commands."""
        @mock_server.command("test-ping")
        async def ping(input):
            return success("pong")
        
        result = await mock_server.execute("test-ping", {})
        assert result.success
        assert result.data == "pong"
    
    @pytest.mark.asyncio
    async def test_execute_nonexistent_command(self, mock_server):
        """Should return error for nonexistent command."""
        result = await mock_server.execute("nonexistent", {})
        assert not result.success
        assert result.error.code == "COMMAND_NOT_FOUND"
    
    def test_has_command(self, mock_server):
        """Should check if command exists."""
        @mock_server.command("test-exists")
        async def exists(input):
            return success(True)
        
        assert mock_server.has("test-exists")
        assert not mock_server.has("test-not_exists")
    
    def test_list_commands(self, mock_server):
        """Should list registered commands."""
        @mock_server.command("cmd1")
        async def cmd1(input):
            return success(1)
        
        @mock_server.command("cmd2")
        async def cmd2(input):
            return success(2)
        
        commands = mock_server.list_commands()
        assert "cmd1" in commands
        assert "cmd2" in commands


class TestIsolatedRegistryFixture:
    """Tests for the isolated_registry fixture."""
    
    def test_creates_empty_registry(self, isolated_registry):
        """Should create an empty registry."""
        assert len(isolated_registry.list()) == 0
    
    def test_registrations_are_isolated(self, isolated_registry):
        """Registrations should not affect other tests."""
        # This test just verifies the fixture works
        from afd.core import CommandDefinition
        
        async def test_handler(input):
            return success("test")
        
        definition = CommandDefinition(
            name="isolated-test",
            description="Test command",
            handler=test_handler,
            parameters=[],
        )
        isolated_registry.register(definition)
        
        assert isolated_registry.has("isolated-test")
