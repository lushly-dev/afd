//! Consolidated integration tests for this crate (one test binary; #1774).
#![allow(dead_code, unreachable_pub, clippy::unwrap_used, clippy::expect_used)]

#[path = "../support/mod.rs"]
mod support;

#[test]
fn writer_child() {
    support::writer_child();
}

mod conformance;
mod connection_limit;
mod index;
mod index_suite_detects;
mod lane_conformance;
mod lane_delete_bytes;
mod lane_rebuild;
mod lane_schema;
mod lane_standing_rows;
mod lane_suite_detects;
mod memory_backup;
mod memory_conformance;
mod memory_erase;
mod memory_erasure_bytes;
mod memory_keyfile;
mod memory_machine_backup;
mod memory_multiprocess;
mod memory_seal;
mod memory_sqlite;
mod multiprocess;
mod partitioned_stats;
mod query_syntax;
mod secure_delete;
mod sqlite;
