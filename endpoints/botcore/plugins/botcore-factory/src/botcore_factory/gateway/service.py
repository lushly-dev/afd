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
from typing import Any

from afd import CommandResult, error, success
from botcore.context import current_call

from botcore_factory.gateway import claims as claim_rules
from botcore_factory.gateway.claims import IN_PROGRESS, PLANNED, Claim, Release, iso, parse_time
from botcore_factory.gateway.config import GatewayConfig
from botcore_factory.gateway.github import (
    GitHub,
    GitHubUnavailable,
    HeadMoved,
    MergeMethodNotAllowed,
    comment_url,
)
from botcore_factory.gateway.secrets import CLOSING_KEYWORD, check_text, ref_is_well_formed
from botcore_factory.gateway.state import GatewayState, journal_size

DEDUPE = "factory-gateway:dedupe"
VERIFICATION = "factory/verification"
REVIEW = "factory/review"
QUEUE_PREFIX = "refs/factory/queue/"
HEADS_PREFIX = "refs/heads/"
RETRY_MS = 2000
MERGEABLE = {"MERGEABLE": "clean", "CONFLICTING": "conflict", "BLOCKED": "blocked"}


class Refusal(Exception):
    """A refusal raised from deep in a command; ``guard`` turns it into its CommandResult."""

    def __init__(self, result: CommandResult) -> None:
        super().__init__(result.error.message if result.error else "refused")
        self.result = result


def refuse(code: str, message: str, suggestion: str, **details) -> Refusal:
    return Refusal(error(code, message, suggestion=suggestion, details=details or None))


def guard(body: Callable[[], CommandResult]) -> CommandResult:
    try:
        return body()
    except Refusal as refusal:
        return refusal.result
    except GitHubUnavailable as exc:
        return unavailable(exc)


def unavailable(exc: Exception) -> CommandResult:
    return error(
        "GITHUB_UNAVAILABLE",
        f"GitHub did not answer: {exc}",
        suggestion="Retry the same call; every gateway write is safe to repeat",
        retryable=True,
    )


def _actor() -> dict:
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
    ) -> None:
        self.github = github
        self.config = config
        self.state = state
        self.route = route
        self._clock = clock

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
            if parse_time(entry["at"]) > now - timedelta(hours=1)
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

    def issue_or_refuse(self, repo: str, number: int) -> dict:
        issue = self.github.issue(repo, number)
        if issue is None:
            raise refuse(
                "NOT_FOUND",
                f"{repo} has no issue {number}",
                "Check the number; for a pull request call pr-status",
            )
        return issue

    def pull_or_refuse(self, repo: str, number: int) -> dict:
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

    def status(self, host: str, writes: list[str]) -> CommandResult:
        size, oldest = journal_size(self.state.journal_dir)
        limit = self.github.rate_limit()
        return success(
            {
                "host": host,
                "writes": writes,
                "identity": self.config.bot,
                "app": self.config.app,
                "repos": self.config.repositories,
                "rateLimit": {
                    "remaining": limit.get("remaining"),
                    "resetAt": limit.get("resetAt") or iso(self.now() + timedelta(hours=1)),
                },
                "journal": {"bytes": size, "oldest": oldest},
            },
            reasoning=f"{host} on {self.config.app}, writing as {self.config.bot}",
        )

    def issue_get(self, repo: str, number: int) -> CommandResult:
        self.repo(repo)
        issue = self.issue_or_refuse(repo, number)
        record = self.claim(repo, number)
        pulls = [p["number"] for p in self.github.pulls(repo) if number in p.get("closes", [])]
        data = {
            "number": number,
            "state": issue["state"],
            "title": issue["title"],
            "labels": issue.get("labels", []),
            "assignees": issue.get("assignees", []),
            "author": issue.get("author"),
            "body": {"trust": "content", "text": issue.get("body", "")},
            "linkedPrs": pulls,
        }
        if isinstance(record, Claim):
            data["claim"] = self._claim_row(record, issue)
        return success(data, reasoning=f"Issue {number} is {issue['state']}")

    def comment_list(self, repo: str, number: int, limit: int, cursor: str | None):
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

    def _association(self, login: str | None, issue: dict) -> str:
        if login == self.config.owner:
            return "OWNER"
        author = issue.get("author") or {}
        return author.get("association", "NONE") if author.get("login") == login else "NONE"

    def _claim_row(self, record: Claim, issue: dict) -> dict:
        return {
            "number": record.number,
            "holder": record.holder(),
            "leaseUntil": iso(record.lease_until),
            "stale": record.stale(self.now()),
            "legacy": record.legacy,
            "labelMatches": IN_PROGRESS in issue.get("labels", []),
        }

    def claim_list(self, repo: str, stale: bool | None) -> CommandResult:
        self.repo(repo)
        rows = []
        for issue in sorted(self.github.issues(repo), key=lambda i: i["number"]):
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

    def required_check(self, repo: str, pull: dict) -> dict:
        name = self.config.required_check.name
        runs = [run for run in self.github.check_runs(repo, pull["head"]) if run["name"] == name]
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

    def pull_state(self, pull: dict) -> str:
        if pull["state"] == "merged" or pull.get("merged") or pull.get("mergedAt"):
            return "merged"
        return "open" if pull["state"] == "open" else "closed"

    def pr_status(self, repo: str, number: int) -> CommandResult:
        self.repo(repo)
        pull = self.pull_or_refuse(repo, number)
        pull["checks"] = self.github.check_runs(repo, pull["head"]) or pull.get("checks", [])
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
            data["mergeable"] = MERGEABLE.get(pull.get("mergeable"), "pending")
            data["requiredCheck"] = self.required_check(repo, pull)
            data["checks"] = [
                {key: run.get(key) for key in ("name", "status", "conclusion") if run.get(key)}
                for run in pull["checks"]
            ]
            if data["mergeable"] == "pending":
                data["settled"], data["retryAfterMs"] = False, RETRY_MS
        return success(data, reasoning=f"Pull request {number} is {state}")

    # ── claims ────────────────────────────────────────────────────────────

    def issue_claim(self, repo: str, numbers: list[int], holder: dict, lease_hours: float | None):
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
            if live and not record.held_by(holder["branch"], holder["machine"]):
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

    def issue_release(self, repo: str, number: int, holder: dict, reason: str, force: bool):
        self.repo(repo)
        self.text(reason=reason, **{f"holder.{key}": value for key, value in holder.items()})
        issue = self.issue_or_refuse(repo, number)
        record = self.claim(repo, number)
        same = (holder["branch"], holder["machine"])
        if isinstance(record, Release) and (record.branch, record.machine) == same:
            return success(
                {"released": True, "changed": False, "record": {"label": PLANNED}},
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
        labels = [label for label in issue.get("labels", []) if not label.startswith("status:")]
        self.github.set_labels(repo, number, [*labels, PLANNED])
        return success(
            {"released": True, "changed": True, "record": {"label": PLANNED}},
            reasoning=f"Released issue {number}" + (" by force" if force else ""),
        )

    # ── issues and comments ──────────────────────────────────────────────

    def issue_label(self, repo: str, number: int, add: list[str], remove: list[str]):
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

    def issue_comment(self, repo: str, number: int, body: str, dedupe_key: str | None):
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
        comment = self.github.add_comment(repo, number, body)
        return success(
            {"url": comment_url(repo, number, comment["id"]), "deduplicated": False},
            reasoning=f"Commented on {number}",
        )

    def issue_create(self, repo: str, title: str, body: str, labels: list[str], dedupe_key):
        self.repo(repo)
        self.text(title=title, body=body, dedupe_key=dedupe_key)
        self.labels_known(repo, labels)
        if dedupe_key:
            tag = f"<!-- {DEDUPE} {dedupe_key} -->"
            for issue in self.github.issues(repo):
                author = (issue.get("author") or {}).get("login")
                if issue["state"] == "open" and author == self.config.bot and tag in issue["body"]:
                    return success(
                        {"number": issue["number"], "created": False},
                        reasoning=f"Issue {issue['number']} is already open under {dedupe_key}",
                    )
            body = f"{body}\n\n{tag}"
        self.spend("issue-create")
        number = self.github.create_issue(repo, title, body, labels)
        return success({"number": number, "created": True}, reasoning=f"Filed issue {number}")

    # ── pushes and pull requests ─────────────────────────────────────────

    def branch_push(self, repo: str, ref: str, head: str, bundle: str):
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
        if head not in upload.get("heads", []):
            raise refuse(
                "HEAD_NOT_IN_BUNDLE",
                f"Bundle {bundle} does not contain {head}; nothing was pushed",
                "Create the bundle from the head you push (git bundle create <file> <branch>), "
                "upload it and call again",
            )
        self._credit(repo, bundle, upload, head)
        current = self.github.ref(repo, ref)
        ancestors = set(upload.get("ancestors", [])) | set(upload.get("heads", []))
        if (
            ref.startswith(HEADS_PREFIX)
            and current not in (None, head)
            and current not in (ancestors)
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
            self.github.update_ref(repo, ref, head)
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

    def _publish_review(self, repo: str, head: str) -> list[dict]:
        record = self.state.get("reviews", {}).get(head)
        if record is None:
            return []
        conclusion = "success" if record["verdict"] == "pass" else "failure"
        self.github.create_check_run(
            repo, head, {"name": REVIEW, "conclusion": conclusion, "summary": record["verdict"]}
        )
        return [{"name": REVIEW, "conclusion": conclusion}]

    def pr_open(self, repo: str, branch: str, title: str, body: str, closes: list[int]):
        self.repo(repo)
        self.text(branch=branch, title=title, body=body)
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

    def _opened(self, number: int, created: bool, updated: bool, closes: list[int]) -> dict:
        return {
            "number": number,
            "created": created,
            "updated": updated,
            "closes": closes,
            "author": self.config.bot,
        }

    def verification_record(self, repo: str, head: str, result: str, summary: str):
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
        self.github.create_check_run(
            repo, head, {"name": VERIFICATION, "conclusion": conclusion, "summary": summary}
        )
        return success(
            {"check": {"name": VERIFICATION, "conclusion": conclusion}, "head": head},
            reasoning=f"Recorded {result} for {head[:12]}",
        )

    def validated(self, repo: str, head: str) -> bool:
        runs = [
            run
            for run in self.github.check_runs(repo, head)
            if run["name"] == VERIFICATION and run.get("app") == self.config.bot
        ]
        return bool(runs) and runs[-1].get("conclusion") == "success"

    def pr_merge(self, repo: str, number: int, head: str, cancel: bool):
        self.repo(repo)
        pull = self.pull_or_refuse(repo, number)
        state = self.pull_state(pull)
        if state == "merged":
            return success(
                {"state": "merged", "autoMerge": False, "changed": False},
                reasoning=f"Pull request {number} already merged",
            )
        if state == "closed":
            raise refuse(
                "PR_CLOSED",
                f"Pull request {number} is closed without merging",
                "Call pr-status; reopen it on GitHub, or open a new one with pr-open",
                number=number,
            )
        if cancel:
            changed = bool(pull.get("autoMerge"))
            if changed:
                self.spend("pr-merge")
                self.github.disable_auto_merge(repo, number)
            return success(
                {"state": "open", "autoMerge": False, "changed": changed},
                reasoning=f"Auto-merge {'turned off' if changed else 'was already off'}",
            )
        if pull["head"] != head:
            raise refuse(
                "HEAD_MOVED",
                f"Pull request {number}'s head is {pull['head']}, not {head}",
                "The branch moved: validate its current head, record it, and merge that head",
                head=pull["head"],
            )
        return self._merge(repo, pull)

    def _merge(self, repo: str, pull: dict) -> CommandResult:
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
        if pull.get("autoMerge"):
            return success(
                {"state": "queued", "autoMerge": True, "changed": False},
                reasoning=f"Pull request {number} is already queued to merge",
            )
        self.spend("pr-merge")
        clean = pull.get("mergeable") == "MERGEABLE"
        if clean and self.required_check(repo, pull)["state"] == "passed":
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
        method = self.config.merge_method(repo)
        try:
            self.github.enable_auto_merge(repo, number, head, method)
        except MergeMethodNotAllowed:
            raise self._merge_method_refusal(repo, method) from None
        return success(
            {"state": "queued", "autoMerge": True, "changed": True},
            reasoning=f"Queued {number} to {method}-merge at {head[:12]} once its checks pass",
        )

    def _credit(self, repo: str, bundle: str, upload: dict, head: str) -> None:
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
            "repository allows (squash for a squash-only repository) and merge again",
            method=method,
        )

    def _release_on_merge(self, repo: str, pull: dict) -> None:
        for number in pull.get("closes", []):
            record = self.claim(repo, number)
            if isinstance(record, Claim) and record.branch == pull.get("branch"):
                reason = f"merged in #{pull['number']}"
                self.github.add_comment(
                    repo, number, claim_rules.release_body(record.holder(), reason)
                )

    def pr_revert(self, repo: str, numbers: list[int], reason: str):
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

    def variable_set(self, repo: str, name: str, value: str):
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
