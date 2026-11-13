//! The four declared kinds (specification, section 4): their bodies, read and written through
//! the host's record lane. The host owns each record's access set (D169) and every wording's
//! standing (D161); the plugin writes roles and states, which are its own facts.

use serde_json::{Value, json};
use umbel_sdk::{Cx, HostError, Outcome};
use umbel_store::lane::LaneRecord;
use umbel_store::memory::format_instant;
use umbel_store::{
    ContentHash, ENVELOPE_VERSION, Envelope, Expect, Origin, RecordMeta, Sensitivity,
};

use crate::{Call, fail};

/// A standing kind: one wording of an idea.
pub(crate) const WORDING: &str = "wording";
/// An idea.
pub(crate) const IDEA: &str = "idea";
/// A review.
pub(crate) const REVIEW: &str = "review";
/// A proposal staged in a review.
pub(crate) const PROPOSAL: &str = "proposal";

/// The prefix of an idea's id.
pub(crate) const IDEA_PREFIX: &str = "idea-";
/// The prefix of a review's id.
pub(crate) const REVIEW_PREFIX: &str = "rev-";
/// The prefix of a proposal's id.
pub(crate) const PROPOSAL_PREFIX: &str = "prp-";
/// The most wordings an idea has: an archive past it is refused, and `ideas-open` reads no more.
pub(crate) const MAX_WORDINGS: u64 = 1000;

/// The most digests an idea's `seen` keeps.
pub(crate) const SEEN_MAX: usize = 64;

/// The call's clock as RFC 3339 with milliseconds.
pub(crate) fn now(cx: &Cx) -> Result<String, Outcome> {
    cx.now_ms()
        .map(format_instant)
        .map_err(|error| fail::host(&error))
}

/// The envelope a put sends. The host fills the identity fields and the access set, whatever is
/// sent here; the origin and sensitivity are the plugin's.
pub(crate) fn envelope(space: &str, observed_at: &str, origin: Origin) -> Envelope {
    Envelope {
        version: ENVELOPE_VERSION,
        origin,
        space: space.to_owned(),
        plugin: None,
        agent: None,
        principal: None,
        session: None,
        trace_id: None,
        observed_at: observed_at.to_owned(),
        valid_from: None,
        valid_until: None,
        confidence: None,
        authority: None,
        sources: None,
        generated: None,
        content_hash: None,
        derived_from: None,
        access: vec!["space".to_owned()],
        sensitivity: Some(Sensitivity::Internal),
        redactions: None,
        constraints: None,
        confirmation: None,
        delegation_chain: None,
    }
}

/// Put one record of a declared kind.
#[allow(clippy::too_many_arguments)]
pub(crate) fn put(
    cx: &Cx,
    call: &Call,
    kind: &str,
    id: &str,
    body: Value,
    expect: Expect,
    origin: Origin,
    observed_at: &str,
) -> Result<RecordMeta, HostError> {
    cx.record_put(
        &call.space,
        kind,
        id,
        body,
        envelope(&call.space, observed_at, origin),
        expect,
    )
}

/// One record of a declared kind as the caller may read it, with its label.
pub(crate) fn read(
    cx: &Cx,
    call: &Call,
    kind: &str,
    id: &str,
) -> Result<Option<LaneRecord>, HostError> {
    cx.record_read(&call.space, kind, id, &[], false)
}

/// A wording's id: `<idea id>.<n>`.
pub(crate) fn wording_id(idea: &str, n: u64) -> String {
    format!("{idea}.{n}")
}

/// The idea and `n` of a wording's id.
pub(crate) fn split_wording_id(id: &str) -> Option<(&str, u64)> {
    let (idea, n) = id.rsplit_once('.')?;
    Some((idea, n.parse().ok()?))
}

/// The origin of a wording: what the caller says of who spoke it. A claim; it decides nothing.
pub(crate) fn origin_of(said: &str) -> Origin {
    if said == "person" {
        Origin::UserStated
    } else {
        Origin::AgentInferred
    }
}

/// An idea record's body (4.2).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Idea {
    pub(crate) id: String,
    pub(crate) state: String,
    pub(crate) held: u64,
    pub(crate) wordings: u64,
    pub(crate) into: Option<String>,
    pub(crate) sightings: u64,
    pub(crate) seen: Vec<String>,
    pub(crate) staged: Option<String>,
    pub(crate) created_at: String,
}

impl Idea {
    /// A new live idea with its first wording held.
    pub(crate) fn new(id: &str, sightings: u64, created_at: &str) -> Self {
        Self {
            id: id.to_owned(),
            state: "live".to_owned(),
            held: 1,
            wordings: 1,
            into: None,
            sightings,
            seen: Vec::new(),
            staged: None,
            created_at: created_at.to_owned(),
        }
    }

    pub(crate) fn to_json(&self) -> Value {
        json!({
            "id": self.id,
            "state": self.state,
            "held": self.held,
            "wordings": self.wordings,
            "into": self.into,
            "sightings": self.sightings,
            "seen": self.seen,
            "staged": self.staged,
            "createdAt": self.created_at,
        })
    }

    pub(crate) fn parse(body: &Value) -> Option<Self> {
        Some(Self {
            id: body.get("id")?.as_str()?.to_owned(),
            state: body.get("state")?.as_str()?.to_owned(),
            held: body.get("held")?.as_u64()?,
            wordings: body.get("wordings")?.as_u64()?,
            into: body.get("into").and_then(Value::as_str).map(str::to_owned),
            sightings: body.get("sightings")?.as_u64()?,
            seen: body
                .get("seen")
                .and_then(Value::as_array)
                .map(|seen| {
                    seen.iter()
                        .filter_map(Value::as_str)
                        .map(str::to_owned)
                        .collect()
                })
                .unwrap_or_default(),
            staged: body
                .get("staged")
                .and_then(Value::as_str)
                .map(str::to_owned),
            created_at: body
                .get("createdAt")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
        })
    }

    /// The id of the wording the idea resolves to.
    pub(crate) fn held_id(&self) -> String {
        wording_id(&self.id, self.held)
    }
}

/// An idea record as read: its body and the hash a compare-and-set write names.
#[derive(Debug, Clone)]
pub(crate) struct StoredIdea {
    pub(crate) idea: Idea,
    pub(crate) hash: ContentHash,
}

/// Read an idea record; `None` when absent, unreadable or not an idea body.
pub(crate) fn read_idea(cx: &Cx, call: &Call, id: &str) -> Result<Option<StoredIdea>, HostError> {
    Ok(read(cx, call, IDEA, id)?.and_then(|found| {
        Idea::parse(&found.record.body).map(|idea| StoredIdea {
            idea,
            hash: found.record.content_hash,
        })
    }))
}

/// A wording record's body (4.1).
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Wording {
    pub(crate) idea: String,
    pub(crate) n: u64,
    pub(crate) statement: String,
    pub(crate) kind: String,
    pub(crate) tags: Vec<String>,
    pub(crate) role: String,
    pub(crate) said: String,
    pub(crate) captured_at: String,
    pub(crate) offered: Value,
    pub(crate) proposal: Option<String>,
}

impl Wording {
    pub(crate) fn to_json(&self) -> Value {
        json!({
            "idea": self.idea,
            "n": self.n,
            "statement": self.statement,
            "type": self.kind,
            "tags": self.tags,
            "role": self.role,
            "said": self.said,
            "capturedAt": self.captured_at,
            "offered": self.offered,
            "proposal": self.proposal,
        })
    }

    pub(crate) fn parse(body: &Value) -> Option<Self> {
        Some(Self {
            idea: body.get("idea")?.as_str()?.to_owned(),
            n: body.get("n")?.as_u64()?,
            statement: body.get("statement")?.as_str()?.to_owned(),
            kind: body.get("type")?.as_str()?.to_owned(),
            tags: body
                .get("tags")
                .and_then(Value::as_array)
                .map(|tags| {
                    tags.iter()
                        .filter_map(Value::as_str)
                        .map(str::to_owned)
                        .collect()
                })
                .unwrap_or_default(),
            role: body.get("role")?.as_str()?.to_owned(),
            said: body
                .get("said")
                .and_then(Value::as_str)
                .unwrap_or("unknown")
                .to_owned(),
            captured_at: body
                .get("capturedAt")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
            offered: body.get("offered").cloned().unwrap_or_else(|| json!([])),
            proposal: body
                .get("proposal")
                .and_then(Value::as_str)
                .map(str::to_owned),
        })
    }
}

/// A put that may find its record already written: `Ok(true)` when it wrote, `Ok(false)` when
/// a record was there (`Expect::Absent` met a conflict).
pub(crate) fn put_absent(
    cx: &Cx,
    call: &Call,
    kind: &str,
    id: &str,
    body: Value,
    origin: Origin,
    observed_at: &str,
) -> Result<bool, HostError> {
    match put(
        cx,
        call,
        kind,
        id,
        body,
        Expect::Absent,
        origin,
        observed_at,
    ) {
        Ok(_) => Ok(true),
        Err(HostError::Conflict { .. }) => Ok(false),
        Err(error) => Err(error),
    }
}
