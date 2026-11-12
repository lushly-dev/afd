//! The conformance suite against the embedded backend: SQLite for documents, records and the graph,
//! tantivy for the index, and the memory store in its own SQLite database with its key file
//! (phase 3 steps 3a and 3b).

mod support;

use support::{open, spawn_writer};

#[test]
fn the_suite_passes() {
    let report = umbel_store::conformance::run_all(&open, Some(spawn_writer));
    println!("{report}");
    report.assert_passed();
    // The backend has every store, spawns its writers and restores a memory backup: nothing is
    // skipped.
    let skipped = report.skipped();
    assert!(skipped.is_empty(), "skipped: {skipped:?}");
    assert!(
        report.passed() >= 55 + 16 + 16 + 44,
        "the suite ran only {} cases",
        report.passed()
    );
    // The record lane's groups (the records host specification, section 15.1), whole.
    let lane = report.group("lane").expect("the lane group ran");
    assert_eq!(lane.cases.len(), 16, "{lane:?}");
    let standing = report.group("standing").expect("the standing group ran");
    assert_eq!(standing.cases.len(), 16, "{standing:?}");
}

#[test]
fn writer_child() {
    support::writer_child();
}
