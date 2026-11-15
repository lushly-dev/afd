"""The gateway as one process: its five routes over HTTP, sharing one state and one GitHub.

``build_gateway_app(data_dir, config, github)`` builds a host per route on the
``remote-caller`` profile, the bundle upload handler, and botcore's HTTP surface behind the
token store in ``<data_dir>/tokens.json``. ``factory-gateway-admin serve`` runs it.

The data directory holds ``state.json``, the journal, ``tokens.json``, uploads and the bare
mirrors. It belongs to the gateway's service account and nothing else reads it.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from typing import Any

from botcore.context import ExecutionContext
from botcore.host_http import create_host_http_app
from botcore.host_tokens import TokenStore

from botcore_factory.gateway.commands import ROUTES
from botcore_factory.gateway.config import GatewayConfig
from botcore_factory.gateway.github import GitHub
from botcore_factory.gateway.hosts import build_gateway_host
from botcore_factory.gateway.service import Gateway
from botcore_factory.gateway.state import GatewayState
from botcore_factory.gateway.uploads import BundleUploads, mirror_contains

#: The largest bundle the gateway accepts. A branch's own commits are far smaller; a bundle
#: carrying a repository's whole history is the reason to raise it.
MAX_UPLOAD_BYTES = 512 * 1024 * 1024


def token_store(data_dir: Path) -> TokenStore:
    return TokenStore(data_dir / "tokens.json")


def build_gateway_app(
    data_dir: Path,
    config: GatewayConfig,
    github: GitHub,
    *,
    clock: Callable[[], datetime] | None = None,
    max_upload_bytes: int = MAX_UPLOAD_BYTES,
) -> Any:
    """The Starlette app serving ``/cell``, ``/session``, ``/foreman``, ``/lane`` and
    ``/owner``. Every route's host shares one ``GatewayState``, whose lock serialises writes."""
    data_dir.mkdir(parents=True, exist_ok=True)
    state = GatewayState(data_dir)
    context = ExecutionContext(data_dir, profile="remote-caller")

    def contains(repo: str, head: str, commit: str) -> bool:
        return mirror_contains(data_dir, repo, head, commit)

    hosts = {
        route: build_gateway_host(
            route,
            context,
            github=github,
            config=config,
            state=state,
            clock=clock,
            contains=contains,
        )
        for route in ROUTES
    }
    uploads = BundleUploads(Gateway(github, config, state, "owner", clock), data_dir)
    return create_host_http_app(
        hosts, token_store(data_dir), uploads=uploads, max_upload_bytes=max_upload_bytes
    )
