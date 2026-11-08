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
/// The proposal record version the knowledge plugin writes, 2 (`schemas/proposal.v2.json`, phase 4
/// section 2.1, D92); version 3 (phase 5 section 7.3) from phase 5 step 6. A version 1 record
/// stays version 1.
pub const PROPOSAL_VERSION: u32 = 2;
/// Every proposal record version a deployment holds, read side by side (phase 5 section 2).
pub const PROPOSAL_VERSIONS: &[u32] = &[1, 2, 3];
/// The memory record, version 1 (`schemas/memory-record.v1.json`, phase 3 section 4).
pub const MEMORY_VERSION: u32 = 1;
/// The memory key file, version 1 (`PRAGMA user_version` of `memory.keys`, phase 3 section 5.4).
pub const MEMORY_KEYS_VERSION: u32 = 1;
/// The capture contract, version 1 (`schemas/capture.v1.json`, phase 3 section 10.1).
pub const CAPTURE_VERSION: u32 = 1;
/// The context bundle, version 1 (`schemas/context-bundle.v1.json`, phase 3 section 9.5).
pub const BUNDLE_VERSION: u32 = 1;
/// The curator's records and its run report, version 1 (`schemas/curator-record.v1.json` and
/// `schemas/curator-report.v1.json`, phase 4 sections 2.3 and 7.2).
pub const CURATOR_VERSION: u32 = 1;

// Phase 5 (specification section 2). Each list names the versions of a shape a phase 5 deployment
// reads side by side, as `workspace-show` reports them; the constants above stay the versions this
// host writes until the step that writes the new one (the principal from step 2a, the envelope,
// event and memory record from step 5, the proposal from step 6, cursors and locators from step 7).

/// Every principal projection version (`schemas/principal.v0.json`, `principal.v1.json`).
pub const PRINCIPAL_VERSIONS: &[u32] = &[0, 1];
/// Every provenance envelope version (`schemas/provenance-envelope.v0.json` to `.v3.json`).
pub const ENVELOPE_VERSIONS: &[u32] = &[0, 1, 2, 3];
/// Every event version (`schemas/event.v0.json` to `event.v3.json`).
pub const EVENT_VERSIONS: &[u32] = &[0, 1, 2, 3];
/// Every memory record version (`schemas/memory-record.v1.json`, `memory-record.v2.json`).
pub const MEMORY_VERSIONS: &[u32] = &[1, 2];
/// Every cursor string version (`schemas/cursor.v0.json`, `cursor.v1.json`, phase 5 section 9.3).
pub const CURSOR_VERSIONS: &[u32] = &[0, 1];
/// Every locator version (`schemas/locator.v1.json`, `locator.v2.json`, phase 5 section 9.3).
pub const LOCATOR_VERSIONS: &[u32] = &[1, 2];
/// The task record, version 1 (`schemas/task-record.v1.json`, phase 5 section 12.2).
pub const TASK_VERSION: u32 = 1;
/// The usage event, version 1 (`schemas/usage-event.v1.json`, phase 5 section 12.1).
pub const USAGE_VERSION: u32 = 1;
/// The person decision, version 1 (`schemas/person-decision.v1.json`, phase 5 section 7.2).
pub const PERSON_VERSION: u32 = 1;
