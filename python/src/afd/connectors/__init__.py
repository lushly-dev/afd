"""Connector abstractions for external services.

Provides typed interfaces for interacting with GitHub and package managers.

Example:
    >>> from afd.connectors import GitHubConnector, PackageManagerConnector
    >>> gh = GitHubConnector()
    >>> pm = PackageManagerConnector("pnpm")
"""

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
    PackageManager,
    PackageManagerConnector,
    PackageManagerConnectorOptions,
)

__all__ = [
    # GitHub
    "GitHubConnector",
    "GitHubConnectorOptions",
    "Issue",
    "IssueCreateOptions",
    "IssueFilters",
    "PrCreateOptions",
    "PullRequest",
    # Package manager
    "PackageManager",
    "PackageManagerConnector",
    "PackageManagerConnectorOptions",
]
