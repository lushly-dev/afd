//! The store's error model (specification section 3.1).

use std::fmt;

/// Why a store call failed. The host maps each variant to the SDK's `HostError` (section 3.3).
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub enum StoreError {
    /// A compare-and-set or a revision check failed and nothing was written. `current` is the
    /// current content hash, or the current revision for `applied`, when there is one.
    Conflict {
        /// What the store holds now.
        current: Option<String>,
    },
    /// The target of a delete does not exist.
    NotFound,
    /// A lock wait ran past `store.lock_timeout_ms`. Retryable.
    Busy,
    /// The call is malformed or breaks a rule; the reason says which. Envelope refusals
    /// (`STORE_PROVENANCE_REQUIRED`) and query errors are this variant.
    Invalid(String),
    /// A size cap was exceeded (a document, a record, a batch).
    TooLarge(String),
    /// The stored data is not what this store wrote.
    Corrupt(String),
    /// The operating system or the database failed.
    Io(String),
    /// The store on disk is newer than this build serves (`STORE_VERSION_UNSUPPORTED`).
    VersionUnsupported {
        /// The schema version found on disk.
        found: u32,
        /// The newest schema version this build serves.
        supported: u32,
    },
}

impl StoreError {
    /// An [`StoreError::Invalid`] from anything printable.
    pub fn invalid(reason: impl fmt::Display) -> Self {
        Self::Invalid(reason.to_string())
    }
}

impl fmt::Display for StoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Conflict { current: Some(c) } => write!(f, "conflict: the store holds {c}"),
            Self::Conflict { current: None } => write!(f, "conflict: nothing is stored there"),
            Self::NotFound => write!(f, "not found"),
            Self::Busy => write!(f, "busy: a lock wait ran past the lock timeout"),
            Self::Invalid(reason) => write!(f, "invalid: {reason}"),
            Self::TooLarge(reason) => write!(f, "too large: {reason}"),
            Self::Corrupt(reason) => write!(f, "corrupt: {reason}"),
            Self::Io(reason) => write!(f, "i/o: {reason}"),
            Self::VersionUnsupported { found, supported } => write!(
                f,
                "the store is version {found}; this build serves up to version {supported}"
            ),
        }
    }
}

impl std::error::Error for StoreError {}

/// A store call's result.
pub type Result<T, E = StoreError> = std::result::Result<T, E>;
