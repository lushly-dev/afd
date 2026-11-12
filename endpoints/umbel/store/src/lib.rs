//! Umbel's store traits, version 3 (phase 2 specification section 3.1, phase 3 section 5.2, the
//! records host specification section 11).
//!
//! Four synchronous, object-safe traits per space: [`DocumentStore`] (documents, plugin records
//! and the change log, one revision sequence), [`SearchIndex`] (the lexical lane),
//! [`GraphStore`] (the structural graph) and, from version 2, [`MemoryStore`] (memory records,
//! their own revision sequence and lexical lane). Version 3 adds the record lane: the shared
//! types and pure functions of [`lane`] and the [`Embedder`] trait. Every record carries an
//! [`AccessSet`]; every read takes a [`ReaderFilter`] and applies it inside its own query. The
//! crate holds types and traits only, and builds for `wasm32-wasip2`. The `conformance` feature
//! adds the suite every backend runs.

mod access;
mod canonical;
mod document;
mod embed;
mod envelope;
mod error;
mod graph;
mod index;
pub mod lane;
pub mod memory;
mod traits;

#[cfg(feature = "conformance")]
pub mod conformance;

pub use access::{AccessSet, MAX_READER_TOKENS, ReaderFilter, validate_token};
pub use canonical::{ContentHash, base64_decode, base64_encode, canonical_json};
pub use document::{
    Change, ChangeKind, DocId, DocMeta, Document, DocumentWrite, Expect, Flag, ListQuery,
    MAX_CHANGES_LIMIT, MAX_DOC_ID_BYTES, MAX_DOCUMENT_BYTES, MAX_DOCUMENT_METADATA_BYTES,
    MAX_LIST_LIMIT, MAX_RECORD_BYTES, Page, Record, RecordMeta, Rev, Status, Tier, Verification,
    check_identifier, check_record, is_slug, record_target,
};
pub use embed::{EmbedError, Embedder, ModelId};
pub use envelope::{
    Actor, ActorKind, Assurance, Authority, ByAt, ChainLink, Confirmation, DerivedFrom,
    ENVELOPE_VERSION, Envelope, LATEST_ENVELOPE_VERSION, MAX_CONSTRAINT_CHARS, MAX_CONSTRAINTS,
    MAX_DELEGATION_CHAIN, MAX_ENVELOPE_LIST, MAX_REDACTIONS, MEMORY_ENVELOPE_VERSION, Origin,
    Redaction, Sensitivity, Source,
};
pub use error::{Result, StoreError};
pub use graph::{
    Direction, DocGraph, Edge, EdgeKey, GraphBatch, MAX_CONTRIBUTION_ITEMS, MAX_NODE_LOOKUP, Node,
    Subgraph,
};
pub use index::{ChunkHit, IndexChunk, IndexFilters, IndexQuery, MAX_QUERY_CHARS, MAX_QUERY_LIMIT};
pub use memory::{
    AsOf, ForgetSelector, MemoryBatch, MemoryClass, MemoryFlag, MemoryQuery, MemoryRecord,
    MemoryStore, MemoryWrite, Millis, PushFilter, ReadFlags, ScopeQuery,
};
pub use traits::{DocumentStore, GraphStore, IndexWriterSession, SearchIndex};

/// The store traits' version (`workspace-show`'s `versions.store`). Owned here from phase 2 step
/// 2; the host re-exports it. Version 2 is phase 3's (section 2): it adds [`MemoryStore`].
/// Version 3 is the records host specification's (section 11): it adds [`lane`] and
/// [`Embedder`], and [`DocumentStore`] gains the lane's methods in that specification's steps B2
/// to B5.
pub const STORE_TRAITS_VERSION: u32 = 3;
