"""Tests for afd.connectors module."""

import json
import os
from pathlib import Path
from unittest.mock import AsyncMock, patch

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
from afd.connectors.package_manager import (
    Dependency,
    PackageManager,
    PackageManagerConnector,
    PackageManagerConnectorOptions,
    detect_package_manager,
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
# PACKAGE MANAGER TYPES
# ═══════════════════════════════════════════════════════════════════════════════


class TestPackageManagerTypes:
    """Tests for package manager Pydantic models."""

    def test_dependency_model(self):
        dep = Dependency(name="lodash", version="4.17.21")
        assert dep.name == "lodash"
        assert dep.version == "4.17.21"

    def test_connector_options_defaults(self):
        opts = PackageManagerConnectorOptions()
        assert opts.debug is False
        assert opts.cwd is None

    def test_connector_options_custom(self):
        opts = PackageManagerConnectorOptions(debug=True, cwd="/project")
        assert opts.debug is True
        assert opts.cwd == "/project"


# ═══════════════════════════════════════════════════════════════════════════════
# DETECT PACKAGE MANAGER
# ═══════════════════════════════════════════════════════════════════════════════


class TestDetectPackageManager:
    """Tests for detect_package_manager() across ecosystems."""

    async def test_detects_pnpm_from_lockfile(self, tmp_path):
        (tmp_path / "pnpm-lock.yaml").write_text("")
        result = await detect_package_manager(str(tmp_path))
        assert result == "pnpm"

    async def test_detects_npm_from_lockfile(self, tmp_path):
        (tmp_path / "package-lock.json").write_text("{}")
        result = await detect_package_manager(str(tmp_path))
        assert result == "npm"

    async def test_detects_uv_from_lockfile(self, tmp_path):
        (tmp_path / "uv.lock").write_text("")
        result = await detect_package_manager(str(tmp_path))
        assert result == "uv"

    async def test_detects_pip_from_requirements(self, tmp_path):
        (tmp_path / "requirements.txt").write_text("pydantic>=2.0\n")
        result = await detect_package_manager(str(tmp_path))
        assert result == "pip"

    async def test_detects_pip_from_setup_py(self, tmp_path):
        (tmp_path / "setup.py").write_text("from setuptools import setup\n")
        result = await detect_package_manager(str(tmp_path))
        assert result == "pip"

    async def test_detects_cargo_from_lockfile(self, tmp_path):
        (tmp_path / "Cargo.lock").write_text("")
        result = await detect_package_manager(str(tmp_path))
        assert result == "cargo"

    async def test_pnpm_takes_precedence_over_npm(self, tmp_path):
        (tmp_path / "pnpm-lock.yaml").write_text("")
        (tmp_path / "package-lock.json").write_text("{}")
        result = await detect_package_manager(str(tmp_path))
        assert result == "pnpm"

    async def test_returns_none_for_empty_dir_with_no_cli(self, tmp_path):
        # Mock all CLI checks to fail
        async def mock_exec_fail(cmd, opts=None):
            return create_exec_result("", "not found", 1, 0.0, ExecErrorCode.SPAWN_FAILED)

        with patch("afd.connectors.package_manager.exec_command", side_effect=mock_exec_fail):
            result = await detect_package_manager(str(tmp_path))
            assert result is None


# ═══════════════════════════════════════════════════════════════════════════════
# PACKAGE MANAGER CONNECTOR
# ═══════════════════════════════════════════════════════════════════════════════


class TestPackageManagerConnector:
    """Tests for PackageManagerConnector operations."""

    def _mock_exec(self, stdout="", stderr="", exit_code=0, error_code=None):
        result = create_exec_result(stdout, stderr, exit_code, 10.0, error_code)

        async def mock_fn(cmd, opts=None):
            return result

        return mock_fn

    def test_pm_property(self):
        pm = PackageManagerConnector("pnpm")
        assert pm.pm == "pnpm"

    def test_default_pm_is_npm(self):
        pm = PackageManagerConnector()
        assert pm.pm == "npm"

    async def test_install_all_npm(self):
        pm = PackageManagerConnector("npm")
        captured_cmds = []

        async def capture(cmd, opts=None):
            captured_cmds.append(cmd)
            return create_exec_result("", "", 0, 10.0)

        with patch("afd.connectors.package_manager.exec_command", side_effect=capture):
            await pm.install()

        assert captured_cmds[0] == ["npm", "install"]

    async def test_install_package_pnpm(self):
        pm = PackageManagerConnector("pnpm")
        captured_cmds = []

        async def capture(cmd, opts=None):
            captured_cmds.append(cmd)
            return create_exec_result("", "", 0, 10.0)

        with patch("afd.connectors.package_manager.exec_command", side_effect=capture):
            await pm.install("lodash")

        assert captured_cmds[0] == ["pnpm", "install", "lodash"]

    async def test_install_dev_npm(self):
        pm = PackageManagerConnector("npm")
        captured_cmds = []

        async def capture(cmd, opts=None):
            captured_cmds.append(cmd)
            return create_exec_result("", "", 0, 10.0)

        with patch("afd.connectors.package_manager.exec_command", side_effect=capture):
            await pm.install("vitest", dev=True)

        assert "--save-dev" in captured_cmds[0]

    async def test_install_pip(self):
        pm = PackageManagerConnector("pip")
        captured_cmds = []

        async def capture(cmd, opts=None):
            captured_cmds.append(cmd)
            return create_exec_result("", "", 0, 10.0)

        with patch("afd.connectors.package_manager.exec_command", side_effect=capture):
            await pm.install("pydantic")

        assert captured_cmds[0] == ["pip", "install", "pydantic"]

    async def test_install_all_pip(self):
        pm = PackageManagerConnector("pip")
        captured_cmds = []

        async def capture(cmd, opts=None):
            captured_cmds.append(cmd)
            return create_exec_result("", "", 0, 10.0)

        with patch("afd.connectors.package_manager.exec_command", side_effect=capture):
            await pm.install()

        assert captured_cmds[0] == ["pip", "install", "-r", "requirements.txt"]

    async def test_install_uv(self):
        pm = PackageManagerConnector("uv")
        captured_cmds = []

        async def capture(cmd, opts=None):
            captured_cmds.append(cmd)
            return create_exec_result("", "", 0, 10.0)

        with patch("afd.connectors.package_manager.exec_command", side_effect=capture):
            await pm.install("httpx")

        assert captured_cmds[0] == ["uv", "pip", "install", "httpx"]

    async def test_install_cargo(self):
        pm = PackageManagerConnector("cargo")
        captured_cmds = []

        async def capture(cmd, opts=None):
            captured_cmds.append(cmd)
            return create_exec_result("", "", 0, 10.0)

        with patch("afd.connectors.package_manager.exec_command", side_effect=capture):
            await pm.install("serde")

        assert captured_cmds[0] == ["cargo", "add", "serde"]

    async def test_add_npm(self):
        pm = PackageManagerConnector("npm")
        captured_cmds = []

        async def capture(cmd, opts=None):
            captured_cmds.append(cmd)
            return create_exec_result("", "", 0, 10.0)

        with patch("afd.connectors.package_manager.exec_command", side_effect=capture):
            await pm.add("lodash", dev=True)

        assert captured_cmds[0] == ["npm", "add", "lodash", "--save-dev"]

    async def test_remove_pnpm(self):
        pm = PackageManagerConnector("pnpm")
        captured_cmds = []

        async def capture(cmd, opts=None):
            captured_cmds.append(cmd)
            return create_exec_result("", "", 0, 10.0)

        with patch("afd.connectors.package_manager.exec_command", side_effect=capture):
            await pm.remove("lodash")

        assert captured_cmds[0] == ["pnpm", "remove", "lodash"]

    async def test_remove_pip(self):
        pm = PackageManagerConnector("pip")
        captured_cmds = []

        async def capture(cmd, opts=None):
            captured_cmds.append(cmd)
            return create_exec_result("", "", 0, 10.0)

        with patch("afd.connectors.package_manager.exec_command", side_effect=capture):
            await pm.remove("requests")

        assert captured_cmds[0] == ["pip", "uninstall", "-y", "requests"]

    async def test_list_deps_npm(self):
        pm = PackageManagerConnector("npm")
        deps_json = json.dumps({
            "dependencies": {
                "lodash": {"version": "4.17.21"},
                "express": {"version": "4.18.2"},
            }
        })
        mock = self._mock_exec(stdout=deps_json)

        with patch("afd.connectors.package_manager.exec_command", side_effect=mock):
            deps = await pm.list_deps()
            assert len(deps) == 2
            names = {d.name for d in deps}
            assert "lodash" in names
            assert "express" in names

    async def test_list_deps_pip(self):
        pm = PackageManagerConnector("pip")
        deps_json = json.dumps([
            {"name": "pydantic", "version": "2.6.0"},
            {"name": "httpx", "version": "0.27.0"},
        ])
        mock = self._mock_exec(stdout=deps_json)

        with patch("afd.connectors.package_manager.exec_command", side_effect=mock):
            deps = await pm.list_deps()
            assert len(deps) == 2
            assert deps[0].name == "pydantic"
            assert deps[0].version == "2.6.0"

    async def test_list_deps_uv(self):
        pm = PackageManagerConnector("uv")
        deps_json = json.dumps([
            {"name": "click", "version": "8.1.7"},
        ])
        mock = self._mock_exec(stdout=deps_json)

        with patch("afd.connectors.package_manager.exec_command", side_effect=mock):
            deps = await pm.list_deps()
            assert len(deps) == 1
            assert deps[0].name == "click"

    async def test_list_deps_cargo(self):
        pm = PackageManagerConnector("cargo")
        metadata = json.dumps({
            "packages": [
                {"name": "serde", "version": "1.0.200"},
            ]
        })
        mock = self._mock_exec(stdout=metadata)

        with patch("afd.connectors.package_manager.exec_command", side_effect=mock):
            deps = await pm.list_deps()
            assert len(deps) == 1
            assert deps[0].name == "serde"

    async def test_list_deps_failure(self):
        pm = PackageManagerConnector("npm")
        mock = self._mock_exec(stderr="error", exit_code=1, error_code=ExecErrorCode.EXIT_CODE)

        with patch("afd.connectors.package_manager.exec_command", side_effect=mock):
            with pytest.raises(RuntimeError, match="Failed to list dependencies"):
                await pm.list_deps()

    async def test_run_npm(self):
        pm = PackageManagerConnector("npm")
        captured_cmds = []

        async def capture(cmd, opts=None):
            captured_cmds.append(cmd)
            return create_exec_result("", "", 0, 10.0)

        with patch("afd.connectors.package_manager.exec_command", side_effect=capture):
            await pm.run("build")

        assert captured_cmds[0] == ["npm", "run", "build"]

    async def test_run_not_supported_for_pip(self):
        pm = PackageManagerConnector("pip")
        with pytest.raises(RuntimeError, match="not supported"):
            await pm.run("build")

    def test_is_success_true(self):
        pm = PackageManagerConnector("npm")
        result = create_exec_result("ok", "", 0, 10.0)
        assert pm.is_success(result) is True

    def test_is_success_false(self):
        pm = PackageManagerConnector("npm")
        result = create_exec_result("", "fail", 1, 10.0, ExecErrorCode.EXIT_CODE)
        assert pm.is_success(result) is False

    async def test_cwd_option_passed_through(self):
        pm = PackageManagerConnector("npm", PackageManagerConnectorOptions(cwd="/project"))
        captured_opts = []

        async def capture(cmd, opts=None):
            captured_opts.append(opts)
            return create_exec_result("", "", 0, 10.0)

        with patch("afd.connectors.package_manager.exec_command", side_effect=capture):
            await pm.install()

        assert captured_opts[0].cwd == "/project"

    async def test_debug_option_passed_through(self):
        pm = PackageManagerConnector("npm", PackageManagerConnectorOptions(debug=True))
        captured_opts = []

        async def capture(cmd, opts=None):
            captured_opts.append(opts)
            return create_exec_result("", "", 0, 10.0)

        with patch("afd.connectors.package_manager.exec_command", side_effect=capture):
            await pm.install()

        assert captured_opts[0].debug is True


# ═══════════════════════════════════════════════════════════════════════════════
# ROOT IMPORTS
# ═══════════════════════════════════════════════════════════════════════════════


class TestConnectorRootImports:
    """Tests that connectors are importable from package root."""

    def test_github_importable(self):
        from afd import GitHubConnector, GitHubConnectorOptions, Issue, IssueCreateOptions, IssueFilters
        assert GitHubConnector is not None
        assert IssueCreateOptions is not None

    def test_pr_types_importable(self):
        from afd import PrCreateOptions, PullRequest
        assert PrCreateOptions is not None
        assert PullRequest is not None

    def test_package_manager_importable(self):
        from afd import PackageManagerConnector, PackageManagerConnectorOptions
        assert PackageManagerConnector is not None

    def test_detection_importable(self):
        from afd import detect_package_manager, Dependency
        assert callable(detect_package_manager)
        assert Dependency is not None
