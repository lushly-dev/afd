//! `knowledge-list` and `knowledge-changes` (specification section 8.5): readable documents and
//! readable changes, paged, fitted to the output budget by fewer entries and a cursor.

use serde_json::{Value, json};
use umbel_sdk::{Cx, HostError, Outcome, failure, success};
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
    // Access sets are not shown: the caller holds one token of each, not the whole list. A
    // revision is shown as the caller may see it (phase 5 section 9.3).
    let mut items: Vec<Value> = Vec::with_capacity(page.items.len());
    for meta in &page.items {
        let rev = match cx.doc_position(&space, meta.rev) {
            Ok(rev) => rev,
            Err(error) => return fail::host(&error),
        };
        items.push(json!({
            "id": meta.id,
            "title": meta.title,
            "type": meta.doc_type,
            "status": label(&meta.status),
            "rev": rev,
            "contentHash": meta.content_hash,
            "size": meta.size,
            "sensitivity": label(&meta.sensitivity),
            "flags": meta.flags.iter().map(label).collect::<Vec<_>>(),
            "trust": "content",
        }));
    }
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
    // `after_rev` as this caller was given it: a number, or a sealed revision (phase 5 section
    // 9.3). 0, the schema's default, is the start for every caller and names nothing.
    let after = match input.get("after_rev") {
        None | Some(Value::Null) => 0,
        Some(value) if value.as_u64() == Some(0) => 0,
        Some(value) => match cx.doc_position_of(&space, value) {
            Ok(after) => after,
            Err(HostError::Invalid(_)) => {
                return failure(
                    "QUERY_INVALID",
                    "after_rev is not a revision this space gave you",
                    "Pass nextAfterRev, or a change's rev, as knowledge-changes returned it; or leave after_rev out to start from the beginning.",
                );
            }
            Err(error) => return fail::host(&error),
        },
    };
    let limit = input
        .get("limit")
        .and_then(Value::as_u64)
        .unwrap_or(100)
        .clamp(1, 1000);
    let trace = input.get("trace").and_then(Value::as_str);
    // A caller whose positions are sealed (phase 5 section 9.3) pages document changes alone: a
    // record change (a sync's bookkeeping) can stand for documents it cannot read, so it may
    // neither fill a page nor move a position.
    let (found, sealed_more) = if cx.call().sealed_positions {
        match document_changes(cx, &space, after, limit, trace) {
            Ok((found, more)) => (found, Some(more)),
            Err(error) => return fail::host(&error),
        }
    } else {
        match cx.doc_changes(&space, after, u32::try_from(limit).unwrap_or(100), trace) {
            Ok(found) => (found, None),
            Err(error) => return fail::host(&error),
        }
    };
    // Record changes (sync state, proposals) are the plugins' own bookkeeping, not documents.
    let scanned_to = found.last().map_or(after, |change| change.rev);
    let shown: Vec<&umbel_store::Change> = found
        .iter()
        .filter(|change| matches!(change.kind, ChangeKind::Put | ChangeKind::Delete))
        .collect();
    let mut items: Vec<Value> = Vec::with_capacity(shown.len());
    for change in &shown {
        let rev = match cx.doc_position(&space, change.rev) {
            Ok(rev) => rev,
            Err(error) => return fail::host(&error),
        };
        items.push(json!({
            "rev": rev,
            "kind": label(&change.kind),
            "doc": change.target,
            "contentHash": change.content_hash,
            "traceId": change.trace_id,
            "at": change.at,
        }));
    }
    let position = |rev: u64| cx.doc_position(&space, rev);
    let after_shown = match position(after) {
        Ok(rev) => rev,
        Err(error) => return fail::host(&error),
    };
    let scanned_shown = match position(scanned_to) {
        Ok(rev) => rev,
        Err(error) => return fail::host(&error),
    };
    let total = items.len();
    let more = sealed_more.unwrap_or(found.len() as u64 >= limit);
    let build = |kept: usize| {
        let cursor = if kept < total {
            items
                .get(kept.saturating_sub(1))
                .filter(|_| kept > 0)
                .map_or_else(|| after_shown.clone(), |item| item["rev"].clone())
        } else {
            scanned_shown.clone()
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

/// Up to `limit` readable document changes after `after`, skipping record changes, and whether
/// a readable document change follows them.
fn document_changes(
    cx: &Cx,
    space: &str,
    after: u64,
    limit: u64,
    trace: Option<&str>,
) -> Result<(Vec<umbel_store::Change>, bool), HostError> {
    const PAGE: u32 = 1000;
    let mut found = Vec::new();
    let mut cursor = after;
    loop {
        let page = cx.doc_changes(space, cursor, PAGE, trace)?;
        for change in &page {
            cursor = change.rev;
            if matches!(change.kind, ChangeKind::Put | ChangeKind::Delete) {
                if found.len() as u64 >= limit {
                    return Ok((found, true));
                }
                found.push(change.clone());
            }
        }
        if page.len() < PAGE as usize {
            return Ok((found, false));
        }
    }
}
