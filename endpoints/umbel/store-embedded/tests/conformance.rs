//! The conformance suite against the embedded backend: SQLite for documents, records and the graph,
//! tantivy for the index, and the memory store in its own SQLite database (phase 3 step 3a).

mod support;

use support::{open, spawn_writer};

#[test]
fn the_suite_passes() {
    let report = umbel_store::conformance::run_all(&open, Some(spawn_writer));
    println!("{report}");
    report.assert_passed();
    // The backend has every store and spawns its writers: nothing is skipped but the memory copy
    // case, which waits for `memory_restore` (phase 3 step 3b).
    let skipped = report.skipped();
    assert_eq!(skipped.len(), 1, "skipped: {skipped:?}");
    assert!(
        skipped[0].starts_with("memory_erasure::a_backup_from_before_a_forget_cannot_be_read"),
        "skipped: {skipped:?}"
    );
    assert!(
        report.passed() >= 55 + 43,
        "the suite ran only {} cases",
        report.passed()
    );
}

#[test]
fn writer_child() {
    support::writer_child();
}
