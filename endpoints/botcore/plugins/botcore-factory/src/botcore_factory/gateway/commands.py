"""The gateway's AFD commands, the routes that serve each, and their policies.

Handlers are made per route by ``make_commands``: their names (kebab-case, as the host
serves them), signatures and docstrings are what each route's catalog publishes. Every
GitHub command takes ``repo``. Effects: reads are ``inspect``, GitHub writes ``service``,
writes to the gateway's own state ``history-write``; the ``remote-caller`` profile admits
exactly these.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Annotated, Any, Literal

from afd import CommandResult
from botcore.host import CommandPolicy
from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from botcore_factory.gateway import issue_tree, records
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
#: A machine's name: one word, no spaces or line breaks.
HostName = Annotated[str, StringConstraints(pattern=r"^\S{1,255}$")]
#: An issue's number.
Number = Annotated[int, Field(ge=1)]


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
        "issue-set",
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
        "lane-heartbeat",
    ),
}
ROUTES["owner"] = tuple(dict.fromkeys([*ROUTES["foreman"], *ROUTES["lane"], *ROUTES["cell"]]))
#: A lane's health report only. A lane runs queued branches' own code as its own process, so
#: any token it holds can be read by that code: this route's token cannot push, merge or claim.
ROUTES["heartbeat"] = ("gateway-status", "lane-heartbeat")

_READ = CommandPolicy(("inspect",))
_WRITE = CommandPolicy(("service", "history-write"))
POLICIES: dict[str, CommandPolicy] = {
    **{name: _READ for name in (*READS, "gateway-audit")},
    **{name: _WRITE for name in records.WRITE_COMMANDS if name != "review-record"},
    "review-record": CommandPolicy(("history-write",)),
    # Marks events delivered to its consumer.
    "gateway-wait": CommandPolicy(("history-write",)),
    # Keeps the lane's own report; nothing reaches GitHub.
    "lane-heartbeat": CommandPolicy(("history-write",)),
}
#: The commands gateway-status reports as this route's writes.
WRITES = records.WRITE_COMMANDS


def _raise(exc: Exception) -> CommandResult[Any]:
    raise exc


async def _run(body: Callable[[], CommandResult[Any]]) -> CommandResult[Any]:
    # GitHub calls block; a thread keeps an HTTP or MCP host's event loop free.
    return await asyncio.to_thread(guard, body)


def _writer(
    get: Callable[[], Gateway],
) -> Callable[[Callable[[], CommandResult[Any]]], Awaitable[CommandResult[Any]]]:
    """Run a write under the gateway's one lock: read, decide and write as one step."""

    async def write(body: Callable[[], CommandResult[Any]]) -> CommandResult[Any]:
        def locked() -> CommandResult[Any]:
            with get().state.lock:
                return body()

        return await _run(locked)

    return write


def _reads_claims_and_issues(route: str, get: Callable[[], Gateway], host: str) -> dict[str, Any]:
    run, write = _run, _writer(get)

    async def gateway_status() -> CommandResult[Any]:
        """Report this route's host, its write commands, the bot identity, repositories,
        rate limit (REST and GraphQL), credential ages, journal and each repository's lane."""
        writes = sorted(name for name in ROUTES[route] if name in WRITES)
        return await run(lambda: get().status(host, writes))

    async def issue_get(repo: Repo, number: int) -> CommandResult[Any]:
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
    ) -> CommandResult[Any]:
        """Read an issue's comments in pages, each labelled as content.

        Args:
            repo: owner/name of a repository this gateway serves.
            number: The issue number.
            limit: Comments per page (1 to 100, default 50).
            cursor: The nextCursor of the previous page.
        """
        return await run(lambda: get().comment_list(repo, number, limit, cursor))

    async def claim_list(repo: Repo, stale: bool | None = None) -> CommandResult[Any]:
        """List the claims GitHub records, rebuilt from the bot's comments.

        Args:
            repo: owner/name of a repository this gateway serves.
            stale: Only lapsed claims (true) or only live ones (false); all when left out.
        """
        return await run(lambda: get().claim_list(repo, stale))

    async def pr_status(repo: Repo, number: int) -> CommandResult[Any]:
        """Read where a pull request stands, settled: merged, closed or open, mergeability,
        the required check and, where main has a merge queue, its place in it.

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
    ) -> CommandResult[Any]:
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

    async def issue_release(
        repo: Repo, number: int, holder: Holder, reason: Name
    ) -> CommandResult[Any]:
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
    ) -> CommandResult[Any]:
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
    ) -> CommandResult[Any]:
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
    ) -> CommandResult[Any]:
        """Comment on an issue once: a retry with the same dedupe_key finds the comment.

        Args:
            repo: owner/name of a repository this gateway serves.
            number: The issue.
            body: The comment, inline (at most 64 KiB), checked for secrets.
            dedupe_key: A key you choose; the same key never posts twice.
        """
        return await write(lambda: get().issue_comment(repo, number, body, dedupe_key))

    async def issue_create(  # noqa: PLR0913 - the command's inputs
        repo: Repo,
        title: Name,
        body: str,
        labels: list[str] | None = None,
        type: Name | None = None,
        parent: Number | None = None,
        dedupe_key: Name | None = None,
    ) -> CommandResult[Any]:
        """File an issue once, with an optional type and parent.

        An open issue filed with the same dedupe_key is returned instead, given whichever of
        the type and parent it still lacks.

        Args:
            repo: owner/name of a repository this gateway serves.
            title: The title.
            body: The body, inline (at most 64 KiB), checked for secrets.
            labels: Labels the repository defines.
            type: An issue type the organization defines, by name (Epic, Task).
            parent: An issue in this repository; the new issue is filed as its sub-issue.
            dedupe_key: A key you choose; the same key never files twice.
        """
        return await write(
            lambda: issue_tree.issue_create(
                get(), repo, title, body, labels or [], dedupe_key, type, parent
            )
        )

    async def issue_set(
        repo: Repo,
        number: Number,
        type: Name | None = issue_tree.KEEP,
        parent: Number | None = issue_tree.KEEP,
    ) -> CommandResult[Any]:
        """Change or clear an issue's type or parent; returns both, before and after.

        Args:
            repo: owner/name of a repository this gateway serves.
            number: The issue.
            type: An issue type the organization defines, by name; null clears it. Left out,
                the type is unchanged.
            parent: An issue in this repository, which replaces any parent it has; null
                detaches it. Left out, the parent is unchanged.
        """
        return await write(lambda: issue_tree.issue_set(get(), repo, number, type, parent))

    return {
        "gateway-status": gateway_status,
        "issue-get": issue_get,
        "comment-list": comment_list,
        "claim-list": claim_list,
        "pr-status": pr_status,
        "issue-claim": issue_claim,
        "issue-release": issue_release_owner if route == "owner" else issue_release,
        "issue-label": issue_label,
        "issue-set": issue_set,
        "issue-comment": issue_comment,
        "issue-create": issue_create,
    }


def _lane_and_records(get: Callable[[], Gateway]) -> dict[str, Any]:
    run, write = _run, _writer(get)

    async def branch_push(repo: Repo, ref: Name, head: Sha, bundle: Name) -> CommandResult[Any]:
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
    ) -> CommandResult[Any]:
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
    ) -> CommandResult[Any]:
        """Record the lane's validation of a head, published as the factory/verification check.

        Args:
            repo: owner/name of a repository this gateway serves.
            head: The full SHA the lane validated.
            result: passed or failed.
            summary: What ran, checked for secrets.
        """
        return await write(lambda: get().verification_record(repo, head, result, summary))

    async def pr_merge(
        repo: Repo, number: int, head: Sha, cancel: bool = False
    ) -> CommandResult[Any]:
        """Merge a pull request at the head the lane validated, at once or by auto-merge bound
        to that head, by the repository's merge method; cancel turns auto-merge off. Where main
        has a merge queue the pull request is queued instead (state queued, with mergeQueue),
        and cancel takes it out of the queue.

        Args:
            repo: owner/name of a repository this gateway serves.
            number: The pull request.
            head: The full SHA to merge; any other head is refused.
            cancel: Turn auto-merge off instead, as the lane does when it ejects a branch.
        """
        return await write(lambda: get().pr_merge(repo, number, head, cancel))

    async def pr_revert(
        repo: Repo, numbers: Annotated[list[int], Field(min_length=1, max_length=10)], reason: str
    ) -> CommandResult[Any]:
        """Open a revert pull request for each merged pull request, or return the open one.

        Args:
            repo: owner/name of a repository this gateway serves.
            numbers: The merged pull requests to revert.
            reason: Why, written into each revert's body.
        """
        return await write(lambda: get().pr_revert(repo, numbers, reason))

    async def variable_set(repo: Repo, name: Name, value: str) -> CommandResult[Any]:
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
    ) -> CommandResult[Any]:
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
    ) -> CommandResult[Any]:
        """Record review lanes' verdicts for a head; recording the same head replaces it.

        Args:
            repo: owner/name of a repository this gateway serves.
            branch: The reviewed branch.
            head: The full SHA the lanes reviewed.
            lanes: Each lane's verdict.
        """
        rows = [lane.model_dump() for lane in lanes]
        return await write(lambda: records.review_record(get(), repo, branch, head, rows))

    async def review_get(repo: Repo, head: Sha) -> CommandResult[Any]:
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
    ) -> CommandResult[Any]:
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

    async def lane_heartbeat(
        repo: Repo,
        host: HostName,
        running: bool,
        queued: Annotated[int, Field(ge=0)],
        last_merge_at: str | None = None,
    ) -> CommandResult[Any]:
        """Report the lane's own state from its loop, so gateway-status shows a lane that
        stopped reporting as not running.

        Args:
            repo: owner/name of a repository this gateway serves.
            host: The machine the lane runs on.
            running: Whether the lane's loop is running (false once it is asked to stop).
            queued: Branches waiting in the lane's queue.
            last_merge_at: When the lane last merged, ISO 8601; left out before its first merge.
        """
        return await write(lambda: get().lane_heartbeat(repo, host, running, queued, last_merge_at))

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
        "lane-heartbeat": lane_heartbeat,
    }


def make_commands(
    route: str, get: Callable[[], Gateway], host: str
) -> dict[str, Callable[..., Any]]:
    """The commands ``route`` serves; ``get`` returns that route's Gateway."""
    handlers = {**_reads_claims_and_issues(route, get, host), **_lane_and_records(get)}
    return {name: handlers[name] for name in ROUTES[route]}
