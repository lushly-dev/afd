"""The decision before dispatch (``spec/authorization.md``, M6, "Before dispatch: the 403"),
in one implementation that both AFD's ASGI bearer layer and a host's own HTTP layer
(``server.pre_dispatch_check()``) run, so a request gets the exact same answer from either.
"""

from __future__ import annotations

import json
import types
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from afd.server.auth_resource import ProtectedResource
from afd.server.auth_scopes import ScopeChallenge
from afd.server.auth_view import ScopeView


@dataclass(frozen=True)
class PreDispatch:
    """What the decision before dispatch answers: pass the request on, or answer with this response."""

    proceed: bool
    status: int | None = None
    headers: Mapping[str, str] = field(default_factory=dict)
    body: str = ""

    def __post_init__(self) -> None:
        if not isinstance(self.headers, types.MappingProxyType):
            object.__setattr__(self, "headers", types.MappingProxyType(dict(self.headers)))


PROCEED = PreDispatch(proceed=True)


def _json_response(
    status: int,
    body: Any,
    headers: Mapping[str, str] | None = None,
) -> PreDispatch:
    merged = {"Content-Type": "application/json", **(headers or {})}
    return PreDispatch(
        proceed=False,
        status=status,
        headers=merged,
        body=json.dumps(body),
    )


BATCH_REFUSED = _json_response(
    400,
    {
        "jsonrpc": "2.0",
        "id": None,
        "error": {
            "code": -32600,
            "message": "JSON-RPC batches are not supported: send one message per request",
        },
    },
)
"""The 400 for a JSON-RPC batch: MCP has had none since 2025-06-18."""


def body_too_large() -> PreDispatch:
    """The 413 for a body over the pre-dispatch cap."""
    return _json_response(413, {"error": "Request body is too large"})


def forbidden_response(
    resource: ProtectedResource,
    missing: Sequence[str],
    *,
    challenge: ScopeChallenge | None = None,
    scope_source: str | None = None,
) -> PreDispatch:
    """The 403 naming ``missing`` (M5; a host's own layer, M6)."""
    header = (
        challenge.header_value(missing)
        if challenge is not None
        else resource.forbidden_challenge(missing)
    )
    return _json_response(
        403,
        resource.forbidden_body(missing, scope_source),
        {"WWW-Authenticate": header},
    )


def decide_body(
    view: ScopeView,
    text: str,
    resource: ProtectedResource,
    *,
    challenge: ScopeChallenge | None = None,
    scope_source: str | None = None,
) -> PreDispatch:
    """Decide a ``POST`` JSON-RPC body for the caller ``view`` describes (M6).

    - A JSON-RPC batch (JSON array) is refused with 400 ``-32600`` before deciding anything.
    - A ``tools/call`` is decided over every call it names, as the router resolves them.
    - Every other JSON-RPC message needs the server's ``required_scopes``.
    - A body that cannot be parsed as JSON proceeds, to be answered by the route as before.
    """
    try:
        message = json.loads(text)
    except (json.JSONDecodeError, ValueError):
        return PROCEED

    if isinstance(message, list):
        return BATCH_REFUSED

    decision = view.decide_request()
    if isinstance(message, dict) and message.get("method") == "tools/call":
        params = message.get("params")
        if isinstance(params, dict) and isinstance(params.get("name"), str):
            raw_args = params.get("arguments")
            decision = view.decide_call(
                params["name"], raw_args if isinstance(raw_args, dict) else {}
            )

    if decision == "proceed":
        return PROCEED
    return forbidden_response(
        resource,
        decision.forbidden,
        challenge=challenge,
        scope_source=scope_source,
    )


__all__ = [
    "BATCH_REFUSED",
    "PROCEED",
    "PreDispatch",
    "body_too_large",
    "decide_body",
    "forbidden_response",
]
