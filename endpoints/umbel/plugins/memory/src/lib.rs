//! The `memory` plugin (phase 3 specification, section 8): memory records with class labels,
//! scoped by space and bitemporal, written through the host's `memory_write` grant and read
//! through its `memory` grant, under the caller's reader filter.
//!
//! [`plugin`] is the SDK value; `umbel::plugins::sdk(umbel_plugin_memory::plugin())` links it into
//! a host as `compiled:memory`, and the `umbel-memory` binary is the `umbel` command line with it
//! compiled in (the stock `umbel` binary stays empty).
//!
//! - `memory-remember` writes one fact through the write pipeline of section 8.2: shape, mask
//!   secrets with the `hygiene` pack, scan, hash, expiry by the `policy` pack. The host fills the
//!   identity, the authority (`person` only after the terminal prompt) and the access set;
//! - `memory-capture` writes one window of a harness session by the capture contract, version 1:
//!   always private, authority `transcript` or `agent`;
//! - `memory-recall` ranks what the caller can read against a query, and `memory-list` lists it
//!   newest first with a cursor, both under the filters and project rule of section 8.4 and the
//!   two instants of section 4.1;
//! - `memory-show` reads one record as `memory-record.v1.json`, labeled with its state;
//! - `memory-invalidate` closes a record's validity with a new version (the owner's, or a listed
//!   editor's as a person, phase 5 section 8.3), and `memory-confirm` (a person at a terminal, or
//!   on the person page over MCP, own records only) gives it authority `person`, after
//!   `memory-preview` shows the record;
//! - `memory-erase` (phase 5 section 8.4) removes another principal's records, blind, for a listed
//!   eraser verified on the person page, after a dry run, with an optional two-person rule, and
//!   `memory-erase-preview` shows what the person confirms;
//! - `memory-forget` erases the caller's own records, by id or, for a person, by selector;
//! - `memory-sweep` purges what is past its purge date and `memory-reindex` rebuilds the lexical
//!   lane, removing orphan keys only when asked;
//! - `memory-status` counts what the caller can read, its usage and quota, the key file's state,
//!   and how many of its records the default push admits;
//! - `memory-import` writes a harness's memory files, as an adapter read them, with authority
//!   `import`, and `memory-export` returns the caller's own live records, never flagged or
//!   `transcript` ones, for an adapter to write out. Both are the command line's alone.
//!
//! Recorded text is untrusted content: it appears only in JSON string fields labeled `trust:
//! "content"`, and never in a message, warning, reasoning or log line (D67). Every command is
//! journaled as a digest except `memory-status`, `memory-sweep` and `memory-reindex`, which hold
//! no text.
#![forbid(unsafe_code)]

mod budget;
mod capture;
mod confirm;
mod erase;
mod export;
mod fail;
mod filters;
mod forget;
mod hygiene;
mod import;
mod invalidate;
mod list;
mod maintain;
mod owned;
mod pipeline;
mod policy;
mod preview;
mod recall;
mod remember;
mod show;
mod status;

use serde_json::Value;
use umbel_sdk::{Asset, Cx, Outcome, Plugin, failure};

/// The manifest of the compiled build.
pub const MANIFEST: &str = include_str!("../umbel-plugin.toml");

/// The memory plugin.
#[derive(Debug, Clone, Copy, Default)]
pub struct Memory;

/// The plugin as an SDK value.
pub fn plugin() -> Memory {
    Memory
}

impl Plugin for Memory {
    fn manifest(&self) -> &'static str {
        MANIFEST
    }

    fn assets(&self) -> &'static [Asset] {
        umbel_sdk::embedded_assets!()
    }

    fn handle(&self, name: &str, input: Value, cx: &mut Cx) -> Outcome {
        match name {
            "memory-remember" => remember::run(&input, cx),
            "memory-capture" => capture::run(&input, cx),
            "memory-recall" => recall::run(&input, cx),
            "memory-list" => list::run(&input, cx),
            "memory-show" => show::run(&input, cx),
            "memory-invalidate" => invalidate::run(&input, cx),
            "memory-confirm" => confirm::run(&input, cx),
            "memory-preview" => preview::run(&input, cx),
            "memory-erase" => erase::run(&input, cx),
            "memory-erase-preview" => erase::preview(&input, cx),
            "memory-forget" => forget::run(&input, cx),
            "memory-sweep" => maintain::sweep(&input, cx),
            "memory-reindex" => maintain::reindex(&input, cx),
            "memory-status" => status::run(&input, cx),
            "memory-import" => import::run(&input, cx),
            "memory-export" => export::run(&input, cx),
            other => failure(
                "COMMAND_NOT_FOUND",
                &format!("the memory plugin has no command `{other}`"),
                "Call one of the memory plugin's commands; memory-guide lists them.",
            ),
        }
    }
}
