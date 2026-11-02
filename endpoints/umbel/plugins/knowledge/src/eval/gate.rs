//! The gate (specification section 10.4) over an eval report, and the lane gate.
//!
//! Both are pure functions of reports, so CI, a test and a deployer's script apply the same
//! rules. A report is the JSON `knowledge-eval` returns (`schemas/eval-report.v1.json`); the
//! baseline is `eval/baseline.json`, which holds the metrics of the first passing run.

use serde_json::Value;

/// recall@10 the seeded fixture must reach, overall.
pub const MIN_RECALL: f64 = 0.85;
/// nDCG@10 the seeded fixture must reach, overall.
pub const MIN_NDCG: f64 = 0.70;
/// How far below the baseline any metric may fall (in ten-thousandths: 0.02).
pub const MAX_DROP: f64 = 0.02;
/// The fewest answerable queries on which a later lane can pass: a 0.01 difference on fewer is
/// noise.
pub const LANE_MIN_QUERIES: u64 = 50;
/// What a later lane must add to nDCG@10.
pub const LANE_MIN_NDCG_GAIN: f64 = 0.01;
/// How far below BM25's recall@10 a later lane may fall.
pub const LANE_MAX_RECALL_LOSS: f64 = 0.005;

fn number(value: &Value, path: &[&str]) -> Option<f64> {
    let mut at = value;
    for key in path {
        at = at.get(*key)?;
    }
    at.as_f64()
}

/// Tenths of a thousandth, so comparisons never fall to float noise.
fn units(value: f64) -> i64 {
    (value * 10_000.0).round() as i64
}

/// The CI gate: zero leaks, every unanswerable query empty, recall@10 and nDCG@10 over the
/// floors, multi-hop recall no worse with expansion than without, and no metric more than
/// [`MAX_DROP`] below `baseline`.
///
/// # Errors
/// Every rule the report breaks, each as a sentence.
pub fn check(report: &Value, baseline: Option<&Value>) -> Result<(), Vec<String>> {
    let mut failures = Vec::new();
    match report["leaks"].as_u64() {
        Some(0) => {}
        Some(leaks) => failures.push(format!("leaks is {leaks}, not 0")),
        None => failures.push("the report has no leaks count".to_owned()),
    }
    match report["unanswerable"]["emptyRate"].as_f64() {
        Some(rate) if units(rate) == 10_000 => {}
        Some(rate) => failures.push(format!("the unanswerable empty rate is {rate}, not 1.0")),
        None => failures.push("the report has no unanswerable queries".to_owned()),
    }
    let overall = &report["metrics"]["overall"];
    match number(overall, &["on", "recall"]) {
        Some(recall) if recall >= MIN_RECALL => {}
        Some(recall) => failures.push(format!(
            "recall@{} is {recall}, under {MIN_RECALL}",
            report["k"]
        )),
        None => failures.push("the report has no recall with expansion on".to_owned()),
    }
    match number(overall, &["on", "ndcg"]) {
        Some(ndcg) if ndcg >= MIN_NDCG => {}
        Some(ndcg) => failures.push(format!("nDCG@{} is {ndcg}, under {MIN_NDCG}", report["k"])),
        None => failures.push("the report has no nDCG with expansion on".to_owned()),
    }
    let hop = &report["metrics"]["byKind"]["multi-hop"];
    match (
        number(hop, &["on", "recall"]),
        number(hop, &["off", "recall"]),
    ) {
        (Some(on), Some(off)) if units(on) >= units(off) => {}
        (Some(on), Some(off)) => failures.push(format!(
            "multi-hop recall is {on} with expansion and {off} without: expansion must not hurt"
        )),
        _ => failures
            .push("the report has no multi-hop recall with and without expansion".to_owned()),
    }
    if let Some(baseline) = baseline {
        compare(
            &report["metrics"],
            &baseline["metrics"],
            "metrics",
            &mut failures,
        );
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures)
    }
}

/// Compare every metric present in both trees.
fn compare(report: &Value, baseline: &Value, path: &str, failures: &mut Vec<String>) {
    let (Some(report), Some(baseline)) = (report.as_object(), baseline.as_object()) else {
        return;
    };
    for (key, base) in baseline {
        let Some(now) = report.get(key) else { continue };
        let here = format!("{path}.{key}");
        match (base.as_f64(), now.as_f64()) {
            (Some(base), Some(now)) if key != "queries" => {
                if units(base) - units(now) > units(MAX_DROP) {
                    failures.push(format!(
                        "{here} is {now}, more than {MAX_DROP} below the baseline {base}"
                    ));
                }
            }
            _ => compare(now, base, &here, failures),
        }
    }
}

/// The gate a later lane (vectors, rerank) must pass on an instance's own query set before the
/// instance may enable it: over at least [`LANE_MIN_QUERIES`] answerable queries, nDCG@k at
/// least [`LANE_MIN_NDCG_GAIN`] above BM25 with expansion, recall@k not more than
/// [`LANE_MAX_RECALL_LOSS`] below it, and no leaks. Phase 2 builds no lane (O4); this is the
/// seam.
///
/// # Errors
/// Every rule the pair of reports breaks.
pub fn lane_gate(bm25: &Value, lane: &Value) -> Result<(), Vec<String>> {
    let mut failures = Vec::new();
    for (name, report) in [("the BM25 report", bm25), ("the lane report", lane)] {
        match report["queries"]["answerable"].as_u64() {
            Some(n) if n >= LANE_MIN_QUERIES => {}
            Some(n) => failures.push(format!(
                "{name} has {n} answerable queries; the gate needs at least {LANE_MIN_QUERIES}"
            )),
            None => failures.push(format!("{name} has no answerable query count")),
        }
    }
    if lane["queries"]["answerable"] != bm25["queries"]["answerable"] || lane["k"] != bm25["k"] {
        failures.push("the two reports are not over the same queries and k".to_owned());
    }
    if lane["leaks"].as_u64() != Some(0) {
        failures.push("the lane report has leaks".to_owned());
    }
    match (
        number(&lane["metrics"]["overall"], &["on", "ndcg"]),
        number(&bm25["metrics"]["overall"], &["on", "ndcg"]),
    ) {
        (Some(lane), Some(bm25)) if units(lane) - units(bm25) >= units(LANE_MIN_NDCG_GAIN) => {}
        (Some(lane), Some(bm25)) => failures.push(format!(
            "nDCG is {lane}, not {LANE_MIN_NDCG_GAIN} above BM25's {bm25}"
        )),
        _ => failures.push("a report has no nDCG with expansion on".to_owned()),
    }
    match (
        number(&lane["metrics"]["overall"], &["on", "recall"]),
        number(&bm25["metrics"]["overall"], &["on", "recall"]),
    ) {
        (Some(lane), Some(bm25)) if units(bm25) - units(lane) <= units(LANE_MAX_RECALL_LOSS) => {}
        (Some(lane), Some(bm25)) => failures.push(format!(
            "recall is {lane}, more than {LANE_MAX_RECALL_LOSS} below BM25's {bm25}"
        )),
        _ => failures.push("a report has no recall with expansion on".to_owned()),
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures)
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn report() -> Value {
        json!({
            "k": 10,
            "leaks": 0,
            "queries": { "answerable": 185 },
            "unanswerable": { "emptyRate": 1.0 },
            "metrics": {
                "overall": {
                    "on": { "queries": 185, "recall": 0.9, "ndcg": 0.8, "mrr": 0.85 },
                    "off": { "queries": 185, "recall": 0.8, "ndcg": 0.75, "mrr": 0.8 }
                },
                "byKind": {
                    "multi-hop": {
                        "on": { "queries": 20, "recall": 1.0, "ndcg": 0.9, "mrr": 1.0 },
                        "off": { "queries": 20, "recall": 0.0, "ndcg": 0.0, "mrr": 0.0 }
                    }
                }
            }
        })
    }

    #[test]
    fn a_good_report_passes_and_each_rule_fails_alone() {
        assert_eq!(check(&report(), None), Ok(()));
        assert_eq!(check(&report(), Some(&report())), Ok(()));

        let mut leaky = report();
        leaky["leaks"] = json!(1);
        assert!(check(&leaky, None).unwrap_err()[0].contains("leaks"));

        let mut answered = report();
        answered["unanswerable"]["emptyRate"] = json!(0.9333);
        assert!(check(&answered, None).unwrap_err()[0].contains("unanswerable"));

        let mut low = report();
        low["metrics"]["overall"]["on"]["recall"] = json!(0.84);
        assert!(check(&low, None).unwrap_err()[0].contains("recall"));

        let mut ranking = report();
        ranking["metrics"]["overall"]["on"]["ndcg"] = json!(0.69);
        assert!(check(&ranking, None).unwrap_err()[0].contains("nDCG"));

        let mut hurt = report();
        hurt["metrics"]["byKind"]["multi-hop"]["on"]["recall"] = json!(0.0);
        hurt["metrics"]["byKind"]["multi-hop"]["off"]["recall"] = json!(0.5);
        assert!(check(&hurt, None).unwrap_err()[0].contains("multi-hop"));
    }

    #[test]
    fn a_drop_past_the_baseline_fails_and_the_edge_passes() {
        let baseline = report();
        let mut edge = report();
        edge["metrics"]["overall"]["on"]["mrr"] = json!(0.83);
        assert_eq!(check(&edge, Some(&baseline)), Ok(()));
        edge["metrics"]["overall"]["on"]["mrr"] = json!(0.8299);
        let failures = check(&edge, Some(&baseline)).unwrap_err();
        assert!(
            failures[0].contains("metrics.overall.on.mrr"),
            "{failures:?}"
        );
        // A metric the baseline lacks is not compared; the query counts never are.
        let mut counts = report();
        counts["metrics"]["overall"]["on"]["queries"] = json!(1);
        assert_eq!(check(&counts, Some(&baseline)), Ok(()));
    }

    #[test]
    fn a_lane_needs_fifty_answerable_queries_and_a_real_gain() {
        let bm25 = report();
        let mut lane = report();
        lane["metrics"]["overall"]["on"]["ndcg"] = json!(0.81);
        assert_eq!(lane_gate(&bm25, &lane), Ok(()));

        lane["metrics"]["overall"]["on"]["ndcg"] = json!(0.8099);
        assert!(lane_gate(&bm25, &lane).unwrap_err()[0].contains("not 0.01 above"));

        lane["metrics"]["overall"]["on"]["ndcg"] = json!(0.9);
        lane["metrics"]["overall"]["on"]["recall"] = json!(0.8949);
        assert!(lane_gate(&bm25, &lane).unwrap_err()[0].contains("recall"));
        lane["metrics"]["overall"]["on"]["recall"] = json!(0.8951);
        assert_eq!(lane_gate(&bm25, &lane), Ok(()));

        // Too few queries cannot pass, however good the numbers.
        let mut few = report();
        few["queries"]["answerable"] = json!(49);
        let mut few_lane = few.clone();
        few_lane["metrics"]["overall"]["on"]["ndcg"] = json!(0.99);
        let failures = lane_gate(&few, &few_lane).unwrap_err();
        assert_eq!(failures.len(), 2, "{failures:?}");
        assert!(failures[0].contains("at least 50"));

        let mut leaky = report();
        leaky["leaks"] = json!(2);
        leaky["metrics"]["overall"]["on"]["ndcg"] = json!(0.99);
        assert!(lane_gate(&bm25, &leaky).unwrap_err()[0].contains("leaks"));
    }
}
