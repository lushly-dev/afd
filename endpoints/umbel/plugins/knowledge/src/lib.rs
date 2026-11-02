//! The `knowledge` plugin (phase 2 specification, sections 7 and 8): structure-aware chunking,
//! lexical search, open, find and describe over the documents a space's stores hold.
//!
//! [`plugin`] is the SDK value; `umbel::plugins::sdk(umbel_plugin_knowledge::plugin())` links it
//! into a host as `compiled:knowledge`, and the `umbel-knowledge` binary is the `umbel` command
//! line with it and the `sources` plugin compiled in (the stock `umbel` binary stays empty).
//!
//! - `knowledge-index` brings the space's index up to date by the procedure of section 8.7:
//!   index writer first, derivation reads of the change log, chunks built in memory, one commit
//!   that never lowers the applied revision;
//! - `knowledge-search` is fielded BM25 whose reader filter is a mandatory clause of the index
//!   query itself, presented per document, for one space or, explicitly, several;
//! - `knowledge-open`, `knowledge-find`, `knowledge-describe`, `knowledge-list` and
//!   `knowledge-changes` read documents and changes under the caller's reader filter;
//! - the pipeline `knowledge-refresh` runs `sources-sync` and then `knowledge-index`.
//!
//! Content is untrusted: every part of a result that came from a document carries `trust:
//! "content"`, and no message, warning or reasoning ever contains content.
//!
//! The structural graph, expansion, code symbols, proposals, verification and the eval harness
//! are later steps of the phase.
#![forbid(unsafe_code)]

mod budget;
pub mod chunk;
mod describe;
mod doc;
mod fail;
mod find;
mod index;
mod list;
mod locator;
mod open;
mod search;
mod settings;

use serde_json::Value;
use umbel_sdk::{Asset, Cx, Outcome, Plugin, failure};

/// The manifest of the compiled build.
pub const MANIFEST: &str = include_str!("../umbel-plugin.toml");

/// The knowledge plugin.
#[derive(Debug, Clone, Copy, Default)]
pub struct Knowledge;

/// The plugin as an SDK value.
pub fn plugin() -> Knowledge {
    Knowledge
}

impl Plugin for Knowledge {
    fn manifest(&self) -> &'static str {
        MANIFEST
    }

    fn assets(&self) -> &'static [Asset] {
        umbel_sdk::embedded_assets!()
    }

    fn handle(&self, name: &str, input: Value, cx: &mut Cx) -> Outcome {
        match name {
            "knowledge-index" => index::run(&input, cx),
            "knowledge-search" => search::run(&input, cx),
            "knowledge-open" => open::run(&input, cx),
            "knowledge-find" => find::run(&input, cx),
            "knowledge-describe" => describe::run(&input, cx),
            "knowledge-list" => list::list(&input, cx),
            "knowledge-changes" => list::changes(&input, cx),
            other => failure(
                "COMMAND_NOT_FOUND",
                &format!("the knowledge plugin has no command `{other}`"),
                "Call knowledge-search, knowledge-open, knowledge-find, knowledge-describe, knowledge-list, knowledge-changes or knowledge-index.",
            ),
        }
    }
}
