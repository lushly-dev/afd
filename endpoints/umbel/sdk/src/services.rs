//! The host services of one call, one trait per grant family (D218,
//! [#1775](https://github.com/lushly-dev/afd/issues/1775)).
//!
//! A family trait holds the methods of one grant of the host's catalog (`umbel::plugins::GRANTS`),
//! a read grant and its write grant apart; derivation reads, store maintenance and `as_reader`,
//! which no one grant names, are a family each. Every method has a default that answers
//! [`HostError::NotGranted`] for the grant it names (`log` is a no-op), so an implementor writes
//! `impl RecordServices for MyHost { .. }` for the families it serves and an empty
//! `impl GraphServices for MyHost {}` for each it does not.
//!
//! [`AllServices`] is every family, and what a [`Cx`](crate::Cx) holds; [`ReadServices`] is the
//! four read families, and what a [`Reader`] holds. Both are implemented for every type that
//! implements their parts, never by hand. The frozen [`HostServices`](crate::HostServices) trait
//! implements every family through blanket impls, for implementors that have not moved yet.

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

/// Grant `config`: the instance's configuration.
///
/// Every method's default answers [`HostError::NotGranted`].
pub trait ConfigServices {
    /// Grant `config`: the instance's configuration, validated, defaults applied.
    ///
    /// # Errors
    /// [`HostError::NotGranted`].
    fn config(&self) -> Result<Value, HostError> {
        not_granted("config")
    }
}

/// Grant `log`: lines in the host's log.
///
/// Its default is a no-op.
pub trait LogServices {
    /// Grant `log`: a line in the host's log, tagged with the instance id. A no-op without the
    /// grant.
    fn log(&self, _level: Level, _message: &str) {}
}

/// Grant `packs`: the plugin's own packs, the call's space's effective copy.
///
/// Every method's default answers [`HostError::NotGranted`].
pub trait PackServices {
    /// Grant `packs`: the files of one of the plugin's packs, as paths inside the pack.
    ///
    /// # Errors
    /// [`HostError::NotGranted`], [`HostError::NotFound`].
    fn pack_list(&self, _pack: &str) -> Result<Vec<String>, HostError> {
        not_granted("packs")
    }

    /// Grant `packs`: one file of one of the plugin's packs.
    ///
    /// # Errors
    /// [`HostError::NotGranted`], [`HostError::NotFound`], [`HostError::Invalid`] for a path
    /// outside the pack, [`HostError::TooLarge`] past the per-call cap.
    fn pack_read(&self, _pack: &str, _path: &str) -> Result<Vec<u8>, HostError> {
        not_granted("packs")
    }
}

/// Grant `events`: the event log, read by cursor.
///
/// Every method's default answers [`HostError::NotGranted`].
pub trait EventServices {
    /// Grant `events`: `event-list`'s read under the caller's principal, without acknowledging.
    ///
    /// # Errors
    /// [`HostError::NotGranted`], including for a space the instance is not enabled for;
    /// [`HostError::Invalid`].
    fn events(
        &self,
        _space: Option<&str>,
        _after: Option<&str>,
        _limit: u32,
    ) -> Result<Value, HostError> {
        not_granted("events")
    }
}

/// Grant `clock`: the command context's clock.
///
/// Every method's default answers [`HostError::NotGranted`].
pub trait ClockServices {
    /// Grant `clock`: the command context's clock, in epoch milliseconds.
    ///
    /// # Errors
    /// [`HostError::NotGranted`].
    fn now_ms(&self) -> Result<i64, HostError> {
        not_granted("clock")
    }
}

/// Grant `random`: the command context's random source.
///
/// Every method's default answers [`HostError::NotGranted`].
pub trait RandomServices {
    /// Grant `random`: the command context's random source, in `[0, 1)`.
    ///
    /// # Errors
    /// [`HostError::NotGranted`].
    fn random(&self) -> Result<f64, HostError> {
        not_granted("random")
    }
}

/// Grant `content`: the files under the space's collection roots, read.
///
/// Every method's default answers [`HostError::NotGranted`].
pub trait ContentServices {
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
}

/// Grant `content_write`: a file under a collection root, replaced by rename.
///
/// Every method's default answers [`HostError::NotGranted`].
pub trait ContentWriteServices {
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
}

/// Grant `documents`: the document store, read under the caller's reader filter.
///
/// Every method's default answers [`HostError::NotGranted`].
pub trait DocumentServices {
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
    /// As [`DocumentServices::doc_get`], and [`HostError::Invalid`] for a bad limit.
    fn doc_list(&self, _space: &str, _query: &ListQuery) -> Result<Page<DocMeta>, HostError> {
        not_granted("documents")
    }

    /// Grant `documents`: the readable changes after `after`.
    ///
    /// # Errors
    /// As [`DocumentServices::doc_list`].
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
    /// [`DocumentServices::doc_position_of`].
    ///
    /// # Errors
    /// [`HostError::NotGranted`], [`HostError::Busy`], [`HostError::Corrupt`], [`HostError::Io`].
    fn doc_position(&self, _space: &str, _rev: Rev) -> Result<Value, HostError> {
        not_granted("documents")
    }

    /// Grant `documents`: the revision a value [`DocumentServices::doc_position`] gave this caller
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
    /// As [`DocumentServices::doc_get`].
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
    /// As [`DocumentServices::doc_get`].
    fn readable_collections(&self, _space: &str) -> Result<Vec<CollectionMeta>, HostError> {
        not_granted("documents")
    }

    /// Grant `documents`: how a readable document is the person's own now, by collection or by
    /// mark, or `None` when it is not (section 6.2).
    ///
    /// # Errors
    /// As [`DocumentServices::doc_get`].
    fn doc_own(&self, _space: &str, _doc: &str) -> Result<Option<OwnInfo>, HostError> {
        not_granted("documents")
    }
}

/// Grant `documents_write`: the document store, written with a provenance envelope.
///
/// Every method's default answers [`HostError::NotGranted`].
pub trait DocumentWriteServices {
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
    /// As [`DocumentWriteServices::doc_put`], and [`HostError::NotFound`].
    fn doc_delete(
        &self,
        _space: &str,
        _id: &str,
        _expect: Expect,
        _envelope: Envelope,
    ) -> Result<Rev, HostError> {
        not_granted("documents_write")
    }
}

/// Grant `records`: the instance's own records, read, and a declared kind's record lane.
///
/// Every method's default answers [`HostError::NotGranted`].
pub trait RecordServices {
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
    /// As [`RecordServices::record_get`], and [`HostError::Invalid`] for a bad limit.
    fn record_list(
        &self,
        _space: &str,
        _kind: &str,
        _after: Option<&str>,
        _limit: u32,
    ) -> Result<Page<Record>, HostError> {
        not_granted("records")
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
    /// As [`RecordServices::record_read`], and [`HostError::Invalid`] with a message starting
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
    /// As [`RecordServices::record_find`] under order `rank`: `RECORD_QUERY_TOO_BROAD` when the
    /// kind as a whole holds more postings than a match reads, the same for every call and every
    /// reader of the kind (section 8.2).
    fn record_match(&self, _space: &str, _query: &RecordMatch) -> Result<MatchPage, HostError> {
        not_granted("records")
    }
}

/// Grant `records_write`: the instance's own records, written, and a person's decisions and
/// marks. A mark on a document (`doc_own_mark`, `doc_own_unmark`) needs `documents` as well.
///
/// Every method's default answers [`HostError::NotGranted`].
pub trait RecordWriteServices {
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
    /// As [`DocumentWriteServices::doc_put`]; for a declared kind also [`HostError::Invalid`]
    /// with a message starting `RECORD_PRINCIPAL_REQUIRED`, `RECORD_FIELD_INVALID`,
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
    /// As [`RecordWriteServices::record_put`]; [`HostError::Invalid`] with a message starting
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
    /// As [`RecordWriteServices::doc_own_mark`]; [`HostError::NotFound`] also with no mark.
    fn doc_own_unmark(&self, _space: &str, _doc: &str) -> Result<Rev, HostError> {
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
}

/// Grant `index`: the space's search index, read under the caller's reader filter.
///
/// Every method's default answers [`HostError::NotGranted`].
pub trait IndexServices {
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
    /// As [`IndexServices::index_search`].
    fn index_chunks(&self, _space: &str, _doc: &str) -> Result<Vec<IndexChunk>, HostError> {
        not_granted("index")
    }

    /// Grant `index`: the store revision the space's index reflects.
    ///
    /// # Errors
    /// As [`IndexServices::index_search`].
    fn index_applied(&self, _space: &str) -> Result<Rev, HostError> {
        not_granted("index")
    }
}

/// Grant `index_write`: the space's index writer.
///
/// Every method's default answers [`HostError::NotGranted`].
pub trait IndexWriteServices {
    /// Grant `index_write`: take the space's index writer, waiting at most the lock timeout.
    ///
    /// # Errors
    /// [`HostError::NotGranted`], [`HostError::Busy`] (retryable).
    fn index_writer(&self, _space: &str) -> Result<Box<dyn IndexWriterSession>, HostError> {
        not_granted("index_write")
    }
}

/// Grant `graph`: the space's graph, read under the caller's reader filter.
///
/// Every method's default answers [`HostError::NotGranted`].
pub trait GraphServices {
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
    /// As [`GraphServices::graph_neighbors`].
    fn graph_nodes(&self, _space: &str, _ids: &[String]) -> Result<Vec<Node>, HostError> {
        not_granted("graph")
    }

    /// Grant `graph`: readable edges of one kind, after `after`.
    ///
    /// # Errors
    /// As [`GraphServices::graph_neighbors`].
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
    /// As [`GraphServices::graph_neighbors`].
    fn graph_subgraph(&self, _space: &str) -> Result<Subgraph, HostError> {
        not_granted("graph")
    }

    /// Grant `graph`: the store revision the space's graph reflects. Like
    /// [`IndexServices::index_applied`] it is shown to every reader.
    ///
    /// # Errors
    /// As [`GraphServices::graph_neighbors`].
    fn graph_applied(&self, _space: &str) -> Result<Rev, HostError> {
        not_granted("graph")
    }
}

/// Grant `graph_write`: the space's graph, written.
///
/// Every method's default answers [`HostError::NotGranted`].
pub trait GraphWriteServices {
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
}

/// Derivation reads, which ignore the caller's reader filter: for a command with the
/// `store-write` effect that holds `index_write` or `graph_write` for the space.
///
/// Every method's default answers [`HostError::NotGranted`].
pub trait DeriveServices {
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

    /// A derivation read of one document. The same rules as [`DeriveServices::derive_changes`].
    ///
    /// # Errors
    /// As [`DeriveServices::derive_changes`].
    fn derive_document(&self, _space: &str, _id: &str) -> Result<Option<Document>, HostError> {
        not_granted("index_write")
    }

    /// A derivation read of the space's **true** head revision: the last revision of any change,
    /// readable by the caller or not. It counts what the caller may not read, so it is offered
    /// only where a derivation read is (the same rules as [`DeriveServices::derive_changes`]); a
    /// command that answers a reader reports the highest revision of a change the reader can
    /// read instead.
    ///
    /// # Errors
    /// As [`DeriveServices::derive_changes`].
    fn derive_head(&self, _space: &str) -> Result<Rev, HostError> {
        not_granted("index_write")
    }
}

/// Store maintenance after a run that wrote: for a writable call holding `documents_write`,
/// `records_write`, `index_write` or `graph_write`, allowed for the space.
///
/// Every method's default answers [`HostError::NotGranted`].
pub trait MaintenanceServices {
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
    /// are gone or wait for a later checkpoint. The same grants as
    /// [`MaintenanceServices::checkpoint`]. Compiled plugins only: no WIT world has such a
    /// function.
    ///
    /// # Errors
    /// [`HostError::NotGranted`] (the message names `STORE_WRITE_NOT_ALLOWED` when a write grant
    /// is held but not allowed for the space), [`HostError::Io`], [`HostError::Corrupt`].
    fn truncate_wal(&self, _space: &str) -> Result<WalCheckpoint, HostError> {
        not_granted("records_write")
    }
}

/// The read methods as another principal (`knowledge-eval`): in a command exposed to the CLI
/// alone, for a human caller. It needs no grant of its own; each read through the
/// [`Reader`] needs that read's grant, as the same read through [`Cx`](crate::Cx) does. The
/// default names `documents`.
///
/// Every method's default answers [`HostError::NotGranted`].
pub trait ReaderServices {
    /// The read methods as another principal (`knowledge-eval`). Only in a command exposed to
    /// the CLI alone, when the call's actor is a human.
    ///
    /// # Errors
    /// [`HostError::NotGranted`] (the message names `STORE_WRITE_NOT_ALLOWED`).
    fn as_reader(&self, _principal: &str) -> Result<Reader, HostError> {
        not_granted("documents")
    }
}

/// Grant `memory`: memory records, read under the caller's reader filter.
///
/// Every method's default answers [`HostError::NotGranted`].
pub trait MemoryServices {
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
    /// As [`MemoryServices::memory_get`].
    fn memory_history(&self, _space: &str, _id: &str) -> Result<Vec<MemoryRecord>, HostError> {
        not_granted("memory")
    }

    /// Grant `memory`: readable records, newest recorded first.
    ///
    /// # Errors
    /// As [`MemoryServices::memory_get`], and [`HostError::Invalid`] for a bad query.
    fn memory_list(&self, _space: &str, _query: &MemoryList) -> Result<MemoryPage, HostError> {
        not_granted("memory")
    }

    /// Grant `memory`: ranked hits, with no score.
    ///
    /// # Errors
    /// As [`MemoryServices::memory_list`].
    fn memory_recall(&self, _space: &str, _query: &RecallQuery) -> Result<RecallPage, HostError> {
        not_granted("memory")
    }

    /// Grant `memory`: what a bundle's push rule leaves out, per class. Reads no key.
    ///
    /// # Errors
    /// As [`MemoryServices::memory_list`].
    fn memory_left_out(&self, _space: &str, _query: &LeftOutQuery) -> Result<LeftOut, HostError> {
        not_granted("memory")
    }

    /// Grant `memory`: the changes after `after` that the caller can read. No text.
    ///
    /// # Errors
    /// As [`MemoryServices::memory_list`].
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
    /// As [`MemoryServices::memory_list`].
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
    /// As [`MemoryServices::memory_get`].
    fn memory_usage(&self, _space: &str, _since: Millis) -> Result<MemoryUsage, HostError> {
        not_granted("memory")
    }

    /// Grant `memory`: the highest revision of a change the caller can read, never the store's
    /// true head (phase 3 section 6.1).
    ///
    /// # Errors
    /// As [`MemoryServices::memory_get`].
    fn memory_head(&self, _space: &str) -> Result<Rev, HostError> {
        not_granted("memory")
    }

    /// Grant `memory`: whether the key file is present, missing or another database's. Only the
    /// file's state: the store-wide counts of markers and orphans stay with `store-check`.
    ///
    /// # Errors
    /// As [`MemoryServices::memory_get`].
    fn memory_key_file(&self, _space: &str) -> Result<KeyFileState, HostError> {
        not_granted("memory")
    }
}

/// Grant `memory_write`: memory records, written, invalidated, confirmed, forgotten, erased and
/// swept.
///
/// Every method's default answers [`HostError::NotGranted`].
pub trait MemoryWriteServices {
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
    /// As [`MemoryWriteServices::memory_write`], and [`HostError::Conflict`],
    /// [`HostError::KeyAbsent`].
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
    /// As [`MemoryWriteServices::memory_invalidate`].
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
    /// As [`MemoryWriteServices::memory_write`].
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
    /// `MEMORY_ERASE_REQUEST_EXPIRED`, `MEMORY_INVALID`), and as
    /// [`MemoryWriteServices::memory_write`].
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
    /// As [`MemoryWriteServices::memory_erase`].
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
    /// As [`MemoryWriteServices::memory_write`].
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
    /// As [`MemoryWriteServices::memory_write`].
    fn memory_reindex(
        &self,
        _space: &str,
        _remove_orphans: bool,
    ) -> Result<ReindexReceipt, HostError> {
        not_granted("memory_write")
    }
}

/// The four read families: what [`Reader`] (from [`ReaderServices::as_reader`]) holds, so nothing
/// that writes is reachable through it. Implemented for every type that implements them.
pub trait ReadServices:
    DocumentServices + RecordServices + IndexServices + GraphServices + Send + Sync
{
}

impl<T> ReadServices for T where
    T: DocumentServices + RecordServices + IndexServices + GraphServices + Send + Sync
{
}

/// Every grant family: what a [`Cx`](crate::Cx) holds. Implemented for every type that implements
/// all of them; a new family is a new supertrait here, so it is a breaking change of the SDK
/// (its README's version policy).
pub trait AllServices:
    ReadServices
    + ConfigServices
    + LogServices
    + PackServices
    + EventServices
    + ClockServices
    + RandomServices
    + ContentServices
    + ContentWriteServices
    + DocumentWriteServices
    + RecordWriteServices
    + IndexWriteServices
    + GraphWriteServices
    + DeriveServices
    + MaintenanceServices
    + ReaderServices
    + MemoryServices
    + MemoryWriteServices
    + Send
    + Sync
{
}

impl<T> AllServices for T where
    T: ReadServices
        + ConfigServices
        + LogServices
        + PackServices
        + EventServices
        + ClockServices
        + RandomServices
        + ContentServices
        + ContentWriteServices
        + DocumentWriteServices
        + RecordWriteServices
        + IndexWriteServices
        + GraphWriteServices
        + DeriveServices
        + MaintenanceServices
        + ReaderServices
        + MemoryServices
        + MemoryWriteServices
        + Send
        + Sync
{
}

/// Services for a call whose plugin was granted nothing: every method answers its default,
/// `NotGranted`.
#[derive(Debug, Clone, Copy, Default)]
pub struct NoServices;

impl ConfigServices for NoServices {}
impl LogServices for NoServices {}
impl PackServices for NoServices {}
impl EventServices for NoServices {}
impl ClockServices for NoServices {}
impl RandomServices for NoServices {}
impl ContentServices for NoServices {}
impl ContentWriteServices for NoServices {}
impl DocumentServices for NoServices {}
impl DocumentWriteServices for NoServices {}
impl RecordServices for NoServices {}
impl RecordWriteServices for NoServices {}
impl IndexServices for NoServices {}
impl IndexWriteServices for NoServices {}
impl GraphServices for NoServices {}
impl GraphWriteServices for NoServices {}
impl DeriveServices for NoServices {}
impl MaintenanceServices for NoServices {}
impl ReaderServices for NoServices {}
impl MemoryServices for NoServices {}
impl MemoryWriteServices for NoServices {}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use super::*;
    use crate::{CallContext, Cx, HostServices};

    fn call() -> CallContext {
        CallContext {
            spaces: vec!["main".to_owned()],
            ..CallContext::default()
        }
    }

    fn names(result: Result<(), HostError>, grant: &str) {
        match result {
            Err(HostError::NotGranted(message)) => {
                assert!(message.contains(&format!("`{grant}`")), "{message}");
            }
            other => panic!("{other:?}"),
        }
    }

    /// An implementor written against the frozen trait, as the ideas plugin's test stub is.
    struct Legacy;

    impl HostServices for Legacy {
        fn config(&self) -> Result<Value, HostError> {
            Ok(Value::from("legacy"))
        }
        fn log(&self, _level: Level, _message: &str) {}
        fn pack_list(&self, _pack: &str) -> Result<Vec<String>, HostError> {
            Ok(vec!["a".to_owned()])
        }
        fn pack_read(&self, _pack: &str, _path: &str) -> Result<Vec<u8>, HostError> {
            Ok(b"x".to_vec())
        }
        fn events(
            &self,
            _space: Option<&str>,
            _after: Option<&str>,
            _limit: u32,
        ) -> Result<Value, HostError> {
            Ok(Value::Null)
        }
        fn now_ms(&self) -> Result<i64, HostError> {
            Ok(7)
        }
        fn random(&self) -> Result<f64, HostError> {
            Ok(0.5)
        }
        fn record_get(
            &self,
            _space: &str,
            _kind: &str,
            _id: &str,
        ) -> Result<Option<Record>, HostError> {
            Ok(None)
        }
        fn memory_head(&self, _space: &str) -> Result<Rev, HostError> {
            Ok(3)
        }
    }

    #[test]
    fn a_legacy_implementor_reaches_every_family_through_cx() {
        let cx = Cx::new(call(), Legacy);
        assert_eq!(cx.config().unwrap(), Value::from("legacy"));
        assert_eq!(cx.now_ms().unwrap(), 7);
        assert_eq!(cx.pack_list("p").unwrap(), vec!["a".to_owned()]);
        assert!(cx.record_get("main", "k", "i").unwrap().is_none());
        assert_eq!(cx.memory_head("main").unwrap(), 3);
        // What it does not override answers the frozen trait's default, naming the same grant.
        names(cx.doc_get("main", "c/a").map(drop), "documents");
        names(cx.graph_applied("main").map(drop), "graph");
        names(
            cx.memory_sweep("main", 1, Retention::default()).map(drop),
            "memory_write",
        );
        // Its reads reach a reader too, through the blanket impls.
        let reader = crate::Reader::new(Box::new(Legacy));
        assert!(reader.record_get("main", "k", "i").unwrap().is_none());
    }

    /// An implementor of two families, with an empty impl for every other.
    struct RecordsOnly;

    impl RecordServices for RecordsOnly {
        fn record_get(
            &self,
            _space: &str,
            _kind: &str,
            _id: &str,
        ) -> Result<Option<Record>, HostError> {
            Ok(None)
        }
    }
    impl ClockServices for RecordsOnly {
        fn now_ms(&self) -> Result<i64, HostError> {
            Ok(11)
        }
    }
    impl ConfigServices for RecordsOnly {}
    impl LogServices for RecordsOnly {}
    impl PackServices for RecordsOnly {}
    impl EventServices for RecordsOnly {}
    impl RandomServices for RecordsOnly {}
    impl ContentServices for RecordsOnly {}
    impl ContentWriteServices for RecordsOnly {}
    impl DocumentServices for RecordsOnly {}
    impl DocumentWriteServices for RecordsOnly {}
    impl RecordWriteServices for RecordsOnly {}
    impl IndexServices for RecordsOnly {}
    impl IndexWriteServices for RecordsOnly {}
    impl GraphServices for RecordsOnly {}
    impl GraphWriteServices for RecordsOnly {}
    impl DeriveServices for RecordsOnly {}
    impl MaintenanceServices for RecordsOnly {}
    impl ReaderServices for RecordsOnly {}
    impl MemoryServices for RecordsOnly {}
    impl MemoryWriteServices for RecordsOnly {}

    #[test]
    fn a_family_implementor_answers_its_families_and_the_defaults_elsewhere() {
        let cx = Cx::new(call(), RecordsOnly);
        assert!(cx.record_get("main", "k", "i").unwrap().is_none());
        assert_eq!(cx.now_ms().unwrap(), 11);
        names(cx.config().map(drop), "config");
        names(cx.random().map(drop), "random");
        names(cx.pack_read("p", "x").map(drop), "packs");
        names(cx.doc_get("main", "c/a").map(drop), "documents");
        names(
            cx.record_put(
                "main",
                "k",
                "i",
                Value::Null,
                umbel_store::Envelope::from_value(serde_json::json!({
                    "version": 1, "origin": "agent-inferred", "space": "main",
                    "plugin": "p", "agent": null, "principal": "human:ada", "session": null,
                    "traceId": "t", "observedAt": "2026-01-01T00:00:00.000Z",
                    "validFrom": null, "validUntil": null, "confidence": null,
                    "authority": null, "sources": null, "generated": null,
                    "contentHash": null, "derivedFrom": null, "access": ["space"],
                    "sensitivity": "internal"
                }))
                .unwrap(),
                Expect::Any,
            )
            .map(drop),
            "records_write",
        );
        names(cx.index_writer("main").map(drop), "index_write");
        names(cx.as_reader("human:ada").map(drop), "documents");
        cx.log(Level::Info, "a no-op");
        let reader = crate::Reader::new(Box::new(RecordsOnly));
        assert!(reader.record_get("main", "k", "i").unwrap().is_none());
        names(reader.graph_applied("main").map(drop), "graph");
    }

    #[test]
    fn no_services_answers_every_phase_one_default() {
        let host = NoServices;
        names(ConfigServices::config(&host).map(drop), "config");
        names(PackServices::pack_list(&host, "p").map(drop), "packs");
        names(
            EventServices::events(&host, None, None, 1).map(drop),
            "events",
        );
        names(PackServices::pack_read(&host, "p", "x").map(drop), "packs");
        names(ClockServices::now_ms(&host).map(drop), "clock");
        names(RandomServices::random(&host).map(drop), "random");
        LogServices::log(&host, Level::Info, "a no-op");
    }
}
