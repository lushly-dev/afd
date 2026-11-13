//! Fitting a brief to its budget (specification, section 6.4): the shedding order on a synthetic
//! pack whose sizes force each step, `omitted` and its `open`, `OUTPUT_BUDGET_EXCEEDED` with
//! `fits`, `maxBytes` below the budget, a larger budget asked for, and a result never over its
//! target.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::collections::BTreeSet;

use serde_json::{Value, json};
use support::*;

/// The shedding order's steps that a `brief` request can reach, as the names `omitted` gives them.
const GROUPS: [&[&str]; 12] = [
    &["examples"],
    &["cssProperties"],
    &["eventDetail"],
    &["declaredAttributes"],
    &["usage"],
    &["events", "commands"],
    &["form", "roles", "axe"],
    &["slots"],
    &["ruleText"],
    &["a11y"],
    &["attributes"],
    &["gaps", "rules"],
];

/// Every section a brief served by default before step C5's follow-up: all but the long form. The
/// shedding order is tested on it, so `cssProperties` and the attributes' rules take part.
const ALL_BUT_DETAIL: [&str; 14] = [
    "attributes",
    "slots",
    "events",
    "commands",
    "cssProperties",
    "themes",
    "form",
    "roles",
    "axe",
    "a11y",
    "usage",
    "rules",
    "examples",
    "gaps",
];

const FLOOR: [&str; 6] = [
    "import",
    "library",
    "status",
    "summary",
    "tag",
    "replacedBy",
];

fn rich(count: usize) -> (Pack, Vec<String>) {
    let mut pack = Pack::default();
    pack.add_rich("synthetic", count);
    let tags = (0..count)
        .map(|index| format!("synthetic-item-{index:04}"))
        .collect();
    (pack, tags)
}

fn names(list: &Value) -> Vec<String> {
    list.as_array()
        .unwrap()
        .iter()
        .map(|name| name.as_str().unwrap().to_owned())
        .collect()
}

fn budget_omission(result: &Value) -> Option<&Value> {
    data(result)["omitted"]
        .as_array()
        .unwrap()
        .iter()
        .find(|o| o["reason"] == "budget")
}

/// How many of the order's steps an answer applied, checking that what it shed is exactly the
/// first steps of the order, less what the default brief left out before any step.
fn steps_applied(result: &Value) -> usize {
    let Some(omission) = budget_omission(result) else {
        return 0;
    };
    let shed: BTreeSet<String> = names(&omission["sections"])
        .into_iter()
        .chain(names(&omission["pieces"]))
        .collect();
    let by_default: BTreeSet<String> = data(result)["omitted"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|o| o["reason"] == "detail")
        .flat_map(|o| names(&o["sections"]))
        .collect();
    (0..=GROUPS.len())
        .find(|k| {
            let prefix: BTreeSet<String> = GROUPS[..*k]
                .iter()
                .flat_map(|group| group.iter().map(|name| (*name).to_owned()))
                .filter(|name| !by_default.contains(name))
                .collect();
            prefix == shed
        })
        .unwrap_or_else(|| panic!("{shed:?} is not a prefix of the shedding order"))
}

fn entry_keys(entry: &Value) -> BTreeSet<String> {
    entry.as_object().unwrap().keys().cloned().collect()
}

#[tokio::test]
async fn sections_and_pieces_are_shed_in_order_from_every_entry_at_once() {
    let (pack, tags) = rich(5);
    let fx = pack.host();
    let mut seen = BTreeSet::new();
    let mut last = 0;
    let mut target = 12_000;
    while target >= 1_024 {
        let result = fx
            .brief(json!({ "tags": tags, "sections": ALL_BUT_DETAIL, "maxBytes": target }))
            .await;
        if result["success"] == false {
            // Below the floors: every step was applied before this.
            assert_eq!(code(&result), "OUTPUT_BUDGET_EXCEEDED");
            assert_eq!(last, GROUPS.len());
            break;
        }
        assert!(result_bytes(&result) <= target, "over {target}");
        let applied = steps_applied(&result);
        assert!(applied >= last, "a smaller target shed less");
        last = applied;
        seen.insert(applied);
        // Entries stay comparable: every entry has the same parts.
        let entries = data(&result)["content"]["components"].as_array().unwrap();
        assert_eq!(entries.len(), 5);
        let first = entry_keys(&entries[0]);
        assert!(entries.iter().all(|entry| entry_keys(entry) == first));
        // The rule text goes at its step; the ids stay until the last.
        assert_eq!(
            data(&result)["content"].get("rules").is_none(),
            applied > 8,
            "at step {applied}"
        );
        if applied == GROUPS.len() {
            assert!(
                first.iter().all(|key| FLOOR.contains(&key.as_str())),
                "{first:?}"
            );
        }
        target -= 40;
    }
    let every: BTreeSet<usize> = (0..=GROUPS.len()).collect();
    assert_eq!(seen, every, "each step was forced by some target");
}

#[tokio::test]
async fn omitted_names_the_sections_and_pieces_and_the_open_call_that_returns_them() {
    let (pack, tags) = rich(5);
    let fx = pack.host();
    let mut target = 12_000;
    loop {
        let result = fx
            .brief(json!({ "tags": tags, "sections": ALL_BUT_DETAIL, "maxBytes": target }))
            .await;
        if steps_applied(&result) == 4 {
            assert_eq!(
                *budget_omission(&result).unwrap(),
                json!({
                    "reason": "budget",
                    "sections": ["examples", "cssProperties"],
                    "pieces": ["eventDetail", "declaredAttributes"],
                    "open": {
                        "command": "components-open",
                        "sections": ["examples", "cssProperties", "events", "attributes"],
                    },
                })
            );
            let entries = data(&result)["content"]["components"].as_array().unwrap();
            for entry in entries {
                let events = entry["events"]["items"].as_array().unwrap();
                assert!(events.iter().all(|event| event.get("detail").is_none()));
                let attributes = entry["attributes"]["items"].as_array().unwrap();
                assert!(
                    attributes.iter().all(|a| a["name"] != "size"),
                    "{attributes:?}"
                );
            }
            return;
        }
        target -= 40;
        assert!(target > 1_024, "step 4 was never reached");
    }
}

#[tokio::test]
async fn a_requested_long_form_is_shed_first() {
    let (pack, tags) = rich(5);
    let fx = pack.host();
    let whole = fx.brief(json!({ "tags": tags, "detail": "full" })).await;
    let size = result_bytes(&whole);
    assert!(entry(&whole, "synthetic-item-0000")["detail"].is_string());
    let result = fx
        .brief(json!({ "tags": tags, "detail": "full", "maxBytes": size - 1 }))
        .await;
    assert_eq!(
        *budget_omission(&result).unwrap(),
        json!({
            "reason": "budget", "sections": ["detail"], "pieces": [],
            "open": { "command": "components-open", "sections": ["detail"] },
        })
    );
}

#[tokio::test]
async fn floors_that_do_not_fit_fail_with_how_many_leading_tags_would() {
    let (pack, tags) = rich(20);
    let fx = pack.host();
    let result = fx.brief(json!({ "tags": tags, "maxBytes": 3_000 })).await;
    assert_eq!(code(&result), "OUTPUT_BUDGET_EXCEEDED");
    let fits = result["error"]["details"]["fits"].as_u64().unwrap() as usize;
    assert!((1..20).contains(&fits), "{fits}");
    let suggestion = result["error"]["suggestion"].as_str().unwrap();
    assert!(suggestion.contains("dev.afd/outputBudget") && suggestion.contains("fewer"));
    let served = fx
        .brief(json!({ "tags": tags[..fits], "maxBytes": 3_000 }))
        .await;
    assert_eq!(count(&served), fits);
    let over = fx
        .brief(json!({ "tags": tags[..=fits], "maxBytes": 3_000 }))
        .await;
    assert_eq!(code(&over), "OUTPUT_BUDGET_EXCEEDED");
}

fn count(result: &Value) -> usize {
    data(result)["content"]["components"]
        .as_array()
        .unwrap()
        .len()
}

#[tokio::test]
async fn max_bytes_lowers_the_target_and_a_larger_budget_can_be_asked_for() {
    let (pack, tags) = rich(40);
    let fx = pack.host();
    let default = fx.brief(json!({ "tags": tags })).await;
    let (used, limit) = measured(&default);
    assert_eq!(limit, 40_000);
    assert!(used <= 40_000);
    assert!(
        steps_applied(&default) > 0,
        "40 rich entries do not fit 40 000 bytes whole"
    );
    let lowered = fx.brief(json!({ "tags": tags, "maxBytes": 20_000 })).await;
    assert!(result_bytes(&lowered) <= 20_000);
    assert_eq!(
        measured(&lowered).1,
        40_000,
        "maxBytes does not change the budget"
    );
    assert!(steps_applied(&lowered) >= steps_applied(&default));
    let larger = fx.brief_with_budget(json!({ "tags": tags }), 96_000).await;
    assert_eq!(measured(&larger).1, 96_000);
    assert!(steps_applied(&larger) < steps_applied(&default));
    let both = fx
        .brief_with_budget(json!({ "tags": tags, "maxBytes": 5_000 }), 96_000)
        .await;
    assert!(result_bytes(&both) <= 5_000);
}

#[tokio::test]
async fn with_no_rules_named_the_floors_leave_out_an_empty_rule_list() {
    let mut pack = Pack::default();
    pack.add_synthetic("bare", 30);
    let fx = pack.host();
    let tags: Vec<String> = (0..30).map(|i| format!("bare-item-{i:04}")).collect();
    let whole = fx.brief(json!({ "tags": tags, "detail": "full" })).await;
    assert_eq!(data(&whole)["content"]["rules"], json!([]));
    let size = result_bytes(&whole);
    // Below the whole answer, every step is reached; none names rule text, and the list goes.
    let shed = fx
        .brief(json!({ "tags": tags, "detail": "full", "maxBytes": size - 1 }))
        .await;
    assert!(data(&shed)["content"].get("rules").is_none(), "{shed}");
    assert!(result_bytes(&shed) < size);
    assert!(budget_omission(&shed).is_none_or(|o| !o["pieces"].to_string().contains("ruleText")));
}
