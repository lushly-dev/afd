//! The version of each versioned shape this crate writes (specification section 7).

/// The principal projection, version 0.
pub use crate::principal::PRINCIPAL_VERSION;
/// The provenance envelope this host writes, version 1 (D55). It reads version 0 in events
/// already written.
pub const PROVENANCE_VERSION: u32 = 1;
/// An event this host writes, version 1 (D55). It reads version 0 lines as written.
pub const EVENT_VERSION: u32 = 1;
/// A cursor, version 0 (`v0:<space>:<seq>`).
pub const CURSOR_VERSION: u32 = 0;
/// The store traits, version 1 (phase 2 section 3.1). `umbel-store` owns the constant.
pub use umbel_store::STORE_TRAITS_VERSION as STORE_VERSION;
/// The document record, version 1 (`schemas/document.v1.json`).
pub const DOCUMENT_VERSION: u32 = 1;
/// The locator, version 1 (`schemas/locator.v1.json`).
pub const LOCATOR_VERSION: u32 = 1;
/// The proposal record, version 1 (`schemas/proposal.v1.json`).
pub const PROPOSAL_VERSION: u32 = 1;
