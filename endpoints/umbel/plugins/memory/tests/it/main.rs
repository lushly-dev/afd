//! Consolidated integration tests for this crate (one test binary; #1774).
#![allow(dead_code, unreachable_pub, clippy::unwrap_used, clippy::expect_used)]

#[path = "../hosted_kit/mod.rs"]
mod hosted_kit;
#[path = "../support/mod.rs"]
mod support;

mod bitemporal;
mod capture;
mod confirm;
mod confirm_preview;
mod editors;
mod erase;
mod events;
mod forget;
mod hygiene;
mod import_export;
mod invalidate;
mod quota;
mod recall_scope;
mod remember;
mod retention;
mod security;
