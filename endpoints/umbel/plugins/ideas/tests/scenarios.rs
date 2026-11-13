//! The scenario files beside the specification (section 14.3), read as written: for each step,
//! the command is called with its input after resolving `${{ steps[i].… }}` references, and
//! `success`, `data` and `error` are checked with the runner's matchers, as `packages/testing`'s
//! evaluator does. `ideas-review-apply` and `ideas-import` run at the command line as the space's
//! person, `ideas-export` as the operator, and every other command as the agent acting for her.
//!
//! A scenario runs up to its first step whose command a later step of the specification serves
//! (`ideas-ask` is step C2's, the review commands C3's and C4's); the table below holds how far
//! each file runs now, so a step that starts serving one is seen to.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::path::Path;

use serde_json::{Map, Value, json};
use support::*;
use yaml_rust2::{Yaml, YamlLoader};

/// Each file, and how many of its steps run before the first command not served yet.
const SCENARIOS: [(&str, usize); 8] = [
    ("01-capture-in-flow", 4),
    ("02-keep-a-brainstorm", 2),
    ("15-protect-affirmed", 1),
    ("21-ask-a-question", 2),
    ("22-review-a-batch", 3),
    ("24-take-it-back", 1),
    ("25-find-your-way", 4),
    ("28-leave-with-everything", 1),
];

/// Commands a later step serves.
const NOT_YET: [&str; 7] = [
    "ideas-ask",
    "ideas-review-stage",
    "ideas-review-show",
    "ideas-review-unstage",
    "ideas-review-preview",
    "ideas-review-apply",
    "ideas-review-report",
];

const MATCHERS: [&str; 10] = [
    "equals",
    "contains",
    "matches",
    "exists",
    "notExists",
    "length",
    "includes",
    "gte",
    "lte",
    "between",
];

fn json_of_yaml(yaml: &Yaml) -> Value {
    match yaml {
        Yaml::Real(text) => json!(text.parse::<f64>().unwrap()),
        Yaml::Integer(n) => json!(n),
        Yaml::String(text) => json!(text),
        Yaml::Boolean(flag) => json!(flag),
        Yaml::Array(items) => Value::from(items.iter().map(json_of_yaml).collect::<Vec<_>>()),
        Yaml::Hash(map) => {
            let mut out = Map::new();
            for (key, value) in map {
                let key = match key {
                    Yaml::String(text) => text.clone(),
                    Yaml::Integer(n) => n.to_string(),
                    other => panic!("a key that is not a string: {other:?}"),
                };
                out.insert(key, json_of_yaml(value));
            }
            Value::Object(out)
        }
        Yaml::Null => Value::Null,
        other => panic!("a YAML value the scenarios do not use: {other:?}"),
    }
}

fn load(name: &str) -> Value {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../docs/plugins/ideas/scenarios")
        .join(format!("{name}.scenario.yaml"));
    let text = std::fs::read_to_string(&path).unwrap();
    let docs = YamlLoader::load_from_str(&text).unwrap();
    assert_eq!(docs.len(), 1, "{name}: one document");
    json_of_yaml(&docs[0])
}

/// `name[index]` and member access, as `step-references.ts` reads a path.
fn at_path<'a>(value: &'a Value, path: &str) -> Option<&'a Value> {
    let mut current = value;
    for part in path.split('.') {
        if let Some((name, index)) = part.strip_suffix(']').and_then(|p| p.split_once('[')) {
            current = current.get(name)?.get(index.parse::<usize>().ok()?)?;
        } else {
            current = current.get(part)?;
        }
    }
    Some(current)
}

/// Resolve every `${{ steps[i].path }}` in `value`. A string that is exactly one reference keeps
/// the referenced value's type.
fn resolve(value: &Value, outputs: &[Value]) -> Value {
    match value {
        Value::String(text) => {
            let trimmed = text.trim();
            if let Some(inner) = trimmed
                .strip_prefix("${{")
                .and_then(|rest| rest.strip_suffix("}}"))
                && !inner.contains("${{")
            {
                let inner = inner.trim();
                let rest = inner.strip_prefix("steps[").unwrap();
                let (index, path) = rest.split_once("].").unwrap();
                let index: usize = index.parse().unwrap();
                assert!(index < outputs.len(), "step {index} has not run");
                return at_path(&outputs[index], path)
                    .unwrap_or_else(|| panic!("steps[{index}] has no value at {path}"))
                    .clone();
            }
            assert!(!text.contains("${{"), "an embedded reference: {text}");
            value.clone()
        }
        Value::Array(items) => Value::from(
            items
                .iter()
                .map(|i| resolve(i, outputs))
                .collect::<Vec<_>>(),
        ),
        Value::Object(map) => Value::Object(
            map.iter()
                .map(|(k, v)| (k.clone(), resolve(v, outputs)))
                .collect(),
        ),
        other => other.clone(),
    }
}

fn is_matcher(value: &Value) -> bool {
    value.as_object().is_some_and(|map| {
        let matched = map
            .keys()
            .filter(|k| MATCHERS.contains(&k.as_str()))
            .count();
        assert!(
            matched == 0 || matched == map.len(),
            "an assertion that mixes matcher keys with others: {value}"
        );
        matched > 0 && matched == map.len()
    })
}

/// The `matches` patterns the scenarios use: a literal, anchored with `^` or not.
fn matches(actual: &str, pattern: &str) -> bool {
    let (anchored, literal) = match pattern.strip_prefix('^') {
        Some(rest) => (true, rest),
        None => (false, pattern),
    };
    assert!(
        !literal.contains(['.', '*', '+', '?', '(', '[', '{', '|', '$', '\\']),
        "a pattern this reader does not run: {pattern}"
    );
    if anchored {
        actual.starts_with(literal)
    } else {
        actual.contains(literal)
    }
}

fn run_matcher(actual: Option<&Value>, name: &str, expected: &Value) -> bool {
    let missing = actual.is_none_or(Value::is_null);
    match name {
        "equals" => actual == Some(expected),
        "contains" => actual
            .and_then(Value::as_str)
            .zip(expected.as_str())
            .is_some_and(|(a, e)| a.contains(e)),
        "matches" => actual
            .and_then(Value::as_str)
            .zip(expected.as_str())
            .is_some_and(|(a, e)| matches(a, e)),
        "exists" => (expected == &json!(true)) != missing,
        "notExists" => (expected == &json!(true)) == missing,
        "length" => match actual {
            Some(Value::Array(items)) => json!(items.len()) == *expected,
            Some(Value::String(text)) => json!(text.chars().count()) == *expected,
            _ => false,
        },
        "includes" => actual
            .and_then(Value::as_array)
            .is_some_and(|items| items.contains(expected)),
        "gte" => actual
            .and_then(Value::as_f64)
            .zip(expected.as_f64())
            .is_some_and(|(a, e)| a >= e),
        "lte" => actual
            .and_then(Value::as_f64)
            .zip(expected.as_f64())
            .is_some_and(|(a, e)| a <= e),
        "between" => {
            let bounds = expected.as_array().map(|b| (b.first(), b.get(1), b.len()));
            match (actual.and_then(Value::as_f64), bounds) {
                (Some(a), Some((Some(min), Some(max), 2))) => {
                    min.as_f64().is_some_and(|min| a >= min)
                        && max.as_f64().is_some_and(|max| a <= max)
                }
                _ => false,
            }
        }
        other => panic!("a matcher this reader does not run: {other}"),
    }
}

/// The failed assertions of `expected` against `actual`, by path.
fn check_data(actual: Option<&Value>, expected: &Value, path: &str, failed: &mut Vec<String>) {
    let Some(map) = expected.as_object() else {
        if actual != Some(expected) {
            failed.push(format!("{path} equals {expected} (got {actual:?})"));
        }
        return;
    };
    for (key, wanted) in map {
        let here = format!("{path}.{key}");
        let got = actual.and_then(|a| a.get(key));
        if is_matcher(wanted) {
            for (name, value) in wanted.as_object().unwrap() {
                if !run_matcher(got, name, value) {
                    failed.push(format!("{here} {name} {value} (got {got:?})"));
                }
            }
        } else if wanted.is_object() {
            check_data(got, wanted, &here, failed);
        } else if got != Some(wanted) {
            failed.push(format!("{here} equals {wanted} (got {got:?})"));
        }
    }
}

fn evaluate(result: &Value, expect: &Value) -> Vec<String> {
    let mut failed = Vec::new();
    let success = expect["success"].as_bool().unwrap();
    if result["success"] != json!(success) {
        failed.push(format!("success equals {success}"));
        return failed;
    }
    if success {
        if let Some(wanted) = expect.get("data") {
            check_data(result.get("data"), wanted, "data", &mut failed);
        }
    } else if let Some(error) = expect.get("error") {
        let actual = &result["error"];
        if let Some(code) = error.get("code")
            && actual["code"] != *code
        {
            failed.push(format!("error.code equals {code}"));
        }
        if let Some(message) = error.get("message")
            && !run_matcher(actual.get("message"), "contains", message)
        {
            failed.push(format!("error.message contains {message}"));
        }
        if let Some(suggestion) = error.get("suggestion") {
            let got = actual.get("suggestion");
            let pairs: Vec<(String, Value)> = if is_matcher(suggestion) {
                suggestion
                    .as_object()
                    .unwrap()
                    .iter()
                    .map(|(k, v)| (k.clone(), v.clone()))
                    .collect()
            } else {
                vec![("contains".to_owned(), suggestion.clone())]
            };
            for (name, value) in pairs {
                if !run_matcher(got, &name, &value) {
                    failed.push(format!("error.suggestion {name} {value} (got {got:?})"));
                }
            }
        }
    }
    failed
}

/// Run one file up to its first command not served yet; how many steps ran.
async fn run(name: &str) -> usize {
    let scenario = load(name);
    let fx = Fx::new();
    let mut outputs: Vec<Value> = Vec::new();
    for (index, step) in scenario["steps"].as_array().unwrap().iter().enumerate() {
        let command = step["command"].as_str().unwrap();
        if NOT_YET.contains(&command) {
            return index;
        }
        let input = resolve(step.get("input").unwrap_or(&json!({})), &outputs);
        let result = match command {
            "ideas-import" => fx.person(command, input).await,
            "ideas-export" => fx.operator(command, input).await,
            _ => fx.agent(command, input).await,
        };
        let failed = evaluate(&result, &step["expect"]);
        assert!(
            failed.is_empty(),
            "{name} step {index} ({}): {failed:?}\n{result}",
            step["description"].as_str().unwrap_or("")
        );
        outputs.push(result);
    }
    outputs.len()
}

#[tokio::test]
async fn each_scenario_runs_as_far_as_this_step_serves() {
    for (name, expected) in SCENARIOS {
        let ran = run(name).await;
        assert_eq!(ran, expected, "{name}: steps run");
    }
}

#[test]
fn the_folder_holds_exactly_these_files() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../docs/plugins/ideas/scenarios");
    let mut found: Vec<String> = std::fs::read_dir(dir)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().into_string().unwrap())
        .collect();
    found.sort();
    let listed: Vec<String> = SCENARIOS
        .iter()
        .map(|(name, _)| format!("{name}.scenario.yaml"))
        .collect();
    assert_eq!(found, listed);
}
