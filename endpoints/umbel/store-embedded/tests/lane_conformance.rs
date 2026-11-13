//! The conformance suite's `lane`, `standing` and `matching` groups alone, against the embedded backend
//! (records host specification, section 15.1): the part of the suite a change to the record
//! lane touches. `conformance.rs` runs the whole suite, these groups included.

mod support;

use support::{open, spawn_writer};

#[test]
fn the_lane_group_passes() {
    let report = umbel_store::conformance::run_groups(&open, Some(spawn_writer), &["lane"]);
    println!("{report}");
    report.assert_passed();
    let skipped = report.skipped();
    assert!(skipped.is_empty(), "skipped: {skipped:?}");
    assert_eq!(report.passed(), 16, "{report}");
}

#[test]
fn the_standing_group_passes() {
    let report = umbel_store::conformance::run_groups(&open, Some(spawn_writer), &["standing"]);
    println!("{report}");
    report.assert_passed();
    let skipped = report.skipped();
    assert!(skipped.is_empty(), "skipped: {skipped:?}");
    assert_eq!(report.passed(), 17, "{report}");
}

#[test]
fn the_matching_group_passes() {
    let report = umbel_store::conformance::run_groups(&open, Some(spawn_writer), &["matching"]);
    println!("{report}");
    report.assert_passed();
    let skipped = report.skipped();
    assert!(skipped.is_empty(), "skipped: {skipped:?}");
    assert_eq!(report.passed(), 15, "{report}");
}

#[test]
fn writer_child() {
    support::writer_child();
}
