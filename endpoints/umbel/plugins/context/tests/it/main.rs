//! Consolidated integration tests for this crate (one test binary; #1774).
#![allow(dead_code, unreachable_pub, clippy::unwrap_used, clippy::expect_used)]

#[path = "../support/mod.rs"]
mod support;

mod budget;
mod deterministic;
mod labels;
mod lanes_absent;
mod no_plugin_dependency;
mod render;
mod selection;
