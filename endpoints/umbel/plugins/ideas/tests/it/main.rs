//! Consolidated integration tests for this crate (one test binary; #1774).
#![allow(dead_code, unreachable_pub, clippy::unwrap_used, clippy::expect_used)]

#[path = "../support/mod.rs"]
mod support;

mod archive;
mod capture;
mod hosted;
mod instructions;
mod journal;
mod label;
#[path = "match.rs"]
mod r#match;
mod no_plugin_dependency;
mod pack;
mod quota;
mod read;
mod report;
mod review_apply;
mod review_page;
mod review_stage;
mod scenarios;
mod surfaces;
