//! The search index's shared types (specification sections 3.1 and 8.1). The embedded backend
//! builds the index in step 3; the types and traits are fixed here so every backend names them.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::access::AccessSet;
use crate::document::DocId;

/// The most chunk hits one query returns.
pub const MAX_QUERY_LIMIT: u32 = 400;
/// The longest query text, in characters.
pub const MAX_QUERY_CHARS: usize = 1024;

/// One chunk as the index holds it: its text, its document's context fields and its access set.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IndexChunk {
    /// The document.
    pub doc: DocId,
    /// The chunk's position in the document, from 0.
    pub ordinal: u32,
    /// First line, 1-based, of the file including frontmatter.
    pub line_start: u32,
    /// Last line, inclusive.
    pub line_end: u32,
    /// The heading texts from the top.
    pub heading_path: Vec<String>,
    /// `sha256:<hex>` of the chunk's text.
    pub chunk_hash: String,
    /// The chunk's text.
    pub body: String,
    /// The document title.
    pub title: String,
    /// Aliases.
    pub aliases: Vec<String>,
    /// The description.
    pub description: Option<String>,
    /// Symbol names for code chunks, split by the plugin.
    pub code: Option<String>,
    /// Tags.
    pub tags: Vec<String>,
    /// Owners.
    pub owners: Vec<String>,
    /// The document type.
    #[serde(rename = "type")]
    pub doc_type: String,
    /// The collection.
    pub collection: String,
    /// The status.
    pub status: String,
    /// The verification tier.
    pub verified: String,
    /// The sensitivity.
    pub sensitivity: String,
    /// The language, for code.
    pub lang: Option<String>,
    /// The path.
    pub path: String,
    /// When the document was last updated, RFC 3339.
    pub updated: Option<String>,
    /// When the document goes stale, RFC 3339.
    pub stale_after: Option<String>,
    /// Frontmatter keys the schema pack lists as filterable.
    pub meta: Map<String, Value>,
    /// The document's access set.
    pub access: AccessSet,
}

/// Structured filters, turned into mandatory clauses.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct IndexFilters {
    /// Only this collection.
    pub collection: Option<String>,
    /// Only this type.
    pub doc_type: Option<String>,
    /// Only documents with all of these tags.
    pub tags: Vec<String>,
    /// Only this status.
    pub status: Option<String>,
    /// Only these verification tiers.
    pub verified: Vec<String>,
    /// Only this sensitivity.
    pub sensitivity: Option<String>,
    /// Only documents updated at or after this RFC 3339 time.
    pub updated_after: Option<String>,
}

/// A search: the text in the syntax of section 8.1, the structured filters and a limit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IndexQuery {
    /// The query text, at most [`MAX_QUERY_CHARS`] characters.
    pub text: String,
    /// The filters.
    pub filters: IndexFilters,
    /// At most [`MAX_QUERY_LIMIT`] chunk hits.
    pub limit: u32,
}

/// A chunk hit with its BM25 score.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ChunkHit {
    /// The document.
    pub doc: DocId,
    /// The chunk's ordinal.
    pub ordinal: u32,
    /// The BM25 score.
    pub score: f32,
    /// A highlighted snippet of the chunk's body, when the backend makes one.
    pub snippet: Option<String>,
    /// The chunk.
    pub chunk: IndexChunk,
}
