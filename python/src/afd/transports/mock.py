"""Mock transport for testing.

This transport provides a fully-functional mock implementation
for testing AFD applications without actual MCP connections.

Example:
    >>> from afd.transports import MockTransport
    >>> from afd import success
    >>>
    >>> transport = MockTransport()
    >>>
    >>> # Register mock responses
    >>> async def mock_ping(args):
    ...     return success({"message": "pong"})
    >>> transport.register_tool("ping", mock_ping)
    >>>
    >>> # Use in tests
    >>> await transport.connect()
    >>> result = await transport.call_tool("ping", {})
"""

import asyncio
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from afd.transports.base import (
    ToolInfo,
    ToolNotFoundError,
    TransportConfig,
    TransportState,
)


@dataclass
class MockCall:
    """Record of a tool call for assertions."""

    tool_name: str
    arguments: dict[str, Any]
    result: Any
    meta: dict[str, Any] | None = None
    """The request ``_meta`` the call sent, such as its idempotency key."""


class MockTransport:
    """Mock transport for testing.

    This transport records all tool calls and allows pre-configured
    responses, making it ideal for unit testing.

    Example:
        >>> transport = MockTransport()
        >>> transport.add_mock_response("ping", {"message": "pong"})
        >>>
        >>> await transport.connect()
        >>> result = await transport.call_tool("ping", {})
        >>>
        >>> # Assert calls were made
        >>> assert transport.call_count("ping") == 1
        >>> assert transport.last_call("ping").arguments == {}
    """

    def __init__(self, config: TransportConfig | None = None):
        """Initialize mock transport.

        Args:
            config: Optional configuration.
        """
        self._config = config or TransportConfig()
        self._state = TransportState.DISCONNECTED
        self._tools: dict[str, tuple[Callable[..., Any], str]] = {}
        self._mock_responses: dict[str, Any] = {}
        self._calls: list[MockCall] = []
        self._should_fail_connect = False
        self._connection_error: str | None = None

    @property
    def state(self) -> TransportState:
        """Get current transport state."""
        return self._state

    @property
    def calls(self) -> list[MockCall]:
        """Get all recorded calls."""
        return list(self._calls)

    def set_should_fail_connect(
        self,
        should_fail: bool = True,
        error_message: str = "Mock connection failed",
    ) -> None:
        """Configure connect() to fail for testing error paths.

        Args:
            should_fail: Whether connect should fail.
            error_message: Error message to use.
        """
        self._should_fail_connect = should_fail
        self._connection_error = error_message

    async def connect(self) -> None:
        """Simulate connection.

        Raises:
            ConnectionError: If configured to fail.
        """
        if self._should_fail_connect:
            self._state = TransportState.ERROR
            raise ConnectionError(self._connection_error or "Connection failed")

        self._state = TransportState.CONNECTING
        self._state = TransportState.CONNECTED

    async def disconnect(self) -> None:
        """Simulate disconnection."""
        self._state = TransportState.DISCONNECTED

    def register_tool(
        self,
        name: str,
        handler: Callable,
        description: str = "",
    ) -> None:
        """Register a tool handler.

        Args:
            name: Tool name.
            handler: Async handler function.
            description: Tool description (stored for list_tools).
        """
        self._tools[name] = (handler, description)

    def add_mock_response(self, tool_name: str, response: Any) -> None:
        """Add a canned response for a tool.

        Args:
            tool_name: Tool name.
            response: Response to return when tool is called.
        """
        self._mock_responses[tool_name] = response

    async def call_tool(
        self,
        name: str,
        arguments: dict[str, Any] | None = None,
        *,
        timeout: float | None = None,
        meta: dict[str, Any] | None = None,
    ) -> Any:
        """Call a tool and record the call, with the request ``_meta`` it sent.

        If a mock response is registered, it's returned.
        If a handler is registered, it's called.
        Otherwise, raises ToolNotFoundError.

        Args:
            name: Tool name.
            arguments: Tool arguments.

        Returns:
            Tool result.
        """
        args = arguments or {}

        # Check for mock response first
        if name in self._mock_responses:
            result = self._mock_responses[name]
            self._calls.append(MockCall(tool_name=name, arguments=args, result=result, meta=meta))
            return result

        # Check for registered handler
        if name in self._tools:
            handler, _ = self._tools[name]
            if timeout is not None:
                result = await asyncio.wait_for(handler(args), timeout=timeout)
            else:
                result = await handler(args)
            self._calls.append(MockCall(tool_name=name, arguments=args, result=result, meta=meta))
            return result

        raise ToolNotFoundError(name)

    async def list_tools(self) -> list[ToolInfo]:
        """List all registered tools and mock responses."""
        tools = []

        # Add registered tools
        for name, (_, description) in self._tools.items():
            tools.append(ToolInfo(name=name, description=description))

        # Add mock responses that aren't already in tools
        for name in self._mock_responses:
            if name not in self._tools:
                tools.append(ToolInfo(name=name, description="Mock response"))

        return tools

    def call_count(self, tool_name: str | None = None) -> int:
        """Get number of calls made.

        Args:
            tool_name: If provided, count only calls to this tool.

        Returns:
            Number of calls.
        """
        if tool_name is None:
            return len(self._calls)
        return sum(1 for c in self._calls if c.tool_name == tool_name)

    def last_call(self, tool_name: str | None = None) -> MockCall | None:
        """Get the last call made.

        Args:
            tool_name: If provided, get last call to this tool.

        Returns:
            Last MockCall or None if no calls.
        """
        if tool_name is None:
            return self._calls[-1] if self._calls else None

        for call in reversed(self._calls):
            if call.tool_name == tool_name:
                return call
        return None

    def get_calls(self, tool_name: str) -> list[MockCall]:
        """Get all calls to a specific tool.

        Args:
            tool_name: Tool name to filter by.

        Returns:
            List of calls to that tool.
        """
        return [c for c in self._calls if c.tool_name == tool_name]

    def clear_calls(self) -> None:
        """Clear all recorded calls."""
        self._calls.clear()

    def reset(self) -> None:
        """Reset transport to initial state."""
        self._calls.clear()
        self._tools.clear()
        self._mock_responses.clear()
        self._state = TransportState.DISCONNECTED
        self._should_fail_connect = False
        self._connection_error = None
