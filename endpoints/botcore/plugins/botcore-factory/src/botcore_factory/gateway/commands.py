"""The gateway's AFD commands, the routes that serve each, and their policies.

Handlers are made per route by ``make_commands``: their names (kebab-case, as the host
serves them), signatures and docstrings are what each route's catalog publishes. Every
GitHub command takes ``repo``. Effects: reads are ``inspect``, GitHub writes ``service``,
writes to the gateway's own state ``history-write``; the ``remote-caller`` profile admits
exactly these.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from typing import Annotated, Literal

from afd import CommandResult
from botcore.host import CommandPolicy
from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from botcore_factory.gateway import records
from botcore_factory.gateway.github import GitHubRefused, GitHubUnavailable
from botcore_factory.gateway.service import (
    Gateway,
    Refusal,
    guard,
    refused_by_github,
    unavailable,
)

Sha = Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{40}$")]
Repo = Annotated[str, StringConstraints(pattern=r"^[\w.-]+/[\w.-]+$")]
Name = Annotated[str, StringConstraints(min_length=1, max_length=255)]


class Holder(BaseModel):
    """Who holds a claim: a branch and the machine it is worked on."""

    model_config = ConfigDict(extra="forbid")
    branch: Name
    machine: Name


class ReviewLane(BaseModel):
    """One review lane's verdict on a head."""

    model_config = ConfigDict(extra="forbid")
    lane: Name
    model: Name
    effort: Name
    verdict: Literal["pass", "fail"]
    fixed: int = Field(0, ge=0)
    deferred: int = Field(0, ge=0)


READS = ("gateway-status", "issue-get", "comment-list", "claim-list", "pr-status", "review-get")
CLAIMS = ("issue-claim", "issue-release")
#: What each route serves. The foreman has no push, merge or validation; a cell pushes only
#: its queue ref and records its review.
ROUTES: dict[str, tuple[str, ...]] = {
    "cell": (*READS, "branch-push", "review-record"),
    # A session hands its branch to the lane through its queue ref, as a cell does.
    "session": (*READS, *CLAIMS, "branch-push"),
    "foreman": (
        *READS,
        *CLAIMS,
        "issue-label",
        "issue-comment",
        "issue-create",
        "pr-revert",
        "variable-set",
        "gateway-audit",
        "gateway-wait",
    ),
    "lane": (
        *READS,
        *CLAIMS,
        "issue-comment",
        "issue-create",
        "branch-push",
        "pr-open",
        "verification-record",
        "pr-merge",
        "pr-revert",
        "gateway-wait",
    ),
}
ROUTES["owner"] = tuple(dict.fromkeys([*ROUTES["foreman"], *ROUTES["lane"], *ROUTES["cell"]]))

_READ = CommandPolicy(("inspect",))
_WRITE = CommandPolicy(("service", "history-write"))
POLICIES: dict[str, CommandPolicy] = {
    **{name: _READ for name in (*READS, "gateway-audit")},
    **{name: _WRITE for name in records.WRITE_COMMANDS if name != "review-record"},
    "review-record": CommandPolicy(("history-write",)),
    # Marks events delivered to its consumer.
    "gateway-wait": CommandPolicy(("history-write",)),
}
#: The commands gateway-status reports as this route's writes.
WRITES = records.WRITE_COMMANDS


def _raise(exc: Exception) -> CommandResult:
    raise exc


async def _run(body: Callable[[], CommandResult]) -> CommandResult:
    # GitHub calls block; a thread keeps an HTTP or MCP host's event loop free.
    return await asyncio.to_thread(guard, body)


def _writer(get: Callable[[], Gateway]):
    """Run a write under the gateway's one lock: read, decide and write as one step."""

    async def write(body: Callable[[], CommandResult]) -> CommandResult:
        def locked() -> CommandResult:
            with get().state.lock:
                return body()

        return await _run(locked)

    return write


def _reads_claims_and_issues(route: str, get: Callable[[], Gateway], host: str) -> dict:
    run, write = _run, _writer(get)

    async def gateway_status() -> CommandResult:
        """Report this route's host, its write commands, the bot identity, repositories,
        rate limit and journal."""
        writes = sorted(name for name in ROUTES[route] if name in WRITES)
        return await run(lambda: get().status(host, writes))

    async def issue_get(repo: Repo, number: int) -> CommandResult:
        """Read an issue: typed facts, its claim, and its body labelled as content.

        Args:
            repo: owner/name of a repository this gateway serves.
            number: The issue number.
        """
        return await run(lambda: get().issue_get(repo, number))

    async def comment_list(
        repo: Repo,
        number: int,
        limit: Annotated[int, Field(ge=1, le=100)] = 50,
        cursor: str | None = None,
    ) -> CommandResult:
        """Read an issue's comments in pages, each labelled as content.

        Args:
            repo: owner/name of a repository this gateway serves.
            number: The issue number.
            limit: Comments per page (1 to 100, default 50).
            cursor: The nextCursor of the previous page.
        """
        return await run(lambda: get().comment_list(repo, number, limit, cursor))

    async def claim_list(repo: Repo, stale: bool | None = None) -> CommandResult:
        """List the claims GitHub records, rebuilt from the bot's comments.

        Args:
            repo: owner/name of a repository this gateway serves.
            stale: Only lapsed claims (true) or only live ones (false); all when left out.
        """
        return await run(lambda: get().claim_list(repo, stale))

    async def pr_status(repo: Repo, number: int) -> CommandResult:
        """Read where a pull request stands, settled: merged, closed or open, mergeability
        and the required check.

        Args:
            repo: owner/name of a repository this gateway serves.
            number: The pull request number.
        """
        return await run(lambda: get().pr_status(repo, number))

    async def issue_claim(
        repo: Repo,
        numbers: Annotated[list[int], Field(min_length=1, max_length=20)],
        holder: Holder,
        lease_hours: Annotated[float, Field(gt=0, le=168)] | None = None,
    ) -> CommandResult:
        """Claim issues for a holder, all or none; claiming again as the same holder renews.

        Args:
            repo: owner/name of a repository this gateway serves.
            numbers: The issues to claim together.
            holder: The branch and machine that hold them.
            lease_hours: How long the lease lasts (default 24).
        """
        return await write(
            lambda: get().issue_claim(repo, numbers, holder.model_dump(), lease_hours)
        )

    async def issue_release(repo: Repo, number: int, holder: Holder, reason: Name) -> CommandResult:
        """Release a claim the holder holds; a retry of a done release changes nothing.

        Args:
            repo: owner/name of a repository this gateway serves.
            number: The issue.
            holder: The branch and machine releasing it.
            reason: Why, posted with the release.
        """
        return await write(
            lambda: get().issue_release(repo, number, holder.model_dump(), reason, False)
        )

    async def issue_release_owner(
        repo: Repo, number: int, holder: Holder, reason: Name, force: bool = False
    ) -> CommandResult:
        """Release a claim; with force, the owner frees an issue whoever holds it.

        Args:
            repo: owner/name of a repository this gateway serves.
            number: The issue.
            holder: The branch and machine releasing it.
            reason: Why, posted with the release.
            force: Release it whoever holds it (owner only).
        """
        return await write(
            lambda: get().issue_release(repo, number, holder.model_dump(), reason, force)
        )

    async def issue_label(
        repo: Repo, number: int, add: list[str] | None = None, remove: list[str] | None = None
    ) -> CommandResult:
        """Add or remove labels the repository defines; returns the labels before and after.

        Args:
            repo: owner/name of a repository this gateway serves.
            number: The issue or pull request.
            add: Labels to add.
            remove: Labels to remove.
        """
        return await write(lambda: get().issue_label(repo, number, add or [], remove or []))

    async def issue_comment(
        repo: Repo, number: int, body: str, dedupe_key: Name | None = None
    ) -> CommandResult:
        """Comment on an issue once: a retry with the same dedupe_key finds the comment.

        Args:
            repo: owner/name of a repository this gateway serves.
            number: The issue.
            body: The comment, inline (at most 64 KiB), checked for secrets.
            dedupe_key: A key you choose; the same key never posts twice.
        """
        return await write(lambda: get().issue_comment(repo, number, body, dedupe_key))

    async def issue_create(
        repo: Repo,
        title: Name,
        body: str,
        labels: list[str] | None = None,
        dedupe_key: Name | None = None,
    ) -> CommandResult:
        """File an issue once: an open issue filed with the same dedupe_key is returned.

        Args:
            repo: owner/name of a repository this gateway serves.
            title: The title.
            body: The body, inline (at most 64 KiB), checked for secrets.
            labels: Labels the repository defines.
            dedupe_key: A key you choose; the same key never files twice.
        """
        return await write(lambda: get().issue_create(repo, title, body, labels or [], dedupe_key))

    return {
        "gateway-status": gateway_status,
        "issue-get": issue_get,
        "comment-list": comment_list,
        "claim-list": claim_list,
        "pr-status": pr_status,
        "issue-claim": issue_claim,
        "issue-release": issue_release_owner if route == "owner" else issue_release,
        "issue-label": issue_label,
        "issue-comment": issue_comment,
        "issue-create": issue_create,
    }


def _lane_and_records(get: Callable[[], Gateway]) -> dict:
    run, write = _run, _writer(get)

    async def branch_push(repo: Repo, ref: Name, head: Sha, bundle: Name) -> CommandResult:
        """Push one ref from an uploaded git bundle; cells and sessions push only
        refs/factory/queue/<branch>, which hands the branch to the lane.

        Upload the bundle first (POST /uploads on this route returns its id, valid an hour).
        Every commit the push adds must be authored by the owner; an agent that helped is an
        Assisted-by trailer.

        Args:
            repo: owner/name of a repository this gateway serves.
            ref: The full ref, refs/heads/<branch> or refs/factory/queue/<branch>.
            head: The full 40-character SHA to push; the bundle must contain it.
            bundle: The upload id.
        """
        return await write(lambda: get().branch_push(repo, ref, head, bundle))

    async def pr_open(
        repo: Repo, branch: Name, title: Name, body: str, closes: list[int] | None = None
    ) -> CommandResult:
        """Open the branch's pull request, or update the open one; the gateway writes the
        closing lines.

        Args:
            repo: owner/name of a repository this gateway serves.
            branch: The pushed branch.
            title: The title.
            body: The body, without closing keywords, checked for secrets.
            closes: The issues it closes.
        """
        return await write(lambda: get().pr_open(repo, branch, title, body, closes or []))

    async def verification_record(
        repo: Repo, head: Sha, result: Literal["passed", "failed"], summary: str
    ) -> CommandResult:
        """Record the lane's validation of a head, published as the factory/verification check.

        Args:
            repo: owner/name of a repository this gateway serves.
            head: The full SHA the lane validated.
            result: passed or failed.
            summary: What ran, checked for secrets.
        """
        return await write(lambda: get().verification_record(repo, head, result, summary))

    async def pr_merge(repo: Repo, number: int, head: Sha, cancel: bool = False) -> CommandResult:
        """Merge a pull request at the head the lane validated, at once or by auto-merge bound
        to that head, by the repository's merge method; cancel turns auto-merge off.

        Args:
            repo: owner/name of a repository this gateway serves.
            number: The pull request.
            head: The full SHA to merge; any other head is refused.
            cancel: Turn auto-merge off instead, as the lane does when it ejects a branch.
        """
        return await write(lambda: get().pr_merge(repo, number, head, cancel))

    async def pr_revert(
        repo: Repo, numbers: Annotated[list[int], Field(min_length=1, max_length=10)], reason: str
    ) -> CommandResult:
        """Open a revert pull request for each merged pull request, or return the open one.

        Args:
            repo: owner/name of a repository this gateway serves.
            numbers: The merged pull requests to revert.
            reason: Why, written into each revert's body.
        """
        return await write(lambda: get().pr_revert(repo, numbers, reason))

    async def variable_set(repo: Repo, name: Name, value: str) -> CommandResult:
        """Set a repository variable the gateway is allowed to set (FACTORY_LANE_HOST).

        Args:
            repo: owner/name of a repository this gateway serves.
            name: The variable.
            value: Its value, checked for secrets.
        """
        return await write(lambda: get().variable_set(repo, name, value))

    async def gateway_audit(
        repo: Repo,
        issue: int | None = None,
        pr: int | None = None,
        since: str | None = None,
        actor: str | None = None,
        limit: Annotated[int, Field(ge=1, le=200)] = 50,
        cursor: str | None = None,
    ) -> CommandResult:
        """List the gateway's writes with the caller that made each, and writes to factory
        work that did not come through the gateway.

        Args:
            repo: owner/name of a repository this gateway serves.
            issue: Only this issue.
            pr: Only this pull request.
            since: Only from this ISO 8601 time.
            actor: Only this caller id.
            limit: Entries per page (default 50).
            cursor: The nextCursor of the previous page.
        """
        filters = {"issue": issue, "pr": pr, "since": since, "actor": actor}
        return await run(lambda: records.gateway_audit(get(), repo, filters, limit, cursor))

    async def review_record(
        repo: Repo,
        branch: Name,
        head: Sha,
        lanes: Annotated[list[ReviewLane], Field(min_length=1)],
    ) -> CommandResult:
        """Record review lanes' verdicts for a head; recording the same head replaces it.

        Args:
            repo: owner/name of a repository this gateway serves.
            branch: The reviewed branch.
            head: The full SHA the lanes reviewed.
            lanes: Each lane's verdict.
        """
        rows = [lane.model_dump() for lane in lanes]
        return await write(lambda: records.review_record(get(), repo, branch, head, rows))

    async def review_get(repo: Repo, head: Sha) -> CommandResult:
        """Read the review recorded for an exact head.

        Args:
            repo: owner/name of a repository this gateway serves.
            head: The full SHA.
        """
        return await run(lambda: records.review_get(get(), repo, head))

    async def gateway_wait(
        repo: Repo,
        consumer: Name,
        kinds: list[str] | None = None,
        timeout_ms: Annotated[int, Field(ge=0, le=300_000)] = 30_000,
    ) -> CommandResult:
        """Return events this consumer has not seen, waiting up to timeout_ms for one.

        Args:
            repo: owner/name of a repository this gateway serves.
            consumer: The reader's name; each event reaches each consumer once.
            kinds: Only these kinds (pr-merged, checks-passed, checks-failed, checks-stalled,
                owner-commented, outside-write).
            timeout_ms: Most milliseconds to wait (at most 300000).
        """
        try:
            return await records.gateway_wait(get(), repo, consumer, kinds, timeout_ms)
        except Refusal as refusal:
            return refusal.result
        except GitHubUnavailable as exc:
            return unavailable(exc)
        except GitHubRefused as exc:
            return refused_by_github(exc)

    return {
        "branch-push": branch_push,
        "pr-open": pr_open,
        "verification-record": verification_record,
        "pr-merge": pr_merge,
        "pr-revert": pr_revert,
        "variable-set": variable_set,
        "gateway-audit": gateway_audit,
        "review-record": review_record,
        "review-get": review_get,
        "gateway-wait": gateway_wait,
    }


def make_commands(route: str, get: Callable[[], Gateway], host: str) -> dict[str, Callable]:
    """The commands ``route`` serves; ``get`` returns that route's Gateway."""
    handlers = {**_reads_claims_and_issues(route, get, host), **_lane_and_records(get)}
    return {name: handlers[name] for name in ROUTES[route]}
