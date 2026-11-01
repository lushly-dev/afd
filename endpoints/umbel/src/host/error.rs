//! Errors from opening and sealing a host.

use crate::workspace::WorkspaceError;
use afd::{CommandError, CommandResult};
use std::fmt;

/// A failure to open or seal a host. Every error has a code, a message that names the key, file
/// or command at fault, and a suggestion; it converts into a failure [`CommandResult`] with
/// exactly those.
#[derive(Debug, Clone, PartialEq)]
pub struct HostError {
    error: Box<CommandError>,
}

impl HostError {
    pub(crate) fn new(code: &str, message: String, suggestion: String) -> Self {
        Self {
            error: Box::new(
                CommandError::new(code, message)
                    .with_suggestion(suggestion)
                    .with_retryable(false),
            ),
        }
    }

    /// A command that breaks a registration rule, or a key of `umbel.toml` that `seal` finds
    /// unusable: `WORKSPACE_CONFIG_INVALID` naming `what`.
    pub(crate) fn config_invalid(what: &str, problem: &str, suggestion: &str) -> Self {
        Self::new(
            crate::workspace::codes::WORKSPACE_CONFIG_INVALID,
            format!("{what} {problem}"),
            suggestion.to_owned(),
        )
    }

    /// The error code.
    pub fn code(&self) -> &str {
        &self.error.code
    }

    /// What went wrong.
    pub fn message(&self) -> &str {
        &self.error.message
    }

    /// What the caller can do about it.
    pub fn suggestion(&self) -> &str {
        self.error.suggestion.as_deref().unwrap_or_default()
    }

    /// Whether retrying might succeed.
    pub fn retryable(&self) -> bool {
        self.error.retryable.unwrap_or(false)
    }

    /// The error as AFD's [`CommandError`].
    pub fn to_command_error(&self) -> CommandError {
        (*self.error).clone()
    }

    /// The error as a failure [`CommandResult`], which is what the CLI and the library print.
    pub fn into_result<T>(self) -> CommandResult<T> {
        afd::failure(*self.error)
    }
}

impl From<WorkspaceError> for HostError {
    fn from(error: WorkspaceError) -> Self {
        Self {
            error: Box::new(error.to_command_error()),
        }
    }
}

impl fmt::Display for HostError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.error.code, self.error.message)
    }
}

impl std::error::Error for HostError {}
