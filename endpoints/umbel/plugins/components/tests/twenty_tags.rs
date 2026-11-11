//! A 20-tag request answered in one call inside the default budget (the proposal's step C2 exit,
//! and the shape of its criterion 1): from an override holding a synthetic library of FAST-AF's
//! size (77 components with guidance) beside the example library, with no requested tag missing
//! from both `components` and `unknown`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::{Value, json};
use support::*;

#[tokio::test]
async fn twenty_tags_are_answered_in_one_call_inside_the_default_budget() {
    let mut pack = Pack::example();
    pack.add_rich("synthetic", 77);
    let fx = pack.host();
    let mut requested: Vec<String> = (0..77)
        .step_by(4)
        .take(18)
        .map(|index| format!("synthetic-item-{index:04}"))
        .collect();
    requested.push("example-select".to_owned());
    requested.push("synthetic-item-9999".to_owned());
    assert_eq!(requested.len(), 20);

    let result = fx.brief(json!({ "tags": requested })).await;
    let (used, limit) = measured(&result);
    assert_eq!(limit, 40_000, "the default budget");
    assert!(used <= limit);
    let answered = tags(&result);
    let unknown: Vec<&str> = data(&result)["unknown"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["tag"].as_str().unwrap())
        .collect();
    assert_eq!(answered.len(), 19);
    assert_eq!(unknown, ["synthetic-item-9999"]);
    for tag in &requested {
        assert!(
            answered.contains(tag) || unknown.contains(&tag.as_str()),
            "{tag} was dropped"
        );
    }
    // In the order asked, with both libraries named and their rule ids qualified.
    assert_eq!(answered[..18], requested[..18]);
    assert_eq!(answered[18], "example-select");
    let libraries: Vec<&Value> = data(&result)["libraries"]
        .as_array()
        .unwrap()
        .iter()
        .map(|l| &l["library"])
        .collect();
    assert_eq!(libraries, [&json!("example"), &json!("synthetic")]);
    assert_eq!(
        entry(&result, "example-select")["rules"],
        json!(["example/field.labelling", "example/popup.focus-return"])
    );
    let omitted = &data(&result)["omitted"];
    println!("20 tags: {used} of {limit} bytes; omitted {omitted}");
    // Shared rules are stated once however many entries name them.
    let rules = data(&result)["content"]["rules"].as_array().unwrap();
    let ids: Vec<&str> = rules.iter().map(|r| r["id"].as_str().unwrap()).collect();
    assert_eq!(
        ids,
        [
            "example/field.labelling",
            "example/popup.focus-return",
            "synthetic/shared.focus",
            "synthetic/shared.labelling",
        ]
    );
}
