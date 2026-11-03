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
//! - `memory-show` reads one record as `memory-record.v1.json`, labeled with its state;
//! - `memory-status` counts what the caller can read, its usage and quota, the key file's state,
//!   and how many of its records the default push admits.
//!
//! Recorded text is untrusted content: it appears only in JSON string fields labeled `trust:
//! "content"`, and never in a message, warning, reasoning or log line (D67). Every command is
//! journaled as a digest except `memory-status`, which holds no text.
#![forbid(unsafe_code)]

mod budget;
mod capture;
mod fail;
mod hygiene;
mod pipeline;
mod policy;
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
            "memory-show" => show::run(&input, cx),
            "memory-status" => status::run(&input, cx),
            other => failure(
                "COMMAND_NOT_FOUND",
                &format!("the memory plugin has no command `{other}`"),
                "Call memory-remember, memory-capture, memory-show or memory-status.",
            ),
        }
    }
}
