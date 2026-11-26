//! The frozen single trait of every host service, from before the split by grant family (D218,
//! [#1775](https://github.com/lushly-dev/afd/issues/1775)).
//!
//! [`HostServices`] stays so that an implementor written against it (a plugin's test stub)
//! compiles unchanged: a blanket impl forwards each of its methods to the family trait that now
//! owns it, so such a type is [`AllServices`](crate::AllServices) and a [`Cx`](crate::Cx) takes
//! it. **It is frozen**: no method is added to it. A method a family gains later answers that
//! family's default, `NotGranted`, for a legacy implementor. A new family adds only an empty
//! blanket impl here (`impl<T: HostServices> NewServices for T {}`), so legacy implementors stay
//! `AllServices`. Implement the family traits instead;
//! the trait is removed in a later minor version of the SDK (its README's version policy) once no
//! implementor in this repository uses it.
#![allow(clippy::too_many_arguments)]

use serde_json::Value;

use umbel_store::lane::{
    Decision, Evidence, FindPage, LaneRecord, MatchPage, OwnInfo, RecordFind, RecordMatch,
    Standing, StandingLabel,
};
use umbel_store::memory::{
    Confirm, ForgetReceipt, Invalidate, KeyFileState, LeftOut, MemoryChange, MemoryCounts,
    MemoryList, MemoryPage, MemoryReceipt, MemoryUsage, MemoryVersionMeta, RecallPage, RecallQuery,
    ReindexReceipt, Retention, SweepReceipt,
};
use umbel_store::{AsOf, ForgetSelector, MemoryRecord, Millis, ReadFlags};
use umbel_store::{
    Change, ChunkHit, ContentHash, Direction, DocMeta, Document, DocumentWrite, Edge, EdgeKey,
    Envelope, Expect, GraphBatch, IndexChunk, IndexQuery, IndexWriterSession, ListQuery, Node,
    Page, Record, RecordMeta, Rev, Subgraph,
};

use crate::cx::{HostError, Level, WalCheckpoint, not_granted};
use crate::memory::{LeftOutQuery, MemoryWriteRequest};
use crate::store::{CollectionInfo, CollectionMeta, ContentEntry, Reader};

use crate::services::{
    ClockServices, ConfigServices, ContentServices, ContentWriteServices, DeriveServices,
    DocumentServices, DocumentWriteServices, EventServices, GraphServices, GraphWriteServices,
    IndexServices, IndexWriteServices, LogServices, MaintenanceServices, MemoryServices,
    MemoryWriteServices, PackServices, RandomServices, ReaderServices, RecordServices,
    RecordWriteServices,
};

/// Every host service of one call in one trait, **frozen** (see the module documentation):
/// implement the family traits, such as [`RecordServices`](crate::RecordServices), instead.
/// Every method answers [`HostError::NotGranted`] for a grant that was not declared or was
/// denied.
pub trait HostServices: Send + Sync {
    /// Grant `config`: the instance's configuration, validated, defaults applied.
    ///
    /// # Errors
    /// [`HostError::NotGranted`].
    fn config(&self) -> Result<Value, HostError>;
    /// Grant `log`: a line in the host's log, tagged with the instance id. A no-op without the
    /// grant.
    fn log(&self, level: Level, message: &str);
    /// Grant `packs`: the files of one of the plugin's packs, as paths inside the pack.
    ///
    /// # Errors
    /// [`HostError::NotGranted`], [`HostError::NotFound`].
    fn pack_list(&self, pack: &str) -> Result<Vec<String>, HostError>;
    /// Grant `packs`: one file of one of the plugin's packs.
    ///
    /// # Errors
    /// [`HostError::NotGranted`], [`HostError::NotFound`], [`HostError::Invalid`] for a path
    /// outside the pack, [`HostError::TooLarge`] past the per-call cap.
    fn pack_read(&self, pack: &str, path: &str) -> Result<Vec<u8>, HostError>;
    /// Grant `events`: `event-list`'s read under the caller's principal, without acknowledging.
    ///
    /// # Errors
    /// [`HostError::NotGranted`], including for a space the instance is not enabled for;
    /// [`HostError::Invalid`].
    fn events(
        &self,
        space: Option<&str>,
        after: Option<&str>,
        limit: u32,
    ) -> Result<Value, HostError>;
    /// Grant `clock`: the command context's clock, in epoch milliseconds.
    ///
    /// # Errors
    /// [`HostError::NotGranted`].
    fn now_ms(&self) -> Result<i64, HostError>;
    /// Grant `random`: the command context's random source, in `[0, 1)`.
    ///
    /// # Errors
    /// [`HostError::NotGranted`].
    fn random(&self) -> Result<f64, HostError>;

    /// Grant `content`: the files of one collection of the space, sorted by path, after `after`.
    ///
    /// # Errors
    /// [`HostError::NotGranted`], [`HostError::NotFound`], [`HostError::Invalid`].
    fn content_list(
        &self,
        _space: &str,
        _collection: &str,
        _after: Option<&str>,
        _limit: u32,
    ) -> Result<Page<ContentEntry>, HostError> {
        not_granted("content")
    }
    /// Grant `content`: the collections of the space as the workspace declares them, in
    /// configuration order, without their roots.
    ///
    /// # Errors
    /// [`HostError::NotGranted`].
    fn content_collections(&self, _space: &str) -> Result<Vec<CollectionInfo>, HostError> {
        not_granted("content")
    }
    /// Grant `content`: one file of a collection, confined to its root.
    ///
    /// # Errors
    /// [`HostError::NotGranted`], [`HostError::NotFound`], [`HostError::TooLarge`].
    fn content_read(
        &self,
        _space: &str,
        _collection: &str,
        _path: &str,
    ) -> Result<Vec<u8>, HostError> {
        not_granted("content")
    }
    /// Grant `content_write`: replace or create one file after checking `expect`, atomically.
    ///
    /// # Errors
    /// [`HostError::NotGranted`] (including `STORE_WRITE_NOT_ALLOWED`), [`HostError::Conflict`].
    fn content_replace(
        &self,
        _space: &str,
        _collection: &str,
        _path: &str,
        _bytes: &[u8],
        _expect: Expect,
    ) -> Result<ContentHash, HostError> {
        not_granted("content_write")
    }
    /// Grant `documents`: one document, under the caller's reader filter.
    ///
    /// # Errors
    /// [`HostError::NotGranted`], [`HostError::Busy`], [`HostError::Corrupt`], [`HostError::Io`].
    fn doc_get(&self, _space: &str, _id: &str) -> Result<Option<Document>, HostError> {
        not_granted("documents")
    }
    /// Grant `documents`: readable documents, ordered by id.
    ///
    /// # Errors
    /// As [`HostServices::doc_get`], and [`HostError::Invalid`] for a bad limit.
    fn doc_list(&self, _space: &str, _query: &ListQuery) -> Result<Page<DocMeta>, HostError> {
        not_granted("documents")
    }
    /// Grant `documents`: the readable changes after `after`.
    ///
    /// # Errors
    /// As [`HostServices::doc_list`].
    fn doc_changes(
        &self,
        _space: &str,
        _after: Rev,
        _limit: u32,
        _trace: Option<&str>,
    ) -> Result<Vec<Change>, HostError> {
        not_granted("documents")
    }
    /// Grant `documents`: a store revision of the space as the caller may see it (phase 5
    /// section 9.3). For a caller whose positions are sealed (a hosted caller that is neither
    /// the operator nor stdio), the last revision it can read at or below `rev`, sealed as a
    /// string `r1.<token>` that only equality may compare; for every other caller `rev` itself,
    /// as a number. A plugin shows every store revision through it, and takes it back through
    /// [`HostServices::doc_position_of`].
    ///
    /// # Errors
    /// [`HostError::NotGranted`], [`HostError::Busy`], [`HostError::Corrupt`], [`HostError::Io`].
    fn doc_position(&self, _space: &str, _rev: Rev) -> Result<Value, HostError> {
        not_granted("documents")
    }
    /// Grant `documents`: the revision a value [`HostServices::doc_position`] gave this caller
    /// names, for an `after` input: a number from a caller whose positions are plain, a sealed
    /// token sealed for this caller and space from one whose are sealed.
    ///
    /// # Errors
    /// [`HostError::Invalid`] for anything else, which tells nothing of why;
    /// [`HostError::NotGranted`].
    fn doc_position_of(&self, _space: &str, _value: &Value) -> Result<Rev, HostError> {
        not_granted("documents")
    }
    /// Grant `documents`: the access tokens of the caller's reader filter in the space (`space`,
    /// `principal:<kind>:<id>` and `group:<g>` for each group that holds the caller), sorted. A
    /// plugin uses them to ask whether the caller holds a token an area policy names, such as an
    /// approvers list; it learns nothing about any other principal.
    ///
    /// # Errors
    /// As [`HostServices::doc_get`].
    fn reader_tokens(&self, _space: &str) -> Result<Vec<String>, HostError> {
        not_granted("documents")
    }
    /// Grant `documents`: the collections of the space whose default access set the caller's
    /// reader filter admits, in configuration order, as metadata only: id, kind, access set and
    /// sensitivity (phase 4 step 4, amendment 1). It lists and reads no file, and a collection the
    /// caller could not read a document of is left out, so it says nothing the caller's document
    /// reads would not. Compiled plugins only: a component and a mounted server answer
    /// `NotGranted`.
    ///
    /// # Errors
    /// As [`HostServices::doc_get`].
    fn readable_collections(&self, _space: &str) -> Result<Vec<CollectionMeta>, HostError> {
        not_granted("documents")
    }
    /// Grant `documents_write`: write a document. The host fills the envelope's identity fields
    /// from the call and refuses an envelope without an origin, access set or sensitivity.
    ///
    /// # Errors
    /// [`HostError::NotGranted`], [`HostError::Conflict`], [`HostError::Invalid`] (a message
    /// starting `STORE_PROVENANCE_REQUIRED` for an envelope refusal), [`HostError::TooLarge`],
    /// [`HostError::Busy`].
    fn doc_put(
        &self,
        _space: &str,
        _doc: DocumentWrite,
        _expect: Expect,
    ) -> Result<DocMeta, HostError> {
        not_granted("documents_write")
    }
    /// Grant `documents_write`: delete a document (a tombstone change).
    ///
    /// # Errors
    /// As [`HostServices::doc_put`], and [`HostError::NotFound`].
    fn doc_delete(
        &self,
        _space: &str,
        _id: &str,
        _expect: Expect,
        _envelope: Envelope,
    ) -> Result<Rev, HostError> {
        not_granted("documents_write")
    }
    /// Grant `records`: one record of the instance's own namespace.
    ///
    /// # Errors
    /// [`HostError::NotGranted`], [`HostError::Busy`], [`HostError::Corrupt`], [`HostError::Io`].
    fn record_get(
        &self,
        _space: &str,
        _kind: &str,
        _id: &str,
    ) -> Result<Option<Record>, HostError> {
        not_granted("records")
    }
    /// Grant `records`: readable records of one kind, ordered by id, after `after`.
    ///
    /// # Errors
    /// As [`HostServices::record_get`], and [`HostError::Invalid`] for a bad limit.
    fn record_list(
        &self,
        _space: &str,
        _kind: &str,
        _after: Option<&str>,
        _limit: u32,
    ) -> Result<Page<Record>, HostError> {
        not_granted("records")
    }
    /// Grant `records_write`: write a record of the instance's own namespace.
    ///
    /// For a kind the instance's manifest declares under `[[records]]`, the host writes the
    /// record's lane rows in the same transaction (records host specification, section 4.2), so
    /// it is found by key and by text when the put returns. The host then owns the access set: a
    /// new record is private to the caller's principal, or readable by the space when the
    /// instance's `default_access` says so, and a record that exists keeps the set it has. Its
    /// text values are scanned and flagged, never blocked, and a standing kind's wording is
    /// fixed by its first put. An undeclared kind is written as the plugin sent it.
    ///
    /// # Errors
    /// As [`HostServices::doc_put`]; for a declared kind also [`HostError::Invalid`] with a
    /// message starting `RECORD_PRINCIPAL_REQUIRED`, `RECORD_FIELD_INVALID`,
    /// `RECORD_WORDING_FIXED`, `RECORD_LANE_STALE` or `RECORD_QUOTA_EXCEEDED` (the caller's
    /// principal is past `limits.kind_records` or `limits.kind_postings` for the kind and the
    /// put would add to it; nothing was written, D212), and [`HostError::Conflict`] with no
    /// current hash for an id that a record the caller may not read holds.
    fn record_put(
        &self,
        _space: &str,
        _kind: &str,
        _id: &str,
        _body: Value,
        _envelope: Envelope,
        _expect: Expect,
    ) -> Result<RecordMeta, HostError> {
        not_granted("records_write")
    }
    /// Grant `records_write`: write a record of a standing kind the instance's manifest declares,
    /// and replace its evidence (records host specification, section 4.1). Compiled plugins
    /// only, as every record lane service is: a component and a mounted server answer
    /// `NotGranted`.
    ///
    /// # Errors
    /// As [`HostServices::record_put`]; [`HostError::Invalid`] with a message starting
    /// `RECORD_KIND_NOT_DECLARED`, `RECORD_KIND_NOT_STANDING`, `RECORD_PRINCIPAL_REQUIRED`,
    /// `RECORD_FIELD_INVALID`, `RECORD_WORDING_FIXED`, `RECORD_EVIDENCE_INVALID`,
    /// `RECORD_LANE_STALE` or `RECORD_QUOTA_EXCEEDED` (section 13).
    #[allow(clippy::too_many_arguments)]
    fn record_put_cited(
        &self,
        _space: &str,
        _kind: &str,
        _id: &str,
        _body: Value,
        _envelope: Envelope,
        _expect: Expect,
        _evidence: Evidence,
    ) -> Result<RecordMeta, HostError> {
        not_granted("records_write")
    }
    /// Grant `records`: one record of a declared kind, with its label; `None` for a record that
    /// is absent, not readable or not admitted, without saying which (section 7).
    ///
    /// # Errors
    /// [`HostError::NotGranted`]; [`HostError::Invalid`] with a message starting
    /// `RECORD_KIND_NOT_DECLARED`, `RECORD_QUERY_INVALID` or `RECORD_LANE_STALE`;
    /// [`HostError::Busy`], [`HostError::Corrupt`], [`HostError::Io`].
    fn record_read(
        &self,
        _space: &str,
        _kind: &str,
        _id: &str,
        _standings: &[Standing],
        _verified_only: bool,
    ) -> Result<Option<LaneRecord>, HostError> {
        not_granted("records")
    }
    /// Grant `records`: the readable records of a declared kind by key and by text, in pages
    /// (section 7).
    ///
    /// # Errors
    /// As [`HostServices::record_read`], and [`HostError::Invalid`] with a message starting
    /// `RECORD_QUERY_TOO_BROAD` for a find under order `rank` when the kind as a whole holds more
    /// postings than a ranked read reads: the same for every call and every reader of the kind
    /// (section 8.2). A find by id or by recency is never refused for its kind's size.
    fn record_find(&self, _space: &str, _query: &RecordFind) -> Result<FindPage, HostError> {
        not_granted("records")
    }
    /// Grant `records`: for each text, the readable records whose match field is identical and
    /// the nearest ones with their scores (section 8). Scores only: what to do with them is the
    /// plugin's.
    ///
    /// # Errors
    /// As [`HostServices::record_find`] under order `rank`: `RECORD_QUERY_TOO_BROAD` when the
    /// kind as a whole holds more postings than a match reads, the same for every call and every
    /// reader of the kind (section 8.2).
    fn record_match(&self, _space: &str, _query: &RecordMatch) -> Result<MatchPage, HostError> {
        not_granted("records")
    }
    /// Grant `records_write`: affirm a standing record's wording, or withdraw that, inside a
    /// call the space's person decided (section 6.1). Answers the record's label.
    ///
    /// # Errors
    /// [`HostError::NotGranted`], also with a message starting `RECORD_DECISION_NOT_GATED` or
    /// `RECORD_DECISION_NOT_THE_PERSON`; [`HostError::NotFound`] for a record that is absent or
    /// not readable; [`HostError::Invalid`] with a message starting `RECORD_KIND_NOT_STANDING`
    /// or `RECORD_LANE_STALE`; [`HostError::Busy`].
    fn record_decide(
        &self,
        _space: &str,
        _kind: &str,
        _id: &str,
        _decision: Decision,
    ) -> Result<StandingLabel, HostError> {
        not_granted("records_write")
    }
    /// Grants `records_write` and `documents`: mark a document, at the content hash the person
    /// was shown, as the person's own (section 6.2). Answers the revision the mark took.
    ///
    /// # Errors
    /// [`HostError::NotGranted`], also with a message starting `RECORD_DECISION_NOT_GATED`,
    /// `RECORD_DECISION_NOT_THE_PERSON` or `STORE_OWN_MARK_REFUSED`; [`HostError::NotFound`];
    /// [`HostError::Conflict`] when the document's content is not `content_hash`;
    /// [`HostError::Busy`].
    fn doc_own_mark(
        &self,
        _space: &str,
        _doc: &str,
        _content_hash: &ContentHash,
        _speaker: Option<&str>,
    ) -> Result<Rev, HostError> {
        not_granted("records_write")
    }
    /// Grants `records_write` and `documents`: take a mark back (section 6.2).
    ///
    /// # Errors
    /// As [`HostServices::doc_own_mark`]; [`HostError::NotFound`] also with no mark.
    fn doc_own_unmark(&self, _space: &str, _doc: &str) -> Result<Rev, HostError> {
        not_granted("records_write")
    }
    /// Grant `documents`: how a readable document is the person's own now, by collection or by
    /// mark, or `None` when it is not (section 6.2).
    ///
    /// # Errors
    /// As [`HostServices::doc_get`].
    fn doc_own(&self, _space: &str, _doc: &str) -> Result<Option<OwnInfo>, HostError> {
        not_granted("documents")
    }
    /// Grant `index`: search the space's index under the caller's reader filter.
    ///
    /// # Errors
    /// [`HostError::NotGranted`], [`HostError::Invalid`] (a query error), [`HostError::Corrupt`],
    /// [`HostError::Io`].
    fn index_search(&self, _space: &str, _query: &IndexQuery) -> Result<Vec<ChunkHit>, HostError> {
        not_granted("index")
    }
    /// Grant `index`: the stored chunks of one readable document.
    ///
    /// # Errors
    /// As [`HostServices::index_search`].
    fn index_chunks(&self, _space: &str, _doc: &str) -> Result<Vec<IndexChunk>, HostError> {
        not_granted("index")
    }
    /// Grant `index`: the store revision the space's index reflects.
    ///
    /// # Errors
    /// As [`HostServices::index_search`].
    fn index_applied(&self, _space: &str) -> Result<Rev, HostError> {
        not_granted("index")
    }
    /// Grant `index_write`: take the space's index writer, waiting at most the lock timeout.
    ///
    /// # Errors
    /// [`HostError::NotGranted`], [`HostError::Busy`] (retryable).
    fn index_writer(&self, _space: &str) -> Result<Box<dyn IndexWriterSession>, HostError> {
        not_granted("index_write")
    }
    /// Grant `graph`: the readable edges incident to a node, aggregated over readable origins.
    ///
    /// # Errors
    /// [`HostError::NotGranted`], [`HostError::Invalid`], [`HostError::Busy`], [`HostError::Io`].
    fn graph_neighbors(
        &self,
        _space: &str,
        _node: &str,
        _kinds: &[String],
        _direction: Direction,
        _limit: u32,
    ) -> Result<Vec<Edge>, HostError> {
        not_granted("graph")
    }
    /// Grant `graph`: the readable ones among `ids`.
    ///
    /// # Errors
    /// As [`HostServices::graph_neighbors`].
    fn graph_nodes(&self, _space: &str, _ids: &[String]) -> Result<Vec<Node>, HostError> {
        not_granted("graph")
    }
    /// Grant `graph`: readable edges of one kind, after `after`.
    ///
    /// # Errors
    /// As [`HostServices::graph_neighbors`].
    fn graph_edges(
        &self,
        _space: &str,
        _kind: &str,
        _after: Option<&EdgeKey>,
        _limit: u32,
    ) -> Result<Vec<Edge>, HostError> {
        not_granted("graph")
    }
    /// Grant `graph`: the whole readable graph of the space.
    ///
    /// # Errors
    /// As [`HostServices::graph_neighbors`].
    fn graph_subgraph(&self, _space: &str) -> Result<Subgraph, HostError> {
        not_granted("graph")
    }
    /// Grant `graph`: the store revision the space's graph reflects. Like
    /// [`HostServices::index_applied`] it is shown to every reader.
    ///
    /// # Errors
    /// As [`HostServices::graph_neighbors`].
    fn graph_applied(&self, _space: &str) -> Result<Rev, HostError> {
        not_granted("graph")
    }
    /// Grant `graph_write`: replace the contributions of a batch's documents and record
    /// `applied`, in one transaction.
    ///
    /// # Errors
    /// [`HostError::NotGranted`], [`HostError::Conflict`], [`HostError::Invalid`],
    /// [`HostError::TooLarge`], [`HostError::Busy`].
    fn graph_apply(
        &self,
        _space: &str,
        _batch: GraphBatch,
        _applied: Rev,
    ) -> Result<(), HostError> {
        not_granted("graph_write")
    }
    /// A derivation read of the change log, ignoring the caller's reader filter. Needs
    /// `index_write` or `graph_write` for the space and a command with the `store-write` effect.
    ///
    /// # Errors
    /// [`HostError::NotGranted`] (the message names `STORE_WRITE_NOT_ALLOWED`).
    fn derive_changes(
        &self,
        _space: &str,
        _after: Rev,
        _limit: u32,
    ) -> Result<Vec<Change>, HostError> {
        not_granted("index_write")
    }
    /// A derivation read of one document. The same rules as [`HostServices::derive_changes`].
    ///
    /// # Errors
    /// As [`HostServices::derive_changes`].
    fn derive_document(&self, _space: &str, _id: &str) -> Result<Option<Document>, HostError> {
        not_granted("index_write")
    }
    /// A derivation read of the space's **true** head revision: the last revision of any change,
    /// readable by the caller or not. It counts what the caller may not read, so it is offered
    /// only where a derivation read is (the same rules as [`HostServices::derive_changes`]); a
    /// command that answers a reader reports the highest revision of a change the reader can
    /// read instead.
    ///
    /// # Errors
    /// As [`HostServices::derive_changes`].
    fn derive_head(&self, _space: &str) -> Result<Rev, HostError> {
        not_granted("index_write")
    }
    /// Best-effort store maintenance after a run that wrote (the embedded backend's WAL
    /// checkpoint, specification section 3.2). A busy store is not an error. Needs one of the
    /// write grants allowed for the space.
    ///
    /// # Errors
    /// [`HostError::NotGranted`] (the message names `STORE_WRITE_NOT_ALLOWED` when a write grant
    /// is held but not allowed for the space), [`HostError::Io`].
    fn checkpoint(&self, _space: &str) -> Result<(), HostError> {
        not_granted("index_write")
    }
    /// A reporting checkpoint of the space's document store: `wal_checkpoint(TRUNCATE)` with no
    /// lock wait, answering whether the write-ahead log is now empty (phase 4 section 9.1). A
    /// command that removed text, such as a proposal's redaction, says whether the removed bytes
    /// are gone or wait for a later checkpoint. The same grants as [`HostServices::checkpoint`].
    /// Compiled plugins only: no WIT world has such a function.
    ///
    /// # Errors
    /// [`HostError::NotGranted`] (the message names `STORE_WRITE_NOT_ALLOWED` when a write grant
    /// is held but not allowed for the space), [`HostError::Io`], [`HostError::Corrupt`].
    fn truncate_wal(&self, _space: &str) -> Result<WalCheckpoint, HostError> {
        not_granted("records_write")
    }
    /// Grant `records_write`: forget the content hashes the change log keeps for the earlier
    /// versions of one record of the instance's own namespace (phase 4 section 9.1), after a
    /// redaction. Answers how many changes lost their hash. Compiled plugins only.
    ///
    /// # Errors
    /// [`HostError::NotGranted`], [`HostError::NotFound`], [`HostError::Busy`], [`HostError::Io`].
    fn record_forget_history(
        &self,
        _space: &str,
        _kind: &str,
        _id: &str,
    ) -> Result<u64, HostError> {
        not_granted("records_write")
    }
    /// The read methods as another principal (`knowledge-eval`). Only in a command exposed to
    /// the CLI alone, when the call's actor is a human.
    ///
    /// # Errors
    /// [`HostError::NotGranted`] (the message names `STORE_WRITE_NOT_ALLOWED`).
    fn as_reader(&self, _principal: &str) -> Result<Reader, HostError> {
        not_granted("documents")
    }

    /// Grant `memory`: one record at the version matching `as_of`, under the caller's reader
    /// filter; `None` for absent, purged, forgotten and unreadable alike (phase 3 section 5.2).
    ///
    /// # Errors
    /// [`HostError::NotGranted`], [`HostError::NotProvisioned`], [`HostError::KeysMissing`],
    /// [`HostError::KeysMismatch`], [`HostError::KeyAbsent`], [`HostError::SealInvalid`].
    fn memory_get(
        &self,
        _space: &str,
        _id: &str,
        _as_of: AsOf,
        _flags: ReadFlags,
    ) -> Result<Option<MemoryRecord>, HostError> {
        not_granted("memory")
    }
    /// Grant `memory`: every version of a readable record, oldest first.
    ///
    /// # Errors
    /// As [`HostServices::memory_get`].
    fn memory_history(&self, _space: &str, _id: &str) -> Result<Vec<MemoryRecord>, HostError> {
        not_granted("memory")
    }
    /// Grant `memory`: readable records, newest recorded first.
    ///
    /// # Errors
    /// As [`HostServices::memory_get`], and [`HostError::Invalid`] for a bad query.
    fn memory_list(&self, _space: &str, _query: &MemoryList) -> Result<MemoryPage, HostError> {
        not_granted("memory")
    }
    /// Grant `memory`: ranked hits, with no score.
    ///
    /// # Errors
    /// As [`HostServices::memory_list`].
    fn memory_recall(&self, _space: &str, _query: &RecallQuery) -> Result<RecallPage, HostError> {
        not_granted("memory")
    }
    /// Grant `memory`: what a bundle's push rule leaves out, per class. Reads no key.
    ///
    /// # Errors
    /// As [`HostServices::memory_list`].
    fn memory_left_out(&self, _space: &str, _query: &LeftOutQuery) -> Result<LeftOut, HostError> {
        not_granted("memory")
    }
    /// Grant `memory`: the changes after `after` that the caller can read. No text.
    ///
    /// # Errors
    /// As [`HostServices::memory_list`].
    fn memory_changes(
        &self,
        _space: &str,
        _after: Rev,
        _limit: u32,
        _trace: Option<&str>,
    ) -> Result<Vec<MemoryChange>, HostError> {
        not_granted("memory")
    }
    /// Grant `memory`: counts by class and state over what the caller can read.
    ///
    /// # Errors
    /// As [`HostServices::memory_list`].
    fn memory_counts(
        &self,
        _space: &str,
        _now: Millis,
        _expiring_within_ms: Millis,
    ) -> Result<MemoryCounts, HostError> {
        not_granted("memory")
    }
    /// Grant `memory`: the caller's own usage: its stored records and bytes, and the writes and
    /// bytes of the caller's principal and agent since `since`.
    ///
    /// # Errors
    /// As [`HostServices::memory_get`].
    fn memory_usage(&self, _space: &str, _since: Millis) -> Result<MemoryUsage, HostError> {
        not_granted("memory")
    }
    /// Grant `memory`: the highest revision of a change the caller can read, never the store's
    /// true head (phase 3 section 6.1).
    ///
    /// # Errors
    /// As [`HostServices::memory_get`].
    fn memory_head(&self, _space: &str) -> Result<Rev, HostError> {
        not_granted("memory")
    }
    /// Grant `memory`: whether the key file is present, missing or another database's. Only the
    /// file's state: the store-wide counts of markers and orphans stay with `store-check`.
    ///
    /// # Errors
    /// As [`HostServices::memory_get`].
    fn memory_key_file(&self, _space: &str) -> Result<KeyFileState, HostError> {
        not_granted("memory")
    }
    /// Grant `memory_write`: write a batch. The host fills each entry's identity and
    /// authority from the call, sets its access set from `share` and the grant's policy, unions
    /// the scan's flags, caps the quota, and refuses what section 6 refuses.
    ///
    /// # Errors
    /// [`HostError::NotGranted`] (`STORE_WRITE_NOT_ALLOWED`, `MEMORY_SHARE_NOT_ALLOWED`,
    /// `MEMORY_AUTHORITY_TOO_LOW`, `MEMORY_NOT_OWNED`), [`HostError::NotFound`]
    /// (`MEMORY_NOT_FOUND`), [`HostError::Invalid`] (`MEMORY_PRINCIPAL_REQUIRED`,
    /// `MEMORY_TTL_TOO_LONG`, a store refusal), [`HostError::QuotaExceeded`],
    /// [`HostError::KeysMissing`], [`HostError::KeysMismatch`], [`HostError::Busy`].
    fn memory_write(
        &self,
        _space: &str,
        _request: MemoryWriteRequest,
    ) -> Result<MemoryReceipt, HostError> {
        not_granted("memory_write")
    }
    /// Grant `memory_write`: close a record's validity with a new version. The host fills `by`,
    /// `at` and the trace id, and checks authority and ownership (section 6.3).
    ///
    /// # Errors
    /// As [`HostServices::memory_write`], and [`HostError::Conflict`], [`HostError::KeyAbsent`].
    fn memory_invalidate(
        &self,
        _space: &str,
        _request: Invalidate,
    ) -> Result<MemoryVersionMeta, HostError> {
        not_granted("memory_write")
    }
    /// Grant `memory_write`: a person vouching for their own record (section 8.7). Needs a
    /// caller with authority `person`, else `MEMORY_CONFIRM_NOT_ALLOWED`.
    ///
    /// # Errors
    /// As [`HostServices::memory_invalidate`].
    fn memory_confirm(
        &self,
        _space: &str,
        _request: Confirm,
    ) -> Result<MemoryVersionMeta, HostError> {
        not_granted("memory_write")
    }
    /// Grant `memory_write`: erase the caller's own records. A selector other than `ids` needs a
    /// caller with authority `person` (`MEMORY_FORGET_HUMAN_REQUIRED`).
    ///
    /// # Errors
    /// As [`HostServices::memory_write`].
    fn memory_forget(
        &self,
        _space: &str,
        _selector: ForgetSelector,
    ) -> Result<ForgetReceipt, HostError> {
        not_granted("memory_write")
    }
    /// Grant `memory_write`: `memory-erase` (phase 5 section 8.4). The host checks a verified
    /// eraser (`erasers`), the target principal, the plan and the two-person rule, selects the
    /// target's records by owner whatever their access set, and answers counts only.
    ///
    /// # Errors
    /// [`HostError::NotGranted`] (`MEMORY_ERASE_NOT_ALLOWED`), [`HostError::Invalid`]
    /// (`MEMORY_ERASE_PLAN_STALE`, `MEMORY_ERASE_SECOND_ERASER_REQUIRED`,
    /// `MEMORY_ERASE_REQUEST_EXPIRED`, `MEMORY_INVALID`), and as [`HostServices::memory_write`].
    fn memory_erase(
        &self,
        _space: &str,
        _call: crate::memory::EraseCall,
    ) -> Result<crate::memory::EraseAnswer, HostError> {
        not_granted("memory_write")
    }
    /// Grant `memory_write`: what `memory-erase-preview` may show. Run as the host's check before
    /// a decision is begun (`CallContext::person_check`), it makes the erase's own checks first.
    ///
    /// # Errors
    /// As [`HostServices::memory_erase`].
    fn memory_erase_preview(
        &self,
        _space: &str,
        _call: crate::memory::EraseCall,
    ) -> Result<crate::memory::ErasePreview, HostError> {
        not_granted("memory_write")
    }
    /// Grant `memory_write`: purge at most `limit` records past their purge date.
    ///
    /// # Errors
    /// As [`HostServices::memory_write`].
    fn memory_sweep(
        &self,
        _space: &str,
        _limit: u32,
        _retention: Retention,
    ) -> Result<SweepReceipt, HostError> {
        not_granted("memory_write")
    }
    /// Grant `memory_write`: rebuild the lexical lane; removes orphan keys only when asked.
    ///
    /// # Errors
    /// As [`HostServices::memory_write`].
    fn memory_reindex(
        &self,
        _space: &str,
        _remove_orphans: bool,
    ) -> Result<ReindexReceipt, HostError> {
        not_granted("memory_write")
    }
}

impl<T: HostServices> ConfigServices for T {
    fn config(&self) -> Result<Value, HostError> {
        HostServices::config(self)
    }
}

impl<T: HostServices> LogServices for T {
    fn log(&self, level: Level, message: &str) {
        HostServices::log(self, level, message)
    }
}

impl<T: HostServices> PackServices for T {
    fn pack_list(&self, pack: &str) -> Result<Vec<String>, HostError> {
        HostServices::pack_list(self, pack)
    }
    fn pack_read(&self, pack: &str, path: &str) -> Result<Vec<u8>, HostError> {
        HostServices::pack_read(self, pack, path)
    }
}

impl<T: HostServices> EventServices for T {
    fn events(
        &self,
        space: Option<&str>,
        after: Option<&str>,
        limit: u32,
    ) -> Result<Value, HostError> {
        HostServices::events(self, space, after, limit)
    }
}

impl<T: HostServices> ClockServices for T {
    fn now_ms(&self) -> Result<i64, HostError> {
        HostServices::now_ms(self)
    }
}

impl<T: HostServices> RandomServices for T {
    fn random(&self) -> Result<f64, HostError> {
        HostServices::random(self)
    }
}

impl<T: HostServices> ContentServices for T {
    fn content_list(
        &self,
        space: &str,
        collection: &str,
        after: Option<&str>,
        limit: u32,
    ) -> Result<Page<ContentEntry>, HostError> {
        HostServices::content_list(self, space, collection, after, limit)
    }
    fn content_collections(&self, space: &str) -> Result<Vec<CollectionInfo>, HostError> {
        HostServices::content_collections(self, space)
    }
    fn content_read(
        &self,
        space: &str,
        collection: &str,
        path: &str,
    ) -> Result<Vec<u8>, HostError> {
        HostServices::content_read(self, space, collection, path)
    }
}

impl<T: HostServices> ContentWriteServices for T {
    fn content_replace(
        &self,
        space: &str,
        collection: &str,
        path: &str,
        bytes: &[u8],
        expect: Expect,
    ) -> Result<ContentHash, HostError> {
        HostServices::content_replace(self, space, collection, path, bytes, expect)
    }
}

impl<T: HostServices> DocumentServices for T {
    fn doc_get(&self, space: &str, id: &str) -> Result<Option<Document>, HostError> {
        HostServices::doc_get(self, space, id)
    }
    fn doc_list(&self, space: &str, query: &ListQuery) -> Result<Page<DocMeta>, HostError> {
        HostServices::doc_list(self, space, query)
    }
    fn doc_changes(
        &self,
        space: &str,
        after: Rev,
        limit: u32,
        trace: Option<&str>,
    ) -> Result<Vec<Change>, HostError> {
        HostServices::doc_changes(self, space, after, limit, trace)
    }
    fn doc_position(&self, space: &str, rev: Rev) -> Result<Value, HostError> {
        HostServices::doc_position(self, space, rev)
    }
    fn doc_position_of(&self, space: &str, value: &Value) -> Result<Rev, HostError> {
        HostServices::doc_position_of(self, space, value)
    }
    fn reader_tokens(&self, space: &str) -> Result<Vec<String>, HostError> {
        HostServices::reader_tokens(self, space)
    }
    fn readable_collections(&self, space: &str) -> Result<Vec<CollectionMeta>, HostError> {
        HostServices::readable_collections(self, space)
    }
    fn doc_own(&self, space: &str, doc: &str) -> Result<Option<OwnInfo>, HostError> {
        HostServices::doc_own(self, space, doc)
    }
}

impl<T: HostServices> DocumentWriteServices for T {
    fn doc_put(
        &self,
        space: &str,
        doc: DocumentWrite,
        expect: Expect,
    ) -> Result<DocMeta, HostError> {
        HostServices::doc_put(self, space, doc, expect)
    }
    fn doc_delete(
        &self,
        space: &str,
        id: &str,
        expect: Expect,
        envelope: Envelope,
    ) -> Result<Rev, HostError> {
        HostServices::doc_delete(self, space, id, expect, envelope)
    }
}

impl<T: HostServices> RecordServices for T {
    fn record_get(&self, space: &str, kind: &str, id: &str) -> Result<Option<Record>, HostError> {
        HostServices::record_get(self, space, kind, id)
    }
    fn record_list(
        &self,
        space: &str,
        kind: &str,
        after: Option<&str>,
        limit: u32,
    ) -> Result<Page<Record>, HostError> {
        HostServices::record_list(self, space, kind, after, limit)
    }
    fn record_read(
        &self,
        space: &str,
        kind: &str,
        id: &str,
        standings: &[Standing],
        verified_only: bool,
    ) -> Result<Option<LaneRecord>, HostError> {
        HostServices::record_read(self, space, kind, id, standings, verified_only)
    }
    fn record_find(&self, space: &str, query: &RecordFind) -> Result<FindPage, HostError> {
        HostServices::record_find(self, space, query)
    }
    fn record_match(&self, space: &str, query: &RecordMatch) -> Result<MatchPage, HostError> {
        HostServices::record_match(self, space, query)
    }
}

impl<T: HostServices> RecordWriteServices for T {
    fn record_put(
        &self,
        space: &str,
        kind: &str,
        id: &str,
        body: Value,
        envelope: Envelope,
        expect: Expect,
    ) -> Result<RecordMeta, HostError> {
        HostServices::record_put(self, space, kind, id, body, envelope, expect)
    }
    #[allow(clippy::too_many_arguments)]
    fn record_put_cited(
        &self,
        space: &str,
        kind: &str,
        id: &str,
        body: Value,
        envelope: Envelope,
        expect: Expect,
        evidence: Evidence,
    ) -> Result<RecordMeta, HostError> {
        HostServices::record_put_cited(self, space, kind, id, body, envelope, expect, evidence)
    }
    fn record_decide(
        &self,
        space: &str,
        kind: &str,
        id: &str,
        decision: Decision,
    ) -> Result<StandingLabel, HostError> {
        HostServices::record_decide(self, space, kind, id, decision)
    }
    fn doc_own_mark(
        &self,
        space: &str,
        doc: &str,
        content_hash: &ContentHash,
        speaker: Option<&str>,
    ) -> Result<Rev, HostError> {
        HostServices::doc_own_mark(self, space, doc, content_hash, speaker)
    }
    fn doc_own_unmark(&self, space: &str, doc: &str) -> Result<Rev, HostError> {
        HostServices::doc_own_unmark(self, space, doc)
    }
    fn record_forget_history(&self, space: &str, kind: &str, id: &str) -> Result<u64, HostError> {
        HostServices::record_forget_history(self, space, kind, id)
    }
}

impl<T: HostServices> IndexServices for T {
    fn index_search(&self, space: &str, query: &IndexQuery) -> Result<Vec<ChunkHit>, HostError> {
        HostServices::index_search(self, space, query)
    }
    fn index_chunks(&self, space: &str, doc: &str) -> Result<Vec<IndexChunk>, HostError> {
        HostServices::index_chunks(self, space, doc)
    }
    fn index_applied(&self, space: &str) -> Result<Rev, HostError> {
        HostServices::index_applied(self, space)
    }
}

impl<T: HostServices> IndexWriteServices for T {
    fn index_writer(&self, space: &str) -> Result<Box<dyn IndexWriterSession>, HostError> {
        HostServices::index_writer(self, space)
    }
}

impl<T: HostServices> GraphServices for T {
    fn graph_neighbors(
        &self,
        space: &str,
        node: &str,
        kinds: &[String],
        direction: Direction,
        limit: u32,
    ) -> Result<Vec<Edge>, HostError> {
        HostServices::graph_neighbors(self, space, node, kinds, direction, limit)
    }
    fn graph_nodes(&self, space: &str, ids: &[String]) -> Result<Vec<Node>, HostError> {
        HostServices::graph_nodes(self, space, ids)
    }
    fn graph_edges(
        &self,
        space: &str,
        kind: &str,
        after: Option<&EdgeKey>,
        limit: u32,
    ) -> Result<Vec<Edge>, HostError> {
        HostServices::graph_edges(self, space, kind, after, limit)
    }
    fn graph_subgraph(&self, space: &str) -> Result<Subgraph, HostError> {
        HostServices::graph_subgraph(self, space)
    }
    fn graph_applied(&self, space: &str) -> Result<Rev, HostError> {
        HostServices::graph_applied(self, space)
    }
}

impl<T: HostServices> GraphWriteServices for T {
    fn graph_apply(&self, space: &str, batch: GraphBatch, applied: Rev) -> Result<(), HostError> {
        HostServices::graph_apply(self, space, batch, applied)
    }
}

impl<T: HostServices> DeriveServices for T {
    fn derive_changes(
        &self,
        space: &str,
        after: Rev,
        limit: u32,
    ) -> Result<Vec<Change>, HostError> {
        HostServices::derive_changes(self, space, after, limit)
    }
    fn derive_document(&self, space: &str, id: &str) -> Result<Option<Document>, HostError> {
        HostServices::derive_document(self, space, id)
    }
    fn derive_head(&self, space: &str) -> Result<Rev, HostError> {
        HostServices::derive_head(self, space)
    }
}

impl<T: HostServices> MaintenanceServices for T {
    fn checkpoint(&self, space: &str) -> Result<(), HostError> {
        HostServices::checkpoint(self, space)
    }
    fn truncate_wal(&self, space: &str) -> Result<WalCheckpoint, HostError> {
        HostServices::truncate_wal(self, space)
    }
}

impl<T: HostServices> ReaderServices for T {
    fn as_reader(&self, principal: &str) -> Result<Reader, HostError> {
        HostServices::as_reader(self, principal)
    }
}

impl<T: HostServices> MemoryServices for T {
    fn memory_get(
        &self,
        space: &str,
        id: &str,
        as_of: AsOf,
        flags: ReadFlags,
    ) -> Result<Option<MemoryRecord>, HostError> {
        HostServices::memory_get(self, space, id, as_of, flags)
    }
    fn memory_history(&self, space: &str, id: &str) -> Result<Vec<MemoryRecord>, HostError> {
        HostServices::memory_history(self, space, id)
    }
    fn memory_list(&self, space: &str, query: &MemoryList) -> Result<MemoryPage, HostError> {
        HostServices::memory_list(self, space, query)
    }
    fn memory_recall(&self, space: &str, query: &RecallQuery) -> Result<RecallPage, HostError> {
        HostServices::memory_recall(self, space, query)
    }
    fn memory_left_out(&self, space: &str, query: &LeftOutQuery) -> Result<LeftOut, HostError> {
        HostServices::memory_left_out(self, space, query)
    }
    fn memory_changes(
        &self,
        space: &str,
        after: Rev,
        limit: u32,
        trace: Option<&str>,
    ) -> Result<Vec<MemoryChange>, HostError> {
        HostServices::memory_changes(self, space, after, limit, trace)
    }
    fn memory_counts(
        &self,
        space: &str,
        now: Millis,
        expiring_within_ms: Millis,
    ) -> Result<MemoryCounts, HostError> {
        HostServices::memory_counts(self, space, now, expiring_within_ms)
    }
    fn memory_usage(&self, space: &str, since: Millis) -> Result<MemoryUsage, HostError> {
        HostServices::memory_usage(self, space, since)
    }
    fn memory_head(&self, space: &str) -> Result<Rev, HostError> {
        HostServices::memory_head(self, space)
    }
    fn memory_key_file(&self, space: &str) -> Result<KeyFileState, HostError> {
        HostServices::memory_key_file(self, space)
    }
}

impl<T: HostServices> MemoryWriteServices for T {
    fn memory_write(
        &self,
        space: &str,
        request: MemoryWriteRequest,
    ) -> Result<MemoryReceipt, HostError> {
        HostServices::memory_write(self, space, request)
    }
    fn memory_invalidate(
        &self,
        space: &str,
        request: Invalidate,
    ) -> Result<MemoryVersionMeta, HostError> {
        HostServices::memory_invalidate(self, space, request)
    }
    fn memory_confirm(
        &self,
        space: &str,
        request: Confirm,
    ) -> Result<MemoryVersionMeta, HostError> {
        HostServices::memory_confirm(self, space, request)
    }
    fn memory_forget(
        &self,
        space: &str,
        selector: ForgetSelector,
    ) -> Result<ForgetReceipt, HostError> {
        HostServices::memory_forget(self, space, selector)
    }
    fn memory_erase(
        &self,
        space: &str,
        call: crate::memory::EraseCall,
    ) -> Result<crate::memory::EraseAnswer, HostError> {
        HostServices::memory_erase(self, space, call)
    }
    fn memory_erase_preview(
        &self,
        space: &str,
        call: crate::memory::EraseCall,
    ) -> Result<crate::memory::ErasePreview, HostError> {
        HostServices::memory_erase_preview(self, space, call)
    }
    fn memory_sweep(
        &self,
        space: &str,
        limit: u32,
        retention: Retention,
    ) -> Result<SweepReceipt, HostError> {
        HostServices::memory_sweep(self, space, limit, retention)
    }
    fn memory_reindex(
        &self,
        space: &str,
        remove_orphans: bool,
    ) -> Result<ReindexReceipt, HostError> {
        HostServices::memory_reindex(self, space, remove_orphans)
    }
}
