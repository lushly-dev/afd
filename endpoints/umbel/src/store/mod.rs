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
    /// The memory store (phase 3): opens nothing until the first write.
    #[cfg(feature = "store-embedded")]
    pub(crate) sqlite_memory: Arc<umbel_store_embedded::SqliteMemoryStore>,
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

    #[allow(dead_code)]
    pub(crate) fn memory(
        &self,
        _space: &str,
    ) -> Result<Arc<dyn umbel_store::MemoryStore>, StoreError> {
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
    "memory",
    "memory_write",
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
    /// A memory write met its quota (phase 3 section 8.11).
    pub const MEMORY_QUOTA_EXCEEDED: &str = "MEMORY_QUOTA_EXCEEDED";
    /// The memory key file does not exist (phase 3 section 5.4).
    pub const MEMORY_KEYS_MISSING: &str = "MEMORY_KEYS_MISSING";
    /// The memory key file is another database's, or not a key file.
    pub const MEMORY_KEYS_MISMATCH: &str = "MEMORY_KEYS_MISMATCH";
    /// A readable record's key entry is absent.
    pub const MEMORY_KEY_ABSENT: &str = "MEMORY_KEY_ABSENT";
    /// A readable record's sealed blob does not open.
    pub const MEMORY_SEAL_INVALID: &str = "MEMORY_SEAL_INVALID";
    /// A memory query matches more readable records than recall ranks (phase 5 section 9.2).
    pub const MEMORY_QUERY_TOO_BROAD: &str = "MEMORY_QUERY_TOO_BROAD";
    /// The memory key file is never part of a `store-backup` copy (a warning).
    pub const MEMORY_KEYS_NOT_BACKED_UP: &str = "MEMORY_KEYS_NOT_BACKED_UP";
}

/// The record lane's codes and their messages (the records host specification, section 13). No
/// message holds a record's text or a key's value. Only a build with a store backend serves the
/// lane, so only that build uses them all.
#[cfg_attr(not(feature = "store-embedded"), allow(dead_code))]
pub(crate) mod records {
    /// A lane service on a kind the instance's manifest does not declare.
    pub(crate) const RECORD_KIND_NOT_DECLARED: &str = "RECORD_KIND_NOT_DECLARED";
    /// A put of a declared record with no effective principal.
    pub(crate) const RECORD_PRINCIPAL_REQUIRED: &str = "RECORD_PRINCIPAL_REQUIRED";
    /// A value at a text pointer or a key pointer that the declaration does not admit.
    pub(crate) const RECORD_FIELD_INVALID: &str = "RECORD_FIELD_INVALID";
    /// A put that would change the wording of a standing record.
    pub(crate) const RECORD_WORDING_FIXED: &str = "RECORD_WORDING_FIXED";
    /// The kind's lane is being rebuilt or must be rebuilt.
    pub(crate) const RECORD_LANE_STALE: &str = "RECORD_LANE_STALE";
    /// A find that breaks a rule of section 7.
    pub(crate) const RECORD_QUERY_INVALID: &str = "RECORD_QUERY_INVALID";
    /// A ranked find whose counts pass the most postings one call counts.
    pub(crate) const RECORD_QUERY_TOO_BROAD: &str = "RECORD_QUERY_TOO_BROAD";

    /// `RECORD_LANE_STALE`'s message for `kind`.
    #[must_use]
    pub(crate) fn stale_message(kind: &str) -> String {
        format!("the lane of {kind} is being rebuilt or must be rebuilt")
    }
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
        StoreError::QuotaExceeded {
            limit,
            retry_after_ms,
        } => HostError::QuotaExceeded {
            limit,
            retry_after_ms,
        },
        StoreError::NotProvisioned => HostError::NotProvisioned,
        StoreError::KeysMissing => HostError::KeysMissing,
        StoreError::KeysMismatch => HostError::KeysMismatch,
        StoreError::KeyAbsent { id } => HostError::KeyAbsent { id },
        StoreError::SealInvalid { id } => HostError::SealInvalid { id },
        StoreError::QueryTooBroad { limit } => HostError::QueryTooBroad { limit },
        // The record lane's refusals (the records host specification, section 13): the message
        // begins with the code. A lane service names the kind of a stale lane itself.
        other @ StoreError::LaneStale => {
            HostError::Invalid(format!("{}: {other}", records::RECORD_LANE_STALE))
        }
        other @ StoreError::WordingFixed => {
            HostError::Invalid(format!("{}: {other}", records::RECORD_WORDING_FIXED))
        }
        other @ StoreError::LaneTooBroad { .. } => {
            HostError::Invalid(format!("{}: {other}", records::RECORD_QUERY_TOO_BROAD))
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
        StoreError::KeysMissing => (codes::MEMORY_KEYS_MISSING, KEYS_MISSING_SUGGESTION, false),
        StoreError::KeysMismatch => (codes::MEMORY_KEYS_MISMATCH, KEYS_MISMATCH_SUGGESTION, false),
        StoreError::KeyAbsent { .. } => (
            codes::MEMORY_KEY_ABSENT,
            "Restore the key file from your own backup, or forget the record.",
            false,
        ),
        StoreError::SealInvalid { .. } => (
            codes::MEMORY_SEAL_INVALID,
            "Restore the key file that belongs to this database, or forget the record.",
            false,
        ),
        StoreError::QueryTooBroad { .. } => (
            codes::MEMORY_QUERY_TOO_BROAD,
            "Narrow the query: add a required term with +, a field, or a filter.",
            false,
        ),
        StoreError::LaneStale => (
            records::RECORD_LANE_STALE,
            "Run umbel store-records-reindex first.",
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

/// What to do about `MEMORY_KEYS_MISSING` (phase 3 section 5.4).
#[cfg(feature = "store-embedded")]
pub(crate) const KEYS_MISSING_SUGGESTION: &str = "Restore memory.keys from your own backup; or, to start empty, stop every process using the space and remove memory.sqlite3 with its -wal and -shm, which loses all memory.";
/// What to do about `MEMORY_KEYS_MISMATCH` (phase 3 section 5.4).
#[cfg(feature = "store-embedded")]
pub(crate) const KEYS_MISMATCH_SUGGESTION: &str = "Put back the memory.keys that belongs to this memory.sqlite3; or restore memory.sqlite3. Never remove either file while you want its memory.";

/// What the services and commands share: the stores of a workspace's spaces.
pub(crate) type Hub = Arc<Stores>;

#[cfg(test)]
mod tests {
    use super::*;
    use umbel_sdk::HostError;

    #[test]
    fn the_record_lanes_refusals_begin_with_their_codes() {
        // The records host specification, section 13: each is `Invalid`, code first.
        let invalid = |error: StoreError| match host_error(error) {
            HostError::Invalid(message) => message,
            other => panic!("{other:?}"),
        };
        assert_eq!(
            invalid(StoreError::LaneStale),
            "RECORD_LANE_STALE: the lane is being rebuilt or must be rebuilt"
        );
        assert_eq!(
            invalid(StoreError::WordingFixed),
            "RECORD_WORDING_FIXED: the wording of a standing record never changes; write a new record"
        );
        assert_eq!(
            invalid(StoreError::LaneTooBroad { limit: 4_000_000 }),
            "RECORD_QUERY_TOO_BROAD: the call counts more than 4000000 postings"
        );
        assert_eq!(
            records::stale_message("note"),
            "the lane of note is being rebuilt or must be rebuilt"
        );
    }

    #[cfg(feature = "store-embedded")]
    #[test]
    fn a_stale_lane_is_a_command_error_that_names_the_rebuild() {
        let error = command_error(&StoreError::LaneStale);
        assert_eq!(error.code, "RECORD_LANE_STALE");
        assert_eq!(error.retryable, Some(false));
        assert!(
            error
                .suggestion
                .as_deref()
                .is_some_and(|suggestion| suggestion.contains("umbel store-records-reindex"))
        );
    }
}
