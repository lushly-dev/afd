//! What a handler may use: the call and the host services its plugin was granted.

use serde_json::Value;
use std::fmt;

use umbel_store::{
    Change, ChunkHit, ContentHash, Direction, DocMeta, Document, DocumentWrite, Edge, EdgeKey,
    Envelope, Expect, GraphBatch, IndexChunk, IndexQuery, IndexWriterSession, ListQuery, Node,
    Page, Record, RecordMeta, Rev, Subgraph,
};

use crate::memory::{LeftOutQuery, MemoryWriteRequest};
use crate::store::{CollectionInfo, CollectionMeta, ContentEntry, Reader};
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

/// What the command is called with (WIT `call-context`). The principal is a summary: plugins
/// never see credentials or tokens.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct CallContext {
    /// The registered command name.
    pub command: String,
    /// The call's trace id.
    pub trace_id: String,
    /// The resolved space for a command with a `space` input; `None` otherwise.
    pub space: Option<String>,
    /// The spaces the call may use: the checked `spaces` of a command with a `spaces` input,
    /// else the call's one space (the default space for a command with no space input). The
    /// store methods refuse a space outside it.
    pub spaces: Vec<String>,
    /// The effective output budget in bytes, for a command that declares one (compiled plugins
    /// only in phase 2); `None` otherwise.
    pub output_budget: Option<u64>,
    /// The actor's kind: `human`, `agent`, `service` or `script`.
    pub actor_kind: String,
    /// The actor's id, when it has one.
    pub actor_id: Option<String>,
    /// The person the actor acts for, when known.
    pub on_behalf_of: Option<String>,
    /// `mcp`, `cli`, `agent` or `palette`.
    pub interface: String,
    /// The host's attestation that this call is a step of a plugin pipeline (phase 4
    /// specification, section 10.1, D91); `None` for any other call.
    ///
    /// The host fills it for a compiled plugin's command only, from a table it keeps itself,
    /// keyed by the fresh random trace id it gave the step, and only when the entry names the
    /// command called. Nothing a caller sends sets it: not the input, not `extra`, not a trace id
    /// chosen by a client. A component (WIT world 1.0.0) and a mounted server never see it.
    pub pipeline: Option<PipelineAttestation>,
    /// Whether the host counts the caller as a person for this command (phase 3 specification,
    /// sections 3.3 and 8.7; D86): a human through the library, or a human at the command line
    /// whose human-present mark names this command (stdin and stderr are terminals, the input is
    /// not `@-`, neither `--yes` nor `--approve`, and no agent environment variable is set). The
    /// same check the host makes before `memory-confirm` gives a record authority `person`;
    /// `curator-promote` makes it before a person widens their own records (phase 4 step 4,
    /// amendment 9). **Not an attestation**: it rests on a terminal check until phase 5.
    ///
    /// The host fills it for a compiled plugin's command only; a component (WIT world 1.0.0) and
    /// a mounted server always see `false`.
    pub person: bool,
    /// The legacy principal strings the caller's effective principal stands for (phase 5
    /// specification, section 4.6, `[principal.equivalents]`, one way): every principal
    /// comparison a plugin makes consults them beside the effective principal, so a person's
    /// namespaced principal is never a different person from their legacy one. Empty when none
    /// maps to it.
    ///
    /// The host fills it for a compiled plugin's command only; a component (WIT world 1.0.0) and
    /// a mounted server always see none.
    pub equivalents: Vec<String>,
    /// Whether the host seals this caller's positions (phase 5 section 9.3, D125): a hosted
    /// caller that is neither the operator nor stdio. A plugin then shows every store revision
    /// through [`crate::Cx::doc_position`] (it does in any case) and counts in its totals only
    /// what the caller can read.
    ///
    /// The host fills it for a compiled plugin's command only; a component (WIT world 1.0.0) and
    /// a mounted server always see `false`.
    pub sealed_positions: bool,
    /// The caller's delegation chain, outermost first (phase 5 sections 2.1 and 2.4): the
    /// verified client, or the RFC 8693 `act` chain of an issuer configured for it; empty without
    /// a token or an assertion. A plugin copies it into a version 3 envelope it writes in a record
    /// body (a proposal's `provenance`); the store envelope's own chain is the host's to fill.
    ///
    /// The host fills it for a compiled plugin's command only; a component (WIT world 1.0.0) and
    /// a mounted server always see none.
    pub delegation_chain: Vec<umbel_store::ChainLink>,
    /// The host's attestation that a person decided this very call on the person page (phase 5
    /// sections 7.2 and 7.3): `Some` only when the host's own mark on the call names this command,
    /// the surface it came on and the digest of this validated input, for the person the caller
    /// acts for, after the plugin gate admitted it once. Nothing a caller sends sets it. `None` at
    /// a terminal (the CLI's check is [`Self::person`]'s) and everywhere else.
    ///
    /// The host fills it for a compiled plugin's command only; a component (WIT world 1.0.0) and
    /// a mounted server always see none.
    pub person_decision: Option<PersonDecision>,
    /// The call a person is about to be asked to decide on the person page, when this call is
    /// that command's `confirm_preview` run by the host as the caller before the decision is
    /// begun (phase 5 step 6): the plugin answers a failure for a call it would refuse, so no
    /// person is asked about it. `None` for every other call, the page's own rendering included.
    /// It only ever adds refusals, so it carries no authority. The host runs this check as its own
    /// in-process call: [`Self::interface`] is then empty, and [`PersonCheck::surface`] says where
    /// the call it checks came from.
    ///
    /// The host fills it for a compiled plugin's command only; a component (WIT world 1.0.0) and
    /// a mounted server always see none.
    pub person_check: Option<PersonCheck>,
}

/// The call the host is about to ask a person to decide (phase 5 step 6), as
/// [`CallContext::person_check`] names it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PersonCheck {
    /// The gated command.
    pub command: String,
    /// Where its call came from: `mcp` (the approval relay) or `cli` (the command line's URL
    /// flow).
    pub surface: String,
}

/// A person's decision on the person page that a call carries, as the host attests it (phase 5
/// sections 7.2 and 7.3): who decided and how they were proven, never the decision's content.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PersonDecision {
    /// Where the call came from: `mcp` (through the approval relay) or `cli` (the command line's
    /// URL flow).
    pub surface: String,
    /// The person who logged in and decided, `<namespace>/<subject>`: the person the call is for.
    pub person: String,
    /// The identity namespace of the login.
    pub namespace: String,
    /// The login's `auth_time`, ISO 8601 UTC with milliseconds.
    pub auth_time: String,
    /// The login's `acr`.
    pub acr: String,
}

/// Who ran a pipeline step, as the host attests it (phase 4 specification, section 10.1): the
/// plugin and instance that ship the pipeline, the pipeline, and the run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PipelineAttestation {
    /// The `plugin.id` of the plugin that ships the pipeline.
    pub plugin: String,
    /// The instance of that plugin whose pipeline is running.
    pub instance: String,
    /// The pipeline's command name.
    pub pipeline: String,
    /// The pipeline call's trace id: one run of the pipeline, shared by all of its steps.
    pub run: String,
}

/// Why a host service refused (WIT `host-error`; world 1.1.0 adds the store variants). The memory
/// variants are phase 3's (section 5.2); each names the error code a plugin answers with.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub enum HostError {
    /// The grant was not declared, or the deployer denied it.
    NotGranted(String),
    /// What was asked for does not exist.
    NotFound(String),
    /// The arguments were not acceptable.
    Invalid(String),
    /// The answer would exceed a cap.
    TooLarge(String),
    /// A compare-and-set or revision check failed and nothing was written. `current` is the
    /// current content hash, or the current revision for an applied revision.
    Conflict {
        /// What the store holds now.
        current: Option<String>,
    },
    /// A lock wait ran past `store.lock_timeout_ms`; retry.
    Busy(String),
    /// The stored data is not what the store wrote; run `store-check`.
    Corrupt(String),
    /// The operating system or the database failed.
    Io(String),
    /// A memory write met a limit of its quota and wrote nothing (`MEMORY_QUOTA_EXCEEDED`).
    /// Retryable when the limit is a rate, which `retry_after_ms` then says.
    QuotaExceeded {
        /// Which limit.
        limit: umbel_store::memory::QuotaLimit,
        /// When a rate limit admits the write again; `None` for the stored limits.
        retry_after_ms: Option<u64>,
    },
    /// Nothing has been written to the space's memory store yet; a read creates nothing.
    NotProvisioned,
    /// The memory key file does not exist (`MEMORY_KEYS_MISSING`).
    KeysMissing,
    /// The memory key file belongs to another database, or is not one (`MEMORY_KEYS_MISMATCH`).
    KeysMismatch,
    /// A readable record's key entry is absent (`MEMORY_KEY_ABSENT`).
    KeyAbsent {
        /// The record.
        id: String,
    },
    /// A readable record's sealed blob does not open (`MEMORY_SEAL_INVALID`).
    SealInvalid {
        /// The record.
        id: String,
    },
    /// A memory query matches more readable records than recall ranks
    /// (`MEMORY_QUERY_TOO_BROAD`, phase 5 section 9.2); nothing was returned.
    QueryTooBroad {
        /// The most readable matches a recall ranks.
        limit: u64,
    },
}

impl fmt::Display for HostError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotGranted(message) => write!(f, "not granted: {message}"),
            Self::NotFound(message) => write!(f, "not found: {message}"),
            Self::Invalid(message) => write!(f, "invalid: {message}"),
            Self::TooLarge(message) => write!(f, "too large: {message}"),
            Self::Conflict { current: Some(c) } => write!(f, "conflict: the store holds {c}"),
            Self::Conflict { current: None } => write!(f, "conflict: nothing is stored there"),
            Self::Busy(message) => write!(f, "busy: {message}"),
            Self::Corrupt(message) => write!(f, "corrupt: {message}"),
            Self::Io(message) => write!(f, "i/o: {message}"),
            Self::QuotaExceeded {
                limit,
                retry_after_ms: Some(ms),
            } => write!(
                f,
                "MEMORY_QUOTA_EXCEEDED: the limit {} is reached; retry after {ms} ms",
                limit.as_str()
            ),
            Self::QuotaExceeded { limit, .. } => write!(
                f,
                "MEMORY_QUOTA_EXCEEDED: the limit {} is reached",
                limit.as_str()
            ),
            Self::NotProvisioned => write!(f, "not provisioned: nothing is stored in memory yet"),
            Self::KeysMissing => write!(
                f,
                "MEMORY_KEYS_MISSING: the memory key file memory.keys does not exist"
            ),
            Self::KeysMismatch => write!(
                f,
                "MEMORY_KEYS_MISMATCH: the memory key file does not belong to this memory database"
            ),
            Self::KeyAbsent { id } => {
                write!(f, "MEMORY_KEY_ABSENT: the record {id} has no key entry")
            }
            Self::SealInvalid { id } => {
                write!(f, "MEMORY_SEAL_INVALID: the record {id} does not open")
            }
            Self::QueryTooBroad { limit } => write!(
                f,
                "MEMORY_QUERY_TOO_BROAD: the query matches more than {limit} readable records"
            ),
        }
    }
}

impl std::error::Error for HostError {}

/// What a reporting checkpoint of the document store achieved ([`HostServices::truncate_wal`],
/// phase 4 specification section 9.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WalCheckpoint {
    /// Every frame is in the database file and the write-ahead log is empty, so with
    /// `secure_delete` on no replaced or removed bytes remain in either.
    Clean,
    /// A reader holds the write-ahead log, or a lock was busy: the earlier bytes stay in it until
    /// a later checkpoint (a later write's, or `store-check`'s) truncates it.
    Pending,
}

/// A log level (WIT `log.level`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Level {
    /// Something failed.
    Error,
    /// Something needs attention.
    Warn,
    /// Normal operation.
    Info,
    /// Detail for diagnosing.
    Debug,
    /// Finer detail still.
    Trace,
}

/// The host services of one call, by grant. The host implements it for a compiled plugin; a
/// component and a mounted server get their own implementations in later steps. Every method
/// answers [`HostError::NotGranted`] for a grant that was not declared or was denied.
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
    /// `RECORD_WORDING_FIXED` or `RECORD_LANE_STALE`, and [`HostError::Conflict`] with no
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
    /// `RECORD_FIELD_INVALID`, `RECORD_WORDING_FIXED`, `RECORD_EVIDENCE_INVALID` or
    /// `RECORD_LANE_STALE` (section 13).
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
    /// `RECORD_QUERY_TOO_BROAD`.
    fn record_find(&self, _space: &str, _query: &RecordFind) -> Result<FindPage, HostError> {
        not_granted("records")
    }
    /// Grant `records`: for each text, the readable records whose match field is identical and
    /// the nearest ones with their scores (section 8). Scores only: what to do with them is the
    /// plugin's.
    ///
    /// # Errors
    /// As [`HostServices::record_find`].
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
    /// Compiled plugins only: WIT world 1.0.0 has no such function.
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

/// Services for a call whose plugin was granted nothing: every method answers `NotGranted`.
#[derive(Debug, Clone, Copy, Default)]
pub struct NoServices;

pub(crate) fn not_granted<T>(grant: &str) -> Result<T, HostError> {
    Err(HostError::NotGranted(format!(
        "the grant `{grant}` was not declared or was denied"
    )))
}

impl HostServices for NoServices {
    fn config(&self) -> Result<Value, HostError> {
        not_granted("config")
    }
    fn log(&self, _level: Level, _message: &str) {}
    fn pack_list(&self, _pack: &str) -> Result<Vec<String>, HostError> {
        not_granted("packs")
    }
    fn pack_read(&self, _pack: &str, _path: &str) -> Result<Vec<u8>, HostError> {
        not_granted("packs")
    }
    fn events(
        &self,
        _space: Option<&str>,
        _after: Option<&str>,
        _limit: u32,
    ) -> Result<Value, HostError> {
        not_granted("events")
    }
    fn now_ms(&self) -> Result<i64, HostError> {
        not_granted("clock")
    }
    fn random(&self) -> Result<f64, HostError> {
        not_granted("random")
    }
}

/// What a handler may use. Each method fails with [`HostError::NotGranted`] when the grant was
/// not declared or was denied.
pub struct Cx {
    call: CallContext,
    services: Services,
}

/// Where a handle's services come from. A component calls its imports directly (never through a
/// trait object), so an interface the plugin never uses is not imported by the component and the
/// manifest need not declare its grant.
enum Services {
    Dyn(Box<dyn HostServices>),
    #[cfg(feature = "component")]
    Component,
}

impl fmt::Debug for Cx {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Cx").field("call", &self.call).finish()
    }
}

impl Cx {
    /// A handle over `services` for the call `call`. Hosts build it; tests may too.
    pub fn new(call: CallContext, services: impl HostServices + 'static) -> Self {
        Self {
            call,
            services: Services::Dyn(Box::new(services)),
        }
    }

    /// A handle over the component's imports (the `component` feature).
    #[cfg(feature = "component")]
    pub(crate) fn component(call: CallContext) -> Self {
        Self {
            call,
            services: Services::Component,
        }
    }

    /// A handle with no grants: every service answers `NotGranted`.
    pub fn without_grants(call: CallContext) -> Self {
        Self::new(call, NoServices)
    }

    /// The command, trace id, space, actor summary and interface.
    pub fn call(&self) -> &CallContext {
        &self.call
    }

    /// The host services behind this handle, for the store methods. A component holds no store
    /// grant in protocol 1, so for one every store method answers `NotGranted`.
    pub(crate) fn host(&self) -> Result<&dyn HostServices, HostError> {
        match &self.services {
            Services::Dyn(services) => Ok(services.as_ref()),
            #[cfg(feature = "component")]
            Services::Component => not_granted("documents"),
        }
    }

    /// Grant `config`.
    ///
    /// # Errors
    /// [`HostError::NotGranted`].
    pub fn config(&self) -> Result<Value, HostError> {
        match &self.services {
            Services::Dyn(services) => services.config(),
            #[cfg(feature = "component")]
            Services::Component => crate::component::config(),
        }
    }

    /// Grant `log`; a no-op without the grant.
    pub fn log(&self, level: Level, message: &str) {
        match &self.services {
            Services::Dyn(services) => services.log(level, message),
            #[cfg(feature = "component")]
            Services::Component => crate::component::log(level, message),
        }
    }

    /// Grant `packs`: one file of one of the plugin's packs.
    ///
    /// # Errors
    /// See [`HostServices::pack_read`].
    pub fn pack_read(&self, pack: &str, path: &str) -> Result<Vec<u8>, HostError> {
        match &self.services {
            Services::Dyn(services) => services.pack_read(pack, path),
            #[cfg(feature = "component")]
            Services::Component => crate::component::pack_read(pack, path),
        }
    }

    /// Grant `packs`: the files of one of the plugin's packs.
    ///
    /// # Errors
    /// See [`HostServices::pack_list`].
    pub fn pack_list(&self, pack: &str) -> Result<Vec<String>, HostError> {
        match &self.services {
            Services::Dyn(services) => services.pack_list(pack),
            #[cfg(feature = "component")]
            Services::Component => crate::component::pack_list(pack),
        }
    }

    /// Grant `events`.
    ///
    /// # Errors
    /// See [`HostServices::events`].
    pub fn events(
        &self,
        space: Option<&str>,
        after: Option<&str>,
        limit: u32,
    ) -> Result<Value, HostError> {
        match &self.services {
            Services::Dyn(services) => services.events(space, after, limit),
            #[cfg(feature = "component")]
            Services::Component => crate::component::events(space, after, limit),
        }
    }

    /// Grant `clock`: epoch milliseconds from the command context's clock.
    ///
    /// # Errors
    /// [`HostError::NotGranted`].
    pub fn now_ms(&self) -> Result<i64, HostError> {
        match &self.services {
            Services::Dyn(services) => services.now_ms(),
            #[cfg(feature = "component")]
            Services::Component => Ok(crate::component::now_ms()),
        }
    }

    /// Grant `random`: the command context's random source, in `[0, 1)`.
    ///
    /// # Errors
    /// [`HostError::NotGranted`].
    pub fn random(&self) -> Result<f64, HostError> {
        match &self.services {
            Services::Dyn(services) => services.random(),
            #[cfg(feature = "component")]
            Services::Component => Ok(crate::component::random()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_handle_without_grants_answers_not_granted_everywhere() {
        let cx = Cx::without_grants(CallContext::default());
        assert!(matches!(cx.config(), Err(HostError::NotGranted(_))));
        assert!(matches!(
            cx.pack_read("p", "data/x"),
            Err(HostError::NotGranted(_))
        ));
        assert!(matches!(cx.pack_list("p"), Err(HostError::NotGranted(_))));
        assert!(matches!(
            cx.events(None, None, 10),
            Err(HostError::NotGranted(_))
        ));
        assert!(matches!(cx.now_ms(), Err(HostError::NotGranted(_))));
        assert!(matches!(cx.random(), Err(HostError::NotGranted(_))));
        cx.log(Level::Info, "a no-op");
    }
}
