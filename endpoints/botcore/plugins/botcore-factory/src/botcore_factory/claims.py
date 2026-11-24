"""Claims live on GitHub: ``status:in-progress`` plus one claim comment per claim.

The comment names the branch, the machine and the lease expiry in a marker a person can read
past and the plugin parses back. The earliest standing live claimant holds the issue. A release
ends the claims of its branch (or every claim, naming none) and leaves other branches standing;
the label stays while another branch's live claim stands, because it is that holder's.
scripts/issue-claim.mjs writes and reads the same comments for agent sessions; change both, and
their shared histories in the software factory's scenarios/fixtures/claim-histories.json. The
factory gateway (gateway/claims.py) reads the same markers by its own rule: only the comments
its App wrote, the latest one deciding, since it is their only writer. Nothing about claims is
kept in local state.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

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

    def describe(self) -> dict[str, Any]:
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


def _parse(body: str) -> tuple[str, dict[str, Any]] | None:
    match = _MARKER.search(body)
    if not match:
        return None
    try:
        data = json.loads(match[2])
    except ValueError:
        return None
    return (match[1], data) if isinstance(data, dict) else None


def standing_claims(comments: list[Comment]) -> list[Claim]:
    """The claims no later release ended, oldest first.

    A session that loses a claim race releases its own claim; the earlier claim it lost to must
    still stand, so a release ends only its branch's claims.
    """
    standing: list[Claim] = []
    for comment in comments:
        parsed = _parse(comment.body)
        if parsed is None:
            continue
        kind, data = parsed
        if kind == "release":
            branch = data.get("branch")
            standing = [c for c in standing if branch is not None and c.branch != branch]
            continue
        branch, machine, lease = data.get("branch"), data.get("machine"), data.get("leaseUntil")
        if (
            isinstance(branch, str)
            and branch
            and isinstance(machine, str)
            and machine
            and isinstance(lease, str)
            and lease
        ):
            try:
                parse_time(lease)
            except ValueError:
                continue  # A marker with an unreadable lease is not a claim this plugin wrote.
            standing.append(Claim(branch, machine, lease))
    return standing


def _holder(standing: list[Claim], now: datetime) -> Claim | None:
    # A branch holds its place from its first live claim, and its latest live claim says which
    # lease and machine to report, so a renewal shows the current expiry. Once that first claim
    # lapses the branch's place is its next live one: a rival that claimed in between holds.
    live_by_branch = {claim.branch: claim for claim in standing if not claim.expired(now)}
    return next(iter(live_by_branch.values()), standing[-1] if standing else None)


def current_claim(comments: list[Comment], now: datetime) -> Claim | None:
    """The earliest standing live claimant, or the latest stale record for intake."""
    return _holder(standing_claims(comments), now)


def live_claim_beside(
    comments: list[Comment],
    branch: str,
    now: datetime,
    open_pr_branches: frozenset[str] = frozenset(),
) -> Claim | None:
    """The live claim that holds the issue once ``branch`` gives up its own, if there is one.

    A lapsed claim whose branch has an open pull request counts here, though not for
    ``current_claim``: scripts/issue-claim.mjs reads it as live, so a release that took the
    label away would hide it from that reader.
    """
    live = [
        claim
        for claim in standing_claims(comments)
        if claim.branch != branch and (not claim.expired(now) or claim.branch in open_pr_branches)
    ]
    if not live:
        return None
    return next(claim for claim in reversed(live) if claim.branch == live[0].branch)
