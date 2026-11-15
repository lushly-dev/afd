"""Claims, read back from GitHub: the bot's claim and release comments, and during the cutover
the owner's older claims, by their own liveness rules.

GitHub is the record. A claim is the ``status:in-progress`` label plus the latest
``botcore-factory:claim`` comment the App wrote; a ``botcore-factory:release`` comment the App
wrote after it ends it. A comment anyone else writes in either marker is ignored, apart from
the cutover rule: the owner's account's claims written before ``cutover.from``, honoured while
live until ``cutover.legacyUntil``.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime, timedelta

from botcore_factory.gateway.config import GatewayConfig

CLAIM = "botcore-factory:claim"
RELEASE = "botcore-factory:release"
LUSHLY = "lushly-issue-claim"
IN_PROGRESS = "status:in-progress"
PLANNED = "status:planned"
_MARKER = re.compile(r"<!--\s*([\w:.-]+)\s+(\{.*?\})\s*-->", re.DOTALL)


def parse_time(value: str | datetime | None) -> datetime | None:
    if value is None or isinstance(value, datetime):
        return value
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def iso(value: datetime) -> str:
    return value.strftime("%Y-%m-%dT%H:%M:%SZ")


@dataclass(frozen=True)
class Claim:
    number: int
    branch: str
    machine: str
    lease_until: datetime
    at: datetime
    legacy: bool = False

    def holder(self) -> dict:
        return {"branch": self.branch, "machine": self.machine}

    def held_by(self, branch: str, machine: str | None = None) -> bool:
        return self.branch == branch and (machine is None or self.machine == machine)

    def stale(self, now: datetime) -> bool:
        return self.lease_until <= now

    def describe(self) -> str:
        return f"{self.branch} on {self.machine} until {iso(self.lease_until)}"


@dataclass(frozen=True)
class Release:
    number: int
    branch: str
    machine: str
    at: datetime


def _markers(body: str) -> list[tuple[str, dict]]:
    found = []
    for kind, payload in _MARKER.findall(body or ""):
        try:
            value = json.loads(payload)
        except ValueError:
            continue
        if isinstance(value, dict):
            found.append((kind, value))
    return found


def _legacy(
    number: int, kind: str, value: dict, at: datetime, config: GatewayConfig, active: datetime
):
    cutover = config.cutover
    if kind == CLAIM and {"branch", "machine", "leaseUntil"} <= set(value):
        until = parse_time(value["leaseUntil"])
        return Claim(number, value["branch"], value["machine"], until, at, legacy=True)
    if kind == LUSHLY and {"branch", "host", "startedAt"} <= set(value):
        # Lushly's rule: live until four hours pass without activity on the issue by its
        # holder's account (the lease's start, or a later comment from that account).
        last = max(parse_time(value["startedAt"]), active)
        until = last + timedelta(hours=cutover.lushly_stale_hours)
        return Claim(number, value["branch"], value["host"], until, at, legacy=True)
    return None


def read_claim(number: int, comments: list[dict], config: GatewayConfig, now: datetime):
    """The issue's current record: a ``Claim``, a ``Release`` or ``None`` when never claimed.

    A legacy claim the cutover no longer honours, or one already lapsed, is not a claim.
    """
    record: Claim | Release | None = None
    cutover = config.cutover
    ordered = sorted(comments, key=lambda c: c.get("at") or "")
    active = max(
        (
            parse_time(c["at"])
            for c in ordered
            if cutover and c.get("at") and c.get("author") == cutover.legacy_author
        ),
        default=datetime.min.replace(tzinfo=now.tzinfo),
    )
    for comment in ordered:
        at = parse_time(comment.get("at")) or now
        for kind, value in _markers(comment.get("body", "")):
            if comment.get("author") == config.bot:
                if kind == CLAIM and {"branch", "machine", "leaseUntil"} <= set(value):
                    until = parse_time(value["leaseUntil"])
                    record = Claim(number, value["branch"], value["machine"], until, at)
                elif kind == RELEASE and {"branch", "machine"} <= set(value):
                    record = Release(number, value["branch"], value["machine"], at)
            elif (
                cutover is not None
                and comment.get("author") == cutover.legacy_author
                and kind in cutover.legacy_markers
                and at < cutover.start
                and now < cutover.legacy_until
            ):
                legacy = _legacy(number, kind, value, at, config, active)
                if legacy is not None and not legacy.stale(now):
                    record = legacy
    return record


def claim_body(holder: dict, lease_until: datetime) -> str:
    payload = {**holder, "leaseUntil": iso(lease_until)}
    return (
        f"Claimed by the factory gateway for `{holder['branch']}`.\n\n{marker_text(CLAIM, payload)}"
    )


def release_body(holder: dict, reason: str) -> str:
    return (
        f"Released by the factory gateway: {reason}\n\n"
        f"{marker_text(RELEASE, {**holder, 'reason': reason})}"
    )


def marker_text(kind: str, payload: dict) -> str:
    return f"<!-- {kind} {json.dumps(payload, sort_keys=True)} -->"
