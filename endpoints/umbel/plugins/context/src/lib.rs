//! The `context` plugin (phase 3 specification, section 9): `context-bundle`, a budgeted bundle
//! of verified knowledge and pushed memory for a task or a session start.
//!
//! [`plugin`] is the SDK value; `umbel::plugins::sdk(umbel_plugin_context::plugin())` links it into
//! a host as `compiled:context`. It depends on no other plugin (D3, D78): it reads what the
//! knowledge plugin indexed and what the memory plugin stored through the host's `index`,
//! `documents` and `memory` grants, each optional, under the caller's reader filter.
//!
//! The order is fixed (sections 9.3 and 9.4): **select, place under the byte budget, render, cut
//! to `maxChars`, strip item text, measure.**
//!
//! - [`select`]: the task's terms, the knowledge lane and the memory lanes with section 9.3's
//!   push rule (`PushFilter`), authority tiers and `left_out` counts;
//! - [`place`]: section 9.4's shares, carry and second pass, and the omissions list;
//! - [`render`]: the quoted text block a harness injects (9.5);
//! - [`bundle`]: the result, its digest (9.6), labels, sources and warnings.
//!
//! Everything a bundle holds is untrusted content: it appears only in JSON string fields labeled
//! `trust: "content"` and in `> `-quoted lines of the rendered block, never in a message,
//! warning, reasoning or log line (D67). The command has effect `inspect`, holds no write grant
//! and is journaled as a digest, so neither the task nor the bundle enters the journal.
#![forbid(unsafe_code)]

mod bundle;
mod fail;
mod knowledge;
mod memory;
mod place;
mod render;
mod select;
mod settings;

use serde_json::Value;
use umbel_sdk::{Asset, Cx, Outcome, Plugin, failure};

/// The manifest of the compiled build.
pub const MANIFEST: &str = include_str!("../umbel-plugin.toml");

/// The context plugin.
#[derive(Debug, Clone, Copy, Default)]
pub struct Context;

/// The plugin as an SDK value.
pub fn plugin() -> Context {
    Context
}

impl Plugin for Context {
    fn manifest(&self) -> &'static str {
        MANIFEST
    }

    fn assets(&self) -> &'static [Asset] {
        umbel_sdk::embedded_assets!()
    }

    fn handle(&self, name: &str, input: Value, cx: &mut Cx) -> Outcome {
        match name {
            "context-bundle" => bundle::run(&input, cx),
            other => failure(
                "COMMAND_NOT_FOUND",
                &format!("the context plugin has no command `{other}`"),
                "Call context-bundle; context-guide describes it.",
            ),
        }
    }
}
