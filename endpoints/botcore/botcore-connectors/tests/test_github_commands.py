"""Tests for GitHub commands — all 8 commands + resolve_repo + result mappers."""

from __future__ import annotations

from typing import Any

import httpx
import respx
from afd import CommandResult

from botcore_connectors.github import GITHUB_API_BASE
from botcore_connectors.github_commands import (
    GitHubCommandSet,
    _map_comment,
    _map_issue,
    _map_pr,
    _map_review,
    resolve_repo,
)

GH = GITHUB_API_BASE


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _cmd_by_name(cmds: GitHubCommandSet, name: str):
    """Look up a command by function name — avoids brittle index access."""
    for cmd in cmds.commands:
        if cmd.__name__ == name:
            return cmd
    msg = f"Command {name!r} not found in {[c.__name__ for c in cmds.commands]}"
    raise LookupError(msg)


def _issue_json(number: int = 1, **overrides: Any) -> dict[str, Any]:
    base = {
        "number": number,
        "title": f"Issue #{number}",
        "state": "open",
        "html_url": f"https://github.com/octocat/hello-world/issues/{number}",
        "user": {"login": "octocat"},
        "labels": [{"name": "bug"}],
    }
    base.update(overrides)
    return base


def _pr_json(number: int = 1, **overrides: Any) -> dict[str, Any]:
    base = {
        "number": number,
        "title": f"PR #{number}",
        "state": "open",
        "html_url": f"https://github.com/octocat/hello-world/pull/{number}",
        "user": {"login": "octocat"},
        "head": {"ref": "feature"},
        "base": {"ref": "main"},
        "draft": False,
        "merged": False,
    }
    base.update(overrides)
    return base


def _comment_json(id: int = 101, **overrides: Any) -> dict[str, Any]:
    base = {
        "id": id,
        "body": "Nice work!",
        "html_url": "https://github.com/octocat/hello-world/issues/1#comment-101",
        "user": {"login": "reviewer"},
    }
    base.update(overrides)
    return base


def _review_json(id: int = 201, **overrides: Any) -> dict[str, Any]:
    base = {
        "id": id,
        "state": "APPROVED",
        "html_url": "https://github.com/octocat/hello-world/pull/1#review-201",
        "user": {"login": "reviewer"},
        "body": "LGTM",
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# resolve_repo
# ---------------------------------------------------------------------------


class TestResolveRepo:
    def test_explicit_arg_wins(self) -> None:
        result = resolve_repo("org/explicit", "org/default")
        assert result == "org/explicit"

    def test_fallback_to_default(self) -> None:
        result = resolve_repo(None, "org/default")
        assert result == "org/default"

    def test_both_none_returns_error(self) -> None:
        result = resolve_repo(None, None)
        assert isinstance(result, CommandResult)
        assert result.error is not None
        assert result.error.code == "CONFIG_MISSING_REQUIRED"

    def test_format_validation(self) -> None:
        result = resolve_repo("valid/repo", None)
        assert result == "valid/repo"

    def test_invalid_format_returns_error(self) -> None:
        result = resolve_repo("noslash", None)
        assert isinstance(result, CommandResult)
        assert result.error is not None
        assert result.error.code == "INVALID_REPO"


# ---------------------------------------------------------------------------
# github_issue_create
# ---------------------------------------------------------------------------


class TestGithubIssueCreate:
    @respx.mock
    async def test_success(self, github_commands: GitHubCommandSet) -> None:
        respx.post(f"{GH}/repos/octocat/hello-world/issues").mock(
            return_value=httpx.Response(201, json=_issue_json())
        )
        cmd = _cmd_by_name(github_commands, "github_issue_create")
        result = await cmd("Test issue")
        assert result.success is True
        assert result.data["number"] == 1
        assert result.data["url"] == _issue_json()["html_url"]

    @respx.mock
    async def test_repo_fallback(self, github_commands: GitHubCommandSet) -> None:
        respx.post(f"{GH}/repos/octocat/hello-world/issues").mock(
            return_value=httpx.Response(201, json=_issue_json())
        )
        cmd = _cmd_by_name(github_commands, "github_issue_create")
        result = await cmd("Test", repo=None)
        assert result.success is True

    @respx.mock
    async def test_title_validation(self, github_commands: GitHubCommandSet) -> None:
        cmd = _cmd_by_name(github_commands, "github_issue_create")
        result = await cmd("x" * 300)  # exceeds MAX_IDENTIFIER_LENGTH
        assert result.success is False
        assert result.error.code == "INPUT_VALIDATION_FAILED"

    @respx.mock
    async def test_body_too_large(self, github_commands: GitHubCommandSet) -> None:
        cmd = _cmd_by_name(github_commands, "github_issue_create")
        result = await cmd("ok title", body="x" * 70_000)  # exceeds MAX_BODY_SIZE
        assert result.success is False
        assert result.error.code == "INPUT_VALIDATION_FAILED"

    @respx.mock
    async def test_with_labels(self, github_commands: GitHubCommandSet) -> None:
        route = respx.post(f"{GH}/repos/octocat/hello-world/issues").mock(
            return_value=httpx.Response(201, json=_issue_json())
        )
        cmd = _cmd_by_name(github_commands, "github_issue_create")
        await cmd("Test", labels=["bug", "enhancement"])
        body = route.calls.last.request.content
        assert b"bug" in body

    @respx.mock
    async def test_with_assignees(self, github_commands: GitHubCommandSet) -> None:
        route = respx.post(f"{GH}/repos/octocat/hello-world/issues").mock(
            return_value=httpx.Response(201, json=_issue_json())
        )
        cmd = _cmd_by_name(github_commands, "github_issue_create")
        await cmd("Test", assignees=["octocat"])
        body = route.calls.last.request.content
        assert b"octocat" in body

    @respx.mock
    async def test_error_mapping(self, github_commands: GitHubCommandSet) -> None:
        respx.post(f"{GH}/repos/octocat/hello-world/issues").mock(
            return_value=httpx.Response(422, json={"message": "Validation Failed"})
        )
        cmd = _cmd_by_name(github_commands, "github_issue_create")
        result = await cmd("Test")
        assert result.error is not None
        assert result.error.code == "GITHUB_VALIDATION_ERROR"

    @respx.mock
    async def test_reasoning_url(self, github_commands: GitHubCommandSet) -> None:
        respx.post(f"{GH}/repos/octocat/hello-world/issues").mock(
            return_value=httpx.Response(201, json=_issue_json())
        )
        cmd = _cmd_by_name(github_commands, "github_issue_create")
        result = await cmd("Test")
        assert "octocat/hello-world" in result.reasoning


# ---------------------------------------------------------------------------
# github_issue_list
# ---------------------------------------------------------------------------


class TestGithubIssueList:
    @respx.mock
    async def test_default_pagination(self, github_commands: GitHubCommandSet) -> None:
        route = respx.get(f"{GH}/repos/octocat/hello-world/issues").mock(
            return_value=httpx.Response(200, json=[_issue_json(1), _issue_json(2)])
        )
        cmd = _cmd_by_name(github_commands, "github_issue_list")
        result = await cmd()
        assert result.success is True
        assert len(result.data) == 2
        req = route.calls.last.request
        assert "page=1" in str(req.url)
        assert "per_page=30" in str(req.url)

    @respx.mock
    async def test_state_and_labels(self, github_commands: GitHubCommandSet) -> None:
        route = respx.get(f"{GH}/repos/octocat/hello-world/issues").mock(
            return_value=httpx.Response(200, json=[])
        )
        cmd = _cmd_by_name(github_commands, "github_issue_list")
        await cmd(state="closed", labels="bug,enhancement")
        req = route.calls.last.request
        assert "state=closed" in str(req.url)
        assert "labels=bug" in str(req.url)

    @respx.mock
    async def test_page_params(self, github_commands: GitHubCommandSet) -> None:
        route = respx.get(f"{GH}/repos/octocat/hello-world/issues").mock(
            return_value=httpx.Response(200, json=[])
        )
        cmd = _cmd_by_name(github_commands, "github_issue_list")
        await cmd(page=3, page_size=10)
        req = route.calls.last.request
        assert "page=3" in str(req.url)
        assert "per_page=10" in str(req.url)

    @respx.mock
    async def test_empty_list(self, github_commands: GitHubCommandSet) -> None:
        respx.get(f"{GH}/repos/octocat/hello-world/issues").mock(
            return_value=httpx.Response(200, json=[])
        )
        cmd = _cmd_by_name(github_commands, "github_issue_list")
        result = await cmd()
        assert result.success is True
        assert result.data == []

    @respx.mock
    async def test_error(self, github_commands: GitHubCommandSet) -> None:
        respx.get(f"{GH}/repos/octocat/hello-world/issues").mock(
            return_value=httpx.Response(404, json={"message": "Not Found"})
        )
        cmd = _cmd_by_name(github_commands, "github_issue_list")
        result = await cmd()
        assert result.error is not None
        assert result.error.code == "GITHUB_NOT_FOUND"


# ---------------------------------------------------------------------------
# github_issue_comment
# ---------------------------------------------------------------------------


class TestGithubIssueComment:
    @respx.mock
    async def test_success(self, github_commands: GitHubCommandSet) -> None:
        respx.post(f"{GH}/repos/octocat/hello-world/issues/1/comments").mock(
            return_value=httpx.Response(201, json=_comment_json())
        )
        cmd = _cmd_by_name(github_commands, "github_issue_comment")
        result = await cmd(1, "Great work!")
        assert result.success is True
        assert result.data["id"] == 101
        assert result.data["url"] == _comment_json()["html_url"]

    @respx.mock
    async def test_body_validation(self, github_commands: GitHubCommandSet) -> None:
        cmd = _cmd_by_name(github_commands, "github_issue_comment")
        result = await cmd(1, "x" * 70_000)
        assert result.error is not None
        assert result.error.code == "INPUT_VALIDATION_FAILED"

    @respx.mock
    async def test_repo_resolution(self, github_commands: GitHubCommandSet) -> None:
        respx.post(f"{GH}/repos/octocat/hello-world/issues/1/comments").mock(
            return_value=httpx.Response(201, json=_comment_json())
        )
        cmd = _cmd_by_name(github_commands, "github_issue_comment")
        result = await cmd(1, "test")
        assert result.success is True

    @respx.mock
    async def test_404_remaps(self, github_commands: GitHubCommandSet) -> None:
        respx.post(f"{GH}/repos/octocat/hello-world/issues/999/comments").mock(
            return_value=httpx.Response(404, json={"message": "Not Found"})
        )
        cmd = _cmd_by_name(github_commands, "github_issue_comment")
        result = await cmd(999, "test")
        assert result.error is not None
        assert result.error.code == "GITHUB_NOT_FOUND"

    @respx.mock
    async def test_reasoning_url(self, github_commands: GitHubCommandSet) -> None:
        respx.post(f"{GH}/repos/octocat/hello-world/issues/1/comments").mock(
            return_value=httpx.Response(201, json=_comment_json())
        )
        cmd = _cmd_by_name(github_commands, "github_issue_comment")
        result = await cmd(1, "test")
        assert "octocat/hello-world#1" in result.reasoning


# ---------------------------------------------------------------------------
# github_pr_create
# ---------------------------------------------------------------------------


class TestGithubPrCreate:
    @respx.mock
    async def test_success(self, github_commands: GitHubCommandSet) -> None:
        respx.post(f"{GH}/repos/octocat/hello-world/pulls").mock(
            return_value=httpx.Response(201, json=_pr_json())
        )
        cmd = _cmd_by_name(github_commands, "github_pr_create")
        result = await cmd("My PR", "feature", "main")
        assert result.success is True
        assert result.data["number"] == 1
        assert result.data["url"] == _pr_json()["html_url"]

    @respx.mock
    async def test_draft_flag(self, github_commands: GitHubCommandSet) -> None:
        route = respx.post(f"{GH}/repos/octocat/hello-world/pulls").mock(
            return_value=httpx.Response(201, json=_pr_json(draft=True))
        )
        cmd = _cmd_by_name(github_commands, "github_pr_create")
        result = await cmd("Draft PR", "feature", "main", draft=True)
        assert result.success is True
        body = route.calls.last.request.content
        assert b"true" in body  # draft: true

    @respx.mock
    async def test_repo_resolution(self, github_commands: GitHubCommandSet) -> None:
        respx.post(f"{GH}/repos/octocat/hello-world/pulls").mock(
            return_value=httpx.Response(201, json=_pr_json())
        )
        cmd = _cmd_by_name(github_commands, "github_pr_create")
        result = await cmd("PR", "feat", "main")
        assert result.success is True

    @respx.mock
    async def test_title_validation(self, github_commands: GitHubCommandSet) -> None:
        cmd = _cmd_by_name(github_commands, "github_pr_create")
        result = await cmd("x" * 300, "feat", "main")
        assert result.error is not None
        assert result.error.code == "INPUT_VALIDATION_FAILED"

    @respx.mock
    async def test_body_validation(self, github_commands: GitHubCommandSet) -> None:
        cmd = _cmd_by_name(github_commands, "github_pr_create")
        result = await cmd("Title", "feat", "main", body="x" * 70_000)
        assert result.error is not None
        assert result.error.code == "INPUT_VALIDATION_FAILED"

    @respx.mock
    async def test_error_mapping(self, github_commands: GitHubCommandSet) -> None:
        respx.post(f"{GH}/repos/octocat/hello-world/pulls").mock(
            return_value=httpx.Response(422, json={"message": "Validation Failed"})
        )
        cmd = _cmd_by_name(github_commands, "github_pr_create")
        result = await cmd("Title", "feat", "main")
        assert result.error.code == "GITHUB_VALIDATION_ERROR"

    @respx.mock
    async def test_reasoning_url(self, github_commands: GitHubCommandSet) -> None:
        respx.post(f"{GH}/repos/octocat/hello-world/pulls").mock(
            return_value=httpx.Response(201, json=_pr_json())
        )
        cmd = _cmd_by_name(github_commands, "github_pr_create")
        result = await cmd("PR", "feat", "main")
        assert "octocat/hello-world" in result.reasoning


# ---------------------------------------------------------------------------
# github_pr_list
# ---------------------------------------------------------------------------


class TestGithubPrList:
    @respx.mock
    async def test_success(self, github_commands: GitHubCommandSet) -> None:
        respx.get(f"{GH}/repos/octocat/hello-world/pulls").mock(
            return_value=httpx.Response(200, json=[_pr_json(1), _pr_json(2)])
        )
        cmd = _cmd_by_name(github_commands, "github_pr_list")
        result = await cmd()
        assert result.success is True
        assert len(result.data) == 2

    @respx.mock
    async def test_head_base_filters(self, github_commands: GitHubCommandSet) -> None:
        route = respx.get(f"{GH}/repos/octocat/hello-world/pulls").mock(
            return_value=httpx.Response(200, json=[])
        )
        cmd = _cmd_by_name(github_commands, "github_pr_list")
        await cmd(head="feature", base="main")
        req = route.calls.last.request
        assert "head=feature" in str(req.url)
        assert "base=main" in str(req.url)

    @respx.mock
    async def test_pagination(self, github_commands: GitHubCommandSet) -> None:
        route = respx.get(f"{GH}/repos/octocat/hello-world/pulls").mock(
            return_value=httpx.Response(200, json=[])
        )
        cmd = _cmd_by_name(github_commands, "github_pr_list")
        await cmd(page=2, page_size=5)
        req = route.calls.last.request
        assert "page=2" in str(req.url)
        assert "per_page=5" in str(req.url)

    @respx.mock
    async def test_state_filter(self, github_commands: GitHubCommandSet) -> None:
        route = respx.get(f"{GH}/repos/octocat/hello-world/pulls").mock(
            return_value=httpx.Response(200, json=[])
        )
        cmd = _cmd_by_name(github_commands, "github_pr_list")
        await cmd(state="closed")
        req = route.calls.last.request
        assert "state=closed" in str(req.url)

    @respx.mock
    async def test_error(self, github_commands: GitHubCommandSet) -> None:
        respx.get(f"{GH}/repos/octocat/hello-world/pulls").mock(
            return_value=httpx.Response(404, json={"message": "Not Found"})
        )
        cmd = _cmd_by_name(github_commands, "github_pr_list")
        result = await cmd()
        assert result.error is not None
        assert result.error.code == "GITHUB_NOT_FOUND"


# ---------------------------------------------------------------------------
# github_pr_review (spec 05: pr_number, not pull_number)
# ---------------------------------------------------------------------------


class TestGithubPrReview:
    @respx.mock
    async def test_approve(self, github_commands: GitHubCommandSet) -> None:
        respx.post(f"{GH}/repos/octocat/hello-world/pulls/1/reviews").mock(
            return_value=httpx.Response(200, json=_review_json(state="APPROVED"))
        )
        cmd = _cmd_by_name(github_commands, "github_pr_review")
        result = await cmd(1, "APPROVE")
        assert result.success is True
        assert result.data["state"] == "APPROVED"

    @respx.mock
    async def test_request_changes(self, github_commands: GitHubCommandSet) -> None:
        respx.post(f"{GH}/repos/octocat/hello-world/pulls/1/reviews").mock(
            return_value=httpx.Response(
                200, json=_review_json(state="CHANGES_REQUESTED")
            )
        )
        cmd = _cmd_by_name(github_commands, "github_pr_review")
        result = await cmd(1, "REQUEST_CHANGES", body="Fix the bug")
        assert result.success is True

    @respx.mock
    async def test_comment_event(self, github_commands: GitHubCommandSet) -> None:
        respx.post(f"{GH}/repos/octocat/hello-world/pulls/1/reviews").mock(
            return_value=httpx.Response(200, json=_review_json(state="COMMENTED"))
        )
        cmd = _cmd_by_name(github_commands, "github_pr_review")
        result = await cmd(1, "COMMENT", body="Looks good")
        assert result.success is True

    @respx.mock
    async def test_invalid_event(self, github_commands: GitHubCommandSet) -> None:
        cmd = _cmd_by_name(github_commands, "github_pr_review")
        result = await cmd(1, "INVALID_EVENT")
        assert result.error is not None
        assert result.error.code == "INPUT_VALIDATION_FAILED"

    @respx.mock
    async def test_body_validation(self, github_commands: GitHubCommandSet) -> None:
        cmd = _cmd_by_name(github_commands, "github_pr_review")
        result = await cmd(1, "APPROVE", body="x" * 70_000)
        assert result.error is not None
        assert result.error.code == "INPUT_VALIDATION_FAILED"

    @respx.mock
    async def test_error_mapping(self, github_commands: GitHubCommandSet) -> None:
        respx.post(f"{GH}/repos/octocat/hello-world/pulls/999/reviews").mock(
            return_value=httpx.Response(404, json={"message": "Not Found"})
        )
        cmd = _cmd_by_name(github_commands, "github_pr_review")
        result = await cmd(999, "APPROVE")
        assert result.error.code == "GITHUB_NOT_FOUND"

    @respx.mock
    async def test_parameter_name_is_pr_number(self, github_commands: GitHubCommandSet) -> None:
        """Verify spec 05 compliance: parameter is named pr_number, not pull_number."""
        import inspect

        cmd = _cmd_by_name(github_commands, "github_pr_review")
        sig = inspect.signature(cmd)
        assert "pr_number" in sig.parameters
        assert "pull_number" not in sig.parameters


# ---------------------------------------------------------------------------
# github_search_code
# ---------------------------------------------------------------------------


class TestGithubSearchCode:
    @respx.mock
    async def test_success(self, github_commands: GitHubCommandSet) -> None:
        respx.get(f"{GH}/search/code").mock(
            return_value=httpx.Response(
                200,
                json={
                    "total_count": 1,
                    "items": [
                        {
                            "name": "foo.py",
                            "path": "src/foo.py",
                            "repository": {"full_name": "octocat/hello-world"},
                            "html_url": "https://github.com/octocat/hello-world/blob/main/src/foo.py",
                            "score": 1.5,
                        }
                    ],
                },
            )
        )
        cmd = _cmd_by_name(github_commands, "github_search_code")
        result = await cmd("def hello")
        assert result.success is True
        assert result.data["total_count"] == 1
        assert result.data["items"][0]["name"] == "foo.py"
        assert result.data["items"][0]["repo"] == "octocat/hello-world"
        assert result.data["items"][0]["url"].startswith("https://")
        assert result.data["items"][0]["score"] == 1.5

    @respx.mock
    async def test_query_validation(self, github_commands: GitHubCommandSet) -> None:
        cmd = _cmd_by_name(github_commands, "github_search_code")
        result = await cmd("x" * 300)
        assert result.error is not None
        assert result.error.code == "INPUT_VALIDATION_FAILED"

    @respx.mock
    async def test_pagination(self, github_commands: GitHubCommandSet) -> None:
        route = respx.get(f"{GH}/search/code").mock(
            return_value=httpx.Response(200, json={"total_count": 0, "items": []})
        )
        cmd = _cmd_by_name(github_commands, "github_search_code")
        await cmd("test", page=2, page_size=10)
        req = route.calls.last.request
        assert "page=2" in str(req.url)
        assert "per_page=10" in str(req.url)

    @respx.mock
    async def test_search_rate_limit(self, github_commands: GitHubCommandSet) -> None:
        # Simulate search rate limit exhaustion
        github_commands.connector._search_rate_remaining = 0
        cmd = _cmd_by_name(github_commands, "github_search_code")
        result = await cmd("test")
        assert result.error is not None
        assert result.error.code == "GITHUB_SEARCH_RATE_LIMITED"

    @respx.mock
    async def test_total_count(self, github_commands: GitHubCommandSet) -> None:
        respx.get(f"{GH}/search/code").mock(
            return_value=httpx.Response(200, json={"total_count": 42, "items": []})
        )
        cmd = _cmd_by_name(github_commands, "github_search_code")
        result = await cmd("test")
        assert result.data["total_count"] == 42

    @respx.mock
    async def test_repo_scoping(self, github_commands: GitHubCommandSet) -> None:
        route = respx.get(f"{GH}/search/code").mock(
            return_value=httpx.Response(200, json={"total_count": 0, "items": []})
        )
        cmd = _cmd_by_name(github_commands, "github_search_code")
        await cmd("def hello", repo="octocat/hello-world")
        req = route.calls.last.request
        assert "repo%3Aoctocat" in str(req.url) or "repo:octocat" in str(req.url)


# ---------------------------------------------------------------------------
# github_search_issues
# ---------------------------------------------------------------------------


class TestGithubSearchIssues:
    @respx.mock
    async def test_success(self, github_commands: GitHubCommandSet) -> None:
        respx.get(f"{GH}/search/issues").mock(
            return_value=httpx.Response(
                200,
                json={
                    "total_count": 1,
                    "items": [
                        {
                            "number": 42,
                            "title": "Bug report",
                            "state": "open",
                            "html_url": "https://github.com/octocat/hello-world/issues/42",
                            "repository_url": "https://api.github.com/repos/octocat/hello-world",
                        }
                    ],
                },
            )
        )
        cmd = _cmd_by_name(github_commands, "github_search_issues")
        result = await cmd("bug")
        assert result.success is True
        assert result.data["total_count"] == 1
        assert result.data["items"][0]["number"] == 42
        assert result.data["items"][0]["repo"] == "octocat/hello-world"
        assert result.data["items"][0]["url"].startswith("https://")

    @respx.mock
    async def test_query_validation(self, github_commands: GitHubCommandSet) -> None:
        cmd = _cmd_by_name(github_commands, "github_search_issues")
        result = await cmd("x" * 300)
        assert result.error is not None
        assert result.error.code == "INPUT_VALIDATION_FAILED"

    @respx.mock
    async def test_pagination(self, github_commands: GitHubCommandSet) -> None:
        route = respx.get(f"{GH}/search/issues").mock(
            return_value=httpx.Response(200, json={"total_count": 0, "items": []})
        )
        cmd = _cmd_by_name(github_commands, "github_search_issues")
        await cmd("test", page=3, page_size=15)
        req = route.calls.last.request
        assert "page=3" in str(req.url)
        assert "per_page=15" in str(req.url)

    @respx.mock
    async def test_search_rate_limit(self, github_commands: GitHubCommandSet) -> None:
        github_commands.connector._search_rate_remaining = 0
        cmd = _cmd_by_name(github_commands, "github_search_issues")
        result = await cmd("test")
        assert result.error is not None
        assert result.error.code == "GITHUB_SEARCH_RATE_LIMITED"

    @respx.mock
    async def test_total_count(self, github_commands: GitHubCommandSet) -> None:
        respx.get(f"{GH}/search/issues").mock(
            return_value=httpx.Response(200, json={"total_count": 99, "items": []})
        )
        cmd = _cmd_by_name(github_commands, "github_search_issues")
        result = await cmd("test")
        assert result.data["total_count"] == 99

    @respx.mock
    async def test_repo_scoping(self, github_commands: GitHubCommandSet) -> None:
        route = respx.get(f"{GH}/search/issues").mock(
            return_value=httpx.Response(200, json={"total_count": 0, "items": []})
        )
        cmd = _cmd_by_name(github_commands, "github_search_issues")
        await cmd("bug", repo="octocat/hello-world")
        req = route.calls.last.request
        assert "repo%3Aoctocat" in str(req.url) or "repo:octocat" in str(req.url)

    @respx.mock
    async def test_state_scoping(self, github_commands: GitHubCommandSet) -> None:
        route = respx.get(f"{GH}/search/issues").mock(
            return_value=httpx.Response(200, json={"total_count": 0, "items": []})
        )
        cmd = _cmd_by_name(github_commands, "github_search_issues")
        await cmd("bug", state="closed")
        req = route.calls.last.request
        assert "state%3Aclosed" in str(req.url) or "state:closed" in str(req.url)


# ---------------------------------------------------------------------------
# Result mappers
# ---------------------------------------------------------------------------


class TestResultMappers:
    def test_map_issue_handles_missing_fields(self) -> None:
        result = _map_issue({})
        assert result["number"] == 0
        assert result["user"] == ""
        assert result["labels"] == []
        assert result["url"] == ""

    def test_map_pr_handles_missing_fields(self) -> None:
        result = _map_pr({})
        assert result["number"] == 0
        assert result["head"] == ""
        assert result["draft"] is False
        assert result["merged"] is False
        assert result["url"] == ""

    def test_map_comment_handles_missing_fields(self) -> None:
        result = _map_comment({})
        assert result["id"] == 0
        assert result["body"] == ""
        assert result["user"] == ""
        assert result["url"] == ""

    def test_map_review_handles_missing_fields(self) -> None:
        result = _map_review({})
        assert result["id"] == 0
        assert result["state"] == ""
        assert result["body"] == ""
        assert result["url"] == ""

    def test_map_issue_full(self) -> None:
        raw = _issue_json(42, title="My Issue")
        result = _map_issue(raw)
        assert result["number"] == 42
        assert result["title"] == "My Issue"
        assert result["user"] == "octocat"
        assert result["labels"] == ["bug"]
        assert result["url"] == raw["html_url"]

    def test_map_pr_full(self) -> None:
        raw = _pr_json(10, title="My PR", draft=True, merged=True)
        result = _map_pr(raw)
        assert result["number"] == 10
        assert result["title"] == "My PR"
        assert result["draft"] is True
        assert result["merged"] is True
        assert result["head"] == "feature"
        assert result["base"] == "main"
        assert result["url"] == raw["html_url"]

    def test_map_issue_null_user(self) -> None:
        """GitHub returns null user for system-generated events."""
        result = _map_issue({"user": None})
        assert result["user"] == ""

    def test_map_pr_null_head_base(self) -> None:
        """Null head/base refs should not crash."""
        result = _map_pr({"head": None, "base": None})
        assert result["head"] == ""
        assert result["base"] == ""
