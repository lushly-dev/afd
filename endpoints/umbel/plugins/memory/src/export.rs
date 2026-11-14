//! `memory-export` (section 8.9): the caller's own live records, with their text, for an adapter
//! to write into a harness's memory directory, newest recorded first, with a cursor.
//!
//! A harness loads its memory directory as context, so an exported record is one step from
//! instruction: flagged and `transcript` records are never exported. Only the caller's own
//! records (`mine` always), and only what the caller's reader filter admits, which the host
//! applies inside the query: another principal's record, a forgotten one and a purged one are
//! never read. Expired, invalidated and not-yet-valid records are not live, so not exported.

use serde::Deserialize;
use serde_json::{Value, json};
use umbel_sdk::{Cx, HostError, Outcome, failure, success};
use umbel_store::memory::{
    MemoryCursor, MemoryList, MemoryMeta, MemoryOrder, MemoryPage, ProjectMatch,
};
use umbel_store::{AsOf, Authority, MemoryClass, MemoryRecord, ReadFlags, ScopeQuery};

use crate::budget;
use crate::fail;
use crate::filters::{self, MAX_LIMIT, ReadWarnings};
use crate::list::{cursor_of, cursor_text, parse_cursor};
use crate::pipeline::{Call, effective_principal};

/// Every authority but `transcript`: a whole window is not a statement (section 8.9).
const EXPORTED: [Authority; 4] = [
    Authority::Person,
    Authority::Agent,
    Authority::Tool,
    Authority::Import,
];

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Input {
    #[serde(default)]
    #[allow(dead_code)]
    space: Option<String>,
    project: Option<String>,
    #[serde(default)]
    classes: Vec<String>,
    after: Option<String>,
    limit: Option<u32>,
}

pub(crate) fn run(input: &Value, cx: &Cx) -> Outcome {
    match export(input, cx) {
        Ok(outcome) | Err(outcome) => outcome,
    }
}

/// Whether a record read back may be exported: the caller's own, unflagged, not a transcript.
/// The query already asked for exactly this; this is the second look.
fn exportable(record: &MemoryRecord, principal: &str, equivalents: &[String]) -> bool {
    (record.scope.principal == principal || equivalents.contains(&record.scope.principal))
        && record.flags.is_empty()
        && record.authority().is_some_and(|a| EXPORTED.contains(&a))
}

/// One exported record: the concise fields, the tags and the text.
fn item(record: &MemoryRecord) -> Value {
    let mut item = filters::concise_record(record);
    item.insert("tags".into(), json!(record.tags));
    item.insert("text".into(), json!(record.text));
    Value::Object(item)
}

fn export(input: &Value, cx: &Cx) -> Result<Outcome, Outcome> {
    let input: Input = serde_json::from_value(input.clone())
        .map_err(|_| fail::invalid("the input does not match memory-export's schema"))?;
    let after = input
        .after
        .as_deref()
        .map(|text| {
            parse_cursor(text).ok_or_else(|| {
                fail::invalid("after is the next cursor a memory-export result returned")
            })
        })
        .transpose()?;
    let limit = input.limit.unwrap_or(MAX_LIMIT);
    if limit == 0 || limit > MAX_LIMIT {
        return Err(fail::invalid("limit is from 1 to 50"));
    }
    let mut classes = Vec::new();
    for name in &input.classes {
        let class = MemoryClass::parse(name)
            .ok_or_else(|| fail::invalid("classes are episodic, semantic or procedural"))?;
        if !classes.contains(&class) {
            classes.push(class);
        }
    }
    let call = Call::open(cx)?;
    if let Some(project) = &input.project {
        call.check_label("project", project)?;
    }
    let principal = effective_principal(cx.call()).ok_or_else(|| {
        failure(
            "MEMORY_PRINCIPAL_REQUIRED",
            "an export is of your own records, and the caller has no effective principal",
            "Call as an actor with an id, or acting for a person.",
        )
    })?;
    let now = AsOf {
        valid: call.now,
        recorded: call.now,
    };
    // Live only: no flagged and no expired record, valid and believed now.
    let flags = ReadFlags::at(call.now);
    let request = MemoryList {
        scope: ScopeQuery {
            project: input
                .project
                .clone()
                .map_or(ProjectMatch::Any, ProjectMatch::ExactOrUnset),
            principal: Some(principal.clone()),
            // The caller's own records, and its legacy principals' (phase 5 section 4.6).
            equivalents: cx.call().equivalents.clone(),
            agent: None,
            session: None,
        },
        classes,
        tags: Vec::new(),
        authorities: EXPORTED.to_vec(),
        push: None,
        as_of: now,
        flags,
        order: MemoryOrder::Recorded,
        after,
        limit,
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
    // Open each record. One whose body does not open is left out and counted (section 5.4).
    let mut unreadable = page.unreadable;
    let mut read: Vec<(&MemoryMeta, MemoryRecord)> = Vec::new();
    for meta in &page.items {
        match cx.memory_get(&call.space, &meta.id, now, flags) {
            Ok(Some(record)) if exportable(&record, &principal, &cx.call().equivalents) => {
                read.push((meta, record))
            }
            Ok(_) => {}
            Err(HostError::KeyAbsent { .. } | HostError::SealInvalid { .. }) => unreadable += 1,
            Err(error) => return Err(fail::host(&error)),
        }
    }
    let items: Vec<Value> = read.iter().map(|(_, record)| item(record)).collect();
    let total = items.len();
    let build = |kept: usize| {
        let mut too_large: Vec<&str> = Vec::new();
        let next: Option<MemoryCursor> = if kept < total {
            match kept.checked_sub(1) {
                Some(last) => Some(cursor_of(read[last].0)),
                // Not even the first record fits the budget: leave it out, by id, and move past
                // it, so a pager never asks for the same page twice (amendments from step 9).
                None => {
                    too_large.push(read[0].1.id.as_str());
                    Some(cursor_of(read[0].0))
                }
            }
        } else {
            page.next.clone()
        };
        let outcome = success(json!({
            "records": items[..kept].to_vec(),
            "next": next.as_ref().map(cursor_text),
            "unreadable": unreadable,
            "tooLarge": too_large,
        }))
        .with_metadata("dev.umbel/trust", json!("content"));
        let outcome = ReadWarnings {
            returned: kept,
            flagged: 0,
            unreadable,
            purged_before: None,
        }
        .apply(outcome);
        budget::limited(outcome, total - kept, "records")
    };
    let budget = cx.call().output_budget;
    Ok(budget::fit_count(total, budget, build).1)
}
