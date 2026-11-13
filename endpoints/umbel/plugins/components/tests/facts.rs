//! The proposal's criterion 3, "it still answers": `tests/fast_af/facts.json` holds questions about
//! FAST-AF's components, each with the JSON value that answers it, and tags that do not exist.
//! One brief of every tag, at the default budget, from FAST-AF's export (see `fast_af.rs`): each
//! fact is in it, or its `omitted` names the `components-open` call that holds it, and that call
//! does; each tag that does not exist is in `unknown`. Deterministic, with no model.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::{Value, json};
use support::*;

/// A value with every `basis` and `flags` left out, as the fixture writes its answers.
fn bare(value: &Value) -> Value {
    match value {
        Value::Object(map) => Value::Object(
            map.iter()
                .filter(|(key, _)| *key != "basis" && *key != "flags")
                .map(|(key, item)| (key.clone(), bare(item)))
                .collect(),
        ),
        Value::Array(items) => Value::Array(items.iter().map(bare).collect()),
        other => other.clone(),
    }
}

/// The section of an answer a fact is in: `ruleText` is in the rules' text.
fn open_section(fact: &Value) -> &str {
    match fact["section"].as_str().unwrap() {
        "ruleText" => "rules",
        other => other,
    }
}

/// The fact's value in one component's answer and its rule texts, when they hold it.
fn find(fact: &Value, component: &Value, rules: &Value) -> Option<Value> {
    let section = fact["section"].as_str().unwrap();
    let field = fact["field"].as_str();
    match section {
        "floor" => component.get(field.unwrap()).cloned(),
        "ruleText" => rules
            .as_array()?
            .iter()
            .find(|rule| rule["id"] == fact["match"]["id"])
            .and_then(|rule| rule.get(field.unwrap()))
            .cloned(),
        "rules" | "gaps" => {
            let held = component.get(section)?.as_array()?;
            held.iter()
                .any(|item| bare(item) == fact["contains"])
                .then(|| fact["contains"].clone())
        }
        _ => {
            let items = component.get(section)?.get("items")?.as_array()?;
            let matcher = fact["match"].as_object().unwrap();
            let item = items
                .iter()
                .find(|item| matcher.iter().all(|(key, want)| &item[key] == want))?;
            item.get(field.unwrap()).map(bare)
        }
    }
}

#[tokio::test]
async fn every_fact_is_in_the_brief_or_the_open_call_it_names() {
    let fixture: Value =
        serde_json::from_slice(&std::fs::read(fast_af_fixtures().join("facts.json")).unwrap())
            .unwrap();
    let facts = fixture["facts"].as_array().unwrap();
    assert!(facts.len() >= 40, "about forty facts");
    let mut requested: Vec<String> = Vec::new();
    for fact in facts {
        let tag = fact["tag"].as_str().unwrap().to_owned();
        if !requested.contains(&tag) {
            requested.push(tag);
        }
    }
    let missing: Vec<String> = fixture["unknown"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["tag"].as_str().unwrap().to_owned())
        .collect();
    requested.extend(missing.iter().cloned());

    let fx = Pack::fast_af().host();
    let brief = fx.brief(json!({ "tags": requested })).await;
    let (used, limit) = measured(&brief);
    assert!(used <= limit);
    let answer = data(&brief);
    let open_sections: Vec<&str> = answer["omitted"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|entry| entry["open"]["sections"].as_array())
        .flatten()
        .map(|section| section.as_str().unwrap())
        .collect();
    for entry in answer["omitted"].as_array().unwrap() {
        if entry.get("open").is_some() {
            assert_eq!(entry["open"]["command"], "components-open");
        }
    }

    let (mut in_brief, mut in_open) = (0, 0);
    for fact in facts {
        let id = fact["id"].as_str().unwrap();
        let tag = fact["tag"].as_str().unwrap();
        let want = fact.get("answer").unwrap_or(&fact["contains"]);
        if let Some(found) = find(fact, entry(&brief, tag), &answer["content"]["rules"]) {
            assert_eq!(&found, want, "{id}: the brief's answer differs");
            in_brief += 1;
            continue;
        }
        let section = open_section(fact);
        assert!(
            open_sections.contains(&section),
            "{id}: not in the brief, and its omitted names no open of {section}: {}",
            answer["omitted"]
        );
        let opened = fx.open(json!({ "tag": tag, "sections": [section] })).await;
        let content = &data(&opened)["content"];
        let found = find(fact, &content["component"], &content["rules"])
            .unwrap_or_else(|| panic!("{id}: components-open of {section} does not hold it"));
        assert_eq!(&found, want, "{id}: components-open's answer differs");
        in_open += 1;
    }

    for item in fixture["unknown"].as_array().unwrap() {
        let tag = &item["tag"];
        let listed = answer["unknown"]
            .as_array()
            .unwrap()
            .iter()
            .find(|unknown| &unknown["tag"] == tag)
            .unwrap_or_else(|| panic!("{tag} is not in unknown"));
        assert_eq!(listed["reason"], "not-found");
        if let Some(nearest) = item.get("nearest") {
            assert_eq!(&listed["nearest"], nearest, "{tag}");
        }
    }
    eprintln!(
        "facts: {} facts over {} tags, {in_brief} in the brief and {in_open} by the open call it names; brief {used} of {limit} bytes; omitted {}",
        facts.len(),
        requested.len() - missing.len(),
        answer["omitted"]
    );
}
