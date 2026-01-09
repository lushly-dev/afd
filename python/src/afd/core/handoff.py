"""Handoff types for AFD commands.

The HandoffResult type is returned by commands that bootstrap streaming
connections, allowing clients to connect to specialized protocols
(WebSocket, WebRTC, SSE, etc.) for real-time communication.

Example:
    >>> from afd.core.handoff import HandoffResult, is_handoff
    >>>
    >>> # Check if a result is a handoff
    >>> result = {"protocol": "websocket", "endpoint": "wss://example.com/chat"}
    >>> if is_handoff(result):
    ...     print(f"Connect to {result['endpoint']}")
"""

from typing import Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, Field


# Type alias for standard protocols
HandoffProtocol = Union[
    Literal["websocket", "webrtc", "sse", "http-stream"],
    str,  # Allow custom protocols
]


class ReconnectPolicy(BaseModel):
    """Reconnection policy for handoff connections.

    Attributes:
        allowed: Whether reconnection is allowed.
        max_attempts: Maximum number of reconnection attempts.
        backoff_ms: Base backoff time in milliseconds.

    Example:
        >>> policy = ReconnectPolicy(allowed=True, max_attempts=5, backoff_ms=1000)
    """

    allowed: bool
    max_attempts: Optional[int] = Field(default=None, ge=0)
    backoff_ms: Optional[int] = Field(default=None, ge=0)


class HandoffCredentials(BaseModel):
    """Authentication credentials for the handoff connection.

    Attributes:
        token: Bearer token for authentication.
        headers: Additional headers to include in the connection.
        session_id: Session ID for correlation.

    Example:
        >>> creds = HandoffCredentials(
        ...     token="eyJhbGciOiJIUzI1NiIs...",
        ...     session_id="session-abc123",
        ...     headers={"X-Custom-Header": "value"},
        ... )
    """

    token: Optional[str] = None
    headers: Optional[Dict[str, str]] = None
    session_id: Optional[str] = None


class HandoffMetadata(BaseModel):
    """Metadata for client decision-making about the handoff.

    Attributes:
        expected_latency: Expected latency in ms (hint for client).
        capabilities: Capabilities the channel supports.
        expires_at: When the handoff credentials expire (ISO 8601).
        reconnect: Reconnection policy.
        description: Human-readable description of the handoff.

    Example:
        >>> metadata = HandoffMetadata(
        ...     expected_latency=50,
        ...     capabilities=["text", "typing-indicator", "presence"],
        ...     expires_at="2025-01-15T12:00:00Z",
        ...     reconnect=ReconnectPolicy(allowed=True, max_attempts=5, backoff_ms=1000),
        ...     description="Real-time chat connection",
        ... )
    """

    expected_latency: Optional[int] = Field(default=None, ge=0)
    capabilities: Optional[List[str]] = None
    expires_at: Optional[str] = None
    reconnect: Optional[ReconnectPolicy] = None
    description: Optional[str] = None


class HandoffResult(BaseModel):
    """Result returned by commands that hand off to specialized protocols.

    This type is used as the data payload in CommandResult[HandoffResult].
    Commands returning handoffs should be marked with `handoff=True` and
    tagged appropriately (e.g., 'handoff', 'handoff:websocket').

    Attributes:
        protocol: Protocol type for client dispatch.
        endpoint: Full URL to connect to.
        credentials: Authentication credentials for the handoff.
        metadata: Metadata for client decision-making.

    Example:
        >>> from afd import success
        >>>
        >>> # In a command handler
        >>> handoff = HandoffResult(
        ...     protocol="websocket",
        ...     endpoint="wss://chat.example.com/rooms/123",
        ...     credentials=HandoffCredentials(token="abc123"),
        ...     metadata=HandoffMetadata(
        ...         capabilities=["text", "presence"],
        ...         reconnect=ReconnectPolicy(allowed=True),
        ...     ),
        ... )
        >>> result = success(handoff.model_dump())
    """

    protocol: str = Field(..., min_length=1)
    endpoint: str = Field(..., min_length=1)
    credentials: Optional[HandoffCredentials] = None
    metadata: Optional[HandoffMetadata] = None


# ═══════════════════════════════════════════════════════════════════════════════
# TYPE GUARDS
# ═══════════════════════════════════════════════════════════════════════════════


def is_handoff(value: Any) -> bool:
    """Type guard to check if a value is a HandoffResult.

    Args:
        value: Value to check.

    Returns:
        True if value is a valid HandoffResult.

    Example:
        >>> result = {"protocol": "websocket", "endpoint": "wss://example.com/chat"}
        >>> is_handoff(result)
        True
        >>> is_handoff({"invalid": "data"})
        False
    """
    if not isinstance(value, dict):
        return False

    # Required fields: protocol and endpoint
    protocol = value.get("protocol")
    if not isinstance(protocol, str) or not protocol:
        return False

    endpoint = value.get("endpoint")
    if not isinstance(endpoint, str) or not endpoint:
        return False

    # Optional credentials validation
    credentials = value.get("credentials")
    if credentials is not None:
        if not isinstance(credentials, dict):
            return False

        token = credentials.get("token")
        if token is not None and not isinstance(token, str):
            return False

        session_id = credentials.get("session_id")
        if session_id is not None and not isinstance(session_id, str):
            return False

        headers = credentials.get("headers")
        if headers is not None and not isinstance(headers, dict):
            return False

    # Optional metadata validation
    metadata = value.get("metadata")
    if metadata is not None:
        if not isinstance(metadata, dict):
            return False

        expected_latency = metadata.get("expected_latency")
        if expected_latency is not None and not isinstance(expected_latency, (int, float)):
            return False

        capabilities = metadata.get("capabilities")
        if capabilities is not None and not isinstance(capabilities, list):
            return False

        expires_at = metadata.get("expires_at")
        if expires_at is not None and not isinstance(expires_at, str):
            return False

        description = metadata.get("description")
        if description is not None and not isinstance(description, str):
            return False

        reconnect = metadata.get("reconnect")
        if reconnect is not None:
            if not isinstance(reconnect, dict):
                return False

            allowed = reconnect.get("allowed")
            if not isinstance(allowed, bool):
                return False

            max_attempts = reconnect.get("max_attempts")
            if max_attempts is not None and not isinstance(max_attempts, (int, float)):
                return False

            backoff_ms = reconnect.get("backoff_ms")
            if backoff_ms is not None and not isinstance(backoff_ms, (int, float)):
                return False

    return True


def is_handoff_protocol(handoff: Dict[str, Any], protocol: str) -> bool:
    """Type guard to check if a HandoffResult uses a specific protocol.

    Args:
        handoff: HandoffResult dict to check.
        protocol: Protocol to check for.

    Returns:
        True if the handoff uses the specified protocol.

    Example:
        >>> handoff = {"protocol": "websocket", "endpoint": "wss://example.com"}
        >>> is_handoff_protocol(handoff, "websocket")
        True
        >>> is_handoff_protocol(handoff, "sse")
        False
    """
    return handoff.get("protocol") == protocol


# ═══════════════════════════════════════════════════════════════════════════════
# COMMAND TYPE GUARDS
# ═══════════════════════════════════════════════════════════════════════════════


def is_handoff_command(command: Any) -> bool:
    """Check if a command definition is a handoff command.

    A command is a handoff command if:
    - It has `handoff=True` property, OR
    - It has a 'handoff' tag

    Args:
        command: Command definition (dict or object with attributes) to check.

    Returns:
        True if the command is a handoff command.

    Example:
        >>> is_handoff_command({"handoff": True})
        True
        >>> is_handoff_command({"tags": ["handoff"]})
        True
        >>> is_handoff_command({})
        False
    """
    # Handle both dict and object with attributes
    if isinstance(command, dict):
        # Check explicit handoff property
        if command.get("handoff") is True:
            return True

        # Check for handoff tag
        tags = command.get("tags", [])
        if tags and "handoff" in tags:
            return True
    else:
        # Handle object with attributes (e.g., CommandDefinition)
        if getattr(command, "handoff", None) is True:
            return True

        tags = getattr(command, "tags", None) or []
        if "handoff" in tags:
            return True

    return False


def get_handoff_protocol(command: Any) -> Optional[str]:
    """Get the handoff protocol from a command definition.

    Returns the protocol in this priority order:
    1. Explicit `handoff_protocol` property
    2. Protocol from 'handoff:{protocol}' tag
    3. None if not a handoff command or no protocol specified

    Args:
        command: Command definition (dict or object with attributes) to check.

    Returns:
        The handoff protocol or None.

    Example:
        >>> get_handoff_protocol({"handoff": True, "handoff_protocol": "websocket"})
        'websocket'
        >>> get_handoff_protocol({"tags": ["handoff", "handoff:sse"]})
        'sse'
        >>> get_handoff_protocol({})
        None
    """
    # Not a handoff command
    if not is_handoff_command(command):
        return None

    # Handle both dict and object with attributes
    if isinstance(command, dict):
        # Check explicit handoff_protocol property first
        handoff_protocol = command.get("handoff_protocol")
        if handoff_protocol:
            return handoff_protocol

        # Check for handoff:{protocol} tag
        tags = command.get("tags", [])
    else:
        # Handle object with attributes
        handoff_protocol = getattr(command, "handoff_protocol", None)
        if handoff_protocol:
            return handoff_protocol

        tags = getattr(command, "tags", None) or []

    # Find handoff:{protocol} tag
    for tag in tags:
        if isinstance(tag, str) and tag.startswith("handoff:"):
            return tag[len("handoff:"):]

    return None


def create_handoff(
    protocol: str,
    endpoint: str,
    *,
    token: Optional[str] = None,
    session_id: Optional[str] = None,
    headers: Optional[Dict[str, str]] = None,
    expected_latency: Optional[int] = None,
    capabilities: Optional[List[str]] = None,
    expires_at: Optional[str] = None,
    reconnect_allowed: Optional[bool] = None,
    reconnect_max_attempts: Optional[int] = None,
    reconnect_backoff_ms: Optional[int] = None,
    description: Optional[str] = None,
) -> Dict[str, Any]:
    """Create a HandoffResult dict with the given parameters.

    This is a convenience function for creating handoff results in command handlers.

    Args:
        protocol: Protocol type (e.g., "websocket", "sse", "webrtc").
        endpoint: Full URL to connect to.
        token: Bearer token for authentication.
        session_id: Session ID for correlation.
        headers: Additional headers to include.
        expected_latency: Expected latency in ms.
        capabilities: Channel capabilities.
        expires_at: When credentials expire (ISO 8601).
        reconnect_allowed: Whether reconnection is allowed.
        reconnect_max_attempts: Max reconnection attempts.
        reconnect_backoff_ms: Base backoff time in ms.
        description: Human-readable description.

    Returns:
        A dict matching HandoffResult structure.

    Example:
        >>> from afd import success
        >>> handoff = create_handoff(
        ...     protocol="websocket",
        ...     endpoint="wss://chat.example.com/room/123",
        ...     token="abc123",
        ...     capabilities=["text", "presence"],
        ...     reconnect_allowed=True,
        ... )
        >>> result = success(handoff)
    """
    result: Dict[str, Any] = {
        "protocol": protocol,
        "endpoint": endpoint,
    }

    # Build credentials if any credential fields provided
    if token is not None or session_id is not None or headers is not None:
        credentials: Dict[str, Any] = {}
        if token is not None:
            credentials["token"] = token
        if session_id is not None:
            credentials["session_id"] = session_id
        if headers is not None:
            credentials["headers"] = headers
        result["credentials"] = credentials

    # Build metadata if any metadata fields provided
    has_metadata = any([
        expected_latency is not None,
        capabilities is not None,
        expires_at is not None,
        reconnect_allowed is not None,
        description is not None,
    ])

    if has_metadata:
        metadata: Dict[str, Any] = {}
        if expected_latency is not None:
            metadata["expected_latency"] = expected_latency
        if capabilities is not None:
            metadata["capabilities"] = capabilities
        if expires_at is not None:
            metadata["expires_at"] = expires_at
        if description is not None:
            metadata["description"] = description

        # Build reconnect policy if specified
        if reconnect_allowed is not None:
            reconnect: Dict[str, Any] = {"allowed": reconnect_allowed}
            if reconnect_max_attempts is not None:
                reconnect["max_attempts"] = reconnect_max_attempts
            if reconnect_backoff_ms is not None:
                reconnect["backoff_ms"] = reconnect_backoff_ms
            metadata["reconnect"] = reconnect

        result["metadata"] = metadata

    return result
