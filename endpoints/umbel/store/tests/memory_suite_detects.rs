//! The memory groups against a deliberately broken in-memory backend (phase 3 section 5.5): they
//! pass a correct one and fail each broken one where they should (an unfiltered read, an
//! overwriting invalidate, a forget that keeps the text, a forget that deletes rows but keeps a
//! key, a quota checked outside the transaction, and more).

mod memory_support;

use memory_support::{MemoryFault, memory_factory, memory_restore};
use umbel_store::conformance::{MEMORY_GROUPS, Outcome, Report, run_memory, run_memory_groups};

const PROCESSES: &str = "memory_concurrency::two_processes_write_densely";
const BACKUP: &str = "memory_erasure::a_backup_from_before_a_forget_cannot_be_read";

fn skipped_names(report: &Report) -> Vec<String> {
    report
        .groups
        .iter()
        .flat_map(|g| {
            g.cases
                .iter()
                .filter(|c| matches!(c.outcome, Outcome::Skipped(_)))
                .map(move |c| format!("{}::{}", g.name, c.name))
        })
        .collect()
}

#[test]
fn a_correct_in_memory_backend_passes_every_memory_case() {
    let report = run_memory(
        &memory_factory(MemoryFault::None),
        Some(memory_restore),
        None,
    );
    println!("{report}");
    report.assert_passed();
    let names: Vec<_> = report.groups.iter().map(|g| g.name).collect();
    assert_eq!(names, MEMORY_GROUPS, "every group runs, in order");
    // Only the multi-process case waits: the fake spawns no writer.
    assert_eq!(skipped_names(&report), [PROCESSES], "{report}");
    assert!(report.passed() >= 35, "{report}");
}

#[test]
fn without_a_restore_only_the_backup_copy_case_is_skipped() {
    let report = run_memory_groups(
        &memory_factory(MemoryFault::None),
        None,
        None,
        &["memory_erasure"],
    );
    report.assert_passed();
    assert_eq!(skipped_names(&report), [BACKUP], "{report}");
    assert!(
        report
            .skipped()
            .iter()
            .all(|s| s.contains("no memory_restore")),
        "{report}"
    );
}

/// Each fault, and a case that must fail because of it.
const DETECTED: &[(MemoryFault, &str, &str)] = &[
    (
        MemoryFault::UnfilteredRead,
        "memory_access",
        "every_read_returns_only_readable_records",
    ),
    (
        MemoryFault::UnfilteredRead,
        "memory_access",
        "list_and_recall_apply_the_push_rule",
    ),
    (
        MemoryFault::OverwritingInvalidate,
        "memory_bitemporal",
        "the_four_questions_over_a_timeline",
    ),
    (
        MemoryFault::OverwritingInvalidate,
        "memory_bitemporal",
        "closing_keeps_the_old_version_readable_by_recorded",
    ),
    (
        MemoryFault::ForgetKeepsText,
        "memory_erasure",
        "a_forget_leaves_nothing_readable",
    ),
    (
        MemoryFault::ForgetKeepsKey,
        "memory_erasure",
        "a_backup_from_before_a_forget_cannot_be_read",
    ),
    (
        MemoryFault::QuotaOutsideTransaction,
        "memory_quota",
        "limits_hold_inside_the_transaction_under_two_writers",
    ),
    (
        MemoryFault::RequiredIsOptional,
        "memory_recall",
        "a_required_term_beside_a_plain_one",
    ),
    (
        MemoryFault::RequiredIsOptional,
        "memory_recall",
        "every_query_form_returns_its_hit_set",
    ),
    (
        MemoryFault::GlobalIdempotency,
        "memory_access",
        "an_idempotency_key_is_the_owners",
    ),
    (
        MemoryFault::ExpiryAtValidInstant,
        "memory_lifecycle",
        "expiry_is_measured_at_now",
    ),
];

#[test]
fn each_broken_backend_fails_where_it_should() {
    for (fault, group, case) in DETECTED {
        let report = run_memory_groups(
            &memory_factory(*fault),
            Some(memory_restore),
            None,
            &[*group],
        );
        let failed = report
            .group(group)
            .into_iter()
            .flat_map(|g| &g.cases)
            .any(|c| c.name == *case && matches!(c.outcome, Outcome::Failed(_)));
        assert!(
            failed,
            "{fault:?} was not caught by {group}::{case}:\n{report}"
        );
    }
}

#[test]
fn every_fault_is_caught_by_something() {
    use MemoryFault::*;
    for fault in [
        UnfilteredRead,
        OverwritingInvalidate,
        ForgetKeepsText,
        ForgetKeepsKey,
        QuotaOutsideTransaction,
        RequiredIsOptional,
        GlobalIdempotency,
        ExpiryAtValidInstant,
    ] {
        assert!(
            DETECTED.iter().any(|(f, ..)| *f == fault),
            "{fault:?} has no detection row"
        );
    }
}
