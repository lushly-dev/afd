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
    >>> from afd.transports import StreamableHttpTransport, create_transport
    >>> transport = create_transport("streamable-http", "http://localhost:3100/mcp")
"""

from typing import TYPE_CHECKING, Any, Literal

from afd.transports.base import (
    ConnectionError,
    HttpStatusError,
    JsonRpcError,
    ToolExecutionError,
    ToolInfo,
    ToolNotFoundError,
    Transport,
    TransportConfig,
    TransportError,
    TransportState,
)

if TYPE_CHECKING:
    from afd.transports.fastmcp import FastMCPTransport
    from afd.transports.http import HttpTransport
    from afd.transports.mock import MockTransport
    from afd.transports.sse import SseTransport
    from afd.transports.streamable_http import (
        ElicitationHandler,
        ElicitationRequest,
        ElicitationResponse,
        StreamableHttpTransport,
    )

# Transport implementations load lazily so importing ``afd.transports`` (for
# example ``from afd.transports import MockTransport`` in ``afd.testing``) does
# not pull in optional ``client``/``server`` dependencies like ``httpx`` or ``mcp``.
_LAZY_EXPORTS: dict[str, tuple[str, str | None]] = {
    "FastMCPTransport": ("afd.transports.fastmcp", "server"),
    "MockTransport": ("afd.transports.mock", None),
    "HttpTransport": ("afd.transports.http", "client"),
    "SseTransport": ("afd.transports.sse", "client"),
    "StreamableHttpTransport": ("afd.transports.streamable_http", "client"),
    "ElicitationHandler": ("afd.transports.streamable_http", "client"),
    "ElicitationRequest": ("afd.transports.streamable_http", "client"),
    "ElicitationResponse": ("afd.transports.streamable_http", "client"),
}


def __getattr__(name: str) -> Any:
    target = _LAZY_EXPORTS.get(name)
    if target is None:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    module_name, extra = target
    import importlib

    try:
        module = importlib.import_module(module_name)
    except ModuleNotFoundError as exc:
        if extra is not None:
            raise ModuleNotFoundError(
                f"afd.transports.{name} requires the '{extra}' extra: "
                f"pip install 'afd[{extra}]' ({exc})",
                name=exc.name,
            ) from exc
        raise
    value = getattr(module, name)
    globals()[name] = value
    return value


def __dir__() -> list[str]:
    return sorted(set(globals()) | set(_LAZY_EXPORTS))


def create_transport(
    transport_type: Literal["streamable-http", "sse", "http"],
    url: str,
    *,
    headers: dict[str, str] | None = None,
    timeout: float = 30.0,
) -> "HttpTransport | SseTransport | StreamableHttpTransport":
    """Create a transport by type.

    Args:
        transport_type: ``"streamable-http"`` (MCP Streamable HTTP, 2026-07-28 or
            2025), or the deprecated ``"sse"`` and ``"http"``.
        url: Server URL.
        headers: Optional custom HTTP headers.
        timeout: Request timeout in seconds.

    Returns:
        Transport instance.
    """
    if transport_type == "streamable-http":
        cls = __getattr__("StreamableHttpTransport")
        return cls(url, headers=headers, timeout=timeout)
    if transport_type == "http":
        cls = __getattr__("HttpTransport")
        return cls(url, headers=headers, timeout=timeout)
    elif transport_type == "sse":
        cls = __getattr__("SseTransport")
        return cls(url, headers=headers, timeout=timeout)
    else:
        raise ValueError(f"Unsupported transport type: {transport_type}")


__all__ = [
    "Transport",
    "TransportConfig",
    "TransportState",
    "ToolInfo",
    "TransportError",
    "ToolExecutionError",
    "ConnectionError",
    "ToolNotFoundError",
    "HttpStatusError",
    "JsonRpcError",
    "FastMCPTransport",
    "MockTransport",
    "HttpTransport",
    "SseTransport",
    "StreamableHttpTransport",
    "ElicitationHandler",
    "ElicitationRequest",
    "ElicitationResponse",
    "create_transport",
]
