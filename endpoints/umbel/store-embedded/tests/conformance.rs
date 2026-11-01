//! The conformance suite against the embedded backend: SQLite for documents, records and the graph,
//! tantivy for the index.

mod support;

use support::{open, spawn_writer};

#[test]
fn the_suite_passes() {
    let report = umbel_store::conformance::run_all(&open, Some(spawn_writer));
    println!("{report}");
    report.assert_passed();
    // The backend has every store and spawns its writers: nothing is skipped.
    assert!(report.skipped().is_empty(), "skipped: {:?}", report.skipped());
    assert!(
        report.passed() >= 55,
        "the suite ran only {} cases",
        report.passed()
    );
}

#[test]
fn writer_child() {
    support::writer_child();
}
