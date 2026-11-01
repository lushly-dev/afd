//! The three store traits, version 1 (specification section 3.1).
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
use crate::envelope::Envelope;
use crate::error::Result;
use crate::graph::{Direction, Edge, EdgeKey, GraphBatch, Node, Subgraph};
use crate::index::{ChunkHit, IndexChunk, IndexQuery};

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

    /// Write a plugin record. The record's access set is the envelope's.
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
