"""The gateway's two command lines.

- ``factory-gateway``: what scripts and agents run anywhere on the tailnet. It calls one route
  with one token (``FACTORY_GATEWAY_URL``, ``FACTORY_GATEWAY_ROUTE``, ``FACTORY_GATEWAY_TOKEN``
  or ``FACTORY_GATEWAY_TOKEN_FILE``) and reports ``GATEWAY_UNAVAILABLE`` when it cannot reach
  the gateway. Never fall back to ``gh`` for a write.
- ``factory-gateway-admin``: the operator's, on the gateway's machine only: ``serve`` and
  ``token issue|list|revoke``. It is not served over any route.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import click
from botcore.host_client import create_remote_cli

from botcore_factory.gateway.commands import ROUTES
from botcore_factory.gateway.config import GatewayConfig

client_cli = create_remote_cli(
    "factory-gateway", env_prefix="FACTORY_GATEWAY", unavailable_code="GATEWAY_UNAVAILABLE"
)

_data_option = click.option(
    "--data",
    "data_dir",
    required=True,
    type=click.Path(file_okay=False, path_type=Path),
    help="The gateway's data directory (state, journal, tokens, uploads, mirrors)",
)


@click.group("factory-gateway-admin")
def admin_cli() -> None:
    """Run the factory gateway and manage its tokens, on the gateway's machine."""


@admin_cli.command("serve")
@_data_option
@click.option(
    "--config",
    "config_file",
    required=True,
    type=click.Path(exists=True, dir_okay=False, path_type=Path),
    help="The gateway's configuration (gateway.json)",
)
@click.option("--address", required=True, help="`tailscale ip -4`, or 127.0.0.1 behind serve")
@click.option("--port", default=8787, show_default=True, type=int)
@click.option(
    "--fake-github",
    type=click.Path(exists=True, dir_okay=False, path_type=Path),
    default=None,
    help="Serve against a fake GitHub file (local testing only)",
)
@click.option("--allow-any-address", is_flag=True, help="Bind beyond loopback and the tailnet")
def serve(
    data_dir: Path,
    config_file: Path,
    address: str,
    port: int,
    fake_github: Path | None,
    allow_any_address: bool,
) -> None:
    """Serve the five routes from one process."""
    from botcore.host_http import serve_hosts

    from botcore_factory.gateway.github import FakeGitHub
    from botcore_factory.gateway.server import build_gateway_app

    config = GatewayConfig.model_validate_json(config_file.read_text(encoding="utf-8"))
    if fake_github is None:
        raise click.UsageError(
            "The GitHub App adapter is not built yet (milestone G0); pass --fake-github to "
            "serve against a fake GitHub for local testing"
        )
    github = FakeGitHub(fake_github, bot=config.bot)
    app = build_gateway_app(data_dir, config, github)
    try:
        serve_hosts(app, address, port, allow_any=allow_any_address)
    except ValueError as exc:
        raise click.UsageError(str(exc)) from None


@admin_cli.group("token")
def token() -> None:
    """Issue, list and revoke callers' tokens. Each opens one route and names one actor."""


@token.command("issue")
@_data_option
@click.option("--route", required=True, type=click.Choice(list(ROUTES)))
@click.option(
    "--kind", required=True, type=click.Choice(["human", "agent", "service"]), help="Actor kind"
)
@click.option("--actor", "actor_id", required=True, help="Such as lane@random or cell-3")
@click.option("--label", default=None)
def token_issue(data_dir: Path, route: str, kind: str, actor_id: str, label: str | None) -> None:
    """Issue a token; it is printed once and only its digest is kept."""
    from botcore_factory.gateway.server import token_store

    record, secret = token_store(data_dir).issue(route, kind, actor_id, label)
    click.echo(json.dumps({**record.public(), "token": secret}, indent=2))


@token.command("list")
@_data_option
def token_list(data_dir: Path) -> None:
    """List tokens without their secrets."""
    from botcore_factory.gateway.server import token_store

    click.echo(json.dumps([r.public() for r in token_store(data_dir).list()], indent=2))


@token.command("revoke")
@_data_option
@click.argument("token_id")
def token_revoke(data_dir: Path, token_id: str) -> None:
    """Revoke TOKEN_ID from the gateway's next call."""
    from botcore_factory.gateway.server import token_store

    record = token_store(data_dir).revoke(token_id)
    if record is None:
        click.secho(f"No token {token_id}", fg="red", err=True)
        sys.exit(1)
    click.echo(json.dumps(record.public(), indent=2))
