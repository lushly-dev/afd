"""Every private part of the MCP Python SDK that the AFD server relies on, in one place (#1756).

The SDK (``mcp`` 2.x, ``mcp.server.mcpserver.MCPServer``) has no public hook for these. Each
entry in :data:`SDK_INTERNALS` names the internal, what AFD uses it for and what breaks without
it, and ``tests/test_sdk_internals.py`` checks each one against the installed SDK, failing with
that text. Everything else the server needs from the SDK goes through public API: the
``MCPServer`` constructor, ``MCPServer.middleware``, ``list_tools`` and ``call_tool`` (overridden
by AFD's subclass) and the low-level server's ``get_request_handler`` and ``add_request_handler``.

The ``mcp`` range in ``python/pyproject.toml`` is capped at the newest minor the full suite has
passed on, and the weekly ``Python newest MCP SDK`` workflow runs the suite on the newest 2.x,
so the cap is widened on purpose, after these checks pass, never by an install picking up a
release nobody tested.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger("afd.server")


@dataclass(frozen=True)
class SdkInternal:
    """One private SDK attribute or behaviour the AFD server depends on."""

    name: str
    """The internal, as ``Class.attribute`` in the SDK."""

    used_for: str
    """What the AFD server does with it."""

    breaks: str
    """What goes wrong for AFD's callers if the SDK changes it."""

    def failure(self, found: str) -> str:
        """The message a guard test fails with when the installed SDK no longer matches."""
        return (
            f"MCP SDK internal {self.name} changed: {found}. AFD uses it to {self.used_for}; "
            f"without it {self.breaks}. Update afd.server.sdk_internals and keep the mcp "
            "range in python/pyproject.toml below this SDK release until it is fixed."
        )


LOWLEVEL_SERVER = SdkInternal(
    name="MCPServer._lowlevel_server",
    used_for=(
        "reach the low-level Server, to answer capabilities, server/discover, resources and "
        "prompts the way the AFD spec says"
    ),
    breaks=(
        "capabilities promise tools/list_changed notifications that never come, server/discover "
        "omits the declared context fields, and resources and skills are not served"
    ),
)

REQUEST_HANDLERS = SdkInternal(
    name="Server._request_handlers",
    used_for=(
        "remove the SDK's default prompt handlers, and its resource handlers when resources "
        "are off (spec R1); the SDK has add_request_handler but no way to remove one"
    ),
    breaks=(
        "the server advertises and answers prompts/list and resources/list with empty lists "
        "it does not mean to serve"
    ),
)

GET_CAPABILITIES = SdkInternal(
    name="Server.get_capabilities (looked up on the instance per request)",
    used_for=(
        "report capabilities.tools.listChanged as false and declare the MCP Tasks extension "
        "only to callers that may use it, by replacing the bound method on the instance"
    ),
    breaks=(
        "clients wait for tools/list_changed notifications no AFD server sends, and Tasks is "
        "advertised to callers it is not served to"
    ),
)

TOOL_INPUT_SCHEMA = SdkInternal(
    name="MCPServer._tool_input_schema",
    used_for=(
        "give the low-level server each tool's input schema for Mcp-Param header validation "
        "(2026-07-28 HTTP), without registering tools in the SDK's tool manager"
    ),
    breaks=(
        "Mcp-Param headers are validated against nothing (or the SDK's empty tool manager), so "
        "a mismatched header reaches the command instead of being refused"
    ),
)

SESSION_CONNECTION = SdkInternal(
    name="ServerSession._connection",
    used_for=(
        "identify a 2025-era client connection: the SDK builds a new ServerSession per request, "
        "and the connection it wraps is the only stable identity"
    ),
    breaks=(
        "each request gets fresh context state, so afd-context-enter no longer persists to the "
        "next call on the same connection"
    ),
)

REQUEST_STATE_BOUNDARY = SdkInternal(
    name="MCPServer.middleware holding a RequestStateBoundary (provisional in 2.x)",
    used_for=(
        "run the context hook, the auth checks and the human relay's own requestState before "
        "the SDK unseals a retry's requestState, by inserting middleware just before the "
        "boundary in the public middleware chain"
    ),
    breaks=(
        "the server refuses to start (it will not serve requests without those guards), or, "
        "if the chain stopped running in order, a retry is unsealed before AFD checks who sent it"
    ),
)

SDK_INTERNALS: tuple[SdkInternal, ...] = (
    LOWLEVEL_SERVER,
    REQUEST_HANDLERS,
    GET_CAPABILITIES,
    TOOL_INPUT_SCHEMA,
    SESSION_CONNECTION,
    REQUEST_STATE_BOUNDARY,
)
"""The private SDK internals the AFD server depends on, each with a guard test."""


def lowlevel_server(sdk_server: Any) -> Any | None:
    """The low-level ``Server`` behind an SDK ``MCPServer`` (:data:`LOWLEVEL_SERVER`)."""
    return getattr(sdk_server, "_lowlevel_server", None)


def request_handlers(lowlevel: Any) -> dict[str, Any] | None:
    """The low-level server's handler table, keyed by method (:data:`REQUEST_HANDLERS`)."""
    handlers = getattr(lowlevel, "_request_handlers", None)
    return handlers if isinstance(handlers, dict) else None


_warned_connection = False


def connection_identity(session: Any) -> Any:
    """The object that stands for a 2025-era client connection (:data:`SESSION_CONNECTION`).

    Falls back to the per-request session, with one warning, when the SDK no longer has it:
    context state then lasts for one request instead of the connection.
    """
    global _warned_connection
    try:
        return session._connection
    except AttributeError:
        if not _warned_connection:
            _warned_connection = True
            logger.warning(SESSION_CONNECTION.failure("the session has no _connection"))
        return session


__all__ = [
    "GET_CAPABILITIES",
    "LOWLEVEL_SERVER",
    "REQUEST_HANDLERS",
    "REQUEST_STATE_BOUNDARY",
    "SDK_INTERNALS",
    "SESSION_CONNECTION",
    "TOOL_INPUT_SCHEMA",
    "SdkInternal",
    "connection_identity",
    "lowlevel_server",
    "request_handlers",
]
