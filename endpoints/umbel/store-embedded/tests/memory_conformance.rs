//! The memory groups (phase 3 section 5.5) against the embedded memory store, on its own: no
//! document store or index beside it. `conformance.rs` runs them again inside `run_all`, on the
//! stores' `memory`. Until step 3b supplies `memory_restore`, the erasure group's copy case is
//! the only one skipped.

mod support;

use support::{memory_factory, spawn_memory_writer};
use umbel_store::conformance::{MEMORY_GROUPS, run_memory};

const BACKUP: &str = "memory_erasure::a_backup_from_before_a_forget_cannot_be_read";

#[test]
fn the_memory_groups_pass() {
    let report = run_memory(&memory_factory, None, Some(spawn_memory_writer));
    println!("{report}");
    report.assert_passed();
    let names: Vec<_> = report.groups.iter().map(|g| g.name).collect();
    assert_eq!(names, MEMORY_GROUPS, "every group runs, in order");
    let skipped = report.skipped();
    assert_eq!(skipped.len(), 1, "{skipped:?}");
    assert!(
        skipped[0].starts_with(BACKUP) && skipped[0].contains("no memory_restore"),
        "{skipped:?}"
    );
    assert_eq!(report.passed(), 43, "{report}");
}

#[test]
fn writer_child() {
    support::writer_child();
}
