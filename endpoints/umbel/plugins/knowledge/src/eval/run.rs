//! `knowledge-eval` (specification section 10.3): the report is the result.
//!
//! The command is CLI-only and `inspect`: it writes nothing and does not rebuild. For each query
//! it asks the host for the reader of the principal the query names (`Cx::as_reader`, which the
//! host allows only to a CLI-only command called by a human) and runs the ranking code of
//! `knowledge-search` as that principal, with graph expansion on and off as asked.

use std::collections::{BTreeMap, BTreeSet};
use std::time::Instant;

use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use umbel_sdk::{Cx, HostError, Outcome, Reader, failure, success};
use umbel_store::ListQuery;

use super::metrics::{Graded, Mean, grade, round4};
use super::queries::{self, EvalQuery, Kind};
use crate::fail;
use crate::search;
use crate::settings::{Ranking, Settings};

const DEFAULT_K: u64 = 10;
const MAX_K: u64 = 50;
/// The default collection and file of a space's own query set.
const DEFAULT_QUERIES: &str = "eval/queries.jsonl";
/// The most queries one run takes.
const MAX_QUERIES: usize = 5000;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Setting {
    On,
    Off,
}

impl Setting {
    fn name(self) -> &'static str {
        match self {
            Setting::On => "on",
            Setting::Off => "off",
        }
    }
}

/// One returned document of one run.
struct Hit {
    space: String,
    doc: String,
    score: f64,
}

pub(crate) fn run(input: &Value, cx: &mut Cx) -> Outcome {
    let cx: &Cx = cx;
    let k = input
        .get("k")
        .and_then(Value::as_u64)
        .unwrap_or(DEFAULT_K)
        .clamp(1, MAX_K);
    let settings: Vec<Setting> = match input.get("expand").and_then(Value::as_str) {
        Some("on") => vec![Setting::On],
        Some("off") => vec![Setting::Off],
        _ => vec![Setting::On, Setting::Off],
    };
    let spaces = cx.call().spaces.clone();
    let path = input
        .get("queries")
        .and_then(Value::as_str)
        .unwrap_or(DEFAULT_QUERIES);
    let set = match load(cx, &spaces, path) {
        Ok(set) => set,
        Err(outcome) => return outcome,
    };
    let ranking_bytes = match cx.pack_read("ranking", "data/ranking.toml") {
        Ok(bytes) => bytes,
        Err(error) => return fail::host(&error),
    };
    let ranking = match Ranking::load(cx) {
        Ok(ranking) => ranking,
        Err(outcome) => return outcome,
    };
    let engine = Settings::load(cx);

    let mut readers: BTreeMap<String, Reader> = BTreeMap::new();
    let mut tokens: BTreeMap<(String, String), BTreeSet<String>> = BTreeMap::new();
    let mut overall: BTreeMap<&'static str, Mean> = BTreeMap::new();
    let mut by_kind: BTreeMap<(Kind, &'static str), Mean> = BTreeMap::new();
    let mut counts = (0usize, 0usize, 0usize, 0usize); // answerable, unanswerable, permission, skipped
    let mut leaks = 0u64;
    let mut latencies: Vec<f64> = Vec::new();
    let mut empty = 0usize;
    let mut top_scores: Vec<f64> = Vec::new();
    let mut results: Vec<Value> = Vec::new();

    for query in &set {
        if !query.spaces.iter().all(|space| spaces.contains(space)) {
            counts.3 += 1;
            results.push(json!({
                "id": query.id, "kind": query.kind.name(), "skipped": true, "runs": {},
            }));
            continue;
        }
        if !readers.contains_key(&query.principal) {
            match cx.as_reader(&query.principal) {
                Ok(reader) => {
                    readers.insert(query.principal.clone(), reader);
                }
                Err(error) => return fail::host(&error),
            }
        }
        let reader = &readers[&query.principal];
        let mut runs = serde_json::Map::new();
        let mut ranked_runs: Vec<(Setting, Vec<Hit>)> = Vec::new();
        for setting in &settings {
            let started = Instant::now();
            let hits = match query_hits(
                reader,
                query,
                k,
                *setting,
                &ranking,
                &engine,
                &mut tokens,
                &mut leaks,
            ) {
                Ok(hits) => hits,
                Err(outcome) => return failed(query, &outcome),
            };
            latencies.push(started.elapsed().as_secs_f64() * 1000.0);
            runs.insert(
                setting.name().to_owned(),
                Value::Array(
                    hits.iter()
                        .map(
                            |hit| json!({ "space": hit.space, "doc": hit.doc, "score": hit.score }),
                        )
                        .collect(),
                ),
            );
            ranked_runs.push((*setting, hits));
        }
        match query.kind {
            Kind::Unanswerable => {
                counts.1 += 1;
                let mut top: Option<f64> = None;
                for (_, hits) in &ranked_runs {
                    if let Some(first) = hits.first() {
                        top = Some(top.map_or(first.score, |known| known.max(first.score)));
                    }
                }
                match top {
                    None => empty += 1,
                    Some(score) => top_scores.push(score),
                }
            }
            Kind::Permission => counts.2 += 1,
            kind => {
                counts.0 += 1;
                for (setting, hits) in &ranked_runs {
                    let keys: Vec<String> = hits
                        .iter()
                        .map(|hit| format!("{}:{}", hit.space, hit.doc))
                        .collect();
                    let graded: Graded = grade(&keys, &query.qrels, k as usize);
                    overall.entry(setting.name()).or_default().add(graded);
                    by_kind
                        .entry((kind, setting.name()))
                        .or_default()
                        .add(graded);
                }
            }
        }
        results.push(json!({
            "id": query.id, "kind": query.kind.name(), "skipped": false, "runs": Value::Object(runs),
        }));
    }

    let mut indexed = serde_json::Map::new();
    for space in &spaces {
        match cx.index_applied(space) {
            Ok(applied) => {
                indexed.insert(space.clone(), json!(applied));
            }
            Err(error) => return fail::host(&error),
        }
    }
    let corpus = match corpus_digest(cx, &spaces) {
        Ok(digest) => digest,
        Err(error) => return fail::host(&error),
    };
    let mut metrics_overall = serde_json::Map::new();
    for (name, mean) in &overall {
        metrics_overall.insert((*name).to_owned(), mean.report());
    }
    let mut metrics_kind = serde_json::Map::new();
    for kind in Kind::ANSWERABLE {
        let mut entry = serde_json::Map::new();
        for setting in &settings {
            if let Some(mean) = by_kind.get(&(kind, setting.name())) {
                entry.insert(setting.name().to_owned(), mean.report());
            }
        }
        if !entry.is_empty() {
            metrics_kind.insert(kind.name().to_owned(), Value::Object(entry));
        }
    }
    let unanswerable_total = counts.1;
    let with_hits = top_scores.len();
    let report = json!({
        "version": 1,
        "k": k,
        "spaces": spaces,
        "corpusDigest": corpus,
        "indexApplied": Value::Object(indexed),
        "rankingDigest": format!("sha256:{}", hex(&Sha256::digest(&ranking_bytes))),
        "hostVersion": env!("CARGO_PKG_VERSION"),
        "queries": {
            "total": set.len(),
            "answerable": counts.0,
            "unanswerable": counts.1,
            "permission": counts.2,
            "skipped": counts.3,
        },
        "metrics": { "overall": Value::Object(metrics_overall), "byKind": Value::Object(metrics_kind) },
        "unanswerable": {
            "emptyRate": if unanswerable_total == 0 { Value::Null } else { json!(round4(empty as f64 / unanswerable_total as f64)) },
            "meanTopScore": if with_hits == 0 { Value::Null } else { json!(round4(top_scores.iter().sum::<f64>() / with_hits as f64)) },
        },
        "leaks": leaks,
        "latency": {
            "p50Ms": percentile(&mut latencies, 50),
            "p95Ms": percentile(&mut latencies, 95),
        },
        "results": results,
    });
    success(report).with_reasoning(
        "The report is this result. Compare it with eval/baseline.json, or run the gate on it.",
    )
}

/// Run one query in one setting as its reader, and count its leaks.
#[allow(clippy::too_many_arguments)]
fn query_hits(
    reader: &Reader,
    query: &EvalQuery,
    k: u64,
    setting: Setting,
    ranking: &Ranking,
    engine: &Settings,
    tokens: &mut BTreeMap<(String, String), BTreeSet<String>>,
    leaks: &mut u64,
) -> Result<Vec<Hit>, Outcome> {
    let request = search::parse(&json!({
        "query": query.query,
        "filters": query.filters,
        "limit": k,
        "expand": setting == Setting::On,
    }))?;
    let ranked = match search::rank(reader, &query.spaces, &request, ranking, engine) {
        Ok((ranked, _)) => ranked,
        // A principal the space does not admit is given nothing, and so leaks nothing.
        Err(outcome) if code(&outcome) == Some("SPACE_NOT_READABLE") => return Ok(Vec::new()),
        Err(outcome) => return Err(outcome),
    };
    let mut hits = Vec::new();
    for item in &ranked {
        // The access set is the document store's own record of who may read the document.
        let in_spaces = query.spaces.contains(&item.space);
        let held = if in_spaces {
            let key = (query.principal.clone(), item.space.clone());
            if !tokens.contains_key(&key) {
                let held = reader
                    .reader_tokens(&item.space)
                    .map_err(|error| fail::host(&error))?;
                tokens.insert(key.clone(), held.into_iter().collect());
            }
            tokens[&key].clone()
        } else {
            BTreeSet::new()
        };
        let leaked = is_leak(in_spaces, item.meta.access.tokens(), &held);
        if leaked {
            *leaks += 1;
        }
        hits.push(Hit {
            space: item.space.clone(),
            doc: item.doc.clone(),
            score: round4(item.shown),
        });
    }
    Ok(hits)
}

/// Whether a returned document is a leak: it is outside the query's spaces, or the principal
/// holds none of the tokens of its access set.
fn is_leak(in_spaces: bool, access: &[String], held: &BTreeSet<String>) -> bool {
    !in_spaces || !access.iter().any(|token| held.contains(token))
}

fn code(outcome: &Outcome) -> Option<&str> {
    outcome.as_value()["error"]["code"].as_str()
}

fn failed(query: &EvalQuery, outcome: &Outcome) -> Outcome {
    failure(
        "EVAL_QUERY_FAILED",
        &format!(
            "query {} failed with {}",
            query.id,
            code(outcome).unwrap_or("an error")
        ),
        "Fix the query (its text, filters or principal) in the query set, or run it with knowledge-search to see the error.",
    )
}

/// Read the query set from the call's spaces: `<collection>/<path>` under each space's collection
/// of that name. A plugin has no path into the workspace, only into collections (specification
/// section 11), so the default is the `eval` collection's `queries.jsonl`.
fn load(cx: &Cx, spaces: &[String], path: &str) -> Result<Vec<EvalQuery>, Outcome> {
    let Some((collection, file)) = path.split_once('/') else {
        return Err(failure(
            "EVAL_QUERIES_INVALID",
            "queries is <collection>/<path>, for example eval/queries.jsonl",
            "Name the collection that holds the query set and the file inside it.",
        ));
    };
    let mut all: Vec<EvalQuery> = Vec::new();
    let mut seen: BTreeSet<String> = BTreeSet::new();
    let mut found = false;
    for space in spaces {
        let collections = match cx.content_collections(space) {
            Ok(collections) => collections,
            Err(HostError::NotGranted(_)) => {
                return Err(failure(
                    "EVAL_QUERIES_UNAVAILABLE",
                    "knowledge-eval reads its query set through the content grant, which this instance does not hold",
                    "Enable the knowledge plugin with its optional content grant.",
                ));
            }
            Err(error) => return Err(fail::host(&error)),
        };
        if !collections.iter().any(|known| known.id == collection) {
            continue;
        }
        let bytes = match cx.content_read(space, collection, file) {
            Ok(bytes) => bytes,
            Err(HostError::NotFound(_)) => continue,
            Err(error) => return Err(fail::host(&error)),
        };
        found = true;
        let text = String::from_utf8(bytes).map_err(|_| {
            failure(
                "EVAL_QUERIES_INVALID",
                "the query set is not UTF-8",
                "Write the query set as JSON Lines in UTF-8.",
            )
        })?;
        let parsed = queries::parse(&text).map_err(|error| {
            failure(
                "EVAL_QUERIES_INVALID",
                &format!("the query set of `{space}` is invalid: {error}"),
                "Each line is one object of schemas/eval-queries.v1.json.",
            )
        })?;
        for query in parsed {
            if !seen.insert(query.id.clone()) {
                return Err(failure(
                    "EVAL_QUERIES_INVALID",
                    &format!("the query id {} is used twice", query.id),
                    "Query ids are unique across the spaces' query sets.",
                ));
            }
            all.push(query);
        }
    }
    if !found {
        return Err(failure(
            "EVAL_QUERIES_NOT_FOUND",
            &format!("no space of this call has a collection with the file `{path}`"),
            "Declare a collection (for example `eval`, rooted at spaces/<space>/eval) and put queries.jsonl in it, or pass queries.",
        ));
    }
    if all.len() > MAX_QUERIES {
        return Err(failure(
            "EVAL_QUERIES_INVALID",
            &format!("the query set has more than {MAX_QUERIES} queries"),
            "Split the set and evaluate the parts.",
        ));
    }
    Ok(all)
}

/// `sha256` over the readable documents' ids and content hashes of the evaluated spaces, in
/// order.
fn corpus_digest(cx: &Cx, spaces: &[String]) -> Result<String, HostError> {
    let mut sorted: Vec<&String> = spaces.iter().collect();
    sorted.sort();
    let mut hasher = Sha256::new();
    for space in sorted {
        let mut after: Option<String> = None;
        loop {
            let page = cx.doc_list(
                space,
                &ListQuery {
                    collection: None,
                    prefix: None,
                    doc_type: None,
                    after: after.clone(),
                    limit: 500,
                },
            )?;
            for meta in &page.items {
                hasher.update(format!("{space}\t{}\t{}\n", meta.id, meta.content_hash).as_bytes());
            }
            match page.next {
                Some(next) => after = Some(next),
                None => break,
            }
        }
    }
    Ok(format!("sha256:{}", hex(&hasher.finalize())))
}

fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    let mut text = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        let _ = write!(text, "{byte:02x}");
    }
    text
}

/// The nearest-rank percentile in milliseconds, to three decimals; 0 for no samples.
fn percentile(samples: &mut [f64], percent: usize) -> f64 {
    if samples.is_empty() {
        return 0.0;
    }
    samples.sort_by(f64::total_cmp);
    let rank = (percent * samples.len()).div_ceil(100).max(1);
    (samples[rank - 1] * 1000.0).round() / 1000.0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tokens(items: &[&str]) -> Vec<String> {
        items.iter().map(|t| (*t).to_owned()).collect()
    }

    #[test]
    fn a_hit_is_a_leak_outside_the_spaces_or_without_a_token_of_its_access_set() {
        let outsider: BTreeSet<String> = tokens(&["space", "principal:human:eval-reader"])
            .into_iter()
            .collect();
        let member: BTreeSet<String> = tokens(&["space", "group:restricted"]).into_iter().collect();
        let restricted = tokens(&["group:restricted"]);
        let open = tokens(&["space"]);
        assert!(!is_leak(true, &open, &outsider));
        assert!(is_leak(true, &restricted, &outsider));
        assert!(!is_leak(true, &restricted, &member));
        assert!(is_leak(false, &open, &member), "outside the query's spaces");
    }

    #[test]
    fn percentiles_are_nearest_rank() {
        let mut samples = vec![5.0, 1.0, 3.0, 2.0, 4.0];
        assert_eq!(percentile(&mut samples, 50), 3.0);
        assert_eq!(percentile(&mut samples, 95), 5.0);
        assert_eq!(percentile(&mut [], 50), 0.0);
    }
}
