"""The gateway's hosts, one per kind of caller, on botcore's remote-caller profile.

Each host serves its route's commands under their kebab-case names and journals every call
with AFD's journal middleware, recording the actor the route's verified token named.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime

from afd import Actor
from afd.server.journal import create_journal_middleware
from botcore.context import ExecutionContext
from botcore.host import CommandHost

from botcore_factory.gateway.commands import POLICIES, make_commands
from botcore_factory.gateway.commands import ROUTES as ROUTES
from botcore_factory.gateway.config import GatewayConfig
from botcore_factory.gateway.docs import DOCS
from botcore_factory.gateway.github import GitHub
from botcore_factory.gateway.service import Gateway
from botcore_factory.gateway.state import DailyJournalSink, GatewayState


def build_gateway_host(
    route: str,
    context: ExecutionContext,
    *,
    github: GitHub,
    config: GatewayConfig,
    state: GatewayState,
    actor: Actor | None = None,
    clock: Callable[[], datetime] | None = None,
    contains: Callable[[str, str, str], bool] | None = None,
) -> CommandHost:
    """Build ``gateway-<route>``. ``context`` must use the ``remote-caller`` profile, whose
    target is the gateway's data directory; ``actor`` is who a call without its own
    context (one the HTTP surface builds from the verified token) is made as. Every route's
    host in one process takes the same ``state``, whose lock serialises their writes."""
    if route not in ROUTES:
        raise ValueError(f"Unknown gateway route {route!r}; use one of: {', '.join(ROUTES)}")
    if context.profile != "remote-caller":
        raise ValueError("A gateway host runs on the remote-caller profile")
    name = f"gateway-{route}"
    gateway = Gateway(github, config, state, route, clock, contains)
    host = CommandHost(name, context, actor=actor)
    for command, handler in make_commands(route, lambda: gateway, name).items():
        host.register(command, handler, POLICIES[command])
    host.middleware = [
        create_journal_middleware(
            DailyJournalSink(state.journal_dir),
            record_failures=True,
            # A lane reports every minute or so; state.json keeps its last report and who sent
            # it, and the journal, which gateway-audit and gateway-wait read whole, stays small.
            filter=lambda command: not command.startswith("auth-") and command != "lane-heartbeat",
        )
    ]
    host.docs = {"gateway": DOCS}
    return host
