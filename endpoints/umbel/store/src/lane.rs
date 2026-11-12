//! The record lane's shared types (records host specification, sections 2, 6.5, 7, 8 and 11.1;
//! D159 to D165): a declared record kind, what a put extracts from a body, standing and its label,
//! and the queries and answers of finding and matching.
//!
//! The host, the SDK and every backend name these types. [`extract`], [`normalise`] and the
//! functions of [`score`] are pure, so every backend refuses alike and scores alike, as
//! [`check_record`](crate::check_record) does. Nothing here reads a store.

mod extract;
mod normalise;
mod query;
pub mod score;

use std::collections::BTreeMap;
use std::fmt;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::canonical::{ContentHash, canonical_json};
use crate::document::{DocId, Record, RecordMeta, Rev, is_slug};
use crate::embed::ModelId;
use crate::envelope::Assurance;
use crate::error::{Result, StoreError};
use crate::memory::MemoryFlag;

pub use extract::{Extracted, extract};
pub use normalise::{match_digest, normalise};
pub use query::{Cursor, FindPlan, TextPlan};

/// The most record kinds one manifest declares.
pub const MAX_RECORD_KINDS: usize = 16;
/// The most text pointers a declaration names.
pub const MAX_TEXT_POINTERS: usize = 4;
/// The most key pointers a declaration names.
pub const MAX_KEY_POINTERS: usize = 16;
/// The longest pointer, in bytes.
pub const MAX_POINTER_BYTES: usize = 128;
/// The longest value at a text pointer, in bytes of UTF-8 (16 KiB).
pub const MAX_LANE_TEXT_BYTES: usize = 16 * 1024;
/// The most values at one key pointer.
pub const MAX_KEY_VALUES: usize = 64;
/// The longest value at a key pointer, in bytes.
pub const MAX_KEY_VALUE_BYTES: usize = 256;
/// The most unit numbers an evidence names.
pub const MAX_EVIDENCE_UNITS: usize = 256;
/// The most records a find returns in one page.
pub const MAX_FIND_LIMIT: u32 = 200;
/// The longest text query of a find, in characters.
pub const MAX_FIND_QUERY_CHARS: usize = 1024;
/// The most key filters a find or a match holds.
pub const MAX_KEY_FILTERS: usize = 8;
/// The most texts one match takes.
pub const MAX_MATCH_TEXTS: usize = 64;
/// The most nearest records a text gets.
pub const MAX_MATCH_K: u32 = 20;
/// The most ids a match excludes.
pub const MAX_MATCH_EXCLUDE: usize = 64;
/// The most identical records a text gets.
pub const MAX_IDENTICAL: usize = 8;
/// The most postings the gather of one text reads (section 8.2, step 3).
pub const GATHER_POSTINGS: u64 = 20_000;
/// The most postings one call counts before it is refused (section 8.2).
pub const STAT_POSTINGS: u64 = 4_000_000;
/// How many candidates a text keeps for the second direction (section 8.2, step 5).
pub const MATCH_POOL: usize = 64;
/// The design bound of one kind in one space, in records.
pub const LANE_DESIGN_RECORDS: u64 = 100_000;
/// How many records one transaction of a rebuild writes (section 12.1, step 1.3).
pub const REINDEX_CHUNK: usize = 1_000;
/// The most terms one statement counts (section 8.2).
pub const STAT_TERMS: usize = 500;
/// The version of the identical digest's normalisation (section 8.1).
pub const NORMALISATION_VERSION: u32 = 1;

/// The bounds a backend's lane works under. [`LaneLimits::default`] is this specification's
/// constants, which every served store uses; the conformance suite lowers them for the cases that
/// must pass a bound with a handful of records (section 15.1, amended in step B2).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LaneLimits {
    /// [`GATHER_POSTINGS`].
    pub gather_postings: u64,
    /// [`STAT_POSTINGS`].
    pub stat_postings: u64,
    /// [`REINDEX_CHUNK`]; at least 1.
    pub reindex_chunk: usize,
}

impl Default for LaneLimits {
    fn default() -> Self {
        Self {
            gather_postings: GATHER_POSTINGS,
            stat_postings: STAT_POSTINGS,
            reindex_chunk: REINDEX_CHUNK,
        }
    }
}

/// The most member names a pointer holds.
const MAX_POINTER_MEMBERS: usize = 4;
/// The longest member name of a pointer, in bytes.
const MAX_POINTER_MEMBER_BYTES: usize = 64;

/// A path into a record's body: `/` followed by one to four member names joined by `/`, each
/// `^[A-Za-z_][A-Za-z0-9_]{0,63}$`, at most [`MAX_POINTER_BYTES`] bytes in all. It names object
/// members only, with no array index and no `~` escape: a subset of RFC 6901 that needs no
/// unescaping.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Pointer(String);

impl Pointer {
    /// Parse a pointer.
    ///
    /// # Errors
    /// [`StoreError::Invalid`] naming the rule. The message never holds the text.
    pub fn parse(text: &str) -> Result<Self> {
        let valid = text.len() <= MAX_POINTER_BYTES
            && text.strip_prefix('/').is_some_and(|members| {
                members.split('/').count() <= MAX_POINTER_MEMBERS
                    && members.split('/').all(is_member)
            });
        if valid {
            Ok(Self(text.to_owned()))
        } else {
            Err(StoreError::invalid(format!(
                "a pointer is / followed by 1 to {MAX_POINTER_MEMBERS} member names joined by /, each matching ^[A-Za-z_][A-Za-z0-9_]{{0,63}}$, at most {MAX_POINTER_BYTES} bytes in all"
            )))
        }
    }

    /// The text form.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// The value the pointer names in `body`, or `None` when a member on the way is absent or
    /// is not an object's.
    #[must_use]
    pub fn get<'a>(&self, body: &'a Value) -> Option<&'a Value> {
        self.0
            .split('/')
            .skip(1)
            .try_fold(body, |value, member| value.as_object()?.get(member))
    }
}

impl fmt::Display for Pointer {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// `^[A-Za-z_][A-Za-z0-9_]{0,63}$`.
fn is_member(text: &str) -> bool {
    let mut chars = text.chars();
    chars
        .next()
        .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
        && text.len() <= MAX_POINTER_MEMBER_BYTES
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// One declared record kind, `[[records]]` of a manifest (section 2, D159).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecordDecl {
    /// The kind, `^[a-z][a-z0-9-]{0,62}$`.
    pub kind: String,
    /// Whether the kind's records are standing records (D157).
    pub standing: bool,
    /// The text pointers, whose strings are indexed by words; at most [`MAX_TEXT_POINTERS`].
    pub text: Vec<Pointer>,
    /// The key pointers, whose values are filtered on exactly; at most [`MAX_KEY_POINTERS`].
    pub keys: Vec<Pointer>,
    /// The match field, as an index into `text`.
    pub matched: Option<usize>,
}

impl RecordDecl {
    /// Section 2's rules for one declaration: the kind's shape, the counts, distinct pointers,
    /// no pointer both a text and a key, a standing kind's text, a match field among the text
    /// pointers, and something declared.
    ///
    /// # Errors
    /// [`StoreError::Invalid`] naming the rule.
    pub fn check(&self) -> Result<()> {
        if !is_slug(&self.kind) {
            return Err(StoreError::invalid(
                "a declared record kind must match ^[a-z][a-z0-9-]{0,62}$",
            ));
        }
        if self.text.len() > MAX_TEXT_POINTERS {
            return Err(StoreError::invalid(format!(
                "a declared kind names at most {MAX_TEXT_POINTERS} text pointers"
            )));
        }
        if self.keys.len() > MAX_KEY_POINTERS {
            return Err(StoreError::invalid(format!(
                "a declared kind names at most {MAX_KEY_POINTERS} key pointers"
            )));
        }
        if let Some(twice) = repeated(&self.text) {
            return Err(StoreError::invalid(format!(
                "the text pointer {twice} is named twice"
            )));
        }
        if let Some(twice) = repeated(&self.keys) {
            return Err(StoreError::invalid(format!(
                "the key pointer {twice} is named twice"
            )));
        }
        if let Some(both) = self.keys.iter().find(|key| self.text.contains(key)) {
            return Err(StoreError::invalid(format!(
                "the pointer {both} is both a text pointer and a key pointer"
            )));
        }
        if self.standing && self.text.is_empty() {
            return Err(StoreError::invalid(
                "a standing kind needs at least one text pointer",
            ));
        }
        if self.matched.is_some_and(|index| index >= self.text.len()) {
            return Err(StoreError::invalid(
                "the match field must be one of the text pointers",
            ));
        }
        if self.text.is_empty() && self.keys.is_empty() {
            return Err(StoreError::invalid(
                "the declaration declares nothing: give text, keys or standing",
            ));
        }
        Ok(())
    }

    /// The match field's pointer, if the declaration names one.
    #[must_use]
    pub fn match_pointer(&self) -> Option<&Pointer> {
        self.matched.and_then(|index| self.text.get(index))
    }

    /// The declaration as JSON: `{ "keys", "kind", "match", "standing", "text" }`, pointers as
    /// strings in declaration order and `match` the match field's pointer or `null`.
    #[must_use]
    pub fn to_json(&self) -> Value {
        fn pointers(list: &[Pointer]) -> Vec<&str> {
            list.iter().map(Pointer::as_str).collect()
        }
        json!({
            "keys": pointers(&self.keys),
            "kind": self.kind,
            "match": self.match_pointer().map(Pointer::as_str),
            "standing": self.standing,
            "text": pointers(&self.text),
        })
    }

    /// `sha256:` of the canonical JSON of [`RecordDecl::to_json`]: what a store keeps to tell a
    /// changed declaration.
    #[must_use]
    pub fn hash(&self) -> ContentHash {
        ContentHash::of(canonical_json(&self.to_json()).as_bytes())
    }
}

/// The first pointer of `list` that an earlier entry already names.
fn repeated(list: &[Pointer]) -> Option<&Pointer> {
    list.iter()
        .enumerate()
        .find(|(index, pointer)| list[..*index].contains(pointer))
        .map(|(_, pointer)| pointer)
}

/// What a standing record is read as (D157, D161). Computed at each read, never stored.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Standing {
    /// Neither affirmed nor attested.
    Unverified,
    /// The wording is whole units, word for word, of a document that is the person's own now.
    Attested,
    /// The space's person affirmed the wording.
    Affirmed,
}

impl Standing {
    /// The wire spelling.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Unverified => "unverified",
            Self::Attested => "attested",
            Self::Affirmed => "affirmed",
        }
    }
}

/// What a put may say about where a wording came from (D161).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Evidence {
    /// The cited document.
    pub doc: DocId,
    /// The content the plugin compared with.
    pub doc_hash: ContentHash,
    /// The cited units: 1 to [`MAX_EVIDENCE_UNITS`], each at least 1, ascending, distinct.
    pub units: Vec<u32>,
    /// The plugin's rule and its version, `^[a-z][a-z0-9-]{0,62}/[0-9]{1,6}$`, such as
    /// `sentences/1`.
    pub rule: String,
    /// The speaker the plugin's check used: 1 to 128 characters, no control character.
    pub speaker: Option<String>,
    /// Whether the plugin found the wording to be exactly those units.
    pub verbatim: bool,
}

/// What the host adds to a declared put.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LaneWrite {
    /// The record's evidence; `None` leaves the stored evidence.
    pub evidence: Option<Evidence>,
    /// The scan's findings on the text values.
    pub flags: Vec<MemoryFlag>,
    /// The space's loaded model, if any.
    pub model: Option<ModelId>,
}

/// What a declared put answers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeclaredPut {
    /// The record as written.
    pub meta: RecordMeta,
    /// The match digest to embed for, when the record has no vector for the write's model.
    pub embed: Option<[u8; 32]>,
}

/// A collection configured as the person's own.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OwnCollection {
    /// The collection id.
    pub id: String,
    /// Which part of each document is the person's, when the collection names one.
    pub speaker: Option<String>,
}

/// What the host derives from the configuration for one call. Only the host builds one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StandingView {
    /// The space's own collections.
    pub own: Vec<OwnCollection>,
    /// The space's collections a command can write files into.
    pub command_writable: Vec<String>,
    /// The standings the call admits (section 6.6's `admitted`).
    pub admit: Vec<Standing>,
}

/// How a document is the person's own.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum OwnBasis {
    /// Its collection is configured `own`.
    Collection,
    /// The person marked it.
    Marked,
}

impl OwnBasis {
    /// The wire spelling.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Collection => "collection",
            Self::Marked => "marked",
        }
    }
}

/// The decision that affirms a record now.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Affirmation {
    /// The person's effective principal.
    pub by: String,
    /// When, ISO 8601 UTC.
    pub at: String,
    /// How the person was proven.
    pub assurance: Assurance,
}

/// The source that attests a record, as its reader may see it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LabelSource {
    /// How the cited document is the person's own; `collection` when both hold.
    pub basis: OwnBasis,
    /// The rest; `None` when the reader may not read the document.
    pub seen: Option<SourceSeen>,
}

/// What a label shows of a cited document its reader may read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceSeen {
    /// The cited document.
    pub doc: DocId,
    /// The cited content.
    pub content_hash: ContentHash,
    /// The speaker the plugin's check used.
    pub speaker: Option<String>,
    /// The cited units.
    pub units: Vec<u32>,
    /// The plugin's rule and its version.
    pub rule: String,
    /// When the host stored that content: the document version's envelope `observedAt`.
    pub stored_at: String,
    /// The document's own `generated.at`, when its frontmatter states one.
    pub generated_at: Option<String>,
}

/// The label the host computes for a standing record at each read (section 6.5).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StandingLabel {
    /// The standing.
    pub standing: Standing,
    /// For an affirmed record, its decision.
    pub affirmed: Option<Affirmation>,
    /// The source, when the record is attested by one, affirmed or not.
    pub source: Option<LabelSource>,
}

impl StandingLabel {
    /// The label as section 6.5 writes it: `source` one flat object, with `null` for each member
    /// of a document the reader may not read.
    #[must_use]
    pub fn to_json(&self) -> Value {
        let affirmed = self.affirmed.as_ref().map(|affirmed| {
            json!({
                "by": affirmed.by,
                "at": affirmed.at,
                "assurance": affirmed.assurance,
            })
        });
        let source = self.source.as_ref().map(|source| {
            let seen = source.seen.as_ref();
            json!({
                "doc": seen.map(|seen| &seen.doc),
                "contentHash": seen.map(|seen| &seen.content_hash),
                "basis": source.basis.as_str(),
                "speaker": seen.and_then(|seen| seen.speaker.as_ref()),
                "units": seen.map(|seen| &seen.units),
                "rule": seen.map(|seen| &seen.rule),
                "storedAt": seen.map(|seen| &seen.stored_at),
                "generatedAt": seen.and_then(|seen| seen.generated_at.as_ref()),
            })
        });
        json!({
            "standing": self.standing,
            "affirmed": affirmed,
            "source": source,
        })
    }
}

/// A declared record as every lane service returns it.
#[derive(Debug, Clone, PartialEq)]
pub struct LaneRecord {
    /// The record.
    pub record: Record,
    /// When the record was first put: that put's envelope `observedAt`.
    pub created_at: String,
    /// The scan's findings on its text values.
    pub flags: Vec<MemoryFlag>,
    /// The label; `None` for a kind without standing.
    pub label: Option<StandingLabel>,
}

impl LaneRecord {
    /// The record's own members plus three under the host's prefix (section 6.5):
    /// `dev.umbel/createdAt`, `dev.umbel/flags` and `dev.umbel/standing`, which is `null` for a
    /// kind without standing.
    #[must_use]
    pub fn to_json(&self) -> Value {
        json!({
            "ns": self.record.ns,
            "kind": self.record.kind,
            "id": self.record.id,
            "rev": self.record.rev,
            "contentHash": self.record.content_hash,
            "body": self.record.body,
            "envelope": self.record.envelope,
            "dev.umbel/createdAt": self.created_at,
            "dev.umbel/flags": flag_names(&self.flags),
            "dev.umbel/standing": self.label.as_ref().map(StandingLabel::to_json),
        })
    }
}

/// The wire spellings of scan findings.
fn flag_names(flags: &[MemoryFlag]) -> Vec<&'static str> {
    flags.iter().map(|flag| flag.as_str()).collect()
}

impl StandingView {
    /// Whether the view admits `standing`.
    #[must_use]
    pub fn admits(&self, standing: Standing) -> bool {
        self.admit.contains(&standing)
    }
}

/// One key filter: a record passes when one of its values at `key` is in `any`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KeyFilter {
    /// A key pointer of the declaration.
    pub key: Pointer,
    /// 1 to [`MAX_KEY_VALUES`] values.
    pub any: Vec<String>,
}

/// The order of a find's page.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum FindOrder {
    /// By id ascending, in the byte order of its UTF-8.
    Id,
    /// By first put, newest first, then id.
    Recent,
    /// By the words score of the text query; needs `text`.
    Rank,
}

impl FindOrder {
    /// The wire spelling.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Id => "id",
            Self::Recent => "recent",
            Self::Rank => "rank",
        }
    }
}

/// A find's text query: plain text, no syntax.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextQuery {
    /// 1 to [`MAX_FIND_QUERY_CHARS`] characters.
    pub query: String,
    /// Text pointers of the declaration; empty means all of them.
    pub fields: Vec<Pointer>,
}

/// A find over one declared kind (section 7).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecordFind {
    /// A declared kind of the instance.
    pub kind: String,
    /// At most [`MAX_KEY_FILTERS`] filters; a record passes when it passes every one.
    pub keys: Vec<KeyFilter>,
    /// The standings asked for; empty asks for all the call admits.
    pub standings: Vec<Standing>,
    /// Whether the call asks for verified content only (section 6.6).
    pub verified_only: bool,
    /// The text query.
    pub text: Option<TextQuery>,
    /// The order; `rank` needs `text`.
    pub order: FindOrder,
    /// The `next` of the page before, for the same query.
    pub after: Option<String>,
    /// 1 to [`MAX_FIND_LIMIT`].
    pub limit: u32,
    /// Whether to count.
    pub total: bool,
}

/// One page of a find.
#[derive(Debug, Clone, PartialEq)]
pub struct FindPage {
    /// The records, in the query's order.
    pub items: Vec<LaneRecord>,
    /// The cursor of the next page, opaque to the caller.
    pub next: Option<String>,
    /// How many records pass, when asked.
    pub total: Option<u64>,
    /// The standings the host applied.
    pub admitted: Vec<Standing>,
    /// Under order `rank` only: some records that hold the query's rarest term were not ranked.
    pub cut: bool,
}

/// A match of up to [`MAX_MATCH_TEXTS`] texts against one declared kind (section 8).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecordMatch {
    /// A declared kind with a match field.
    pub kind: String,
    /// 1 to [`MAX_MATCH_TEXTS`] texts, each 1 byte to [`MAX_LANE_TEXT_BYTES`].
    pub texts: Vec<String>,
    /// 1 to [`MAX_MATCH_K`]: the most nearest records a text gets.
    pub k: u32,
    /// Key filters, as a find's.
    pub keys: Vec<KeyFilter>,
    /// The standings asked for.
    pub standings: Vec<Standing>,
    /// Whether the call asks for verified content only.
    pub verified_only: bool,
    /// At most [`MAX_MATCH_EXCLUDE`] ids left out of both lists and out of the statistics.
    pub exclude: Vec<String>,
}

/// The incoming texts' unit vectors, one per text, which the host computed.
#[derive(Debug, Clone, PartialEq)]
pub struct MatchVectors {
    /// The model that made them.
    pub model: ModelId,
    /// `w` of the fused score: the space's `meaning.weight`.
    pub weight: f64,
    /// One vector of length 1 per text, in order.
    pub vectors: Vec<Vec<f32>>,
}

/// One record a match found.
#[derive(Debug, Clone, PartialEq)]
pub struct MatchHit {
    /// The record's id.
    pub id: String,
    /// Its revision.
    pub rev: Rev,
    /// The value of its match field.
    pub text: String,
    /// The scan's findings on its text values.
    pub flags: Vec<MemoryFlag>,
    /// Its label; `None` for a kind without standing.
    pub label: Option<StandingLabel>,
    /// The words score, at four places; `None` in `identical`.
    pub words: Option<f64>,
    /// The meaning score, at four places, when the lane served one.
    pub meaning: Option<f64>,
    /// The fused score, at four places; `None` in `identical`.
    pub fused: Option<f64>,
}

/// What one text matched.
#[derive(Debug, Clone, PartialEq)]
pub struct MatchResult {
    /// The records whose match field is identical, by id; at most [`MAX_IDENTICAL`].
    pub identical: Vec<MatchHit>,
    /// The nearest records, by `fused` descending, then id; at most `k`.
    pub nearest: Vec<MatchHit>,
    /// Some records that hold the text's rarest term were not candidates.
    pub cut: bool,
}

/// Whether a match's scores hold meaning.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MeaningState {
    /// Every hit was scored with this model's vectors.
    Served(ModelId),
    /// No model is configured, or its gate has not passed.
    Off,
    /// A record the reader may read has no vector for the model; scored by words alone.
    Incomplete,
    /// The incoming texts could not be embedded; scored by words alone.
    Failed,
}

/// A match's answer.
#[derive(Debug, Clone, PartialEq)]
pub struct MatchPage {
    /// One result per text, in order.
    pub results: Vec<MatchResult>,
    /// The standings the host applied.
    pub admitted: Vec<Standing>,
    /// Whether the scores hold meaning.
    pub meaning: MeaningState,
}

/// A person's decision on a standing record.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Decision {
    /// The wording is the person's.
    Affirm,
    /// Take an affirmation back.
    Withdraw,
}

impl Decision {
    /// The stored spelling.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Affirm => "affirm",
            Self::Withdraw => "withdraw",
        }
    }
}

/// A decision as the host hands it to the store.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecordDecision {
    /// Affirm or withdraw.
    pub decision: Decision,
    /// The person's effective principal.
    pub by: String,
    /// When, ISO 8601 UTC.
    pub at: String,
    /// How the person was proven.
    pub assurance: Assurance,
    /// The call's trace id.
    pub trace_id: Option<String>,
}

/// A person's mark that a document is their own, as the host hands it to the store.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OwnMark {
    /// The document.
    pub doc: DocId,
    /// The content the person was shown.
    pub doc_hash: ContentHash,
    /// Which part of the document is the person's, when they name one.
    pub speaker: Option<String>,
    /// The person's effective principal.
    pub by: String,
    /// When, ISO 8601 UTC.
    pub at: String,
    /// How the person was proven.
    pub assurance: Assurance,
    /// The call's trace id.
    pub trace_id: Option<String>,
}

/// How a document is the person's own now.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OwnInfo {
    /// By collection or by mark; `collection` when both hold.
    pub basis: OwnBasis,
    /// The speaker the collection or the mark names.
    pub speaker: Option<String>,
    /// The document's current content hash.
    pub content_hash: ContentHash,
    /// When the host stored that content.
    pub stored_at: String,
    /// The document's own `generated.at`, when it states one.
    pub generated_at: Option<String>,
}

/// Whether a kind's lane can be served.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum LaneState {
    /// The lane is the declaration's.
    Ready,
    /// The lane must be rebuilt, or is being rebuilt.
    Stale,
}

/// What a store holds for one declared kind.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LaneStatus {
    /// Ready or stale.
    pub state: LaneState,
    /// The stored declaration's canonical JSON, if any.
    pub stored: Option<String>,
    /// Records affirmed now.
    pub affirmed: u64,
    /// Evidence rows.
    pub evidence: u64,
    /// Records of the kind.
    pub records: u64,
    /// Of those, without a lane row.
    pub unindexed: u64,
    /// Records with a match value.
    pub with_match: u64,
    /// Vectors, by model id.
    pub vectors: BTreeMap<String, u64>,
}

/// What a rebuild of one kind's lane did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReindexReport {
    /// Records of the kind.
    pub records: u64,
    /// Of those, left without a lane row.
    pub unindexed: u64,
    /// Records whose wording was not the one their lane row held: each lost its affirmation,
    /// its evidence and its vectors, if it had any.
    pub wordings_changed: u64,
    /// The generation moved while the rebuild ran: the kind is still stale.
    pub superseded: bool,
    /// Vectors written.
    pub vectors_written: u64,
    /// Vectors of other models removed.
    pub vectors_removed: u64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::envelope::Envelope;

    fn pointer(text: &str) -> Pointer {
        Pointer::parse(text).unwrap()
    }

    fn decl() -> RecordDecl {
        RecordDecl {
            kind: "note".to_owned(),
            standing: true,
            text: vec![pointer("/statement")],
            keys: vec![pointer("/bed"), pointer("/tags"), pointer("/source")],
            matched: Some(0),
        }
    }

    #[test]
    fn a_pointer_names_one_to_four_object_members() {
        for ok in ["/a", "/statement", "/_a/B_2", "/a/b/c/d"] {
            assert_eq!(pointer(ok).as_str(), ok);
        }
        let longest = format!("/{}", "a".repeat(64));
        assert!(Pointer::parse(&longest).is_ok());
        for bad in [
            "",
            "/",
            "a",
            "a/b",
            "/a/",
            "//a",
            "/a/b/c/d/e",
            "/0",
            "/a-b",
            "/a~1b",
            "/a b",
            "/é",
            "/a/0",
        ] {
            assert!(Pointer::parse(bad).is_err(), "{bad}");
        }
        assert!(Pointer::parse(&format!("/{}", "a".repeat(65))).is_err());
        // Two members of 64 bytes are 130 bytes with their slashes: past the whole's limit.
        let two = format!("/{0}/{0}", "a".repeat(64));
        assert!(Pointer::parse(&two).is_err());
    }

    #[test]
    fn a_pointer_reads_object_members_only() {
        let body = json!({ "a": { "b": "deep" }, "list": ["x"], "text": "top", "none": null });
        assert_eq!(pointer("/text").get(&body), Some(&json!("top")));
        assert_eq!(pointer("/a/b").get(&body), Some(&json!("deep")));
        assert_eq!(pointer("/none").get(&body), Some(&Value::Null));
        assert_eq!(pointer("/absent").get(&body), None);
        assert_eq!(pointer("/text/b").get(&body), None);
        assert_eq!(pointer("/list/b").get(&body), None);
        assert_eq!(pointer("/a").get(&json!("not an object")), None);
    }

    #[test]
    fn a_declaration_is_checked_by_section_2s_rules() {
        assert!(decl().check().is_ok());
        let keys_only = RecordDecl {
            standing: false,
            text: Vec::new(),
            matched: None,
            ..decl()
        };
        assert!(keys_only.check().is_ok());
        let refused = |edit: &dyn Fn(&mut RecordDecl), rule: &str| {
            let mut declared = decl();
            edit(&mut declared);
            match declared.check() {
                Err(StoreError::Invalid(why)) => assert!(why.contains(rule), "{why}"),
                other => panic!("{rule}: {other:?}"),
            }
        };
        refused(&|d| d.kind = "Note".to_owned(), "must match");
        refused(
            &|d| d.text = (0..5).map(|i| pointer(&format!("/t{i}"))).collect(),
            "at most 4 text pointers",
        );
        refused(
            &|d| d.keys = (0..17).map(|i| pointer(&format!("/k{i}"))).collect(),
            "at most 16 key pointers",
        );
        refused(&|d| d.text.push(pointer("/statement")), "named twice");
        refused(&|d| d.keys.push(pointer("/bed")), "named twice");
        refused(
            &|d| d.keys.push(pointer("/statement")),
            "both a text pointer and a key pointer",
        );
        refused(
            &|d| {
                d.text.clear();
                d.matched = None;
            },
            "a standing kind needs at least one text pointer",
        );
        refused(&|d| d.matched = Some(1), "one of the text pointers");
        refused(
            &|d| {
                d.standing = false;
                d.text.clear();
                d.keys.clear();
                d.matched = None;
            },
            "declares nothing",
        );
    }

    #[test]
    fn a_declarations_hash_is_of_its_canonical_json() {
        let declared = decl();
        assert_eq!(
            canonical_json(&declared.to_json()),
            r#"{"keys":["/bed","/tags","/source"],"kind":"note","match":"/statement","standing":true,"text":["/statement"]}"#
        );
        assert_eq!(
            declared.hash(),
            ContentHash::of(canonical_json(&declared.to_json()).as_bytes())
        );
        // Every member moves the hash: the order of pointers is part of a declaration.
        let mut reordered = decl();
        reordered.keys.swap(0, 1);
        assert_ne!(reordered.hash(), declared.hash());
        let mut unmatched = decl();
        unmatched.matched = None;
        assert_eq!(unmatched.to_json()["match"], Value::Null);
        assert_ne!(unmatched.hash(), declared.hash());
    }

    #[test]
    fn standing_is_spelled_in_lower_case() {
        for (standing, text) in [
            (Standing::Unverified, "unverified"),
            (Standing::Attested, "attested"),
            (Standing::Affirmed, "affirmed"),
        ] {
            assert_eq!(standing.as_str(), text);
            assert_eq!(serde_json::to_value(standing).unwrap(), json!(text));
            assert_eq!(
                serde_json::from_value::<Standing>(json!(text)).unwrap(),
                standing
            );
        }
        assert!(serde_json::from_value::<Standing>(json!("human")).is_err());
    }

    fn record() -> Record {
        let body = json!({ "statement": "Prune roses in late winter, before the buds swell.", "bed": "north" });
        Record {
            ns: "notes".to_owned(),
            kind: "note".to_owned(),
            id: "n-0007".to_owned(),
            rev: 41,
            content_hash: ContentHash::of(canonical_json(&body).as_bytes()),
            body,
            envelope: Envelope::from_value(json!({
                "version": 1, "origin": "user-stated", "space": "garden", "plugin": "notes",
                "agent": null, "principal": "human:local", "session": null, "traceId": "t",
                "observedAt": "2026-11-02T09:20:11.004Z", "validFrom": null, "validUntil": null,
                "confidence": null, "authority": null, "sources": null, "generated": null,
                "contentHash": null, "derivedFrom": null, "access": ["space"],
                "sensitivity": "internal"
            }))
            .unwrap(),
        }
    }

    #[test]
    fn a_lane_record_is_the_record_and_three_host_members() {
        let source = LabelSource {
            basis: OwnBasis::Collection,
            seen: Some(SourceSeen {
                doc: "journal/roses".to_owned(),
                content_hash: ContentHash::of(b"roses"),
                speaker: None,
                units: vec![4],
                rule: "sentences/1".to_owned(),
                stored_at: "2026-11-02T09:14:07.120Z".to_owned(),
                generated_at: None,
            }),
        };
        let lane = LaneRecord {
            record: record(),
            created_at: "2026-11-02T09:20:11.004Z".to_owned(),
            flags: vec![MemoryFlag::InstructionLike],
            label: Some(StandingLabel {
                standing: Standing::Attested,
                affirmed: None,
                source: Some(source),
            }),
        };
        let shown = lane.to_json();
        let own = serde_json::to_value(&lane.record).unwrap();
        for (member, value) in own.as_object().unwrap() {
            assert_eq!(&shown[member], value, "{member}");
        }
        assert_eq!(
            shown.as_object().unwrap().len(),
            own.as_object().unwrap().len() + 3
        );
        assert_eq!(shown["dev.umbel/createdAt"], "2026-11-02T09:20:11.004Z");
        assert_eq!(shown["dev.umbel/flags"], json!(["instruction-like"]));
        assert_eq!(
            shown["dev.umbel/standing"],
            json!({
                "standing": "attested",
                "affirmed": null,
                "source": {
                    "doc": "journal/roses",
                    "contentHash": ContentHash::of(b"roses"),
                    "basis": "collection",
                    "speaker": null,
                    "units": [4],
                    "rule": "sentences/1",
                    "storedAt": "2026-11-02T09:14:07.120Z",
                    "generatedAt": null,
                },
            })
        );
    }

    #[test]
    fn a_label_shows_only_the_basis_of_a_document_its_reader_may_not_read() {
        let label = StandingLabel {
            standing: Standing::Affirmed,
            affirmed: Some(Affirmation {
                by: "human:local".to_owned(),
                at: "2026-11-03T08:00:00.000Z".to_owned(),
                assurance: Assurance::terminal(),
            }),
            source: Some(LabelSource {
                basis: OwnBasis::Marked,
                seen: None,
            }),
        };
        assert_eq!(
            label.to_json(),
            json!({
                "standing": "affirmed",
                "affirmed": {
                    "by": "human:local",
                    "at": "2026-11-03T08:00:00.000Z",
                    "assurance": { "level": "terminal", "method": "cli-terminal" },
                },
                "source": {
                    "doc": null,
                    "contentHash": null,
                    "basis": "marked",
                    "speaker": null,
                    "units": null,
                    "rule": null,
                    "storedAt": null,
                    "generatedAt": null,
                },
            })
        );
        // A kind without standing carries no label, and no flags is an empty list.
        let plain = LaneRecord {
            record: record(),
            created_at: "2026-11-02T09:20:11.004Z".to_owned(),
            flags: Vec::new(),
            label: None,
        };
        assert_eq!(plain.to_json()["dev.umbel/standing"], Value::Null);
        assert_eq!(plain.to_json()["dev.umbel/flags"], json!([]));
    }
}
