//! The `components` plugin: facts about a component library's components for the page an agent is
//! writing, read from the space's pack in Specimen's exported form (`docs/plugins/components/spec.md`).
//!
//! [`plugin`] is the SDK value; `umbel::plugins::sdk(umbel_plugin_components::plugin())` links it
//! into a host as `compiled:components`. It depends on no other plugin (D3).
//!
//! - [`pack`]: a second reader of Specimen's pack format, held equal to `checkPack` by Specimen's
//!   fixtures; a library with any problem is refused whole (D152).
//! - `brief`, `list` and `open`: the three commands; `entry` builds an entry, `fit` measures as AFD
//!   measures, `render` writes the text block.
//! - `scan`: `umbel-scan` over identifiers and over served text (D153).
//!
//! Everything read from a pack that is not a checked identifier sits in one part of an answer
//! labelled `trust: "content"`, and never in a message, warning, reasoning or log line (D67,
//! D153). No code here uses a filesystem, clock, thread or network.
#![forbid(unsafe_code)]

mod brief;
mod entry;
mod fail;
mod fit;
mod input;
mod list;
mod open;
mod pack;
mod render;
mod scan;
mod select;

use serde_json::Value;
use umbel_sdk::{Asset, Cx, Outcome, Plugin, failure, success};

/// The manifest of the compiled build.
pub const MANIFEST: &str = include_str!("../umbel-plugin.toml");

/// The components plugin.
#[derive(Debug, Clone, Copy, Default)]
pub struct Components;

/// The plugin as an SDK value.
pub fn plugin() -> Components {
    Components
}

impl Plugin for Components {
    fn manifest(&self) -> &'static str {
        MANIFEST
    }

    fn assets(&self) -> &'static [Asset] {
        umbel_sdk::embedded_assets!()
    }

    fn handle(&self, name: &str, input: Value, cx: &mut Cx) -> Outcome {
        match name {
            "components-brief" => brief::run(&input, cx),
            "components-list" => list::run(&input, cx),
            "components-open" => open::run(&input, cx),
            other => failure(
                "COMMAND_NOT_FOUND",
                &format!("the components plugin has no command `{other}`"),
                "Call components-brief, components-list or components-open.",
            ),
        }
    }

    /// The doctor's check of a space override (D172): the commands' own reader over every
    /// library in the pack, so a refused override fails `plugins.pack_checks` with the code and
    /// problems a call would get (section 9.1).
    fn check_pack(&self, pack: &str, cx: &mut Cx) -> Option<Outcome> {
        if pack != pack::PACK {
            return None;
        }
        Some(match pack::read(cx, None) {
            Ok(libraries) => success(serde_json::json!({
                "libraries": libraries.iter().map(|library| library.id.as_str()).collect::<Vec<_>>(),
            })),
            Err(refusal) => refusal,
        })
    }
}

/// `[plugins.components.config]`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Settings {
    /// The weakest basis served, as a rank (see [`basis_rank`]).
    pub(crate) minimum_basis: u8,
    pub(crate) default_library: Option<String>,
}

/// A basis as a rank: `verified` is 0, the strongest.
pub(crate) fn basis_rank(basis: &str) -> u8 {
    match basis {
        "verified" => 0,
        "observed" => 1,
        "declared" => 2,
        _ => 3,
    }
}

impl Settings {
    pub(crate) fn load(cx: &Cx) -> Self {
        let config = cx.config().unwrap_or(Value::Null);
        Self {
            minimum_basis: basis_rank(
                config
                    .get("minimum_basis")
                    .and_then(Value::as_str)
                    .unwrap_or("authored"),
            ),
            default_library: config
                .get("default_library")
                .and_then(Value::as_str)
                .map(str::to_owned),
        }
    }

    /// Whether a fact of this basis is served.
    pub(crate) fn serves(&self, basis: &str) -> bool {
        basis_rank(basis) <= self.minimum_basis
    }
}
