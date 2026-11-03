//! `memory-list` (section 8.5): recall's filters without a query, plus `after`; concise items,
//! newest recorded first, with a cursor. `authorities` is how an agent pulls what a bundle left
//! out (section 9.3). Flagged records appear with their label.

use serde::Deserialize;
use serde_json::{Value, json};
use umbel_sdk::{Cx, HostError, Outcome, success};
use umbel_store::memory::check_memory_id;
use umbel_store::memory::{MemoryCursor, MemoryList, MemoryMeta, MemoryOrder, MemoryPage};

use crate::budget;
use crate::fail;
use crate::filters::{self, Filters, ReadWarnings};
use crate::pipeline::Call;

#[derive(Deserialize)]
struct Own {
    #[serde(default)]
    after: Option<String>,
}

pub(crate) fn run(input: &Value, cx: &Cx) -> Outcome {
    match list(input, cx) {
        Ok(outcome) | Err(outcome) => outcome,
    }
}

/// A cursor on the wire: the item's recorded instant in epoch milliseconds, `:` and its id. It
/// holds no text.
pub(crate) fn cursor_text(cursor: &MemoryCursor) -> String {
    format!("{}:{}", cursor.recorded_at, cursor.id)
}

pub(crate) fn parse_cursor(text: &str) -> Option<MemoryCursor> {
    let (at, id) = text.split_once(':')?;
    let recorded_at = at.parse::<i64>().ok().filter(|at| *at >= 0)?;
    check_memory_id(id).ok()?;
    Some(MemoryCursor {
        recorded_at,
        id: id.to_owned(),
    })
}

pub(crate) fn cursor_of(meta: &MemoryMeta) -> MemoryCursor {
    MemoryCursor {
        recorded_at: meta.recorded_at,
        id: meta.id.clone(),
    }
}

fn list(input: &Value, cx: &Cx) -> Result<Outcome, Outcome> {
    let own: Own = serde_json::from_value(input.clone())
        .map_err(|_| fail::invalid("the input does not match memory-list's schema"))?;
    let after = own
        .after
        .as_deref()
        .map(|text| {
            parse_cursor(text).ok_or_else(|| {
                fail::invalid("after is the next cursor a memory-list result returned")
            })
        })
        .transpose()?;
    let call = Call::open(cx)?;
    let filters = Filters::parse(input, &["after"], &call, cx)?;
    let request = MemoryList {
        scope: filters.scope.clone(),
        classes: filters.classes.clone(),
        tags: filters.tags.clone(),
        authorities: filters.authorities.clone(),
        push: None,
        as_of: filters.as_of,
        flags: filters.flags,
        order: MemoryOrder::Recorded,
        after,
        limit: filters.limit,
    };
    let page = match cx.memory_list(&call.space, &request) {
        Ok(page) => page,
        Err(HostError::NotProvisioned) => MemoryPage {
            items: Vec::new(),
            next: None,
            unreadable: 0,
        },
        Err(error) => return Err(fail::host(&error)),
    };
    let purged_before = filters::history_purged_before(&call, &filters.classes, filters.as_of);
    let items: Vec<Value> = page
        .items
        .iter()
        .map(|meta| Value::Object(filters::concise_meta(meta)))
        .collect();
    let total = items.len();
    let build = |kept: usize| {
        // Items left out for the budget are not lost: the cursor resumes after the last kept.
        let next = if kept < total {
            kept.checked_sub(1)
                .map(|last| cursor_of(&page.items[last]))
                .or_else(|| request.after.clone())
        } else {
            page.next.clone()
        };
        let outcome = success(json!({
            "items": items[..kept].to_vec(),
            "next": next.as_ref().map(cursor_text),
            "unreadable": page.unreadable,
        }))
        .with_metadata("dev.umbel/trust", json!("content"));
        let outcome = ReadWarnings {
            returned: kept,
            flagged: page.items[..kept]
                .iter()
                .filter(|m| !m.flags.is_empty())
                .count(),
            unreadable: page.unreadable,
            purged_before,
        }
        .apply(outcome);
        budget::limited(outcome, total - kept, "items")
    };
    let budget = cx.call().output_budget;
    Ok(budget::fit_count(total, budget, build).1)
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn a_cursor_round_trips_and_refuses_anything_else() {
        let cursor = MemoryCursor {
            recorded_at: 1_767_225_600_000,
            id: "mem-0123456789abcdef01234567".into(),
        };
        assert_eq!(parse_cursor(&cursor_text(&cursor)), Some(cursor));
        for bad in [
            "",
            "12",
            "x:mem-0123456789abcdef01234567",
            "-1:mem-0123456789abcdef01234567",
            "12:mem-short",
        ] {
            assert_eq!(parse_cursor(bad), None, "{bad}");
        }
    }
}
