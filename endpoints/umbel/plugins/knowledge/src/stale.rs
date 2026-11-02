//! `knowledge-stale` (specification sections 8.5 and 9.3): the readable documents that are past
//! their `stale_after`, `deprecated` with no successor that resolves, or never verified.
//!
//! The list is read from the document store under the caller's reader filter, a bounded scan at a
//! time (the store holds `stale_after`, the verification tier and `superseded_by` in the document,
//! not in the listing), and continues from a cursor.

use chrono::DateTime;
use serde_json::{Value, json};
use umbel_sdk::{Cx, HostError, Outcome, success};
use umbel_store::{Document, ListQuery, Status, Tier};

use crate::budget::fit_count;
use crate::doc::{label, meta};
use crate::fail;

/// The most documents one call reads.
const SCAN: usize = 2000;
const PAGE: u32 = 250;
const REASONS: [&str; 3] = [
    "past-stale-after",
    "deprecated-without-successor",
    "never-verified",
];

pub(crate) fn run(input: &Value, cx: &mut Cx) -> Outcome {
    let cx: &Cx = cx;
    let Some(space) = cx.call().space.clone() else {
        return fail::no_space();
    };
    let text = |name: &str| input.get(name).and_then(Value::as_str).map(str::to_owned);
    let limit = input
        .get("limit")
        .and_then(Value::as_u64)
        .unwrap_or(50)
        .clamp(1, 200);
    let limit = usize::try_from(limit).unwrap_or(50);
    let wanted: Vec<String> = input
        .get("reasons")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default();
    let wants = |reason: &str| wanted.is_empty() || wanted.iter().any(|w| w == reason);
    let as_of = match text("as_of") {
        Some(time) => match DateTime::parse_from_rfc3339(&time) {
            Ok(time) => time.timestamp_millis(),
            Err(_) => {
                return umbel_sdk::failure(
                    "QUERY_INVALID",
                    "as_of is not an RFC 3339 time",
                    "Write it like 2026-01-01T00:00:00Z.",
                );
            }
        },
        None => match cx.now_ms() {
            Ok(now) => now,
            Err(error) => return fail::host(&error),
        },
    };
    let collections = cx
        .content_collections(&space)
        .map(|found| found.into_iter().map(|c| c.id).collect::<Vec<_>>())
        .unwrap_or_default();
    let run = || -> Result<Outcome, HostError> {
        let mut found: Vec<Value> = Vec::new();
        let mut cursor = text("after");
        let mut scanned = 0usize;
        let mut finished = false;
        'scan: loop {
            let page = cx.doc_list(
                &space,
                &ListQuery {
                    collection: text("collection"),
                    prefix: None,
                    doc_type: None,
                    after: cursor.clone(),
                    limit: PAGE,
                },
            )?;
            for item in &page.items {
                if found.len() >= limit || scanned >= SCAN {
                    break 'scan;
                }
                scanned += 1;
                cursor = Some(item.id.clone());
                if item.doc_type == "okf-index" || item.doc_type == "okf-log" {
                    continue;
                }
                let Some(document) = cx.doc_get(&space, &item.id)? else {
                    continue;
                };
                let mut reasons: Vec<&str> = Vec::new();
                if wants(REASONS[0]) && past_stale(&document, as_of) {
                    reasons.push(REASONS[0]);
                }
                if wants(REASONS[1])
                    && document.status == Status::Deprecated
                    && !has_successor(cx, &space, &document, &collections)?
                {
                    reasons.push(REASONS[1]);
                }
                if wants(REASONS[2]) && document.verification.tier == Tier::Unverified {
                    reasons.push(REASONS[2]);
                }
                if !reasons.is_empty() {
                    found.push(json!({
                        "doc": document.id,
                        "title": document.title,
                        "type": document.doc_type,
                        "status": label(&document.status),
                        "verification": label(&document.verification.tier),
                        "staleAfter": document.stale_after,
                        "reasons": reasons,
                        "trust": "content",
                    }));
                }
            }
            match page.next {
                Some(_) => {}
                None => {
                    finished = true;
                    break;
                }
            }
        }
        let total = found.len();
        let ids: Vec<String> = found
            .iter()
            .filter_map(|entry| entry["doc"].as_str().map(str::to_owned))
            .collect();
        let (_, outcome) = fit_count(total, cx.call().output_budget, |kept| {
            // Resume after the last entry shown when the budget cut the list, else after the last
            // document scanned.
            let next = if kept < total {
                kept.checked_sub(1).and_then(|at| ids.get(at).cloned())
            } else if finished {
                None
            } else {
                cursor.clone()
            };
            let mut outcome = success(json!({
                "space": space,
                "documents": &found[..kept],
                "count": kept,
                "scanned": scanned,
                "nextAfter": next,
            }))
            .with_metadata("dev.umbel/trust", json!("content"));
            if kept < total {
                outcome = outcome.with_warning_details(
                    "RESULTS_LIMITED",
                    "fewer documents are shown than were found, to fit the output budget; continue from nextAfter",
                    json!({ "found": total, "shown": kept }),
                );
            }
            outcome
        });
        Ok(outcome)
    };
    run().unwrap_or_else(|error| fail::host(&error))
}

fn past_stale(document: &Document, as_of_ms: i64) -> bool {
    document
        .stale_after
        .as_deref()
        .and_then(|time| DateTime::parse_from_rfc3339(time).ok())
        .is_some_and(|time| time.timestamp_millis() <= as_of_ms)
}

/// Whether a deprecated document's `superseded_by` names a document the caller can read.
fn has_successor(
    cx: &Cx,
    space: &str,
    document: &Document,
    collections: &[String],
) -> Result<bool, HostError> {
    let Some(value) = document.superseded_by.as_deref() else {
        return Ok(false);
    };
    match crate::graph::successor(value, &document.id, collections) {
        Some(id) => Ok(meta(cx, space, &id)?.is_some()),
        None => Ok(false),
    }
}
