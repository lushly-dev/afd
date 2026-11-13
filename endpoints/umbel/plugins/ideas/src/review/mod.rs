//! The review commands (specification, section 8): an agent stages proposals in bulk, and the
//! person confirms a part of a review as one decision, by exception.
//!
//! - `stage`, `show` and `unstage`: 8.1 and 8.2.
//! - `parts`: a review's parts, their order and their digests (8.3).
//! - `preview`: what the person reads before a decision (8.4): paged with items on the person
//!   page, unpaged at a terminal.
//! - `apply` and `undo`: 8.5 to 8.7. Only `apply` calls `record_decide`, and only for what a
//!   confirmed part names.
//! - `report`: what the person decided about the agents' proposals (8.8).
//!
//! This module holds what they share: the `review` and `proposal` bodies, their reads and
//! compare-and-set writes, and the writes of an idea's state and a wording's role.

pub(crate) mod apply;
pub(crate) mod parts;
pub(crate) mod preview;
pub(crate) mod report;
pub(crate) mod show;
pub(crate) mod stage;
mod undo;
pub(crate) mod unstage;

use serde_json::{Value, json};
use umbel_sdk::{Cx, HostError, Outcome};
use umbel_store::lane::{FindOrder, KeyFilter, LaneRecord, MAX_FIND_LIMIT, RecordFind};
use umbel_store::memory::MemoryFlag;
use umbel_store::{ContentHash, Expect, Origin};

use crate::pending::key;
use crate::records::{
    IDEA, Idea, PROPOSAL, REVIEW, REVIEW_PREFIX, StoredIdea, WORDING, Wording, put, read, read_idea,
};
use crate::{Call, fail, ids, input};

/// The decisions a proposal may name, in 8.3's order inside a part.
pub(crate) const DECIDES: [&str; 5] = ["duplicate", "reword", "affirm", "decline", "undo"];
/// The most times a compare-and-set write is tried.
const CAS_TRIES: usize = 8;
/// The most records one paged read of a kind returns: past `review_max` and `part_max`.
const READ_CAP: usize = 20_000;

/// The position of a decision in 8.3's order.
pub(crate) fn rank(decide: &str) -> usize {
    DECIDES
        .iter()
        .position(|d| *d == decide)
        .unwrap_or(DECIDES.len())
}

/// A proposal's body (4.3).
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Proposal {
    pub(crate) id: String,
    pub(crate) review: String,
    pub(crate) idea: Option<String>,
    pub(crate) decide: String,
    pub(crate) version: Option<u64>,
    pub(crate) statement: Option<String>,
    pub(crate) keep: Option<String>,
    pub(crate) target: Option<String>,
    pub(crate) reason: String,
    pub(crate) group: String,
    pub(crate) confidence: String,
    pub(crate) flags: Vec<String>,
    pub(crate) staged_at: String,
    pub(crate) decided_at: Option<String>,
    pub(crate) state: String,
    pub(crate) decided: Option<Value>,
    pub(crate) effect: Option<Value>,
    pub(crate) skipped_for: Option<String>,
}

impl Proposal {
    pub(crate) fn to_json(&self) -> Value {
        json!({
            "id": self.id,
            "review": self.review,
            "idea": self.idea,
            "decide": self.decide,
            "version": self.version,
            "statement": self.statement,
            "keep": self.keep,
            "target": self.target,
            "reason": self.reason,
            "group": self.group,
            "confidence": self.confidence,
            "flags": self.flags,
            "stagedAt": self.staged_at,
            "decidedAt": self.decided_at,
            "state": self.state,
            "decided": self.decided,
            "effect": self.effect,
            "skippedFor": self.skipped_for,
        })
    }

    pub(crate) fn parse(body: &Value) -> Option<Self> {
        let text = |name: &str| body.get(name).and_then(Value::as_str).map(str::to_owned);
        let some = |name: &str| body.get(name).filter(|v| !v.is_null()).cloned();
        Some(Self {
            id: text("id")?,
            review: text("review")?,
            idea: text("idea"),
            decide: text("decide")?,
            version: body.get("version").and_then(Value::as_u64),
            statement: text("statement"),
            keep: text("keep"),
            target: text("target"),
            reason: text("reason").unwrap_or_default(),
            group: text("group")?,
            confidence: text("confidence").unwrap_or_else(|| "medium".to_owned()),
            flags: body
                .get("flags")
                .and_then(Value::as_array)
                .map(|flags| {
                    flags
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::to_owned)
                        .collect()
                })
                .unwrap_or_default(),
            staged_at: text("stagedAt").unwrap_or_default(),
            decided_at: text("decidedAt"),
            state: text("state")?,
            decided: some("decided"),
            effect: some("effect"),
            skipped_for: text("skippedFor"),
        })
    }

    /// The id 8.3 orders by after the decision: the idea's, or an undo's target.
    pub(crate) fn subject(&self) -> &str {
        self.idea
            .as_deref()
            .or(self.target.as_deref())
            .unwrap_or_default()
    }
}

/// A proposal as read: its body, the hash a compare-and-set write names, and who staged it.
#[derive(Debug, Clone)]
pub(crate) struct Stored {
    pub(crate) proposal: Proposal,
    pub(crate) hash: ContentHash,
    pub(crate) by: Value,
}

impl Stored {
    fn of(record: &LaneRecord) -> Option<Self> {
        let envelope = &record.record.envelope;
        Some(Self {
            proposal: Proposal::parse(&record.record.body)?,
            hash: record.record.content_hash.clone(),
            by: json!({
                "principal": envelope.principal,
                "agent": envelope
                    .agent
                    .as_ref()
                    .and_then(|agent| serde_json::to_value(agent).ok()),
            }),
        })
    }
}

/// A review's body (4.3).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Review {
    pub(crate) id: String,
    pub(crate) state: String,
    pub(crate) by: String,
    pub(crate) opened_at: String,
    pub(crate) name: Option<String>,
}

impl Review {
    pub(crate) fn to_json(&self) -> Value {
        json!({
            "id": self.id,
            "state": self.state,
            "by": self.by,
            "openedAt": self.opened_at,
            "name": self.name,
        })
    }

    pub(crate) fn parse(body: &Value) -> Option<Self> {
        let text = |name: &str| body.get(name).and_then(Value::as_str).map(str::to_owned);
        Some(Self {
            id: text("id")?,
            state: text("state")?,
            by: text("by")?,
            opened_at: text("openedAt").unwrap_or_default(),
            name: text("name"),
        })
    }
}

/// A review as read, with its hash.
#[derive(Debug, Clone)]
pub(crate) struct StoredReview {
    pub(crate) review: Review,
    pub(crate) hash: ContentHash,
}

/// Every record of `kind` that passes `keys`, by id, in pages.
pub(crate) fn find_all(
    cx: &Cx,
    call: &Call,
    kind: &str,
    keys: Vec<KeyFilter>,
) -> Result<Vec<LaneRecord>, HostError> {
    let mut found = Vec::new();
    let mut after = None;
    while found.len() < READ_CAP {
        let page = cx.record_find(
            &call.space,
            &RecordFind {
                kind: kind.to_owned(),
                keys: keys.clone(),
                standings: Vec::new(),
                verified_only: false,
                text: None,
                order: FindOrder::Id,
                after: after.clone(),
                limit: MAX_FIND_LIMIT,
                total: false,
            },
        )?;
        let empty = page.items.is_empty();
        found.extend(page.items);
        match page.next {
            Some(next) if !empty => after = Some(next),
            _ => break,
        }
    }
    Ok(found)
}

/// The proposals of `kind`'s find, parsed.
pub(crate) fn proposals(records: &[LaneRecord]) -> Vec<Stored> {
    records.iter().filter_map(Stored::of).collect()
}

/// Every proposal of a review in `states`.
pub(crate) fn in_review(
    cx: &Cx,
    call: &Call,
    review: &str,
    states: &[&str],
) -> Result<Vec<Stored>, HostError> {
    let found = find_all(
        cx,
        call,
        PROPOSAL,
        vec![key("/review", &[review]), key("/state", states)],
    )?;
    Ok(proposals(&found)
        .into_iter()
        .filter(|stored| stored.proposal.review == review)
        .collect())
}

/// The proposals staged on an idea, in any review.
pub(crate) fn staged_on(cx: &Cx, call: &Call, idea: &str) -> Result<Vec<Stored>, HostError> {
    let found = find_all(
        cx,
        call,
        PROPOSAL,
        vec![key("/idea", &[idea]), key("/state", &["staged"])],
    )?;
    Ok(proposals(&found)
        .into_iter()
        .filter(|stored| stored.proposal.idea.as_deref() == Some(idea))
        .collect())
}

/// One proposal; `None` when absent or unreadable.
pub(crate) fn read_proposal(cx: &Cx, call: &Call, id: &str) -> Result<Option<Stored>, HostError> {
    Ok(read(cx, call, PROPOSAL, id)?.and_then(|record| Stored::of(&record)))
}

/// One review; `None` when absent or unreadable.
pub(crate) fn read_review(
    cx: &Cx,
    call: &Call,
    id: &str,
) -> Result<Option<StoredReview>, HostError> {
    Ok(read(cx, call, REVIEW, id)?.and_then(|record| {
        Review::parse(&record.record.body).map(|review| StoredReview {
            review,
            hash: record.record.content_hash,
        })
    }))
}

/// The caller's newest open review, found by the keys `/state` and `/by`.
pub(crate) fn newest_open(cx: &Cx, call: &Call) -> Result<Option<StoredReview>, HostError> {
    if call.principal.is_empty() {
        return Ok(None);
    }
    let page = cx.record_find(
        &call.space,
        &RecordFind {
            kind: REVIEW.to_owned(),
            keys: vec![
                key("/state", &["open"]),
                key("/by", &[call.principal.as_str()]),
            ],
            standings: Vec::new(),
            verified_only: false,
            text: None,
            order: FindOrder::Recent,
            after: None,
            limit: 1,
            total: false,
        },
    )?;
    Ok(page.items.first().and_then(|record| {
        Review::parse(&record.record.body).map(|review| StoredReview {
            review,
            hash: record.record.content_hash.clone(),
        })
    }))
}

/// The review a command names, or the caller's newest open one when it names none.
pub(crate) fn named_or_newest(
    cx: &Cx,
    call: &Call,
    input: &Value,
) -> Result<StoredReview, Outcome> {
    let host = |error: HostError| fail::host(&error);
    match input::string(input, "review")? {
        Some(id) => {
            let found = if ids::is_id(id, REVIEW_PREFIX) {
                read_review(cx, call, id).map_err(host)?
            } else {
                None
            };
            found.ok_or_else(|| fail::review_not_found(Some(id)))
        }
        None => newest_open(cx, call)
            .map_err(host)?
            .ok_or_else(|| fail::review_not_found(None)),
    }
}

/// Write a proposal over the one read, by compare-and-set.
pub(crate) fn write_proposal(
    cx: &Cx,
    call: &Call,
    stored: &Stored,
    proposal: &Proposal,
    origin: Origin,
    at: &str,
) -> Result<ContentHash, HostError> {
    put(
        cx,
        call,
        PROPOSAL,
        &proposal.id,
        proposal.to_json(),
        Expect::Hash(stored.hash.clone()),
        origin,
        at,
    )
    .map(|meta| meta.content_hash)
}

/// Set a review's state, by compare-and-set; a review already in it is left alone.
pub(crate) fn set_review_state(
    cx: &Cx,
    call: &Call,
    id: &str,
    state: &str,
    at: &str,
) -> Result<(), HostError> {
    for _ in 0..CAS_TRIES {
        let Some(stored) = read_review(cx, call, id)? else {
            return Ok(());
        };
        if stored.review.state == state {
            return Ok(());
        }
        let mut review = stored.review.clone();
        review.state = state.to_owned();
        match put(
            cx,
            call,
            REVIEW,
            id,
            review.to_json(),
            Expect::Hash(stored.hash),
            Origin::AgentInferred,
            at,
        ) {
            Ok(_) => return Ok(()),
            Err(HostError::Conflict { .. }) => {}
            Err(error) => return Err(error),
        }
    }
    Err(HostError::Conflict { current: None })
}

/// Close a review when nothing in it is staged (8.5, step 4).
pub(crate) fn close_if_empty(
    cx: &Cx,
    call: &Call,
    review: &str,
    at: &str,
) -> Result<(), HostError> {
    let staged = crate::pending::count(
        cx,
        call,
        PROPOSAL,
        vec![key("/review", &[review]), key("/state", &["staged"])],
        Vec::new(),
    )?;
    if staged == 0 {
        set_review_state(cx, call, review, "closed", at)?;
    }
    Ok(())
}

/// Change an idea by compare-and-set, reading it again on a conflict; `None` when it is absent
/// or unreadable. `change` answers false to leave it as it is.
pub(crate) fn update_idea(
    cx: &Cx,
    call: &Call,
    id: &str,
    at: &str,
    change: impl Fn(&mut Idea) -> bool,
) -> Result<Option<Idea>, HostError> {
    for _ in 0..CAS_TRIES {
        let Some(StoredIdea { idea, hash }) = read_idea(cx, call, id)? else {
            return Ok(None);
        };
        let mut changed = idea.clone();
        if !change(&mut changed) || changed == idea {
            return Ok(Some(idea));
        }
        match put(
            cx,
            call,
            IDEA,
            id,
            changed.to_json(),
            Expect::Hash(hash),
            Origin::UserStated,
            at,
        ) {
            Ok(_) => return Ok(Some(changed)),
            Err(HostError::Conflict { .. }) => {}
            Err(error) => return Err(error),
        }
    }
    Err(HostError::Conflict { current: None })
}

/// Set a wording's role by compare-and-set. Its statement is never touched (D160), so its
/// affirmation stands. False when it is absent or unreadable.
pub(crate) fn set_role(
    cx: &Cx,
    call: &Call,
    id: &str,
    role: &str,
    at: &str,
) -> Result<bool, HostError> {
    for _ in 0..CAS_TRIES {
        let Some(record) = read(cx, call, WORDING, id)? else {
            return Ok(false);
        };
        let Some(mut wording) = Wording::parse(&record.record.body) else {
            return Ok(false);
        };
        if wording.role == role {
            return Ok(true);
        }
        wording.role = role.to_owned();
        // Members the plugin does not know are kept: an archive's `restored` among them.
        let mut body = record.record.body.clone();
        if let (Some(map), Value::Object(new)) = (body.as_object_mut(), wording.to_json()) {
            map.extend(new);
        }
        match put(
            cx,
            call,
            WORDING,
            id,
            body,
            Expect::Hash(record.record.content_hash.clone()),
            crate::records::origin_of(&wording.said),
            at,
        ) {
            Ok(_) => return Ok(true),
            Err(HostError::Conflict { .. }) => {}
            Err(error) => return Err(error),
        }
    }
    Err(HostError::Conflict { current: None })
}

/// The plugin's scan of a proposal's reason and reworded statement (4.3), as the host scans a
/// wording: the flags' wire names, sorted.
pub(crate) fn scan(texts: &[&str]) -> Vec<String> {
    let mut flags = Vec::new();
    for text in texts {
        let found = umbel_scan::scan_content(text);
        if found.is_instruction_like() {
            flags.push(MemoryFlag::InstructionLike);
        }
        if found.has_hidden_text() {
            flags.push(MemoryFlag::HiddenText);
        }
    }
    flags.sort();
    flags.dedup();
    flags.iter().map(|flag| flag.as_str().to_owned()).collect()
}

/// Counts by decision, every decision named.
pub(crate) fn by_decide<'a>(decides: impl Iterator<Item = &'a str>) -> Value {
    let mut counts = serde_json::Map::new();
    for decide in DECIDES {
        counts.insert(decide.to_owned(), json!(0));
    }
    for decide in decides {
        let n = counts.get(decide).and_then(Value::as_u64).unwrap_or(0);
        counts.insert(decide.to_owned(), json!(n + 1));
    }
    Value::Object(counts)
}
