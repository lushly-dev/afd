//! What can go wrong reading, writing and repairing the event log.

use crate::host::HostError;
use crate::workspace::{WorkspaceError, codes};
use afd::CommandError;
use std::path::Path;

/// `INVALID_CURSOR`: the cursor is malformed, of another space, or past the head.
pub const INVALID_CURSOR: &str = "INVALID_CURSOR";

const REBUILD: &str =
    "Run umbel workspace doctor, then umbel event rebuild to rebuild the streams from the journal.";

/// A failure of the event log.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum EventsError {
    /// The workspace lock was not taken in time, or its file cannot be opened.
    Lock(WorkspaceError),
    /// A stream, the journal or a cursor file holds something that is not what it should be.
    Damaged(String),
    /// A file cannot be read or written.
    Io(String),
}

impl EventsError {
    pub(crate) fn io(path: &Path, error: impl std::fmt::Display) -> Self {
        Self::Io(format!(
            "{} cannot be read or written: {error}",
            path.display()
        ))
    }

    pub(crate) fn damaged(path: &Path, problem: impl std::fmt::Display) -> Self {
        Self::Damaged(format!("{} is damaged: {problem}", path.display()))
    }

    /// The error as a command failure: the lock keeps its own code, damaged state is
    /// `WORKSPACE_UNHEALTHY`, an unwritable file `WORKSPACE_STATE_UNWRITABLE`.
    pub(crate) fn to_command_error(&self) -> CommandError {
        match self {
            Self::Lock(error) => error.to_command_error(),
            Self::Damaged(message) => CommandError::new(codes::WORKSPACE_UNHEALTHY, message)
                .with_suggestion(REBUILD)
                .with_retryable(false),
            Self::Io(message) => CommandError::new(codes::WORKSPACE_STATE_UNWRITABLE, message)
                .with_suggestion(
                    "Make the workspace's state directory writable by this user, then retry.",
                )
                .with_retryable(false),
        }
    }

    /// The same, for opening or repairing a host.
    pub(crate) fn into_host_error(self) -> HostError {
        match self {
            Self::Lock(error) => error.into(),
            other => {
                let error = other.to_command_error();
                HostError::new(
                    &error.code,
                    error.message,
                    error.suggestion.unwrap_or_default(),
                )
            }
        }
    }
}

impl std::fmt::Display for EventsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Lock(error) => write!(f, "{error}"),
            Self::Damaged(message) | Self::Io(message) => f.write_str(message),
        }
    }
}

impl std::error::Error for EventsError {}

impl From<WorkspaceError> for EventsError {
    fn from(error: WorkspaceError) -> Self {
        Self::Lock(error)
    }
}

/// The `INVALID_CURSOR` failure.
pub(crate) fn invalid_cursor(message: String) -> CommandError {
    CommandError::new(INVALID_CURSOR, message)
        .with_suggestion("Use a cursor returned by event-list for this space, or omit it to start after your acknowledged cursor.")
        .with_retryable(false)
}
