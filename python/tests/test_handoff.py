"""Tests for afd.core.handoff module."""

import pytest

from afd.core.handoff import (
    HandoffCredentials,
    HandoffMetadata,
    HandoffResult,
    ReconnectPolicy,
    create_handoff,
    get_handoff_protocol,
    is_handoff,
    is_handoff_command,
    is_handoff_protocol,
)


class TestHandoffResult:
    """Tests for HandoffResult Pydantic model."""

    def test_minimal_handoff_result(self):
        """Test creating a HandoffResult with only required fields."""
        result = HandoffResult(
            protocol="websocket",
            endpoint="wss://example.com/chat",
        )
        assert result.protocol == "websocket"
        assert result.endpoint == "wss://example.com/chat"
        assert result.credentials is None
        assert result.metadata is None

    def test_full_handoff_result(self):
        """Test creating a HandoffResult with all fields."""
        result = HandoffResult(
            protocol="websocket",
            endpoint="wss://example.com/chat",
            credentials=HandoffCredentials(
                token="abc123",
                session_id="session-xyz",
                headers={"X-Custom": "value"},
            ),
            metadata=HandoffMetadata(
                expected_latency=50,
                capabilities=["text", "presence"],
                expires_at="2025-01-15T12:00:00Z",
                reconnect=ReconnectPolicy(
                    allowed=True,
                    max_attempts=5,
                    backoff_ms=1000,
                ),
                description="Chat connection",
            ),
        )
        assert result.protocol == "websocket"
        assert result.endpoint == "wss://example.com/chat"
        assert result.credentials.token == "abc123"
        assert result.credentials.session_id == "session-xyz"
        assert result.credentials.headers == {"X-Custom": "value"}
        assert result.metadata.expected_latency == 50
        assert result.metadata.capabilities == ["text", "presence"]
        assert result.metadata.reconnect.allowed is True
        assert result.metadata.reconnect.max_attempts == 5

    def test_custom_protocol(self):
        """Test creating a HandoffResult with a custom protocol."""
        result = HandoffResult(
            protocol="my-custom-protocol",
            endpoint="custom://example.com/stream",
        )
        assert result.protocol == "my-custom-protocol"

    def test_protocol_cannot_be_empty(self):
        """Test that protocol cannot be an empty string."""
        with pytest.raises(ValueError):
            HandoffResult(protocol="", endpoint="wss://example.com")

    def test_endpoint_cannot_be_empty(self):
        """Test that endpoint cannot be an empty string."""
        with pytest.raises(ValueError):
            HandoffResult(protocol="websocket", endpoint="")

    def test_model_dump(self):
        """Test converting HandoffResult to dict."""
        result = HandoffResult(
            protocol="websocket",
            endpoint="wss://example.com/chat",
            credentials=HandoffCredentials(token="abc123"),
        )
        data = result.model_dump()
        assert data["protocol"] == "websocket"
        assert data["endpoint"] == "wss://example.com/chat"
        assert data["credentials"]["token"] == "abc123"


class TestHandoffCredentials:
    """Tests for HandoffCredentials Pydantic model."""

    def test_empty_credentials(self):
        """Test creating empty credentials."""
        creds = HandoffCredentials()
        assert creds.token is None
        assert creds.session_id is None
        assert creds.headers is None

    def test_full_credentials(self):
        """Test creating credentials with all fields."""
        creds = HandoffCredentials(
            token="bearer-token",
            session_id="session-123",
            headers={"Authorization": "Bearer xyz"},
        )
        assert creds.token == "bearer-token"
        assert creds.session_id == "session-123"
        assert creds.headers == {"Authorization": "Bearer xyz"}


class TestHandoffMetadata:
    """Tests for HandoffMetadata Pydantic model."""

    def test_empty_metadata(self):
        """Test creating empty metadata."""
        meta = HandoffMetadata()
        assert meta.expected_latency is None
        assert meta.capabilities is None
        assert meta.expires_at is None
        assert meta.reconnect is None
        assert meta.description is None

    def test_full_metadata(self):
        """Test creating metadata with all fields."""
        meta = HandoffMetadata(
            expected_latency=100,
            capabilities=["text", "typing", "presence"],
            expires_at="2025-12-31T23:59:59Z",
            reconnect=ReconnectPolicy(allowed=True, max_attempts=3, backoff_ms=500),
            description="Real-time messaging",
        )
        assert meta.expected_latency == 100
        assert meta.capabilities == ["text", "typing", "presence"]
        assert meta.expires_at == "2025-12-31T23:59:59Z"
        assert meta.reconnect.allowed is True
        assert meta.reconnect.max_attempts == 3
        assert meta.reconnect.backoff_ms == 500
        assert meta.description == "Real-time messaging"


class TestReconnectPolicy:
    """Tests for ReconnectPolicy Pydantic model."""

    def test_minimal_reconnect(self):
        """Test creating a reconnect policy with only required field."""
        policy = ReconnectPolicy(allowed=True)
        assert policy.allowed is True
        assert policy.max_attempts is None
        assert policy.backoff_ms is None

    def test_reconnect_not_allowed(self):
        """Test creating a reconnect policy that disallows reconnection."""
        policy = ReconnectPolicy(allowed=False)
        assert policy.allowed is False

    def test_full_reconnect_policy(self):
        """Test creating a reconnect policy with all fields."""
        policy = ReconnectPolicy(allowed=True, max_attempts=10, backoff_ms=2000)
        assert policy.allowed is True
        assert policy.max_attempts == 10
        assert policy.backoff_ms == 2000


class TestIsHandoff:
    """Tests for is_handoff type guard function."""

    def test_returns_true_for_valid_minimal_handoff(self):
        """Test that is_handoff returns True for valid minimal HandoffResult."""
        handoff = {"protocol": "websocket", "endpoint": "wss://example.com/chat"}
        assert is_handoff(handoff) is True

    def test_returns_true_for_handoff_with_all_fields(self):
        """Test that is_handoff returns True for HandoffResult with all fields."""
        handoff = {
            "protocol": "websocket",
            "endpoint": "wss://example.com/chat",
            "credentials": {
                "token": "abc123",
                "session_id": "session-xyz",
                "headers": {"X-Custom": "value"},
            },
            "metadata": {
                "expected_latency": 50,
                "capabilities": ["text", "presence"],
                "expires_at": "2025-01-15T12:00:00Z",
                "reconnect": {"allowed": True, "max_attempts": 5, "backoff_ms": 1000},
                "description": "Chat connection",
            },
        }
        assert is_handoff(handoff) is True

    def test_returns_true_for_custom_protocol(self):
        """Test that is_handoff returns True for custom protocol."""
        handoff = {"protocol": "custom-protocol", "endpoint": "custom://example.com/stream"}
        assert is_handoff(handoff) is True

    def test_returns_false_for_none(self):
        """Test that is_handoff returns False for None."""
        assert is_handoff(None) is False

    def test_returns_false_for_non_dict(self):
        """Test that is_handoff returns False for non-dict types."""
        assert is_handoff("string") is False
        assert is_handoff(123) is False
        assert is_handoff(True) is False
        assert is_handoff([]) is False

    def test_returns_false_when_protocol_missing(self):
        """Test that is_handoff returns False when protocol is missing."""
        assert is_handoff({"endpoint": "wss://example.com/chat"}) is False

    def test_returns_false_when_endpoint_missing(self):
        """Test that is_handoff returns False when endpoint is missing."""
        assert is_handoff({"protocol": "websocket"}) is False

    def test_returns_false_when_protocol_empty(self):
        """Test that is_handoff returns False when protocol is empty string."""
        assert is_handoff({"protocol": "", "endpoint": "wss://example.com"}) is False

    def test_returns_false_when_endpoint_empty(self):
        """Test that is_handoff returns False when endpoint is empty string."""
        assert is_handoff({"protocol": "websocket", "endpoint": ""}) is False

    def test_returns_false_when_protocol_wrong_type(self):
        """Test that is_handoff returns False when protocol is wrong type."""
        assert is_handoff({"protocol": 123, "endpoint": "wss://example.com"}) is False

    def test_returns_false_when_credentials_wrong_type(self):
        """Test that is_handoff returns False when credentials is wrong type."""
        handoff = {"protocol": "websocket", "endpoint": "wss://example.com", "credentials": "invalid"}
        assert is_handoff(handoff) is False

    def test_returns_false_when_credentials_token_wrong_type(self):
        """Test that is_handoff returns False when credentials.token is wrong type."""
        handoff = {
            "protocol": "websocket",
            "endpoint": "wss://example.com",
            "credentials": {"token": 123},
        }
        assert is_handoff(handoff) is False

    def test_returns_false_when_metadata_reconnect_allowed_missing(self):
        """Test that is_handoff returns False when metadata.reconnect.allowed is missing."""
        handoff = {
            "protocol": "websocket",
            "endpoint": "wss://example.com",
            "metadata": {"reconnect": {"max_attempts": 5}},
        }
        assert is_handoff(handoff) is False


class TestIsHandoffProtocol:
    """Tests for is_handoff_protocol function."""

    def test_returns_true_when_protocol_matches(self):
        """Test that is_handoff_protocol returns True when protocol matches."""
        handoff = {"protocol": "websocket", "endpoint": "wss://example.com"}
        assert is_handoff_protocol(handoff, "websocket") is True

    def test_returns_false_when_protocol_does_not_match(self):
        """Test that is_handoff_protocol returns False when protocol doesn't match."""
        handoff = {"protocol": "websocket", "endpoint": "wss://example.com"}
        assert is_handoff_protocol(handoff, "sse") is False

    def test_works_with_standard_protocols(self):
        """Test that is_handoff_protocol works with all standard protocols."""
        protocols = ["websocket", "webrtc", "sse", "http-stream"]
        for protocol in protocols:
            handoff = {"protocol": protocol, "endpoint": "https://example.com"}
            assert is_handoff_protocol(handoff, protocol) is True


class TestIsHandoffCommand:
    """Tests for is_handoff_command function."""

    def test_returns_true_when_handoff_property_is_true(self):
        """Test that is_handoff_command returns True when handoff=True."""
        assert is_handoff_command({"handoff": True}) is True

    def test_returns_true_when_handoff_tag_is_present(self):
        """Test that is_handoff_command returns True when handoff tag present."""
        assert is_handoff_command({"tags": ["handoff"]}) is True

    def test_returns_true_when_handoff_tag_among_other_tags(self):
        """Test that is_handoff_command returns True when handoff tag present among others."""
        assert is_handoff_command({"tags": ["streaming", "handoff", "realtime"]}) is True

    def test_returns_false_when_handoff_property_is_false(self):
        """Test that is_handoff_command returns False when handoff=False."""
        assert is_handoff_command({"handoff": False}) is False

    def test_returns_false_when_handoff_property_undefined(self):
        """Test that is_handoff_command returns False when handoff is undefined."""
        assert is_handoff_command({}) is False

    def test_returns_false_when_tags_do_not_include_handoff(self):
        """Test that is_handoff_command returns False when tags don't include handoff."""
        assert is_handoff_command({"tags": ["streaming", "realtime"]}) is False

    def test_returns_false_when_tags_is_empty(self):
        """Test that is_handoff_command returns False when tags is empty."""
        assert is_handoff_command({"tags": []}) is False


class TestGetHandoffProtocol:
    """Tests for get_handoff_protocol function."""

    def test_returns_none_for_non_handoff_commands(self):
        """Test that get_handoff_protocol returns None for non-handoff commands."""
        assert get_handoff_protocol({}) is None
        assert get_handoff_protocol({"tags": ["streaming"]}) is None

    def test_returns_handoff_protocol_property_when_present(self):
        """Test that get_handoff_protocol returns handoff_protocol property."""
        assert get_handoff_protocol({"handoff": True, "handoff_protocol": "websocket"}) == "websocket"

    def test_returns_protocol_from_tag(self):
        """Test that get_handoff_protocol extracts protocol from handoff:{protocol} tag."""
        assert get_handoff_protocol({"tags": ["handoff", "handoff:sse"]}) == "sse"

    def test_prefers_property_over_tag(self):
        """Test that get_handoff_protocol prefers handoff_protocol property over tag."""
        cmd = {
            "handoff": True,
            "handoff_protocol": "websocket",
            "tags": ["handoff:sse"],
        }
        assert get_handoff_protocol(cmd) == "websocket"

    def test_returns_none_when_handoff_true_but_no_protocol(self):
        """Test that get_handoff_protocol returns None when handoff=True but no protocol."""
        assert get_handoff_protocol({"handoff": True}) is None


class TestCreateHandoff:
    """Tests for create_handoff convenience function."""

    def test_creates_minimal_handoff(self):
        """Test creating a minimal handoff with only required fields."""
        result = create_handoff("websocket", "wss://example.com/chat")
        assert result["protocol"] == "websocket"
        assert result["endpoint"] == "wss://example.com/chat"
        assert "credentials" not in result
        assert "metadata" not in result

    def test_creates_handoff_with_token(self):
        """Test creating a handoff with token."""
        result = create_handoff("websocket", "wss://example.com/chat", token="abc123")
        assert result["credentials"]["token"] == "abc123"

    def test_creates_handoff_with_metadata(self):
        """Test creating a handoff with metadata fields."""
        result = create_handoff(
            "websocket",
            "wss://example.com/chat",
            expected_latency=50,
            capabilities=["text", "presence"],
            expires_at="2025-01-15T12:00:00Z",
            description="Chat connection",
        )
        assert result["metadata"]["expected_latency"] == 50
        assert result["metadata"]["capabilities"] == ["text", "presence"]
        assert result["metadata"]["expires_at"] == "2025-01-15T12:00:00Z"
        assert result["metadata"]["description"] == "Chat connection"

    def test_creates_handoff_with_reconnect_policy(self):
        """Test creating a handoff with reconnect policy."""
        result = create_handoff(
            "websocket",
            "wss://example.com/chat",
            reconnect_allowed=True,
            reconnect_max_attempts=5,
            reconnect_backoff_ms=1000,
        )
        assert result["metadata"]["reconnect"]["allowed"] is True
        assert result["metadata"]["reconnect"]["max_attempts"] == 5
        assert result["metadata"]["reconnect"]["backoff_ms"] == 1000

    def test_handoff_result_validates_created_dict(self):
        """Test that create_handoff output passes is_handoff validation."""
        result = create_handoff(
            "websocket",
            "wss://example.com/chat",
            token="abc123",
            capabilities=["text"],
            reconnect_allowed=True,
        )
        assert is_handoff(result) is True


class TestCommandDefinitionHandoff:
    """Tests for handoff properties in CommandDefinition."""

    def test_command_definition_with_handoff(self):
        """Test that CommandDefinition supports handoff properties."""
        from afd.core.commands import CommandDefinition

        async def handler(input, context=None):
            pass

        cmd = CommandDefinition(
            name="chat.connect",
            description="Connect to chat",
            handler=handler,
            handoff=True,
            handoff_protocol="websocket",
        )
        assert cmd.handoff is True
        assert cmd.handoff_protocol == "websocket"

    def test_command_definition_without_handoff(self):
        """Test that CommandDefinition defaults to non-handoff."""
        from afd.core.commands import CommandDefinition

        async def handler(input, context=None):
            pass

        cmd = CommandDefinition(
            name="item.create",
            description="Create item",
            handler=handler,
        )
        assert cmd.handoff is False
        assert cmd.handoff_protocol is None


class TestDecoratorHandoff:
    """Tests for handoff support in @define_command decorator."""

    def test_define_command_with_handoff(self):
        """Test that @define_command supports handoff parameter."""
        from afd.server.decorators import define_command, get_command_metadata

        @define_command(
            name="chat.connect",
            description="Connect to chat",
            handoff=True,
            handoff_protocol="websocket",
        )
        async def connect_chat(input):
            pass

        metadata = get_command_metadata(connect_chat)
        assert metadata is not None
        assert metadata.handoff is True
        assert metadata.handoff_protocol == "websocket"
        assert "handoff" in metadata.tags
        assert "handoff:websocket" in metadata.tags

    def test_define_command_without_handoff(self):
        """Test that @define_command defaults to non-handoff."""
        from afd.server.decorators import define_command, get_command_metadata

        @define_command(
            name="item.create",
            description="Create item",
        )
        async def create_item(input):
            pass

        metadata = get_command_metadata(create_item)
        assert metadata is not None
        assert metadata.handoff is False
        assert metadata.handoff_protocol is None
        assert "handoff" not in metadata.tags
