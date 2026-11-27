"""What the gateway's commands do, over a ``GitHub`` port, its config and its own state.

Each method returns a CommandResult. Reads normalise GitHub's states; writes are made as the
App's bot, are idempotent so a caller can retry the same call, check their text for secrets
first and spend the caller's write budget. Who is calling comes from the call's context
(``botcore.context.current_call``), which the route's verified token sets.
"""

from __future__ import annotations

import difflib
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any, TypeVar, cast

from afd import CommandResult, error, success
from botcore.context import current_call

from botcore_factory.gateway import claims as claim_rules
from botcore_factory.gateway.cache import CachedGitHub
from botcore_factory.gateway.claims import IN_PROGRESS, PLANNED, Claim, Release, iso, parse_time
from botcore_factory.gateway.config import GatewayConfig
from botcore_factory.gateway.github import (
    AlreadyMergeable,
    GitHub,
    GitHubRefused,
    GitHubUnavailable,
    HeadMoved,
    MergeMethodNotAllowed,
    comment_url,
)
from botcore_factory.gateway.secrets import CLOSING_KEYWORD, check_text, ref_is_well_formed
from botcore_factory.gateway.state import GatewayState, journal_size

DEDUPE = "factory-gateway:dedupe"
VERIFICATION = "factory/verification"
#: How long the gateway keeps its own verification records. GitHub's list of check runs lags
#: the write that created one (#2401); a merge follows its record within minutes.
VERIFICATION_DAYS = 7
#: How long a host's lane report counts after its last heartbeat: gateway-status shows a
#: stopped lane by its last report for that long, then as never reported; the next heartbeat
#: for the repository drops it from state.json.
LANE_REPORT_DAYS = 7
REVIEW = "factory/review"
QUEUE_PREFIX = "refs/factory/queue/"
HEADS_PREFIX = "refs/heads/"
RETRY_MS = 2000
_T = TypeVar("_T")
MERGEABLE = {"MERGEABLE": "clean", "CONFLICTING": "conflict", "BLOCKED": "blocked"}


class Refusal(Exception):
    """A refusal raised from deep in a command; ``guard`` turns it into its CommandResult."""

    def __init__(self, result: CommandResult[Any]) -> None:
        super().__init__(result.error.message if result.error else "refused")
        self.result = result


def refuse(code: str, message: str, suggestion: str, **details: Any) -> Refusal:
    return Refusal(error(code, message, suggestion=suggestion, details=details or None))


def guard(body: Callable[[], CommandResult[Any]]) -> CommandResult[Any]:
    try:
        return body()
    except Refusal as refusal:
        return refusal.result
    except GitHubUnavailable as exc:
        return unavailable(exc)
    except GitHubRefused as exc:
        return refused_by_github(exc)


def refused_by_github(exc: GitHubRefused) -> CommandResult[Any]:
    return error(
        "GITHUB_REFUSED",
        f"GitHub refused the call: {exc}",
        suggestion="Read GitHub's message: fix what it names (permission, rule or state), "
        "then call again; repeating the same call will not help",
    )


def unavailable(exc: Exception) -> CommandResult[Any]:
    return error(
        "GITHUB_UNAVAILABLE",
        f"GitHub did not answer: {exc}",
        suggestion="Retry the same call; it is safe to repeat",
        retryable=True,
    )


def unkeyed(write: Callable[[], _T], what: str, look: str, **details: Any) -> _T:
    """Make a write that has no dedupe_key to find it again (#2850). If GitHub did not answer
    after the request reached it, it may still have made the write, so repeating the call could
    make it twice: that outage is not retryable, and the suggestion says where to look
    first. One GitHub cannot have acted on (``sent`` False) stays the plain retryable outage."""
    try:
        return write()
    except GitHubUnavailable as exc:
        if not exc.sent:
            raise
        raise Refusal(
            error(
                "GITHUB_UNAVAILABLE",
                f"GitHub did not answer {what}, which it may still have made: {exc}",
                suggestion=f"Do not repeat the call blindly: {look}. Pass a dedupe_key next "
                "time, and a repeat finds the first instead of writing twice",
                retryable=False,
                details=details or None,
            )
        ) from None


def _actor() -> dict[str, Any]:
    actor = getattr(current_call(), "actor", None)
    if actor is None:
        return {}
    found = {"kind": actor.kind, "id": actor.id, "onBehalfOf": actor.on_behalf_of}
    return {key: value for key, value in found.items() if value is not None}


class Gateway:
    """One route's view of the gateway: the same GitHub, config and state, the route's rules."""

    def __init__(
        self,
        github: GitHub,
        config: GatewayConfig,
        state: GatewayState,
        route: str,
        clock: Callable[[], datetime] | None = None,
        contains: Callable[[str, str, str], bool] | None = None,
    ) -> None:
        #: One cache per process: the server wraps its port once and every route shares it.
        self.scans = (
            github
            if isinstance(github, CachedGitHub)
            else CachedGitHub(github, config.cache.graphql_seconds)
        )
        #: The same object, typed as the port it forwards every other call to.
        self.github = cast(GitHub, self.scans)
        self.config = config
        self.state = state
        self.route = route
        self._clock = clock
        #: ``contains(repo, head, commit)``: whether ``head`` contains ``commit``, read from the
        #: repository's mirror. Without it (the fake GitHub's fixtures) an upload's
        #: ``ancestors`` list stands in; an upload the server reads never carries one.
        self._contains = contains

    # ── shared rules ──────────────────────────────────────────────────────

    def now(self) -> datetime:
        if self._clock is not None:
            return self._clock()
        fixed = parse_time(self.github.now())
        return fixed or datetime.now(UTC)

    def repo(self, repo: str) -> None:
        if repo not in self.config.repositories:
            served = ", ".join(self.config.repositories)
            raise refuse(
                "REPO_NOT_ALLOWED",
                f"{repo} is not served by this gateway; it serves {served}",
                "Call gateway-status for the repositories this gateway serves",
                repositories=self.config.repositories,
            )

    def text(self, **fields: str | None) -> None:
        refusal = check_text(fields, self.config.secret_patterns, self.config.body_max_bytes)
        if refusal is not None:
            raise Refusal(refusal)

    def spend(self, command: str, count: int = 1) -> None:
        """Count ``count`` writes against the caller's hourly budget, or refuse them all."""
        budget = self.config.writes_per_hour.get(self.route)
        actor = _actor().get("id") or self.route
        now = self.now()
        log = [
            entry
            for entry in self.state.get("writes", [])
            if (at := parse_time(entry["at"])) is not None and at > now - timedelta(hours=1)
        ]
        mine = [entry for entry in log if entry["actor"] == actor]
        if budget is not None and len(mine) + count > budget:
            raise refuse(
                "WRITE_BUDGET_EXCEEDED",
                f"{actor} made {len(mine)} writes in the last hour; the {self.route} budget "
                f"is {budget}",
                "Stop and check for a loop; the budget frees as the hour passes, and the "
                "owner can raise writesPerHour",
                budget=budget,
                route=self.route,
            )
        log += [{"at": iso(now), "actor": actor, "command": command}] * count
        self.state.put("writes", log)

    def offset(self, cursor: str | None) -> int:
        if cursor is None:
            return 0
        if not cursor.isdigit():
            raise refuse(
                "VALIDATION_ERROR",
                f"cursor {cursor!r} is not one this gateway returned",
                "Pass the nextCursor of the previous page, or leave cursor out for the first",
            )
        return int(cursor)

    def issue_or_refuse(self, repo: str, number: int) -> dict[str, Any]:
        issue = self.github.issue(repo, number)
        if issue is None:
            raise refuse(
                "NOT_FOUND",
                f"{repo} has no issue {number}",
                "Check the number; for a pull request call pr-status",
            )
        return issue

    def pull_or_refuse(self, repo: str, number: int) -> dict[str, Any]:
        pull = self.github.pull(repo, number)
        if pull is None:
            raise refuse(
                "NOT_FOUND",
                f"{repo} has no pull request {number}",
                "Check the number; for an issue call issue-get",
            )
        return pull

    def claim(self, repo: str, number: int) -> Claim | Release | None:
        comments = self.github.comments(repo, number)
        return claim_rules.read_claim(number, comments, self.config, self.now())

    def labels_known(self, repo: str, labels: list[str]) -> None:
        known = self.github.repo_labels(repo)
        for label in labels:
            if label not in known:
                meant = difflib.get_close_matches(label, known, n=1, cutoff=0.5)
                raise refuse(
                    "LABEL_UNKNOWN",
                    f"{label} is not a label {repo} defines",
                    (f"Use {meant[0]}, or a" if meant else "Use a")
                    + " label from the repository's label set; the gateway never creates one",
                    label=label,
                )

    def claim_lost(self, repo: str, closes: list[int], branch: str | None) -> None:
        if branch is None:
            return
        for number in closes:
            record = self.claim(repo, number)
            if isinstance(record, Claim) and record.branch != branch:
                raise refuse(
                    "CLAIM_LOST",
                    f"Issue {number} is now held by {record.describe()}, not {branch}",
                    "Stop work on this branch: the foreman drops it with lane-drop, or the new "
                    "holder finishes the issue",
                    number=number,
                    holder=record.holder(),
                )

    # ── reads ─────────────────────────────────────────────────────────────

    def status(self, host: str, writes: list[str]) -> CommandResult[Any]:
        size, oldest = journal_size(self.state.journal_dir)
        limit = self.github.rate_limit()
        # Read credential ages after rate_limit() so the App adapter has already
        # fetched or refreshed its installation token before reporting ages.token.
        ages = self.github.ages()
        default_reset = iso(self.now() + timedelta(hours=1))
        rate_limit: dict[str, Any] = {
            "remaining": limit.get("remaining"),
            "resetAt": limit.get("resetAt") or default_reset,
        }
        graphql = limit.get("graphql")
        if isinstance(graphql, dict):
            rate_limit["graphql"] = {
                "remaining": graphql.get("remaining"),
                "resetAt": graphql.get("resetAt") or default_reset,
            }
        return success(
            {
                "host": host,
                "writes": writes,
                "identity": self.config.bot,
                "app": self.config.app,
                "repos": self.config.repositories,
                "rateLimit": rate_limit,
                "ages": {
                    "appKey": ages.get("appKey"),
                    "token": ages.get("token"),
                },
                "journal": {"bytes": size, "oldest": oldest},
                "lanes": [self._lane(repo) for repo in self.config.repositories],
            },
            reasoning=f"{host} on {self.config.app}, writing as {self.config.bot}",
        )

    def lane_heartbeat(
        self, repo: str, host: str, running: bool, queued: int, last_merge_at: str | None
    ) -> CommandResult[Any]:
        """Keep what a repository's lane on ``host`` says of itself, as of now; gateway-status
        reports it. Each host's report is kept apart, so one host cannot hide another's."""
        self.repo(repo)
        self.text(host=host)
        actor = _actor().get("id") or ""
        if self.route == "heartbeat" and actor.rpartition("@")[1:] != ("@", host):
            raise refuse(
                "HOST_NOT_TOKEN_S",
                f"This heartbeat token reports for {actor or 'no host'}, not {host}",
                "Send the host the token was issued for, or issue a token whose actor is "
                f"lane-heartbeat@{host}",
                actor=actor,
                host=host,
            )
        merged = None if last_merge_at is None else _time_or_none(last_merge_at)
        if last_merge_at is not None and merged is None:
            raise refuse(
                "VALIDATION_ERROR",
                f"last_merge_at {last_merge_at!r} is not an ISO 8601 time with its zone",
                "Send the time of the lane's last merge as ISO 8601 with its zone, or leave it out",
            )
        now = self.now().astimezone(UTC)
        report: dict[str, Any] = {
            "host": host,
            "running": running,
            "queued": queued,
            "lastMergeAt": None if merged is None else iso(merged.astimezone(UTC)),
            "reportedAt": iso(now),
            "by": _actor().get("id") or self.route,
        }
        lanes = dict(self.state.get("lanes", {}))
        kept = {
            name: row
            for name, row in (lanes.get(repo) or {}).items()
            if (at := _time_or_none(str(row.get("reportedAt")))) is not None
            and now - at < timedelta(days=LANE_REPORT_DAYS)
        }
        kept[host] = report
        lanes[repo] = kept
        self.state.put("lanes", lanes)
        return success(
            {"lane": self._lane(repo)},
            reasoning=f"The {repo} lane on {host} is {'running' if running else 'not running'}, "
            f"{queued} queued",
        )

    def _lane(self, repo: str) -> dict[str, Any]:
        """A repository's lane as gateway-status shows it. Of the hosts that reported, the
        newest report that says running and is younger than ``laneStaleMinutes``, else the
        newest report of all; running only in the first case. ``otherHosts`` lists any other
        host whose recent report also says running: two lanes would both merge."""
        now = self.now()
        reports = [
            row
            for row in (self.state.get("lanes", {}).get(repo) or {}).values()
            if (at := _time_or_none(str(row.get("reportedAt")))) is not None
            and now - at < timedelta(days=LANE_REPORT_DAYS)
        ]
        if not reports:
            return {"repo": repo, "running": False, "stale": True, "reportedAt": None}
        reports.sort(key=lambda row: str(row.get("reportedAt")), reverse=True)
        live = [row for row in reports if row.get("running") and self._fresh(row, now)]
        shown = live[0] if live else reports[0]
        lane = {
            "repo": repo,
            "host": shown.get("host"),
            "running": bool(live),
            "stale": not self._fresh(shown, now),
            "queued": shown.get("queued"),
            "lastMergeAt": shown.get("lastMergeAt"),
            "reportedAt": shown.get("reportedAt"),
        }
        others = [
            {"host": row.get("host"), "reportedAt": row.get("reportedAt")} for row in live[1:]
        ]
        if others:
            lane["otherHosts"] = others
        return lane

    def _fresh(self, report: dict[str, Any], now: datetime) -> bool:
        """Whether ``report`` is younger than ``laneStaleMinutes``. One from the future (the
        clock moved back) is not: it cannot vouch for now."""
        reported = report.get("reportedAt")
        at = _time_or_none(reported) if isinstance(reported, str) else None
        limit = timedelta(minutes=self.config.lane_stale_minutes)
        return at is not None and at <= now and now - at < limit

    def issue_get(self, repo: str, number: int) -> CommandResult[Any]:
        self.repo(repo)
        issue = self.issue_or_refuse(repo, number)
        # The issue read carries every comment (the port pages past the last 100), as
        # claim-list reads them, so the claim needs no second read.
        record = claim_rules.read_claim(number, issue.get("comments", []), self.config, self.now())
        pulls = sorted(issue.get("closedBy", []))
        data = {
            "number": number,
            "state": issue["state"],
            "title": issue["title"],
            "labels": issue.get("labels", []),
            "assignees": issue.get("assignees", []),
            "author": issue.get("author"),
            "body": {"trust": "content", "text": issue.get("body", "")},
            "linkedPrs": pulls,
            "subIssues": {"total": int(issue.get("subIssues") or 0)},
        }
        for key in ("type", "parent"):
            if issue.get(key) is not None:
                data[key] = issue[key]
        if isinstance(record, Claim):
            data["claim"] = self._claim_row(record, issue)
        return success(data, reasoning=f"Issue {number} is {issue['state']}")

    def comment_list(
        self, repo: str, number: int, limit: int, cursor: str | None
    ) -> CommandResult[Any]:
        self.repo(repo)
        issue = self.issue_or_refuse(repo, number)
        start = self.offset(cursor)
        comments = issue.get("comments", [])
        page = comments[start : start + limit]
        rows = [
            {
                "id": comment["id"],
                "author": comment.get("author"),
                "association": self._association(comment.get("author"), issue),
                "trust": "content",
                "text": comment.get("body", ""),
                "at": comment.get("at"),
            }
            for comment in page
        ]
        data: dict[str, Any] = {"comments": rows}
        if start + limit < len(comments):
            data["nextCursor"] = str(start + limit)
        return success(data, reasoning=f"{len(rows)} of {len(comments)} comments on {number}")

    def _association(self, login: str | None, issue: dict[str, Any]) -> str:
        if login == self.config.owner:
            return "OWNER"
        author = issue.get("author") or {}
        return author.get("association", "NONE") if author.get("login") == login else "NONE"

    def _claim_row(self, record: Claim, issue: dict[str, Any]) -> dict[str, Any]:
        return {
            "number": record.number,
            "holder": record.holder(),
            "leaseUntil": iso(record.lease_until),
            "stale": record.stale(self.now()),
            "legacy": record.legacy,
            "labelMatches": IN_PROGRESS in issue.get("labels", []),
        }

    def claim_list(self, repo: str, stale: bool | None) -> CommandResult[Any]:
        self.repo(repo)
        rows = []
        for issue in sorted(self.scans.cached_issues(repo), key=lambda i: i["number"]):
            if issue["state"] != "open":
                continue
            record = claim_rules.read_claim(
                issue["number"], issue.get("comments", []), self.config, self.now()
            )
            if isinstance(record, Claim):
                row = self._claim_row(record, issue)
                if stale is None or row["stale"] == stale:
                    rows.append(row)
        lapsed = sum(row["stale"] for row in rows)
        return success({"claims": rows}, reasoning=f"{len(rows)} claims, {lapsed} lapsed")

    def required_check(
        self, repo: str, pull: dict[str, Any], runs: list[dict[str, Any]] | None = None
    ) -> dict[str, Any]:
        """The required check on ``pull``'s head, from ``runs`` when the caller has read them."""
        name = self.config.required_check.name
        if runs is None:
            runs = self.github.check_runs(repo, pull["head"])
        runs = [run for run in runs if run["name"] == name]
        if not runs:
            return {"name": name, "state": "missing"}
        run = runs[-1]
        if run.get("status") == "completed":
            passed = run.get("conclusion") in {"success", "neutral", "skipped"}
            return {"name": name, "state": "passed" if passed else "failed"}
        queued = parse_time(run.get("queuedAt"))
        if run.get("status") == "queued" and queued and not run.get("runner"):
            waited = (self.now() - queued).total_seconds() / 60
            if waited >= self.config.stall_minutes:
                row = {"name": name, "state": "stalled", "stalledMinutes": int(waited)}
                incident = self.github.actions_status() or {}
                if incident.get("incident"):
                    row["cause"] = f"GitHub status: {incident['incident']}"
                return row
        return {"name": name, "state": "running"}

    def pull_state(self, pull: dict[str, Any]) -> str:
        if pull["state"] == "merged" or pull.get("merged") or pull.get("mergedAt"):
            return "merged"
        return "open" if pull["state"] == "open" else "closed"

    def pr_status(self, repo: str, number: int) -> CommandResult[Any]:
        self.repo(repo)
        pull = self.pull_or_refuse(repo, number)
        runs = self.github.check_runs(repo, pull["head"])
        pull["checks"] = runs or pull.get("checks", [])
        state = self.pull_state(pull)
        data: dict[str, Any] = {
            "number": number,
            "state": state,
            "head": pull["head"],
            "closes": pull.get("closes", []),
            "autoMerge": bool(pull.get("autoMerge")),
            "settled": True,
        }
        if state == "merged":
            data["mergedAt"] = pull.get("mergedAt")
        if state == "open":
            if pull.get("mergeQueue"):
                # Open, not queued and no auto-merge after a queued pr-merge: it left the queue.
                data["mergeQueue"] = self._queued(pull, changed=False)["mergeQueue"]
            data["mergeable"] = MERGEABLE.get(str(pull.get("mergeable") or ""), "pending")
            data["requiredCheck"] = self.required_check(repo, pull, runs)
            data["checks"] = [
                {key: run.get(key) for key in ("name", "status", "conclusion") if run.get(key)}
                for run in pull["checks"]
            ]
            if data["mergeable"] == "pending":
                data["settled"], data["retryAfterMs"] = False, RETRY_MS
        return success(data, reasoning=f"Pull request {number} is {state}")

    # ── claims ────────────────────────────────────────────────────────────

    def issue_claim(
        self, repo: str, numbers: list[int], holder: dict[str, Any], lease_hours: float | None
    ) -> CommandResult[Any]:
        """All or none: every issue is checked, and the whole write budget spent, before the
        first write. A GitHub outage part-way leaves some claimed; retrying the same call
        renews those and claims the rest."""
        self.repo(repo)
        self.text(**{f"holder.{key}": value for key, value in holder.items()})
        now = self.now()
        plan = []
        for number in dict.fromkeys(numbers):
            issue = self.issue_or_refuse(repo, number)
            if issue["state"] != "open":
                raise refuse(
                    "ISSUE_CLOSED",
                    f"Issue {number} is closed; nothing was claimed",
                    "Call issue-get to check each issue's state, and claim the open ones",
                    number=number,
                )
            record = self.claim(repo, number)
            live = isinstance(record, Claim) and not record.stale(now)
            if (
                isinstance(record, Claim)
                and live
                and not record.held_by(holder["branch"], holder["machine"])
            ):
                raise refuse(
                    "ALREADY_CLAIMED",
                    f"Issue {number} is held by {record.describe()}; nothing was claimed",
                    "Call claim-list for what is held, and claim a free issue",
                    number=number,
                    holder=record.holder(),
                    leaseUntil=iso(record.lease_until),
                )
            plan.append((issue, record, live))
        until = now + timedelta(hours=lease_hours or self.config.lease_hours)
        self.spend("issue-claim", len(plan))
        rows = []
        for issue, record, live in plan:
            number = issue["number"]
            self.github.add_comment(repo, number, claim_rules.claim_body(holder, until))
            labels = [label for label in issue.get("labels", []) if not label.startswith("status:")]
            self.github.set_labels(repo, number, [*labels, IN_PROGRESS])
            row = {
                "number": number,
                "holder": holder,
                "leaseUntil": iso(until),
                "renewed": bool(live),
            }
            if isinstance(record, Claim) and not live:
                row["previousHolder"] = record.holder()
            rows.append(row)
        return success(
            {"claims": rows, "record": {"label": IN_PROGRESS, "commentAuthor": self.config.bot}},
            reasoning=f"Claimed {', '.join(str(row['number']) for row in rows)} until {iso(until)}",
        )

    def issue_release(
        self, repo: str, number: int, holder: dict[str, Any], reason: str, force: bool
    ) -> CommandResult[Any]:
        self.repo(repo)
        self.text(reason=reason, **{f"holder.{key}": value for key, value in holder.items()})
        issue = self.issue_or_refuse(repo, number)
        record = self.claim(repo, number)
        same = (holder["branch"], holder["machine"])
        is_open = issue["state"] == "open"
        target_label = PLANNED if is_open else None
        has_in_progress = IN_PROGRESS in issue.get("labels", [])
        if isinstance(record, Release) and (
            (record.branch, record.machine) == same or (force and has_in_progress)
        ):
            if has_in_progress:
                self.spend("issue-release")
                self._release_labels(repo, issue)
                return success(
                    {"released": True, "changed": True, "record": {"label": target_label}},
                    reasoning=f"Cleared {IN_PROGRESS} on already-released issue {number}",
                )
            return success(
                {"released": True, "changed": False, "record": {"label": target_label}},
                reasoning=f"Issue {number} was already released by {holder['branch']}",
            )
        if not isinstance(record, Claim):
            raise refuse(
                "NOT_CLAIMED",
                f"Issue {number} is not claimed",
                "Call claim-list to see what is held; there is nothing to release",
                number=number,
            )
        if not record.held_by(*same) and not force:
            raise refuse(
                "NOT_HOLDER",
                f"Issue {number} is held by {record.describe()}, not by {holder['branch']} on "
                f"{holder['machine']}",
                "Call claim-list to see the holder; only the holder, or the owner with force, "
                "releases a claim",
                holder=record.holder(),
            )
        self.spend("issue-release")
        released = record.holder() if force else holder
        self.github.add_comment(repo, number, claim_rules.release_body(released, reason))
        self._release_labels(repo, issue)
        return success(
            {"released": True, "changed": True, "record": {"label": target_label}},
            reasoning=f"Released issue {number}" + (" by force" if force else ""),
        )

    def _release_labels(self, repo: str, issue: dict[str, Any]) -> None:
        """Restore ``status:planned`` on an open issue; on a closed one, only drop
        ``status:in-progress`` so a closed issue never reads as in progress or planned."""
        previous = list(issue.get("labels", []))
        if issue["state"] == "open":
            labels = [label for label in previous if not label.startswith("status:")]
            labels.append(PLANNED)
        else:
            labels = [label for label in previous if label != IN_PROGRESS]
        if labels != previous:
            self.github.set_labels(repo, issue["number"], labels)

    # ── issues and comments ──────────────────────────────────────────────

    def issue_label(
        self, repo: str, number: int, add: list[str], remove: list[str]
    ) -> CommandResult[Any]:
        self.repo(repo)
        issue = self.github.issue(repo, number) or self.pull_or_refuse(repo, number)
        self.labels_known(repo, [*add, *remove])
        previous = list(issue.get("labels", []))
        labels = [label for label in previous if label not in remove]
        labels += [label for label in add if label not in labels]
        if labels != previous:
            self.spend("issue-label")
            self.github.set_labels(repo, number, labels)
        return success(
            {"labels": labels, "previous": previous, "changed": labels != previous},
            reasoning=f"Issue {number} labels: {', '.join(labels) or 'none'}",
        )

    def issue_comment(
        self, repo: str, number: int, body: str, dedupe_key: str | None
    ) -> CommandResult[Any]:
        self.repo(repo)
        self.text(body=body, dedupe_key=dedupe_key)
        self.issue_or_refuse(repo, number)
        if dedupe_key:
            tag = f"<!-- {DEDUPE} {dedupe_key} -->"
            for comment in self.github.comments(repo, number):
                if comment.get("author") == self.config.bot and tag in comment.get("body", ""):
                    return success(
                        {"url": comment_url(repo, number, comment["id"]), "deduplicated": True},
                        reasoning=f"Already posted under {dedupe_key}",
                    )
            body = f"{body}\n\n{tag}"
        self.spend("issue-comment")
        if dedupe_key:
            comment = self.github.add_comment(repo, number, body)
        else:
            comment = unkeyed(
                lambda: self.github.add_comment(repo, number, body),
                f"the comment on {number}",
                f"read issue {number}'s comments with comment-list; post only if it is missing",
            )
        return success(
            {"url": comment_url(repo, number, comment["id"]), "deduplicated": False},
            reasoning=f"Commented on {number}",
        )

    # ── pushes and pull requests ─────────────────────────────────────────

    def branch_push(self, repo: str, ref: str, head: str, bundle: str) -> CommandResult[Any]:
        self.repo(repo)
        self.text(ref=ref)
        if not ref_is_well_formed(ref):
            raise refuse(
                "REF_NOT_ALLOWED",
                f"{ref} is not a well-formed full ref",
                "Pass a full ref such as refs/heads/<branch>, without '..', '//' or spaces",
                ref=ref,
            )
        if ref in self.config.protected_refs:
            raise refuse(
                "PROTECTED_REF",
                f"{ref} is protected; no caller pushes it",
                "Push a branch, then land it through pr-open and pr-merge",
                ref=ref,
            )
        if self.route in ("cell", "session") and not ref.startswith(QUEUE_PREFIX):
            raise refuse(
                "REF_NOT_ALLOWED",
                f"A {self.route} pushes only to {QUEUE_PREFIX}<branch>, not {ref}",
                f"Push to {QUEUE_PREFIX}<your branch>; the lane pushes the branch after it "
                "validates it",
                ref=ref,
            )
        if not ref.startswith((QUEUE_PREFIX, HEADS_PREFIX)):
            raise refuse(
                "REF_NOT_ALLOWED",
                f"{ref} is neither a branch nor a factory queue ref",
                f"Push to {HEADS_PREFIX}<branch> or {QUEUE_PREFIX}<branch>",
                ref=ref,
            )
        upload = self.state.get("uploads", {}).get(bundle)
        expires = parse_time(upload.get("expiresAt")) if upload else None
        if upload is None or (expires and expires <= self.now()):
            raise refuse(
                "UPLOAD_NOT_FOUND",
                f"No live upload {bundle}; an upload lasts an hour",
                "Upload the bundle to POST /uploads on this route and pass the id it returns",
            )
        if upload.get("repo", repo) != repo:
            raise refuse(
                "UPLOAD_NOT_FOUND",
                f"Upload {bundle} is for {upload['repo']}, not {repo}",
                f"Upload the bundle to /uploads?repo={repo} and pass that id",
            )
        self._owns_upload(bundle, upload)
        if head not in upload.get("heads", []):
            raise refuse(
                "HEAD_NOT_IN_BUNDLE",
                f"Bundle {bundle} does not contain {head}; nothing was pushed",
                "Create the bundle from the head you push (git bundle create <file> <branch>), "
                "upload it and call again",
            )
        self._credit(repo, bundle, upload, head)
        current = self.github.ref(repo, ref)
        if (
            ref.startswith(HEADS_PREFIX)
            and current not in (None, head)
            and not self._fast_forward(repo, upload, current, head)
        ):
            raise refuse(
                "NOT_FAST_FORWARD",
                f"{ref} is at {current}, which {head} does not contain",
                "Merge main into the branch, validate again and push the new head",
            )
        changed = current != head
        published = []
        if changed:
            self.spend("branch-push")
            try:
                self.github.update_ref(repo, ref, head, current)
            except HeadMoved as moved:
                raise refuse(
                    "HEAD_MOVED",
                    f"{ref} moved to {moved.head or 'nothing'} during the push; nothing was pushed",
                    "Read the ref again (fetch it), rebuild the bundle on it and push again",
                    head=moved.head,
                ) from None
            published = self._publish_review(repo, head)
        return success(
            {
                "ref": ref,
                "head": head,
                "changed": changed,
                "by": self.config.bot,
                "checksPublished": published,
            },
            reasoning=f"{ref} {'is now' if changed else 'was already'} {head[:12]}",
        )

    def _publish_review(self, repo: str, head: str) -> list[dict[str, Any]]:
        record = self.state.get("reviews", {}).get(head)
        if record is None:
            return []
        conclusion = "success" if record["verdict"] == "pass" else "failure"
        self.github.create_check_run(
            repo, head, {"name": REVIEW, "conclusion": conclusion, "summary": record["verdict"]}
        )
        return [{"name": REVIEW, "conclusion": conclusion}]

    def pr_open(
        self, repo: str, branch: str, title: str, body: str, closes: list[int]
    ) -> CommandResult[Any]:
        self.repo(repo)
        self.text(branch=branch, title=title, body=body)
        if not ref_is_well_formed(f"{HEADS_PREFIX}{branch}"):
            raise refuse(
                "REF_NOT_ALLOWED",
                f"{branch} is not a well-formed branch name",
                "Pass the branch's name as git spells it, without '..', '//', '#', '%' or spaces",
                branch=branch,
            )
        if CLOSING_KEYWORD.search(body):
            raise refuse(
                "CLOSING_KEYWORD_IN_BODY",
                "The body holds a closing keyword; the gateway writes those from closes[]",
                "Remove 'Closes #N' (and fixes, resolves) from the body and pass the issues "
                "in closes",
            )
        if self.github.ref(repo, f"{HEADS_PREFIX}{branch}") is None:
            raise refuse(
                "NO_BRANCH",
                f"{branch} is not on GitHub",
                "Push the branch first with branch-push, then call pr-open again",
            )
        self.claim_lost(repo, closes, branch)
        full = body.rstrip() + "".join(f"\n\nCloses #{n}" for n in closes[:1])
        full += "".join(f"\nCloses #{n}" for n in closes[1:])
        existing = next(
            (
                p
                for p in self.github.pulls(repo)
                if p.get("branch") == branch and self.pull_state(p) == "open"
            ),
            None,
        )
        if existing is not None:
            if existing.get("author") != self.config.bot:
                raise refuse(
                    "NOT_GATEWAY_PR",
                    f"Pull request {existing['number']} for {branch} was not opened by the gateway",
                    "Ask the owner to close it or take it over; the gateway updates only the "
                    "pull requests it opened",
                    number=existing["number"],
                )
            changed = (existing.get("title"), existing.get("body")) != (title, full)
            if changed:
                self.spend("pr-open")
                self.github.update_pull(repo, existing["number"], title=title, body=full)
            return success(
                self._opened(existing["number"], False, changed, closes),
                reasoning=f"Pull request {existing['number']} "
                f"{'updated' if changed else 'already open'}",
            )
        self.spend("pr-open")
        number = self.github.create_pull(repo, branch, title, full)
        return success(self._opened(number, True, False, closes), reasoning=f"Opened {number}")

    def _opened(
        self, number: int, created: bool, updated: bool, closes: list[int]
    ) -> dict[str, Any]:
        return {
            "number": number,
            "created": created,
            "updated": updated,
            "closes": closes,
            "author": self.config.bot,
        }

    def verification_record(
        self, repo: str, head: str, result: str, summary: str
    ) -> CommandResult[Any]:
        self.repo(repo)
        self.text(summary=summary)
        if not self.github.has_commit(repo, head):
            raise refuse(
                "NOT_FOUND",
                f"{head} is not the head of any branch or pull request on GitHub",
                "Push the head with branch-push first, then record its validation",
            )
        conclusion = "success" if result == "passed" else "failure"
        self.spend("verification-record")
        check = {"name": VERIFICATION, "conclusion": conclusion, "summary": summary}
        # A failure is kept before GitHub hears of it and a pass only after GitHub has it, so a
        # write that fails part way can only leave a head less validated than it is.
        if conclusion == "failure":
            self._keep_verification(repo, head, conclusion)
        self.github.create_check_run(repo, head, check)
        if conclusion == "success":
            self._keep_verification(repo, head, conclusion)
        return success(
            {"check": {"name": VERIFICATION, "conclusion": conclusion}, "head": head},
            reasoning=f"Recorded {result} for {head[:12]}",
        )

    def _keep_verification(self, repo: str, head: str, conclusion: str) -> None:
        now = self.now()
        kept = {
            key: row
            for key, row in self.state.get("verifications", {}).items()
            if self._recent(row, now)
        }
        kept[_verification_key(repo, head)] = {"conclusion": conclusion, "at": iso(now)}
        self.state.put("verifications", kept)

    @staticmethod
    def _recent(row: dict[str, Any], now: datetime) -> bool:
        at = parse_time(row.get("at"))
        return at is not None and at > now - timedelta(days=VERIFICATION_DAYS)

    def validated(self, repo: str, head: str) -> bool:
        """Whether the latest validation recorded for ``head`` passed. The gateway's own record
        decides, since only the gateway writes ``factory/verification`` and GitHub's list of
        check runs can miss one created a second earlier (#2401). GitHub's list answers for a
        head the gateway kept no record of, or one recorded ``VERIFICATION_DAYS`` or more ago."""
        own = self.state.get("verifications", {}).get(_verification_key(repo, head))
        if own is not None and self._recent(own, self.now()):
            return bool(own["conclusion"] == "success")
        runs = [
            run
            for run in self.github.check_runs(repo, head)
            if run["name"] == VERIFICATION and run.get("app") == self.config.bot
        ]
        return bool(runs) and runs[-1].get("conclusion") == "success"

    def pr_merge(self, repo: str, number: int, head: str, cancel: bool) -> CommandResult[Any]:
        self.repo(repo)
        pull = self.pull_or_refuse(repo, number)
        state = self.pull_state(pull)
        if state == "merged":
            cleaned = False if cancel else self._release_on_merge(repo, pull, spend=True)
            return success(
                {
                    "state": "merged",
                    "autoMerge": False,
                    "changed": cleaned,
                    # A cancel answers dequeued whatever it found, so its callers read one shape.
                    **({"dequeued": False} if cancel else {}),
                },
                reasoning=(
                    f"Finished releasing claims for merged pull request {number}"
                    if cleaned
                    else f"Pull request {number} already merged"
                ),
            )
        if state == "closed":
            raise refuse(
                "PR_CLOSED",
                f"Pull request {number} is closed without merging",
                "Call pr-status; reopen it on GitHub, or open a new one with pr-open",
                number=number,
            )
        if cancel:
            return self._cancel(repo, pull)
        if pull["head"] != head:
            raise refuse(
                "HEAD_MOVED",
                f"Pull request {number}'s head is {pull['head']}, not {head}",
                "The branch moved: validate its current head, record it, and merge that head",
                head=pull["head"],
            )
        return self._merge(repo, pull)

    def _cancel(self, repo: str, pull: dict[str, Any]) -> CommandResult[Any]:
        """Turn auto-merge off and take the pull request out of the merge queue, then say what
        GitHub shows, never what was asked: auto-merge can become a queue entry between the
        read and the write, so it is read again and cancelled once more before answering.
        Turning auto-merge off leaves a queued pull request in the queue (#2809), so a queued
        one is dequeued too, and the answer's ``dequeued`` records which of the two ran."""
        number = pull["number"]
        changed = dequeued = disabled = False
        refused = ""  # What GitHub said when it would not turn auto-merge off.
        for _ in range(2):
            queued = bool((pull.get("mergeQueue") or {}).get("queued"))
            if not pull.get("autoMerge") and not queued:
                break
            if not changed:
                self.spend("pr-merge")
            changed = True
            if pull.get("autoMerge"):
                # Refused when it is no longer set (it became a queue entry): the next read
                # says whether that was why. Any other refusal is reported below.
                try:
                    self.github.disable_auto_merge(repo, number)
                    disabled = True
                except GitHubRefused as exc:
                    refused = exc.message
            if queued:
                self.github.dequeue_pull(repo, number)
                dequeued = True
            pull = self.pull_or_refuse(repo, number)
        state = self.pull_state(pull)
        if state == "merged":
            return success(
                {"state": "merged", "autoMerge": False, "changed": False, "dequeued": dequeued},
                reasoning=f"Pull request {number} merged before it could be cancelled",
            )
        queue = self._queued(pull, changed=changed).get("mergeQueue")
        data: dict[str, Any] = {
            "state": state,
            "autoMerge": bool(pull.get("autoMerge")),
            "changed": changed,
            "dequeued": dequeued,
            **({"mergeQueue": queue} if queue else {}),
        }
        if data["autoMerge"] or (queue or {}).get("queued"):
            # GitHub's refusal explains it only while auto-merge is what is still set.
            if refused and data["autoMerge"]:
                raise refuse(
                    "STILL_QUEUED",
                    f"Pull request {number} is still set to merge: GitHub refused to turn "
                    f"auto-merge off ({refused})",
                    "Read GitHub's answer: a permission the gateway lacks is the owner's to "
                    "grant; otherwise call pr-status, then pr-merge with cancel again",
                    number=number,
                    refused=refused,
                    dequeued=dequeued,
                )
            raise refuse(
                "STILL_QUEUED",
                f"Pull request {number} is still set to merge after cancelling twice",
                "Call pr-status, then pr-merge with cancel again; GitHub may be re-queueing it",
                number=number,
                dequeued=dequeued,
                **({"refused": refused} if refused else {}),
            )
        done = [  # In the order they ran.
            *(["turned auto-merge off"] if disabled else []),
            *(["took it out of the merge queue"] if dequeued else []),
        ]
        if done:
            reasoning = f"Pull request {number}: {' and '.join(done)}"
        else:
            was = "is no longer" if changed else "was not"
            reasoning = f"Pull request {number} {was} set to merge"
        return success(data, reasoning=reasoning)

    def _merge(self, repo: str, pull: dict[str, Any]) -> CommandResult[Any]:
        number, head = pull["number"], pull["head"]
        if not self.validated(repo, head):
            raise refuse(
                "VALIDATION_MISSING",
                f"No passed validation is recorded for {head}",
                "Validate this head in the lane and record it with verification-record, then merge",
                head=head,
            )
        self.claim_lost(repo, pull.get("closes", []), pull.get("branch"))
        if not self.config.required_check.required_on_main:
            raise refuse(
                "CHECK_NOT_REQUIRED",
                f"{self.config.required_check.name} is not required on main, so auto-merge "
                "would not wait for it",
                "Ask the owner to require the check in main's branch protection",
            )
        if pull.get("mergeable") == "CONFLICTING":
            raise refuse(
                "NOT_MERGEABLE",
                f"Pull request {number} conflicts with main",
                "Merge main into the branch, validate again and push the new head",
            )
        queue = pull.get("mergeQueue") or {}
        if queue.get("queued") or pull.get("autoMerge"):
            where = "in the merge queue" if queue.get("queued") else "queued to merge"
            return success(
                self._queued(pull, changed=False),
                reasoning=f"Pull request {number} is already {where}",
            )
        self.spend("pr-merge")
        if queue.get("required"):
            return self._enqueue(repo, pull)
        clean = pull.get("mergeable") == "MERGEABLE"
        if clean and self.required_check(repo, pull)["state"] == "passed":
            return self._merge_now(repo, pull)
        method = self.config.merge_method(repo)
        try:
            self.github.enable_auto_merge(repo, number, head, method)
        except MergeMethodNotAllowed:
            raise self._merge_method_refusal(repo, method) from None
        except HeadMoved as moved:
            raise refuse(
                "HEAD_MOVED",
                f"Pull request {number}'s head moved to {moved.head} before auto-merge was set",
                "The branch moved: validate its current head, record it, and merge that head",
                head=moved.head,
            ) from None
        except AlreadyMergeable:
            # GitHub settled mergeability after the read: nothing to wait for, so merge now.
            return self._merge_now(repo, pull)
        return success(
            {"state": "queued", "autoMerge": True, "changed": True},
            reasoning=f"Queued {number} to {method}-merge at {head[:12]} once its checks pass",
        )

    def _queued(self, pull: dict[str, Any], *, changed: bool) -> dict[str, Any]:
        """pr-merge's answer for a pull request GitHub holds to merge later: ``state`` is
        ``queued``. ``mergeQueue`` is there only where the base has a merge queue: ``queued``
        says whether the pull request is in it yet (``state`` and ``position`` as GitHub gives
        them) or waits on auto-merge to join it. The caller waits on pr-status."""
        data: dict[str, Any] = {
            "state": "queued",
            "autoMerge": bool(pull.get("autoMerge")),
            "changed": changed,
        }
        queue = pull.get("mergeQueue")
        if queue:
            data["mergeQueue"] = {
                key: queue[key]
                for key in ("required", "queued", "state", "position", "removed")
                if queue.get(key) is not None
            }
            data["mergeQueue"].setdefault("required", False)
            data["mergeQueue"].setdefault("queued", False)
        return data

    def _enqueue(self, repo: str, pull: dict[str, Any]) -> CommandResult[Any]:
        """The base takes merges only through a merge queue, which refuses a direct merge.

        A pull request whose required check passed is added to the queue itself, bound to the
        head (``enqueuePullRequest``): GitHub answers a head that moved with an error and
        changes nothing, and sets no auto-merge. One whose check still runs gets auto-merge
        bound to the head, which GitHub turns into a queue entry when its requirements pass;
        where GitHub answers that nothing is left to wait for, it is added to the queue. The
        queue merges by its own method (AFD's rebases), so the configured method matters only
        because GitHub refuses one the repository does not allow.
        """
        number, head = pull["number"], pull["head"]
        method = self.config.merge_method(repo)
        entry: dict[str, Any] | None = (
            None  # GitHub's own answer to the enqueue, when one was made.
        )
        try:
            if self.required_check(repo, pull)["state"] == "passed":
                entry = self.github.enqueue_pull(repo, number, head)
            else:
                try:
                    self.github.enable_auto_merge(repo, number, head, method)
                except AlreadyMergeable:
                    entry = self.github.enqueue_pull(repo, number, head)
        except MergeMethodNotAllowed:
            raise self._merge_method_refusal(repo, method) from None
        except HeadMoved as moved:
            raise refuse(
                "HEAD_MOVED",
                f"Pull request {number}'s head moved to {moved.head} before it was queued",
                "The branch moved: validate its current head, record it, and merge that head",
                head=moved.head,
            ) from None
        now = self.pull_or_refuse(repo, number)
        state = self.pull_state(now)
        if state == "merged":
            self._release_on_merge(repo, pull)
            return success(
                {"state": "merged", "autoMerge": False, "changed": True},
                reasoning=f"Merged {number} at {head[:12]}",
            )
        if state == "closed":
            raise refuse(
                "PR_CLOSED",
                f"Pull request {number} was closed as it was queued",
                "Call pr-status; reopen it on GitHub, or open a new one with pr-open",
                number=number,
            )
        data = self._queued(now, changed=True)
        queue = data.setdefault("mergeQueue", {"required": True, "queued": False})
        if entry is not None and not queue.get("queued"):
            # GitHub took it into the queue; the read after it trails or already shows it gone.
            # What GitHub answered is reported, and pr-status says what became of it.
            queue.update(queued=True, **{k: v for k, v in entry.items() if v is not None})
        if queue.get("queued"):
            said = f"Added {number} to the merge queue at {head[:12]}"
        elif data["autoMerge"]:
            said = f"Set {number} to join the merge queue at {head[:12]} once its checks pass"
        else:
            raise refuse(
                "NOT_QUEUED",
                f"GitHub took the request, but pull request {number} shows neither a queue "
                "entry nor auto-merge",
                "Call pr-status: if it is open and not queued, call pr-merge again",
                number=number,
            )
        return success(data, reasoning=f"{said}; pr-status says when it merged or left the queue")

    def _merge_now(self, repo: str, pull: dict[str, Any]) -> CommandResult[Any]:
        number, head = pull["number"], pull["head"]
        try:
            self.github.merge_pull(repo, number, head, self.config.merge_method(repo))
        except MergeMethodNotAllowed as refused:
            raise self._merge_method_refusal(repo, refused.method) from None
        except HeadMoved as moved:
            raise refuse(
                "HEAD_MOVED",
                f"Pull request {number}'s head moved to {moved.head} during the merge",
                "The branch moved: validate its current head, record it, and merge that head",
                head=moved.head,
            ) from None
        self._release_on_merge(repo, pull)
        return success(
            {"state": "merged", "autoMerge": False, "changed": True},
            reasoning=f"Merged {number} at {head[:12]}",
        )

    def _fast_forward(self, repo: str, upload: dict[str, Any], current: str, head: str) -> bool:
        """Whether ``head`` contains ``current``, so the push only moves the branch forward.
        Decided from git's history, never from what the bundle lists."""
        if self._contains is not None:
            return self._contains(repo, head, current)
        return current in set(upload.get("ancestors", []))

    def _owns_upload(self, bundle: str, upload: dict[str, Any]) -> None:
        """An upload is pushed by the route and caller that made it; the owner may push any."""
        if self.route == "owner":
            return
        caller = getattr(current_call().actor, "id", None) if current_call() else None
        made_by = (upload.get("route", self.route), upload.get("by", caller))
        if made_by != (self.route, caller):
            raise refuse(
                "UPLOAD_NOT_FOUND",
                f"Upload {bundle} was made by another caller; nothing was pushed",
                "Upload your own bundle on your route and push with the id it returns",
            )

    def _credit(self, repo: str, bundle: str, upload: dict[str, Any], head: str) -> None:
        """Refuse a push that would add a commit someone other than the owner authored.

        The upload route reads the bundle's commits and their authors from the bundle itself,
        never from the caller. A commit already on main (its history, others' merged work) is
        not this push's to credit; one on any other branch, queue ref or fork is.
        """
        commits = upload.get("commits")
        if commits is None or (
            head not in {commit.get("sha") for commit in commits}
            and not self.github.on_main(repo, head)
        ):
            raise refuse(
                "UPLOAD_INCOMPLETE",
                f"Upload {bundle} does not list the commits that lead to {head}; nothing was "
                "pushed",
                "Upload the bundle again through POST /uploads, which reads its commits and "
                "their authors from the bundle",
            )
        for commit in commits:
            email = commit.get("authorEmail", "")
            if self.config.is_owner_email(email) or self.github.on_main(repo, commit["sha"]):
                continue
            raise refuse(
                "COMMIT_AUTHOR_NOT_OWNER",
                f"Commit {commit['sha'][:12]} is authored by {email or 'no email'}, not the "
                "owner; nothing was pushed",
                "Make the owner the author (git commit --amend --reset-author, or git rebase "
                "<base> --exec 'git commit --amend --no-edit --reset-author') and list an agent "
                "that helped as an 'Assisted-by:' trailer; then bundle, upload and push again",
                sha=commit["sha"],
            )

    def _merge_method_refusal(self, repo: str, method: str) -> Refusal:
        return refuse(
            "MERGE_METHOD_NOT_ALLOWED",
            f"{repo} does not allow {method} merges; nothing was merged",
            f"Set mergeMethods[{repo!r}] in the gateway's configuration to a method the "
            "repository allows (the only one, for a repository that allows one) and merge again",
            method=method,
        )

    def _release_on_merge(self, repo: str, pull: dict[str, Any], *, spend: bool = False) -> bool:
        """Post the release comment (if still claimed) and drop ``status:in-progress`` for every
        issue this pull request closes. Idempotent, so retrying ``pr-merge`` after a partial write
        finishes any leftover label cleanup without re-posting the release comment."""
        branch = pull.get("branch")
        changed = False
        for number in pull.get("closes", []):
            record = self.claim(repo, number)
            if isinstance(record, Claim) and record.branch == branch:
                if spend and not changed:
                    self.spend("pr-merge")
                changed = True
                reason = f"merged in #{pull['number']}"
                self.github.add_comment(
                    repo, number, claim_rules.release_body(record.holder(), reason)
                )
                issue = self.github.issue(repo, number)
                if issue is not None and IN_PROGRESS in issue.get("labels", []):
                    labels = [label for label in issue["labels"] if label != IN_PROGRESS]
                    self.github.set_labels(repo, number, labels)
            elif isinstance(record, Release) and record.branch == branch:
                issue = self.github.issue(repo, number)
                if issue is not None and IN_PROGRESS in issue.get("labels", []):
                    if spend and not changed:
                        self.spend("pr-merge")
                    changed = True
                    labels = [label for label in issue["labels"] if label != IN_PROGRESS]
                    self.github.set_labels(repo, number, labels)
        return changed

    def pr_revert(self, repo: str, numbers: list[int], reason: str) -> CommandResult[Any]:
        self.repo(repo)
        self.text(reason=reason)
        pulls = self.github.pulls(repo)
        targets = []
        for number in dict.fromkeys(numbers):
            pull = self.pull_or_refuse(repo, number)
            if self.pull_state(pull) != "merged":
                raise refuse(
                    "NOT_MERGED",
                    f"Pull request {number} never merged; nothing was reverted",
                    "Call pr-status: only a merged pull request can be reverted",
                    number=number,
                )
            targets.append(pull)
        rows = []
        for pull in targets:
            existing = next(
                (p for p in pulls if p.get("revertOf") == pull["number"] and p["state"] == "open"),
                None,
            )
            if existing:
                rows.append(
                    {"reverts": pull["number"], "number": existing["number"], "created": False}
                )
                continue
            self.spend("pr-revert")
            created = self.github.create_revert(
                repo,
                pull["number"],
                f"Revert #{pull['number']}",
                f"Reverts #{pull['number']}.\n\n{reason}",
            )
            rows.append({"reverts": pull["number"], "number": created, "created": True})
        return success({"revertPrs": rows}, reasoning=f"{len(rows)} revert pull requests")

    def variable_set(self, repo: str, name: str, value: str) -> CommandResult[Any]:
        self.repo(repo)
        if name not in self.config.allowed_variables:
            raise refuse(
                "VARIABLE_NOT_ALLOWED",
                f"{name} is not a variable the gateway sets",
                f"Set one of: {', '.join(self.config.allowed_variables)}",
            )
        self.text(value=value)
        previous = self.github.variable(repo, name)
        if previous != value:
            self.spend("variable-set")
            self.github.set_variable(repo, name, value)
        return success(
            {"name": name, "value": value, "previous": previous},
            reasoning=f"{name} is {value}",
        )


def _verification_key(repo: str, head: str) -> str:
    return f"{repo.lower()}@{head.lower()}"


def _time_or_none(value: str) -> datetime | None:
    """``value`` as a time with its zone, or None when it is not one."""
    try:
        at = parse_time(value)
    except ValueError:
        return None
    return at if at is not None and at.tzinfo is not None else None
