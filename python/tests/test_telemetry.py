"""Tests for afd.core.telemetry module."""

import json

from afd.core.errors import CommandError
from afd.core.telemetry import (
    ConsoleTelemetrySink,
    TelemetryEvent,
    TelemetrySink,
    create_telemetry_event,
    is_telemetry_event,
)


class TestTelemetryEvent:
    """Tests for TelemetryEvent Pydantic model."""

    def test_creates_event_with_required_fields(self):
        """Test creating a TelemetryEvent with only required fields."""
        event = TelemetryEvent(
            command_name="todo-create",
            started_at="2024-01-15T10:30:00.000Z",
            completed_at="2024-01-15T10:30:00.150Z",
            duration_ms=150,
            success=True,
        )
        assert event.command_name == "todo-create"
        assert event.started_at == "2024-01-15T10:30:00.000Z"
        assert event.completed_at == "2024-01-15T10:30:00.150Z"
        assert event.duration_ms == 150
        assert event.success is True

    def test_optional_fields_default_to_none(self):
        """Test that optional fields default to None."""
        event = TelemetryEvent(
            command_name="test-cmd",
            started_at="2024-01-15T10:30:00.000Z",
            completed_at="2024-01-15T10:30:00.100Z",
            duration_ms=100,
            success=True,
        )
        assert event.error is None
        assert event.trace_id is None
        assert event.confidence is None
        assert event.metadata is None
        assert event.input is None
        assert event.command_version is None

    def test_creates_event_with_all_fields(self):
        """Test creating a TelemetryEvent with all fields."""
        error = CommandError(code="NOT_FOUND", message="Item not found")
        event = TelemetryEvent(
            command_name="todo-create",
            started_at="2024-01-15T10:30:00.000Z",
            completed_at="2024-01-15T10:30:00.150Z",
            duration_ms=150,
            success=False,
            error=error,
            trace_id="trace-abc123",
            confidence=0.95,
            metadata={"region": "us-east"},
            input={"title": "Test"},
            command_version="1.0.0",
        )
        assert event.error.code == "NOT_FOUND"
        assert event.trace_id == "trace-abc123"
        assert event.confidence == 0.95
        assert event.metadata == {"region": "us-east"}
        assert event.input == {"title": "Test"}
        assert event.command_version == "1.0.0"

    def test_model_dump_excludes_none(self):
        """Test that model_dump with exclude_none omits unset optional fields."""
        event = TelemetryEvent(
            command_name="test-cmd",
            started_at="2024-01-15T10:30:00.000Z",
            completed_at="2024-01-15T10:30:00.100Z",
            duration_ms=100,
            success=True,
        )
        data = event.model_dump(exclude_none=True)
        assert "error" not in data
        assert "trace_id" not in data
        assert "confidence" not in data
        assert "metadata" not in data
        assert "input" not in data
        assert "command_version" not in data

    def test_model_dump_includes_all_set_fields(self):
        """Test that model_dump includes all fields when set."""
        event = TelemetryEvent(
            command_name="test-cmd",
            started_at="2024-01-15T10:30:00.000Z",
            completed_at="2024-01-15T10:30:00.100Z",
            duration_ms=100,
            success=True,
            trace_id="trace-123",
            confidence=0.8,
        )
        data = event.model_dump(exclude_none=True)
        assert data["trace_id"] == "trace-123"
        assert data["confidence"] == 0.8

    def test_serialization_roundtrip(self):
        """Test JSON serialization and deserialization."""
        event = TelemetryEvent(
            command_name="todo-create",
            started_at="2024-01-15T10:30:00.000Z",
            completed_at="2024-01-15T10:30:00.150Z",
            duration_ms=150,
            success=True,
            trace_id="trace-abc",
        )
        json_str = event.model_dump_json(exclude_none=True)
        restored = TelemetryEvent.model_validate_json(json_str)
        assert restored.command_name == event.command_name
        assert restored.duration_ms == event.duration_ms
        assert restored.trace_id == event.trace_id


class TestCreateTelemetryEvent:
    """Tests for create_telemetry_event factory function."""

    def test_creates_event_with_required_fields(self):
        """Test creating event with minimum required fields."""
        event = create_telemetry_event(
            command_name="todo-create",
            started_at="2024-01-15T10:30:00.000Z",
            completed_at="2024-01-15T10:30:00.150Z",
            success=True,
        )
        assert event.command_name == "todo-create"
        assert event.started_at == "2024-01-15T10:30:00.000Z"
        assert event.completed_at == "2024-01-15T10:30:00.150Z"
        assert event.duration_ms == 150.0
        assert event.success is True

    def test_auto_calculates_duration_ms(self):
        """Test that duration_ms is calculated from timestamps."""
        event = create_telemetry_event(
            command_name="test-cmd",
            started_at="2024-01-15T10:30:00.000Z",
            completed_at="2024-01-15T10:30:00.150Z",
            success=True,
        )
        assert event.duration_ms == 150.0

    def test_uses_provided_duration_ms_over_calculated(self):
        """Test that explicit duration_ms overrides auto-calculation."""
        event = create_telemetry_event(
            command_name="test-cmd",
            started_at="2024-01-15T10:30:00.000Z",
            completed_at="2024-01-15T10:30:00.150Z",
            duration_ms=200,
            success=True,
        )
        assert event.duration_ms == 200

    def test_includes_optional_fields_when_provided(self):
        """Test that optional fields are included when provided."""
        error = CommandError(code="NOT_FOUND", message="Item not found")
        event = create_telemetry_event(
            command_name="todo-create",
            started_at="2024-01-15T10:30:00.000Z",
            completed_at="2024-01-15T10:30:00.150Z",
            success=False,
            error=error,
            trace_id="trace-abc123",
            confidence=0.95,
            metadata={"region": "us-east"},
            input={"title": "Test"},
            command_version="1.0.0",
        )
        assert event.error.code == "NOT_FOUND"
        assert event.trace_id == "trace-abc123"
        assert event.confidence == 0.95
        assert event.metadata == {"region": "us-east"}
        assert event.input == {"title": "Test"}
        assert event.command_version == "1.0.0"

    def test_excludes_undefined_optional_fields(self):
        """Test that optional fields are not set when not provided."""
        event = create_telemetry_event(
            command_name="test-cmd",
            started_at="2024-01-15T10:30:00.000Z",
            completed_at="2024-01-15T10:30:00.100Z",
            success=True,
        )
        assert event.error is None
        assert event.trace_id is None
        assert event.confidence is None
        assert event.metadata is None
        assert event.input is None
        assert event.command_version is None


class TestIsTelemetryEvent:
    """Tests for is_telemetry_event type guard."""

    def test_returns_true_for_telemetry_event_instance(self):
        """Test that TelemetryEvent instances pass the guard."""
        event = TelemetryEvent(
            command_name="test-cmd",
            started_at="2024-01-15T10:30:00.000Z",
            completed_at="2024-01-15T10:30:00.100Z",
            duration_ms=100,
            success=True,
        )
        assert is_telemetry_event(event) is True

    def test_returns_true_for_valid_dict(self):
        """Test that valid dicts pass the guard."""
        event = {
            "command_name": "test-cmd",
            "started_at": "2024-01-15T10:30:00.000Z",
            "completed_at": "2024-01-15T10:30:00.100Z",
            "duration_ms": 100,
            "success": True,
        }
        assert is_telemetry_event(event) is True

    def test_returns_true_for_dict_with_all_optional_fields(self):
        """Test that dict with all fields passes the guard."""
        event = {
            "command_name": "test-cmd",
            "started_at": "2024-01-15T10:30:00.000Z",
            "completed_at": "2024-01-15T10:30:00.100Z",
            "duration_ms": 100,
            "success": False,
            "error": {"code": "ERROR", "message": "Failed"},
            "trace_id": "trace-123",
            "confidence": 0.5,
            "metadata": {},
            "input": {},
            "command_version": "1.0.0",
        }
        assert is_telemetry_event(event) is True

    def test_returns_false_for_none(self):
        """Test that None fails the guard."""
        assert is_telemetry_event(None) is False

    def test_returns_false_for_non_objects(self):
        """Test that non-dict types fail the guard."""
        assert is_telemetry_event("string") is False
        assert is_telemetry_event(123) is False
        assert is_telemetry_event(True) is False

    def test_returns_false_for_empty_dict(self):
        """Test that empty dict fails the guard."""
        assert is_telemetry_event({}) is False

    def test_returns_false_when_required_fields_missing(self):
        """Test that partial dicts fail the guard."""
        assert is_telemetry_event({"command_name": "test"}) is False
        assert is_telemetry_event({
            "command_name": "test",
            "started_at": "2024-01-15T10:30:00.000Z",
        }) is False

    def test_returns_false_when_command_name_wrong_type(self):
        """Test that wrong type for command_name fails the guard."""
        assert is_telemetry_event({
            "command_name": 123,
            "started_at": "2024-01-15T10:30:00.000Z",
            "completed_at": "2024-01-15T10:30:00.100Z",
            "duration_ms": 100,
            "success": True,
        }) is False

    def test_returns_false_when_duration_ms_wrong_type(self):
        """Test that wrong type for duration_ms fails the guard."""
        assert is_telemetry_event({
            "command_name": "test",
            "started_at": "2024-01-15T10:30:00.000Z",
            "completed_at": "2024-01-15T10:30:00.100Z",
            "duration_ms": "100",
            "success": True,
        }) is False

    def test_returns_false_when_success_wrong_type(self):
        """Test that wrong type for success fails the guard."""
        assert is_telemetry_event({
            "command_name": "test",
            "started_at": "2024-01-15T10:30:00.000Z",
            "completed_at": "2024-01-15T10:30:00.100Z",
            "duration_ms": 100,
            "success": "true",
        }) is False

    def test_accepts_int_duration_ms(self):
        """Test that integer duration_ms is accepted."""
        event = {
            "command_name": "test-cmd",
            "started_at": "2024-01-15T10:30:00.000Z",
            "completed_at": "2024-01-15T10:30:00.100Z",
            "duration_ms": 100,
            "success": True,
        }
        assert is_telemetry_event(event) is True


class TestConsoleTelemetrySink:
    """Tests for ConsoleTelemetrySink."""

    def test_implements_telemetry_sink_protocol(self):
        """Test that ConsoleTelemetrySink satisfies TelemetrySink protocol."""
        sink = ConsoleTelemetrySink()
        assert isinstance(sink, TelemetrySink)

    def test_text_format_output(self, capsys):
        """Test human-readable text format output."""
        sink = ConsoleTelemetrySink(format="text")
        event = TelemetryEvent(
            command_name="todo-create",
            started_at="2024-01-15T10:30:00.000Z",
            completed_at="2024-01-15T10:30:00.150Z",
            duration_ms=150,
            success=True,
        )
        sink.record(event)
        captured = capsys.readouterr()
        assert "[TELEMETRY] todo-create" in captured.err
        assert "success=True" in captured.err
        assert "duration=150" in captured.err

    def test_text_format_with_trace_id(self, capsys):
        """Test text format includes trace_id when present."""
        sink = ConsoleTelemetrySink(format="text")
        event = TelemetryEvent(
            command_name="todo-create",
            started_at="2024-01-15T10:30:00.000Z",
            completed_at="2024-01-15T10:30:00.150Z",
            duration_ms=150,
            success=True,
            trace_id="trace-abc",
        )
        sink.record(event)
        captured = capsys.readouterr()
        assert "trace=trace-abc" in captured.err

    def test_text_format_with_error(self, capsys):
        """Test text format includes error code when present."""
        sink = ConsoleTelemetrySink(format="text")
        event = TelemetryEvent(
            command_name="todo-create",
            started_at="2024-01-15T10:30:00.000Z",
            completed_at="2024-01-15T10:30:00.150Z",
            duration_ms=150,
            success=False,
            error=CommandError(code="NOT_FOUND", message="Not found"),
        )
        sink.record(event)
        captured = capsys.readouterr()
        assert "error=NOT_FOUND" in captured.err

    def test_json_format_output(self, capsys):
        """Test JSON format output."""
        sink = ConsoleTelemetrySink(format="json")
        event = TelemetryEvent(
            command_name="todo-create",
            started_at="2024-01-15T10:30:00.000Z",
            completed_at="2024-01-15T10:30:00.150Z",
            duration_ms=150,
            success=True,
            trace_id="trace-abc",
        )
        sink.record(event)
        captured = capsys.readouterr()
        data = json.loads(captured.err)
        assert data["command_name"] == "todo-create"
        assert data["duration_ms"] == 150
        assert data["success"] is True
        assert data["trace_id"] == "trace-abc"

    def test_json_format_excludes_none_fields(self, capsys):
        """Test that JSON format excludes None fields."""
        sink = ConsoleTelemetrySink(format="json")
        event = TelemetryEvent(
            command_name="test-cmd",
            started_at="2024-01-15T10:30:00.000Z",
            completed_at="2024-01-15T10:30:00.100Z",
            duration_ms=100,
            success=True,
        )
        sink.record(event)
        captured = capsys.readouterr()
        data = json.loads(captured.err)
        assert "error" not in data
        assert "trace_id" not in data
        assert "confidence" not in data

    def test_default_format_is_text(self, capsys):
        """Test that default format is text."""
        sink = ConsoleTelemetrySink()
        event = TelemetryEvent(
            command_name="test-cmd",
            started_at="2024-01-15T10:30:00.000Z",
            completed_at="2024-01-15T10:30:00.100Z",
            duration_ms=100,
            success=True,
        )
        sink.record(event)
        captured = capsys.readouterr()
        assert "[TELEMETRY]" in captured.err

    def test_flush(self):
        """Test that flush does not raise."""
        sink = ConsoleTelemetrySink()
        sink.flush()
