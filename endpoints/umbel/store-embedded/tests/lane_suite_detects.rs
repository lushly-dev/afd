//! The suite's `lane` group fails on a broken backend (records host specification, section
//! 15.1): the embedded store behind a wrapper that breaks one rule of the lane at a time, as
//! `index_suite_detects.rs` does for the index. Unbroken, the wrapper passes the group.

// Integration-test helpers fail by panicking; clippy exempts only `#[test]` bodies themselves.
#![allow(clippy::expect_used, clippy::unwrap_used)]

use std::cell::Cell;
use std::path::Path;
use std::sync::Arc;

use serde_json::Value;
use umbel_store::conformance::{Outcome, Stores, run_groups};
use umbel_store::lane::{
    DeclaredPut, FindOrder, FindPage, LaneLimits, LaneRecord, LaneStatus, LaneWrite, RecordDecl,
    RecordFind, ReindexReport, StandingView,
};
use umbel_store::{
    AccessSet, Change, DocMeta, Document, DocumentStore, DocumentWrite, Embedder, Envelope, Expect,
    ListQuery, MemoryFlag, Page, ReaderFilter, Record, RecordMeta, Rev, StoreError,
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

fn readable(record: &LaneRecord, reader: &ReaderFilter) -> bool {
    AccessSet::new(record.record.envelope.access.iter().map(String::as_str))
        .is_ok_and(|access| reader.admits(&access))
}

impl DocumentStore for Faulty {
    fn put_document(&self, doc: DocumentWrite, expect: Expect) -> Result<DocMeta, StoreError> {
        self.inner.put_document(doc, expect)
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
        self.inner.read_record(ns, decl, id, view, reader)
    }
    fn find_records(
        &self,
        ns: &str,
        decl: &RecordDecl,
        query: &RecordFind,
        view: &StandingView,
        reader: &ReaderFilter,
    ) -> Result<FindPage, StoreError> {
        let honest = self.inner.find_records(ns, decl, query, view, reader);
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
    FAULT.set(fault);
    let report = run_groups(&factory, None, &["lane"]);
    assert!(report.skipped().is_empty(), "{:?}", report.skipped());
    report
        .group("lane")
        .expect("the lane group ran")
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
