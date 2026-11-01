//! The event, versions 0 and 1 (`schemas/event.v0.json`, `schemas/event.v1.json`): a projection
//! of one journal entry. A new event is version 1 when the host that journaled the call stamped
//! it so; an older entry projects as version 0, as it was first written.

use super::cursor::Cursor;
use crate::middleware::{EVENT_VERSION_KEY, MUTATION_KEY, SPACE_KEY};
use crate::provenance::Envelope;
use crate::workspace::SpaceId;
use afd::{Actor, JournalEntry};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub use crate::versions::EVENT_VERSION;

/// The `result.metadata` key a command sets to name the record it wrote.
pub const RECORD_KEY: &str = "dev.umbel/record";

/// The record a command wrote.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RecordRef {
    /// What kind of record.
    pub kind: String,
    /// The record's id.
    pub id: String,
    /// The record's version, when the command reported one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<Value>,
}

impl RecordRef {
    /// `{ kind, id, version? }` from a command's metadata value; anything else is `None`.
    fn from_value(value: &Value) -> Option<Self> {
        let object = value.as_object()?;
        let text = |name: &str| {
            object
                .get(name)
                .and_then(Value::as_str)
                .filter(|text| !text.is_empty())
                .map(str::to_owned)
        };
        let version = object
            .get("version")
            .filter(|version| version.is_string() || version.is_i64() || version.is_u64())
            .cloned();
        Some(Self {
            kind: text("kind")?,
            id: text("id")?,
            version,
        })
    }
}

/// The `result.metadata` key the plugin gate sets to the store revisions a call wrote (phase 2
/// specification, section 3.3 rule 6).
pub(crate) const CHANGES_KEY: &str = "dev.umbel/changes";

/// The store revisions one call wrote (event version 1): the lowest and highest, and how many.
/// Other processes may write between them, so `to_rev - from_rev + 1` can exceed `count`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Changes {
    /// The lowest revision the call wrote.
    pub from_rev: u64,
    /// The highest.
    pub to_rev: u64,
    /// How many revisions the call wrote.
    pub count: u64,
}

impl Changes {
    fn from_value(value: &Value) -> Option<Self> {
        let object = value.as_object()?;
        let number = |name: &str| object.get(name)?.as_u64().filter(|n| *n >= 1);
        let changes = Self {
            from_rev: number("fromRev")?,
            to_rev: number("toRev")?,
            count: number("count")?,
        };
        (changes.from_rev <= changes.to_rev).then_some(changes)
    }
}

/// One line of a space's event stream.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    /// 0 for a line written before event version 1, else [`EVENT_VERSION`].
    pub version: u32,
    /// `<space>:<seq>`, unique in the deployment.
    pub id: String,
    /// The space.
    pub space: String,
    /// Per space, from 1, increasing by 1.
    pub seq: u64,
    /// The cursor that resumes after this event.
    pub cursor: String,
    /// The journal entry's `seq`.
    pub journal_seq: u64,
    /// The command, copied from the journal entry.
    pub command: String,
    /// When the command started, copied from the journal entry.
    pub timestamp: String,
    /// The call's trace id, when it had one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trace_id: Option<String>,
    /// Who called, when the entry has an actor.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub actor: Option<Actor>,
    /// The record the command named, or `null`.
    pub record: Option<RecordRef>,
    /// Version 1: the store revisions the call wrote, when it wrote any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub changes: Option<Changes>,
    /// Where the record came from.
    pub provenance: Envelope,
}

impl Event {
    /// The event for journal entry `entry`, number `seq` of `space`: version 1 for an entry the
    /// host stamped `dev.umbel/event-version = 1`, version 0 for any other.
    pub fn from_entry(entry: &JournalEntry, space: &SpaceId, seq: u64) -> Self {
        let extra = entry
            .result
            .metadata
            .as_ref()
            .map(|metadata| &metadata.extra);
        // The stamp names the version the journaling host wrote; a version this host does not
        // know is written as the newest it does.
        let version = extra
            .and_then(|extra| extra.get(EVENT_VERSION_KEY))
            .and_then(Value::as_u64)
            .map_or(0, |stamped| {
                u32::try_from(stamped.min(u64::from(EVENT_VERSION))).unwrap_or(0)
            });
        let changes = (version >= 1)
            .then(|| extra.and_then(|extra| extra.get(CHANGES_KEY)))
            .flatten()
            .and_then(Changes::from_value);
        let record = entry
            .result
            .metadata
            .as_ref()
            .and_then(|metadata| metadata.extra.get(RECORD_KEY))
            .and_then(RecordRef::from_value);
        Self {
            version,
            id: format!("{space}:{seq}"),
            space: space.to_string(),
            seq,
            cursor: Cursor::new(space.clone(), seq).to_string(),
            journal_seq: entry.seq,
            command: entry.command.clone(),
            timestamp: entry.timestamp.clone(),
            trace_id: entry.trace_id.clone(),
            actor: entry.actor.clone(),
            record,
            changes,
            provenance: Envelope::from_entry(entry, space.as_str(), version),
        }
    }

    /// The line this event is stored as, without the newline.
    pub fn to_line(&self) -> String {
        // Plain data with string keys: serialization cannot fail.
        serde_json::to_string(self).unwrap_or_default()
    }
}

/// The space of a journal entry that becomes an event, or `None`: a success whose result the
/// event stamp marked `dev.umbel/mutation = true`, in a space the stamp named.
pub(crate) fn candidate_space(result: &afd::CommandResult<Value>) -> Option<SpaceId> {
    if !result.success {
        return None;
    }
    let extra = &result.metadata.as_ref()?.extra;
    if extra.get(MUTATION_KEY) != Some(&Value::Bool(true)) {
        return None;
    }
    SpaceId::parse(extra.get(SPACE_KEY)?.as_str()?).ok()
}
