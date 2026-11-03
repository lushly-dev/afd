//! The version of each versioned shape this crate writes (specification section 7).

/// The principal projection, version 0.
pub use crate::principal::PRINCIPAL_VERSION;
/// The provenance envelope this host writes, version 2 (D71, phase 3 section 2.1). It reads
/// versions 0 and 1 in events and stored rows already written.
pub const PROVENANCE_VERSION: u32 = 2;
/// An event this host writes, version 2 (D71, phase 3 section 2.2). It reads version 0 and 1
/// lines as written.
pub const EVENT_VERSION: u32 = 2;
/// A cursor, version 0 (`v0:<space>:<seq>`).
pub const CURSOR_VERSION: u32 = 0;
/// The store traits, version 2 (phase 3 section 5.1). `umbel-store` owns the constant.
pub use umbel_store::STORE_TRAITS_VERSION as STORE_VERSION;
/// The document record, version 1 (`schemas/document.v1.json`).
pub const DOCUMENT_VERSION: u32 = 1;
/// The locator, version 1 (`schemas/locator.v1.json`).
pub const LOCATOR_VERSION: u32 = 1;
/// The proposal record, version 1 (`schemas/proposal.v1.json`).
pub const PROPOSAL_VERSION: u32 = 1;
/// The memory record, version 1 (`schemas/memory-record.v1.json`, phase 3 section 4).
pub const MEMORY_VERSION: u32 = 1;
/// The memory key file, version 1 (`PRAGMA user_version` of `memory.keys`, phase 3 section 5.4).
pub const MEMORY_KEYS_VERSION: u32 = 1;
/// The capture contract, version 1 (`schemas/capture.v1.json`, phase 3 section 10.1).
pub const CAPTURE_VERSION: u32 = 1;
/// The context bundle, version 1 (`schemas/context-bundle.v1.json`, phase 3 section 9.5).
pub const BUNDLE_VERSION: u32 = 1;
