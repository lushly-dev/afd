//! The suite's `lane` and `standing` groups fail on a broken backend (records host
//! specification, section 15.1): the embedded store behind a wrapper that breaks one rule of
//! the lane, or of standing, at a time, as `index_suite_detects.rs` does for the index.
//! Unbroken, the wrapper passes both groups.

// Integration-test helpers fail by panicking; clippy exempts only `#[test]` bodies themselves.
#![allow(clippy::expect_used, clippy::unwrap_used)]

use std::cell::Cell;
use std::path::Path;
use std::sync::Arc;

use serde_json::Value;
use umbel_store::conformance::{Outcome, Stores, run_groups};
use umbel_store::lane::{
    Decided, Decision, DeclaredPut, FindOrder, FindPage, LaneLimits, LaneRecord, LaneStatus,
    LaneWrite, Marked, OwnInfo, OwnMark, RecordDecision, RecordDecl, RecordFind, ReindexReport,
    Standing, StandingView,
};
use umbel_store::{
    AccessSet, Change, ContentHash, DocMeta, Document, DocumentStore, DocumentWrite, Embedder,
    Envelope, Expect, ListQuery, MemoryFlag, Page, ReaderFilter, Record, RecordMeta, Rev,
    StoreError,
};
use umbel_store_embedded::{SqliteStore, StoreOptions};

/// What is broken.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Fault {
    None,
    /// `read_record` returns a record whoever asks.
    ReadIgnoresReader,
    /// `find_records` returns and counts every record, whoever asks.
    FindIgnoresReader,
    /// A page holds the reader's records, and its total counts everyone's.
    TotalCountsUnreadable,
    /// A ranked page holds the reader's records, ordered by statistics over everyone's.
    RankingCountsUnreadable,
    /// A ranked page is in id order.
    RankIgnored,
    /// A page never has a cursor.
    CursorLost,
    /// `cut` is never set.
    CutNeverSet,
    /// An undeclared put is followed by nothing: a rebuild runs at once, so the mark is lost.
    StaleServed,
    /// A read forgets which collections a command can write files into, so a mark counts
    /// wherever it was made.
    MarksCountWhereCommandsWrite,
    /// A read admits every standing, whatever its view admits.
    AdmitIgnored,
    /// A decision reaches a record whoever decides.
    DecideIgnoresReader,
    /// A withdrawal writes nothing.
    WithdrawKept,
    /// A label shows its source to a reader who may not read the cited document.
    SourceShownToEveryone,
    /// A mark naming other content than the document's is made on the document's.
    MarkIgnoresContent,
    /// Every stored document counts as held to its file, whoever put it.
    EveryDocumentHeld,
    /// A read counts the decisions and marks of a person the space no longer has.
    FormerPersonCounts,
}

thread_local! {
    /// The fault of the suite this thread runs: the suite's `LaneOpen` is a plain function.
    static FAULT: Cell<Fault> = const { Cell::new(Fault::None) };
}

struct Faulty {
    inner: SqliteStore,
    fault: Fault,
}

/// A reader of every record the suite writes.
fn everything() -> ReaderFilter {
    ReaderFilter::tokens([
        "space",
        "group:growers",
        "group:other",
        "principal:human:local",
    ])
    .unwrap()
}

/// The view a faulty read runs under.
fn faulty_view(fault: Fault, view: &StandingView) -> StandingView {
    let mut view = view.clone();
    match fault {
        Fault::MarksCountWhereCommandsWrite => view.command_writable.clear(),
        Fault::AdmitIgnored => {
            view.admit = vec![Standing::Unverified, Standing::Attested, Standing::Affirmed];
        }
        // The suite's first person, whoever the view of the read names.
        Fault::FormerPersonCounts => view.person.push("human:local".to_owned()),
        _ => {}
    }
    view
}

fn readable(record: &LaneRecord, reader: &ReaderFilter) -> bool {
    AccessSet::new(record.record.envelope.access.iter().map(String::as_str))
        .is_ok_and(|access| reader.admits(&access))
}

impl DocumentStore for Faulty {
    fn put_document(&self, doc: DocumentWrite, expect: Expect) -> Result<DocMeta, StoreError> {
        if self.fault == Fault::EveryDocumentHeld {
            return self.inner.put_document_held(doc, expect);
        }
        self.inner.put_document(doc, expect)
    }
    fn put_document_held(&self, doc: DocumentWrite, expect: Expect) -> Result<DocMeta, StoreError> {
        self.inner.put_document_held(doc, expect)
    }
    fn hold_document(&self, doc: &str, hash: &ContentHash) -> Result<bool, StoreError> {
        self.inner.hold_document(doc, hash)
    }
    fn unheld_documents(&self, collection: &str) -> Result<u64, StoreError> {
        self.inner.unheld_documents(collection)
    }
    fn delete_document(
        &self,
        id: &str,
        expect: Expect,
        envelope: Envelope,
    ) -> Result<Rev, StoreError> {
        self.inner.delete_document(id, expect, envelope)
    }
    fn get_document(
        &self,
        id: &str,
        reader: &ReaderFilter,
    ) -> Result<Option<Document>, StoreError> {
        self.inner.get_document(id, reader)
    }
    fn list_documents(
        &self,
        query: &ListQuery,
        reader: &ReaderFilter,
    ) -> Result<Page<DocMeta>, StoreError> {
        self.inner.list_documents(query, reader)
    }
    fn changes(
        &self,
        after: Rev,
        limit: u32,
        reader: &ReaderFilter,
        trace: Option<&str>,
    ) -> Result<Vec<Change>, StoreError> {
        self.inner.changes(after, limit, reader, trace)
    }
    fn head(&self) -> Result<Rev, StoreError> {
        self.inner.head()
    }
    fn put_record(
        &self,
        ns: &str,
        kind: &str,
        id: &str,
        body: Value,
        envelope: Envelope,
        expect: Expect,
    ) -> Result<RecordMeta, StoreError> {
        let meta = self
            .inner
            .put_record(ns, kind, id, body, envelope, expect)?;
        if self.fault == Fault::StaleServed {
            // Whatever declaration the store holds for the kind, serve it again at once.
            let stored = self
                .inner
                .lane_status(ns, &placeholder(kind))?
                .stored
                .and_then(|text| serde_json::from_str::<Value>(&text).ok());
            if let Some(decl) = stored.as_ref().and_then(declaration) {
                self.inner
                    .reindex_records(ns, &decl, &|_| Vec::new(), None, false)?;
            }
        }
        Ok(meta)
    }
    fn get_record(
        &self,
        ns: &str,
        kind: &str,
        id: &str,
        reader: &ReaderFilter,
    ) -> Result<Option<Record>, StoreError> {
        self.inner.get_record(ns, kind, id, reader)
    }
    fn list_records(
        &self,
        ns: &str,
        kind: &str,
        after: Option<&str>,
        limit: u32,
        reader: &ReaderFilter,
    ) -> Result<Page<Record>, StoreError> {
        self.inner.list_records(ns, kind, after, limit, reader)
    }
    fn put_declared_record(
        &self,
        ns: &str,
        decl: &RecordDecl,
        id: &str,
        body: Value,
        envelope: Envelope,
        expect: Expect,
        lane: LaneWrite,
        writer: &ReaderFilter,
    ) -> Result<DeclaredPut, StoreError> {
        self.inner
            .put_declared_record(ns, decl, id, body, envelope, expect, lane, writer)
    }
    fn read_record(
        &self,
        ns: &str,
        decl: &RecordDecl,
        id: &str,
        view: &StandingView,
        reader: &ReaderFilter,
    ) -> Result<Option<LaneRecord>, StoreError> {
        if self.fault == Fault::ReadIgnoresReader && !reader.is_derivation() {
            return self.inner.read_record(ns, decl, id, view, &everything());
        }
        let view = &faulty_view(self.fault, view);
        let mut found = self.inner.read_record(ns, decl, id, view, reader)?;
        if self.fault == Fault::SourceShownToEveryone
            && let Some(record) = &mut found
        {
            // The label a reader of every document would be given.
            record.label = self
                .inner
                .read_record(ns, decl, id, view, &everything())?
                .and_then(|seen| seen.label);
        }
        Ok(found)
    }
    fn find_records(
        &self,
        ns: &str,
        decl: &RecordDecl,
        query: &RecordFind,
        view: &StandingView,
        reader: &ReaderFilter,
    ) -> Result<FindPage, StoreError> {
        let asked = view.admit.clone();
        let view = &faulty_view(self.fault, view);
        let honest = self
            .inner
            .find_records(ns, decl, query, view, reader)
            .map(|page| FindPage {
                admitted: asked,
                ..page
            });
        if reader.is_derivation() {
            return honest;
        }
        let ranked = query.order == FindOrder::Rank;
        match self.fault {
            Fault::FindIgnoresReader => {
                self.inner
                    .find_records(ns, decl, query, view, &everything())
            }
            Fault::TotalCountsUnreadable => {
                let mut page = honest?;
                page.total = self
                    .inner
                    .find_records(ns, decl, query, view, &everything())?
                    .total;
                Ok(page)
            }
            Fault::RankingCountsUnreadable if ranked => {
                honest?;
                let whole = RecordFind {
                    after: None,
                    limit: 200,
                    ..query.clone()
                };
                let mut page = self
                    .inner
                    .find_records(ns, decl, &whole, view, &everything())?;
                page.items.retain(|item| readable(item, reader));
                page.total = query.total.then_some(page.items.len() as u64);
                page.next = None;
                Ok(page)
            }
            Fault::RankIgnored if ranked => {
                let mut page = honest?;
                page.items.sort_by(|a, b| a.record.id.cmp(&b.record.id));
                Ok(page)
            }
            Fault::CursorLost => honest.map(|page| FindPage { next: None, ..page }),
            Fault::CutNeverSet => honest.map(|page| FindPage { cut: false, ..page }),
            _ => honest,
        }
    }
    fn decide_record(
        &self,
        ns: &str,
        decl: &RecordDecl,
        id: &str,
        decision: RecordDecision,
        view: &StandingView,
        reader: &ReaderFilter,
    ) -> Result<Decided, StoreError> {
        match self.fault {
            Fault::DecideIgnoresReader if !reader.is_derivation() => {
                self.inner
                    .decide_record(ns, decl, id, decision, view, &everything())
            }
            Fault::WithdrawKept if decision.decision == Decision::Withdraw => {
                // Answer as if it had been withdrawn, and write nothing.
                let mut answered = self.inner.decide_record(
                    ns,
                    decl,
                    id,
                    RecordDecision {
                        decision: Decision::Affirm,
                        ..decision
                    },
                    view,
                    reader,
                )?;
                answered.label.standing = Standing::Unverified;
                answered.label.affirmed = None;
                Ok(answered)
            }
            _ => self
                .inner
                .decide_record(ns, decl, id, decision, view, reader),
        }
    }
    fn mark_document_own(
        &self,
        mark: OwnMark,
        reader: &ReaderFilter,
    ) -> Result<Marked, StoreError> {
        match self.inner.mark_document_own(mark.clone(), reader) {
            Err(StoreError::Conflict {
                current: Some(current),
            }) if self.fault == Fault::MarkIgnoresContent => self.inner.mark_document_own(
                OwnMark {
                    doc_hash: ContentHash::parse(&current)?,
                    ..mark
                },
                reader,
            ),
            other => other,
        }
    }
    fn unmark_document_own(
        &self,
        doc: &str,
        at: &str,
        trace_id: Option<&str>,
        reader: &ReaderFilter,
    ) -> Result<Rev, StoreError> {
        self.inner.unmark_document_own(doc, at, trace_id, reader)
    }
    fn document_own(
        &self,
        doc: &str,
        view: &StandingView,
        reader: &ReaderFilter,
    ) -> Result<Option<OwnInfo>, StoreError> {
        self.inner
            .document_own(doc, &faulty_view(self.fault, view), reader)
    }
    fn reindex_records(
        &self,
        ns: &str,
        decl: &RecordDecl,
        scan: &dyn Fn(&str) -> Vec<MemoryFlag>,
        embedder: Option<&dyn Embedder>,
        vectors_only: bool,
    ) -> Result<ReindexReport, StoreError> {
        self.inner
            .reindex_records(ns, decl, scan, embedder, vectors_only)
    }
    fn lane_status(&self, ns: &str, decl: &RecordDecl) -> Result<LaneStatus, StoreError> {
        self.inner.lane_status(ns, decl)
    }
    fn forget_record_history(&self, ns: &str, kind: &str, id: &str) -> Result<u64, StoreError> {
        self.inner.forget_record_history(ns, kind, id)
    }
    fn checkpoint(&self) -> Result<(), StoreError> {
        self.inner.checkpoint()
    }
}

/// Any declaration of `kind`: `lane_status` answers the stored one whatever it is asked under.
fn placeholder(kind: &str) -> RecordDecl {
    RecordDecl {
        kind: kind.to_owned(),
        standing: false,
        text: Vec::new(),
        keys: vec![umbel_store::lane::Pointer::parse("/k").unwrap()],
        matched: None,
    }
}

/// A stored declaration's JSON as the declaration.
fn declaration(stored: &Value) -> Option<RecordDecl> {
    let pointers = |member: &str| -> Option<Vec<umbel_store::lane::Pointer>> {
        stored[member]
            .as_array()?
            .iter()
            .map(|value| umbel_store::lane::Pointer::parse(value.as_str()?).ok())
            .collect()
    };
    let text = pointers("text")?;
    let matched = stored["match"]
        .as_str()
        .and_then(|name| text.iter().position(|pointer| pointer.as_str() == name));
    Some(RecordDecl {
        kind: stored["kind"].as_str()?.to_owned(),
        standing: stored["standing"].as_bool()?,
        text,
        keys: pointers("keys")?,
        matched,
    })
}

fn open_lane(
    dir: &Path,
    space: &str,
    limits: LaneLimits,
) -> Result<Arc<dyn DocumentStore>, StoreError> {
    let inner = SqliteStore::open(dir, space, StoreOptions::default())?.with_lane_limits(limits);
    Ok(Arc::new(Faulty {
        inner,
        fault: FAULT.get(),
    }))
}

fn factory(dir: &Path, space: &str) -> Result<Stores, StoreError> {
    let graph = Arc::new(SqliteStore::open(dir, space, StoreOptions::default())?);
    Ok(Stores {
        documents: open_lane(dir, space, LaneLimits::default())?,
        graph,
        index: None,
        memory: None,
        memory_restore: None,
        lane: Some(open_lane),
    })
}

/// The `lane` cases that fail on a backend with `fault`.
fn failures(fault: Fault) -> Vec<&'static str> {
    failures_of("lane", fault)
}

/// The cases of `group` that fail on a backend with `fault`.
fn failures_of(group: &str, fault: Fault) -> Vec<&'static str> {
    FAULT.set(fault);
    let report = run_groups(&factory, None, &[group]);
    assert!(report.skipped().is_empty(), "{:?}", report.skipped());
    report
        .group(group)
        .expect("the group ran")
        .cases
        .iter()
        .filter(|case| matches!(case.outcome, Outcome::Failed(_)))
        .map(|case| case.name)
        .collect()
}

#[test]
fn an_unfaulted_wrapper_passes_the_lane_group() {
    assert_eq!(failures(Fault::None), Vec::<&str>::new());
}

#[test]
fn each_lane_fault_fails_where_it_should() {
    for (fault, case) in [
        (
            Fault::ReadIgnoresReader,
            "a_reader_never_sees_a_record_it_may_not_read",
        ),
        (
            Fault::ReadIgnoresReader,
            "records_a_reader_cannot_read_change_no_read_of_its_own",
        ),
        (
            Fault::FindIgnoresReader,
            "a_reader_never_sees_a_record_it_may_not_read",
        ),
        (
            Fault::FindIgnoresReader,
            "records_a_reader_cannot_read_change_no_read_of_its_own",
        ),
        (
            Fault::TotalCountsUnreadable,
            "a_reader_never_sees_a_record_it_may_not_read",
        ),
        (
            Fault::RankingCountsUnreadable,
            "a_ranking_counts_only_what_its_reader_may_read",
        ),
        (
            Fault::RankIgnored,
            "a_text_query_ranks_the_fixture_as_the_formulas_do",
        ),
        (
            Fault::CursorLost,
            "the_three_orders_page_by_page_to_the_end_with_their_totals",
        ),
        (
            Fault::CutNeverSet,
            "cut_only_when_the_rarest_terms_postings_pass_the_bound_after_every_clause",
        ),
        (
            Fault::StaleServed,
            "an_undeclared_put_on_a_declared_kind_makes_it_stale",
        ),
    ] {
        let failed = failures(fault);
        assert!(
            failed.contains(&case),
            "{fault:?} is not caught by {case}: {failed:?}"
        );
    }
}

#[test]
fn an_unfaulted_wrapper_passes_the_standing_group() {
    assert_eq!(failures_of("standing", Fault::None), Vec::<&str>::new());
}

#[test]
fn each_standing_fault_fails_where_it_should() {
    for (fault, case) in [
        (
            Fault::MarksCountWhereCommandsWrite,
            "a_mark_does_not_count_where_the_view_names_the_collection_command_writable",
        ),
        (
            Fault::AdmitIgnored,
            "admit_narrows_reads_finds_totals_and_statistics",
        ),
        (
            Fault::DecideIgnoresReader,
            "a_decision_reaches_only_a_record_its_reader_may_read_whatever_a_read_admits",
        ),
        (
            Fault::WithdrawKept,
            "affirm_and_withdraw_each_write_once_with_a_change_row",
        ),
        (
            Fault::SourceShownToEveryone,
            "a_reader_who_cannot_read_the_cited_document_sees_the_basis_alone",
        ),
        (
            Fault::SourceShownToEveryone,
            "an_unreadable_cited_document_moves_only_that_records_standing",
        ),
        (
            Fault::MarkIgnoresContent,
            "a_mark_names_the_content_it_was_made_on_and_is_withdrawn_by_an_unmark",
        ),
        (
            Fault::MarkIgnoresContent,
            "a_changed_document_lapses_attestation_and_citing_it_again_restores_it",
        ),
        (
            Fault::EveryDocumentHeld,
            "a_document_of_an_own_collection_attests_only_once_the_host_held_it_to_its_file",
        ),
        (
            Fault::FormerPersonCounts,
            "a_former_persons_decisions_and_marks_are_set_aside",
        ),
    ] {
        let failed = failures_of("standing", fault);
        assert!(
            failed.contains(&case),
            "{fault:?} is not caught by {case}: {failed:?}"
        );
    }
}
