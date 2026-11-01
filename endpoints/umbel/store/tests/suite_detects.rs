//! The suite's own cases against a deliberately broken in-memory backend: it passes a correct
//! one and fails each broken one where it should (leaks, gaps, lost writes, lowered `applied`,
//! unfiltered co-citation weights).

mod support;

use support::{Fault, factory};
use umbel_store::conformance::run_all;

#[test]
fn a_correct_in_memory_backend_passes_every_case() {
    let report = run_all(&factory(Fault::None), None);
    report.assert_passed();
    assert!(report.passed() >= 40, "{report}");
    // Without a spawn_writer and an index, exactly these wait.
    assert_eq!(report.skipped().len(), 3, "{:?}", report.skipped());
}

/// Each fault, and a group that must fail because of it.
const DETECTED: &[(Fault, &str, &str)] = &[
    (
        Fault::GetLeaksUnreadable,
        "access",
        "documents_listed_and_fetched_per_reader",
    ),
    (
        Fault::GetAnswersNotFoundForUnreadable,
        "access",
        "an_unreadable_document_is_indistinguishable_from_an_absent_one",
    ),
    (
        Fault::ListLeaksUnreadable,
        "access",
        "documents_listed_and_fetched_per_reader",
    ),
    (
        Fault::ListUnordered,
        "documents",
        "listing_is_ordered_by_id_and_pages",
    ),
    (
        Fault::RecordsLeak,
        "access",
        "records_listed_and_fetched_per_reader",
    ),
    (
        Fault::ChangesLeak,
        "changes",
        "revisions_are_dense_only_under_derivation",
    ),
    (Fault::ChangesLeak, "access", "changes_per_reader"),
    (
        Fault::ChangesIgnoreTrace,
        "changes",
        "trace_filters_to_one_call",
    ),
    (
        Fault::DeleteChangeVisibleToAll,
        "changes",
        "a_delete_is_readable_by_the_deleted_versions_access",
    ),
    (
        Fault::RevisionGap,
        "documents",
        "revisions_are_consecutive_from_one",
    ),
    (
        Fault::RevisionGap,
        "concurrency",
        "two_threads_write_densely_and_a_reader_sees_whole_commits",
    ),
    (
        Fault::LostWrite,
        "concurrency",
        "two_threads_write_densely_and_a_reader_sees_whole_commits",
    ),
    (
        Fault::LostWrite,
        "access",
        "documents_listed_and_fetched_per_reader",
    ),
    (
        Fault::IgnoreExpect,
        "documents",
        "expect_is_a_compare_and_set",
    ),
    (
        Fault::IgnoreExpect,
        "records",
        "expect_is_a_compare_and_set",
    ),
    (
        Fault::SkipEnvelopeCheck,
        "envelope",
        "missing_access_or_sensitivity_is_refused",
    ),
    (
        Fault::LowerApplied,
        "graph",
        "applied_never_lowers_and_never_passes_head",
    ),
    (
        Fault::LowerApplied,
        "concurrency",
        "graph_applied_never_lowers_under_contention",
    ),
    (Fault::ApplyNotAtomic, "graph", "apply_is_one_transaction"),
    (
        Fault::UnfilteredCoCitation,
        "graph",
        "weights_aggregate_over_readable_origins_only",
    ),
    (Fault::UnfilteredCoCitation, "access", "graph_per_reader"),
    (
        Fault::EdgeEndpointLeak,
        "graph",
        "endpoints_and_origins_are_both_checked",
    ),
    (Fault::NodeLeak, "access", "graph_per_reader"),
    (Fault::SubgraphLeak, "access", "graph_per_reader"),
    (
        Fault::ReplaceKeepsOldEdges,
        "graph",
        "apply_replaces_one_origins_contribution",
    ),
];

#[test]
fn each_broken_backend_fails_where_it_should() {
    for (fault, group, case) in DETECTED {
        let report = run_all(&factory(*fault), None);
        let failed = report
            .group(group)
            .into_iter()
            .flat_map(|g| &g.cases)
            .any(|c| {
                c.name == *case && matches!(c.outcome, umbel_store::conformance::Outcome::Failed(_))
            });
        assert!(
            failed,
            "{fault:?} was not caught by {group}::{case}:\n{report}"
        );
    }
}

#[test]
fn every_fault_is_caught_by_something() {
    use Fault::*;
    for fault in [
        GetLeaksUnreadable,
        GetAnswersNotFoundForUnreadable,
        ListLeaksUnreadable,
        ListUnordered,
        RecordsLeak,
        ChangesLeak,
        ChangesIgnoreTrace,
        DeleteChangeVisibleToAll,
        RevisionGap,
        LostWrite,
        IgnoreExpect,
        SkipEnvelopeCheck,
        LowerApplied,
        ApplyNotAtomic,
        UnfilteredCoCitation,
        EdgeEndpointLeak,
        NodeLeak,
        SubgraphLeak,
        ReplaceKeepsOldEdges,
    ] {
        assert!(
            DETECTED.iter().any(|(f, ..)| *f == fault),
            "{fault:?} has no detection row"
        );
    }
}
