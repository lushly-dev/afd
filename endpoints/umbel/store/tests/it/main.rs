//! Consolidated integration tests for this crate (one test binary; #1774).
#![allow(dead_code, unreachable_pub, clippy::unwrap_used, clippy::expect_used)]

#[path = "../memory_support/mod.rs"]
mod memory_support;
#[path = "../support/mod.rs"]
mod support;

mod lane_fixture;
mod lane_normalise;
mod lane_score;
mod memory_query;
mod memory_suite_detects;
mod memory_tokenizer;
mod suite_detects;
