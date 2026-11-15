"""The Factory Gateway: the factory's one door to GitHub.

One process serves five botcore hosts, one per kind of caller (``gateway-cell``,
``gateway-session``, ``gateway-foreman``, ``gateway-lane``, ``gateway-owner``), each on the
``remote-caller`` profile. Every factory write to GitHub is made by this service as the
GitHub App's bot and journaled with the caller its token names. See
``docs/features/active/factory-gateway/`` for the proposal, its jobs and its status.

G1 skeleton: the commands run against a ``GitHub`` port; ``FakeGitHub`` is the only adapter
so far, a JSON world the scenarios and tests drive. The App-backed adapter, the HTTP routes
and the token CLI come with G0.
"""

from __future__ import annotations

from botcore_factory.gateway.config import GatewayConfig
from botcore_factory.gateway.hosts import ROUTES, build_gateway_host

__all__ = ["ROUTES", "GatewayConfig", "build_gateway_host"]
