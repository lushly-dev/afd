//! Shared connector-facing types for Rust parity.

use serde::{Deserialize, Serialize};

/// Options for creating a GitHub issue.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IssueCreateOptions {
    /// Issue title.
    pub title: String,
    /// Issue body markdown.
    pub body: String,
    /// Target repository (`owner/name`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo: Option<String>,
    /// Labels to apply.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub labels: Option<Vec<String>>,
    /// Project name or identifier to attach.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project: Option<String>,
}

/// Filters for listing issues.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct IssueFilters {
    /// Issue state filter.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<IssueListState>,
    /// Required label name.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    /// Required assignee login.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assignee: Option<String>,
    /// Maximum number of issues to return.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
}

/// Issue list state filter.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum IssueListState {
    /// Only open issues.
    Open,
    /// Only closed issues.
    Closed,
    /// Both open and closed issues.
    All,
}

/// Represents a GitHub issue.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    /// Issue number.
    pub number: u32,
    /// Issue title.
    pub title: String,
    /// Current issue state.
    pub state: IssueState,
    /// Web URL of the issue.
    pub url: String,
}

/// Issue state.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum IssueState {
    /// Open issue.
    Open,
    /// Closed issue.
    Closed,
}

/// Options for creating a pull request.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PrCreateOptions {
    /// Pull request title.
    pub title: String,
    /// Pull request description markdown.
    pub body: String,
    /// Source branch name.
    pub head: String,
    /// Target base branch name.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base: Option<String>,
    /// Whether to open as a draft pull request.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub draft: Option<bool>,
}

/// Represents a pull request.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequest {
    /// Pull request number.
    pub number: u32,
    /// Pull request title.
    pub title: String,
    /// Current pull request state.
    pub state: PullRequestState,
    /// Web URL of the pull request.
    pub url: String,
}

/// Pull request state.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum PullRequestState {
    /// Open pull request.
    Open,
    /// Closed without merging.
    Closed,
    /// Merged pull request.
    Merged,
}

/// Options for a GitHub connector.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct GitHubConnectorOptions {
    /// Whether to enable debug logging.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub debug: Option<bool>,
}

/// Supported package managers.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum PackageManager {
    /// npm CLI.
    Npm,
    /// pnpm CLI.
    Pnpm,
}

/// Options for a package manager connector.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct PackageManagerConnectorOptions {
    /// Whether to enable debug logging.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub debug: Option<bool>,
    /// Working directory for package manager commands.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_issue_serialization() {
        let issue = Issue {
            number: 1,
            title: "Bug".to_string(),
            state: IssueState::Open,
            url: "https://example.com/issues/1".to_string(),
        };

        let json = serde_json::to_string(&issue).unwrap();
        assert!(json.contains("\"number\":1"));
        assert!(json.contains("\"state\":\"open\""));
    }

    #[test]
    fn test_package_manager_serialization() {
        let json = serde_json::to_string(&PackageManager::Pnpm).unwrap();
        assert_eq!(json, "\"pnpm\"");
    }
}
