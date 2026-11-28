"""An HTTP surface for managed hosts: one route per host, each behind a bearer token.

``create_host_http_app({"lane": host, ...}, tokens)`` serves, under ``/<route>``:

- ``POST /<route>/call``  ``{"command", "arguments"?, "onBehalfOf"?}``: the command's
  CommandResult. The token decides the route and the actor; ``onBehalfOf`` is what the caller
  says, and is kept as such.
- ``GET /<route>/catalog``: the host's catalog rows, as its ``info_catalog`` command lists them.
- ``GET /<route>/docs/<topic>``: a documentation topic.
- ``POST /<route>/uploads``: raw bytes, with the query string's parameters, for the
  ``uploads`` handler (a git bundle, for the factory gateway), which returns a CommandResult.

Every answer is a CommandResult, transport refusals included (``UNAUTHORIZED``,
``FORBIDDEN``, ``NOT_FOUND``, ``PAYLOAD_TOO_LARGE``, ``RATE_LIMITED``), so a client reads one
shape. The token is checked before anything else, so a caller without one learns nothing about
the routes. A call's body is capped (``max_call_bytes``), and so are an upload's size, the time
its body may take to arrive, the uploads running at once and the uploads one token runs at once
(one), so a slow caller cannot hold every slot. A command's
own refusal is HTTP 200: the call reached the host. ``serve_hosts`` binds only to loopback or a
tailnet address unless the operator says otherwise.

Needs the ``mcp`` extra (Starlette and Uvicorn).
"""

from __future__ import annotations

import ipaddress
import json
from collections.abc import Awaitable, Callable
from typing import Any, Literal, cast

from afd import Actor, CommandResult, error
from afd.core.commands import CommandContext

from botcore.host import CommandHost
from botcore.host_tokens import TokenRecord, TokenStore

#: Receives the route, the verified caller, the request body and the query string's parameters;
#: returns a CommandResult.
UploadHandler = Callable[[str, Actor, bytes, dict[str, str]], Awaitable[CommandResult[Any]]]

DEFAULT_MAX_UPLOAD_BYTES = 256 * 1024 * 1024
DEFAULT_MAX_CALL_BYTES = 1024 * 1024
DEFAULT_MAX_CONCURRENT_UPLOADS = 2
#: Seconds an upload's body may take to arrive; a slower one is refused, freeing its slot.
DEFAULT_UPLOAD_READ_SECONDS = 120.0
TAILNET_NETWORKS = (
    ipaddress.ip_network("100.64.0.0/10"),
    ipaddress.ip_network("fd7a:115c:a1e0::/48"),
)


def _dump(result: CommandResult[Any]) -> dict[str, Any]:
    return result.model_dump(mode="json", exclude_none=True)


def _bearer(header: str | None) -> str | None:
    if not header:
        return None
    scheme, _, value = header.partition(" ")
    return value.strip() if scheme.lower() == "bearer" and value.strip() else None


class _HostRoutes:
    """The handlers behind ``create_host_http_app``; each answers with a CommandResult."""

    def __init__(
        self,
        hosts: dict[str, CommandHost],
        tokens: TokenStore,
        uploads: UploadHandler | None,
        max_upload_bytes: int,
        max_call_bytes: int,
        max_concurrent_uploads: int,
        upload_read_seconds: float,
        upload_routes: frozenset[str] | None = None,
    ) -> None:
        import asyncio

        self.hosts: dict[str, CommandHost] = hosts
        self.tokens: TokenStore = tokens
        self.uploads: UploadHandler | None = uploads
        self.max_upload_bytes = max_upload_bytes
        self.max_call_bytes = max_call_bytes
        self.upload_slots = asyncio.Semaphore(max_concurrent_uploads)
        self.uploading: set[str] = set()  # Token ids with an upload in progress.
        self.upload_read_seconds = upload_read_seconds
        self.upload_routes = upload_routes

    @staticmethod
    def json(body: dict[str, Any], status: int = 200) -> Any:
        from starlette.responses import JSONResponse

        return JSONResponse(body, status_code=status)

    def refused(self, status: int, code: str, message: str, suggestion: str) -> Any:
        return self.json(_dump(error(code, message, suggestion=suggestion)), status)

    def admit(self, request: Any) -> tuple[str, CommandHost, TokenRecord] | Any:
        """The route, host and caller, or the refusal: no valid token (checked first, so no
        route is named to a caller without one), or a route this token does not open."""
        record = self.tokens.verify(_bearer(request.headers.get("authorization")))
        if record is None:
            return self.refused(
                401,
                "UNAUTHORIZED",
                "No valid bearer token",
                "Send 'Authorization: Bearer <token>' with the token the operator issued you",
            )
        route = request.path_params["route"]
        host = self.hosts.get(route)
        if host is None or record.route != route:
            return self.refused(
                403,
                "FORBIDDEN",
                f"This token opens /{record.route}, not /{route}",
                f"Call /{record.route}, or ask the operator for a token for /{route}",
            )
        return route, host, record

    @staticmethod
    def actor(record: TokenRecord, on_behalf_of: Any = None) -> Actor:
        claimed = on_behalf_of[:200] if isinstance(on_behalf_of, str) else None
        actor_kind = cast(Literal["human", "agent", "service", "script", "test"], record.kind)
        return Actor(kind=actor_kind, id=record.actor, label=record.label, on_behalf_of=claimed)

    async def body(self, request: Any, limit: int) -> bytes | None:
        """The request body, or None once it passes ``limit`` bytes (declared or streamed)."""
        declared = request.headers.get("content-length")
        if declared is not None and declared.isdigit() and int(declared) > limit:
            return None
        received = bytearray()
        async for chunk in request.stream():
            received += chunk
            if len(received) > limit:
                return None
        return bytes(received)

    async def call(self, request: Any) -> Any:
        admitted = self.admit(request)
        if not isinstance(admitted, tuple):
            return admitted
        _, host, record = admitted
        raw = await self.body(request, self.max_call_bytes)
        if raw is None:
            return self.refused(
                413,
                "PAYLOAD_TOO_LARGE",
                f"A call's body may be at most {self.max_call_bytes} bytes",
                "Send large content through an upload, or shorten the arguments",
            )
        try:
            body = json.loads(raw)
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

    async def catalog(self, request: Any) -> Any:
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

    async def docs(self, request: Any) -> Any:
        admitted = self.admit(request)
        if not isinstance(admitted, tuple):
            return admitted
        _, host, _ = admitted
        topic = request.path_params["topic"]
        if topic not in host.docs:
            topics = ", ".join(sorted(host.docs)) or "(none)"
            return self.refused(404, "NOT_FOUND", f"No docs topic {topic}", f"Use one of: {topics}")
        return self.json({"topic": topic, "text": host.docs[topic]})

    async def upload(self, request: Any) -> Any:
        admitted = self.admit(request)
        if not isinstance(admitted, tuple):
            return admitted
        route, _, record = admitted
        if self.uploads is None or (
            self.upload_routes is not None and route not in self.upload_routes
        ):
            # Refused before a slot is taken or a byte of the body is read.
            return self.refused(404, "NOT_FOUND", f"/{route} takes no uploads", "Call a command")
        if record.id in self.uploading or self.upload_slots.locked():
            return self.refused(
                429,
                "RATE_LIMITED",
                "This token's upload, or others, are being received",
                "Wait for the upload in progress to finish, then retry in a few seconds",
            )
        import asyncio

        self.uploading.add(record.id)
        try:
            async with self.upload_slots:
                try:
                    async with asyncio.timeout(self.upload_read_seconds):
                        data = await self.body(request, self.max_upload_bytes)
                except TimeoutError:
                    return self.refused(
                        408,
                        "TIMEOUT",
                        f"The upload did not arrive within {self.upload_read_seconds:g} seconds",
                        "Upload again from a faster connection, or bundle fewer commits",
                    )
                if data is None:
                    return self.too_large()
                params = dict(request.query_params)
                result = await self.uploads(route, self.actor(record), data, params)
                return self.json(_dump(result))
        finally:
            self.uploading.discard(record.id)

    def too_large(self) -> Any:
        return self.refused(
            413,
            "PAYLOAD_TOO_LARGE",
            f"The upload is larger than this host takes ({self.max_upload_bytes} bytes)",
            "Bundle only the commits the push needs (git bundle create <file> <base>..<branch>)",
        )


def create_host_http_app(
    hosts: dict[str, CommandHost],
    tokens: TokenStore,
    *,
    uploads: UploadHandler | None = None,
    max_upload_bytes: int = DEFAULT_MAX_UPLOAD_BYTES,
    max_call_bytes: int = DEFAULT_MAX_CALL_BYTES,
    max_concurrent_uploads: int = DEFAULT_MAX_CONCURRENT_UPLOADS,
    upload_read_seconds: float = DEFAULT_UPLOAD_READ_SECONDS,
    upload_routes: frozenset[str] | None = None,
) -> Any:
    """A Starlette app serving each host in ``hosts`` under ``/<route>``. ``upload_routes``
    names the routes that take uploads; any other is refused before its body is read. Left
    out, every route does."""
    from starlette.applications import Starlette
    from starlette.routing import Route

    routes = _HostRoutes(
        hosts,
        tokens,
        uploads,
        max_upload_bytes,
        max_call_bytes,
        max_concurrent_uploads,
        upload_read_seconds,
        upload_routes,
    )
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
    them to every network the machine joins. The check is by range: ``100.64.0.0/10`` is also
    carrier-grade NAT space, so pass the address ``tailscale ip -4`` prints, not one from
    another interface.
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
