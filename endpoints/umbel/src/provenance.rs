//! The provenance envelope, version 0 (`schemas/provenance-envelope.v0.json`).
//!
//! Every event carries one. The command supplies `origin`, `session`, `validFrom`, `validUntil`,
//! `confidence` and `authority` in `result.metadata["dev.umbel/provenance"]`; the host fills the
//! rest from the journal entry. Phase 0 has no store, so it refuses nothing: a value that is not
//! of the documented type reads as absent.

use afd::{Actor, ActorKind, JournalEntry};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

pub use crate::versions::PROVENANCE_VERSION;

/// The `result.metadata` key a command sets to supply provenance.
pub const PROVENANCE_KEY: &str = "dev.umbel/provenance";

/// Where a record came from.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Origin {
    /// The person said it.
    UserStated,
    /// An agent concluded it.
    AgentInferred,
    /// It came out of a document.
    DocumentDerived,
    /// The command gave none. Store writes, from phase 2, refuse this.
    Unspecified,
}

impl Origin {
    fn from_value(value: Option<&Value>) -> Self {
        match value.and_then(Value::as_str) {
            Some("user-stated") => Self::UserStated,
            Some("agent-inferred") => Self::AgentInferred,
            Some("document-derived") => Self::DocumentDerived,
            _ => Self::Unspecified,
        }
    }
}

/// The provenance envelope, version 0. Fields are all present on the wire; absent ones are
/// `null`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Envelope {
    /// Always [`PROVENANCE_VERSION`].
    pub version: u32,
    /// Where the record came from.
    pub origin: Origin,
    /// The record's space.
    pub space: String,
    /// The actor when its kind is `agent`, `service` or `script`; otherwise `null`.
    pub agent: Option<Actor>,
    /// The person: the actor's `onBehalfOf`, or the actor's id when its kind is `human`;
    /// otherwise `null`.
    pub principal: Option<String>,
    /// A harness session id when the command supplied one.
    pub session: Option<String>,
    /// The call's trace id.
    pub trace_id: Option<String>,
    /// The journal entry's timestamp.
    pub observed_at: String,
    /// ISO 8601, from the command.
    pub valid_from: Option<String>,
    /// ISO 8601, from the command.
    pub valid_until: Option<String>,
    /// 0 to 1: the command's value, else the result's `confidence`.
    pub confidence: Option<f64>,
    /// A string in version 0; phase 3's version 1 closes the set.
    pub authority: Option<String>,
}

impl Envelope {
    /// The envelope of the journal entry `entry`, a mutation in `space`.
    pub fn from_entry(entry: &JournalEntry, space: &str) -> Self {
        let supplied: Option<&Map<String, Value>> = entry
            .result
            .metadata
            .as_ref()
            .and_then(|metadata| metadata.extra.get(PROVENANCE_KEY))
            .and_then(Value::as_object);
        let field = |name: &str| supplied.and_then(|map| map.get(name));
        let text = |name: &str| field(name).and_then(Value::as_str).map(str::to_owned);
        let instant = |name: &str| {
            text(name).filter(|value| chrono::DateTime::parse_from_rfc3339(value).is_ok())
        };
        let confidence = field("confidence")
            .and_then(Value::as_f64)
            .or(entry.result.confidence)
            .filter(|value| (0.0..=1.0).contains(value));
        let (agent, principal) = match &entry.actor {
            Some(actor) => (
                matches!(
                    actor.kind,
                    ActorKind::Agent | ActorKind::Service | ActorKind::Script
                )
                .then(|| actor.clone()),
                actor.on_behalf_of.clone().or_else(|| {
                    if actor.kind == ActorKind::Human {
                        actor.id.clone()
                    } else {
                        None
                    }
                }),
            ),
            None => (None, None),
        };
        Self {
            version: PROVENANCE_VERSION,
            origin: Origin::from_value(field("origin")),
            space: space.to_owned(),
            agent,
            principal,
            session: text("session"),
            trace_id: entry.trace_id.clone(),
            observed_at: entry.timestamp.clone(),
            valid_from: instant("validFrom"),
            valid_until: instant("validUntil"),
            confidence,
            authority: text("authority"),
        }
    }
}
