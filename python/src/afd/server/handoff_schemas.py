"""Server-side handoff validation schemas.

Provides stricter Pydantic models for validating handoff data at the
server boundary, mirroring the Zod schemas in the TypeScript
``handoff-schema.ts``.

Key differences from core handoff models:
- ``endpoint`` is validated as a URL (via ``AnyUrl``), not just ``min_length=1``
- ``expires_at`` is validated as an ISO 8601 datetime, not just ``Optional[str]``

Example:
    >>> from afd.server.handoff_schemas import validate_handoff
    >>> data = {
    ...     "protocol": "websocket",
    ...     "endpoint": "wss://chat.example.com/room/123",
    ... }
    >>> result = validate_handoff(data)
    >>> result.protocol
    'websocket'
"""

from __future__ import annotations

from datetime import datetime

from pydantic import AnyUrl, BaseModel, Field, field_validator


class HandoffCredentialsSchema(BaseModel):
    """Server-side validation for handoff credentials.

    Re-validated at the server boundary for safety.

    Example:
        >>> creds = HandoffCredentialsSchema(token="abc123", session_id="s-1")
    """

    token: str | None = None
    headers: dict[str, str] | None = None
    session_id: str | None = None


class ReconnectPolicySchema(BaseModel):
    """Reconnection policy validated at server boundary."""

    allowed: bool
    max_attempts: int | None = Field(default=None, ge=0)
    backoff_ms: int | None = Field(default=None, ge=0)


class HandoffMetadataSchema(BaseModel):
    """Server-side validation for handoff metadata.

    Stricter than core: ``expires_at`` is validated as ISO 8601 datetime.

    Example:
        >>> meta = HandoffMetadataSchema(
        ...     expires_at="2025-01-15T12:00:00Z",
        ...     capabilities=["text"],
        ... )
    """

    expected_latency: int | None = Field(default=None, ge=0)
    capabilities: list[str] | None = None
    expires_at: str | None = None
    reconnect: ReconnectPolicySchema | None = None
    description: str | None = None

    @field_validator("expires_at")
    @classmethod
    def validate_expires_at_iso(cls, v: str | None) -> str | None:
        """Validate that expires_at is a valid ISO 8601 datetime string."""
        if v is None:
            return v
        try:
            datetime.fromisoformat(v.replace("Z", "+00:00"))
        except (ValueError, TypeError) as exc:
            raise ValueError(
                f"expires_at must be a valid ISO 8601 datetime string, got: {v!r}"
            ) from exc
        return v


class HandoffResultSchema(BaseModel):
    """Server-side validation for handoff results.

    Stricter than core: ``endpoint`` is validated as a URL.

    Example:
        >>> result = HandoffResultSchema(
        ...     protocol="websocket",
        ...     endpoint="wss://chat.example.com/room/123",
        ... )
    """

    protocol: str = Field(..., min_length=1)
    endpoint: AnyUrl
    credentials: HandoffCredentialsSchema | None = None
    metadata: HandoffMetadataSchema | None = None


def validate_handoff(data: object) -> HandoffResultSchema:
    """Validate handoff data at the server boundary.

    Convenience wrapper around ``HandoffResultSchema.model_validate()``.

    Args:
        data: Dict or mapping to validate as a handoff result.

    Returns:
        A validated ``HandoffResultSchema`` instance.

    Raises:
        pydantic.ValidationError: If validation fails.

    Example:
        >>> result = validate_handoff({
        ...     "protocol": "websocket",
        ...     "endpoint": "wss://chat.example.com/room/123",
        ... })
        >>> result.protocol
        'websocket'
    """
    return HandoffResultSchema.model_validate(data)
