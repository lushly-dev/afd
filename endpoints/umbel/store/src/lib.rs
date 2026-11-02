//! Umbel's store traits, version 1 (phase 2 specification, section 3.1).
//!
//! Three synchronous, object-safe traits per space: [`DocumentStore`] (documents, plugin records
//! and the change log, one revision sequence), [`SearchIndex`] (the lexical lane) and
//! [`GraphStore`] (the structural graph). Every record carries an [`AccessSet`]; every read takes
//! a [`ReaderFilter`] and applies it inside its own query. The crate holds types and traits only,
//! and builds for `wasm32-wasip2`. The `conformance` feature adds the suite every backend runs.

mod access;
mod canonical;
mod document;
mod envelope;
mod error;
mod graph;
mod index;
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
pub use envelope::{
    Actor, ActorKind, ByAt, DerivedFrom, ENVELOPE_VERSION, Envelope, MAX_ENVELOPE_LIST, Origin,
    Sensitivity, Source,
};
pub use error::{Result, StoreError};
pub use graph::{
    Direction, DocGraph, Edge, EdgeKey, GraphBatch, MAX_CONTRIBUTION_ITEMS, MAX_NODE_LOOKUP, Node,
    Subgraph,
};
pub use index::{ChunkHit, IndexChunk, IndexFilters, IndexQuery, MAX_QUERY_CHARS, MAX_QUERY_LIMIT};
pub use traits::{DocumentStore, GraphStore, IndexWriterSession, SearchIndex};

/// The store traits' version (`workspace-show`'s `versions.store`). Owned here from step 2; the
/// host re-exports it.
pub const STORE_TRAITS_VERSION: u32 = 1;
