//! The store's error model (phase 2 specification section 3.1, phase 3 section 5.2).

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
    /// A memory write met a limit of its quota (`MEMORY_QUOTA_EXCEEDED`, phase 3 section 8.11)
    /// and wrote nothing. Retryable when the limit is a rate.
    QuotaExceeded {
        /// Which limit.
        limit: crate::memory::QuotaLimit,
        /// When a rate limit will admit the write again; `None` for the stored limits.
        retry_after_ms: Option<u64>,
    },
    /// The memory store has not been written yet; reads answer this and create nothing.
    NotProvisioned,
    /// The memory database is provisioned and its key file does not exist
    /// (`MEMORY_KEYS_MISSING`, section 5.4).
    KeysMissing,
    /// The key file belongs to another database, is not a key file, or exists without its
    /// database (`MEMORY_KEYS_MISMATCH`).
    KeysMismatch,
    /// A readable record's key entry is absent (`MEMORY_KEY_ABSENT`).
    KeyAbsent {
        /// The record.
        id: String,
    },
    /// A readable record's sealed blob does not open (`MEMORY_SEAL_INVALID`).
    SealInvalid {
        /// The record.
        id: String,
    },
    /// A memory query matches more readable records than recall ranks
    /// (`MEMORY_QUERY_TOO_BROAD`, phase 5 section 9.2); nothing was returned.
    QueryTooBroad {
        /// The most readable matches a recall ranks.
        limit: u64,
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
            Self::QuotaExceeded {
                limit,
                retry_after_ms,
            } => {
                write!(f, "the memory quota's {} is reached", limit.as_str())?;
                match retry_after_ms {
                    Some(ms) => write!(f, "; retry after {ms} ms"),
                    None => Ok(()),
                }
            }
            Self::NotProvisioned => write!(f, "the memory store has not been written yet"),
            Self::KeysMissing => write!(f, "the memory key file is missing"),
            Self::KeysMismatch => write!(f, "the memory key file does not belong to this store"),
            Self::KeyAbsent { id } => write!(f, "the key of memory record {id} is absent"),
            Self::SealInvalid { id } => write!(f, "memory record {id} does not open"),
            Self::QueryTooBroad { limit } => write!(
                f,
                "the query matches more than {limit} readable records; narrow it"
            ),
        }
    }
}

impl std::error::Error for StoreError {}

/// A store call's result.
pub type Result<T, E = StoreError> = std::result::Result<T, E>;
