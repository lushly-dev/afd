"""Tests for afd.server.handoff_schemas module."""

import pytest
from pydantic import ValidationError

from afd.server.handoff_schemas import (
    HandoffCredentialsSchema,
    HandoffMetadataSchema,
    HandoffResultSchema,
    ReconnectPolicySchema,
    validate_handoff,
)


# ═══════════════════════════════════════════════════════════════════════════════
# HandoffCredentialsSchema
# ═══════════════════════════════════════════════════════════════════════════════


class TestHandoffCredentialsSchema:
    def test_empty_credentials(self):
        creds = HandoffCredentialsSchema()
        assert creds.token is None
        assert creds.headers is None
        assert creds.session_id is None

    def test_full_credentials(self):
        creds = HandoffCredentialsSchema(
            token="bearer-token",
            session_id="session-123",
            headers={"Authorization": "Bearer xyz"},
        )
        assert creds.token == "bearer-token"
        assert creds.session_id == "session-123"
        assert creds.headers == {"Authorization": "Bearer xyz"}

    def test_round_trip_serialization(self):
        creds = HandoffCredentialsSchema(token="abc", session_id="s-1")
        data = creds.model_dump()
        restored = HandoffCredentialsSchema.model_validate(data)
        assert restored.token == "abc"
        assert restored.session_id == "s-1"


# ═══════════════════════════════════════════════════════════════════════════════
# HandoffMetadataSchema
# ═══════════════════════════════════════════════════════════════════════════════


class TestHandoffMetadataSchema:
    def test_empty_metadata(self):
        meta = HandoffMetadataSchema()
        assert meta.expected_latency is None
        assert meta.capabilities is None
        assert meta.expires_at is None

    def test_valid_iso_datetime(self):
        meta = HandoffMetadataSchema(expires_at="2025-01-15T12:00:00Z")
        assert meta.expires_at == "2025-01-15T12:00:00Z"

    def test_valid_iso_datetime_with_offset(self):
        meta = HandoffMetadataSchema(expires_at="2025-01-15T12:00:00+05:30")
        assert meta.expires_at == "2025-01-15T12:00:00+05:30"

    def test_invalid_expires_at_rejected(self):
        with pytest.raises(ValidationError):
            HandoffMetadataSchema(expires_at="not-a-date")

    def test_full_metadata(self):
        meta = HandoffMetadataSchema(
            expected_latency=50,
            capabilities=["text", "presence"],
            expires_at="2025-12-31T23:59:59Z",
            reconnect=ReconnectPolicySchema(allowed=True, max_attempts=5, backoff_ms=1000),
            description="Real-time chat",
        )
        assert meta.expected_latency == 50
        assert meta.capabilities == ["text", "presence"]
        assert meta.reconnect.allowed is True
        assert meta.reconnect.max_attempts == 5

    def test_round_trip_serialization(self):
        meta = HandoffMetadataSchema(
            expires_at="2025-06-15T10:00:00Z",
            capabilities=["text"],
        )
        data = meta.model_dump()
        restored = HandoffMetadataSchema.model_validate(data)
        assert restored.expires_at == "2025-06-15T10:00:00Z"
        assert restored.capabilities == ["text"]


# ═══════════════════════════════════════════════════════════════════════════════
# HandoffResultSchema
# ═══════════════════════════════════════════════════════════════════════════════


class TestHandoffResultSchema:
    def test_minimal_result(self):
        result = HandoffResultSchema(
            protocol="websocket",
            endpoint="wss://chat.example.com/room/123",
        )
        assert result.protocol == "websocket"
        assert str(result.endpoint) == "wss://chat.example.com/room/123"

    def test_full_result(self):
        result = HandoffResultSchema(
            protocol="websocket",
            endpoint="wss://chat.example.com/room/123",
            credentials=HandoffCredentialsSchema(token="abc"),
            metadata=HandoffMetadataSchema(
                capabilities=["text"],
                expires_at="2025-12-31T23:59:59Z",
            ),
        )
        assert result.credentials.token == "abc"
        assert result.metadata.capabilities == ["text"]

    def test_invalid_url_rejected(self):
        with pytest.raises(ValidationError):
            HandoffResultSchema(
                protocol="websocket",
                endpoint="not-a-url",
            )

    def test_empty_protocol_rejected(self):
        with pytest.raises(ValidationError):
            HandoffResultSchema(
                protocol="",
                endpoint="wss://chat.example.com/room/123",
            )

    def test_invalid_data_types_rejected(self):
        with pytest.raises(ValidationError):
            HandoffResultSchema(
                protocol=123,
                endpoint="wss://chat.example.com",
            )

    def test_round_trip_serialization(self):
        result = HandoffResultSchema(
            protocol="sse",
            endpoint="https://stream.example.com/events",
            credentials=HandoffCredentialsSchema(token="t1"),
        )
        data = result.model_dump()
        # endpoint serializes to Url object, convert to string for round-trip
        data["endpoint"] = str(data["endpoint"])
        restored = HandoffResultSchema.model_validate(data)
        assert restored.protocol == "sse"
        assert str(restored.endpoint) == "https://stream.example.com/events"


# ═══════════════════════════════════════════════════════════════════════════════
# validate_handoff
# ═══════════════════════════════════════════════════════════════════════════════


class TestValidateHandoff:
    def test_valid_handoff(self):
        result = validate_handoff({
            "protocol": "websocket",
            "endpoint": "wss://chat.example.com/room/123",
        })
        assert result.protocol == "websocket"

    def test_invalid_handoff_raises(self):
        with pytest.raises(ValidationError):
            validate_handoff({"protocol": "ws", "endpoint": "not-a-url"})

    def test_missing_fields_raises(self):
        with pytest.raises(ValidationError):
            validate_handoff({})
