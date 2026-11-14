"""Claims live on GitHub: ``status:in-progress`` plus one claim comment per claim.

The comment names the branch, the machine and the lease expiry in a marker a person can read
past and the plugin parses back. The latest claim comment on an issue is its claim, unless a
release comment follows it. Nothing about claims is kept in local state.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import UTC, datetime

from botcore_factory.world import Comment

_MARKER = re.compile(r"<!--\s*botcore-factory:(claim|release)\s+(\{.*?\})\s*-->", re.DOTALL)


@dataclass(frozen=True)
class Claim:
    """A cell's hold on an issue until ``lease_until``."""

    branch: str
    machine: str
    lease_until: str

    def expired(self, now: datetime) -> bool:
        return parse_time(self.lease_until) <= now

    def describe(self) -> dict:
        return {"branch": self.branch, "machine": self.machine, "leaseUntil": self.lease_until}


def parse_time(value: str) -> datetime:
    """An ISO 8601 time; a value without a zone is taken as UTC."""
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def format_time(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def claim_body(claim: Claim) -> str:
    """The claim comment: a parseable marker, then one sentence for people."""
    marker = json.dumps(claim.describe(), sort_keys=True)
    return (
        f"<!-- botcore-factory:claim {marker} -->\n"
        f"Claimed by the software factory for branch `{claim.branch}` on `{claim.machine}`; "
        f"the lease runs until {claim.lease_until}."
    )


def release_body(branch: str, reason: str) -> str:
    marker = json.dumps({"branch": branch}, sort_keys=True)
    return f"<!-- botcore-factory:release {marker} -->\nReleased `{branch}`: {reason}"


def _parse(body: str) -> tuple[str, dict] | None:
    match = _MARKER.search(body)
    if not match:
        return None
    try:
        data = json.loads(match[2])
    except ValueError:
        return None
    return (match[1], data) if isinstance(data, dict) else None


def current_claim(comments: list[Comment]) -> Claim | None:
    """The claim the latest claim comment records, unless a later release ended it."""
    claim: Claim | None = None
    for comment in comments:
        parsed = _parse(comment.body)
        if parsed is None:
            continue
        kind, data = parsed
        if kind == "release":
            if claim is not None and data.get("branch") in (None, claim.branch):
                claim = None
            continue
        branch, machine, lease = data.get("branch"), data.get("machine"), data.get("leaseUntil")
        if all(isinstance(value, str) and value for value in (branch, machine, lease)):
            try:
                parse_time(lease)
            except ValueError:
                continue  # A marker with an unreadable lease is not a claim this plugin wrote.
            claim = Claim(branch, machine, lease)
    return claim
