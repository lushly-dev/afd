//! The memory store (phase 3 section 5.2, D70): the `MemoryStore` trait, its types, and the
//! checks every backend shares.
//!
//! Memory is its own lane: per space, its own revision sequence, its own lexical search and no
//! graph. A record is immutable text with one or more bitemporal **versions** (section 4.1); a
//! write never changes a version's content, it only closes `recordedUntil` while inserting the
//! next. Every read takes a [`ReaderFilter`] and applies it inside its own query, and refuses
//! [`ReaderFilter::derivation`] with `Invalid` in phase 3 (section 13, D81). The store keeps no
//! clock: every instant comes from the command context.

mod instant;
mod query;
/// The memory tokenizer: FTS5's `porter unicode61 remove_diacritics 2`, ported (section 9.2).
pub mod tokenizer;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::access::{AccessSet, ReaderFilter};
use crate::canonical::ContentHash;
use crate::document::Rev;
use crate::envelope::{Actor, Authority, Envelope, Origin, Sensitivity};
use crate::error::{Result, StoreError};

pub use instant::{DAY_MS, HOUR_MS, Millis, format_instant, parse_instant};
pub use query::{
    MAX_MEMORY_QUERY_CHARS, MAX_MEMORY_QUERY_TERMS, MemoryQuery, Occur, QueryTerm, TermField,
};

/// `memory-record.v1.json`'s version: a record version whose envelope is version 2.
pub const MEMORY_RECORD_VERSION: u32 = 1;
/// `memory-record.v2.json`'s version (phase 5 section 2.4): a record version whose envelope is
/// version 3, which every version written from phase 5 step 5 on has. A version written before
/// stays version 1.
pub const MEMORY_RECORD_VERSION_2: u32 = 2;
/// The longest `subject`, in characters.
pub const MAX_MEMORY_SUBJECT_CHARS: usize = 256;
/// The largest `text` the store takes, in bytes (capture and import; remember's 16 KiB is the
/// plugin's cap).
pub const MAX_MEMORY_TEXT_BYTES: usize = 64 * 1024;
/// The most tags on a record.
pub const MAX_MEMORY_TAGS: usize = 32;
/// The longest tag, in characters.
pub const MAX_MEMORY_TAG_CHARS: usize = 64;
/// The most records one entry may supersede.
pub const MAX_SUPERSEDES: usize = 16;
/// The most entries in one write.
pub const MAX_MEMORY_BATCH: usize = 256;
/// The most ids one forget takes, and the most a receipt lists.
pub const MAX_FORGET_IDS: usize = 100;
/// The longest idempotency or capture key, in characters.
pub const MAX_MEMORY_KEY_CHARS: usize = 256;
/// The longest invalidation note, in characters.
pub const MAX_INVALIDATION_NOTE_CHARS: usize = 500;
/// The most records `list` returns in one page.
pub const MAX_MEMORY_LIST_LIMIT: u32 = 500;
/// The most hits `recall` returns.
pub const MAX_RECALL_LIMIT: u32 = 200;
/// The most readable matches `recall` ranks; past it the query is
/// [`StoreError::QueryTooBroad`] (`MEMORY_QUERY_TOO_BROAD`, phase 5 section 9.2), never a silent
/// truncation.
pub const MAX_RECALL_MATCHES: u64 = 50_000;
/// The most changes `changes` returns.
pub const MAX_MEMORY_CHANGES_LIMIT: u32 = 1000;
/// The most records one sweep purges.
pub const MAX_SWEEP_LIMIT: u32 = 10_000;
/// The most records a write purges before its own transaction (section 8.8).
pub const PURGE_BEFORE_WRITE: u32 = 16;
/// How long an idempotency receipt is kept: 90 days (section 7.2).
pub const IDEMPOTENCY_KEEP_MS: Millis = 90 * DAY_MS;

/// A record's class (D15), fixed for its life.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum MemoryClass {
    /// Runs and sessions.
    Episodic,
    /// Facts people or agents asserted.
    Semantic,
    /// How something is done.
    Procedural,
}

impl MemoryClass {
    /// Every class.
    pub const ALL: [Self; 3] = [Self::Episodic, Self::Semantic, Self::Procedural];

    /// The wire spelling.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Episodic => "episodic",
            Self::Semantic => "semantic",
            Self::Procedural => "procedural",
        }
    }

    /// The class spelled `text`, or `None`.
    #[must_use]
    pub fn parse(text: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|c| c.as_str() == text)
    }
}

/// A scan finding on a record (section 8.2). A flagged record is stored, never pushed, and
/// returned with its label on a deliberate read.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum MemoryFlag {
    /// Zero-width, bidirectional or tag characters.
    HiddenText,
    /// The injection scan matched.
    InstructionLike,
}

impl MemoryFlag {
    /// The wire spelling.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::HiddenText => "hidden-text",
            Self::InstructionLike => "instruction-like",
        }
    }

    /// The finding spelled `text`, or `None`: how a record lane's row is read back.
    #[must_use]
    pub fn parse(text: &str) -> Option<Self> {
        [Self::HiddenText, Self::InstructionLike]
            .into_iter()
            .find(|flag| flag.as_str() == text)
    }
}

/// Why a version was closed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum InvalidationReason {
    /// It was never true.
    Wrong,
    /// It stopped being true.
    Outdated,
    /// Another record says the same.
    Duplicate,
    /// Anything else; a supersede uses it.
    Other,
}

impl InvalidationReason {
    /// The wire spelling.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Wrong => "wrong",
            Self::Outdated => "outdated",
            Self::Duplicate => "duplicate",
            Self::Other => "other",
        }
    }
}

/// A version's `invalidation`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Invalidation {
    /// When it was recorded.
    pub at: Millis,
    /// The invalidating principal string.
    pub by: String,
    /// Why.
    pub reason: InvalidationReason,
    /// At most [`MAX_INVALIDATION_NOTE_CHARS`] characters; sealed at rest.
    pub note: Option<String>,
}

/// Where a record belongs (section 3.1). Only `space` and the access set are boundaries.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemoryScope {
    /// The store's space.
    pub space: String,
    /// A label such as a repository name, or `None`.
    pub project: Option<String>,
    /// Whose record it is, filled by the host: `<kind>:<id>`.
    pub principal: String,
    /// The writing actor when an agent, service or script, filled by the host.
    pub agent: Option<Actor>,
    /// The harness session, or `None`.
    pub session: Option<String>,
}

impl MemoryScope {
    /// The agent's id, the label [`ScopeQuery::agent`] and the quota's pair match on.
    #[must_use]
    pub fn agent_id(&self) -> Option<&str> {
        self.agent.as_ref().and_then(|a| a.id.as_deref())
    }
}

/// `observations`: the seam for phase 4.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Observations {
    /// The first observation, the record's creation.
    pub first: Millis,
    /// The latest.
    pub last: Millis,
    /// How many, from 1.
    pub count: u64,
    /// Distinct non-null sessions among them.
    pub sessions: u64,
}

/// One record at one version, as `memory-show` returns it (`memory-record.v1.json`).
#[derive(Debug, Clone, PartialEq)]
pub struct MemoryRecord {
    /// `mem-` and 24 hex digits.
    pub id: String,
    /// This version's number, from 1.
    pub record_version: u32,
    /// The class.
    pub class: MemoryClass,
    /// The scope tuple.
    pub scope: MemoryScope,
    /// One line.
    pub subject: String,
    /// The body.
    pub text: String,
    /// Tags.
    pub tags: Vec<String>,
    /// Who may read it.
    pub access: AccessSet,
    /// Sensitivity.
    pub sensitivity: Sensitivity,
    /// Scan findings, sorted.
    pub flags: Vec<MemoryFlag>,
    /// Validity start.
    pub valid_from: Millis,
    /// Validity end, exclusive.
    pub valid_until: Option<Millis>,
    /// When this version became the store's belief.
    pub recorded_at: Millis,
    /// When it stopped, exclusive.
    pub recorded_until: Option<Millis>,
    /// Retention: out of default reads from here, purged later.
    pub expires_at: Millis,
    /// Observation counts.
    pub observations: Observations,
    /// The records this one superseded.
    pub supersedes: Vec<String>,
    /// The record that superseded this one.
    pub superseded_by: Option<String>,
    /// Why this version is closed, if it is.
    pub invalidation: Option<Invalidation>,
    /// `sha256:` of `subject`, a newline and `text`.
    pub content_hash: ContentHash,
    /// Envelope version 2 of the write that made this version; `authority` is never `None`.
    pub provenance: Envelope,
}

impl MemoryRecord {
    /// The version's authority, from its envelope.
    #[must_use]
    pub fn authority(&self) -> Option<Authority> {
        self.provenance
            .authority
            .as_deref()
            .and_then(Authority::parse)
    }

    /// The record as `memory-record.v1.json`.
    #[must_use]
    pub fn to_json(&self) -> Value {
        let instant = |ms: Option<Millis>| ms.map(format_instant);
        json!({
            "version": if self.provenance.version >= 3 {
                MEMORY_RECORD_VERSION_2
            } else {
                MEMORY_RECORD_VERSION
            },
            "id": self.id,
            "recordVersion": self.record_version,
            "class": self.class.as_str(),
            "scope": {
                "space": self.scope.space,
                "project": self.scope.project,
                "principal": self.scope.principal,
                "agent": self.scope.agent,
                "session": self.scope.session,
            },
            "subject": self.subject,
            "text": self.text,
            "tags": self.tags,
            "access": self.access,
            "sensitivity": self.sensitivity,
            "verification": "unverified",
            "flags": self.flags.iter().map(|f| f.as_str()).collect::<Vec<_>>(),
            "validFrom": format_instant(self.valid_from),
            "validUntil": instant(self.valid_until),
            "recordedAt": format_instant(self.recorded_at),
            "recordedUntil": instant(self.recorded_until),
            "expiresAt": format_instant(self.expires_at),
            "observations": {
                "first": format_instant(self.observations.first),
                "last": format_instant(self.observations.last),
                "count": self.observations.count,
                "sessions": self.observations.sessions,
            },
            "supersedes": self.supersedes,
            "supersededBy": self.superseded_by,
            "invalidation": self.invalidation.as_ref().map(|i| json!({
                "at": format_instant(i.at),
                "by": i.by,
                "reason": i.reason.as_str(),
                "note": i.note,
            })),
            "contentHash": self.content_hash,
            "trust": "content",
            "provenance": self.provenance,
        })
    }
}

/// Renewal of an observed record's expiry, for a `person` re-remember (section 8.2): the store
/// sets `expiresAt` to the later of its current value and `min(at + ttl_ms, first recordedAt +
/// max_ttl_ms)`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Renew {
    /// The class's TTL, or the input's.
    pub ttl_ms: Millis,
    /// The class's maximum TTL.
    pub max_ttl_ms: Millis,
}

/// One record to write.
#[derive(Debug, Clone, PartialEq)]
pub struct MemoryWrite {
    /// The new record's id, `mem-` and 24 hex digits ([`derive_memory_id`]). Unused when the
    /// entry is observed. An id the store already holds, or held, is refused: there is no
    /// update path.
    pub id: String,
    /// The class.
    pub class: MemoryClass,
    /// The scope; `space` must be the store's.
    pub scope: MemoryScope,
    /// One line of at most [`MAX_MEMORY_SUBJECT_CHARS`] characters, after hygiene.
    pub subject: String,
    /// At most [`MAX_MEMORY_TEXT_BYTES`] bytes, after hygiene.
    pub text: String,
    /// At most [`MAX_MEMORY_TAGS`] of at most [`MAX_MEMORY_TAG_CHARS`] characters.
    pub tags: Vec<String>,
    /// Who may read it.
    pub access: AccessSet,
    /// Sensitivity.
    pub sensitivity: Sensitivity,
    /// Scan findings.
    pub flags: Vec<MemoryFlag>,
    /// Validity start: the input's, or the batch's `at`.
    pub valid_from: Millis,
    /// Validity end, after `valid_from`.
    pub valid_until: Option<Millis>,
    /// When it expires.
    pub expires_at: Millis,
    /// Records the new record replaces (section 4.1).
    pub supersedes: Vec<String>,
    /// Renew the expiry when this entry is observed.
    pub renew: Option<Renew>,
    /// Envelope version 2, agreeing with the fields above.
    pub envelope: Envelope,
}

/// The rate and storage limits of section 8.11, already capped by the host.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Quota {
    /// Writes (created or observed records) per hour per `(principal, agent)`.
    pub writes_per_hour: u64,
    /// Bytes of created records per hour per `(principal, agent)`.
    pub bytes_per_hour: u64,
    /// Records stored per principal, every record not yet purged or forgotten.
    pub stored_records: u64,
    /// Bytes stored per principal: the backend's own count, sealed text plus its index copy.
    pub stored_bytes: u64,
}

impl Quota {
    /// No limit at all, for tests and tools.
    #[must_use]
    pub fn unlimited() -> Self {
        Self {
            writes_per_hour: u64::MAX,
            bytes_per_hour: u64::MAX,
            stored_records: u64::MAX,
            stored_bytes: u64::MAX,
        }
    }
}

/// Which limit a write met.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum QuotaLimit {
    /// [`Quota::writes_per_hour`].
    WritesPerHour,
    /// [`Quota::bytes_per_hour`].
    BytesPerHour,
    /// [`Quota::stored_records`].
    StoredRecords,
    /// [`Quota::stored_bytes`].
    StoredBytes,
}

impl QuotaLimit {
    /// The pack key's spelling.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::WritesPerHour => "writes_per_hour",
            Self::BytesPerHour => "bytes_per_hour",
            Self::StoredRecords => "stored_records",
            Self::StoredBytes => "stored_bytes",
        }
    }
}

/// `purge_after_days` per class (pack `policy`, section 8.11): what a sweep and a write's purge
/// measure against.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Retention {
    /// Episodic records.
    pub episodic_days: u32,
    /// Semantic records.
    pub semantic_days: u32,
    /// Procedural records.
    pub procedural_days: u32,
}

impl Default for Retention {
    /// The pack's defaults: 30, 90 and 90 days.
    fn default() -> Self {
        Self {
            episodic_days: 30,
            semantic_days: 90,
            procedural_days: 90,
        }
    }
}

impl Retention {
    /// `purge_after_days` of `class`, in milliseconds.
    #[must_use]
    pub fn purge_after_ms(&self, class: MemoryClass) -> Millis {
        let days = match class {
            MemoryClass::Episodic => self.episodic_days,
            MemoryClass::Semantic => self.semantic_days,
            MemoryClass::Procedural => self.procedural_days,
        };
        Millis::from(days) * DAY_MS
    }

    /// Whether a record is past its purge date at `now` (section 8.8): `expires_at` older than
    /// `now − purge_after`, or a current version carrying an invalidation whose `recorded_at` is
    /// older than that.
    #[must_use]
    pub fn past_purge(
        &self,
        class: MemoryClass,
        expires_at: Millis,
        current_invalidated_at: Option<Millis>,
        now: Millis,
    ) -> bool {
        let line = now.saturating_sub(self.purge_after_ms(class));
        expires_at < line || current_invalidated_at.is_some_and(|at| at < line)
    }
}

/// One `write`.
#[derive(Debug, Clone, PartialEq)]
pub struct MemoryBatch {
    /// Scoped to the entries' `(owner, authority)`: a used key replays its first receipt.
    pub idempotency: Option<String>,
    /// The capture window, `<harness>:<session>:w<n>`, kept on each created record; refused
    /// under one of the owner's erased prefixes.
    pub capture_key: Option<String>,
    /// The command context's clock.
    pub at: Millis,
    /// The limits checked inside the transaction.
    pub quota: Quota,
    /// What the purge before the write measures against (section 8.8).
    pub retention: Retention,
    /// 1 to [`MAX_MEMORY_BATCH`] entries, all with one principal and one authority.
    pub entries: Vec<MemoryWrite>,
}

/// What happened to one entry.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum EntryState {
    /// A new record.
    Created,
    /// A live record with the same key took an observation.
    Observed,
}

/// One entry's outcome.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EntryReceipt {
    /// The created or observed record.
    pub id: String,
    /// Its current version.
    pub record_version: u32,
    /// Created or observed.
    pub state: EntryState,
    /// Its expiry after the write (renewed or not).
    pub expires_at: Millis,
}

/// Why a write wrote nothing without failing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum WriteRefusal {
    /// The capture key is under one of the owner's erased prefixes (section 7.2).
    Erased,
}

/// A write's receipt. It holds ids and counts, never text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemoryReceipt {
    /// One per entry, in order; empty when refused.
    pub entries: Vec<EntryReceipt>,
    /// The records superseded.
    pub superseded: Vec<String>,
    /// The first revision taken, if any.
    pub from_rev: Option<Rev>,
    /// The last revision taken, if any.
    pub to_rev: Option<Rev>,
    /// This is the first receipt of a used idempotency key; nothing was written.
    pub replayed: bool,
    /// Set when the write was refused without an error.
    pub refused: Option<WriteRefusal>,
}

/// `invalidate`'s request (section 4.1).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Invalidate {
    /// The record.
    pub id: String,
    /// The command context's clock.
    pub at: Millis,
    /// `T`: after the current `valid_from`, not after `at`.
    pub valid_until: Millis,
    /// The invalidating principal.
    pub by: String,
    /// Why.
    pub reason: InvalidationReason,
    /// A note, at most [`MAX_INVALIDATION_NOTE_CHARS`] characters, after hygiene.
    pub note: Option<String>,
    /// The current version the caller saw; a mismatch is `Conflict`.
    pub expect_version: Option<u32>,
    /// The call's trace id.
    pub trace_id: Option<String>,
}

/// `confirm`'s request (section 8.7).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Confirm {
    /// The record.
    pub id: String,
    /// The command context's clock.
    pub at: Millis,
    /// The confirming person's principal string; it must be the record's principal (D88).
    pub by: String,
    /// What `memory-show` printed: `sha256:` and at least 16 hex digits, or the hex alone.
    pub content_hash: String,
    /// The call's trace id.
    pub trace_id: Option<String>,
    /// How the confirming person was proven (phase 5 sections 2.4 and 7.1), filled only by the
    /// host; the confirmation's version 3 envelope requires it.
    pub assurance: Option<crate::envelope::Assurance>,
}

/// `invalidate`'s and `confirm`'s answer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemoryVersionMeta {
    /// The record.
    pub id: String,
    /// The new version.
    pub record_version: u32,
    /// The new version's validity end.
    pub valid_until: Option<Millis>,
    /// The new version's `recorded_at`.
    pub recorded_at: Millis,
    /// The revision taken.
    pub rev: Rev,
}

/// A read's two instants (section 4.1); both default to now.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AsOf {
    /// `V`: the valid instant.
    pub valid: Millis,
    /// `R`: the recorded instant.
    pub recorded: Millis,
}

impl AsOf {
    /// Both instants at `at`.
    #[must_use]
    pub fn at(at: Millis) -> Self {
        Self {
            valid: at,
            recorded: at,
        }
    }

    /// Whether a version with these intervals matches: `recordedAt ≤ R < recordedUntil` and
    /// `validFrom ≤ V < validUntil`, an absent end being open.
    #[must_use]
    pub fn matches(
        &self,
        recorded: (Millis, Option<Millis>),
        valid: (Millis, Option<Millis>),
    ) -> bool {
        recorded.0 <= self.recorded
            && recorded.1.is_none_or(|end| end > self.recorded)
            && valid.0 <= self.valid
            && valid.1.is_none_or(|end| end > self.valid)
    }
}

/// What a read lets through besides the intervals.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReadFlags {
    /// Return flagged records (recall and list set it; `context` never does).
    pub include_flagged: bool,
    /// Return expired records.
    pub include_expired: bool,
    /// The clock expiry is measured against, even for an `asOf` read.
    pub now: Millis,
}

impl ReadFlags {
    /// Neither flagged nor expired records, at `now`.
    #[must_use]
    pub fn at(now: Millis) -> Self {
        Self {
            include_flagged: false,
            include_expired: false,
            now,
        }
    }
}

/// How a read matches `project`.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum ProjectMatch {
    /// Any project, or none.
    #[default]
    Any,
    /// Exactly this project.
    Exact(String),
    /// This project, or records with no project.
    ExactOrUnset(String),
}

impl ProjectMatch {
    /// Whether a record's project matches.
    #[must_use]
    pub fn admits(&self, project: Option<&str>) -> bool {
        match self {
            Self::Any => true,
            Self::Exact(p) => project == Some(p.as_str()),
            Self::ExactOrUnset(p) => project.is_none_or(|q| q == p),
        }
    }
}

/// The labels a read narrows by. They are not permission (section 3.1).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ScopeQuery {
    /// The project rule.
    pub project: ProjectMatch,
    /// Only this principal's records.
    pub principal: Option<String>,
    /// Only records whose agent has this id.
    pub agent: Option<String>,
    /// Only this session's records.
    pub session: Option<String>,
}

impl ScopeQuery {
    /// Whether a record's scope matches.
    #[must_use]
    pub fn admits(&self, scope: &MemoryScope) -> bool {
        self.project.admits(scope.project.as_deref())
            && self
                .principal
                .as_ref()
                .is_none_or(|p| *p == scope.principal)
            && self
                .agent
                .as_deref()
                .is_none_or(|a| scope.agent_id() == Some(a))
            && self
                .session
                .as_ref()
                .is_none_or(|s| scope.session.as_ref() == Some(s))
    }
}

/// Section 9.3's push rule, which a backend compiles into the same statement as the read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PushFilter {
    /// The bundle's caller: its effective principal string.
    pub caller: String,
    /// Authorities admitted for the caller's own records (`push_authorities`).
    pub own: Vec<Authority>,
    /// Authorities admitted for another principal's readable records
    /// (`push_foreign_authorities`).
    pub foreign: Vec<Authority>,
    /// Authorities admitted for a record with no project when the read names a project.
    pub unset_project: Vec<Authority>,
}

impl PushFilter {
    /// Whether the push admits a record: never when flagged; its authority listed in `own` or
    /// `foreign` by whose it is; and, when it has no project and `project` names one, also listed
    /// in `unset_project`.
    #[must_use]
    pub fn admits(
        &self,
        record_principal: &str,
        authority: Authority,
        record_project: Option<&str>,
        project: &ProjectMatch,
        flagged: bool,
    ) -> bool {
        let listed = if record_principal == self.caller {
            &self.own
        } else {
            &self.foreign
        };
        let named = !matches!(project, ProjectMatch::Any);
        !flagged
            && listed.contains(&authority)
            && (record_project.is_some() || !named || self.unset_project.contains(&authority))
    }
}

/// `list`'s only order: newest recorded first, then id.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum MemoryOrder {
    /// By the matching version's `recorded_at` descending, then id ascending.
    #[default]
    Recorded,
}

/// Where a list page ends: the last item's `recorded_at` and id.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemoryCursor {
    /// The matching version's `recorded_at`.
    pub recorded_at: Millis,
    /// The record's id.
    pub id: String,
}

impl MemoryCursor {
    /// Whether an item at `(recorded_at, id)` comes after this cursor in [`MemoryOrder::Recorded`].
    #[must_use]
    pub fn precedes(&self, recorded_at: Millis, id: &str) -> bool {
        recorded_at < self.recorded_at || (recorded_at == self.recorded_at && id > self.id.as_str())
    }
}

/// `list`'s query.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemoryList {
    /// The labels.
    pub scope: ScopeQuery,
    /// Only these classes; empty is every class.
    pub classes: Vec<MemoryClass>,
    /// Only records with all of these tags.
    pub tags: Vec<String>,
    /// Only these authorities; empty is every authority.
    pub authorities: Vec<Authority>,
    /// Section 9.3's rule, for a bundle.
    pub push: Option<PushFilter>,
    /// The instants.
    pub as_of: AsOf,
    /// Flagged, expired, now.
    pub flags: ReadFlags,
    /// The order.
    pub order: MemoryOrder,
    /// Continue after this item.
    pub after: Option<MemoryCursor>,
    /// 1 to [`MAX_MEMORY_LIST_LIMIT`].
    pub limit: u32,
}

/// A listed record: `subject` and no `text`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemoryMeta {
    /// The record.
    pub id: String,
    /// The matching version.
    pub record_version: u32,
    /// The class.
    pub class: MemoryClass,
    /// The scope.
    pub scope: MemoryScope,
    /// The subject.
    pub subject: String,
    /// Tags.
    pub tags: Vec<String>,
    /// Who may read it.
    pub access: AccessSet,
    /// Sensitivity.
    pub sensitivity: Sensitivity,
    /// Scan findings.
    pub flags: Vec<MemoryFlag>,
    /// The matching version's authority.
    pub authority: Authority,
    /// The writer's claim.
    pub origin: Origin,
    /// Validity start.
    pub valid_from: Millis,
    /// Validity end.
    pub valid_until: Option<Millis>,
    /// The matching version's `recorded_at`.
    pub recorded_at: Millis,
    /// Expiry.
    pub expires_at: Millis,
}

/// A list page.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemoryPage {
    /// The items, in order.
    pub items: Vec<MemoryMeta>,
    /// Where to continue, when the page is full and more follow.
    pub next: Option<MemoryCursor>,
    /// Readable records in the query's scope left out because their body does not open.
    pub unreadable: u64,
}

/// `recall`'s query.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecallQuery {
    /// The parsed query.
    pub query: MemoryQuery,
    /// The labels.
    pub scope: ScopeQuery,
    /// Only these classes; empty is every class.
    pub classes: Vec<MemoryClass>,
    /// Only records with all of these tags.
    pub tags: Vec<String>,
    /// Only these authorities; empty is every authority.
    pub authorities: Vec<Authority>,
    /// Section 9.3's rule, for a bundle.
    pub push: Option<PushFilter>,
    /// The instants.
    pub as_of: AsOf,
    /// Flagged, expired, now.
    pub flags: ReadFlags,
    /// 1 to [`MAX_RECALL_LIMIT`].
    pub limit: u32,
}

/// One recall hit. It carries a rank and **no score** (D70).
#[derive(Debug, Clone, PartialEq)]
pub struct RecallHit {
    /// From 1.
    pub rank: u32,
    /// The record at its matching version.
    pub record: MemoryRecord,
    /// Matches in `text`, marked `**`.
    pub snippet: String,
}

/// `recall`'s answer.
#[derive(Debug, Clone, PartialEq)]
pub struct RecallPage {
    /// Rank order (phase 5 section 9.2): BM25 over what the reader may read, at four places,
    /// descending; then the authority's tier ([`Authority::tier`]); then `recorded_at`
    /// descending; then id ascending.
    pub hits: Vec<RecallHit>,
    /// Matches whose body did not open, plus readable records in scope that are not indexed.
    pub unreadable: u64,
}

/// What a bundle leaves out of one class (section 9.3).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct LeftOutCounts {
    /// Readable, current, not flagged, and not admitted by the push rule.
    pub authority: u64,
    /// Readable, current and flagged.
    pub flagged: u64,
}

/// `left_out`'s answer, per class asked for.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct LeftOut {
    /// The counts.
    pub by_class: BTreeMap<MemoryClass, LeftOutCounts>,
}

/// What a forget erases: the owner's records by id, or by one selector.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ForgetSelector {
    /// 1 to [`MAX_FORGET_IDS`] ids; others' records and absent ids are `not_found`.
    Ids(Vec<String>),
    /// Every record of this session.
    Session(String),
    /// Every record of this project.
    Project(String),
    /// Every record whose first version was recorded before this instant.
    Before(Millis),
}

/// `forget`'s request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Forget {
    /// The caller's effective principal: only its records are erased.
    pub owner: String,
    /// What to erase.
    pub selector: ForgetSelector,
    /// The command context's clock.
    pub at: Millis,
    /// The call's trace id.
    pub trace_id: Option<String>,
}

/// Whether a forget's WAL is clean.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum WalState {
    /// Every step finished.
    Clean,
    /// Keys are destroyed and the rest waits for roll-forward (`MEMORY_ERASURE_PENDING`).
    Pending,
}

/// `forget`'s receipt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ForgetReceipt {
    /// How many records were erased.
    pub erased: u64,
    /// At most [`MAX_FORGET_IDS`] of them.
    pub ids: Vec<String>,
    /// Requested ids that were not the owner's live records.
    pub not_found: Vec<String>,
    /// The WAL.
    pub wal: WalState,
}

/// `sweep`'s request (section 8.8).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Sweep {
    /// The command context's clock.
    pub now: Millis,
    /// 1 to [`MAX_SWEEP_LIMIT`] records.
    pub limit: u32,
    /// `purge_after_days` per class.
    pub retention: Retention,
}

/// `sweep`'s receipt.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SweepReceipt {
    /// Purged now.
    pub purged: u64,
    /// Still past their purge date.
    pub remaining: u64,
}

/// `reindex`'s receipt (section 5.4).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReindexReceipt {
    /// Records indexed again.
    pub reindexed: u64,
    /// Rows that did not open, left with `indexed = 0`.
    pub unreadable: u64,
    /// Orphan keys counted.
    pub orphans: u64,
    /// Orphan keys removed: 0 unless asked.
    pub orphans_removed: u64,
}

/// `backup`'s receipt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackupReceipt {
    /// `<dest>/memory.sqlite3`, or the backend's own file.
    pub file: PathBuf,
    /// Its size.
    pub bytes: u64,
}

/// The key file's state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum KeyFileState {
    /// It belongs to this database.
    Present,
    /// It does not exist (`MEMORY_KEYS_MISSING`).
    Missing,
    /// It belongs to another database or is not a key file (`MEMORY_KEYS_MISMATCH`).
    Mismatch,
}

/// `key_status`'s answer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct KeyStatus {
    /// The file.
    pub file: KeyFileState,
    /// Destroyed markers whose roll-forward has not finished.
    pub unsettled: u64,
    /// Destroyed markers.
    pub destroyed: u64,
    /// Keys with no row.
    pub orphans: u64,
    /// Rows with no key entry.
    pub absent: u64,
}

/// A change's kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum MemoryChangeKind {
    /// A record was created.
    Created,
    /// A record took an observation.
    Observed,
    /// A version was closed by an invalidation or a supersede.
    Invalidated,
    /// A person confirmed a record.
    Confirmed,
    /// A forget erased a record.
    Erased,
    /// A sweep or a write purged a record.
    Purged,
}

/// One memory revision. No text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemoryChange {
    /// The revision, from 1, its own sequence.
    pub rev: Rev,
    /// What happened.
    pub kind: MemoryChangeKind,
    /// The record.
    pub id: String,
    /// The record's version after the change (its last, for an erase or purge).
    pub record_version: u32,
    /// The writing call's trace id.
    pub trace_id: Option<String>,
    /// When.
    pub at: Millis,
}

/// `usage`'s answer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct MemoryUsage {
    /// The owner's stored records.
    pub stored_records: u64,
    /// The owner's stored bytes.
    pub stored_bytes: u64,
    /// Writes by the pair since the instant.
    pub writes: u64,
    /// Bytes written by the pair since the instant.
    pub bytes: u64,
}

/// Counts of one class by state (section 4.2), each record in one state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ClassCounts {
    /// Valid now, not expired, not flagged.
    pub live: u64,
    /// Valid now, not expired, flagged.
    pub flagged: u64,
    /// `valid_from` after now.
    pub not_yet_valid: u64,
    /// `valid_until` at or before now.
    pub invalidated: u64,
    /// `expires_at` at or before now.
    pub expired: u64,
    /// Live or flagged, and expiring within the window.
    pub expiring_soon: u64,
}

/// `counts`' answer over what the reader can read.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct MemoryCounts {
    /// Per class.
    pub by_class: BTreeMap<MemoryClass, ClassCounts>,
    /// Readable records whose body does not open, or that are not indexed.
    pub unreadable: u64,
}

impl MemoryCounts {
    /// Every counted record.
    #[must_use]
    pub fn total(&self) -> u64 {
        self.by_class
            .values()
            .map(|c| c.live + c.flagged + c.not_yet_valid + c.invalidated + c.expired)
            .sum()
    }
}

/// The memory store of one space (section 5.2): synchronous, `Send + Sync`, object-safe. While
/// it is not provisioned (nothing written yet), every method but `write` and `checkpoint`
/// answers `NotProvisioned` and creates nothing.
pub trait MemoryStore: Send + Sync {
    /// Write a batch. First, outside the write's transaction, roll forward unsettled markers and
    /// purge at most [`PURGE_BEFORE_WRITE`] records past their purge date, each in transactions of
    /// its own that stay committed whatever the write answers. Then one transaction, all or
    /// nothing: a used `(owner, authority, idempotency)` replays the first receipt; a capture key
    /// under an erased prefix is refused (`refused: Erased`); the quota is checked; and each
    /// entry is observed on a live record with the same owner, project, class, content hash,
    /// authority and access set, or created, superseding its targets. One revision per created,
    /// observed or superseded record.
    ///
    /// # Errors
    /// `Invalid` (the checks of [`MemoryWrite::check`], a used id, a missing supersede target),
    /// `TooLarge`, `QuotaExceeded`, `KeysMissing`, `KeysMismatch`, `Busy`, `Io`.
    fn write(&self, batch: MemoryBatch) -> Result<MemoryReceipt>;

    /// Close the current version and insert the next with `valid_until = T` and the
    /// invalidation (section 4.1). `recorded_at` is `max(at, current recorded_at)`.
    ///
    /// # Errors
    /// `NotFound` for an absent, unreadable or forgotten id; `KeyAbsent`; `Conflict` on an
    /// `expect_version` mismatch; `Invalid` for a `T` not after `valid_from` or after `at`, or a
    /// derivation reader.
    fn invalidate(&self, req: Invalidate, reader: &ReaderFilter) -> Result<MemoryVersionMeta>;

    /// A person vouching for their own record (section 8.7): the next version has the same
    /// valid interval, authority `person` and the envelope's `confirmation`.
    ///
    /// # Errors
    /// `NotFound` as for [`MemoryStore::invalidate`]; `KeyAbsent`; `Conflict` when the hash
    /// prefix does not match (`MEMORY_CONFIRM_MISMATCH`); `Invalid` when the record is another
    /// principal's, flagged, `transcript` or already `person` (`MEMORY_CONFIRM_NOT_ALLOWED`), or
    /// the reader is a derivation.
    fn confirm(&self, req: Confirm, reader: &ReaderFilter) -> Result<MemoryVersionMeta>;

    /// The record at the version matching `as_of`, or `None` for absent, purged, forgotten,
    /// unreadable, not matching, expired or flagged (unless `flags` lets those through) alike.
    ///
    /// # Errors
    /// `KeyAbsent`, `SealInvalid` for a readable record that does not open; `NotProvisioned`;
    /// `Invalid` for a derivation reader.
    fn get(
        &self,
        id: &str,
        as_of: AsOf,
        flags: ReadFlags,
        reader: &ReaderFilter,
    ) -> Result<Option<MemoryRecord>>;

    /// Every version, oldest first; empty when absent or unreadable.
    ///
    /// # Errors
    /// As [`MemoryStore::get`].
    fn history(&self, id: &str, reader: &ReaderFilter) -> Result<Vec<MemoryRecord>>;

    /// Readable records matching the query, newest recorded first, then id.
    ///
    /// # Errors
    /// `Invalid` for a bad limit or a derivation reader; `NotProvisioned`.
    fn list(&self, query: &MemoryList, reader: &ReaderFilter) -> Result<MemoryPage>;

    /// Matches and filters in one statement; hits in rank order, with no score.
    ///
    /// # Errors
    /// `Invalid` for a bad limit or a derivation reader; `NotProvisioned`.
    fn recall(&self, query: &RecallQuery, reader: &ReaderFilter) -> Result<RecallPage>;

    /// Per class asked for (every class when empty), the readable current records that the push
    /// rule or the flag rule keeps out of a bundle. Reads no key. Expiry is measured at `now`.
    ///
    /// # Errors
    /// `Invalid` for a derivation reader; `NotProvisioned`.
    fn left_out(
        &self,
        scope: &ScopeQuery,
        classes: &[MemoryClass],
        push: &PushFilter,
        as_of: AsOf,
        now: Millis,
        reader: &ReaderFilter,
    ) -> Result<LeftOut>;

    /// Erase the owner's records (section 5.4's order): their keys destroyed, rows removed, a
    /// tombstone and an `Erased` change each, and their capture prefixes erased. Idempotent.
    ///
    /// # Errors
    /// `Invalid` for a malformed selector; `Busy` before the erasure point; `NotProvisioned`.
    fn forget(&self, req: Forget) -> Result<ForgetReceipt>;

    /// Purge at most `limit` records past their purge date, and idempotency receipts older
    /// than [`IDEMPOTENCY_KEEP_MS`].
    ///
    /// # Errors
    /// `Invalid` for a bad limit; `Busy`; `NotProvisioned`.
    fn sweep(&self, req: Sweep) -> Result<SweepReceipt>;

    /// Rebuild the lexical lane (section 5.4); removes orphan keys only when asked.
    ///
    /// # Errors
    /// `Busy`, `Io`, `NotProvisioned`.
    fn reindex(&self, remove_orphans: bool) -> Result<ReindexReceipt>;

    /// Write the stripped copy of section 5.4 into `dest`, never the key file.
    ///
    /// # Errors
    /// `Io`, `NotProvisioned`.
    fn backup(&self, dest: &Path) -> Result<BackupReceipt>;

    /// The key file's state.
    ///
    /// # Errors
    /// `Io`, `NotProvisioned`.
    fn key_status(&self) -> Result<KeyStatus>;

    /// Changes after `after`, ascending, at most `limit` (1 to [`MAX_MEMORY_CHANGES_LIMIT`]),
    /// filtered by the access the record had at the change and, when given, by trace id.
    ///
    /// # Errors
    /// `Invalid` for a bad limit or a derivation reader; `NotProvisioned`.
    fn changes(
        &self,
        after: Rev,
        limit: u32,
        reader: &ReaderFilter,
        trace: Option<&str>,
    ) -> Result<Vec<MemoryChange>>;

    /// The last memory revision. A true count, so the host hides it from plugins (6.1).
    ///
    /// # Errors
    /// `NotProvisioned`, `Io`.
    fn head(&self) -> Result<Rev>;

    /// The owner's stored records and bytes, and the writes and bytes of `(owner, agent)` at or
    /// after `since`.
    ///
    /// # Errors
    /// `NotProvisioned`, `Io`.
    fn usage(&self, owner: &str, agent: Option<&str>, since: Millis) -> Result<MemoryUsage>;

    /// Counts by class and state at `now`, with `expiring_soon` within `expiring_within_ms`,
    /// over what `reader` can read.
    ///
    /// # Errors
    /// `Invalid` for a derivation reader; `NotProvisioned`.
    fn counts(
        &self,
        now: Millis,
        expiring_within_ms: Millis,
        reader: &ReaderFilter,
    ) -> Result<MemoryCounts>;

    /// Best-effort maintenance, as phase 2's. The default does nothing.
    ///
    /// # Errors
    /// `Io` when the maintenance itself fails for a reason other than being busy.
    fn checkpoint(&self) -> Result<()> {
        Ok(())
    }
}

// ---------------------------------------------------------------------------------------------
// Shared checks.

/// Refuse a derivation reader (section 13, D81): every memory read calls this first.
///
/// # Errors
/// [`StoreError::Invalid`] for [`ReaderFilter::derivation`].
pub fn refuse_derivation(reader: &ReaderFilter) -> Result<()> {
    if reader.is_derivation() {
        Err(StoreError::invalid(
            "the memory store refuses a derivation read in phase 3",
        ))
    } else {
        Ok(())
    }
}

/// `sha256:` of `subject`, a newline and `text`.
#[must_use]
pub fn memory_content_hash(subject: &str, text: &str) -> ContentHash {
    let mut body = String::with_capacity(subject.len() + 1 + text.len());
    body.push_str(subject);
    body.push('\n');
    body.push_str(text);
    ContentHash::of(body.as_bytes())
}

/// A record id from the first 12 bytes of SHA-256 over the space, the trace id, the entry's
/// ordinal in the call, the clock and one draw from the operating system's random source
/// (section 4). Never derived from the text.
#[must_use]
pub fn derive_memory_id(
    space: &str,
    trace_id: &str,
    ordinal: u32,
    at: Millis,
    draw: u64,
) -> String {
    let mut hasher = Sha256::new();
    for part in [space, trace_id] {
        hasher.update(part.as_bytes());
        hasher.update([0]);
    }
    hasher.update(ordinal.to_be_bytes());
    hasher.update(at.to_be_bytes());
    hasher.update(draw.to_be_bytes());
    let digest = hasher.finalize();
    let mut id = String::from("mem-");
    for byte in &digest[..12] {
        id.push_str(&format!("{byte:02x}"));
    }
    id
}

/// Check a record id: `mem-` and 24 lowercase hex digits.
///
/// # Errors
/// [`StoreError::Invalid`] otherwise.
pub fn check_memory_id(id: &str) -> Result<()> {
    let valid = id.strip_prefix("mem-").is_some_and(|hex| {
        hex.len() == 24 && hex.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
    });
    if valid {
        Ok(())
    } else {
        Err(StoreError::invalid(format!(
            "`{id}` is not a memory id: mem- and 24 lowercase hex digits"
        )))
    }
}

/// Check a `project` or `session` label: `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`.
///
/// # Errors
/// [`StoreError::Invalid`] naming `what`.
pub fn check_label(what: &str, label: &str) -> Result<()> {
    let mut bytes = label.bytes();
    let valid = bytes.next().is_some_and(|b| b.is_ascii_alphanumeric())
        && label.len() <= 128
        && bytes.all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'));
    if valid {
        Ok(())
    } else {
        Err(StoreError::invalid(format!(
            "{what} `{label}` must match ^[A-Za-z0-9][A-Za-z0-9._-]{{0,127}}$"
        )))
    }
}

/// Check a principal string: `<kind>:<id>` with kind human, agent, service or script.
///
/// # Errors
/// [`StoreError::Invalid`] naming `what`.
pub fn check_principal(what: &str, principal: &str) -> Result<()> {
    let (kind, id) = principal.split_once(':').unwrap_or(("", ""));
    let valid = matches!(kind, "human" | "agent" | "service" | "script")
        && (1..=128).contains(&id.chars().count())
        && !id.chars().any(char::is_control);
    if valid {
        Ok(())
    } else {
        Err(StoreError::invalid(format!(
            "{what} must be <kind>:<id> with kind human, agent, service or script"
        )))
    }
}

fn check_key(what: &str, key: &str) -> Result<()> {
    if key.is_empty()
        || key.chars().count() > MAX_MEMORY_KEY_CHARS
        || key.chars().any(char::is_control)
    {
        Err(StoreError::invalid(format!(
            "{what} must be 1 to 256 characters with no control character"
        )))
    } else {
        Ok(())
    }
}

/// Whether a capture key is under an erased prefix (section 7.2): equal to it, or the prefix
/// ends in `:` and the key starts with it, so `w1` does not cover `w10`.
#[must_use]
pub fn capture_key_under(prefix: &str, key: &str) -> bool {
    key == prefix || (prefix.ends_with(':') && key.starts_with(prefix))
}

/// The session-wide prefix of a capture key, `<harness>:<session>:`, which a forget by session
/// erases; `None` when the key has fewer than two `:`-separated parts before a window.
#[must_use]
pub fn capture_session_prefix(key: &str) -> Option<String> {
    let mut parts = key.splitn(3, ':');
    let (harness, session) = (parts.next()?, parts.next()?);
    parts.next()?;
    Some(format!("{harness}:{session}:"))
}

/// Whether `given` (`sha256:` and at least 16 hex digits, or the hex alone) is a prefix of
/// `hash`: how `confirm` ties a confirmation to the text shown (section 8.7).
#[must_use]
pub fn content_hash_prefix_matches(hash: &ContentHash, given: &str) -> bool {
    let hex = given.strip_prefix("sha256:").unwrap_or(given);
    hex.len() >= 16
        && hex.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
        && hash.as_str()["sha256:".len()..].starts_with(hex)
}

impl MemoryWrite {
    /// The checks every backend makes on an entry written in `space` (sections 2.1, 4 and 8.2),
    /// returning its content hash: id, labels, caps, intervals, and an envelope of version 2
    /// with a closed, non-null authority, no `confirmation`, an origin other than `unspecified`
    /// and `space`, `principal`, `agent`, `session`, `validFrom`, `validUntil`, `access`,
    /// `sensitivity` and any `contentHash` agreeing with the entry.
    ///
    /// # Errors
    /// [`StoreError::Invalid`] naming the first rule broken; [`StoreError::TooLarge`] for text
    /// over [`MAX_MEMORY_TEXT_BYTES`].
    pub fn check(&self, space: &str) -> Result<ContentHash> {
        let refuse = |rule: String| Err(StoreError::invalid(format!("memory write: {rule}")));
        check_memory_id(&self.id)?;
        if self.scope.space != space {
            return refuse("scope.space must be the store's space".into());
        }
        check_principal("scope.principal", &self.scope.principal)?;
        if let Some(project) = &self.scope.project {
            check_label("project", project)?;
        }
        if let Some(session) = &self.scope.session {
            check_label("session", session)?;
        }
        let subject_chars = self.subject.chars().count();
        if subject_chars == 0
            || subject_chars > MAX_MEMORY_SUBJECT_CHARS
            || self.subject.chars().any(|c| c.is_control() && c != '\t')
        {
            return refuse("subject is one line of 1 to 256 characters".into());
        }
        if self.text.len() > MAX_MEMORY_TEXT_BYTES {
            return Err(StoreError::TooLarge(format!(
                "memory text holds at most {MAX_MEMORY_TEXT_BYTES} bytes"
            )));
        }
        if self.text.contains('\0') {
            return refuse("text holds no NUL".into());
        }
        if self.tags.len() > MAX_MEMORY_TAGS
            || self.tags.iter().any(|t| {
                let n = t.chars().count();
                n == 0 || n > MAX_MEMORY_TAG_CHARS || t.chars().any(char::is_control)
            })
        {
            return refuse("at most 32 tags of 1 to 64 characters".into());
        }
        if self.flags.windows(2).any(|w| w[0] >= w[1]) {
            return refuse("flags are sorted, each once".into());
        }
        if self
            .valid_until
            .is_some_and(|until| until <= self.valid_from)
        {
            return refuse("validUntil must follow validFrom".into());
        }
        if self.supersedes.len() > MAX_SUPERSEDES {
            return refuse("an entry supersedes at most 16 records".into());
        }
        for target in &self.supersedes {
            check_memory_id(target)?;
            if *target == self.id {
                return refuse("a record cannot supersede itself".into());
            }
        }
        if self
            .renew
            .is_some_and(|r| r.ttl_ms <= 0 || r.max_ttl_ms <= 0)
        {
            return refuse("a renewal's TTLs are positive".into());
        }
        let hash = memory_content_hash(&self.subject, &self.text);
        self.check_envelope(space, &hash)?;
        Ok(hash)
    }

    fn check_envelope(&self, space: &str, hash: &ContentHash) -> Result<()> {
        let refuse = |rule: &str| {
            Err(StoreError::invalid(format!(
                "memory write: provenance envelope: {rule}"
            )))
        };
        let e = &self.envelope;
        if e.version != crate::envelope::MEMORY_ENVELOPE_VERSION {
            return refuse("a memory write uses envelope version 3");
        }
        let access = e.check(space)?;
        let Some(authority) = e.authority.as_deref() else {
            return refuse("authority is required; the memory store refuses null");
        };
        if Authority::parse(authority).is_none() {
            return refuse("authority is not of the closed set");
        }
        if e.confirmation.is_some() {
            return refuse("confirmation is filled only by confirm");
        }
        if access != self.access {
            return refuse("access must agree with the record");
        }
        if e.sensitivity != Some(self.sensitivity) {
            return refuse("sensitivity must agree with the record");
        }
        if e.principal.as_deref() != Some(self.scope.principal.as_str()) {
            return refuse("principal must be the record's");
        }
        if e.agent != self.scope.agent {
            return refuse("agent must be the record's");
        }
        if e.session != self.scope.session {
            return refuse("session must be the record's");
        }
        let instant = |text: &Option<String>| text.as_deref().map(parse_instant).transpose();
        if instant(&e.valid_from)? != Some(self.valid_from) {
            return refuse("validFrom must agree with the record");
        }
        if instant(&e.valid_until)? != self.valid_until {
            return refuse("validUntil must agree with the record");
        }
        if e.content_hash
            .as_deref()
            .is_some_and(|h| h != hash.as_str())
        {
            return refuse("contentHash must be the record's");
        }
        Ok(())
    }

    /// The entry's authority, once [`MemoryWrite::check`] has passed.
    #[must_use]
    pub fn authority(&self) -> Option<Authority> {
        self.envelope
            .authority
            .as_deref()
            .and_then(Authority::parse)
    }
}

impl MemoryBatch {
    /// The checks every backend makes on a batch before its transaction: 1 to
    /// [`MAX_MEMORY_BATCH`] entries, each passing [`MemoryWrite::check`], one principal and one
    /// authority across them, distinct ids, and well-formed keys. Returns the owner, the
    /// authority and each entry's content hash.
    ///
    /// # Errors
    /// As [`MemoryWrite::check`], and [`StoreError::Invalid`] for the batch rules.
    pub fn check(&self, space: &str) -> Result<(String, Authority, Vec<ContentHash>)> {
        if self.entries.is_empty() || self.entries.len() > MAX_MEMORY_BATCH {
            return Err(StoreError::invalid(
                "memory write: a batch holds 1 to 256 entries",
            ));
        }
        if let Some(key) = &self.idempotency {
            check_key("an idempotency key", key)?;
        }
        if let Some(key) = &self.capture_key {
            check_key("a capture key", key)?;
        }
        let mut hashes = Vec::with_capacity(self.entries.len());
        for entry in &self.entries {
            hashes.push(entry.check(space)?);
        }
        let first = &self.entries[0];
        let owner = first.scope.principal.clone();
        let authority = first
            .authority()
            .ok_or_else(|| StoreError::invalid("memory write: authority is required"))?;
        let mut ids = std::collections::BTreeSet::new();
        for entry in &self.entries {
            if entry.scope.principal != owner || entry.authority() != Some(authority) {
                return Err(StoreError::invalid(
                    "memory write: a batch has one principal and one authority",
                ));
            }
            if !ids.insert(entry.id.as_str()) {
                return Err(StoreError::invalid(
                    "memory write: each entry has its own id",
                ));
            }
        }
        Ok((owner, authority, hashes))
    }
}

impl Invalidate {
    /// The request's own checks: id, principal, note length.
    ///
    /// # Errors
    /// [`StoreError::Invalid`].
    pub fn check(&self) -> Result<()> {
        check_memory_id(&self.id)?;
        check_principal("by", &self.by)?;
        if self
            .note
            .as_ref()
            .is_some_and(|n| n.chars().count() > MAX_INVALIDATION_NOTE_CHARS)
        {
            return Err(StoreError::invalid(
                "an invalidation note holds at most 500 characters",
            ));
        }
        Ok(())
    }
}

impl Forget {
    /// The request's own checks: owner, selector shape.
    ///
    /// # Errors
    /// [`StoreError::Invalid`].
    pub fn check(&self) -> Result<()> {
        check_principal("owner", &self.owner)?;
        match &self.selector {
            ForgetSelector::Ids(ids) => {
                if ids.is_empty() || ids.len() > MAX_FORGET_IDS {
                    return Err(StoreError::invalid("forget takes 1 to 100 ids"));
                }
                ids.iter().try_for_each(|id| check_memory_id(id))
            }
            ForgetSelector::Session(label) => check_label("session", label),
            ForgetSelector::Project(label) => check_label("project", label),
            ForgetSelector::Before(_) => Ok(()),
        }
    }
}

/// Check a page limit against its bound.
///
/// # Errors
/// [`StoreError::Invalid`] outside `1..=max`.
pub fn check_limit(what: &str, limit: u32, max: u32) -> Result<()> {
    if (1..=max).contains(&limit) {
        Ok(())
    } else {
        Err(StoreError::invalid(format!("{what}'s limit is 1 to {max}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_labels_and_prefixes() {
        let id = derive_memory_id("main", "t", 0, 1, 2);
        assert!(check_memory_id(&id).is_ok(), "{id}");
        assert_ne!(id, derive_memory_id("main", "t", 1, 1, 2));
        assert!(check_memory_id("mem-ABCDEF000000000000000000").is_err());
        assert!(check_label("project", "afd").is_ok());
        assert!(check_label("project", "../x").is_err());
        assert!(check_label("project", &"a".repeat(129)).is_err());
        assert!(capture_key_under("h:s:w1", "h:s:w1"));
        assert!(!capture_key_under("h:s:w1", "h:s:w10"));
        assert!(capture_key_under("h:s:", "h:s:w10"));
        assert_eq!(capture_session_prefix("h:s:w3").as_deref(), Some("h:s:"));
        assert_eq!(capture_session_prefix("h:s"), None);
    }

    #[test]
    fn hash_prefixes_need_sixteen_digits() {
        let hash = memory_content_hash("s", "t");
        let hex = &hash.as_str()[7..];
        assert!(content_hash_prefix_matches(&hash, &hex[..16]));
        assert!(content_hash_prefix_matches(&hash, hash.as_str()));
        assert!(!content_hash_prefix_matches(&hash, &hex[..15]));
        assert!(!content_hash_prefix_matches(&hash, "0000000000000000"));
    }

    #[test]
    fn the_push_rule() {
        let push = PushFilter {
            caller: "human:ada".into(),
            own: vec![Authority::Person, Authority::Transcript],
            foreign: vec![Authority::Person],
            unset_project: vec![Authority::Person],
        };
        let named = ProjectMatch::ExactOrUnset("afd".into());
        assert!(push.admits(
            "human:ada",
            Authority::Transcript,
            Some("afd"),
            &named,
            false
        ));
        assert!(!push.admits("human:ada", Authority::Transcript, None, &named, false));
        assert!(push.admits(
            "human:ada",
            Authority::Transcript,
            None,
            &ProjectMatch::Any,
            false
        ));
        assert!(!push.admits(
            "human:bo",
            Authority::Transcript,
            Some("afd"),
            &named,
            false
        ));
        assert!(push.admits("human:bo", Authority::Person, None, &named, false));
        assert!(!push.admits("human:ada", Authority::Person, Some("afd"), &named, true));
    }

    #[test]
    fn intervals_are_half_open() {
        let as_of = AsOf::at(10);
        assert!(as_of.matches((10, None), (10, Some(11))));
        assert!(!as_of.matches((10, Some(10)), (0, None)));
        assert!(!as_of.matches((0, None), (0, Some(10))));
        assert!(!as_of.matches((11, None), (0, None)));
    }
}
