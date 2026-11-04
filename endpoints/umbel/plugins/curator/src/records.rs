//! The curator's records (phase 4 specification, section 2.3; `curator-record.v1.json`), kept in
//! the instance's own namespace through `records_write` and **per (space, principal)**: a call
//! reads and writes only its effective principal's records, so no caller sees counts, candidates
//! or promotions made under another caller's filter. No record holds memory text, and no envelope
//! of one holds a memory hash.
//!
//! `curator-promote` writes `consent` records; a run (`curator-plan` and `curator-finish`) writes
//! `candidate` records with [`candidate_record`], and its `review`, `run` and `state` records
//! ([`crate::review`], [`crate::state`]). When a source is erased, the candidate keeps no content
//! hash, subject key, reason or sources and is `erased`, and its consent keeps no sources
//! ([`consent_erased_body`]); the change log then forgets the records' earlier hashes.

use serde_json::{Value, json};
use umbel_sdk::{Cx, HostError, Outcome};
use umbel_store::memory::{Millis, format_instant, parse_instant};
use umbel_store::{
    ContentHash, ENVELOPE_VERSION, Envelope, Expect, MemoryClass, Origin, Record, Sensitivity,
};

use crate::evaluate::{Candidate, Status};
use crate::fail;
use crate::settle::Snapshot;

/// The records' version.
pub const VERSION: u32 = 1;
/// A candidate record's kind.
pub const CANDIDATE: &str = "candidate";
/// A consent record's kind.
pub const CONSENT: &str = "consent";
/// A run record's kind.
pub const RUN: &str = "run";
/// A state record's kind.
pub const STATE: &str = "state";
/// A review record's kind.
pub const REVIEW: &str = "review";
/// The most records of one kind a call reads.
pub(crate) const MAX_READ: usize = 5000;
/// A record list page.
const PAGE: u32 = 500;

/// A consent's id (section 2.3): `n-` and the candidate id's hex.
#[must_use]
pub fn consent_id(candidate: &str) -> String {
    format!("n-{}", candidate.strip_prefix("c-").unwrap_or(candidate))
}

/// One source of a candidate record: a memory record id and the version it was read at.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct SourceRef {
    /// The memory record id.
    pub id: String,
    /// Its version.
    pub record_version: u32,
}

/// A candidate as the caller's record holds it: what a run fixed or learned, which the live
/// computation cannot (section 2.3).
#[derive(Debug, Clone, PartialEq)]
pub struct Stored {
    /// The candidate id.
    pub id: String,
    /// The class.
    pub class: MemoryClass,
    /// The status the run recorded.
    pub status: Status,
    /// The snapshot, fixed when it first became ready.
    pub snapshot: Option<Snapshot>,
    /// The conflict set, fixed when it first formed.
    pub conflict_set: Option<String>,
    /// How many times it was drafted.
    pub drafts: u32,
    /// The end of a rejection's quiet period.
    pub quiet_until: Option<Millis>,
    /// The document an applied draft created.
    pub promoted_to: Option<String>,
    /// The record's access set.
    pub access: Vec<String>,
    /// The record's sensitivity.
    pub sensitivity: Sensitivity,
    /// A skip code, or a rejection's reason (an approver's text: content, never shown).
    pub reason: Option<String>,
    /// The sources' content hash; `None` once erased.
    pub content_hash: Option<String>,
    /// The sources at the versions last read; empty once erased.
    pub sources: Vec<SourceRef>,
    /// When a run first recorded it.
    pub first_seen_at: Option<Millis>,
    /// The proposal of the latest draft that may still be open.
    pub proposal: Option<String>,
    /// The stored record's hash, for a compare-and-set write; `None` when built, not read.
    pub record_hash: Option<ContentHash>,
}

fn instant(value: &Value) -> Option<Millis> {
    value.as_str().and_then(|text| parse_instant(text).ok())
}

fn strings(value: &Value) -> Vec<String> {
    value
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

impl Stored {
    /// The candidate record `body` of `space` and `principal`, or `None` when it is not one.
    #[must_use]
    pub fn parse(body: &Value, space: &str, principal: &str) -> Option<Self> {
        if body.get("version")?.as_u64()? != u64::from(VERSION)
            || body.get("kind")?.as_str()? != CANDIDATE
            || body.get("space")?.as_str()? != space
            || body.get("principal")?.as_str()? != principal
        {
            return None;
        }
        let snapshot = match body.get("snapshot") {
            Some(Value::Object(snapshot)) => Some(Snapshot {
                sessions: snapshot.get("sessions")?.as_u64()?,
                principals: snapshot.get("principals")?.as_u64()?,
                authority: umbel_store::Authority::parse(snapshot.get("authority")?.as_str()?)?,
                settled_at: instant(snapshot.get("settledAt")?)?,
            }),
            _ => None,
        };
        Some(Self {
            id: body.get("id")?.as_str()?.to_owned(),
            class: MemoryClass::parse(body.get("class")?.as_str()?)?,
            status: Status::parse(body.get("status")?.as_str()?)?,
            snapshot,
            conflict_set: body
                .get("conflictSet")
                .and_then(Value::as_str)
                .map(str::to_owned),
            drafts: u32::try_from(body.get("drafts")?.as_u64()?).ok()?,
            quiet_until: body.get("quietUntil").and_then(instant),
            promoted_to: body
                .get("promotedTo")
                .and_then(Value::as_str)
                .map(str::to_owned),
            access: strings(body.get("access")?),
            sensitivity: serde_json::from_value(body.get("sensitivity")?.clone()).ok()?,
            reason: body
                .get("reason")
                .and_then(Value::as_str)
                .map(str::to_owned),
            content_hash: body
                .get("contentHash")
                .and_then(Value::as_str)
                .map(str::to_owned),
            sources: body
                .get("sources")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(|item| {
                            Some(SourceRef {
                                id: item.get("id")?.as_str()?.to_owned(),
                                record_version: u32::try_from(item.get("recordVersion")?.as_u64()?)
                                    .ok()?,
                            })
                        })
                        .collect()
                })
                .unwrap_or_default(),
            first_seen_at: body.get("firstSeenAt").and_then(instant),
            proposal: body
                .get("proposal")
                .and_then(Value::as_str)
                .filter(|id| umbel_okf::draft::is_proposal_id(id))
                .map(str::to_owned),
            record_hash: None,
        })
    }

    /// Whether a draft that may be open belongs to this record: a proposal is recorded and the
    /// candidate is drafted, or a run recorded it as about to be submitted (`ready`).
    #[must_use]
    pub fn open_draft(&self) -> Option<&str> {
        matches!(self.status, Status::Drafted | Status::Ready)
            .then_some(self.proposal.as_deref())
            .flatten()
    }
}

/// One source a person consented to widen, at its version and hash.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Consented {
    /// The memory record id.
    pub id: String,
    /// Its version.
    pub record_version: u32,
    /// Its content hash.
    pub content_hash: String,
}

/// A consent record (section 5.2): a person's promotion of their own candidate.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Consent {
    /// `n-` and the candidate's hex.
    pub id: String,
    /// The person, the owner of every source.
    pub by: String,
    /// When.
    pub at: Millis,
    /// Each source and version consented to.
    pub sources: Vec<Consented>,
}

impl Consent {
    /// The consent record `body` of `space` and `principal`, or `None` when it is not one. A
    /// consent whose source was erased keeps no sources and covers nothing, so it reads as none.
    #[must_use]
    pub fn parse(body: &Value, space: &str, principal: &str) -> Option<Self> {
        if body.get("version")?.as_u64()? != u64::from(VERSION)
            || body.get("kind")?.as_str()? != CONSENT
            || body.get("space")?.as_str()? != space
            || body.get("principal")?.as_str()? != principal
            || body.get("erased").is_some()
        {
            return None;
        }
        let mut sources = Vec::new();
        for source in body.get("sources")?.as_array()? {
            sources.push(Consented {
                id: source.get("id")?.as_str()?.to_owned(),
                record_version: u32::try_from(source.get("recordVersion")?.as_u64()?).ok()?,
                content_hash: source.get("contentHash")?.as_str()?.to_owned(),
            });
        }
        Some(Self {
            id: body.get("id")?.as_str()?.to_owned(),
            by: body.get("by")?.as_str()?.to_owned(),
            at: instant(body.get("at")?)?,
            sources,
        })
    }

    /// Whether this consent covers exactly `candidate`'s sources, at their versions and hash, and
    /// was given by `principal`, the owner of every one of them.
    #[must_use]
    pub fn covers(&self, candidate: &Candidate, principal: &str) -> bool {
        self.id == consent_id(&candidate.id)
            && self.by == principal
            && self.sources.len() == candidate.sources.len()
            && self.sources.iter().zip(&candidate.sources).all(|(c, s)| {
                c.id == s.id
                    && c.record_version == s.record_version
                    && c.content_hash == s.content_hash.as_str()
                    && s.scope.principal == principal
            })
    }
}

/// What a candidate record keeps beyond the live computation: when it was first seen, the
/// proposal of a draft that may be open, and a rejection's reason.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Kept {
    /// When a run first recorded the candidate.
    pub first_seen_at: Millis,
    /// The proposal of the latest draft that may still be open.
    pub proposal: Option<String>,
    /// A rejection's reason, kept while the candidate is `rejected`.
    pub rejected: Option<String>,
}

/// The body of `candidate`'s record for `space` and `principal` (section 2.3), first seen at
/// `first_seen_at`, with no open draft. It holds ids, versions, counts and hashes, never memory
/// text.
#[must_use]
pub fn candidate_body(
    candidate: &Candidate,
    space: &str,
    principal: &str,
    first_seen_at: Millis,
) -> Value {
    candidate_record(
        candidate,
        space,
        principal,
        &Kept {
            first_seen_at,
            ..Kept::default()
        },
    )
}

/// The body of `candidate`'s record for `space` and `principal` with what `kept` holds. An erased
/// candidate keeps no content hash, subject key, sources or reason; a rejected one keeps the
/// approver's reason (content: the record is its principal's alone to read, and the reason is
/// never shown).
#[must_use]
pub fn candidate_record(candidate: &Candidate, space: &str, principal: &str, kept: &Kept) -> Value {
    let mut body = json!({
        "version": VERSION,
        "kind": CANDIDATE,
        "id": candidate.id,
        "space": space,
        "principal": principal,
        "access": candidate.access,
        "class": candidate.class.as_str(),
        "snapshot": candidate.snapshot.map(|s| json!({
            "sessions": s.sessions,
            "principals": s.principals,
            "authority": s.authority.as_str(),
            "settledAt": format_instant(s.settled_at),
        })),
        "sensitivity": candidate.sensitivity,
        "status": candidate.status.as_str(),
        "drafts": candidate.drafts,
        "firstSeenAt": format_instant(kept.first_seen_at),
        "promotedTo": candidate.promoted_to,
        "conflictSet": candidate.conflict_set,
        "quietUntil": candidate.quiet_until.map(format_instant),
        "proposal": kept.proposal,
    });
    if candidate.status != Status::Erased {
        body["contentHash"] = json!(candidate.content_hash);
        body["subjectKey"] = json!(candidate.subject_key);
        body["sources"] = json!(
            candidate
                .sources
                .iter()
                .map(|s| json!({ "id": s.id, "recordVersion": s.record_version }))
                .collect::<Vec<_>>()
        );
        body["reason"] = match candidate.status {
            Status::Rejected => json!(kept.rejected.as_deref().unwrap_or("rejected")),
            _ => json!(candidate.reason.map(|reason| reason.as_str())),
        };
    }
    body
}

/// `stored`'s record once a source was erased (section 9.1, step 1's amendment 12): no content
/// hash, subject key, reason or sources; `erased`, never drafted again. What stays is content-free:
/// the id, class, counts, access, the draft count and proposal, and the outcome fields.
#[must_use]
pub fn erased_body(stored: &Stored, space: &str, principal: &str, now: Millis) -> Value {
    json!({
        "version": VERSION,
        "kind": CANDIDATE,
        "id": stored.id,
        "space": space,
        "principal": principal,
        "access": stored.access,
        "class": stored.class.as_str(),
        "snapshot": stored.snapshot.map(|s| json!({
            "sessions": s.sessions,
            "principals": s.principals,
            "authority": s.authority.as_str(),
            "settledAt": format_instant(s.settled_at),
        })),
        "sensitivity": stored.sensitivity,
        "status": Status::Erased.as_str(),
        "drafts": stored.drafts,
        "firstSeenAt": format_instant(stored.first_seen_at.unwrap_or(now)),
        "promotedTo": stored.promoted_to,
        "conflictSet": stored.conflict_set,
        "quietUntil": null,
        "proposal": stored.proposal,
    })
}

/// The body of a consent record (section 5.2): `by` the owner, at `at`, for each source.
#[must_use]
pub fn consent_body(consent: &Consent, space: &str, principal: &str) -> Value {
    json!({
        "version": VERSION,
        "kind": CONSENT,
        "id": consent.id,
        "space": space,
        "principal": principal,
        "access": [format!("principal:{principal}")],
        "by": consent.by,
        "at": format_instant(consent.at),
        "sources": consent.sources.iter().map(|s| json!({
            "id": s.id,
            "recordVersion": s.record_version,
            "contentHash": s.content_hash,
        })).collect::<Vec<_>>(),
    })
}

/// A consent record once one of its sources was erased: who consented and when, and no sources
/// or hashes, so it covers nothing (step 1's amendment 12).
#[must_use]
pub fn consent_erased_body(consent: &Value, space: &str, principal: &str) -> Value {
    json!({
        "version": VERSION,
        "kind": CONSENT,
        "id": consent.get("id").cloned().unwrap_or(Value::Null),
        "space": space,
        "principal": principal,
        "access": [format!("principal:{principal}")],
        "by": consent.get("by").cloned().unwrap_or(Value::Null),
        "at": consent.get("at").cloned().unwrap_or(Value::Null),
        "erased": true,
    })
}

/// `principal:<principal>`, the access set of every curator record but a candidate.
pub(crate) fn own(principal: &str) -> Vec<String> {
    vec![format!("principal:{principal}")]
}

/// Write a curator record of `kind` in the instance's own namespace, compare-and-set against
/// `expect`, with an envelope that holds nothing derived from memory.
pub(crate) fn put(
    cx: &Cx,
    space: &str,
    now: Millis,
    (kind, id): (&str, &str),
    body: Value,
    (access, sensitivity): (Vec<String>, Sensitivity),
    expect: Expect,
) -> Result<(), Outcome> {
    let envelope = envelope(space, now, Origin::AgentInferred, access, sensitivity);
    cx.record_put(space, kind, id, body, envelope, expect)
        .map(|_| ())
        .map_err(|error| fail::host(&error))
}

/// `expect` for a record read with `hash`: compare-and-set, or absent when it was never stored.
pub(crate) fn expect(hash: Option<&ContentHash>) -> Expect {
    hash.map_or(Expect::Absent, |hash| Expect::Hash(hash.clone()))
}

/// The store envelope of a curator record: the record's access set and sensitivity, and nothing
/// derived from memory (no `contentHash`, `derivedFrom` or `sources`). The host fills the
/// identity fields from the call.
pub(crate) fn envelope(
    space: &str,
    now: Millis,
    origin: Origin,
    access: Vec<String>,
    sensitivity: Sensitivity,
) -> Envelope {
    Envelope {
        version: ENVELOPE_VERSION,
        origin,
        space: space.to_owned(),
        plugin: None,
        agent: None,
        principal: None,
        session: None,
        trace_id: None,
        observed_at: format_instant(now),
        valid_from: None,
        valid_until: None,
        confidence: None,
        authority: None,
        sources: None,
        generated: None,
        content_hash: None,
        derived_from: None,
        access,
        sensitivity: Some(sensitivity),
        redactions: None,
        constraints: None,
        confirmation: None,
    }
}

/// Every record of `kind` the caller can read in `space`, at most [`MAX_READ`]. A space with no
/// records yet reads as none.
pub(crate) fn list(cx: &Cx, space: &str, kind: &str) -> Result<Vec<Record>, Outcome> {
    let mut out = Vec::new();
    let mut after: Option<String> = None;
    loop {
        let page = match cx.record_list(space, kind, after.as_deref(), PAGE) {
            Ok(page) => page,
            Err(HostError::NotFound(_)) => return Ok(out),
            Err(error) => return Err(fail::host(&error)),
        };
        out.extend(page.items);
        match page.next {
            Some(next) if out.len() < MAX_READ => after = Some(next),
            _ => break,
        }
    }
    out.truncate(MAX_READ);
    Ok(out)
}

/// The caller's candidate records in `space`, each with its record's hash.
pub(crate) fn stored(cx: &Cx, space: &str, principal: &str) -> Result<Vec<Stored>, Outcome> {
    Ok(list(cx, space, CANDIDATE)?
        .iter()
        .filter_map(|record| {
            Stored::parse(&record.body, space, principal).map(|mut stored| {
                stored.record_hash = Some(record.content_hash.clone());
                stored
            })
        })
        .collect())
}

/// One record of the caller's in `space`, or `None` when absent or not the caller's.
pub(crate) fn get(
    cx: &Cx,
    space: &str,
    principal: &str,
    kind: &str,
    id: &str,
) -> Result<Option<Record>, Outcome> {
    let record = match cx.record_get(space, kind, id) {
        Ok(record) => record,
        Err(HostError::NotFound(_)) => None,
        Err(error) => return Err(fail::host(&error)),
    };
    Ok(record.filter(|record| {
        record.body.get("principal").and_then(Value::as_str) == Some(principal)
            && record.body.get("space").and_then(Value::as_str) == Some(space)
    }))
}

/// The caller's consent records in `space`.
pub(crate) fn consents(cx: &Cx, space: &str, principal: &str) -> Result<Vec<Consent>, Outcome> {
    Ok(list(cx, space, CONSENT)?
        .iter()
        .filter_map(|record| Consent::parse(&record.body, space, principal))
        .collect())
}

/// The caller's consent record for `candidate`, with the record it is stored in.
pub(crate) fn consent(
    cx: &Cx,
    space: &str,
    principal: &str,
    candidate: &str,
) -> Result<Option<(Consent, Record)>, Outcome> {
    let record = match cx.record_get(space, CONSENT, &consent_id(candidate)) {
        Ok(record) => record,
        Err(HostError::NotFound(_)) => None,
        Err(error) => return Err(fail::host(&error)),
    };
    Ok(record.and_then(|record| {
        Consent::parse(&record.body, space, principal).map(|consent| (consent, record))
    }))
}
