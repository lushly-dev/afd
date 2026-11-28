//! The feature's `m1` scenarios (`docs/features/active/loam-os/scenarios/`), read as written,
//! as Umbel's ideas plugin reads its own: each file gets a fresh host seeded from its fixture
//! merged over the fixture's `base` (`support::fixture`), with fakes for the runtime, the git
//! source, the clock and the records. Umbel's journal is real; only the storage under its
//! policies is faked, so it can fail writes. For each step the command is called as the test
//! actor with its input after resolving `${{ steps[i].… }}` references, and `success`, `data` and
//! `error` are checked with the runner's matchers, as `packages/testing`'s evaluator checks them.
//!
//! [`SCENARIOS`] holds how far each file runs before it reaches a command or behaviour not built
//! yet. The step after that must not pass, so a step that builds one has to move the row
//! forward. Where the steps before a step are not built but the step itself is, and it reads
//! nothing they returned, it also runs alone against a fresh host from the fixture, listed in its
//! row. A row moves forward until every file runs in full, which M1's exit needs (the M1 plan's
//! [The scenario harness]).
//!
//! [The scenario harness]: ../../../../docs/features/active/loam-os/m1.plan.md#the-scenario-harness
use crate::support::fixture::{self, Use};

use serde_json::{Map, Value, json};
use yaml_rust2::{Yaml, YamlLoader};

/// A file, how many of its steps run in order, and the steps that run alone (see the module).
///
/// As of M1 step 2 (#2914), only `host-status` is built:
///
/// - 01, 09: the first step, `host-status`, passes; the second is `machine-create` (step 3).
/// - 08, 18: the first step is `machine-create` (step 3) and `run-get` (step 4); the last,
///   `host-status` with no active machine, runs alone. Neither fixture has an active machine,
///   so that step shows only that a destroyed machine is not counted; 09 shows the count.
/// - 14: `host-status` shows the journal down (`writable: false`); then `machine-create` (step 3).
/// - 17: `host-status` shows the runtime down; then `machine-create` (step 3).
/// - 10: `host-status` does not yet say when the host restarted (step 7).
/// - 16: its first step is `machine-create` (step 3), and its `host-status` steps need it or the
///   disk measure (step 5).
/// - 02 to 07, 11 and 15 open with `machine-create` (step 3).
const SCENARIOS: [(&str, usize, &[usize]); 16] = [
    ("01-validate-a-head-in-a-machine", 1, &[]),
    ("02-give-a-machine-no-credential", 0, &[]),
    ("03-reach-only-what-the-step-may", 0, &[]),
    ("04-stop-a-run-over-its-limits", 0, &[]),
    ("05-read-a-failure-in-brief", 0, &[]),
    ("06-push-on-a-machine-validation", 0, &[]),
    ("07-stop-a-run-now", 0, &[]),
    ("08-leave-nothing-behind", 0, &[9]),
    ("09-refuse-what-is-not-offered", 1, &[]),
    ("10-restart-without-a-false-pass", 0, &[]),
    ("11-see-what-ran-and-who-asked", 0, &[]),
    ("14-keep-stopping-when-the-record-is-down", 1, &[]),
    ("15-see-inside-without-touching", 0, &[]),
    ("16-clear-leftovers-and-old-records", 0, &[]),
    ("17-tell-host-trouble-from-a-branch-failure", 1, &[]),
    ("18-reproduce-a-failure-in-a-machine", 0, &[8]),
];

/// The scenarios that are not M1's: the warm starts, M2's.
const NOT_M1: [&str; 2] = [
    "12-start-from-a-prepared-workspace",
    "13-keep-a-branch-out-of-the-next",
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
    let path = fixture::scenarios_dir().join(format!("{name}.scenario.yaml"));
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

/// Whether `value` holds a `${{ … }}` reference anywhere.
fn refers(value: &Value) -> bool {
    match value {
        Value::String(text) => text.contains("${{"),
        Value::Array(items) => items.iter().any(refers),
        Value::Object(map) => map.values().any(refers),
        _ => false,
    }
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

/// Deep equality, with numbers compared by value: `400` and `400.0` are the same.
fn same(actual: &Value, expected: &Value) -> bool {
    match (actual, expected) {
        (Value::Number(a), Value::Number(e)) => a.as_f64() == e.as_f64(),
        (Value::Array(a), Value::Array(e)) => {
            a.len() == e.len() && a.iter().zip(e).all(|(a, e)| same(a, e))
        }
        (Value::Object(a), Value::Object(e)) => {
            a.len() == e.len() && a.iter().all(|(k, v)| e.get(k).is_some_and(|w| same(v, w)))
        }
        _ => actual == expected,
    }
}

fn run_matcher(actual: Option<&Value>, name: &str, expected: &Value) -> bool {
    let missing = actual.is_none_or(Value::is_null);
    match name {
        "equals" => actual.is_some_and(|a| same(a, expected)),
        // Strings only, as the runner's (`includes` is the list matcher).
        "contains" => actual
            .and_then(Value::as_str)
            .zip(expected.as_str())
            .is_some_and(|(a, e)| a.contains(e)),
        "matches" => actual
            .and_then(Value::as_str)
            .zip(expected.as_str())
            .is_some_and(|(a, e)| regex::Regex::new(e).unwrap().is_match(a)),
        "exists" => (expected == &json!(true)) != missing,
        "notExists" => (expected == &json!(true)) == missing,
        "length" => match actual {
            Some(Value::Array(items)) => same(&json!(items.len()), expected),
            Some(Value::String(text)) => same(&json!(text.chars().count()), expected),
            _ => false,
        },
        "includes" => actual
            .and_then(Value::as_array)
            .is_some_and(|items| items.iter().any(|item| same(item, expected))),
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

/// The failed assertions of `expected` against `actual` at `path`: a matcher, a nested object
/// of field assertions, a list holding objects (the same length, matched item by item), or a
/// literal compared whole.
fn check_value(actual: Option<&Value>, expected: &Value, path: &str, failed: &mut Vec<String>) {
    if is_matcher(expected) {
        for (name, value) in expected.as_object().unwrap() {
            if !run_matcher(actual, name, value) {
                failed.push(format!("{path} {name} {value} (got {actual:?})"));
            }
        }
    } else if let Some(items) = expected
        .as_array()
        .filter(|items| items.iter().any(Value::is_object))
    {
        let got = actual.and_then(Value::as_array);
        if got.is_none_or(|got| got.len() != items.len()) {
            failed.push(format!(
                "{path} length {} (got {:?})",
                items.len(),
                got.map(Vec::len)
            ));
        }
        for (index, item) in items.iter().enumerate() {
            let here = format!("{path}[{index}]");
            check_value(got.and_then(|got| got.get(index)), item, &here, failed);
        }
    } else if let Some(map) = expected.as_object() {
        for (key, wanted) in map {
            let got = actual.and_then(|a| a.get(key));
            check_value(got, wanted, &format!("{path}.{key}"), failed);
        }
    } else if !actual.is_some_and(|a| same(a, expected)) {
        failed.push(format!("{path} equals {expected} (got {actual:?})"));
    }
}

/// What this reader checks of an `expect`; anything else the runner checks (`reasoning`,
/// `confidence`, `error.recovery`) stops it, so a scenario never passes here on a part it skips.
const EXPECT_KEYS: [&str; 3] = ["success", "data", "error"];
const ERROR_KEYS: [&str; 3] = ["code", "message", "suggestion"];

fn evaluate(result: &Value, expect: &Value) -> Vec<String> {
    for key in expect.as_object().unwrap().keys() {
        assert!(
            EXPECT_KEYS.contains(&key.as_str()),
            "an expect key this reader does not check: {key}"
        );
    }
    for key in expect
        .get("error")
        .and_then(Value::as_object)
        .into_iter()
        .flat_map(Map::keys)
    {
        assert!(
            ERROR_KEYS.contains(&key.as_str()),
            "an expect.error key this reader does not check: {key}"
        );
    }
    let mut failed = Vec::new();
    let success = expect["success"].as_bool().unwrap();
    if result["success"] != json!(success) {
        failed.push(format!("success equals {success}"));
        return failed;
    }
    if success {
        if let Some(wanted) = expect.get("data") {
            check_value(result.get("data"), wanted, "data", &mut failed);
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

/// The scenario's fixture, merged over its base.
fn fixture_of(scenario: &Value) -> Value {
    let part = &scenario["fixture"];
    fixture::load(part["file"].as_str().unwrap(), part["base"].as_str())
}

/// Call one step as the test actor, after resolving its references.
async fn call(host: &umbel::Host, step: &Value, outputs: &[Value]) -> Value {
    let command = step["command"].as_str().unwrap();
    let input = resolve(step.get("input").unwrap_or(&json!({})), outputs);
    let result = crate::support::call_as(host, "scenario", command, input).await;
    serde_json::to_value(&result).unwrap()
}

/// Run one file as its row says: `runs` steps in order, then the next one, which must not pass
/// yet, then each step of `alone` on a fresh host.
async fn play(name: &str, runs: usize, alone: &[usize]) {
    let scenario = load(name);
    let steps = scenario["steps"].as_array().unwrap();
    assert!(
        runs <= steps.len(),
        "{name}: {runs} of {} steps",
        steps.len()
    );
    let fixture = fixture_of(&scenario);
    let seeded = fixture::seed(&fixture);
    let mut outputs: Vec<Value> = Vec::new();
    for (index, step) in steps.iter().enumerate().take(runs) {
        let result = call(&seeded.host, step, &outputs).await;
        let failed = evaluate(&result, &step["expect"]);
        assert!(
            failed.is_empty(),
            "{name} step {index} ({}): {failed:?}\n{result}",
            step["description"].as_str().unwrap_or("")
        );
        outputs.push(result);
    }
    if let Some(next) = steps.get(runs) {
        let result = call(&seeded.host, next, &outputs).await;
        assert!(
            !evaluate(&result, &next["expect"]).is_empty(),
            "{name} step {runs} passes now: move its row in SCENARIOS forward\n{result}"
        );
    }
    for &index in alone {
        assert!(index > runs, "{name}: step {index} already runs in order");
        let step = &steps[index];
        assert!(
            !refers(step),
            "{name} step {index} reads an earlier step, so it cannot run alone"
        );
        let fresh = fixture::seed(&fixture);
        let result = call(&fresh.host, step, &[]).await;
        let failed = evaluate(&result, &step["expect"]);
        assert!(
            failed.is_empty(),
            "{name} step {index} alone ({}): {failed:?}\n{result}",
            step["description"].as_str().unwrap_or("")
        );
    }
}

#[tokio::test]
async fn each_scenario_runs_as_far_as_this_step_builds() {
    for (name, runs, alone) in SCENARIOS {
        play(name, runs, alone).await;
    }
}

#[test]
fn the_table_lists_every_m1_scenario_and_only_those() {
    let mut found: Vec<String> = std::fs::read_dir(fixture::scenarios_dir())
        .unwrap()
        .filter_map(|entry| {
            let name = entry.unwrap().file_name().into_string().unwrap();
            name.strip_suffix(".scenario.yaml").map(str::to_owned)
        })
        .collect();
    found.sort();
    let mut listed: Vec<String> = SCENARIOS
        .iter()
        .map(|(name, _, _)| (*name).to_owned())
        .chain(NOT_M1.iter().map(|name| (*name).to_owned()))
        .collect();
    listed.sort();
    assert_eq!(found, listed);
    for (name, _, _) in SCENARIOS {
        let tags = &load(name)["tags"];
        assert!(
            tags.as_array().unwrap().contains(&json!("m1")),
            "{name}: {tags}"
        );
    }
    for name in NOT_M1 {
        let tags = &load(name)["tags"];
        assert!(
            !tags.as_array().unwrap().contains(&json!("m1")),
            "{name}: {tags}"
        );
    }
}

#[test]
fn the_harness_covers_the_fixtures_the_m1_scenarios_use() {
    let mut used: Vec<String> = SCENARIOS
        .iter()
        .map(|(name, _, _)| {
            let file = load(name)["fixture"]["file"].as_str().unwrap().to_owned();
            file.trim_start_matches("fixtures/")
                .trim_end_matches(".json")
                .to_owned()
        })
        .collect();
    used.sort();
    used.dedup();
    let mut covered: Vec<String> = fixture::M1_FIXTURES
        .iter()
        .map(|name| (*name).to_owned())
        .collect();
    covered.sort();
    assert_eq!(used, covered);
}

#[test]
fn every_part_of_every_fixture_is_applied_or_waits_for_its_step() {
    let mut seen = std::collections::BTreeSet::new();
    for name in fixture::M1_FIXTURES {
        let merged = if name == "host" {
            fixture::read(name)
        } else {
            fixture::merge(fixture::read("host"), fixture::read(name))
        };
        let mut leaves = Vec::new();
        fixture::leaves(&merged, "", &mut leaves);
        for leaf in leaves {
            let (part, use_) = fixture::part_of(&leaf)
                .unwrap_or_else(|| panic!("{name}: `{leaf}` is in no row of fixture::PARTS"));
            if let Use::Later(step) = use_ {
                assert!(!step.is_empty(), "{part}");
            }
            seen.insert(part);
        }
    }
    let unused: Vec<&str> = fixture::PARTS
        .iter()
        .map(|(part, _)| *part)
        .filter(|part| !seen.contains(part))
        .collect();
    assert!(unused.is_empty(), "rows no fixture has: {unused:?}");
}

#[test]
fn a_fixture_merges_over_its_base_key_by_key_and_lists_replace() {
    let merged = fixture::merge(
        json!({ "a": { "b": 1, "c": 2 }, "list": [1, 2], "keep": true }),
        json!({ "a": { "c": 3 }, "list": [9] }),
    );
    assert_eq!(
        merged,
        json!({ "a": { "b": 1, "c": 3 }, "list": [9], "keep": true })
    );
}

#[tokio::test]
async fn a_seeded_host_holds_the_fixtures_records_and_objects() {
    let seeded = fixture::seed(&fixture::load("fixtures/full.json", Some("host.json")));
    use loam_os_host::records::Records;
    use loam_os_host::runtime::Runtime;
    let machines = seeded.records.machines().unwrap();
    assert_eq!(
        machines.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(),
        ["m-01", "m-02", "m-expired"]
    );
    // Each ready machine's container and three volumes are on the runtime; the destroyed one's
    // are not.
    let labelled = seeded.runtime.labelled().unwrap();
    assert_eq!(labelled.containers, ["loam-os-m-01", "loam-os-m-02"]);
    assert_eq!(labelled.volumes.len(), 6);
    use loam_os_host::source::Source;
    assert_eq!(
        seeded.source.branch_head("example-repo", "main").unwrap(),
        Some("0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f".to_owned())
    );
    assert!(
        seeded
            .source
            .contains("example-repo", "3f9a2c4e5b6d7081928374a5b6c7d8e9f0a1b2c3")
            .unwrap()
    );
    assert!(
        !seeded
            .source
            .contains("example-repo", &"f".repeat(40))
            .unwrap()
    );
    // The journal's storage takes writes: the host's own policies set, its required mode on.
    let status = crate::support::call_as(&seeded.host, "scenario", "host-status", json!({})).await;
    let data = status.data.unwrap();
    assert_eq!(data["journal"]["mode"], "required");
    assert_eq!(data["journal"]["writable"], true);
    seeded.storage.set_down(Some("disk full"));
    let status = crate::support::call_as(&seeded.host, "scenario", "host-status", json!({})).await;
    assert_eq!(status.data.unwrap()["journal"]["dropped"], 0);
    // The entry of that read was dropped, and counted.
    let status = crate::support::call_as(&seeded.host, "scenario", "host-status", json!({})).await;
    let journal = &status.data.unwrap()["journal"];
    assert_eq!(journal["writable"], false, "{journal}");
    assert_eq!(journal["dropped"], 1, "{journal}");
}
