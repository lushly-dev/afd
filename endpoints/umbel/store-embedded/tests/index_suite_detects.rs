//! The suite's index cases against the real index with a deliberate fault added: each fault must
//! fail the case that exists to catch it (the suite detects leaks and lowered revisions in the
//! index as it does in the other stores).

// Integration-test helpers fail by panicking; clippy exempts only `#[test]` bodies themselves.
#![allow(clippy::expect_used, clippy::unwrap_used)]

mod support;

use std::path::Path;
use std::sync::Arc;

use umbel_store::conformance::{Outcome, Stores, run_groups};
use umbel_store::{
    ChunkHit, DocId, IndexChunk, IndexQuery, IndexWriterSession, ReaderFilter, Rev, SearchIndex,
    StoreError,
};
use umbel_store_embedded::{SqliteStore, StoreOptions, TantivyIndex};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Fault {
    None,
    /// `search` ignores the reader filter.
    SearchIgnoresReader,
    /// `chunks` ignores the reader filter.
    ChunksIgnoreReader,
    /// `commit` swallows a revision below the current one instead of refusing it.
    SwallowsLoweredCommit,
    /// `commit` publishes the staged changes at the higher of the two revisions and reports
    /// success, where it should have refused the lower one.
    RaisesLoweredCommit,
}

struct Faulty {
    inner: TantivyIndex,
    fault: Fault,
}

struct FaultySession {
    inner: Box<dyn IndexWriterSession>,
    fault: Fault,
}

impl SearchIndex for Faulty {
    fn writer(&self) -> Result<Box<dyn IndexWriterSession>, StoreError> {
        Ok(Box::new(FaultySession {
            inner: self.inner.writer()?,
            fault: self.fault,
        }))
    }
    fn applied(&self) -> Result<Rev, StoreError> {
        self.inner.applied()
    }
    fn search(
        &self,
        query: &IndexQuery,
        reader: &ReaderFilter,
    ) -> Result<Vec<ChunkHit>, StoreError> {
        let reader = if self.fault == Fault::SearchIgnoresReader {
            ReaderFilter::derivation()
        } else {
            reader.clone()
        };
        self.inner.search(query, &reader)
    }
    fn chunks(&self, doc: &str, reader: &ReaderFilter) -> Result<Vec<IndexChunk>, StoreError> {
        let reader = if self.fault == Fault::ChunksIgnoreReader {
            ReaderFilter::derivation()
        } else {
            reader.clone()
        };
        self.inner.chunks(doc, &reader)
    }
}

impl IndexWriterSession for FaultySession {
    fn applied(&self) -> Result<Rev, StoreError> {
        self.inner.applied()
    }
    fn replace(&mut self, doc: &DocId, chunks: Vec<IndexChunk>) -> Result<(), StoreError> {
        self.inner.replace(doc, chunks)
    }
    fn clear(&mut self) -> Result<(), StoreError> {
        self.inner.clear()
    }
    fn commit(&mut self, applied: Rev) -> Result<(), StoreError> {
        match self.fault {
            Fault::SwallowsLoweredCommit if applied < self.inner.applied()? => Ok(()),
            Fault::RaisesLoweredCommit => {
                let current = self.inner.applied()?;
                // Only the refusal is removed, which the real session would have made.
                self.inner.commit(applied.max(current))
            }
            _ => self.inner.commit(applied),
        }
    }
    fn abort(&mut self) {
        self.inner.abort();
    }
}

fn factory(fault: Fault) -> impl Fn(&Path, &str) -> Result<Stores, StoreError> {
    move |dir, space| {
        let store = Arc::new(SqliteStore::open(dir, space, StoreOptions::default())?);
        let inner = TantivyIndex::open(dir, space, StoreOptions::default())?;
        Ok(Stores {
            documents: store.clone(),
            graph: store,
            index: Some(Arc::new(Faulty { inner, fault })),
        })
    }
}

fn failed(report: &umbel_store::conformance::Report, group: &str, case: &str) -> bool {
    report
        .group(group)
        .into_iter()
        .flat_map(|g| &g.cases)
        .any(|c| c.name == case && matches!(c.outcome, Outcome::Failed(_)))
}

#[test]
fn an_unfaulted_wrapper_passes_the_index_and_access_groups() {
    let report = run_groups(&factory(Fault::None), None, &["index", "access"]);
    report.assert_passed();
    assert!(report.skipped().is_empty(), "{:?}", report.skipped());
}

#[test]
fn each_index_fault_fails_where_it_should() {
    for (fault, group, case) in [
        (
            Fault::SearchIgnoresReader,
            "index",
            "the_reader_clause_is_mandatory",
        ),
        (
            Fault::SearchIgnoresReader,
            "access",
            "the_index_honours_the_reader_filter",
        ),
        (
            Fault::ChunksIgnoreReader,
            "index",
            "the_reader_clause_is_mandatory",
        ),
        (
            Fault::ChunksIgnoreReader,
            "access",
            "the_index_honours_the_reader_filter",
        ),
        (
            Fault::SwallowsLoweredCommit,
            "index",
            "applied_never_lowers",
        ),
        (Fault::RaisesLoweredCommit, "index", "applied_never_lowers"),
    ] {
        let report = run_groups(&factory(fault), None, &["index", "access"]);
        assert!(
            failed(&report, group, case),
            "{fault:?} was not caught by {group}::{case}:\n{report}"
        );
    }
}
