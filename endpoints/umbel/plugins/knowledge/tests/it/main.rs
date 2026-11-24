//! Consolidated integration tests for this crate (one test binary; #1774).
#![allow(dead_code, unreachable_pub, clippy::unwrap_used, clippy::expect_used)]

#[path = "../relay_kit/mod.rs"]
mod relay_kit;
#[path = "../support/mod.rs"]
mod support;

mod auto_approve;
mod budgets;
mod chunking;
#[cfg(not(feature = "code"))]
mod code_off;
#[cfg(feature = "code")]
mod code_symbols;
mod drafted;
mod eval_fixture;
mod eval_gate;
mod exit_thousand;
mod graph;
mod index;
mod journal_modes;
mod open_find;
mod preview;
mod proposals;
mod proposals_v2;
mod query_syntax;
mod redaction;
mod relay;
mod search;
mod security;
mod smoke;
mod spaces;
mod tasks;
mod verification;
mod verify_drafts;
