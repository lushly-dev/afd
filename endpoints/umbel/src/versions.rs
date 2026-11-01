//! The version of each versioned shape this crate writes (specification section 7).

/// The principal projection, version 0.
pub use crate::principal::PRINCIPAL_VERSION;
/// The provenance envelope, version 0.
pub const PROVENANCE_VERSION: u32 = 0;
/// An event, version 0.
pub const EVENT_VERSION: u32 = 0;
/// A cursor, version 0 (`v0:<space>:<seq>`).
pub const CURSOR_VERSION: u32 = 0;
