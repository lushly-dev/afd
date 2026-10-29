"""GitHub command definitions — 8 closure-based commands + factory."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any, NamedTuple, TypedDict

from afd import CommandResult, success

from botcore_connectors.auth import CredentialResolver
from botcore_connectors.config import GitHubConnectorConfig
from botcore_connectors.errors import (
    config_missing_required,
    input_validation_failed,
    invalid_repo,
)
from botcore_connectors.github import GitHubConnector
from botcore_connectors.validation import (
    PaginationParams,
    check_max_body_size,
    check_max_length,
    check_owner_repo,
    check_review_event,
    validate_inputs,
)

# ---------------------------------------------------------------------------
# TypedDicts for typed return data
# ---------------------------------------------------------------------------


class IssueResult(TypedDict):
    number: int
    url: str
    title: str
    state: str
    user: str
    labels: list[str]


class PRResult(TypedDict):
    number: int
    url: str
    title: str
    state: str
    user: str
    head: str
    base: str
    draft: bool
    merged: bool


class CommentResult(TypedDict):
    id: int
    url: str
    body: str
    user: str


class ReviewResult(TypedDict):
    id: int
    state: str
    url: str
    user: str
    body: str


class CodeSearchResult(TypedDict):
    name: str
    path: str
    repo: str
    url: str
    score: float


class IssueSearchResult(TypedDict):
    number: int
    title: str
    state: str
    url: str
    repo: str


# ---------------------------------------------------------------------------
# Result mappers
# ---------------------------------------------------------------------------


def _map_issue(raw: dict[str, Any]) -> IssueResult:
    return IssueResult(
        number=raw.get("number", 0),
        url=raw.get("html_url", ""),
        title=raw.get("title", ""),
        state=raw.get("state", ""),
        user=(raw.get("user") or {}).get("login", ""),
        labels=[lb.get("name", "") for lb in raw.get("labels", [])],
    )


def _map_pr(raw: dict[str, Any]) -> PRResult:
    return PRResult(
        number=raw.get("number", 0),
        url=raw.get("html_url", ""),
        title=raw.get("title", ""),
        state=raw.get("state", ""),
        user=(raw.get("user") or {}).get("login", ""),
        head=(raw.get("head") or {}).get("ref", ""),
        base=(raw.get("base") or {}).get("ref", ""),
        draft=raw.get("draft", False),
        merged=raw.get("merged", False),
    )


def _map_comment(raw: dict[str, Any]) -> CommentResult:
    return CommentResult(
        id=raw.get("id", 0),
        url=raw.get("html_url", ""),
        body=raw.get("body", ""),
        user=(raw.get("user") or {}).get("login", ""),
    )


def _map_review(raw: dict[str, Any]) -> ReviewResult:
    return ReviewResult(
        id=raw.get("id", 0),
        state=raw.get("state", ""),
        url=raw.get("html_url", ""),
        user=(raw.get("user") or {}).get("login", ""),
        body=raw.get("body", ""),
    )


# ---------------------------------------------------------------------------
# Repo resolution
# ---------------------------------------------------------------------------


def resolve_repo(
    repo_arg: str | None, default_repo: str | None
) -> str | CommandResult[dict[str, Any]]:
    """Resolve repo from explicit arg or config default.

    Returns the repo string on success, or a ``CommandResult`` error.
    """
    repo = repo_arg or default_repo
    if repo is None:
        return config_missing_required("repo", "no default_repo in config")

    v = validate_inputs(repo=check_owner_repo(repo, field_name="repo"))
    if not v.valid:
        return invalid_repo(repo)

    return repo


# ---------------------------------------------------------------------------
# GitHubCommandSet
# ---------------------------------------------------------------------------


class GitHubCommandSet(NamedTuple):
    """Commands list + connector reference for lifecycle management."""

    commands: list[Callable[..., Any]]
    connector: GitHubConnector


# ---------------------------------------------------------------------------
# Command builders (split for complexity budget)
# ---------------------------------------------------------------------------


def _build_issue_commands(
    connector: GitHubConnector,
) -> list[Callable[..., Any]]:
    async def github_issue_create(
        title: str,
        *,
        body: str | None = None,
        labels: list[str] | None = None,
        assignees: list[str] | None = None,
        repo: str | None = None,
    ) -> CommandResult[dict[str, Any]]:
        resolved = resolve_repo(repo, connector.default_repo)
        if isinstance(resolved, CommandResult):
            return resolved

        checks = validate_inputs(
            title=check_max_length(title, field_name="title"),
            **({"body": check_max_body_size(body, field_name="body")} if body else {}),
        )
        if not checks.valid:
            return input_validation_failed(checks.violations)

        payload: dict[str, Any] = {"title": title}
        if body is not None:
            payload["body"] = body
        if labels is not None:
            payload["labels"] = labels
        if assignees is not None:
            payload["assignees"] = assignees

        result = await connector.gh_api_call(
            "POST", f"/repos/{resolved}/issues", json=payload
        )
        if result.error is not None:
            return result

        return success(
            data=_map_issue(result.data),
            reasoning=f"Created issue in {resolved}: {result.data.get('html_url', '')}",
        )

    async def github_issue_list(
        *,
        state: str = "open",
        labels: str | None = None,
        repo: str | None = None,
        page: int = 1,
        page_size: int = 30,
    ) -> CommandResult[dict[str, Any]]:
        resolved = resolve_repo(repo, connector.default_repo)
        if isinstance(resolved, CommandResult):
            return resolved

        pagination = PaginationParams(page=page, page_size=page_size)
        params = {**pagination.to_github_params(), "state": state}
        if labels:
            params["labels"] = labels

        result = await connector.gh_api_call(
            "GET", f"/repos/{resolved}/issues", params=params
        )
        if result.error is not None:
            return result

        items = result.data if isinstance(result.data, list) else []
        return success(
            data=[_map_issue(item) for item in items],
            reasoning=f"Listed {len(items)} issues from {resolved}",
        )

    async def github_issue_comment(
        issue_number: int,
        body: str,
        *,
        repo: str | None = None,
    ) -> CommandResult[dict[str, Any]]:
        resolved = resolve_repo(repo, connector.default_repo)
        if isinstance(resolved, CommandResult):
            return resolved

        checks = validate_inputs(
            body=check_max_body_size(body, field_name="body"),
        )
        if not checks.valid:
            return input_validation_failed(checks.violations)

        result = await connector.gh_api_call(
            "POST",
            f"/repos/{resolved}/issues/{issue_number}/comments",
            json={"body": body},
        )
        if result.error is not None:
            return result

        return success(
            data=_map_comment(result.data),
            reasoning=f"Commented on {resolved}#{issue_number}: {result.data.get('html_url', '')}",
        )

    return [github_issue_create, github_issue_list, github_issue_comment]


def _build_pr_commands(
    connector: GitHubConnector,
) -> list[Callable[..., Any]]:
    async def github_pr_create(
        title: str,
        head: str,
        base: str,
        *,
        body: str | None = None,
        draft: bool = False,
        repo: str | None = None,
    ) -> CommandResult[dict[str, Any]]:
        resolved = resolve_repo(repo, connector.default_repo)
        if isinstance(resolved, CommandResult):
            return resolved

        checks = validate_inputs(
            title=check_max_length(title, field_name="title"),
            **({"body": check_max_body_size(body, field_name="body")} if body else {}),
        )
        if not checks.valid:
            return input_validation_failed(checks.violations)

        payload: dict[str, Any] = {
            "title": title,
            "head": head,
            "base": base,
            "draft": draft,
        }
        if body is not None:
            payload["body"] = body

        result = await connector.gh_api_call(
            "POST", f"/repos/{resolved}/pulls", json=payload
        )
        if result.error is not None:
            return result

        return success(
            data=_map_pr(result.data),
            reasoning=f"Created PR in {resolved}: {result.data.get('html_url', '')}",
        )

    async def github_pr_list(
        *,
        state: str = "open",
        head: str | None = None,
        base: str | None = None,
        repo: str | None = None,
        page: int = 1,
        page_size: int = 30,
    ) -> CommandResult[dict[str, Any]]:
        resolved = resolve_repo(repo, connector.default_repo)
        if isinstance(resolved, CommandResult):
            return resolved

        pagination = PaginationParams(page=page, page_size=page_size)
        params = {**pagination.to_github_params(), "state": state}
        if head:
            params["head"] = head
        if base:
            params["base"] = base

        result = await connector.gh_api_call(
            "GET", f"/repos/{resolved}/pulls", params=params
        )
        if result.error is not None:
            return result

        items = result.data if isinstance(result.data, list) else []
        return success(
            data=[_map_pr(item) for item in items],
            reasoning=f"Listed {len(items)} PRs from {resolved}",
        )

    async def github_pr_review(
        pr_number: int,
        event: str,
        *,
        body: str | None = None,
        repo: str | None = None,
    ) -> CommandResult[dict[str, Any]]:
        resolved = resolve_repo(repo, connector.default_repo)
        if isinstance(resolved, CommandResult):
            return resolved

        event_check = check_review_event(event, field_name="event")
        checks = validate_inputs(
            event=event_check,
            **({"body": check_max_body_size(body, field_name="body")} if body else {}),
        )
        if not checks.valid:
            return input_validation_failed(checks.violations)

        payload: dict[str, Any] = {"event": event}
        if body is not None:
            payload["body"] = body

        result = await connector.gh_api_call(
            "POST",
            f"/repos/{resolved}/pulls/{pr_number}/reviews",
            json=payload,
        )
        if result.error is not None:
            return result

        return success(
            data=_map_review(result.data),
            reasoning=f"Reviewed PR {resolved}#{pr_number}: {event}",
        )

    return [github_pr_create, github_pr_list, github_pr_review]


def _build_search_commands(
    connector: GitHubConnector,
) -> list[Callable[..., Any]]:
    async def github_search_code(
        query: str,
        *,
        repo: str | None = None,
        page: int = 1,
        page_size: int = 30,
    ) -> CommandResult[dict[str, Any]]:
        checks = validate_inputs(
            query=check_max_length(query, field_name="query"),
        )
        if not checks.valid:
            return input_validation_failed(checks.violations)

        # Scope search to repo if provided.
        effective_query = f"repo:{repo} {query}" if repo else query
        pagination = PaginationParams(page=page, page_size=page_size)
        params = {"q": effective_query, **pagination.to_github_params()}

        result = await connector.gh_api_call(
            "GET", "/search/code", params=params
        )
        if result.error is not None:
            return result

        raw_items = result.data.get("items", []) if isinstance(result.data, dict) else []
        total_count = result.data.get("total_count", 0) if isinstance(result.data, dict) else 0
        mapped = [
            CodeSearchResult(
                name=item.get("name", ""),
                path=item.get("path", ""),
                repo=(item.get("repository") or {}).get("full_name", ""),
                url=item.get("html_url", ""),
                score=item.get("score", 0.0),
            )
            for item in raw_items
        ]
        return success(
            data={"items": mapped, "total_count": total_count},
            reasoning=f"Found {total_count} code results for {query!r}",
        )

    async def github_search_issues(
        query: str,
        *,
        repo: str | None = None,
        state: str | None = None,
        page: int = 1,
        page_size: int = 30,
    ) -> CommandResult[dict[str, Any]]:
        checks = validate_inputs(
            query=check_max_length(query, field_name="query"),
        )
        if not checks.valid:
            return input_validation_failed(checks.violations)

        # Scope search to repo and/or state if provided.
        parts = [query]
        if repo:
            parts.insert(0, f"repo:{repo}")
        if state:
            parts.append(f"state:{state}")
        effective_query = " ".join(parts)
        pagination = PaginationParams(page=page, page_size=page_size)
        params = {"q": effective_query, **pagination.to_github_params()}

        result = await connector.gh_api_call(
            "GET", "/search/issues", params=params
        )
        if result.error is not None:
            return result

        raw_items = result.data.get("items", []) if isinstance(result.data, dict) else []
        total_count = result.data.get("total_count", 0) if isinstance(result.data, dict) else 0
        mapped = [
            IssueSearchResult(
                number=item.get("number", 0),
                title=item.get("title", ""),
                state=item.get("state", ""),
                url=item.get("html_url", ""),
                repo=item.get("repository_url", "").rsplit("/repos/", 1)[-1]
                if item.get("repository_url")
                else "",
            )
            for item in raw_items
        ]
        return success(
            data={"items": mapped, "total_count": total_count},
            reasoning=f"Found {total_count} issue results for {query!r}",
        )

    return [github_search_code, github_search_issues]


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------


def create_github_commands(
    config: GitHubConnectorConfig,
    *,
    resolver: CredentialResolver | None = None,
) -> GitHubCommandSet:
    """Create 8 GitHub commands backed by a shared connector."""
    connector = GitHubConnector(config, resolver=resolver)
    commands: list[Callable[..., Any]] = [
        *_build_issue_commands(connector),
        *_build_pr_commands(connector),
        *_build_search_commands(connector),
    ]
    return GitHubCommandSet(commands=commands, connector=connector)
