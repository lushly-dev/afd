//! Re-verification and inconsistencies (phase 4 specification, section 6; D95): the documents the
//! caller can read that a person should verify again, or deprecate for the successor they name.
//!
//! **The curator never attests.** A person approving a `verify` proposal is the verification
//! (phase 2's `verified` entry is the deciding actor); a `deprecate` proposal is decided the same
//! way. A readable markdown document is **due** when it has `stale_after`, `now >= stale_after -
//! lead_days`, it is not deprecated, and no open proposal of the caller's targets it. It is drafted
//! only when its checks pass, each a `{ kind: "text", ref: "check:<name>", excerpt: "pass" }`
//! evidence entry:
//! - `links-resolve`: no `broken-links` flag;
//! - `sources-unchanged`: every frontmatter `sources` entry that names a document of the space with
//!   a `contentHash`, and every `document` entry of its envelope's `derivedFrom`, still has that hash;
//! - `not-flagged`: none of the content scan's flags (`hidden-text`, `instruction-like`,
//!   `schema-invalid`).
//!
//! A failed check is reported (`check-failed` and the check), not proposed. A document that is not
//! deprecated and names a `superseded_by` that resolves to a readable document that is not itself
//! deprecated gets a `deprecate` proposal with `supersededBy`, the value as written; a deprecated
//! document whose successor does not resolve is reported (`successor-missing`).
//!
//! What the caller drafted is kept in a `review` record per document (`v-` and 20 hex of SHA-256
//! of `<space>\0<principal>\0<document id>`): the op, the base hash, the proposal and its outcome,
//! so an open draft is not drafted again, a rejected one stays quiet for `quiet_days`, and a
//! refused one (another proposal is open on the document) waits `every_hours`. A document read in
//! a run is due again only after its draft is decided.
//!
//! The documents are read under the caller's reader filter through `documents`, from a rotating
//! cursor (`reviewAfter`) at most [`MAX_DOCUMENTS`] a run, so every document is reached across runs.

use std::collections::BTreeMap;

use serde_json::{Value, json};
use umbel_okf::links::{self, Target};
use umbel_sdk::{Cx, HostError, Outcome};
use umbel_store::memory::{DAY_MS, HOUR_MS, Millis, format_instant, parse_instant};
use umbel_store::{ContentHash, Document, Flag, ListQuery, Sensitivity, Status as DocStatus};

use crate::fail;
use crate::pack::Settle;
use crate::records::{self, REVIEW, VERSION};

/// The most documents one run reads in full.
pub const MAX_DOCUMENTS: usize = 2000;
/// A document list page.
const PAGE: u32 = 250;
/// The checks a verify draft cites, in order.
pub const CHECKS: [&str; 3] = ["links-resolve", "sources-unchanged", "not-flagged"];

/// A review's id: `v-` and 20 hex of SHA-256 of `<space>\0<principal>\0<document id>`.
#[must_use]
pub fn review_id(space: &str, principal: &str, doc: &str) -> String {
    let hash = ContentHash::of(format!("{space}\0{principal}\0{doc}").as_bytes());
    let hex = hash.as_str().strip_prefix("sha256:").unwrap_or_default();
    format!("v-{}", &hex[..20])
}

/// What a review drafts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Op {
    /// Section 6.1.
    Verify,
    /// Section 6.2.
    Deprecate,
}

impl Op {
    /// The proposal op.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Verify => "verify",
            Self::Deprecate => "deprecate",
        }
    }

    fn parse(text: &str) -> Option<Self> {
        match text {
            "verify" => Some(Self::Verify),
            "deprecate" => Some(Self::Deprecate),
            _ => None,
        }
    }
}

/// A review's status.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReviewStatus {
    /// A run recorded it as about to be submitted.
    Ready,
    /// Its proposal is open.
    Drafted,
    /// A person rejected it; quiet until `quietUntil`.
    Rejected,
    /// A person applied it.
    Applied,
    /// The batch refused it (another proposal is open on the document); retried after
    /// `quietUntil`.
    Refused,
    /// Its draft was withdrawn: the document changed.
    Withdrawn,
}

impl ReviewStatus {
    /// The record's spelling.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ready => "ready",
            Self::Drafted => "drafted",
            Self::Rejected => "rejected",
            Self::Applied => "applied",
            Self::Refused => "refused",
            Self::Withdrawn => "withdrawn",
        }
    }

    fn parse(text: &str) -> Option<Self> {
        [
            Self::Ready,
            Self::Drafted,
            Self::Rejected,
            Self::Applied,
            Self::Refused,
            Self::Withdrawn,
        ]
        .into_iter()
        .find(|status| status.as_str() == text)
    }
}

/// A review record (section 2.3 as step 5 amends it): one document's drafts by the caller.
#[derive(Debug, Clone, PartialEq)]
pub struct Review {
    /// `v-` and 20 hex digits.
    pub id: String,
    /// The document.
    pub doc: String,
    /// What was drafted.
    pub op: Op,
    /// The document's hash the draft was made against.
    pub base_hash: String,
    /// The status.
    pub status: ReviewStatus,
    /// How many keys were used.
    pub drafts: u32,
    /// The latest draft's proposal while it may be open.
    pub proposal: Option<String>,
    /// When the latest draft was first planned: a verify's next `stale_after` counts from it, so a
    /// rerun renders the same draft.
    pub at: Millis,
    /// Not drafted again before this.
    pub quiet_until: Option<Millis>,
    /// The stored record's hash.
    pub record_hash: Option<ContentHash>,
}

impl Review {
    /// The review record `body` of `space` and `principal`, or `None` when it is not one.
    #[must_use]
    pub fn parse(body: &Value, space: &str, principal: &str) -> Option<Self> {
        if body.get("version")?.as_u64()? != u64::from(VERSION)
            || body.get("kind")?.as_str()? != REVIEW
            || body.get("space")?.as_str()? != space
            || body.get("principal")?.as_str()? != principal
        {
            return None;
        }
        let instant = |key: &str| {
            body.get(key)
                .and_then(Value::as_str)
                .and_then(|t| parse_instant(t).ok())
        };
        Some(Self {
            id: body.get("id")?.as_str()?.to_owned(),
            doc: body.get("doc")?.as_str()?.to_owned(),
            op: Op::parse(body.get("op")?.as_str()?)?,
            base_hash: body.get("baseHash")?.as_str()?.to_owned(),
            status: ReviewStatus::parse(body.get("status")?.as_str()?)?,
            drafts: u32::try_from(body.get("drafts")?.as_u64()?).ok()?,
            proposal: body
                .get("proposal")
                .and_then(Value::as_str)
                .map(str::to_owned),
            at: instant("at")?,
            quiet_until: instant("quietUntil"),
            record_hash: None,
        })
    }

    /// The record's body.
    #[must_use]
    pub fn body(&self, space: &str, principal: &str) -> Value {
        json!({
            "version": VERSION,
            "kind": REVIEW,
            "id": self.id,
            "space": space,
            "principal": principal,
            "access": records::own(principal),
            "doc": self.doc,
            "op": self.op.as_str(),
            "baseHash": self.base_hash,
            "status": self.status.as_str(),
            "drafts": self.drafts,
            "proposal": self.proposal,
            "at": format_instant(self.at),
            "quietUntil": self.quiet_until.map(format_instant),
        })
    }

    /// The proposal of a draft that may be open.
    #[must_use]
    pub fn open_draft(&self) -> Option<&str> {
        matches!(self.status, ReviewStatus::Ready | ReviewStatus::Drafted)
            .then_some(self.proposal.as_deref())
            .flatten()
    }

    /// Write it, compare-and-set against what was read.
    pub(crate) fn save(
        &self,
        cx: &Cx,
        space: &str,
        principal: &str,
        now: Millis,
    ) -> Result<(), Outcome> {
        records::put(
            cx,
            space,
            now,
            (REVIEW, &self.id),
            self.body(space, principal),
            (records::own(principal), Sensitivity::Internal),
            records::expect(self.record_hash.as_ref()),
        )
    }
}

/// The caller's review records in `space`, by document.
pub(crate) fn stored(
    cx: &Cx,
    space: &str,
    principal: &str,
) -> Result<BTreeMap<String, Review>, Outcome> {
    Ok(records::list(cx, space, REVIEW)?
        .into_iter()
        .filter_map(|record| {
            Review::parse(&record.body, space, principal).map(|mut review| {
                review.record_hash = Some(record.content_hash);
                (review.doc.clone(), review)
            })
        })
        .collect())
}

/// What re-verification reads of one document.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Facts {
    /// Its id.
    pub id: String,
    /// Its content hash.
    pub hash: String,
    /// Whether it is deprecated.
    pub deprecated: bool,
    /// `stale_after` as written.
    pub stale_after: Option<String>,
    /// `superseded_by` as written.
    pub superseded_by: Option<String>,
    /// The `broken-links` flag.
    pub broken_links: bool,
    /// A content scan flag.
    pub flagged: bool,
    /// The documents it cites with a hash: `(document id, hash)`, the reference resolved.
    pub sources: Vec<(Option<String>, String)>,
}

/// The successor a document names, as the caller reads it: its id, hash and whether it is itself
/// deprecated.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Successor {
    /// Its id.
    pub id: String,
    /// Its content hash.
    pub hash: String,
    /// Whether it is deprecated.
    pub deprecated: bool,
}

/// What section 6 makes of one document.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Finding {
    /// Nothing to propose or report.
    Nothing,
    /// Due, and every check passes: a verify draft.
    Verify,
    /// Due, and these checks fail: reported.
    CheckFailed(Vec<&'static str>),
    /// Not deprecated, naming a successor that resolves: a deprecate draft.
    Deprecate(Successor),
    /// Deprecated, with no successor that resolves: reported.
    SuccessorMissing,
}

impl Facts {
    /// The facts of `document`, with `collections` the space's collection ids for resolving its
    /// references.
    #[must_use]
    pub fn of(document: &Document, collections: &[String]) -> Self {
        let mut sources = Vec::new();
        if let Some(entries) = document
            .frontmatter
            .get("sources")
            .and_then(Value::as_array)
        {
            for entry in entries {
                let (Some(resource), Some(hash)) = (
                    entry.get("resource").and_then(Value::as_str),
                    entry.get("contentHash").and_then(Value::as_str),
                ) else {
                    continue;
                };
                let id = match links::resolve(resource, &document.id, collections) {
                    Target::Document { id, .. } => Some(id),
                    _ => None,
                };
                sources.push((id, hash.to_owned()));
            }
        }
        for derived in document.envelope.derived_from.iter().flatten() {
            if derived.kind == "document" {
                sources.push((Some(derived.id.clone()), derived.content_hash.clone()));
            }
        }
        Self {
            id: document.id.clone(),
            hash: document.content_hash.as_str().to_owned(),
            deprecated: document.status == DocStatus::Deprecated,
            stale_after: document.stale_after.clone(),
            superseded_by: document.superseded_by.clone(),
            broken_links: document.flags.contains(&Flag::BrokenLinks),
            flagged: document.flags.iter().any(|flag| {
                matches!(
                    flag,
                    Flag::HiddenText | Flag::InstructionLike | Flag::SchemaInvalid
                )
            }),
            sources,
        }
    }
}

/// What section 6 makes of `facts` at `now`: `successor` the readable successor its
/// `superseded_by` resolves to, and `current` each cited document's current hash as the caller
/// reads it.
#[must_use]
pub fn assess(
    facts: &Facts,
    now: Millis,
    settle: &Settle,
    successor: Option<&Successor>,
    current: impl Fn(&str) -> Option<String>,
) -> Finding {
    if facts.deprecated {
        return if successor.is_some() {
            Finding::Nothing
        } else {
            Finding::SuccessorMissing
        };
    }
    if facts.superseded_by.is_some()
        && let Some(successor) = successor.filter(|s| !s.deprecated)
    {
        return Finding::Deprecate(successor.clone());
    }
    // Due when `now >= stale_after - lead_days`, that is, stale at `now + lead_days`; a document
    // without a `stale_after` that reads is never due.
    let lead = Millis::from(settle.reverify.lead_days) * DAY_MS;
    if !umbel_okf::is_stale(facts.stale_after.as_deref(), now.saturating_add(lead)) {
        return Finding::Nothing;
    }
    let mut failed = Vec::new();
    if facts.broken_links {
        failed.push(CHECKS[0]);
    }
    if facts.sources.iter().any(|(id, hash)| {
        id.as_deref()
            .and_then(&current)
            .is_none_or(|now| now != *hash)
    }) {
        failed.push(CHECKS[1]);
    }
    if facts.flagged {
        failed.push(CHECKS[2]);
    }
    if failed.is_empty() {
        Finding::Verify
    } else {
        Finding::CheckFailed(failed)
    }
}

/// The `knowledge-propose-batch` item of `review` for `facts` by the drafter `instance`.
#[must_use]
pub fn item(
    review: &Review,
    facts: &Facts,
    finding: &Finding,
    instance: &str,
    settle: &Settle,
    key: u32,
) -> Option<Value> {
    let idempotency_key = format!("{instance}/{}/{key}", review.id);
    let (change, rationale, evidence) = match finding {
        Finding::Verify => {
            let next = review
                .at
                .saturating_add(Millis::from(settle.reverify.every_days) * DAY_MS);
            (
                json!({
                    "op": "verify",
                    "doc": facts.id,
                    "baseHash": facts.hash,
                    "verification": { "staleAfter": format_instant(next) },
                }),
                format!(
                    "Due for re-verification: its stale_after falls within {} days. The checks links-resolve, sources-unchanged and not-flagged passed. Approving records you as having verified the document as it stands, and sets its next stale_after {} days on.",
                    settle.reverify.lead_days, settle.reverify.every_days
                ),
                CHECKS
                    .iter()
                    .map(|check| json!({ "kind": "text", "ref": format!("check:{check}"), "excerpt": "pass" }))
                    .collect::<Vec<_>>(),
            )
        }
        Finding::Deprecate(successor) => (
            json!({
                "op": "deprecate",
                "doc": facts.id,
                "baseHash": facts.hash,
                "supersededBy": facts.superseded_by,
            }),
            "The document names a successor in superseded_by that resolves to a readable document that is not deprecated. Approving marks it deprecated, pointing to that successor.".to_owned(),
            vec![json!({ "kind": "document", "ref": successor.id, "contentHash": successor.hash })],
        ),
        _ => return None,
    };
    Some(json!({
        "idempotency_key": idempotency_key,
        "change": change,
        "rationale": rationale,
        "evidence": evidence,
        "drafter": { "mode": "scheduled" },
    }))
}

/// A refused review waits this long before it is tried again.
#[must_use]
pub fn refused_quiet(settle: &Settle) -> Millis {
    Millis::from(settle.every_hours) * HOUR_MS
}

/// One document a run read, with what it makes of it.
#[derive(Debug, Clone)]
pub(crate) struct Read {
    pub(crate) facts: Facts,
    pub(crate) finding: Finding,
}

/// What a run's document scan read.
#[derive(Debug, Clone, Default)]
pub(crate) struct Scanned {
    /// The documents read, in id order.
    pub(crate) documents: Vec<Read>,
    /// Where the next run continues; `None` from the first.
    pub(crate) next: Option<String>,
}

/// A document as the caller reads it, or `None`.
pub(crate) fn document(cx: &Cx, space: &str, id: &str) -> Result<Option<Document>, Outcome> {
    match cx.doc_get(space, id) {
        Ok(document) => Ok(document),
        Err(HostError::NotFound(_)) => Ok(None),
        Err(error) => Err(fail::host(&error)),
    }
}

fn read_one(
    cx: &Cx,
    space: &str,
    document: &Document,
    now: Millis,
    settle: &Settle,
    collections: &[String],
) -> Result<Read, Outcome> {
    let facts = Facts::of(document, collections);
    let successor = match facts
        .superseded_by
        .as_deref()
        .and_then(|value| links::successor(value, &facts.id, collections))
    {
        Some(id) => self::document(cx, space, &id)?.map(|found| Successor {
            id: found.id.clone(),
            hash: found.content_hash.as_str().to_owned(),
            deprecated: found.status == DocStatus::Deprecated,
        }),
        None => None,
    };
    let mut hashes: BTreeMap<String, Option<String>> = BTreeMap::new();
    for (id, _) in &facts.sources {
        if let Some(id) = id
            && !hashes.contains_key(id)
        {
            let hash = self::document(cx, space, id)?.map(|d| d.content_hash.as_str().to_owned());
            hashes.insert(id.clone(), hash);
        }
    }
    let finding = assess(&facts, now, settle, successor.as_ref(), |id| {
        hashes.get(id).cloned().flatten()
    });
    Ok(Read { facts, finding })
}

/// The caller's readable markdown documents in `space`, read from just after `start` and wrapping
/// to the first, at most [`MAX_DOCUMENTS`], each assessed at `now`. `markdown` lists the readable
/// markdown collections; `collections` every readable collection, for resolving references.
pub(crate) fn scan(
    cx: &Cx,
    space: &str,
    now: Millis,
    settle: &Settle,
    start: Option<&str>,
    (markdown, collections): (&[String], &[String]),
) -> Result<Scanned, Outcome> {
    let mut scanned = Scanned::default();
    let mut after = start.map(str::to_owned);
    let mut wrapped = start.is_none();
    let mut read = 0usize;
    'pages: loop {
        let page = match cx.doc_list(
            space,
            &ListQuery {
                collection: None,
                prefix: None,
                doc_type: None,
                after: after.clone(),
                limit: PAGE,
            },
        ) {
            Ok(page) => page,
            Err(HostError::NotFound(_)) => break,
            Err(error) => return Err(fail::host(&error)),
        };
        for meta in &page.items {
            let id = meta.id.as_str();
            if wrapped && start.is_some_and(|begin| id > begin) {
                scanned.next = None;
                break 'pages;
            }
            if read >= MAX_DOCUMENTS {
                scanned.next = after.clone();
                break 'pages;
            }
            after = Some(id.to_owned());
            if !markdown.contains(&meta.collection)
                || matches!(meta.doc_type.as_str(), "okf-index" | "okf-log")
            {
                continue;
            }
            read += 1;
            if let Some(document) = document(cx, space, id)? {
                scanned
                    .documents
                    .push(read_one(cx, space, &document, now, settle, collections)?);
            }
        }
        if page.next.is_none() {
            if wrapped {
                scanned.next = None;
                break;
            }
            wrapped = true;
            after = None;
            continue;
        }
    }
    scanned
        .documents
        .sort_by(|a, b| a.facts.id.cmp(&b.facts.id));
    scanned.documents.dedup_by(|a, b| a.facts.id == b.facts.id);
    Ok(scanned)
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    fn facts() -> Facts {
        Facts {
            id: "notes/a".into(),
            hash: format!("sha256:{}", "1".repeat(64)),
            deprecated: false,
            stale_after: Some("2026-03-01T00:00:00Z".into()),
            superseded_by: None,
            broken_links: false,
            flagged: false,
            sources: vec![(Some("notes/b".into()), "sha256:b".into())],
        }
    }

    fn at(text: &str) -> Millis {
        parse_instant(text).unwrap()
    }

    #[test]
    fn a_document_is_due_within_the_lead_and_drafted_only_when_its_checks_pass() {
        let settle = Settle::default();
        let current = |_: &str| Some("sha256:b".to_owned());
        let early = at("2026-02-14T00:00:00.000Z");
        assert_eq!(
            assess(&facts(), early, &settle, None, current),
            Finding::Nothing
        );
        let due = at("2026-02-15T00:00:00.000Z");
        assert_eq!(
            assess(&facts(), due, &settle, None, current),
            Finding::Verify
        );
        let mut broken = facts();
        broken.broken_links = true;
        broken.flagged = true;
        assert_eq!(
            assess(&broken, due, &settle, None, |_| Some("sha256:other".into())),
            Finding::CheckFailed(vec!["links-resolve", "sources-unchanged", "not-flagged"])
        );
        let mut never = facts();
        never.stale_after = None;
        assert_eq!(
            assess(&never, due, &settle, None, current),
            Finding::Nothing
        );
    }

    #[test]
    fn a_resolving_successor_deprecates_and_a_missing_one_is_reported() {
        let settle = Settle::default();
        let next = Successor {
            id: "notes/b".into(),
            hash: "sha256:b".into(),
            deprecated: false,
        };
        let mut named = facts();
        named.superseded_by = Some("b".into());
        assert_eq!(
            assess(&named, 0, &settle, Some(&next), |_| None),
            Finding::Deprecate(next.clone())
        );
        let mut gone = named.clone();
        gone.deprecated = true;
        assert_eq!(
            assess(&gone, 0, &settle, None, |_| None),
            Finding::SuccessorMissing
        );
        assert_eq!(
            assess(&gone, 0, &settle, Some(&next), |_| None),
            Finding::Nothing
        );
    }
}
