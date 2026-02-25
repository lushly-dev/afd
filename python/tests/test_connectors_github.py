"""Tests for afd.connectors.github module."""

import json
from unittest.mock import patch

import pytest

from afd.connectors.github import (
    GitHubConnector,
    GitHubConnectorOptions,
    Issue,
    IssueCreateOptions,
    IssueFilters,
    PrCreateOptions,
    PullRequest,
)
from afd.platform import ExecErrorCode, ExecResult, create_exec_result


# ═══════════════════════════════════════════════════════════════════════════════
# GITHUB CONNECTOR TYPES
# ═══════════════════════════════════════════════════════════════════════════════


class TestGitHubTypes:
    """Tests for GitHub connector Pydantic models."""

    def test_issue_create_options_required_fields(self):
        opts = IssueCreateOptions(title="Bug", body="Description")
        assert opts.title == "Bug"
        assert opts.body == "Description"
        assert opts.repo is None
        assert opts.labels is None

    def test_issue_create_options_all_fields(self):
        opts = IssueCreateOptions(
            title="Bug",
            body="Description",
            repo="owner/repo",
            labels=["bug", "urgent"],
            project="backlog",
        )
        assert opts.repo == "owner/repo"
        assert opts.labels == ["bug", "urgent"]
        assert opts.project == "backlog"

    def test_issue_filters_defaults(self):
        filters = IssueFilters()
        assert filters.state is None
        assert filters.label is None
        assert filters.assignee is None
        assert filters.limit is None

    def test_issue_filters_custom(self):
        filters = IssueFilters(state="open", label="bug", assignee="user1", limit=10)
        assert filters.state == "open"
        assert filters.limit == 10

    def test_issue_filters_limit_must_be_positive(self):
        with pytest.raises(Exception):
            IssueFilters(limit=0)

    def test_issue_model(self):
        issue = Issue(number=42, title="Bug report", state="open", url="https://github.com/o/r/issues/42")
        assert issue.number == 42
        assert issue.state == "open"

    def test_pr_create_options(self):
        opts = PrCreateOptions(title="Fix", body="Details", head="feature")
        assert opts.title == "Fix"
        assert opts.head == "feature"
        assert opts.base is None
        assert opts.draft is False

    def test_pr_create_options_draft(self):
        opts = PrCreateOptions(title="WIP", body="Work in progress", head="feat", draft=True)
        assert opts.draft is True

    def test_pull_request_model(self):
        pr = PullRequest(number=10, title="Fix bug", state="merged", url="https://github.com/o/r/pull/10")
        assert pr.number == 10
        assert pr.state == "merged"


# ═══════════════════════════════════════════════════════════════════════════════
# GITHUB CONNECTOR
# ═══════════════════════════════════════════════════════════════════════════════


class TestGitHubConnector:
    """Tests for GitHubConnector using mocked exec_command."""

    def _mock_exec(self, stdout="", stderr="", exit_code=0, error_code=None):
        """Create a mock exec_command that returns a fixed result."""
        result = create_exec_result(stdout, stderr, exit_code, 10.0, error_code)

        async def mock_fn(cmd, opts=None):
            return result

        return mock_fn

    async def test_issue_create_success(self):
        gh = GitHubConnector()
        mock = self._mock_exec(stdout="https://github.com/owner/repo/issues/42\n")

        with patch("afd.connectors.github.exec_command", side_effect=mock):
            num = await gh.issue_create(IssueCreateOptions(title="Bug", body="Details"))
            assert num == 42

    async def test_issue_create_with_labels_and_repo(self):
        gh = GitHubConnector()
        captured_cmds = []

        async def capture_exec(cmd, opts=None):
            captured_cmds.append(cmd)
            return create_exec_result("https://github.com/o/r/issues/1", "", 0, 10.0)

        with patch("afd.connectors.github.exec_command", side_effect=capture_exec):
            await gh.issue_create(IssueCreateOptions(
                title="Bug", body="Details", repo="owner/repo", labels=["bug", "p1"]
            ))

        cmd = captured_cmds[0]
        assert "--repo" in cmd
        assert "owner/repo" in cmd
        assert cmd.count("--label") == 2

    async def test_issue_create_failure(self):
        gh = GitHubConnector()
        mock = self._mock_exec(stderr="auth error", exit_code=1, error_code=ExecErrorCode.EXIT_CODE)

        with patch("afd.connectors.github.exec_command", side_effect=mock):
            with pytest.raises(RuntimeError, match="Failed to create issue"):
                await gh.issue_create(IssueCreateOptions(title="Bug", body="Details"))

    async def test_issue_create_unparseable_output(self):
        gh = GitHubConnector()
        mock = self._mock_exec(stdout="no url here")

        with patch("afd.connectors.github.exec_command", side_effect=mock):
            with pytest.raises(RuntimeError, match="Could not parse issue number"):
                await gh.issue_create(IssueCreateOptions(title="Bug", body="Details"))

    async def test_issue_list_success(self):
        gh = GitHubConnector()
        issues_json = json.dumps([
            {"number": 1, "title": "Bug A", "state": "OPEN", "url": "https://github.com/o/r/issues/1"},
            {"number": 2, "title": "Bug B", "state": "CLOSED", "url": "https://github.com/o/r/issues/2"},
        ])
        mock = self._mock_exec(stdout=issues_json)

        with patch("afd.connectors.github.exec_command", side_effect=mock):
            issues = await gh.issue_list("owner/repo")
            assert len(issues) == 2
            assert issues[0].number == 1
            assert issues[0].state == "open"
            assert issues[1].state == "closed"

    async def test_issue_list_with_filters(self):
        gh = GitHubConnector()
        captured_cmds = []

        async def capture_exec(cmd, opts=None):
            captured_cmds.append(cmd)
            return create_exec_result("[]", "", 0, 10.0)

        with patch("afd.connectors.github.exec_command", side_effect=capture_exec):
            await gh.issue_list(
                "owner/repo",
                IssueFilters(state="open", label="bug", assignee="user1", limit=5),
            )

        cmd = captured_cmds[0]
        assert "--state" in cmd
        assert "open" in cmd
        assert "--label" in cmd
        assert "--assignee" in cmd
        assert "--limit" in cmd
        assert "5" in cmd

    async def test_issue_list_failure(self):
        gh = GitHubConnector()
        mock = self._mock_exec(stderr="not found", exit_code=1, error_code=ExecErrorCode.EXIT_CODE)

        with patch("afd.connectors.github.exec_command", side_effect=mock):
            with pytest.raises(RuntimeError, match="Failed to list issues"):
                await gh.issue_list("owner/repo")

    async def test_pr_create_success(self):
        gh = GitHubConnector()
        mock = self._mock_exec(stdout="https://github.com/owner/repo/pull/7\n")

        with patch("afd.connectors.github.exec_command", side_effect=mock):
            num = await gh.pr_create(PrCreateOptions(title="Fix", body="Details", head="feature"))
            assert num == 7

    async def test_pr_create_with_draft(self):
        gh = GitHubConnector()
        captured_cmds = []

        async def capture_exec(cmd, opts=None):
            captured_cmds.append(cmd)
            return create_exec_result("https://github.com/o/r/pull/1", "", 0, 10.0)

        with patch("afd.connectors.github.exec_command", side_effect=capture_exec):
            await gh.pr_create(PrCreateOptions(
                title="WIP", body="WIP", head="feat", base="main", draft=True
            ))

        cmd = captured_cmds[0]
        assert "--draft" in cmd
        assert "--base" in cmd
        assert "main" in cmd

    async def test_pr_create_failure(self):
        gh = GitHubConnector()
        mock = self._mock_exec(stderr="error", exit_code=1, error_code=ExecErrorCode.EXIT_CODE)

        with patch("afd.connectors.github.exec_command", side_effect=mock):
            with pytest.raises(RuntimeError, match="Failed to create PR"):
                await gh.pr_create(PrCreateOptions(title="Fix", body="X", head="feat"))

    async def test_pr_list_success(self):
        gh = GitHubConnector()
        prs_json = json.dumps([
            {"number": 5, "title": "Feature", "state": "OPEN", "url": "https://github.com/o/r/pull/5"},
        ])
        mock = self._mock_exec(stdout=prs_json)

        with patch("afd.connectors.github.exec_command", side_effect=mock):
            prs = await gh.pr_list("owner/repo")
            assert len(prs) == 1
            assert prs[0].number == 5
            assert prs[0].state == "open"

    async def test_pr_list_state_all_passes_flag(self):
        gh = GitHubConnector()
        captured_cmds = []

        async def capture_exec(cmd, opts=None):
            captured_cmds.append(cmd)
            return create_exec_result("[]", "", 0, 10.0)

        with patch("afd.connectors.github.exec_command", side_effect=capture_exec):
            await gh.pr_list("owner/repo", IssueFilters(state="all"))

        assert "--state" in captured_cmds[0]
        state_idx = captured_cmds[0].index("--state")
        assert captured_cmds[0][state_idx + 1] == "all"

    async def test_pr_list_failure(self):
        gh = GitHubConnector()
        mock = self._mock_exec(stderr="error", exit_code=1, error_code=ExecErrorCode.EXIT_CODE)

        with patch("afd.connectors.github.exec_command", side_effect=mock):
            with pytest.raises(RuntimeError, match="Failed to list PRs"):
                await gh.pr_list("owner/repo")

    async def test_debug_option_passed_through(self):
        gh = GitHubConnector(GitHubConnectorOptions(debug=True))
        captured_opts = []

        async def capture_exec(cmd, opts=None):
            captured_opts.append(opts)
            return create_exec_result("[]", "", 0, 10.0)

        with patch("afd.connectors.github.exec_command", side_effect=capture_exec):
            await gh.issue_list("owner/repo")

        assert captured_opts[0].debug is True


# ═══════════════════════════════════════════════════════════════════════════════
# ROOT IMPORTS
# ═══════════════════════════════════════════════════════════════════════════════


class TestGitHubRootImports:
    """Tests that GitHub connectors are importable from package root."""

    def test_github_importable(self):
        from afd import GitHubConnector, GitHubConnectorOptions, Issue, IssueCreateOptions, IssueFilters
        assert GitHubConnector is not None
        assert IssueCreateOptions is not None

    def test_pr_types_importable(self):
        from afd import PrCreateOptions, PullRequest
        assert PrCreateOptions is not None
        assert PullRequest is not None
