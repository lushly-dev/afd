//! The memory groups (phase 3 section 5.5) against the embedded memory store, on its own: no
//! document store or index beside it. `conformance.rs` runs them again inside `run_all`, on the
//! stores' `memory`. With `memory_restore` (phase 3 step 3b) nothing is skipped: the erasure
//! group's copy case restores a `backup` copy beside the current key file.

mod support;

use support::{memory_factory, restore_memory, spawn_memory_writer};
use umbel_store::conformance::{MEMORY_GROUPS, run_memory};

#[test]
fn the_memory_groups_pass() {
    let report = run_memory(
        &memory_factory,
        Some(restore_memory),
        Some(spawn_memory_writer),
    );
    println!("{report}");
    report.assert_passed();
    let names: Vec<_> = report.groups.iter().map(|g| g.name).collect();
    assert_eq!(names, MEMORY_GROUPS, "every group runs, in order");
    let skipped = report.skipped();
    assert!(skipped.is_empty(), "{skipped:?}");
    assert_eq!(report.passed(), 44, "{report}");
}

#[test]
fn writer_child() {
    support::writer_child();
}
