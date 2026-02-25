"""GitHub connector for interacting with GitHub via the gh CLI.

SECURITY: This connector NEVER logs stdout to prevent token exposure.

Example:
    >>> from afd.connectors.github import GitHubConnector
    >>> gh = GitHubConnector(GitHubConnectorOptions(debug=True))
    >>> issues = await gh.issue_list("owner/repo", IssueFilters(state="open"))
"""

import json
from typing import Literal, Optional

from pydantic import BaseModel, Field

from afd.platform import ExecOptions, exec_command, is_exec_error


# ═══════════════════════════════════════════════════════════════════════════════
# TYPES
# ═══════════════════════════════════════════════════════════════════════════════


class IssueCreateOptions(BaseModel):
    """Options for creating a GitHub issue.

    Attributes:
        title: Issue title.
        body: Issue body/description.
        repo: Repository in owner/repo format (uses current repo if not specified).
        labels: Labels to apply to the issue.
        project: Project to add the issue to.
    """

    title: str
    body: str
    repo: Optional[str] = None
    labels: Optional[list[str]] = None
    project: Optional[str] = None


class IssueFilters(BaseModel):
    """Filters for listing GitHub issues.

    Attributes:
        state: Filter by state (open, closed, all).
        label: Filter by label.
        assignee: Filter by assignee.
        limit: Maximum number of issues to return.
    """

    state: Optional[Literal["open", "closed", "all"]] = None
    label: Optional[str] = None
    assignee: Optional[str] = None
    limit: Optional[int] = Field(default=None, gt=0)


class Issue(BaseModel):
    """Represents a GitHub issue.

    Attributes:
        number: Issue number.
        title: Issue title.
        state: Issue state (open or closed).
        url: URL to the issue.
    """

    number: int
    title: str
    state: Literal["open", "closed"]
    url: str


class PrCreateOptions(BaseModel):
    """Options for creating a GitHub pull request.

    Attributes:
        title: PR title.
        body: PR body/description.
        head: Source branch.
        base: Target branch (defaults to default branch).
        draft: Create as draft PR.
    """

    title: str
    body: str
    head: str
    base: Optional[str] = None
    draft: bool = False


class PullRequest(BaseModel):
    """Represents a GitHub pull request.

    Attributes:
        number: PR number.
        title: PR title.
        state: PR state (open, closed, or merged).
        url: URL to the PR.
    """

    number: int
    title: str
    state: Literal["open", "closed", "merged"]
    url: str


class GitHubConnectorOptions(BaseModel):
    """Options for GitHubConnector.

    Attributes:
        debug: Enable debug logging of commands (never logs stdout for security).
    """

    debug: bool = False


# ═══════════════════════════════════════════════════════════════════════════════
# GITHUB CONNECTOR
# ═══════════════════════════════════════════════════════════════════════════════


class GitHubConnector:
    """Connector for interacting with GitHub via the gh CLI.

    SECURITY: This connector NEVER logs stdout to prevent accidental
    exposure of tokens or sensitive data from gh CLI output.

    Example:
        >>> gh = GitHubConnector(GitHubConnectorOptions(debug=True))
        >>>
        >>> # Create an issue
        >>> issue_num = await gh.issue_create(IssueCreateOptions(
        ...     title="Bug report",
        ...     body="Description of the bug",
        ...     labels=["bug"],
        ... ))
        >>>
        >>> # List issues
        >>> issues = await gh.issue_list("owner/repo", IssueFilters(state="open", limit=10))
    """

    def __init__(self, options: Optional[GitHubConnectorOptions] = None) -> None:
        self._options = options

    async def issue_create(self, opts: IssueCreateOptions) -> int:
        """Create a new GitHub issue.

        Args:
            opts: Issue creation options.

        Returns:
            Issue number on success.

        Raises:
            RuntimeError: If the gh command fails or output cannot be parsed.

        Example:
            >>> num = await gh.issue_create(IssueCreateOptions(
            ...     title="Bug", body="Details"
            ... ))
        """
        cmd: list[str] = ["gh", "issue", "create", "--title", opts.title, "--body", opts.body]

        if opts.repo:
            cmd.extend(["--repo", opts.repo])

        if opts.labels:
            for label in opts.labels:
                cmd.extend(["--label", label])

        if opts.project:
            cmd.extend(["--project", opts.project])

        result = await self._exec_gh(cmd)

        if is_exec_error(result):
            raise RuntimeError(f"Failed to create issue: {result.stderr or result.error_code}")

        # Parse issue number from URL (e.g., https://github.com/owner/repo/issues/123)
        import re

        match = re.search(r"/issues/(\d+)", result.stdout)
        if not match:
            raise RuntimeError("Could not parse issue number from gh output")

        return int(match.group(1))

    async def issue_list(
        self, repo: str, filters: Optional[IssueFilters] = None
    ) -> list[Issue]:
        """List issues from a repository.

        Args:
            repo: Repository in owner/repo format.
            filters: Optional filters for state, label, assignee, limit.

        Returns:
            List of Issue objects.

        Raises:
            RuntimeError: If the gh command fails.

        Example:
            >>> issues = await gh.issue_list("owner/repo", IssueFilters(state="open"))
        """
        cmd: list[str] = [
            "gh", "issue", "list",
            "--repo", repo,
            "--json", "number,title,state,url",
        ]

        if filters:
            if filters.state:
                cmd.extend(["--state", filters.state])
            if filters.label:
                cmd.extend(["--label", filters.label])
            if filters.assignee:
                cmd.extend(["--assignee", filters.assignee])
            if filters.limit:
                cmd.extend(["--limit", str(filters.limit)])

        result = await self._exec_gh(cmd)

        if is_exec_error(result):
            raise RuntimeError(f"Failed to list issues: {result.stderr or result.error_code}")

        raw_issues = json.loads(result.stdout)

        return [
            Issue(
                number=issue["number"],
                title=issue["title"],
                state=issue["state"].lower(),
                url=issue["url"],
            )
            for issue in raw_issues
        ]

    async def pr_create(self, opts: PrCreateOptions) -> int:
        """Create a new pull request.

        Args:
            opts: PR creation options.

        Returns:
            PR number on success.

        Raises:
            RuntimeError: If the gh command fails or output cannot be parsed.

        Example:
            >>> num = await gh.pr_create(PrCreateOptions(
            ...     title="Fix bug", body="Details", head="feature-branch"
            ... ))
        """
        cmd: list[str] = [
            "gh", "pr", "create",
            "--title", opts.title,
            "--body", opts.body,
            "--head", opts.head,
        ]

        if opts.base:
            cmd.extend(["--base", opts.base])

        if opts.draft:
            cmd.append("--draft")

        result = await self._exec_gh(cmd)

        if is_exec_error(result):
            raise RuntimeError(f"Failed to create PR: {result.stderr or result.error_code}")

        # Parse PR number from URL (e.g., https://github.com/owner/repo/pull/123)
        import re

        match = re.search(r"/pull/(\d+)", result.stdout)
        if not match:
            raise RuntimeError("Could not parse PR number from gh output")

        return int(match.group(1))

    async def pr_list(
        self, repo: str, filters: Optional[IssueFilters] = None
    ) -> list[PullRequest]:
        """List pull requests from a repository.

        Args:
            repo: Repository in owner/repo format.
            filters: Optional filters (reuses IssueFilters for similar fields).

        Returns:
            List of PullRequest objects.

        Raises:
            RuntimeError: If the gh command fails.

        Example:
            >>> prs = await gh.pr_list("owner/repo", IssueFilters(state="open"))
        """
        cmd: list[str] = [
            "gh", "pr", "list",
            "--repo", repo,
            "--json", "number,title,state,url",
        ]

        if filters:
            if filters.state:
                cmd.extend(["--state", filters.state])
            if filters.label:
                cmd.extend(["--label", filters.label])
            if filters.assignee:
                cmd.extend(["--assignee", filters.assignee])
            if filters.limit:
                cmd.extend(["--limit", str(filters.limit)])

        result = await self._exec_gh(cmd)

        if is_exec_error(result):
            raise RuntimeError(f"Failed to list PRs: {result.stderr or result.error_code}")

        raw_prs = json.loads(result.stdout)

        return [
            PullRequest(
                number=pr["number"],
                title=pr["title"],
                state=pr["state"].lower(),
                url=pr["url"],
            )
            for pr in raw_prs
        ]

    async def _exec_gh(self, cmd: list[str]) -> "ExecResult":
        """Execute a gh command.

        SECURITY: Only passes debug flag for command logging, never logs stdout.
        """
        from afd.platform import ExecResult

        exec_opts = ExecOptions()
        if self._options and self._options.debug:
            exec_opts.debug = True
        return await exec_command(cmd, exec_opts)
