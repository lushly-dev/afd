//! Consolidated integration tests for this crate (one test binary; #1774).
#![allow(dead_code, unreachable_pub, clippy::unwrap_used, clippy::expect_used)]

#[path = "../support/mod.rs"]
mod support;

mod access_rule;
mod config;
mod conflicts;
mod deterministic;
mod draft;
mod feedback;
mod forgotten;
mod no_plugin_dependency;
mod not_request_path;
mod poisoning;
mod promote;
mod reverify;
mod run;
mod settle;
