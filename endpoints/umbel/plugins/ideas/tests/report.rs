//! `ideas-review-report` (specification, section 8.8): the figures on a fixture of 60 proposals
//! with known outcomes, restored into a store from an archive so each outcome is exactly what
//! the fixture says (an archive keeps every label: section 10); the report before its first 50
//! decisions; and the examples fitted to the call's output budget. `tests/review_page.rs` reads
//! the report after a review confirmed on the local page. Every text is an invented fixture
//! about gardening.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::{Value, json};
use support::*;

const REVIEW: &str = "rev-0000000000000000000000c4";

/// The eight reworded ideas' statements, and what each became: four split in two sentences.
const REWORDS: [(&str, &str, &str); 8] = [
    (
        "Mulch bed 1 in autumn.",
        "Mulch bed 1 in autumn. Water it first.",
        "Two ideas in one.",
    ),
    (
        "Mulch bed 2 in autumn.",
        "Mulch bed 2 in autumn. Rake it after.",
        "two ideas in one.",
    ),
    (
        "Mulch bed 3 in autumn.",
        "Mulch bed 3 in autumn. Then cover it.",
        "TWO IDEAS IN ONE.",
    ),
    (
        "Mulch bed 4 in autumn.",
        "Mulch bed 4 in autumn. Weed it in spring.",
        " Two ideas in one. ",
    ),
    (
        "Mulch bed 5 in autumn.",
        "Mulch bed 5 before the frost.",
        "Clearer.",
    ),
    (
        "Mulch bed 6 in autumn.",
        "Mulch bed 6 each autumn.",
        "Clearer.",
    ),
    (
        "Mulch bed 7 in autumn.",
        "Mulch bed 7 in the autumn.",
        "clearer.",
    ),
    ("Mulch bed 8 in autumn.", "Mulch bed 8.", "Shorter."),
];

/// One proposal of the fixture: `(decide, state, confidence)`.
type Outcome = (&'static str, &'static str, &'static str);

/// The 60 outcomes, in the order of the ideas they name.
fn outcomes() -> Vec<Outcome> {
    let mut all: Vec<Outcome> = Vec::new();
    let mut push = |n: usize, outcome: Outcome| all.extend(std::iter::repeat_n(outcome, n));
    // reword: 8 applied, 1 pulled, 1 unstaged (ideas 0 to 9; 0 to 7 are REWORDS).
    push(8, ("reword", "applied", "medium"));
    push(1, ("reword", "pulled", "medium"));
    push(1, ("reword", "unstaged", "medium"));
    // duplicate: 7 applied, 1 pulled (ideas 10 to 17).
    push(7, ("duplicate", "applied", "high"));
    push(1, ("duplicate", "pulled", "high"));
    // affirm: 20 applied, 4 pulled, 3 unstaged, 3 applied and undone since (ideas 18 to 47).
    push(10, ("affirm", "applied", "high"));
    push(10, ("affirm", "applied", "medium"));
    push(1, ("affirm", "pulled", "high"));
    push(3, ("affirm", "pulled", "low"));
    push(3, ("affirm", "unstaged", "medium"));
    push(3, ("affirm", "undone", "high"));
    // decline: 6 applied, 2 pulled, 2 undone (ideas 48 to 57).
    push(6, ("decline", "applied", "low"));
    push(2, ("decline", "pulled", "low"));
    push(2, ("decline", "undone", "medium"));
    // undo: 2 applied (ideas 58 and 59 are not named).
    push(2, ("undo", "applied", "medium"));
    all
}

/// The rank at which each applied duplicate's kept idea was offered to the folded idea at
/// capture; `None` when it was not offered.
const OFFERED_AT: [Option<u64>; 8] = [
    Some(1),
    Some(1),
    Some(3),
    Some(5),
    Some(8),
    None,
    None,
    Some(2),
];

/// A store holding the fixture: 60 ideas captured, exported, and restored with a review and its
/// 60 proposals, the duplicates' `offered` set to [`OFFERED_AT`].
async fn fixture() -> Fx {
    let first = Fx::new();
    let mut statements: Vec<String> = REWORDS.iter().map(|r| r.0.to_owned()).collect();
    statements
        .extend((8..60).map(|i| format!("Path {i} wants an edging of {} bricks.", i % 5 + 2)));
    let refs: Vec<&str> = statements.iter().map(String::as_str).collect();
    let mut ids = first.capture(&refs[..30]).await;
    ids.extend(first.capture(&refs[30..]).await);
    assert_eq!(ids.len(), 60);
    let exported = first.operator("ideas-export", json!({})).await;
    let mut items = data(&exported)["items"].as_array().unwrap().clone();
    for item in &mut items {
        if item["kind"] != "wording" {
            continue;
        }
        let idea = item["body"]["idea"].as_str().unwrap();
        let index = ids.iter().position(|id| id == idea).unwrap();
        if (10..18).contains(&index) {
            let keep = &ids[index + 40];
            let offered: Vec<Value> = (1..=10u64)
                .map(|rank| {
                    let candidate = if Some(rank) == OFFERED_AT[index - 10] {
                        keep.clone()
                    } else {
                        // An idea no fold keeps: one of the reworded ones.
                        ids[rank as usize - 1].clone()
                    };
                    json!({ "idea": candidate, "n": 1, "words": 0.5, "fused": 0.5,
                            "band": "related", "rank": rank })
                })
                .collect();
            item["body"]["offered"] = Value::from(offered);
        }
    }
    items.push(json!({ "kind": "review", "id": REVIEW, "affirmed": null,
        "body": { "id": REVIEW, "state": "closed", "by": "human:ada",
                  "openedAt": "2025-12-01T09:00:00.000Z", "name": null } }));
    for (index, (decide, state, confidence)) in outcomes().into_iter().enumerate() {
        let id = format!("prp-{index:024x}");
        let (statement, reason) = match decide {
            "reword" if index < 8 => (json!(REWORDS[index].1), REWORDS[index].2.to_owned()),
            "reword" => (json!("Mulch the far bed in autumn."), "Clearer.".to_owned()),
            _ => (Value::Null, format!("Reason {index}.")),
        };
        let decided = match state {
            "applied" | "pulled" | "undone" => json!({ "level": "terminal" }),
            _ => Value::Null,
        };
        let (idea, version, target, keep) = match decide {
            "undo" => (
                Value::Null,
                Value::Null,
                json!(format!("prp-{:024x}", 45)),
                Value::Null,
            ),
            "duplicate" => (
                json!(ids[index]),
                Value::Null,
                Value::Null,
                json!(ids[index + 40]),
            ),
            _ => (json!(ids[index]), json!(1), Value::Null, Value::Null),
        };
        items.push(json!({ "kind": "proposal", "id": id, "affirmed": null, "body": {
            "id": id, "review": REVIEW, "idea": idea, "decide": decide, "version": version,
            "statement": statement, "keep": keep, "target": target, "reason": reason,
            "group": "autumn", "confidence": confidence, "flags": [],
            "stagedAt": "2025-12-01T09:00:00.000Z",
            "decidedAt": if decided.is_null() { Value::Null } else { json!("2025-12-02T09:00:00.000Z") },
            "state": state, "decided": decided, "effect": null, "skippedFor": null } }));
    }
    let second = Fx::new();
    let imported = second
        .person("ideas-import", json!({ "items": items }))
        .await;
    assert_eq!(data(&imported)["added"]["proposal"], 60, "{imported}");
    second
}

#[tokio::test]
async fn the_figures_on_60_proposals_with_known_outcomes() {
    let fx = fixture().await;
    let report = data(&fx.agent("ideas-review-report", json!({})).await).clone();
    assert_eq!(report["proposals"], 60);
    // Applied (undone ones included) 48, pulled 8: 56 decisions, past the 50 the report needs.
    assert_eq!(report["applied"], 48);
    assert_eq!(report["pulled"], 8);
    assert_eq!(report["decisions"], 56);
    assert_eq!(report["ready"], true);
    assert_eq!(report["readyAt"], 50);
    assert_eq!(
        report["byKind"],
        json!({
            "duplicate": { "applied": 7, "pulled": 1, "unstaged": 0, "undone": 0 },
            "reword": { "applied": 8, "pulled": 1, "unstaged": 1, "undone": 0 },
            "affirm": { "applied": 23, "pulled": 4, "unstaged": 3, "undone": 3 },
            "decline": { "applied": 8, "pulled": 2, "unstaged": 0, "undone": 2 },
            "undo": { "applied": 2, "pulled": 0, "unstaged": 0, "undone": 0 },
        })
    );
    // Declines over affirms, declines and rewords applied: 8 / 39.
    assert_eq!(report["declineRate"], 0.2051);
    assert_eq!(
        report["pulledRate"],
        json!({
            "all": 0.1429,
            "byDecide": { "duplicate": 0.125, "reword": 0.1111, "affirm": 0.1481,
                          "decline": 0.2, "undo": 0.0 },
            "byConfidence": { "low": 0.4545, "medium": 0.0435, "high": 0.0909 },
        })
    );
    // Of 7 duplicates applied, the kept idea was offered to 5, at these ranks.
    assert_eq!(
        report["duplicates"],
        json!({
            "count": 7, "offered": 5, "offeredRate": 0.7143, "unreadable": 0,
            "ranks": { "1": 2, "2-3": 1, "4-5": 1, "6-10": 1, "notOffered": 2 },
        })
    );
    // Rewords: lengths +16, +15, +15, +19, +7, +2, +4 and -10; four split a sentence.
    let rewords = &report["rewords"];
    assert_eq!(rewords["count"], 8);
    assert_eq!(rewords["medianLengthChange"], 11.0);
    assert_eq!(rewords["splitRate"], 0.5);
    assert_eq!(rewords["unreadable"], 0);
    assert_eq!(
        rewords["reasons"],
        json!([
            { "reason": "two ideas in one.", "count": 4, "flags": [] },
            { "reason": "clearer.", "count": 3, "flags": [] },
            { "reason": "shorter.", "count": 1, "flags": [] },
        ])
    );
    assert_eq!(rewords["examples"], Value::Null);
    assert_eq!(
        report["undone"],
        json!({ "duplicate": 0.0, "reword": 0.0, "affirm": 0.1304, "decline": 0.25, "undo": 0.0 })
    );
    assert_eq!(report["pending"]["staged"], 0);

    // With examples: the eight pairs, old and new.
    let with = data(
        &fx.agent("ideas-review-report", json!({ "examples": true }))
            .await,
    )
    .clone();
    let examples = with["rewords"]["examples"].as_array().unwrap();
    assert_eq!(examples.len(), 8);
    let pairs: Vec<(&str, &str)> = examples
        .iter()
        .map(|e| (e["old"].as_str().unwrap(), e["new"].as_str().unwrap()))
        .collect();
    for (old, new, _) in REWORDS {
        assert!(pairs.contains(&(old, new)), "{old}");
    }
}

#[tokio::test]
async fn before_its_first_50_decisions_the_report_is_not_ready() {
    let fx = Fx::new();
    let empty = data(&fx.agent("ideas-review-report", json!({})).await).clone();
    assert_eq!(empty["decisions"], 0);
    assert_eq!(empty["ready"], false);
    assert_eq!(empty["declineRate"], Value::Null);
    assert_eq!(empty["pulledRate"]["all"], Value::Null);
    assert_eq!(empty["rewords"]["medianLengthChange"], Value::Null);
    // Five decisions at a terminal: counted, not yet ready.
    let ids = fx
        .capture(&[
            "Raised beds warm earlier in spring.",
            "Mulch keeps the soil cool through a dry summer.",
            "Sow carrots thinly to spare the thinning.",
            "Net brassicas before the butterflies arrive.",
            "Leeks want a deep trench and patience.",
        ])
        .await;
    let proposals: Vec<Value> = ids
        .iter()
        .enumerate()
        .map(|(i, id)| {
            json!({ "decide": if i == 4 { "decline" } else { "affirm" }, "idea": id,
                    "version": 1, "reason": "The person said it." })
        })
        .collect();
    let staged = data(
        &fx.agent("ideas-review-stage", json!({ "proposals": proposals }))
            .await,
    )
    .clone();
    let applied = fx
        .person(
            "ideas-review-apply",
            json!({ "review": staged["review"], "part": "*", "digest": staged["digest"] }),
        )
        .await;
    assert_eq!(data(&applied)["applied"]["affirm"], 4);
    let report = data(&fx.agent("ideas-review-report", json!({})).await).clone();
    assert_eq!(report["decisions"], 5);
    assert_eq!(report["ready"], false);
    assert_eq!(report["declineRate"], 0.2);
    assert_eq!(report["byKind"]["affirm"]["applied"], 4);
}

#[tokio::test]
async fn examples_are_fitted_to_the_output_budget() {
    let fx = fixture().await;
    let full = fx
        .agent("ideas-review-report", json!({ "examples": true }))
        .await;
    let without = fx.agent("ideas-review-report", json!({})).await;
    let base = serde_json::to_string(&without).unwrap().len() as u64;
    let fitted = fx
        .agent_with_budget(
            "ideas-review-report",
            json!({ "examples": true }),
            base + 300,
        )
        .await;
    let kept = data(&fitted)["rewords"]["examples"]
        .as_array()
        .unwrap()
        .len();
    assert!(kept < 8, "{kept}");
    let limited = warning(&fitted, "RESULTS_LIMITED").expect("a RESULTS_LIMITED warning");
    assert_eq!(limited["details"]["omitted"], 8 - kept);
    assert_eq!(
        data(&full)["rewords"]["examples"].as_array().unwrap().len(),
        8
    );
}
