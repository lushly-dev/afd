//! Integration tests that install the global capturing tracing subscriber (`support/logs.rs`).
//!
//! Kept in a dedicated binary so CLI tests (which initialize `tracing_subscriber` via `cli::run`)
//! cannot race against `logs::install()` (#1774).
#![allow(dead_code, unreachable_pub, clippy::unwrap_used, clippy::expect_used)]

#[path = "../support/components.rs"]
mod components;
#[path = "../support/logs.rs"]
mod logs;
#[path = "../support/mounted.rs"]
mod mounted;
#[path = "../support/mod.rs"]
mod support;

mod auth_tokens;
mod call_metrics;
#[cfg(feature = "component")]
mod component_limits;
mod gateway_mode;
#[cfg(feature = "component")]
mod plugin_component;
mod token_canary;
