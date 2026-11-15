"""An HTTP surface for managed hosts: one route per host, each behind a bearer token.

``create_host_http_app({"lane": host, ...}, tokens)`` serves, under ``/<route>``:

- ``POST /<route>/call``  ``{"command", "arguments"?, "onBehalfOf"?}``: the command's
  CommandResult. The token decides the route and the actor; ``onBehalfOf`` is what the caller
  says, and is kept as such.
- ``GET /<route>/catalog``: the host's catalog, as its MCP ``start`` tool returns it.
- ``GET /<route>/docs/<topic>``: a documentation topic.
- ``POST /<route>/uploads``: raw bytes for the host's ``uploads`` handler (a git bundle, for
  the factory gateway), which returns a CommandResult.

Every answer is a CommandResult, transport refusals included (``UNAUTHORIZED``,
``FORBIDDEN``, ``NOT_FOUND``, ``PAYLOAD_TOO_LARGE``), so a client reads one shape. A command's
own refusal is HTTP 200: the call reached the host. ``serve_hosts`` binds only to loopback or a
tailnet address unless the operator says otherwise.

Needs the ``mcp`` extra (Starlette and Uvicorn).
"""

from __future__ import annotations

import ipaddress
from collections.abc import Awaitable, Callable
from typing import Any

from afd import Actor, CommandResult, error
from afd.core.commands import CommandContext

from botcore.host import CommandHost
from botcore.host_tokens import TokenRecord, TokenStore

#: Receives the route, the verified caller and the request body; returns a CommandResult.
UploadHandler = Callable[[str, Actor, bytes], Awaitable[CommandResult]]

DEFAULT_MAX_UPLOAD_BYTES = 256 * 1024 * 1024
TAILNET_NETWORKS = (
    ipaddress.ip_network("100.64.0.0/10"),
    ipaddress.ip_network("fd7a:115c:a1e0::/48"),
)


def _dump(result: CommandResult) -> dict:
    return result.model_dump(mode="json", exclude_none=True)


def _bearer(header: str | None) -> str | None:
    if not header:
        return None
    scheme, _, value = header.partition(" ")
    return value.strip() if scheme.lower() == "bearer" and value.strip() else None


class _HostRoutes:
    """The handlers behind ``create_host_http_app``; each answers with a CommandResult."""

    def __init__(self, hosts, tokens, uploads, max_upload_bytes) -> None:
        self.hosts: dict[str, CommandHost] = hosts
        self.tokens: TokenStore = tokens
        self.uploads: UploadHandler | None = uploads
        self.max_upload_bytes = max_upload_bytes

    @staticmethod
    def json(body: dict, status: int = 200) -> Any:
        from starlette.responses import JSONResponse

        return JSONResponse(body, status_code=status)

    def refused(self, status: int, code: str, message: str, suggestion: str) -> Any:
        return self.json(_dump(error(code, message, suggestion=suggestion)), status)

    def admit(self, request) -> tuple[str, CommandHost, TokenRecord] | Any:
        """The route, host and caller, or the refusal: an unknown route, no valid token, or
        a token for another route."""
        route = request.path_params["route"]
        host = self.hosts.get(route)
        if host is None:
            routes = ", ".join("/" + name for name in sorted(self.hosts))
            return self.refused(404, "NOT_FOUND", f"No route /{route}", f"Use one of: {routes}")
        record = self.tokens.verify(_bearer(request.headers.get("authorization")))
        if record is None:
            return self.refused(
                401,
                "UNAUTHORIZED",
                "No valid bearer token",
                "Send 'Authorization: Bearer <token>' with the token the operator issued you",
            )
        if record.route != route:
            return self.refused(
                403,
                "FORBIDDEN",
                f"This token opens /{record.route}, not /{route}",
                f"Call /{record.route}, or ask the operator for a token for /{route}",
            )
        return route, host, record

    @staticmethod
    def actor(record: TokenRecord, on_behalf_of: Any = None) -> Actor:
        return Actor(
            kind=record.kind,
            id=record.actor,
            label=record.label,
            on_behalf_of=on_behalf_of if isinstance(on_behalf_of, str) else None,
        )

    async def call(self, request) -> Any:
        admitted = self.admit(request)
        if not isinstance(admitted, tuple):
            return admitted
        _, host, record = admitted
        try:
            body = await request.json()
        except (ValueError, UnicodeDecodeError):
            body = None
        if not isinstance(body, dict) or not isinstance(body.get("command"), str):
            return self.refused(
                400,
                "VALIDATION_ERROR",
                "The body must be a JSON object with a command",
                'Send {"command": "<name>", "arguments": {...}}',
            )
        context = CommandContext(actor=self.actor(record, body.get("onBehalfOf")))
        return self.json(_dump(await host.execute(body["command"], body.get("arguments"), context)))

    async def catalog(self, request) -> Any:
        admitted = self.admit(request)
        if not isinstance(admitted, tuple):
            return admitted
        route, host, _ = admitted
        return self.json(
            {
                "name": host.name,
                "route": route,
                "profile": host.context.profile,
                "commands": host.catalog(),
                "topics": sorted(host.docs),
            }
        )

    async def docs(self, request) -> Any:
        admitted = self.admit(request)
        if not isinstance(admitted, tuple):
            return admitted
        _, host, _ = admitted
        topic = request.path_params["topic"]
        if topic not in host.docs:
            topics = ", ".join(sorted(host.docs)) or "(none)"
            return self.refused(404, "NOT_FOUND", f"No docs topic {topic}", f"Use one of: {topics}")
        return self.json({"topic": topic, "text": host.docs[topic]})

    async def upload(self, request) -> Any:
        admitted = self.admit(request)
        if not isinstance(admitted, tuple):
            return admitted
        route, _, record = admitted
        if self.uploads is None:
            return self.refused(404, "NOT_FOUND", f"/{route} takes no uploads", "Call a command")
        declared = request.headers.get("content-length")
        if declared is not None and declared.isdigit() and int(declared) > self.max_upload_bytes:
            return self.too_large(int(declared))
        chunks, size = [], 0
        async for chunk in request.stream():
            size += len(chunk)
            if size > self.max_upload_bytes:
                return self.too_large(size)
            chunks.append(chunk)
        return self.json(_dump(await self.uploads(route, self.actor(record), b"".join(chunks))))

    def too_large(self, size: int) -> Any:
        return self.refused(
            413,
            "PAYLOAD_TOO_LARGE",
            f"The upload is {size} bytes; this host takes at most {self.max_upload_bytes}",
            "Bundle only the commits the push needs (git bundle create <file> <base>..<branch>)",
        )


def create_host_http_app(
    hosts: dict[str, CommandHost],
    tokens: TokenStore,
    *,
    uploads: UploadHandler | None = None,
    max_upload_bytes: int = DEFAULT_MAX_UPLOAD_BYTES,
) -> Any:
    """A Starlette app serving each host in ``hosts`` under ``/<route>``."""
    from starlette.applications import Starlette
    from starlette.routing import Route

    routes = _HostRoutes(hosts, tokens, uploads, max_upload_bytes)
    return Starlette(
        routes=[
            Route("/{route}/call", routes.call, methods=["POST"]),
            Route("/{route}/catalog", routes.catalog, methods=["GET"]),
            Route("/{route}/docs/{topic}", routes.docs, methods=["GET"]),
            Route("/{route}/uploads", routes.upload, methods=["POST"]),
        ]
    )


def check_bind_address(address: str, *, allow_any: bool = False) -> None:
    """Refuse an address outside loopback and the tailnet, unless ``allow_any``.

    The gateway's routes carry write tokens; binding a wildcard or a LAN address would offer
    them to every network the machine joins.
    """
    if allow_any:
        return
    try:
        ip = ipaddress.ip_address(address)
    except ValueError as exc:
        raise ValueError(
            f"Bind to an IP address, not {address!r}: loopback, or the tailnet address "
            "`tailscale ip -4` prints"
        ) from exc
    if ip.is_loopback or any(ip in network for network in TAILNET_NETWORKS):
        return
    raise ValueError(
        f"{address} is neither loopback nor a tailnet address; bind to `tailscale ip -4`, or "
        "to 127.0.0.1 behind `tailscale serve`"
    )


def serve_hosts(
    app: Any,
    address: str,
    port: int,
    *,
    allow_any: bool = False,
    ssl_certfile: str | None = None,
    ssl_keyfile: str | None = None,
) -> None:
    """Run ``app`` with Uvicorn on ``address:port`` after ``check_bind_address``."""
    check_bind_address(address, allow_any=allow_any)
    import uvicorn

    uvicorn.run(
        app,
        host=address,
        port=port,
        ssl_certfile=ssl_certfile,
        ssl_keyfile=ssl_keyfile,
        log_level="info",
    )
