//! `ideas-open` (specification, section 7.5): one idea, its held (or last) wording with the host's
//! label, every wording in `n` order, what its first wording was offered, the proposal staged on
//! it and its last decisions. An idea that does not exist and one the caller may not read are the
//! same `NOT_FOUND`.

use serde_json::{Value, json};
use umbel_sdk::{Cx, Outcome, success};
use umbel_store::lane::{FindOrder, LaneRecord, RecordFind};

use crate::label::pass;
use crate::pending::{key, pending};
use crate::records::{IDEA_PREFIX, PROPOSAL, WORDING, Wording, read, read_idea, wording_id};
use crate::{Call, fail, ids, input};

/// The most decisions shown.
const DECISIONS: u32 = 10;

/// A proposal as `ideas-open` shows it until step C3 gives `ideas-review-show`'s shape.
fn proposal_view(record: &LaneRecord) -> Value {
    let body = &record.record.body;
    let pick = |name: &str| body.get(name).cloned().unwrap_or(Value::Null);
    json!({
        "id": record.record.id,
        "review": pick("review"),
        "decide": pick("decide"),
        "group": pick("group"),
        "confidence": pick("confidence"),
        "reason": pick("reason"),
        "flags": pick("flags"),
        "state": pick("state"),
        "stagedAt": pick("stagedAt"),
        "decidedAt": pick("decidedAt"),
        "decided": pick("decided"),
    })
}

/// `ideas-open`.
pub(crate) fn run(input: &Value, cx: &Cx, call: &Call) -> Result<Outcome, Outcome> {
    let id = input::string(input, "id")?
        .ok_or_else(|| fail::invalid("id", "is required"))?
        .to_owned();
    let host = |error: umbel_sdk::HostError| fail::host(&error);
    let stored = if ids::is_id(&id, IDEA_PREFIX) {
        read_idea(cx, call, &id).map_err(host)?
    } else {
        None
    };
    let Some(stored) = stored else {
        return Err(fail::not_found(std::slice::from_ref(&id)));
    };
    let idea = stored.idea;
    let mut history = Vec::new();
    let mut held: Option<(Wording, LaneRecord)> = None;
    let mut first: Option<Wording> = None;
    let mut flagged = 0;
    for n in 1..=idea.wordings {
        let Some(record) = read(cx, call, WORDING, &wording_id(&idea.id, n)).map_err(host)? else {
            continue;
        };
        let Some(wording) = Wording::parse(&record.record.body) else {
            continue;
        };
        if !record.flags.is_empty() {
            flagged += 1;
        }
        let (standing, label) = pass(record.label.as_ref());
        history.push(json!({
            "version": n,
            "statement": wording.statement,
            "role": wording.role,
            "said": wording.said,
            "capturedAt": wording.captured_at,
            "standing": standing,
            "label": label,
            "flags": fail::flag_names(&record.flags),
        }));
        if n == 1 {
            first = Some(wording.clone());
        }
        if n == idea.held {
            held = Some((wording, record));
        }
    }
    let Some((wording, record)) = held else {
        // An idea whose held wording the caller cannot read is not shown.
        return Err(fail::not_found(std::slice::from_ref(&id)));
    };
    let (standing, label) = pass(record.label.as_ref());
    let staged = match &idea.staged {
        Some(proposal) => read(cx, call, PROPOSAL, proposal)
            .map_err(host)?
            .filter(|record| record.record.body.get("state") == Some(&json!("staged")))
            .map(|record| proposal_view(&record)),
        None => None,
    };
    let decisions = cx
        .record_find(
            &call.space,
            &RecordFind {
                kind: PROPOSAL.to_owned(),
                keys: vec![
                    key("/idea", &[idea.id.as_str()]),
                    key("/state", &["applied", "pulled", "undone"]),
                ],
                standings: Vec::new(),
                verified_only: false,
                text: None,
                order: FindOrder::Recent,
                after: None,
                limit: DECISIONS,
                total: false,
            },
        )
        .map_err(host)?;
    let pending = pending(cx, call).map_err(host)?;
    Ok(fail::warn_flagged(
        success(json!({
            "id": idea.id,
            "state": idea.state,
            "type": wording.kind,
            "tags": wording.tags,
            "sightings": idea.sightings,
            "into": idea.into,
            "createdAt": idea.created_at,
            "statement": wording.statement,
            "said": wording.said,
            "version": wording.n,
            "standing": standing,
            "label": label,
            "flags": fail::flag_names(&record.flags),
            "history": history,
            "offered": first.map_or_else(|| json!([]), |first| first.offered),
            "staged": staged,
            "decisions": decisions.items.iter().map(proposal_view).collect::<Vec<_>>(),
            "pending": pending,
        })),
        flagged,
    ))
}
