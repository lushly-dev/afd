//! The load-time description scan (specification section 6.3): the rule of AFD's
//! `description-injection` surface check, ported from
//! `packages/testing/src/surface/injection.ts`. The patterns are pinned by test vectors shared
//! with that package (`packages/testing/src/surface/injection-vectors.json`).
//!
//! The patterns live in the `umbel-scan` crate (phase 2 specification, section 11), which the
//! knowledge container reader shares, so this module only re-exports what the loader uses.

pub use umbel_scan::{InjectionHit, scan_description, scan_schema_descriptions};
