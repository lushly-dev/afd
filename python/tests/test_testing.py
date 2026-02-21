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
