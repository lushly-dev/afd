//! Workspace errors: the `WORKSPACE_*` codes of the phase 0 specification, section 3.

use std::fmt;
use std::path::Path;

use afd::{CommandError, CommandResult};

/// The Umbel package codes that opening or inspecting a workspace returns.
pub mod codes {
    /// No workspace was found.
    pub const WORKSPACE_NOT_FOUND: &str = "WORKSPACE_NOT_FOUND";
    /// `umbel.toml` is invalid, or a command breaks a registration rule.
    pub const WORKSPACE_CONFIG_INVALID: &str = "WORKSPACE_CONFIG_INVALID";
    /// `config_version` is not 1 or 2.
    pub const WORKSPACE_CONFIG_UNSUPPORTED: &str = "WORKSPACE_CONFIG_UNSUPPORTED";
    /// `state/` cannot be created or written.
    pub const WORKSPACE_STATE_UNWRITABLE: &str = "WORKSPACE_STATE_UNWRITABLE";
    /// A key file is shorter than 32 bytes or, for `http.token`, malformed.
    pub const WORKSPACE_KEY_INVALID: &str = "WORKSPACE_KEY_INVALID";
    /// The workspace lock was not taken within `journal.lock_timeout_ms`.
    pub const WORKSPACE_LOCK_TIMEOUT: &str = "WORKSPACE_LOCK_TIMEOUT";
    /// A doctor check failed.
    pub const WORKSPACE_UNHEALTHY: &str = "WORKSPACE_UNHEALTHY";
    /// `umbel serve` could not start serving: the address is in use, or stdio did not open.
    pub const SERVER_START_FAILED: &str = "SERVER_START_FAILED";
    /// AFD's `ALREADY_EXISTS`, which `init` returns for a directory that holds a workspace.
    pub const ALREADY_EXISTS: &str = afd::error_codes::ALREADY_EXISTS;
}

/// A failure to find, open, create or lock a workspace. Every error carries a suggestion.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceError {
    code: &'static str,
    message: String,
    suggestion: String,
    retryable: bool,
}

impl WorkspaceError {
    fn new(code: &'static str, message: String, suggestion: String) -> Self {
        Self {
            code,
            message,
            suggestion,
            retryable: false,
        }
    }

    /// The error code, one of [`codes`].
    pub fn code(&self) -> &str {
        self.code
    }

    /// What went wrong; names the key, file or path at fault.
    pub fn message(&self) -> &str {
        &self.message
    }

    /// What the caller can do about it.
    pub fn suggestion(&self) -> &str {
        &self.suggestion
    }

    /// Whether retrying the same call might succeed.
    pub fn retryable(&self) -> bool {
        self.retryable
    }

    /// The error as AFD's [`CommandError`].
    pub fn to_command_error(&self) -> CommandError {
        CommandError::new(self.code, &self.message)
            .with_suggestion(&self.suggestion)
            .with_retryable(self.retryable)
    }

    /// The error as a failure [`CommandResult`], which is what the CLI and the library print.
    pub fn into_result<T>(self) -> CommandResult<T> {
        afd::failure(self.to_command_error())
    }

    pub(crate) fn not_found(message: String) -> Self {
        Self::new(
            codes::WORKSPACE_NOT_FOUND,
            message,
            "Pass --workspace <dir>, set UMBEL_WORKSPACE, or run umbel init.".to_owned(),
        )
    }

    /// `key` is the configuration key, or the name of the command or file that breaks a rule.
    pub(crate) fn config_invalid(key: &str, problem: impl fmt::Display) -> Self {
        Self::new(
            codes::WORKSPACE_CONFIG_INVALID,
            format!("umbel.toml: `{key}` {problem}"),
            format!("Fix `{key}` in umbel.toml: {problem}."),
        )
    }

    pub(crate) fn config_syntax(problem: impl fmt::Display) -> Self {
        Self::new(
            codes::WORKSPACE_CONFIG_INVALID,
            format!("umbel.toml is not valid TOML: {problem}"),
            "Fix the syntax error in umbel.toml.".to_owned(),
        )
    }

    pub(crate) fn config_unsupported(found: impl fmt::Display) -> Self {
        Self::new(
            codes::WORKSPACE_CONFIG_UNSUPPORTED,
            format!(
                "umbel.toml has config_version {found}; this umbel reads configuration versions 1 and 2"
            ),
            "This umbel reads configuration versions 1 and 2; upgrade umbel or migrate umbel.toml."
                .to_owned(),
        )
    }

    pub(crate) fn unwritable(path: &Path, error: impl fmt::Display) -> Self {
        let path = path.display();
        Self::new(
            codes::WORKSPACE_STATE_UNWRITABLE,
            format!("{path} cannot be created or written: {error}"),
            format!(
                "Make {path} writable by this user, or point --workspace at a workspace you can write."
            ),
        )
    }

    pub(crate) fn key_invalid(path: &Path, problem: impl fmt::Display) -> Self {
        let path = path.display();
        Self::new(
            codes::WORKSPACE_KEY_INVALID,
            format!("{path} is invalid: {problem}"),
            format!(
                "Delete {path}; the next open creates a new key. Pending confirmations, and HTTP clients holding the old token, must start again."
            ),
        )
    }

    pub(crate) fn lock_timeout(waited_ms: u64) -> Self {
        let mut error = Self::new(
            codes::WORKSPACE_LOCK_TIMEOUT,
            format!("The workspace lock was not taken within {waited_ms} ms"),
            format!(
                "Another umbel process held the workspace lock for more than {waited_ms} ms, usually during umbel event rebuild. Retry when it finishes; if no umbel process is running, run umbel workspace doctor."
            ),
        );
        error.retryable = true;
        error
    }

    pub(crate) fn already_exists(dir: &Path) -> Self {
        let dir = dir.display();
        Self::new(
            codes::ALREADY_EXISTS,
            format!("{dir} already holds a workspace (umbel.toml exists)"),
            "Choose another directory, or open this one with --workspace.".to_owned(),
        )
    }
}

impl fmt::Display for WorkspaceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for WorkspaceError {}
