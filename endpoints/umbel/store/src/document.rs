//! Documents, records, changes and paging (specification sections 3.1 and 5.4).

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::access::AccessSet;
use crate::canonical::{ContentHash, base64_bytes, canonical_json};
use crate::envelope::{ByAt, Envelope, Sensitivity};
use crate::error::{Result, StoreError};

/// A space store's revision: from 1, shared by documents, records and tombstones.
pub type Rev = u64;

/// `<collection>/<path>`, at most [`MAX_DOC_ID_BYTES`] bytes.
pub type DocId = String;

/// The longest document id, in bytes.
pub const MAX_DOC_ID_BYTES: usize = 512;
/// The largest document, in bytes (`max_file_bytes` is at most 16 MiB).
pub const MAX_DOCUMENT_BYTES: usize = 16 * 1024 * 1024;
/// The largest everything-but-the-bytes part of a document record, in bytes of JSON.
pub const MAX_DOCUMENT_METADATA_BYTES: usize = 256 * 1024;
/// The largest record body, in bytes of canonical JSON (2 MiB).
pub const MAX_RECORD_BYTES: usize = 2 * 1024 * 1024;
/// The most documents `list_documents` and `list_records` return in one page.
pub const MAX_LIST_LIMIT: u32 = 500;
/// The most changes `changes` returns in one call.
pub const MAX_CHANGES_LIMIT: u32 = 1000;

/// A write's compare-and-set condition.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Expect {
    /// No condition.
    Any,
    /// Nothing is stored there.
    Absent,
    /// What is stored has this content hash.
    Hash(ContentHash),
}

/// A document's lifecycle status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    /// Not yet trusted.
    Draft,
    /// The default.
    Stable,
    /// Replaced or withdrawn.
    Deprecated,
}

/// The verification tier, derived from the frontmatter (section 9.3).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Tier {
    /// Never verified.
    Unverified,
    /// A machine confirmed it.
    Machine,
    /// A person reviewed it.
    Human,
    /// An owner verified it.
    Owner,
}

/// A document's verification state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Verification {
    /// The tier.
    pub tier: Tier,
    /// The latest verification.
    pub last: Option<ByAt>,
    /// How many there are.
    pub count: u32,
}

/// What ingestion noticed about a document.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Flag {
    /// A link resolves to nothing.
    BrokenLinks,
    /// Frontmatter fields were dropped by the caps.
    FieldsLimited,
    /// Zero-width, bidirectional or tag characters, or a long HTML comment.
    HiddenText,
    /// The injection scan matched.
    InstructionLike,
    /// The frontmatter failed the schema pack.
    SchemaInvalid,
    /// `type` was absent and defaulted.
    TypeDefaulted,
}

/// The document record, version 1, without its revision (`schemas/document.v1.json`): what
/// `put_document` takes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentWrite {
    /// Always 1.
    pub version: u32,
    /// `<collection>/<path without .md>`.
    pub id: DocId,
    /// The space; the store refuses another.
    pub space: String,
    /// The collection.
    pub collection: String,
    /// Relative to the collection root, with extension.
    pub path: String,
    /// `sha256:<hex>` of `bytes`.
    pub content_hash: ContentHash,
    /// The file's bytes.
    #[serde(default, with = "base64_bytes")]
    pub bytes: Vec<u8>,
    /// The parsed frontmatter, unknown keys kept.
    pub frontmatter: Map<String, Value>,
    /// The document type.
    #[serde(rename = "type")]
    pub doc_type: String,
    /// The title.
    pub title: String,
    /// The description.
    pub description: Option<String>,
    /// Tags.
    pub tags: Vec<String>,
    /// Aliases.
    pub aliases: Vec<String>,
    /// Owners, OKF actors.
    pub owners: Vec<String>,
    /// The status.
    pub status: Status,
    /// An absolute datetime with a UTC offset.
    pub stale_after: Option<String>,
    /// The replacement's id.
    pub superseded_by: Option<String>,
    /// The verification state.
    pub verification: Verification,
    /// Who may read it.
    pub access: AccessSet,
    /// How sensitive it is.
    pub sensitivity: Sensitivity,
    /// Sorted flags.
    pub flags: Vec<Flag>,
    /// Bytes.
    pub size: u64,
    /// Lines.
    pub lines: u64,
    /// The provenance envelope; its access set must equal `access`.
    pub envelope: Envelope,
}

/// A stored document: the write and the revision it took.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Document {
    /// The revision of this version.
    pub rev: Rev,
    /// The record.
    #[serde(flatten)]
    pub write: DocumentWrite,
}

impl std::ops::Deref for Document {
    type Target = DocumentWrite;

    fn deref(&self) -> &DocumentWrite {
        &self.write
    }
}

/// A document without its bytes, frontmatter and envelope: what lists return.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocMeta {
    /// The id.
    pub id: DocId,
    /// The revision of this version.
    pub rev: Rev,
    /// The collection.
    pub collection: String,
    /// The path.
    pub path: String,
    /// The type.
    #[serde(rename = "type")]
    pub doc_type: String,
    /// The title.
    pub title: String,
    /// The status.
    pub status: Status,
    /// The content hash.
    pub content_hash: ContentHash,
    /// Bytes.
    pub size: u64,
    /// The sensitivity.
    pub sensitivity: Sensitivity,
    /// The access set.
    pub access: AccessSet,
    /// The flags.
    pub flags: Vec<Flag>,
}

/// A page of results; `next` is the `after` cursor of the following page, when there is one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Page<T> {
    /// The items, in order.
    pub items: Vec<T>,
    /// Pass as `after` for the next page; `None` on the last page.
    pub next: Option<String>,
}

/// `list_documents`' filters and paging. `limit` is 1 to [`MAX_LIST_LIMIT`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ListQuery {
    /// Only this collection.
    pub collection: Option<String>,
    /// Only ids starting with this.
    pub prefix: Option<String>,
    /// Only this type.
    pub doc_type: Option<String>,
    /// Only ids after this one.
    pub after: Option<DocId>,
    /// Page size.
    pub limit: u32,
}

impl ListQuery {
    /// Everything, `limit` at a time.
    #[must_use]
    pub fn all(limit: u32) -> Self {
        Self {
            collection: None,
            prefix: None,
            doc_type: None,
            after: None,
            limit,
        }
    }
}

/// What a change did.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChangeKind {
    /// A document was written.
    Put,
    /// A document was deleted.
    Delete,
    /// A record was written.
    Record,
}

/// One revision's change.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    /// The revision.
    pub rev: Rev,
    /// What it did.
    pub kind: ChangeKind,
    /// The document id, or `<ns>/<kind>/<id>` for a record.
    pub target: String,
    /// The written content's hash; for a delete, the deleted version's.
    pub content_hash: Option<String>,
    /// The writing call's trace id.
    pub trace_id: Option<String>,
    /// The commit time, from the call's clock (the envelope's `observedAt`).
    pub at: String,
}

/// A plugin record: JSON of at most [`MAX_RECORD_BYTES`], namespaced by plugin instance.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    /// The namespace, a plugin instance id.
    pub ns: String,
    /// The kind, such as `proposal` or `sync`.
    pub kind: String,
    /// The id.
    pub id: String,
    /// The revision of this version.
    pub rev: Rev,
    /// The hash of the body's canonical JSON.
    pub content_hash: ContentHash,
    /// The body.
    pub body: Value,
    /// The provenance envelope; its access set is the record's.
    pub envelope: Envelope,
}

/// What `put_record` returns.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordMeta {
    /// The namespace.
    pub ns: String,
    /// The kind.
    pub kind: String,
    /// The id.
    pub id: String,
    /// The revision taken.
    pub rev: Rev,
    /// The body's hash.
    pub content_hash: ContentHash,
}

/// `^[a-z][a-z0-9-]{0,62}$`, the shape of namespaces, kinds, collections and space ids.
#[must_use]
pub fn is_slug(text: &str) -> bool {
    let mut chars = text.chars();
    chars.next().is_some_and(|c| c.is_ascii_lowercase())
        && text.len() <= 63
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// Check an identifier (a document id or a record id): 1 to 512 bytes, no control character.
///
/// # Errors
/// [`StoreError::Invalid`] naming the rule.
pub fn check_identifier(what: &str, text: &str) -> Result<()> {
    if text.is_empty() || text.len() > MAX_DOC_ID_BYTES || text.chars().any(char::is_control) {
        return Err(StoreError::invalid(format!(
            "{what} must be 1 to {MAX_DOC_ID_BYTES} bytes without a control character"
        )));
    }
    Ok(())
}

impl DocumentWrite {
    /// The checks every store makes before writing, so every backend refuses alike: version 1,
    /// identity, the bytes and their hash and size, the envelope, and that the envelope agrees
    /// with the record about space, access and sensitivity.
    ///
    /// # Errors
    /// [`StoreError::Invalid`] or [`StoreError::TooLarge`].
    pub fn check(&self, space: &str) -> Result<()> {
        if self.version != 1 {
            return Err(StoreError::invalid("document record version must be 1"));
        }
        check_identifier("a document id", &self.id)?;
        if !is_slug(&self.collection) || !self.id.starts_with(&format!("{}/", self.collection)) {
            return Err(StoreError::invalid(
                "a document id must be <collection>/<path> with a collection matching ^[a-z][a-z0-9-]{0,62}$",
            ));
        }
        if self.id.len() == self.collection.len() + 1 {
            return Err(StoreError::invalid(
                "a document id needs a path after the collection",
            ));
        }
        if self.space != space {
            return Err(StoreError::invalid(format!(
                "the document is for space `{}`; this store is space `{space}`",
                self.space
            )));
        }
        if self.bytes.len() > MAX_DOCUMENT_BYTES {
            return Err(StoreError::TooLarge(format!(
                "a document is at most {MAX_DOCUMENT_BYTES} bytes"
            )));
        }
        if ContentHash::of(&self.bytes) != self.content_hash {
            return Err(StoreError::invalid(
                "contentHash is not the hash of the bytes",
            ));
        }
        if self.size != self.bytes.len() as u64 {
            return Err(StoreError::invalid("size is not the length of the bytes"));
        }
        let access = self.envelope.check(space)?;
        if access != self.access {
            return Err(StoreError::invalid(
                "the envelope's access set must equal the document's",
            ));
        }
        if self.envelope.sensitivity != Some(self.sensitivity) {
            return Err(StoreError::invalid(
                "the envelope's sensitivity must equal the document's",
            ));
        }
        if self.metadata_json()?.len() > MAX_DOCUMENT_METADATA_BYTES {
            return Err(StoreError::TooLarge(format!(
                "a document record without its bytes is at most {MAX_DOCUMENT_METADATA_BYTES} bytes"
            )));
        }
        Ok(())
    }

    /// The record as JSON without `bytes`: what a backend stores beside the bytes.
    ///
    /// # Errors
    /// [`StoreError::Corrupt`] if the record cannot be serialised.
    pub fn metadata_json(&self) -> Result<String> {
        let mut value = serde_json::to_value(self).map_err(|e| {
            StoreError::Corrupt(format!("a document record would not serialise: {e}"))
        })?;
        if let Value::Object(map) = &mut value {
            map.remove("bytes");
        }
        Ok(value.to_string())
    }

    /// Rebuild a record from [`DocumentWrite::metadata_json`] and its bytes.
    ///
    /// # Errors
    /// [`StoreError::Corrupt`] when the stored JSON is not a document record.
    pub fn from_metadata_json(json: &str, bytes: Vec<u8>) -> Result<Self> {
        let mut write: Self = serde_json::from_str(json).map_err(|e| {
            StoreError::Corrupt(format!("a stored document record is unreadable: {e}"))
        })?;
        write.bytes = bytes;
        Ok(write)
    }

    /// The listing form of this record at `rev`.
    #[must_use]
    pub fn meta(&self, rev: Rev) -> DocMeta {
        DocMeta {
            id: self.id.clone(),
            rev,
            collection: self.collection.clone(),
            path: self.path.clone(),
            doc_type: self.doc_type.clone(),
            title: self.title.clone(),
            status: self.status,
            content_hash: self.content_hash.clone(),
            size: self.size,
            sensitivity: self.sensitivity,
            access: self.access.clone(),
            flags: self.flags.clone(),
        }
    }
}

/// Check a record's coordinates and body, returning the body's content hash.
///
/// # Errors
/// [`StoreError::Invalid`] or [`StoreError::TooLarge`].
pub fn check_record(
    ns: &str,
    kind: &str,
    id: &str,
    body: &Value,
    envelope: &Envelope,
    space: &str,
) -> Result<(ContentHash, AccessSet)> {
    if !is_slug(ns) || !is_slug(kind) {
        return Err(StoreError::invalid(
            "a record namespace and kind must match ^[a-z][a-z0-9-]{0,62}$",
        ));
    }
    check_identifier("a record id", id)?;
    let canonical = canonical_json(body);
    if canonical.len() > MAX_RECORD_BYTES {
        return Err(StoreError::TooLarge(format!(
            "a record body is at most {MAX_RECORD_BYTES} bytes"
        )));
    }
    let access = envelope.check(space)?;
    Ok((ContentHash::of(canonical.as_bytes()), access))
}

/// The `target` of a record's change.
#[must_use]
pub fn record_target(ns: &str, kind: &str, id: &str) -> String {
    format!("{ns}/{kind}/{id}")
}
