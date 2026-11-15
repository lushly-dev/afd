"""A client for a host served over HTTP (``botcore.host_http``): call, catalog, docs, upload.

Standard library only, so scripts and agents need no extras. Every method returns a
CommandResult as a dict. When the server cannot be reached, or answers with a gateway or
server failure, the result is an error with ``unavailable_code`` (``HOST_UNAVAILABLE`` by
default; the factory gateway's CLI passes ``GATEWAY_UNAVAILABLE``) and a suggestion, never an
exception, so a caller never falls back to another way of writing.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any

DEFAULT_TIMEOUT_SECONDS = 330.0  # Longer than a gateway-wait's own five minutes.


def _error(code: str, message: str, suggestion: str, **details) -> dict:
    body = {"code": code, "message": message, "suggestion": suggestion}
    if details:
        body["details"] = details
    return {"success": False, "error": body}


class HostClient:
    """Calls one route of a served host with one token."""

    def __init__(
        self,
        base_url: str,
        route: str,
        token: str,
        *,
        unavailable_code: str = "HOST_UNAVAILABLE",
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.route = route.strip("/")
        self.token = token
        self.unavailable_code = unavailable_code
        self.timeout = timeout

    def call(
        self, command: str, arguments: dict | None = None, *, on_behalf_of: str | None = None
    ) -> dict:
        body: dict[str, Any] = {"command": command, "arguments": arguments or {}}
        if on_behalf_of:
            body["onBehalfOf"] = on_behalf_of
        return self._send("POST", "call", json.dumps(body).encode(), "application/json")

    def catalog(self) -> dict:
        return self._send("GET", "catalog")

    def docs(self, topic: str) -> dict:
        return self._send("GET", f"docs/{topic}")

    def upload(self, data: bytes) -> dict:
        return self._send("POST", "uploads", data, "application/octet-stream")

    def _unavailable(self, reason: str) -> dict:
        return _error(
            self.unavailable_code,
            f"{self.base_url}/{self.route} cannot be reached: {reason}",
            "Nothing was written. Retry the same call when it is back (every write is safe to "
            "retry); do not write another way",
            url=f"{self.base_url}/{self.route}",
        )

    def _send(
        self, method: str, path: str, data: bytes | None = None, content_type: str | None = None
    ) -> dict:
        request = urllib.request.Request(
            f"{self.base_url}/{self.route}/{path}", data=data, method=method
        )
        request.add_header("Authorization", f"Bearer {self.token}")
        request.add_header("Accept", "application/json")
        if content_type:
            request.add_header("Content-Type", content_type)
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                return json.loads(response.read() or b"{}")
        except urllib.error.HTTPError as exc:
            if exc.code in (502, 503, 504):
                return self._unavailable(f"HTTP {exc.code}")
            try:
                return json.loads(exc.read() or b"{}")
            except ValueError:
                return self._unavailable(f"HTTP {exc.code} without a result")
        except (urllib.error.URLError, ConnectionError, TimeoutError) as exc:
            return self._unavailable(str(getattr(exc, "reason", exc)))
        except ValueError:
            return self._unavailable("an answer that is not JSON")


def create_remote_cli(
    name: str,
    *,
    env_prefix: str,
    unavailable_code: str = "HOST_UNAVAILABLE",
) -> Any:
    """A click CLI calling a served host: ``call``, ``catalog``, ``docs`` and ``upload``.

    The URL, route and token come from ``--url``/``--route``/``--token`` or
    ``<env_prefix>_URL``, ``<env_prefix>_ROUTE`` and ``<env_prefix>_TOKEN`` (or a file named
    by ``<env_prefix>_TOKEN_FILE``). Output is the CommandResult as JSON; the exit code is 0
    on success, 1 on a refusal and 2 when the host cannot be reached.
    """
    import os
    import sys
    from pathlib import Path

    import click

    def client(url: str | None, route: str | None, token: str | None) -> HostClient:
        url = url or os.environ.get(f"{env_prefix}_URL")
        route = route or os.environ.get(f"{env_prefix}_ROUTE")
        token = token or os.environ.get(f"{env_prefix}_TOKEN")
        token_file = os.environ.get(f"{env_prefix}_TOKEN_FILE")
        if not token and token_file:
            token = Path(token_file).expanduser().read_text(encoding="utf-8").strip()
        missing = [
            label
            for label, value in (("URL", url), ("ROUTE", route), ("TOKEN", token))
            if not value
        ]
        if missing:
            raise click.UsageError(
                "Set "
                + ", ".join(f"{env_prefix}_{label}" for label in missing)
                + " or pass the matching option"
            )
        return HostClient(url, route, token, unavailable_code=unavailable_code)

    def emit(result: dict) -> None:
        click.echo(json.dumps(result, indent=2))
        if result.get("success"):
            sys.exit(0)
        code = (result.get("error") or {}).get("code")
        sys.exit(2 if code == unavailable_code else 1)

    options = [
        click.option("--url", default=None, help=f"Base URL ({env_prefix}_URL)"),
        click.option("--route", default=None, help=f"Route ({env_prefix}_ROUTE)"),
        click.option("--token", default=None, help=f"Bearer token ({env_prefix}_TOKEN)"),
    ]

    def with_options(function):
        for option in reversed(options):
            function = option(function)
        return function

    @click.group(name=name)
    def group() -> None:
        """Call a served host's commands."""

    @group.command("call")
    @click.argument("command")
    @click.option("--args", "arguments", default="{}", help="Arguments as a JSON object")
    @click.option("--on-behalf-of", default=None, help="Who this call serves, as you say")
    @with_options
    def call_cmd(command, arguments, on_behalf_of, url, route, token) -> None:
        """Call COMMAND with --args '{...}'."""
        try:
            parsed = json.loads(arguments)
        except ValueError as exc:
            raise click.BadParameter(f"--args is not JSON: {exc}") from None
        emit(client(url, route, token).call(command, parsed, on_behalf_of=on_behalf_of))

    @group.command("catalog")
    @with_options
    def catalog_cmd(url, route, token) -> None:
        """List the route's commands and their schemas."""
        result = client(url, route, token).catalog()
        emit(result if "success" in result else {"success": True, "data": result})

    @group.command("docs")
    @click.argument("topic")
    @with_options
    def docs_cmd(topic, url, route, token) -> None:
        """Read a documentation topic."""
        result = client(url, route, token).docs(topic)
        emit(result if "success" in result else {"success": True, "data": result})

    @group.command("upload")
    @click.argument("file", type=click.Path(exists=True, dir_okay=False, path_type=Path))
    @with_options
    def upload_cmd(file, url, route, token) -> None:
        """Upload FILE (a git bundle for the factory gateway); prints its upload id."""
        emit(client(url, route, token).upload(file.read_bytes()))

    return group
