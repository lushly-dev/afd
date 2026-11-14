"""Intake: what triage left untriaged or labelled against the rules, what a cell may take
next, and which claims have outlived their lease.

The rules are ``labels``' (shared with ``scripts/issue-labels.mjs``); claims are read from the
claim comments of ``status:in-progress`` issues (``claims``).
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime

from botcore_factory.claims import Claim, current_claim
from botcore_factory.labels import (
    IN_PROGRESS,
    PLANNED,
    Candidate,
    dispatch_order,
    held_reasons,
    is_untriaged,
    issue_violations,
)
from botcore_factory.runtime import Factory, Refusal
from botcore_factory.world import Issue


@dataclass(frozen=True)
class Backlog:
    """One consistent read of the issues, their claims and the open PRs that would close them."""

    issues: tuple[Issue, ...]
    definitions: list[dict]
    with_open_pr: frozenset[int]
    claims: dict[int, Claim | None]
    now: datetime

    @property
    def claimed(self) -> frozenset[int]:
        return frozenset(self.claims)

    def candidate(self, issue: Issue) -> Candidate:
        return Candidate(issue.number, issue.labels, issue.assigned, issue.created_at)

    def open_issues(self) -> list[Issue]:
        return [issue for issue in self.issues if issue.state == "OPEN"]


def read_backlog(factory: Factory, numbers: Sequence[int] | None = None) -> Backlog:
    """Read issues (all open ones, or the numbered ones), open PRs and the claims of claimed issues.

    Any failed read raises WorldError: the check never answers from a partial read.
    """
    if numbers and any(not isinstance(n, int) or isinstance(n, bool) or n < 1 for n in numbers):
        raise Refusal(
            "VALIDATION_ERROR",
            f"Not issue numbers: {list(numbers)}",
            "Pass numbers as a list of issue numbers, or leave it out to check every open issue",
        )
    definitions = factory.definitions()
    github = factory.world.github
    issues = [github.get_issue(n) for n in numbers] if numbers else github.list_issues()
    with_open_pr = frozenset(n for pr in github.open_pull_requests() for n in pr.closes)
    claims = {
        issue.number: current_claim(github.comments(issue.number))
        for issue in issues
        if issue.state == "OPEN" and IN_PROGRESS in issue.labels
    }
    return Backlog(tuple(issues), definitions, with_open_pr, claims, factory.world.clock.now())


def dispatchable(backlog: Backlog) -> list[int]:
    ready, _ = dispatch_order(
        [backlog.candidate(issue) for issue in backlog.open_issues()],
        backlog.definitions,
        backlog.with_open_pr,
        backlog.claimed,
    )
    return [issue.number for issue in ready]


def stale_claims(backlog: Backlog) -> list[dict]:
    """Claimed issues whose lease expired, or that carry no claim comment at all."""
    stale = []
    for number, claim in sorted(backlog.claims.items()):
        if claim is None:
            stale.append({"number": number, "branch": None, "machine": None, "leaseUntil": None})
        elif claim.expired(backlog.now):
            stale.append({"number": number, **claim.describe()})
    return stale


def check(backlog: Backlog) -> dict:
    """The full intake report, every list in a stable order."""
    issues = sorted(backlog.open_issues(), key=lambda issue: issue.number)
    _, held = dispatch_order(
        [backlog.candidate(issue) for issue in issues],
        backlog.definitions,
        backlog.with_open_pr,
        backlog.claimed,
    )
    return {
        "untriaged": [issue.number for issue in issues if is_untriaged(issue.labels)],
        "violations": [
            {"number": issue.number, "rule": rule}
            for issue in issues
            for rule in issue_violations(issue.labels, issue.assigned, backlog.definitions)
        ],
        "dispatchable": dispatchable(backlog),
        # Related issues (same area and files) are not computed yet; cells take one issue each.
        "related": [],
        "staleClaims": stale_claims(backlog),
        "held": held,
    }


def not_dispatchable_reasons(backlog: Backlog, issue: Issue) -> list[str]:
    """Why a cell may not take ``issue``; empty when it may."""
    if issue.state != "OPEN":
        return [f"#{issue.number} is {issue.state.lower()}"]
    if PLANNED not in issue.labels:
        statuses = [label for label in issue.labels if label.startswith("status:")]
        return [f"#{issue.number} is not planned ({', '.join(statuses) or 'no status label'})"]
    candidate = backlog.candidate(issue)
    return held_reasons(candidate, backlog.definitions, backlog.with_open_pr, backlog.claimed)
