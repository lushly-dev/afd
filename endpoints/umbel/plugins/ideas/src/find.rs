//! `ideas-find` (specification, section 7.4): held ideas by type, tags, standing, who said them,
//! state and text, newest first or by id or rank, with a cursor and a total. One `record_find`
//! over kind `wording`, keyed on `/role`.

use serde_json::{Value, json};
use umbel_sdk::{Cx, HostError, Outcome, success};
use umbel_store::lane::{FindOrder, Pointer, RecordFind, TextQuery};

use crate::capture::is_tag;
use crate::label::{standing_of, wording_view};
use crate::pack::Pack;
use crate::pending::{key, pending};
use crate::records::WORDING;
use crate::{Call, budget, fail, input};

const DEFAULT_LIMIT: u64 = 50;
const MAX_LIMIT: u64 = 200;
const MAX_TEXT_CHARS: usize = 1024;

/// `ideas-find`.
pub(crate) fn run(input: &Value, cx: &Cx, call: &Call) -> Result<Outcome, Outcome> {
    let pack = Pack::read(cx)?;
    let state = input::string(input, "state")?.unwrap_or("live");
    let role = match state {
        "live" => "held",
        "declined" => "declined",
        _ => {
            return Err(fail::invalid("state", "must be live or declined")
                .with_error_details(json!({ "field": "state", "valid": ["live", "declined"] })));
        }
    };
    let mut keys = vec![key("/role", &[role])];
    if let Some(kind) = input::string(input, "type")? {
        if !pack.has_type(kind) {
            return Err(fail::invalid_type("type", &pack.type_names()));
        }
        keys.push(key("/type", &[kind]));
    }
    if let Some(tags) = input::strings(input, "tags")? {
        if tags.is_empty() || tags.len() > 8 || !tags.iter().all(|tag| is_tag(tag)) {
            return Err(fail::invalid(
                "tags",
                "must hold 1 to 8 tags, each matching ^[a-z0-9][a-z0-9-]{0,39}$",
            ));
        }
        let tags: Vec<&str> = tags.iter().map(String::as_str).collect();
        keys.push(key("/tags", &tags));
    }
    if let Some(said) = input::string(input, "said")? {
        if !matches!(said, "person" | "agent" | "unknown") {
            return Err(fail::invalid("said", "must be person, agent or unknown")
                .with_error_details(
                    json!({ "field": "said", "valid": ["person", "agent", "unknown"] }),
                ));
        }
        keys.push(key("/said", &[said]));
    }
    let mut standings = Vec::new();
    for name in input::strings(input, "standing")?.unwrap_or_default() {
        let standing = standing_of(&name).ok_or_else(|| {
            fail::invalid("standing", "holds seed and affirmed only")
                .with_error_details(json!({ "field": "standing", "valid": ["seed", "affirmed"] }))
        })?;
        if !standings.contains(&standing) {
            standings.push(standing);
        }
    }
    let verified_only = input::boolean(input, "verifiedOnly")?.unwrap_or(false);
    let text = input::string(input, "text")?;
    if let Some(text) = text
        && (text.is_empty() || text.chars().count() > MAX_TEXT_CHARS)
    {
        return Err(fail::invalid("text", "must be 1 to 1024 characters"));
    }
    let order = match input::string(input, "order")?.unwrap_or("recent") {
        "recent" => FindOrder::Recent,
        "id" => FindOrder::Id,
        "rank" if text.is_some() => FindOrder::Rank,
        "rank" => return Err(fail::invalid("order", "rank needs text")),
        _ => {
            return Err(
                fail::invalid("order", "must be recent, id or rank").with_error_details(
                    json!({ "field": "order", "valid": ["recent", "id", "rank"] }),
                ),
            );
        }
    };
    let limit = input::integer(input, "limit", 1, MAX_LIMIT)?.unwrap_or(DEFAULT_LIMIT);
    let after = input::string(input, "after")?.map(str::to_owned);
    let total = input::boolean(input, "total")?.unwrap_or(true);
    let query = RecordFind {
        kind: WORDING.to_owned(),
        keys,
        standings,
        verified_only,
        text: text.map(|query| TextQuery {
            query: query.to_owned(),
            fields: vec![statement_pointer()],
        }),
        order,
        after,
        limit: u32::try_from(limit).unwrap_or(200),
        total,
    };
    let mut page = cx
        .record_find(&call.space, &query)
        .map_err(|error| refused(&error))?;
    let pending = pending(cx, call).map_err(|error| fail::host(&error))?;
    let budget = cx.call().output_budget;
    let build = |page: &umbel_store::lane::FindPage, kept: usize, next: Option<&str>| {
        let shown = &page.items[..kept.min(page.items.len())];
        let flagged = shown.iter().filter(|r| !r.flags.is_empty()).count();
        let ideas: Vec<Value> = shown.iter().filter_map(wording_view).collect();
        fail::warn_flagged(
            success(json!({
                "ideas": ideas,
                "next": next,
                "total": page.total,
                "cut": page.cut,
                "admitted": page.admitted,
                "pending": pending,
            })),
            flagged,
        )
    };
    let total = page.items.len();
    let (kept, fitted) = budget::fit_count(total, budget, |kept| {
        // A shortened page has a next page; its cursor is taken below.
        budget::limited(
            build(&page, kept, page.next.as_deref().or(Some(""))),
            total - kept,
            "ideas",
        )
    });
    if kept == total {
        return Ok(build(&page, kept, page.next.as_deref()));
    }
    if kept == 0 {
        // Not one item fits: AFD's check refuses it.
        return Ok(fitted);
    }
    // The page again with the limit that fits, for the host's cursor after its last item.
    let mut shorter = query.clone();
    shorter.limit = u32::try_from(kept).unwrap_or(1);
    page = cx
        .record_find(&call.space, &shorter)
        .map_err(|error| refused(&error))?;
    let kept = page.items.len();
    Ok(budget::limited(
        build(&page, kept, page.next.as_deref()),
        total - kept,
        "ideas",
    ))
}

/// `/statement`, the wording's one text pointer.
pub(crate) fn statement_pointer() -> Pointer {
    Pointer::parse("/statement").unwrap_or_else(|_| unreachable())
}

#[allow(clippy::panic)]
fn unreachable() -> Pointer {
    panic!("/statement is a pointer")
}

/// A find's refusal: the host's query refusals named by field. The host answers one code,
/// `RECORD_QUERY_INVALID`, for a cursor of another order and for a text with no token
/// (`store/src/lane/query.rs:60` and `:160`), so the field is read from its message; a message
/// that names neither is passed on as the host's code.
fn refused(error: &HostError) -> Outcome {
    if fail::no_token(error) {
        return fail::invalid("text", "holds no word the store indexes");
    }
    if let HostError::Invalid(message) = error
        && message.starts_with("RECORD_QUERY_INVALID")
        && message.contains("cursor")
    {
        return fail::invalid("after", "is not a cursor this query's order gave");
    }
    fail::host(error)
}
