"""Base transport protocol and types.

This module defines the Transport protocol that all transport implementations
must follow, enabling easy swapping between FastMCP, custom implementations,
and mock transports for testing.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import (
    Any,
    Protocol,
    runtime_checkable,
)


class TransportState(str, Enum):  # noqa: UP042
    """Transport connection state."""

    DISCONNECTED = "disconnected"
    CONNECTING = "connecting"
    CONNECTED = "connected"
    RECONNECTING = "reconnecting"
    ERROR = "error"


@dataclass
class TransportConfig:
    """Configuration for transport connections.

    Attributes:
        timeout_ms: Connection timeout in milliseconds.
        retry_attempts: Number of retry attempts on failure.
        retry_delay_ms: Delay between retries in milliseconds.
        extra: Additional transport-specific configuration.
    """

    timeout_ms: int = 30000
    retry_attempts: int = 3
    retry_delay_ms: int = 1000
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass
class ToolInfo:
    """Information about an available tool."""

    name: str
    description: str
    input_schema: dict[str, Any] | None = None
    meta: dict[str, Any] | None = None
    annotations: dict[str, Any] | None = None


@dataclass(frozen=True)
class _TaskSeed:
    """Internal wrapper for a protocol-level MCP ``CreateTaskResult`` envelope.

    Distinguishes a genuine ``resultType: "task"`` response from an inline tool
    whose unwrapped JSON output happens to contain a ``resultType`` key.
    """

    payload: dict[str, Any]


@runtime_checkable
class Transport(Protocol):
    """Protocol for MCP transport implementations.

    Transports handle the communication layer for MCP servers and clients.
    Implementations must provide connection management and tool execution.

    Example:
        >>> class MyTransport:
        ...     async def connect(self) -> None: ...
        ...     async def disconnect(self) -> None: ...
        ...     async def call_tool(self, name: str, args: dict) -> Any: ...
        ...     async def list_tools(self) -> list[ToolInfo]: ...
        ...     @property
        ...     def state(self) -> TransportState: ...
    """

    @property
    def state(self) -> TransportState:
        """Get the current connection state."""
        ...

    async def connect(self) -> None:
        """Establish connection to the MCP server.

        Raises:
            ConnectionError: If connection fails.
            TimeoutError: If connection times out.
        """
        ...

    async def disconnect(self) -> None:
        """Close the connection."""
        ...

    async def call_tool(
        self,
        name: str,
        arguments: dict[str, Any] | None = None,
    ) -> Any:
        """Call a tool on the connected server.

        Args:
            name: Tool name.
            arguments: Tool arguments.

        Returns:
            Tool result.

        Raises:
            RuntimeError: If not connected.
            ValueError: If tool not found.
        """
        ...

    async def list_tools(self) -> list[ToolInfo]:
        """List available tools.

        Returns:
            List of tool information.

        Raises:
            RuntimeError: If not connected.
        """
        ...


class TransportError(Exception):
    """Base exception for transport errors."""

    def __init__(self, message: str, cause: Exception | None = None):
        super().__init__(message)
        self.cause = cause


class ConnectionError(TransportError):
    """Raised when connection fails."""

    pass


class TimeoutError(TransportError):
    """Raised when operation times out."""

    pass


class ToolNotFoundError(TransportError):
    """Raised when a tool is not found."""

    def __init__(self, tool_name: str):
        super().__init__(f"Tool '{tool_name}' not found")
        self.tool_name = tool_name


class HttpStatusError(TransportError):
    """Raised when the server answers a request with an HTTP error status."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


class JsonRpcError(TransportError):
    """Raised when the server answers a request with a JSON-RPC error."""

    def __init__(self, code: int, message: str, data: Any = None):
        super().__init__(f"JSON-RPC error {code}: {message}")
        self.code = code
        self.rpc_message = message
        self.data = data


class ToolExecutionError(TransportError):
    """Raised when a tool returns isError (business logic error, not transport)."""

    def __init__(self, message: str):
        super().__init__(message)
