//! What every proposal command shares: who is calling, the time, the record's envelope, saving a
//! proposal, and the failures.

use chrono::SecondsFormat;
use serde_json::{Value, json};
use umbel_sdk::{CollectionInfo, Cx, HostError, Outcome, failure};
use umbel_store::{
    DerivedFrom, Envelope, Expect, Origin, Record, RecordMeta, Sensitivity, Source, canonical_json,
};

use super::model::{ActorRef, KIND, Proposal};

/// The records of one proposal that a record can hold: SQLite's cap on a record body.
pub(crate) const MAX_RECORD_BYTES: usize = umbel_store::MAX_RECORD_BYTES;

/// The caller of a proposal command.
pub(crate) struct Caller<'a> {
    pub(crate) cx: &'a Cx,
    pub(crate) space: String,
    /// The command context's clock, RFC 3339 with milliseconds.
    pub(crate) now: String,
    pub(crate) actor: ActorRef,
    /// The effective principal string (section 6): the person behind the call, else the actor.
    pub(crate) principal: String,
}

impl<'a> Caller<'a> {
    pub(crate) fn new(cx: &'a Cx) -> Result<Self, Outcome> {
        let Some(space) = cx.call().space.clone() else {
            return Err(crate::fail::no_space());
        };
        let now_ms = cx.now_ms().map_err(|error| crate::fail::host(&error))?;
        let call = cx.call();
        let actor = ActorRef {
            kind: call.actor_kind.clone(),
            id: call.actor_id.clone(),
            on_behalf_of: call
                .on_behalf_of
                .clone()
                .filter(|person| !person.is_empty()),
        };
        let principal = match (&actor.on_behalf_of, &actor.id) {
            (Some(person), _) => format!("human:{person}"),
            (None, _) => actor.text(),
        };
        Ok(Self {
            cx,
            space,
            now: rfc3339(now_ms),
            actor,
            principal,
        })
    }

    pub(crate) fn is_human(&self) -> bool {
        self.actor.kind == "human"
    }

    /// The access tokens of the caller's reader filter in the space.
    pub(crate) fn tokens(&self) -> Result<Vec<String>, HostError> {
        self.cx.reader_tokens(&self.space)
    }

    /// The origin of what this caller writes: a person's word, or an agent's inference.
    pub(crate) fn origin(&self) -> Origin {
        if self.is_human() {
            Origin::UserStated
        } else {
            Origin::AgentInferred
        }
    }
}

/// Epoch milliseconds as RFC 3339 UTC with milliseconds.
pub(crate) fn rfc3339(ms: i64) -> String {
    chrono::DateTime::from_timestamp_millis(ms)
        .map(|time| time.to_rfc3339_opts(SecondsFormat::Millis, true))
        .unwrap_or_default()
}

/// The access set and sensitivity a proposal inherits from its target.
#[derive(Debug, Clone)]
pub(crate) struct Target {
    pub(crate) access: Vec<String>,
    pub(crate) sensitivity: Sensitivity,
}

impl Target {
    pub(crate) fn of_collection(info: &CollectionInfo) -> Self {
        Self {
            access: info.access.clone(),
            sensitivity: serde_json::from_value(Value::String(info.sensitivity.clone()))
                .unwrap_or(Sensitivity::Internal),
        }
    }
}

/// What an envelope of a proposal write says beyond the host-filled identity.
pub(crate) struct Parts {
    pub(crate) origin: Origin,
    pub(crate) target: Target,
    pub(crate) session: Option<String>,
    pub(crate) confidence: Option<f64>,
    pub(crate) doc: String,
    pub(crate) content_hash: Option<String>,
    pub(crate) derived_from: Option<Vec<DerivedFrom>>,
}

/// An envelope version 1 with the fields the plugin supplies; the host overwrites the identity
/// fields (`space`, `plugin`, `agent`, `principal`, `traceId`, `observedAt`) from the call.
pub(crate) fn envelope(caller: &Caller<'_>, parts: Parts) -> Envelope {
    Envelope {
        version: 1,
        origin: parts.origin,
        space: caller.space.clone(),
        plugin: None,
        agent: None,
        principal: None,
        session: parts.session,
        trace_id: None,
        observed_at: caller.now.clone(),
        valid_from: None,
        valid_until: None,
        confidence: parts.confidence,
        authority: None,
        sources: Some(vec![Source {
            resource: format!("/{}", parts.doc),
            id: None,
            title: None,
            author: None,
            last_modified: None,
        }]),
        generated: None,
        content_hash: parts.content_hash,
        derived_from: parts.derived_from,
        access: parts.target.access,
        sensitivity: Some(parts.target.sensitivity),
    }
}

/// `dev.umbel/provenance` for the event of a proposal command: the access-bearing fields of the
/// envelope the command wrote.
pub(crate) fn provenance_meta(envelope: &Envelope) -> Value {
    let mut meta = serde_json::Map::new();
    meta.insert(
        "origin".to_owned(),
        serde_json::to_value(envelope.origin).unwrap_or(Value::Null),
    );
    if let Some(session) = &envelope.session {
        meta.insert("session".to_owned(), Value::String(session.clone()));
    }
    if let Some(confidence) = envelope.confidence {
        meta.insert("confidence".to_owned(), json!(confidence));
    }
    if let Some(sources) = &envelope.sources {
        meta.insert(
            "sources".to_owned(),
            serde_json::to_value(sources).unwrap_or(Value::Null),
        );
    }
    if let Some(hash) = &envelope.content_hash {
        meta.insert("contentHash".to_owned(), Value::String(hash.clone()));
    }
    meta.insert("access".to_owned(), json!(envelope.access));
    meta.insert(
        "sensitivity".to_owned(),
        serde_json::to_value(envelope.sensitivity).unwrap_or(Value::Null),
    );
    Value::Object(meta)
}

/// The proposal `id` as the caller may read it, with the record it is stored in. `None` when it
/// is absent or its target is not readable by the caller (one answer for both).
pub(crate) fn get(caller: &Caller<'_>, id: &str) -> Result<Option<(Proposal, Record)>, HostError> {
    let Some(record) = caller.cx.record_get(&caller.space, KIND, id)? else {
        return Ok(None);
    };
    Ok(Proposal::from_value(&record.body).map(|proposal| (proposal, record)))
}

/// Store `proposal` with the envelope `envelope`, compare-and-set against `expect`.
pub(crate) fn save(
    caller: &Caller<'_>,
    proposal: &Proposal,
    envelope: Envelope,
    expect: Expect,
) -> Result<RecordMeta, HostError> {
    let body = proposal.to_value();
    caller
        .cx
        .record_put(&caller.space, KIND, &proposal.id, body, envelope, expect)
}

/// Whether a record body fits the store's cap.
pub(crate) fn fits_record(body: &Value) -> bool {
    canonical_json(body).len() <= MAX_RECORD_BYTES
}

/// The failure for a proposal that is absent or whose target the caller may not read: one code
/// for both, so existence does not leak (and the confirmation never shows what they may not read).
pub(crate) fn not_found() -> Outcome {
    failure(
        "PROPOSAL_NOT_FOUND",
        "no proposal with that id is readable in this space",
        "Check the id with knowledge-proposal-list; a proposal whose target you may not read is reported the same way.",
    )
}

/// The failure for a proposal that is not in a state the command works on.
pub(crate) fn wrong_state(proposal: &Proposal, wanted: &str) -> Outcome {
    failure(
        "PROPOSAL_STATE_INVALID",
        &format!("the proposal is {}; {wanted}", proposal.state.name()),
        "Check the proposal with knowledge-proposal-show.",
    )
}

/// A one-line summary of a proposal: ids, hashes and states, no content.
pub(crate) fn summary(proposal: &Proposal) -> Value {
    json!({
        "id": proposal.id,
        "state": proposal.state.name(),
        "space": proposal.space,
        "area": proposal.area,
        "op": proposal.change.op.name(),
        "doc": proposal.change.doc,
        "changeHash": proposal.change_hash,
        "flags": proposal.flags,
        "proposer": { "kind": proposal.proposer.actor.kind, "principal": proposal.proposer.principal },
        "exception": proposal.exception,
        "createdAt": proposal.created_at,
        "updatedAt": proposal.updated_at,
    })
}
