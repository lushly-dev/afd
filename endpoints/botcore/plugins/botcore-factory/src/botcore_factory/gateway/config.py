"""The gateway's configuration: who it is, what it serves and its limits.

Field aliases are the camelCase keys the scenario fixtures and a deployment's
``gateway.json`` use; Python reads the snake_case names.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

#: Writes per hour each kind of caller may make before WRITE_BUDGET_EXCEEDED; None is no limit.
DEFAULT_WRITES_PER_HOUR: dict[str, int | None] = {
    "cell": 30,
    "session": 60,
    "foreman": 300,
    "lane": 600,
    "owner": None,
}


class _Model(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")


class RequiredCheck(_Model):
    name: str = "ci-ok"
    #: Whether branch protection on main requires the check, so auto-merge waits for it.
    required_on_main: bool = Field(True, alias="requiredOnMain")


class Cutover(_Model):
    """Claims the owner's account wrote before the gateway, honoured read-only for a while."""

    start: datetime = Field(alias="from")
    legacy_until: datetime = Field(alias="legacyUntil")
    legacy_markers: list[str] = Field(
        default_factory=lambda: ["lushly-issue-claim", "botcore-factory:claim"],
        alias="legacyMarkers",
    )
    legacy_author: str = Field(alias="legacyAuthor")
    lushly_stale_hours: float = Field(4, alias="lushlyStaleHours")


class GatewayConfig(_Model):
    app: str = "factory-gateway"
    #: The App's bot login, the author of every factory write.
    bot: str
    #: The owner's login. Until G5 his account is shared with agents.
    owner: str
    repositories: list[str]
    required_check: RequiredCheck = Field(default_factory=RequiredCheck, alias="requiredCheck")
    protected_refs: list[str] = Field(
        default_factory=lambda: ["refs/heads/main"], alias="protectedRefs"
    )
    #: The repository's own secret patterns, checked with the built-in rules.
    secret_patterns: list[str] = Field(default_factory=list, alias="secretPatterns")
    allowed_variables: list[str] = Field(
        default_factory=lambda: ["FACTORY_LANE_HOST"], alias="allowedVariables"
    )
    cutover: Cutover | None = None
    stall_minutes: float = Field(15, alias="stallMinutes")
    lease_hours: float = Field(24, alias="leaseHours")
    body_max_bytes: int = Field(64 * 1024, alias="bodyMaxBytes")
    writes_per_hour: dict[str, int | None] = Field(
        default_factory=lambda: dict(DEFAULT_WRITES_PER_HOUR), alias="writesPerHour"
    )
    #: Most milliseconds gateway-wait blocks on one call over MCP.
    wait_max_ms: int = Field(300_000, alias="waitMaxMs")
