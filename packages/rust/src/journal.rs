//! The command journal: an ordered, append-only record of executed commands.
//!
//! A journal records each command call (name, input, essential context and result) so it can be
//! audited, replayed to reproduce a session, or turned into a regression test. A
//! [`JournalRecorder`] set on a registry with
//! [`CommandRegistry::set_journal`](crate::CommandRegistry::set_journal) records entries, and
//! [`replay_journal`] plays them back. On disk, a journal is JSON Lines: one [`JournalEntry`] per
//! line (`spec/journal.md`), readable and writable by every AFD implementation.
//!
//! Journals never store secrets from the command context: an entry keeps the actor, the
//! interface and the trace ID, plus a hash over those values and the names (never the values)
//! of the other context keys.
//!
//! [`MemoryJournalSink`] keeps a journal in memory. `FileJournalSink` (the `journal-file`
//! feature, on by default) appends to a JSON Lines file.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::sync::{Mutex, PoisonError};

use crate::actor::Actor;
use crate::commands::CommandContext;
use crate::result::CommandResult;

#[cfg(feature = "journal-file")]
mod file;
mod recorder;
mod replay;

#[cfg(feature = "journal-file")]
pub use file::FileJournalSink;
pub(crate) use recorder::JournalContextState;
pub use recorder::JournalRecorder;
pub use replay::{
    replay_journal, ReplayDifference, ReplayDifferenceKind, ReplayEntryReport,
    ReplayJournalOptions, ReplayReport, ReplayStatus,
};

/// Largest integer a JavaScript number represents exactly: the largest `seq` a journal holds.
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

// ═══════════════════════════════════════════════════════════════════════════════
// ENTRY
// ═══════════════════════════════════════════════════════════════════════════════

/// The clock readings and random numbers a command's handler took from `context.clock` and
/// `context.random`, in the order it took them. Replay feeds them back so the handler sees the
/// same time and the same random numbers.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct JournalTape {
    /// Each `context.clock().now()` reading, in epoch milliseconds.
    pub clock: Vec<i64>,
    /// Each `context.random().next()` value.
    #[serde(serialize_with = "numbers")]
    pub random: Vec<f64>,
    /// Set when the handler read more values than the recorder keeps; replay cannot restore
    /// the rest. Written only when `true`.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub truncated: bool,
}

impl JournalTape {
    /// Whether the handler read nothing (an entry omits such a tape).
    pub fn is_empty(&self) -> bool {
        self.clock.is_empty() && self.random.is_empty() && !self.truncated
    }
}

/// Serialize `values` the way `JSON.stringify` does (`0`, not `0.0`).
fn numbers<S: serde::Serializer>(values: &[f64], serializer: S) -> Result<S::Ok, S::Error> {
    use serde::ser::SerializeSeq;

    struct Number(f64);
    impl Serialize for Number {
        fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
            crate::wire::number(&self.0, serializer)
        }
    }

    let mut seq = serializer.serialize_seq(Some(values.len()))?;
    for value in values {
        seq.serialize_element(&Number(*value))?;
    }
    seq.end()
}

/// The parts of the command context a journal keeps besides the actor and trace ID.
///
/// The allowlist is the actor ([`JournalEntry::actor`]), the interface (here) and the trace ID
/// ([`JournalEntry::trace_id`]). Nothing else from the context is stored.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct JournalContextDigest {
    /// `sha256:` and the hex SHA-256 of the canonical JSON of the actor, the interface, the
    /// trace ID and the sorted names of the context's other keys. Names only, never their
    /// values, so an auth token or a session never reaches the journal, not even hashed.
    pub hash: String,
    /// The interface that invoked the command (`context.interface`), such as `mcp`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub interface: Option<String>,
}

/// One executed command in a journal.
///
/// Optional fields that are not set are omitted, never `null`. The fields serialize in the
/// order of `spec/journal.md`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalEntry {
    /// Position in the journal, from 1, assigned by the sink. Increasing; gaps are allowed.
    pub seq: u64,
    /// When the command started, as an ISO 8601 string from `context.clock`.
    pub timestamp: String,
    /// `context.trace_id`, when the call had one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trace_id: Option<String>,
    /// The command name.
    pub command: String,
    /// The validated input the handler received.
    pub input: Value,
    /// Who called: `kind`, and `id`, `label` and `onBehalfOf` when set.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub actor: Option<Actor>,
    /// The context hash and the allowlisted interface.
    pub context_digest: JournalContextDigest,
    /// The command result, metadata included.
    pub result: CommandResult<Value>,
    /// Duration of the call through the middleware chain, from `context.clock`.
    #[serde(serialize_with = "crate::wire::number")]
    pub duration_ms: f64,
    /// The clock and random values the handler read, for replay. Omitted when it read none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tape: Option<JournalTape>,
}

/// An entry before the sink assigns its [`JournalEntry::seq`]. The fields mean the same as
/// in [`JournalEntry`].
#[derive(Debug, Clone, PartialEq)]
pub struct JournalRecord {
    pub timestamp: String,
    pub trace_id: Option<String>,
    pub command: String,
    pub input: Value,
    pub actor: Option<Actor>,
    pub context_digest: JournalContextDigest,
    pub result: CommandResult<Value>,
    pub duration_ms: f64,
    pub tape: Option<JournalTape>,
}

impl JournalRecord {
    /// The entry for this record at position `seq`.
    pub fn into_entry(self, seq: u64) -> JournalEntry {
        JournalEntry {
            seq,
            timestamp: self.timestamp,
            trace_id: self.trace_id,
            command: self.command,
            input: self.input,
            actor: self.actor,
            context_digest: self.context_digest,
            result: self.result,
            duration_ms: self.duration_ms,
            tape: self.tape,
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SINKS
// ═══════════════════════════════════════════════════════════════════════════════

/// A range of entries to read, by `seq`. Both bounds are inclusive.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct JournalRange {
    /// First `seq` to include. `None`: the start of the journal.
    pub from: Option<u64>,
    /// Last `seq` to include. `None`: the end of the journal.
    pub to: Option<u64>,
}

impl JournalRange {
    /// The whole journal.
    pub const fn all() -> Self {
        Self {
            from: None,
            to: None,
        }
    }

    /// Entries from `from` to `to`, inclusive.
    pub const fn between(from: u64, to: u64) -> Self {
        Self {
            from: Some(from),
            to: Some(to),
        }
    }

    /// Whether `seq` is in the range.
    pub fn contains(&self, seq: u64) -> bool {
        self.from.is_none_or(|from| seq >= from) && self.to.is_none_or(|to| seq <= to)
    }

    /// The entries of `entries` (in `seq` order) that fall in the range.
    pub fn select(&self, entries: &[JournalEntry]) -> Vec<JournalEntry> {
        entries
            .iter()
            .filter(|entry| self.contains(entry.seq))
            .cloned()
            .collect()
    }
}

/// Storage for a journal: append entries and read them back in order.
///
/// The sink assigns `seq`, so a journal reopened after a restart continues its numbering.
/// Implementations: [`MemoryJournalSink`], and `FileJournalSink` (JSON Lines, the
/// `journal-file` feature).
#[async_trait]
pub trait JournalSink: Send + Sync {
    /// Append `record` with the next `seq` and return the stored entry.
    async fn append(&self, record: JournalRecord) -> Result<JournalEntry, String>;

    /// Entries in `range`, in `seq` order.
    async fn read(&self, range: JournalRange) -> Result<Vec<JournalEntry>, String>;
}

/// A journal held in memory, for tests and short-lived sessions.
///
/// ```rust
/// use afd::{CommandRegistry, JournalRecorder, MemoryJournalSink};
/// use std::sync::Arc;
///
/// let journal = Arc::new(MemoryJournalSink::new());
/// let registry = CommandRegistry::new();
/// registry.set_journal(JournalRecorder::new(journal.clone()));
/// // ... execute commands, then read `journal.entries()`.
/// ```
#[derive(Debug, Default)]
pub struct MemoryJournalSink {
    entries: Mutex<Vec<JournalEntry>>,
}

impl MemoryJournalSink {
    /// An empty journal.
    pub fn new() -> Self {
        Self::default()
    }

    /// A journal that starts from `entries`, such as one read with [`parse_journal`].
    pub fn with_entries(entries: impl IntoIterator<Item = JournalEntry>) -> Self {
        let mut entries: Vec<JournalEntry> = entries.into_iter().collect();
        entries.sort_by_key(|entry| entry.seq);
        Self {
            entries: Mutex::new(entries),
        }
    }

    /// Every entry, in `seq` order.
    pub fn entries(&self) -> Vec<JournalEntry> {
        self.lock().clone()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Vec<JournalEntry>> {
        self.entries.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

#[async_trait]
impl JournalSink for MemoryJournalSink {
    async fn append(&self, record: JournalRecord) -> Result<JournalEntry, String> {
        let mut entries = self.lock();
        let seq = entries.last().map_or(0, |entry| entry.seq) + 1;
        let entry = record.into_entry(seq);
        entries.push(entry.clone());
        Ok(entry)
    }

    async fn read(&self, range: JournalRange) -> Result<Vec<JournalEntry>, String> {
        Ok(range.select(&self.lock()))
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONTEXT DIGEST
// ═══════════════════════════════════════════════════════════════════════════════

/// `actor` with only the four [`Actor`] fields, or `None` when it is not an actor.
///
/// Use it on an actor that arrived as JSON: fields other than `kind`, `id`, `label` and
/// `onBehalfOf` are dropped.
pub fn journal_actor(actor: &Value) -> Option<Actor> {
    if !crate::actor::is_actor(actor) {
        return None;
    }
    serde_json::from_value(actor.clone()).ok()
}

/// `value` with object keys sorted at every level, so equal values give equal text whether or
/// not serde_json keeps insertion order.
fn sort_keys(value: Value) -> Value {
    match value {
        Value::Array(items) => Value::Array(items.into_iter().map(sort_keys).collect()),
        Value::Object(object) => {
            let mut entries: Vec<(String, Value)> = object.into_iter().collect();
            entries.sort_by(|(a, _), (b, _)| a.cmp(b));
            Value::Object(
                entries
                    .into_iter()
                    .map(|(key, value)| (key, sort_keys(value)))
                    .collect(),
            )
        }
        other => other,
    }
}

/// The names of the context keys that have a value, besides the allowlisted actor, interface
/// and trace ID, as TypeScript names them (`clock`, `random`, `timeoutMs` and each `extra` key).
fn context_key_names(context: &CommandContext) -> Vec<String> {
    let mut names = BTreeSet::new();
    if context.timeout_ms.is_some() {
        names.insert("timeoutMs".to_string());
    }
    if context.clock.is_some() {
        names.insert("clock".to_string());
    }
    if context.random.is_some() {
        names.insert("random".to_string());
    }
    // Every `extra` key has a value (`null` is one, as in TypeScript).
    for key in context.extra.keys() {
        if !matches!(key.as_str(), "actor" | "interface" | "traceId") {
            names.insert(key.clone());
        }
    }
    names.into_iter().collect()
}

/// The [`JournalContextDigest`] of `context`.
///
/// The hash covers the actor, the interface, the trace ID and the sorted names of every other
/// context key that has a value (`spec/journal.md`). Values outside the allowlist never enter
/// the hash or the digest. A context built like a TypeScript one (clock and random set, no
/// other key) hashes the same as in TypeScript.
pub fn create_context_digest(context: &CommandContext) -> JournalContextDigest {
    let interface = context
        .interface
        .map(|interface| interface.as_str().to_string());
    let canonical = sort_keys(serde_json::json!({
        "actor": context.actor,
        "interface": interface,
        "keys": context_key_names(context),
        "traceId": context.trace_id,
    }));
    let text = serde_json::to_string(&canonical).expect("JSON values serialize");
    let digest = Sha256::digest(text.as_bytes());
    let hex: String = digest.iter().map(|byte| format!("{byte:02x}")).collect();
    JournalContextDigest {
        hash: format!("sha256:{hex}"),
        interface,
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// JSON LINES
// ═══════════════════════════════════════════════════════════════════════════════

/// `value` as an entry, when it has the shape of one.
fn entry_from_value(value: Value) -> Option<JournalEntry> {
    let entry: JournalEntry = serde_json::from_value(value).ok()?;
    (entry.seq >= 1 && entry.seq <= MAX_SAFE_INTEGER && entry.duration_ms.is_finite())
        .then_some(entry)
}

/// Whether `value` has the shape of a [`JournalEntry`].
pub fn is_journal_entry(value: &Value) -> bool {
    entry_from_value(value.clone()).is_some()
}

/// One JSON Lines line for `entry`, without the trailing newline.
pub fn serialize_journal_entry(entry: &JournalEntry) -> String {
    // serde_json escapes newlines inside strings, so the line holds the whole entry.
    serde_json::to_string(entry).expect("journal entries serialize")
}

/// A JSON Lines journal for `entries`: one line each, every line ending in `\n`.
pub fn serialize_journal(entries: &[JournalEntry]) -> String {
    entries
        .iter()
        .map(|entry| serialize_journal_entry(entry) + "\n")
        .collect()
}

/// The entries of a JSON Lines journal, in file order. Blank lines are skipped; `\r\n` line
/// endings are accepted.
///
/// Entries compare with TypeScript's as JSON values. The text differs only in key order:
/// without serde_json's `preserve_order` feature, objects inside `input` and `result` are
/// written with sorted keys, and the result's fields follow [`CommandResult`]'s order.
///
/// # Errors
/// Returns a message naming the line when a line is not JSON or not a [`JournalEntry`].
pub fn parse_journal(text: &str) -> Result<Vec<JournalEntry>, String> {
    let mut entries = Vec::new();
    for (index, line) in text.split('\n').enumerate() {
        let line = line.strip_suffix('\r').unwrap_or(line);
        if line.trim().is_empty() {
            continue;
        }
        let value: Value = serde_json::from_str(line)
            .map_err(|error| format!("Journal line {} is not valid JSON: {error}", index + 1))?;
        let entry = entry_from_value(value)
            .ok_or_else(|| format!("Journal line {} is not a journal entry", index + 1))?;
        entries.push(entry);
    }
    Ok(entries)
}

#[cfg(test)]
mod tests;
