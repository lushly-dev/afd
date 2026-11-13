//! `ideas-ask` (specification, section 7.3): what the person holds that bears on a question, in
//! their own words. One ranked `record_find` over held wordings, its page as find shows it, the
//! seeds among it named in `attention`, and `pending`.
//!
//! How many ideas come back is the pack's `ask_default` (25), within `ask_max`: phase 0.3 found
//! a third of a 25-idea bundle off the question, so the caller judges relevance itself, as the
//! instructions paragraph and `ideas-guide`'s `start` tell it (section 11.2).

use serde_json::{Value, json};
use umbel_sdk::{Cx, HostError, Outcome, success};
use umbel_store::lane::{FindOrder, FindPage, RecordFind, TextQuery};

use crate::find::statement_pointer;
use crate::label::wording_view;
use crate::pack::Pack;
use crate::pending::{key, pending};
use crate::records::WORDING;
use crate::{Call, budget, fail, input};

const MAX_QUESTION_CHARS: usize = 1024;

/// What `reasoning` says when nothing held bears on the question.
const NOTHING_HELD: &str = "Nothing the person holds bears on this question; do not answer it in their voice. If they want the question kept, capture it with ideas-capture, type question.";

/// `ideas-ask`.
pub(crate) fn run(input: &Value, cx: &Cx, call: &Call) -> Result<Outcome, Outcome> {
    let pack = Pack::read(cx)?;
    let question = input::string(input, "question")?
        .ok_or_else(|| fail::invalid("question", "is required"))?;
    if question.is_empty() || question.chars().count() > MAX_QUESTION_CHARS {
        return Err(fail::invalid("question", "must be 1 to 1024 characters"));
    }
    let limits = &pack.limits;
    let limit = input::integer(input, "limit", 1, limits.ask_max)?.unwrap_or(limits.ask_default);
    let verified_only = input::boolean(input, "verifiedOnly")?.unwrap_or(false);
    let mut keys = vec![key("/role", &["held"])];
    if let Some(kind) = input::string(input, "type")? {
        if !pack.has_type(kind) {
            return Err(fail::invalid_type("type", &pack.type_names()));
        }
        keys.push(key("/type", &[kind]));
    }
    let query = RecordFind {
        kind: WORDING.to_owned(),
        keys,
        standings: Vec::new(),
        verified_only,
        text: Some(TextQuery {
            query: question.to_owned(),
            fields: vec![statement_pointer()],
        }),
        order: FindOrder::Rank,
        after: None,
        limit: u32::try_from(limit).unwrap_or(1),
        total: true,
    };
    let page = match cx.record_find(&call.space, &query) {
        Ok(page) => page,
        // A question with no token the store indexes is near nothing: answered, not refused.
        // The same find without its text gives the host's `admitted`; its records are not shown.
        Err(error) if no_token(&error) => {
            let mut keyed = query.clone();
            keyed.text = None;
            keyed.order = FindOrder::Id;
            keyed.limit = 1;
            keyed.total = false;
            let admitted = cx
                .record_find(&call.space, &keyed)
                .map_err(|error| fail::host(&error))?
                .admitted;
            FindPage {
                items: Vec::new(),
                next: None,
                total: Some(0),
                admitted,
                cut: false,
            }
        }
        Err(error) => return Err(fail::host(&error)),
    };
    let pending = pending(cx, call).map_err(|error| fail::host(&error))?;
    let build = |kept: usize| {
        let shown = &page.items[..kept.min(page.items.len())];
        let flagged = shown.iter().filter(|r| !r.flags.is_empty()).count();
        let ideas: Vec<Value> = shown.iter().filter_map(wording_view).collect();
        let seeds: Vec<Value> = ideas
            .iter()
            .filter(|idea| idea["standing"] == "seed")
            .map(|idea| idea["id"].clone())
            .collect();
        let mut outcome = success(json!({
            "found": ideas.len(),
            "total": page.total,
            "cut": page.cut,
            "ideas": ideas,
            "attention": { "seeds": seeds },
            "admitted": page.admitted,
            "pending": pending,
        }));
        if kept == 0 && page.items.is_empty() {
            outcome = outcome.with_reasoning(NOTHING_HELD);
        }
        fail::warn_flagged(outcome, flagged)
    };
    let total = page.items.len();
    let (_, fitted) = budget::fit_count(total, cx.call().output_budget, |kept| {
        budget::limited(build(kept), total - kept, "ideas")
    });
    Ok(fitted)
}

/// Whether the host refused the find's text for holding no token
/// (`store/src/lane/query.rs:160`), the one refusal ask answers as `found = 0`.
fn no_token(error: &HostError) -> bool {
    matches!(error, HostError::Invalid(message)
        if message.starts_with("RECORD_QUERY_INVALID") && message.contains("token"))
}
