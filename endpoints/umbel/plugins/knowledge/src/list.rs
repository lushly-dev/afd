//! `knowledge-list` and `knowledge-changes` (specification section 8.5): readable documents and
//! readable changes, paged, fitted to the output budget by fewer entries and a cursor.

use serde_json::{Value, json};
use umbel_sdk::{Cx, Outcome, success};
use umbel_store::{ChangeKind, ListQuery};

use crate::budget::fit_count;
use crate::doc::label;
use crate::fail;

pub(crate) fn list(input: &Value, cx: &mut Cx) -> Outcome {
    let cx: &Cx = cx;
    let Some(space) = cx.call().space.clone() else {
        return fail::no_space();
    };
    let text = |name: &str| input.get(name).and_then(Value::as_str).map(str::to_owned);
    let limit = input
        .get("limit")
        .and_then(Value::as_u64)
        .unwrap_or(50)
        .clamp(1, 500);
    let page = match cx.doc_list(
        &space,
        &ListQuery {
            collection: text("collection"),
            prefix: text("prefix"),
            doc_type: text("type"),
            after: text("after"),
            limit: u32::try_from(limit).unwrap_or(50),
        },
    ) {
        Ok(page) => page,
        Err(error) => return fail::host(&error),
    };
    // Access sets are not shown: the caller holds one token of each, not the whole list.
    let items: Vec<Value> = page
        .items
        .iter()
        .map(|meta| {
            json!({
                "id": meta.id,
                "title": meta.title,
                "type": meta.doc_type,
                "status": label(&meta.status),
                "rev": meta.rev,
                "contentHash": meta.content_hash,
                "size": meta.size,
                "sensitivity": label(&meta.sensitivity),
                "flags": meta.flags.iter().map(label).collect::<Vec<_>>(),
                "trust": "content",
            })
        })
        .collect();
    let ids: Vec<String> = page.items.iter().map(|meta| meta.id.clone()).collect();
    let total = items.len();
    let next = page.next;
    let build = |kept: usize| {
        let cursor = if kept < total {
            kept.checked_sub(1).and_then(|last| ids.get(last).cloned())
        } else {
            next.clone()
        };
        let mut outcome = success(json!({
            "space": space,
            "documents": &items[..kept],
            "count": kept,
            "nextAfter": cursor,
        }))
        .with_metadata("dev.umbel/trust", json!("content"));
        if kept < total {
            outcome = outcome.with_warning_details(
                "RESULTS_LIMITED",
                "fewer documents are shown than the page held, to fit the output budget; continue from nextAfter",
                json!({ "found": total, "shown": kept }),
            );
        }
        outcome
    };
    let (_, outcome) = fit_count(total, cx.call().output_budget, build);
    outcome
}

pub(crate) fn changes(input: &Value, cx: &mut Cx) -> Outcome {
    let cx: &Cx = cx;
    let Some(space) = cx.call().space.clone() else {
        return fail::no_space();
    };
    let after = input
        .get("after_rev")
        .and_then(Value::as_u64)
        .unwrap_or_default();
    let limit = input
        .get("limit")
        .and_then(Value::as_u64)
        .unwrap_or(100)
        .clamp(1, 1000);
    let trace = input.get("trace").and_then(Value::as_str);
    let found = match cx.doc_changes(&space, after, u32::try_from(limit).unwrap_or(100), trace) {
        Ok(found) => found,
        Err(error) => return fail::host(&error),
    };
    // Record changes (sync state, proposals) are the plugins' own bookkeeping, not documents.
    let scanned_to = found.last().map_or(after, |change| change.rev);
    let items: Vec<Value> = found
        .iter()
        .filter(|change| matches!(change.kind, ChangeKind::Put | ChangeKind::Delete))
        .map(|change| {
            json!({
                "rev": change.rev,
                "kind": label(&change.kind),
                "doc": change.target,
                "contentHash": change.content_hash,
                "traceId": change.trace_id,
                "at": change.at,
            })
        })
        .collect();
    let total = items.len();
    let more = found.len() as u64 >= limit;
    let build = |kept: usize| {
        let cursor = if kept < total {
            items
                .get(kept.saturating_sub(1))
                .and_then(|item| item["rev"].as_u64())
                .filter(|_| kept > 0)
                .unwrap_or(after)
        } else {
            scanned_to
        };
        let mut outcome = success(json!({
            "space": space,
            "changes": &items[..kept],
            "count": kept,
            "nextAfterRev": cursor,
            "more": more || kept < total,
        }));
        if kept < total {
            outcome = outcome.with_warning_details(
                "RESULTS_LIMITED",
                "fewer changes are shown than were found, to fit the output budget; continue from nextAfterRev",
                json!({ "found": total, "shown": kept }),
            );
        }
        outcome
    };
    let (_, outcome) = fit_count(total, cx.call().output_budget, build);
    outcome
}
