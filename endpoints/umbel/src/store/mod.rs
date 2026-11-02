//! The host's stores: one SQLite store and one tantivy index per space, opened on first use and
//! shared by every call of this process (phase 2 specification, section 3.2). Several processes
//! may open one space's stores at once; nothing here is request state.

use std::sync::Arc;

#[cfg(feature = "store-embedded")]
use afd::CommandError;
use umbel_store::StoreError;

#[cfg(feature = "store-embedded")]
mod embedded;
#[cfg(feature = "store-embedded")]
pub(crate) use embedded::Stores;

/// One space's stores as the services use them: the three traits, and under the embedded backend
/// its concrete types, which `store-show`, `store-check` and `store-backup` need.
pub(crate) struct SpaceStores {
    pub(crate) documents: Arc<dyn umbel_store::DocumentStore>,
    pub(crate) graph: Arc<dyn umbel_store::GraphStore>,
    pub(crate) index: Arc<dyn umbel_store::SearchIndex>,
    #[cfg(feature = "store-embedded")]
    pub(crate) sqlite: Arc<umbel_store_embedded::SqliteStore>,
    #[cfg(feature = "store-embedded")]
    pub(crate) tantivy: Arc<umbel_store_embedded::TantivyIndex>,
}

/// A build without a backend has no stores: every open fails, and no grant reaches it.
#[cfg(not(feature = "store-embedded"))]
pub(crate) struct Stores;

#[cfg(not(feature = "store-embedded"))]
impl Stores {
    pub(crate) fn new(_workspace: Arc<crate::workspace::Workspace>) -> Self {
        Self
    }

    pub(crate) fn space(&self, _space: &str) -> Result<Arc<SpaceStores>, StoreError> {
        Err(StoreError::Io(
            "this build of umbel links no store backend (feature store-embedded)".to_owned(),
        ))
    }
}

/// Whether this build links a store backend. Without one every store grant is
/// `PLUGIN_GRANT_UNAVAILABLE` and the `store-*` commands are absent.
pub(crate) const AVAILABLE: bool = cfg!(feature = "store-embedded");

/// The grants that read or write the stores or files (phase 2 specification, section 3.3).
pub const STORE_GRANTS: &[&str] = &[
    "content",
    "content_write",
    "documents",
    "documents_write",
    "records",
    "records_write",
    "index",
    "index_write",
    "graph",
    "graph_write",
];

/// `STORE_*` codes of the store built-ins and of the host's refusals.
pub mod codes {
    /// A write outside the instance's `allow` entries, a derivation read without `store-write`,
    /// or `as_reader` where it is refused.
    pub const STORE_WRITE_NOT_ALLOWED: &str = "STORE_WRITE_NOT_ALLOWED";
    /// The store refused an envelope without an origin, an access set or a sensitivity.
    pub const STORE_PROVENANCE_REQUIRED: &str = "STORE_PROVENANCE_REQUIRED";
    /// A compare-and-set or revision check failed.
    pub const STORE_CONFLICT: &str = "STORE_CONFLICT";
    /// A lock wait ran past `store.lock_timeout_ms`.
    pub const STORE_BUSY: &str = "STORE_BUSY";
    /// The stored data is not what the store wrote.
    pub const STORE_CORRUPT: &str = "STORE_CORRUPT";
    /// The operating system or the database failed.
    pub const STORE_IO: &str = "STORE_IO";
    /// The store on disk is newer than this build serves.
    pub const STORE_VERSION_UNSUPPORTED: &str = "STORE_VERSION_UNSUPPORTED";
    /// This build links no store backend.
    pub const STORE_UNAVAILABLE: &str = "STORE_UNAVAILABLE";
    /// A destination that must not exist already does.
    pub const STORE_BACKUP_EXISTS: &str = "STORE_BACKUP_EXISTS";
}

/// The SDK's `HostError` for a store failure (specification section 3.3).
pub(crate) fn host_error(error: StoreError) -> umbel_sdk::HostError {
    use umbel_sdk::HostError;
    match error {
        StoreError::Conflict { current } => HostError::Conflict { current },
        StoreError::NotFound => HostError::NotFound("nothing is stored there".to_owned()),
        StoreError::Busy => {
            HostError::Busy("a lock wait ran past store.lock_timeout_ms; retry".to_owned())
        }
        StoreError::Invalid(reason) => HostError::Invalid(reason),
        StoreError::TooLarge(reason) => HostError::TooLarge(reason),
        StoreError::Corrupt(reason) => HostError::Corrupt(reason),
        StoreError::Io(reason) => HostError::Io(reason),
        other @ StoreError::VersionUnsupported { .. } => {
            HostError::Io(format!("{} ({})", codes::STORE_VERSION_UNSUPPORTED, other))
        }
        other => HostError::Io(other.to_string()),
    }
}

/// The AFD error a built-in command answers for a store failure.
#[cfg(feature = "store-embedded")]
pub(crate) fn command_error(error: &StoreError) -> CommandError {
    let (code, suggestion, retryable) = match error {
        StoreError::Conflict { .. } => (
            codes::STORE_CONFLICT,
            "Read the current state and retry.",
            false,
        ),
        StoreError::Busy => (
            codes::STORE_BUSY,
            "Another process holds the store's lock; retry in a moment.",
            true,
        ),
        StoreError::Corrupt(_) => (
            codes::STORE_CORRUPT,
            "Run store-check, then knowledge-index rebuild=true if the index is damaged.",
            false,
        ),
        StoreError::VersionUnsupported { .. } => (
            codes::STORE_VERSION_UNSUPPORTED,
            "Upgrade umbel to a version that serves this store.",
            false,
        ),
        StoreError::Invalid(_) | StoreError::TooLarge(_) | StoreError::NotFound => (
            afd::error_codes::VALIDATION_ERROR,
            "Fix the input and try again.",
            false,
        ),
        _ => (
            codes::STORE_IO,
            "Run store-check; the state directory must be on a local filesystem.",
            true,
        ),
    };
    CommandError::new(code, error.to_string())
        .with_suggestion(suggestion)
        .with_retryable(retryable)
}

/// What the services and commands share: the stores of a workspace's spaces.
pub(crate) type Hub = Arc<Stores>;
