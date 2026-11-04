//! The curator's records (phase 4 specification, section 2.3; `curator-record.v1.json`), kept in
//! the instance's own namespace through `records_write` and **per (space, principal)**: a call
//! reads and writes only its effective principal's records, so no caller sees counts, candidates
//! or promotions made under another caller's filter. No record holds memory text, and no envelope
//! of one holds a memory hash.
//!
//! This step writes `consent` records (`curator-promote`) and reads `candidate` and `consent`
//! records; step 5's run writes `candidate`, `run` and `state` records with [`candidate_body`] and
//! its own.

use serde_json::{Value, json};
use umbel_sdk::{Cx, HostError, Outcome};
use umbel_store::memory::{Millis, format_instant, parse_instant};
use umbel_store::{ENVELOPE_VERSION, Envelope, MemoryClass, Origin, Record, Sensitivity};

use crate::evaluate::{Candidate, Status};
use crate::fail;
use crate::settle::Snapshot;

/// The records' version.
pub const VERSION: u32 = 1;
/// A candidate record's kind.
pub const CANDIDATE: &str = "candidate";
/// A consent record's kind.
pub const CONSENT: &str = "consent";
/// The most records of one kind a call reads.
const MAX_READ: usize = 5000;
/// A record list page.
const PAGE: u32 = 500;

/// A consent's id (section 2.3): `n-` and the candidate id's hex.
#[must_use]
pub fn consent_id(candidate: &str) -> String {
    format!("n-{}", candidate.strip_prefix("c-").unwrap_or(candidate))
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
        })
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
    /// The consent record `body` of `space` and `principal`, or `None` when it is not one.
    #[must_use]
    pub fn parse(body: &Value, space: &str, principal: &str) -> Option<Self> {
        if body.get("version")?.as_u64()? != u64::from(VERSION)
            || body.get("kind")?.as_str()? != CONSENT
            || body.get("space")?.as_str()? != space
            || body.get("principal")?.as_str()? != principal
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

/// The body of `candidate`'s record for `space` and `principal` (section 2.3), first seen at
/// `first_seen_at`. It holds ids, versions, counts and hashes, never memory text.
#[must_use]
pub fn candidate_body(
    candidate: &Candidate,
    space: &str,
    principal: &str,
    first_seen_at: Millis,
) -> Value {
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
        "firstSeenAt": format_instant(first_seen_at),
        "promotedTo": candidate.promoted_to,
        "conflictSet": candidate.conflict_set,
        "quietUntil": candidate.quiet_until.map(format_instant),
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
        body["reason"] = json!(candidate.reason.map(|reason| reason.as_str()));
    }
    body
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
fn list(cx: &Cx, space: &str, kind: &str) -> Result<Vec<Record>, Outcome> {
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

/// The caller's candidate records in `space`.
pub(crate) fn stored(cx: &Cx, space: &str, principal: &str) -> Result<Vec<Stored>, Outcome> {
    Ok(list(cx, space, CANDIDATE)?
        .iter()
        .filter_map(|record| Stored::parse(&record.body, space, principal))
        .collect())
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
