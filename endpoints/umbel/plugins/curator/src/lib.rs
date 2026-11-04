//! The `curator` plugin (phase 4 specification, sections 3 to 5 and 11.1; D90, D93, D94): which
//! of the caller's memory records have settled into candidates for the knowledge base, how a
//! candidate is drafted, and a person's consent to widen their own records.
//!
//! [`plugin`] is the SDK value; `umbel::plugins::sdk(umbel_plugin_curator::plugin())` links it into
//! a host as `compiled:curator`. It depends on no other plugin (D3): it reads memory and documents
//! through the host's grants, **under the caller's reader filter only** (owner decision 4), and
//! renders through [`umbel_okf::draft`], which the knowledge plugin re-renders with to verify every
//! claim (owner decision 10). It holds no write grant to memory or knowledge (owner decision 8);
//! it writes only its own records, per space and principal.
//!
//! The deterministic core is public, so the run of step 5 and the tests use the same code:
//! - [`pack`]: the `settle` pack (section 4.2's defaults and the bounds);
//! - [`target`]: where a space's drafts go, with the collection's readers and sensitivity;
//! - [`settle`]: eligible records, groups by content hash and class, and when a group settles
//!   (sections 4.1 to 4.3);
//! - [`access`]: section 5.1's rule;
//! - [`conflicts`]: conflict sets and their alternatives (4.4);
//! - [`evaluate`]: candidates and their statuses, merged with the caller's records (4.6);
//! - [`draft`]: a candidate as a `knowledge-propose-batch` item, through `umbel_okf::draft` (4.5);
//! - [`records`]: the curator's records, `curator-record.v1.json` (2.3).
//!
//! The commands of this step are `curator-candidates` (the caller's candidates by status, with no
//! memory text) and `curator-promote` (a person's consent at a terminal, `require-human`, own
//! records only). Both are CLI only and digest-journaled. `curator-run` and its steps are step 5's.
//!
//! Memory text is untrusted content: it never appears in a message, warning, reasoning or log
//! line (D67), and no command's result holds it.
#![forbid(unsafe_code)]

pub mod access;
mod candidates;
pub mod conflicts;
pub mod draft;
pub mod evaluate;
mod fail;
pub mod pack;
mod promote;
mod read;
pub mod records;
mod settings;
pub mod settle;
pub mod target;

use serde_json::Value;
use umbel_sdk::{Asset, Cx, Outcome, Plugin, failure};

/// The manifest of the compiled build.
pub const MANIFEST: &str = include_str!("../umbel-plugin.toml");

/// The plugin id, which a drafted document's `generated.by` names (`umbel:curator/<instance>`).
pub const PLUGIN_ID: &str = "curator";

/// The curator plugin.
#[derive(Debug, Clone, Copy, Default)]
pub struct Curator;

/// The plugin as an SDK value.
pub fn plugin() -> Curator {
    Curator
}

impl Plugin for Curator {
    fn manifest(&self) -> &'static str {
        MANIFEST
    }

    fn assets(&self) -> &'static [Asset] {
        umbel_sdk::embedded_assets!()
    }

    fn handle(&self, name: &str, input: Value, cx: &mut Cx) -> Outcome {
        match name {
            "curator-candidates" => candidates::run(&input, cx),
            "curator-promote" => promote::run(&input, cx),
            other => failure(
                "COMMAND_NOT_FOUND",
                &format!("the curator plugin has no command `{other}`"),
                "Call curator-candidates or curator-promote; curator-guide describes them.",
            ),
        }
    }
}
