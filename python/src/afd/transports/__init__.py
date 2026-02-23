"""Transport abstractions for MCP communication.

Transports handle the communication layer between AFD servers and clients.
The default transport is FastMCP, but this module provides protocol-based
abstractions for swapping implementations.

Example:
    >>> from afd.transports import FastMCPTransport, MockTransport
    >>>
    >>> # For production
    >>> transport = FastMCPTransport()
    >>>
    >>> # For testing
    >>> transport = MockTransport()
    >>>
    >>> # For remote MCP servers
    >>> from afd.transports import SseTransport, HttpTransport, create_transport
    >>> transport = create_transport("sse", "http://localhost:3100/sse")
"""

from typing import Dict, Literal, Optional

from afd.transports.base import (
    Transport,
    TransportConfig,
    TransportState,
    ToolInfo,
    TransportError,
    ConnectionError,
    ToolNotFoundError,
)
from afd.transports.fastmcp import FastMCPTransport
from afd.transports.mock import MockTransport
from afd.transports.http import HttpTransport
from afd.transports.sse import SseTransport


def create_transport(
    transport_type: Literal["sse", "http"],
    url: str,
    *,
    headers: Optional[Dict[str, str]] = None,
    timeout: float = 30.0,
) -> "HttpTransport | SseTransport":
    """Create a transport by type.

    Args:
        transport_type: ``"sse"`` or ``"http"``.
        url: Server URL.
        headers: Optional custom HTTP headers.
        timeout: Request timeout in seconds.

    Returns:
        Transport instance.
    """
    if transport_type == "http":
        return HttpTransport(url, headers=headers, timeout=timeout)
    elif transport_type == "sse":
        return SseTransport(url, headers=headers, timeout=timeout)
    else:
        raise ValueError(f"Unsupported transport type: {transport_type}")


__all__ = [
    "Transport",
    "TransportConfig",
    "TransportState",
    "ToolInfo",
    "TransportError",
    "ConnectionError",
    "ToolNotFoundError",
    "FastMCPTransport",
    "MockTransport",
    "HttpTransport",
    "SseTransport",
    "create_transport",
]
