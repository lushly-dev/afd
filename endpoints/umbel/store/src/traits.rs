//! The three store traits, version 1 (specification section 3.1), and the record lane's methods
//! of [`DocumentStore`], version 3 (records host specification, section 11.1).
//!
//! They are instantiated per space by the host, synchronous (callers are on a blocking thread),
//! `Send + Sync` and object-safe. Every read takes a [`ReaderFilter`] and applies it inside its
//! own query, before ordering and limits.

use serde_json::Value;

use crate::access::ReaderFilter;
use crate::document::{
    Change, DocId, DocMeta, Document, DocumentWrite, Expect, ListQuery, Page, Record, RecordMeta,
    Rev,
};
use crate::embed::Embedder;
use crate::envelope::Envelope;
use crate::error::Result;
use crate::graph::{Direction, Edge, EdgeKey, GraphBatch, Node, Subgraph};
use crate::index::{ChunkHit, IndexChunk, IndexQuery};
use crate::lane::{
    DeclaredPut, FindPage, LaneRecord, LaneStatus, LaneWrite, RecordDecl, RecordFind,
    ReindexReport, StandingView,
};
use crate::memory::MemoryFlag;

/// Documents, plugin records and the change log, with one revision sequence for all three.
pub trait DocumentStore: Send + Sync {
    /// Atomically write a document: take the next revision, replace the previous version and
    /// append one change. An [`Expect`] mismatch is `Conflict` and writes nothing.
    ///
    /// # Errors
    /// `Conflict`, `Invalid` (including envelope refusals), `TooLarge`, `Busy`, `Io`.
    fn put_document(&self, doc: DocumentWrite, expect: Expect) -> Result<DocMeta>;

    /// Delete a document by writing a tombstone change; the document is no longer readable. The
    /// change is readable by the access set of the version it deleted.
    ///
    /// # Errors
    /// `NotFound` when nothing is stored, `Conflict` on an [`Expect`] mismatch, `Invalid`,
    /// `Busy`, `Io`.
    fn delete_document(&self, id: &str, expect: Expect, envelope: Envelope) -> Result<Rev>;

    /// The document, or `None` when it is absent, deleted **or not readable by `reader`**: the
    /// store does not distinguish, so existence does not leak.
    ///
    /// # Errors
    /// `Busy`, `Corrupt`, `Io`.
    fn get_document(&self, id: &str, reader: &ReaderFilter) -> Result<Option<Document>>;

    /// Readable documents ordered by id; `query.limit` is 1 to 500.
    ///
    /// # Errors
    /// `Invalid` for a bad limit, `Busy`, `Corrupt`, `Io`.
    fn list_documents(&self, query: &ListQuery, reader: &ReaderFilter) -> Result<Page<DocMeta>>;

    /// Changes after `after`, ascending, at most `limit` (1 to 1000), filtered by `reader` (a
    /// change to an unreadable document is omitted, so revisions are dense only under
    /// derivation) and, when given, by `trace` (the writing call's trace id).
    ///
    /// # Errors
    /// `Invalid` for a bad limit, `Busy`, `Corrupt`, `Io`.
    fn changes(
        &self,
        after: Rev,
        limit: u32,
        reader: &ReaderFilter,
        trace: Option<&str>,
    ) -> Result<Vec<Change>>;

    /// The last revision, 0 when empty.
    ///
    /// # Errors
    /// `Busy`, `Io`.
    fn head(&self) -> Result<Rev>;

    /// The highest revision at or below `at` of a change to a **document** (a put or a delete)
    /// that `reader` may read, 0 when there is none (phase 5 section 9.3): the position a sealed
    /// revision names, so that it moves only when a document the reader can read changes. Plugin
    /// records (a sync's bookkeeping, a proposal) are left out: one record can stand for many
    /// documents, some of which the reader cannot read. The default pages through
    /// [`DocumentStore::changes`]; a backend answers it in one query.
    ///
    /// # Errors
    /// `Busy`, `Corrupt`, `Io`.
    fn last_readable_document(&self, at: Rev, reader: &ReaderFilter) -> Result<Rev> {
        let mut after = 0;
        let mut last = 0;
        loop {
            let page = self.changes(after, 1000, reader, None)?;
            let Some(tail) = page.last().map(|change| change.rev) else {
                return Ok(last);
            };
            for change in &page {
                if change.rev > at {
                    return Ok(last);
                }
                if matches!(
                    change.kind,
                    crate::ChangeKind::Put | crate::ChangeKind::Delete
                ) {
                    last = change.rev;
                }
            }
            after = tail;
        }
    }

    /// Write a plugin record. The record's access set is the envelope's.
    ///
    /// This is the path a kind that no manifest declares takes. From version 3 it has one more
    /// duty (records host specification, section 2): in the same transaction, a kind that has a
    /// declaration row is marked stale and its generation raised, so a record written while its
    /// kind was undeclared is never read through a lane that did not index it.
    ///
    /// # Errors
    /// As [`DocumentStore::put_document`].
    fn put_record(
        &self,
        ns: &str,
        kind: &str,
        id: &str,
        body: Value,
        envelope: Envelope,
        expect: Expect,
    ) -> Result<RecordMeta>;

    /// A record, or `None` when absent or not readable.
    ///
    /// # Errors
    /// `Busy`, `Corrupt`, `Io`.
    fn get_record(
        &self,
        ns: &str,
        kind: &str,
        id: &str,
        reader: &ReaderFilter,
    ) -> Result<Option<Record>>;

    /// Readable records of one namespace and kind ordered by id, after `after`.
    ///
    /// # Errors
    /// `Invalid` for a bad limit, `Busy`, `Corrupt`, `Io`.
    fn list_records(
        &self,
        ns: &str,
        kind: &str,
        after: Option<&str>,
        limit: u32,
        reader: &ReaderFilter,
    ) -> Result<Page<Record>>;

    /// Forget the content hashes the change log keeps for one record's earlier versions (phase 4
    /// section 9.1): after a redaction, no hash of a body that held forgotten text remains. The
    /// current version's change keeps its hash; every change keeps its revision, trace id and
    /// time. Answers how many changes lost their hash (0 when none had one left).
    ///
    /// # Errors
    /// `NotFound` when the record does not exist, `Busy`, `Io`.
    fn forget_record_history(&self, ns: &str, kind: &str, id: &str) -> Result<u64>;

    /// Write a record of a declared kind and its lane rows in one transaction (records host
    /// specification, section 4.2, step 7), in this order: the kind's declaration row, inserted
    /// when the kind holds no record and [`StoreError::LaneStale`] when the lane is not this
    /// declaration's; an existing record that `writer` may not read is `Conflict { current: None
    /// }`; `expect` against the stored content hash; for a standing kind with a stored record,
    /// the wording hash must be the stored one, else [`StoreError::WordingFixed`]; then the
    /// write. A new record takes the envelope's access set; one that exists keeps its stored
    /// access set, which the stored envelope then carries. The lane row keeps its number and its
    /// first revision; terms and keys are rewritten when they changed, and the record's vectors
    /// are deleted when its match value changed.
    ///
    /// It answers the record's metadata and, when `lane.model` is given, the match digest to
    /// embed for when the record has a match value and no vector of that model. Evidence
    /// (`lane.evidence`) arrives with that specification's step B3: until then a write that
    /// carries one is `Invalid`.
    ///
    /// # Errors
    /// `LaneStale`, `Conflict`, `WordingFixed`, `Invalid` (what [`crate::lane::extract`] and the
    /// envelope refuse, and a derivation `writer`), `TooLarge`, `Busy`, `Io`.
    #[allow(clippy::too_many_arguments)]
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
    ) -> Result<DeclaredPut>;

    /// One record of a declared kind as its lane holds it (section 7), or `None` when it is
    /// absent, not readable by `reader` or not admitted by `view`, without saying which.
    ///
    /// # Errors
    /// `LaneStale`, `Invalid` for a derivation `reader`, `Busy`, `Corrupt`, `Io`.
    fn read_record(
        &self,
        ns: &str,
        decl: &RecordDecl,
        id: &str,
        view: &StandingView,
        reader: &ReaderFilter,
    ) -> Result<Option<LaneRecord>>;

    /// The records of a declared kind that pass `query`'s key filters and text, that `reader`
    /// may read and that `view` admits, in the query's order, one page (section 7). The reader
    /// filter is a clause of every statement: a total, a candidate and a cursor never count a
    /// record the reader may not read.
    ///
    /// # Errors
    /// `LaneStale`; `Invalid` for what [`RecordFind::plan`] refuses and for a derivation
    /// `reader`; [`StoreError::LaneTooBroad`] for a ranked find that counts more postings than
    /// one call may (section 8.2); `Busy`, `Corrupt`, `Io`.
    fn find_records(
        &self,
        ns: &str,
        decl: &RecordDecl,
        query: &RecordFind,
        view: &StandingView,
        reader: &ReaderFilter,
    ) -> Result<FindPage>;

    /// Rebuild one kind's lane from its `records` rows (section 12.1), in chunks, so the write
    /// lock is never held for a whole kind: mark the kind stale and raise its generation; write
    /// each record's lane row, terms and keys, a chunk to a transaction; then, only if the
    /// generation is still the one this rebuild wrote, store the declaration and clear the mark.
    /// A body [`crate::lane::extract`] refuses is left without lane rows and counted. A record
    /// whose wording is not the one its lane row held loses its affirmation, its evidence and
    /// its vectors, whether or not `decl` has standing, and is counted. `scan` is the host's
    /// write scan, called for each text value. With `vectors_only` the rebuild is skipped.
    ///
    /// What every backend must hold. The suite checks the second through a `scan` that unwinds;
    /// the first and the third need a second writer placed between two chunks, which a backend's
    /// own tests do:
    ///
    /// - **A rebuild writes only while the generation is its own.** Each chunk's transaction
    ///   reads the generation first, and the rebuild stops, reporting `superseded`, when an
    ///   undeclared put or another rebuild raised it. Of two rebuilds at once, under one
    ///   declaration or two, the later writes every row and the earlier none after it began, so
    ///   a kind is never ready with rows of a declaration that is not the stored one.
    /// - **A rebuild that stops leaves the kind stale.** That includes `scan` unwinding: the
    ///   chunk it unwound from is not written, the chunks before it are whole, and no step after
    ///   it runs.
    /// - **Another writer gets a turn between chunks**: the rebuild does not take the write
    ///   lock again before a writer that was waiting for it has had the chance to.
    ///
    /// Vectors (the section's step 2) arrive with that specification's step B5: until then
    /// `embedder` is not called, and the report's two vector counts are 0.
    ///
    /// # Errors
    /// `Busy`, `Corrupt`, `Io`. Running a rebuild that stopped again finishes it.
    fn reindex_records(
        &self,
        ns: &str,
        decl: &RecordDecl,
        scan: &dyn Fn(&str) -> Vec<MemoryFlag>,
        embedder: Option<&dyn Embedder>,
        vectors_only: bool,
    ) -> Result<ReindexReport>;

    /// What the store holds for one declared kind: whether its lane is this declaration's, the
    /// stored declaration, and counts. It names no record, so it takes no reader: it is for
    /// `store-records-reindex` and the doctor (section 5.3).
    ///
    /// # Errors
    /// `Busy`, `Corrupt`, `Io`.
    fn lane_status(&self, ns: &str, decl: &RecordDecl) -> Result<LaneStatus>;

    /// Best-effort maintenance after a run that wrote (the embedded backend's WAL checkpoint,
    /// section 3.2). A busy result is not an error. The default does nothing.
    ///
    /// # Errors
    /// `Io` when the maintenance itself fails for a reason other than being busy.
    fn checkpoint(&self) -> Result<()> {
        Ok(())
    }
}

/// The lexical lane (section 8.1 fixes its fields). Built in step 3.
pub trait SearchIndex: Send + Sync {
    /// Take the space's index writer, waiting at most `store.lock_timeout_ms`, else `Busy`.
    /// Holding it serialises indexers across threads and processes; it is released when the
    /// session is committed, aborted or dropped.
    ///
    /// # Errors
    /// `Busy`, `Io`, `Corrupt`.
    fn writer(&self) -> Result<Box<dyn IndexWriterSession>>;

    /// The store revision the index reflects, without the writer.
    ///
    /// # Errors
    /// `Io`, `Corrupt`.
    fn applied(&self) -> Result<Rev>;

    /// Parse `query.text`, add the reader filter as a mandatory clause of the same query, apply
    /// the structured filters and return at most `query.limit` (at most 400) chunk hits ordered
    /// by score, then `(doc, ordinal)`. A syntax error is `Invalid` with the parser's position.
    ///
    /// # Errors
    /// `Invalid`, `Io`, `Corrupt`.
    fn search(&self, query: &IndexQuery, reader: &ReaderFilter) -> Result<Vec<ChunkHit>>;

    /// The stored chunks of one readable document, by ordinal.
    ///
    /// # Errors
    /// `Io`, `Corrupt`.
    fn chunks(&self, doc: &str, reader: &ReaderFilter) -> Result<Vec<IndexChunk>>;
}

/// An exclusive index writer.
pub trait IndexWriterSession: Send {
    /// The index's applied revision, read under the writer.
    ///
    /// # Errors
    /// `Io`, `Corrupt`.
    fn applied(&self) -> Result<Rev>;

    /// Remove every chunk of `doc` and add these, staged; an empty list removes the document.
    ///
    /// # Errors
    /// `Invalid`, `Io`.
    fn replace(&mut self, doc: &DocId, chunks: Vec<IndexChunk>) -> Result<()>;

    /// Stage removal of every chunk (rebuild).
    ///
    /// # Errors
    /// `Io`.
    fn clear(&mut self) -> Result<()>;

    /// Make staged changes visible and record `applied` as the index revision, atomically with
    /// them. `applied` below the current revision is `Conflict { current }` and commits nothing.
    ///
    /// # Errors
    /// `Conflict`, `Io`.
    fn commit(&mut self, applied: Rev) -> Result<()>;

    /// Drop staged changes.
    fn abort(&mut self);
}

/// The structural graph, one contribution per origin document.
///
/// A node or edge is readable through its origin document's access set: a node shared by several
/// documents is readable when any document that produced it is, and an edge only when both
/// endpoints and its origin are (D53).
pub trait GraphStore: Send + Sync {
    /// Replace, for each document of the batch, every node and edge it originated (`None`
    /// removes them), and record `applied`, in **one** transaction. `applied` below the current
    /// revision is `Conflict { current }`; above the store's head it is `Invalid`; either writes
    /// nothing. A `Some` contribution for a document that is not stored is `Invalid`.
    ///
    /// # Errors
    /// `Conflict`, `Invalid`, `TooLarge`, `Busy`, `Io`.
    fn apply(&self, batch: GraphBatch, applied: Rev) -> Result<()>;

    /// Remove every contribution and record `applied`, under the rules of
    /// [`GraphStore::apply`].
    ///
    /// # Errors
    /// As [`GraphStore::apply`].
    fn clear(&self, applied: Rev) -> Result<()>;

    /// The store revision the graph reflects.
    ///
    /// # Errors
    /// `Busy`, `Io`.
    fn applied(&self) -> Result<Rev>;

    /// Edges incident to `node` whose endpoints and origin are readable, **aggregated** per
    /// `(from, to, kind)` over readable origins (the weight is the sum of the readable origins'
    /// weights), ordered by `(from, to, kind)`; `kinds` empty means every kind.
    ///
    /// # Errors
    /// `Invalid` for a zero limit, `Busy`, `Io`.
    fn neighbors(
        &self,
        node: &str,
        kinds: &[String],
        direction: Direction,
        limit: u32,
        reader: &ReaderFilter,
    ) -> Result<Vec<Edge>>;

    /// The readable ones among `ids` (at most 1000), by id.
    ///
    /// # Errors
    /// `Invalid` for too many ids, `Busy`, `Io`.
    fn nodes(&self, ids: &[String], reader: &ReaderFilter) -> Result<Vec<Node>>;

    /// Aggregated readable edges of one kind ordered by `(from, to)`, after `after`; continue
    /// with the last edge's key until a page comes back short.
    ///
    /// # Errors
    /// `Invalid` for a zero limit, `Busy`, `Io`.
    fn edges_of_kind(
        &self,
        kind: &str,
        limit: u32,
        after: Option<&EdgeKey>,
        reader: &ReaderFilter,
    ) -> Result<Vec<Edge>>;

    /// The whole readable graph, with the same filter.
    ///
    /// # Errors
    /// `Busy`, `Io`.
    fn subgraph(&self, reader: &ReaderFilter) -> Result<Subgraph>;
}
