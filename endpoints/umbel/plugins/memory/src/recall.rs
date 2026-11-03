//! `memory-recall` (section 8.4): ranked recall over what the caller can read, with recall's
//! filters and project rule, flagged hits returned with their label, concise or detailed hits,
//! AFD `sources` with no `url`, and the result fitted to the call's budget by dropping hits.
//! A hit carries a rank and never a score (D70).

use serde::Deserialize;
use serde_json::{Value, json};
use umbel_sdk::{Cx, HostError, Outcome, success};
use umbel_store::MemoryQuery;
use umbel_store::memory::{RecallHit, RecallPage, RecallQuery};

use crate::budget;
use crate::fail;
use crate::filters::{self, Filters, ReadWarnings};
use crate::pipeline::Call;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Own {
    query: String,
    #[serde(default)]
    format: Option<String>,
}

pub(crate) fn run(input: &Value, cx: &Cx) -> Outcome {
    match recall(input, cx) {
        Ok(outcome) | Err(outcome) => outcome,
    }
}

/// One hit, concise or detailed.
fn hit_json(hit: &RecallHit, detailed: bool) -> Value {
    let record = &hit.record;
    let mut item = filters::concise_record(record);
    item.insert("rank".into(), json!(hit.rank));
    item.insert("snippet".into(), json!(hit.snippet));
    if detailed {
        let full = record.to_json();
        item.insert("text".into(), full["text"].clone());
        item.insert("tags".into(), full["tags"].clone());
        item.insert("session".into(), full["scope"]["session"].clone());
        item.insert("agent".into(), full["scope"]["agent"].clone());
        item.insert("observations".into(), full["observations"].clone());
        let provenance = &full["provenance"];
        for key in ["confidence", "constraints", "sources", "confirmation"] {
            let value = provenance.get(key).cloned().unwrap_or(Value::Null);
            item.insert(key.into(), value);
        }
    }
    Value::Object(item)
}

fn recall(input: &Value, cx: &Cx) -> Result<Outcome, Outcome> {
    let own: Own = serde_json::from_value(input.clone())
        .map_err(|_| fail::invalid("the input does not match memory-recall's schema"))?;
    let detailed = match own.format.as_deref() {
        None | Some("concise") => false,
        Some("detailed") => true,
        Some(_) => return Err(fail::invalid("format is concise or detailed")),
    };
    // The parser's message names the rule and a position, never the query's text.
    let query =
        MemoryQuery::parse(&own.query).map_err(|error| fail::invalid(&error.to_string()))?;
    let call = Call::open(cx)?;
    let filters = Filters::parse(input, &["query", "format"], &call, cx)?;
    let request = RecallQuery {
        query,
        scope: filters.scope.clone(),
        classes: filters.classes.clone(),
        tags: filters.tags.clone(),
        authorities: filters.authorities.clone(),
        push: None,
        as_of: filters.as_of,
        flags: filters.flags,
        limit: filters.limit,
    };
    let page = match cx.memory_recall(&call.space, &request) {
        Ok(page) => page,
        Err(HostError::NotProvisioned) => RecallPage {
            hits: Vec::new(),
            unreadable: 0,
        },
        Err(error) => return Err(fail::host(&error)),
    };
    let purged_before = filters::history_purged_before(&call, &filters.classes, filters.as_of);
    let hits: Vec<Value> = page.hits.iter().map(|h| hit_json(h, detailed)).collect();
    let build = |kept: usize| {
        let kept_hits = &page.hits[..kept];
        let sources = kept_hits
            .iter()
            .map(|hit| {
                json!({
                    "type": "memory",
                    "id": format!("{}:{}", call.space, hit.record.id),
                    "title": hit.record.subject,
                    "relevance": 1.0 / f64::from(hit.rank.max(1)),
                })
            })
            .collect();
        let outcome = success(json!({
            "hits": hits[..kept].to_vec(),
            "unreadable": page.unreadable,
        }))
        .with_metadata("dev.umbel/trust", json!("content"))
        .with_sources(sources);
        let outcome = ReadWarnings {
            returned: kept,
            flagged: kept_hits
                .iter()
                .filter(|h| !h.record.flags.is_empty())
                .count(),
            unreadable: page.unreadable,
            purged_before,
        }
        .apply(outcome);
        budget::limited(outcome, hits.len() - kept, "hits")
    };
    let budget = cx.call().output_budget;
    Ok(budget::fit_count(hits.len(), budget, build).1)
}
