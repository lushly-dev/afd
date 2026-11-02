//! `knowledge-find` (specification section 8.5): matches of a pattern in one document, with
//! context lines and a locator for each.
//!
//! A pattern is literal text unless `regex` is set. A regular expression is compiled with the
//! `regex` crate (linear time, no backreferences) and a compiled-size limit of 1 MiB, so a
//! pattern cannot make the search slow or the plugin large; a pattern that does not compile is
//! `QUERY_INVALID`.

use regex::{Regex, RegexBuilder};
use serde_json::{Value, json};
use umbel_sdk::{Cx, Outcome, failure, success};

use crate::budget::fit_count;
use crate::doc::{label, load};
use crate::fail;
use crate::locator;
use crate::settings::Settings;

const DEFAULT_MATCHES: u64 = 20;
const MAX_MATCHES: u64 = 100;
const DEFAULT_CONTEXT: u64 = 1;
const MAX_CONTEXT: u64 = 5;
/// The compiled size a pattern may reach, in bytes.
const REGEX_SIZE_LIMIT: usize = 1 << 20;
/// The longest pattern, in characters.
const MAX_PATTERN_CHARS: usize = 1024;
/// A line shown in a match or its context is cut at this many characters.
const LINE_CHARS: usize = 2000;

pub(crate) fn run(input: &Value, cx: &mut Cx) -> Outcome {
    let cx: &Cx = cx;
    let Some(space) = cx.call().space.clone() else {
        return fail::no_space();
    };
    let doc_id = input.get("doc").and_then(Value::as_str).unwrap_or_default();
    let pattern = input
        .get("pattern")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if pattern.is_empty() || pattern.chars().count() > MAX_PATTERN_CHARS {
        return failure(
            "QUERY_INVALID",
            &format!("the pattern must be 1 to {MAX_PATTERN_CHARS} characters"),
            "Give the text or regular expression to look for.",
        );
    }
    let as_regex = input.get("regex").and_then(Value::as_bool).unwrap_or(false);
    let case_sensitive = input
        .get("case_sensitive")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let context = usize::try_from(
        input
            .get("context_lines")
            .and_then(Value::as_u64)
            .unwrap_or(DEFAULT_CONTEXT)
            .min(MAX_CONTEXT),
    )
    .unwrap_or(1);
    let max = usize::try_from(
        input
            .get("max_matches")
            .and_then(Value::as_u64)
            .unwrap_or(DEFAULT_MATCHES)
            .clamp(1, MAX_MATCHES),
    )
    .unwrap_or(20);

    let source = if as_regex {
        pattern.to_owned()
    } else {
        regex::escape(pattern)
    };
    let compiled: Regex = match RegexBuilder::new(&source)
        .case_insensitive(!case_sensitive)
        .size_limit(REGEX_SIZE_LIMIT)
        .dfa_size_limit(REGEX_SIZE_LIMIT)
        .build()
    {
        Ok(regex) => regex,
        Err(error) => {
            return failure(
                "QUERY_INVALID",
                &format!("the pattern does not compile: {error}"),
                "Fix the regular expression; backreferences and look-around are not supported.",
            );
        }
    };

    let loaded = match load(cx, &space, doc_id) {
        Ok(Some(loaded)) => loaded,
        Ok(None) => return fail::document_not_found(),
        Err(error) => return fail::host(&error),
    };
    let settings = Settings::load(cx);
    let tier = label(&loaded.doc.verification.tier);
    if settings.verified_only && !matches!(tier.as_str(), "human" | "owner") {
        return failure(
            "DOCUMENT_NOT_VERIFIED",
            "this instance reads only documents a person has verified, and this one is not",
            "Ask a document owner to verify it.",
        );
    }

    let hash = loaded.doc.content_hash.to_string();
    let total = loaded.total_lines();
    let mut matches = Vec::new();
    let mut more = false;
    for number in 1..=total {
        let line = loaded.line(number);
        let Some(found) = compiled.find(line) else {
            continue;
        };
        if matches.len() >= max {
            more = true;
            break;
        }
        let before: Vec<Value> = (number.saturating_sub(context).max(1)..number)
            .map(|at| shown(loaded.line(at)))
            .collect();
        let after: Vec<Value> = (number + 1..=(number + context).min(total))
            .map(|at| shown(loaded.line(at)))
            .collect();
        let line_number = u32::try_from(number).unwrap_or(u32::MAX);
        matches.push(json!({
            "line": number,
            "column": line[..found.start()].chars().count() + 1,
            "text": shown(line),
            "before": before,
            "after": after,
            "locator": locator::string(&space, &loaded.doc.id, line_number, line_number, &hash),
            "trust": "content",
        }));
    }

    let budget = cx.call().output_budget;
    let count = matches.len();
    let build = |kept: usize| {
        let mut outcome = success(json!({
            "space": space,
            "doc": loaded.doc.id,
            "contentHash": hash,
            "matches": &matches[..kept],
            "count": kept,
            "more": more || kept < count,
        }))
        .with_metadata("dev.umbel/trust", json!("content"));
        if kept < count {
            outcome = outcome.with_warning_details(
                "RESULTS_LIMITED",
                "fewer matches are shown than were found, to fit the output budget; ask for a larger budget or narrow the pattern",
                json!({ "found": count, "shown": kept }),
            );
        }
        outcome
    };
    let (_, outcome) = fit_count(count, budget, build);
    outcome
}

/// A line as a result shows it: cut at [`LINE_CHARS`] characters.
fn shown(line: &str) -> Value {
    match line.char_indices().nth(LINE_CHARS) {
        Some((at, _)) => json!(format!("{}…", &line[..at])),
        None => json!(line),
    }
}
