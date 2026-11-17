//! A component built with `umbel-sdk`, so against WIT world 1.1.0: its one command answers the
//! call's output budget as data (the world 1.1.0 specification, section 9), and a command ending in
//! `-events` reads the event log through `events@1.1.0`. The component build
//! needs `--features component`.
#![cfg_attr(not(feature = "component"), forbid(unsafe_code))]

use serde_json::{Value, json};
use umbel_sdk::{Cx, Outcome, Plugin, success};

/// The fixture plugin. Its manifest is the test's; this one is never read.
#[derive(Debug, Clone, Copy)]
pub struct Budget;

impl Plugin for Budget {
    fn manifest(&self) -> &'static str {
        ""
    }

    fn handle(&self, name: &str, _input: Value, cx: &mut Cx) -> Outcome {
        if name.ends_with("-events") {
            return match cx.events(None, None, 1) {
                Ok(listed) => success(json!({ "events": listed })),
                Err(error) => success(json!({ "error": error.to_string() })),
            };
        }
        success(json!({ "budget": cx.call().output_budget }))
    }
}

#[cfg(feature = "component")]
umbel_sdk::export_component!(Budget);
