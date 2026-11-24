//! Consolidated integration tests for this crate (one test binary; #1774).
#![allow(dead_code, unreachable_pub, clippy::unwrap_used, clippy::expect_used)]

#[path = "../support/mod.rs"]
mod support;

mod curator_drafts;
mod curator_leaks;
mod curator_run;
mod exact_filtering;
mod exit_curator;
mod exit_memory;
mod first_class;
mod forget_bytes;
mod hook_smoke;
mod ideas_first_use;
mod import_export;
mod knowledge_process;
mod leak_probes;
mod memory_process;
mod poisoning;
