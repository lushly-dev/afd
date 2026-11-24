"""The gateway's configuration: who it is, what it serves and its limits.

Field aliases are the camelCase keys the scenario fixtures and a deployment's
``gateway.json`` use; Python reads the snake_case names.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

#: Writes per hour each kind of caller may make before WRITE_BUDGET_EXCEEDED; None is no limit.
DEFAULT_WRITES_PER_HOUR: dict[str, int | None] = {
    "cell": 30,
    "session": 60,
    "foreman": 300,
    "lane": 600,
    "owner": None,
    # Reports health only; it makes no write the budget counts, and fails closed if one is added.
    # A configuration that sets writesPerHour replaces this map: list heartbeat (0) there too.
    "heartbeat": 0,
}


class _Model(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")


class RequiredCheck(_Model):
    name: str = "ci-ok"
    #: Whether branch protection on main requires the check, so auto-merge waits for it.
    required_on_main: bool = Field(default=True, alias="requiredOnMain")


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


class Cache(_Model):
    #: Seconds callers share one read of a repository's issues or pull requests (the scans
    #: behind claim-list, gateway-audit and gateway-wait); 0 reads GitHub on every call.
    graphql_seconds: float = Field(default=15, ge=0, alias="graphqlSeconds")


class Journal(_Model):
    #: UTC days of daily journal files to retain; older day files are pruned at start and on
    #: UTC day rollover. 0 disables pruning.
    keep_days: int = Field(default=365, ge=0, alias="keepDays")


class GitHubAppConfig(_Model):
    """The App the gateway writes as. Neither id is secret; the private key is a file on the
    gateway's machine, passed to ``serve --app-key``."""

    app_id: int = Field(alias="appId")
    installation_id: int = Field(alias="installationId")


class GatewayConfig(_Model):
    app: str = "factory-gateway"
    #: The App's bot login, the author of every factory write.
    bot: str
    #: The owner's login. Until G5 his account is shared with agents.
    owner: str
    repositories: list[str]
    required_check: RequiredCheck = Field(
        default_factory=lambda: RequiredCheck(), alias="requiredCheck"
    )
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
    #: Minutes after its last lane-heartbeat that a repository's lane counts as stopped.
    lane_stale_minutes: float = Field(5, gt=0, allow_inf_nan=False, alias="laneStaleMinutes")
    lease_hours: float = Field(24, alias="leaseHours")
    body_max_bytes: int = Field(64 * 1024, alias="bodyMaxBytes")
    writes_per_hour: dict[str, int | None] = Field(
        default_factory=lambda: dict(DEFAULT_WRITES_PER_HOUR), alias="writesPerHour"
    )
    #: The emails the owner commits with. branch-push refuses a commit any other email authored:
    #: work is credited to the owner, and an agent that helped is an Assisted-by trailer.
    owner_emails: list[str] = Field(min_length=1, alias="ownerEmails")
    #: How pr-merge merges in each repository. "merge" (the default) keeps every commit and its
    #: author; "rebase" lands each commit as it is, its author kept; "squash" makes one commit,
    #: authored by whoever merges (an App credits its bot).
    merge_methods: dict[str, Literal["merge", "squash", "rebase"]] = Field(
        default_factory=dict, alias="mergeMethods"
    )
    #: The App to write as; absent, ``serve`` runs only against a fake GitHub.
    github_app: GitHubAppConfig | None = Field(None, alias="githubApp")
    #: Most milliseconds gateway-wait blocks on one call over MCP.
    wait_max_ms: int = Field(300_000, alias="waitMaxMs")
    cache: Cache = Field(default_factory=lambda: Cache())
    journal: Journal = Field(default_factory=lambda: Journal())

    @model_validator(mode="after")
    def _merge_methods_name_served_repositories(self) -> GatewayConfig:
        unknown = sorted(set(self.merge_methods) - set(self.repositories))
        if unknown:
            raise ValueError(
                f"mergeMethods names repositories the gateway does not serve: {', '.join(unknown)}"
            )
        return self

    def merge_method(self, repo: str) -> str:
        return self.merge_methods.get(repo, "merge")

    def is_owner_email(self, email: str) -> bool:
        return email.strip().lower() in {owned.lower() for owned in self.owner_emails}
