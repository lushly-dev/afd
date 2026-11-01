//! The conformance suite against the SQLite backend: every group that does not need the index.

mod support;

use support::{open, spawn_writer};

#[test]
fn the_suite_passes() {
    let report = umbel_store::conformance::run_all(&open, Some(spawn_writer));
    println!("{report}");
    report.assert_passed();
    // Only the index cases wait for step 3; nothing else may be skipped.
    let skipped = report.skipped();
    assert!(
        skipped.iter().all(|s| s.contains("index")),
        "unexpected skips: {skipped:?}"
    );
    assert!(
        report.passed() >= 40,
        "the suite ran only {} cases",
        report.passed()
    );
}

#[test]
fn writer_child() {
    support::writer_child();
}
