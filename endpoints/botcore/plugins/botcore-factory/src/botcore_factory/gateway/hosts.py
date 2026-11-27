"""The gateway's hosts, one per kind of caller, on botcore's remote-caller profile.

Each host serves its route's commands under their kebab-case names and journals every write
command (with its failures) via AFD's journal middleware, recording the actor the route's
verified token named.
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
from botcore_factory.gateway.records import WRITE_COMMANDS, audit_record
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
            DailyJournalSink(
                state.journal_dir,
                keep_days=config.journal.keep_days,
                clock=clock,
            ),
            record_failures=True,
            # Journal write commands only (with their failures): pure reads, gateway-wait and
            # lane-heartbeat stay out so polling keeps the journal small (#2413).
            filter=lambda command: command in WRITE_COMMANDS,
            # No gateway command declares `secret`, but failures are journaled too (a body
            # refused with SECRET_IN_BODY), so keep only what the audit reads.
            redact=audit_record,
        )
    ]
    host.docs = {"gateway": DOCS}
    return host
