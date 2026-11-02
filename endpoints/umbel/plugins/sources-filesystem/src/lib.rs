//! The `sources-filesystem` plugin (phase 2 specification, section 5): collections of markdown
//! and code files read into the document store.
//!
//! [`plugin`] is the SDK value; `umbel::plugins::sdk(umbel_plugin_sources_filesystem::plugin())`
//! links it into a host as `compiled:sources` (a plugin id is letters and digits only, so the
//! plugin is `sources`, whose domain owns the `sources-` commands). It has two commands:
//!
//! - `sources-sync` walks each collection root (through the host's confined `content` grant, so a
//!   symbolic link is never followed and no path outside a root is ever reachable), detects
//!   changes by size and modification time and then by SHA-256 of the bytes, and writes a
//!   document for each new or changed file and a tombstone for each removed one, with
//!   compare-and-set writes;
//! - `sources-status` is the same walk without reading or writing.
//!
//! Both return **totals plus the ids the caller can read** (owner decision 1): they see every
//! file and the sync writes documents the caller may not read, so an id appears only when the
//! caller's reader filter admits the document. Paths of files with no stored document are listed
//! only to a person at the command line. Content is flagged by the write scan and never blocked.
#![forbid(unsafe_code)]

mod access;
mod collection;
mod document;
mod fail;
mod report;
mod state;
mod status;
mod sync;

use serde_json::Value;
use umbel_sdk::{Asset, Cx, Outcome, Plugin, failure};

/// The manifest of the compiled build.
pub const MANIFEST: &str = include_str!("../umbel-plugin.toml");

/// The sources-filesystem plugin.
#[derive(Debug, Clone, Copy, Default)]
pub struct SourcesFilesystem;

/// The plugin as an SDK value.
pub fn plugin() -> SourcesFilesystem {
    SourcesFilesystem
}

impl Plugin for SourcesFilesystem {
    fn manifest(&self) -> &'static str {
        MANIFEST
    }

    fn assets(&self) -> &'static [Asset] {
        umbel_sdk::embedded_assets!()
    }

    fn handle(&self, name: &str, input: Value, cx: &mut Cx) -> Outcome {
        match name {
            "sources-sync" => sync::run(&input, cx),
            "sources-status" => status::run(&input, cx),
            other => failure(
                "COMMAND_NOT_FOUND",
                &format!("the sources-filesystem plugin has no command `{other}`"),
                "Call sources-sync or sources-status.",
            ),
        }
    }
}
