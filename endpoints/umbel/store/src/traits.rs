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
    Decided, DeclaredPut, FindPage, LaneRecord, LaneStatus, LaneWrite, Marked, OwnInfo, OwnMark,
    RecordDecision, RecordDecl, RecordFind, ReindexReport, StandingView,
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

    /// [`DocumentStore::put_document`], and in the same transaction the fact that **the host
    /// held this content to its file on disk** (records host specification, section 3, rule
    /// 2). Only the host calls it, and only after it read the file and found its hash to be the
    /// document's. The fact is of this content: a later [`DocumentStore::put_document`] of the
    /// document clears it, and a deleted document loses it. A document of an own collection is
    /// the person's own by collection only while the fact holds (section 6.2).
    ///
    /// # Errors
    /// As [`DocumentStore::put_document`].
    fn put_document_held(&self, doc: DocumentWrite, expect: Expect) -> Result<DocMeta>;

    /// Record that the host held the stored document `doc` to its file on disk at the content
    /// `hash`: whether the fact holds now. `false`, and nothing written, when the document is
    /// absent or stored with another content hash. It takes no reader: it is the host's own
    /// check, made for a person's mark (section 6.2, check 4) and by `store-documents-hold`,
    /// and it answers nothing of the document.
    ///
    /// # Errors
    /// `Invalid` for a document id that is not one, `Busy`, `Io`.
    fn hold_document(&self, doc: &str, hash: &crate::ContentHash) -> Result<bool>;

    /// How many stored documents of `collection` the host has not held to their file at their
    /// current content. A count and no document, so it takes no reader: it is for the doctor.
    ///
    /// # Errors
    /// `Busy`, `Io`.
    fn unheld_documents(&self, collection: &str) -> Result<u64>;

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
    /// embed for when the record has a match value and no vector of that model.
    ///
    /// **Evidence** (`lane.evidence`, step 7.5) is for a standing kind only, and replaces the
    /// record's evidence row. Its shape is [`crate::lane::Evidence::check`]'s. In the same
    /// transaction the cited document must be stored with the cited content hash and be
    /// readable by `writer`, else [`StoreError::EvidenceInvalid`], which does not say which of
    /// the three failed. `None` leaves the stored evidence as it is.
    ///
    /// # Errors
    /// `LaneStale`, `Conflict`, `WordingFixed`, `EvidenceInvalid`, `Invalid` (what
    /// [`crate::lane::extract`] and the envelope refuse, evidence on a kind without standing,
    /// and a derivation `writer`), `TooLarge`, `Busy`, `Io`.
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

    /// A person's decision on a standing record (section 6.1), in one transaction. `Affirm` on
    /// a record that is not affirmed takes the next revision, writes a decision row with the
    /// record's wording hash, the person, the time and the assurance, makes it the record's
    /// affirmation and appends one change of kind `standing` on the record's target, readable
    /// by the record's access set. `Withdraw` on an affirmed record does the same and leaves
    /// the record not affirmed. `Affirm` on an affirmed record and `Withdraw` on one that is
    /// not write nothing. It answers the record's label after the decision and the revision
    /// taken, if any.
    ///
    /// **Affirmed is read, not only stored**: a record is affirmed when the decision its lane
    /// row names is an affirmation of the wording the row holds, made by one of `view.person`.
    /// So `Affirm` writes whenever the record does not read affirmed, which is how a space's
    /// new person affirms a record a former person had.
    ///
    /// **Readable is all**: a record that is absent or not readable by `reader` is `NotFound`,
    /// without saying which, and no standing filter applies, so an unverified record can always
    /// be affirmed and an affirmed one withdrawn. `view` is taken only to compute the label,
    /// and its `admit` is ignored.
    ///
    /// The store writes the row it is handed. **That a person decided this very call, and that
    /// the person is the space's, is the host's to establish before it calls this** (section
    /// 6.1, checks 2 and 3): nothing here can.
    ///
    /// # Errors
    /// `NotFound`; `LaneStale`; `Invalid` for a kind without standing, a decision
    /// [`RecordDecision::check`] refuses and a derivation `reader`; `Busy`, `Corrupt`, `Io`.
    fn decide_record(
        &self,
        ns: &str,
        decl: &RecordDecl,
        id: &str,
        decision: RecordDecision,
        view: &StandingView,
        reader: &ReaderFilter,
    ) -> Result<Decided>;

    /// A person's mark that a document is their own (section 6.2), in one transaction. The
    /// document must be readable by `reader`, else `NotFound` (absent and unreadable alike),
    /// and stored with the mark's content hash, else `Conflict { current }`, so a person marks
    /// the bytes they were shown. A mark takes the next revision, replaces the document's mark
    /// row and appends one change of kind `standing` on the document's id, readable by the
    /// document's access set. A mark that changes nothing (the same content hash, speaker and
    /// person) writes nothing and answers the stored revision.
    ///
    /// A replaced document keeps its mark row, which no longer matches its content; a deleted
    /// document loses it.
    ///
    /// **The mark's third and fourth checks are the host's, before it calls this** (section
    /// 6.2): that no command writes files where the document lies, and that it equals its file
    /// on disk. So are section 6.1's checks 2 and 3. A mark the store holds still counts only
    /// while the view of a read names the document's collection as not command-writable.
    ///
    /// # Errors
    /// `NotFound`, `Conflict`, `Invalid` for a mark [`OwnMark::check`] refuses and a derivation
    /// `reader`, `Busy`, `Io`.
    fn mark_document_own(&self, mark: OwnMark, reader: &ReaderFilter) -> Result<Marked>;

    /// Take a mark back (section 6.2): delete the document's mark row, take the next revision
    /// and append one change of kind `standing` on the document's id. Answers the revision.
    ///
    /// # Errors
    /// `NotFound` for a document that is absent, not readable by `reader` or not marked,
    /// without saying which; `Invalid` for a derivation `reader`; `Busy`, `Io`.
    fn unmark_document_own(
        &self,
        doc: &str,
        at: &str,
        trace_id: Option<&str>,
        reader: &ReaderFilter,
    ) -> Result<Rev>;

    /// How a document is the person's own now (section 6.2), or `None` when it is absent, not
    /// readable by `reader` or not the person's own: by `collection` when `view.own` names its
    /// collection and the host held its current content to its file
    /// ([`DocumentStore::put_document_held`]), else `marked` when a mark made by one of
    /// `view.person` names its current content hash and `view` does not name its collection
    /// command-writable. `collection` when both hold. With the speaker
    /// the collection or the mark names, the content hash and the two dates of section 6.5.
    ///
    /// # Errors
    /// `Invalid` for a derivation `reader`, `Busy`, `Corrupt`, `Io`.
    fn document_own(
        &self,
        doc: &str,
        view: &StandingView,
        reader: &ReaderFilter,
    ) -> Result<Option<OwnInfo>>;

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
