//! `spec/vectors/recovery.json` (`spec/recovery.md`): every valid CommandError passes
//! `spec/schema/error.json` and round-trips through [`CommandError`] unchanged, every normalizes
//! case passes it and reads to its `readsAs`, and every invalid one fails it and reads to exactly
//! its `readsAs`: the error with each recovery that breaks `$defs/recovery` dropped (rule 7).

use afd::{is_command_recovery, CommandError, InvalidRecovery, Recovery, RECOVERY_KINDS};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;

mod json_schema;
use json_schema::SchemaRegistry;

fn vectors() -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../spec/vectors/recovery.json");
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("cannot read {}: {error}", path.display()));
    serde_json::from_str(&text).expect("recovery.json is valid JSON")
}

fn cases<'a>(vectors: &'a Value, group: &str) -> &'a [Value] {
    let cases = vectors[group].as_array().expect("a case list");
    assert!(!cases.is_empty(), "no {group} cases");
    cases
}

/// Parse `error` as a [`CommandError`] and serialize it back.
fn read_and_write(name: &str, error: &Value) -> (CommandError, Value) {
    let parsed: CommandError = serde_json::from_value(error.clone())
        .unwrap_or_else(|e| panic!("{name}: the error does not read: {e}"));
    let written = serde_json::to_value(&parsed).expect("serializes");
    (parsed, written)
}

/// Whether `recovery` passes `$defs/recovery` on its own, without the error-level rules.
fn passes_recovery_schema(schemas: &SchemaRegistry, recovery: &Value) -> bool {
    schemas
        .validate_in(
            "error.json",
            &json!({ "$ref": "#/$defs/recovery" }),
            recovery,
        )
        .is_ok()
}

#[test]
fn a_valid_error_passes_the_schema_and_round_trips() {
    let vectors = vectors();
    let schemas = SchemaRegistry::load();
    for case in cases(&vectors, "valid") {
        let name = case["name"].as_str().expect("a name");
        let error = &case["error"];
        schemas
            .validate_file("error.json", error)
            .unwrap_or_else(|e| panic!("{name}: fails error.json: {e}"));
        let (parsed, written) = read_and_write(name, error);
        assert_eq!(
            parsed.recovery.is_some(),
            error.get("recovery").is_some(),
            "{name}: the recovery was not read"
        );
        assert_eq!(
            parsed.cause.as_ref().is_some_and(|c| c.recovery.is_some()),
            error.pointer("/cause/recovery").is_some(),
            "{name}: the cause's recovery was not read"
        );
        assert_eq!(&written, error, "{name}: changed on a round trip");
    }
}

#[test]
fn a_normalizing_error_passes_the_schema_and_reads_as_its_reads_as() {
    let vectors = vectors();
    let schemas = SchemaRegistry::load();
    for case in cases(&vectors, "normalizes") {
        let name = case["name"].as_str().expect("a name");
        schemas
            .validate_file("error.json", &case["error"])
            .unwrap_or_else(|e| panic!("{name}: fails error.json: {e}"));
        let (_, written) = read_and_write(name, &case["error"]);
        // `Value` equality tells `30000` from `30000.0`, so this also checks the integer form.
        assert_eq!(written, case["readsAs"], "{name}: does not read as readsAs");
    }
}

#[test]
fn an_invalid_error_fails_the_schema_and_reads_as_its_reads_as() {
    let vectors = vectors();
    let schemas = SchemaRegistry::load();
    for case in cases(&vectors, "invalid") {
        let name = case["name"].as_str().expect("a name");
        let rule = case["rule"].as_str().expect("a rule");
        let error = &case["error"];
        assert!(
            schemas.validate_file("error.json", error).is_err(),
            "{name}: passes error.json, but {rule}"
        );
        let (_, written) = read_and_write(name, error);
        assert_eq!(written, case["readsAs"], "{name}: does not read as readsAs");
    }
}

#[test]
fn a_recovery_is_kept_exactly_when_it_passes_the_recovery_schema() {
    // On the error and on its cause, in every list: the reader and `$defs/recovery` agree on each
    // recovery, so the reader neither accepts what the schema refuses nor drops what it accepts.
    // The invalid cases that break only the error-level `retryable` rules keep their recovery.
    let vectors = vectors();
    let schemas = SchemaRegistry::load();
    let mut checked = 0;
    for group in ["valid", "normalizes", "invalid"] {
        for case in cases(&vectors, group) {
            let name = case["name"].as_str().expect("a name");
            let error = &case["error"];
            let (parsed, _) = read_and_write(name, error);
            for (pointer, read) in [
                ("/recovery", parsed.recovery.as_deref()),
                (
                    "/cause/recovery",
                    parsed.cause.as_ref().and_then(|c| c.recovery.as_deref()),
                ),
            ] {
                let Some(recovery) = error.pointer(pointer) else {
                    continue;
                };
                let valid = passes_recovery_schema(&schemas, recovery);
                let readable = serde_json::from_value::<Recovery>(recovery.clone()).is_ok();
                assert_eq!(
                    readable, valid,
                    "{name} {pointer}: Recovery and the schema disagree"
                );
                assert_eq!(
                    is_command_recovery(recovery),
                    valid,
                    "{name} {pointer}: is_command_recovery and the schema disagree"
                );
                assert_eq!(
                    read.is_some(),
                    valid,
                    "{name} {pointer}: kept or dropped wrongly"
                );
                checked += 1;
            }
            assert_eq!(
                parsed.suggestion.as_deref(),
                Some("What to do next"),
                "{name}"
            );
        }
    }
    assert!(checked > 40, "only {checked} recoveries checked");
}

#[test]
fn a_recovery_this_version_cannot_read_is_no_recovery() {
    for recovery in [
        json!({ "kind": "reboot" }),
        json!({ "kind": "call" }),
        json!({ "kind": "stop", "reason": "x" }),
        json!({ "kind": "retry", "afterMs": -1 }),
        json!({ "kind": "retry", "afterMs": "30000" }),
        json!({ "kind": "retry", "afterMs": 1.5 }),
        json!({ "kind": "retry", "afterMs": 9_007_199_254_740_992.0 }),
        json!({ "kind": "retry", "afterMs": null }),
        json!({ "kind": "fix-input", "input": null }),
        json!({ "kind": "fix-input", "input": { "confirm": true } }),
        json!({ "kind": "fix-input", "needs": ["a", "a"] }),
        json!({ "kind": "call", "command": "x", "thenRetry": 1 }),
        json!("call"),
        Value::Null,
    ] {
        let error: CommandError = serde_json::from_value(json!({
            "code": "X",
            "message": "m",
            "suggestion": "s",
            "retryable": false,
            "recovery": recovery,
            "details": { "a": 1 },
        }))
        .unwrap_or_else(|e| panic!("{recovery}: the error does not read: {e}"));
        assert_eq!(error.recovery, None, "{recovery}");
        assert_eq!(error.code, "X");
        assert_eq!(error.suggestion.as_deref(), Some("s"));
        assert_eq!(error.retryable, Some(false));
        assert!(error.details.is_some());
        assert_eq!(
            serde_json::to_value(&error).unwrap().get("recovery"),
            None,
            "{recovery}: an unread recovery is not written back"
        );
    }
}

#[test]
fn a_wait_reads_as_json_schema_reads_an_integer() {
    for (after_ms, expected) in [
        (json!(30000.0), 30_000),
        (json!(1e3), 1_000),
        (json!(-0.0), 0),
        (json!(9_007_199_254_740_991.0), 9_007_199_254_740_991),
        (json!(9_007_199_254_740_991u64), 9_007_199_254_740_991),
    ] {
        let recovery: Recovery =
            serde_json::from_value(json!({ "kind": "retry", "afterMs": after_ms }))
                .unwrap_or_else(|e| panic!("{after_ms}: does not read: {e}"));
        assert_eq!(
            recovery,
            Recovery::retry(Some(expected)).unwrap(),
            "{after_ms}"
        );
    }
    // Past 2^53 - 1, the schema's maximum, no wait reads, however it is written.
    for after_ms in [
        json!(9_007_199_254_740_992u64),
        json!(u64::MAX),
        json!(1e20),
    ] {
        assert!(
            serde_json::from_value::<Recovery>(json!({ "kind": "retry", "afterMs": after_ms }))
                .is_err(),
            "{after_ms}"
        );
    }
    assert!(Recovery::retry(Some(afd::MAX_AFTER_MS + 1)).is_err());
}

/// Build the same recovery through the public constructors, from its fields as read by pattern.
fn rebuild(recovery: &Recovery) -> Result<Recovery, InvalidRecovery> {
    match recovery {
        Recovery::Call {
            command,
            input,
            needs,
            then_retry,
            ..
        } => Recovery::call_with(command.clone(), input.clone(), needs.clone(), *then_retry),
        Recovery::FixInput { input, needs, .. } => {
            Recovery::fix_input(input.clone(), needs.clone())
        }
        Recovery::Retry { after_ms, .. } => Recovery::retry(*after_ms),
        Recovery::External { .. } => Ok(Recovery::external()),
        Recovery::Stop { .. } => Ok(Recovery::stop()),
        other => panic!("a kind this test does not know: {}", other.kind()),
    }
}

#[test]
fn every_valid_recovery_can_be_built_with_the_constructors() {
    let vectors = vectors();
    for case in cases(&vectors, "valid") {
        let name = case["name"].as_str().expect("a name");
        for pointer in ["/error/recovery", "/error/cause/recovery"] {
            let Some(recovery) = case.pointer(pointer) else {
                continue;
            };
            let read: Recovery = serde_json::from_value(recovery.clone())
                .unwrap_or_else(|e| panic!("{name}: does not read: {e}"));
            let built = rebuild(&read).unwrap_or_else(|e| panic!("{name}: refused: {e}"));
            assert_eq!(built, read, "{name}");
            assert_eq!(&serde_json::to_value(&built).unwrap(), recovery, "{name}");
        }
    }
}

#[test]
fn a_constructor_refuses_what_the_schema_refuses() {
    let schemas = SchemaRegistry::load();
    let one = |key: &str, value: Value| HashMap::from([(key.to_string(), value)]);
    let names = |names: &[&str]| Some(names.iter().map(|n| n.to_string()).collect::<Vec<_>>());
    for (built, wire) in [
        (Recovery::call(""), json!({ "kind": "call", "command": "" })),
        (
            Recovery::call_with("x-y", Some(HashMap::new()), None, None),
            json!({ "kind": "call", "command": "x-y", "input": {} }),
        ),
        (
            Recovery::call_with("x-y", Some(one("confirm", json!(true))), None, None),
            json!({ "kind": "call", "command": "x-y", "input": { "confirm": true } }),
        ),
        (
            Recovery::call_with("x-y", None, names(&[]), None),
            json!({ "kind": "call", "command": "x-y", "needs": [] }),
        ),
        (
            Recovery::call_with("x-y", None, names(&["a", "a"]), None),
            json!({ "kind": "call", "command": "x-y", "needs": ["a", "a"] }),
        ),
        (
            Recovery::fix_input(None, names(&[""])),
            json!({ "kind": "fix-input", "needs": [""] }),
        ),
        (
            Recovery::fix_input(None, None),
            json!({ "kind": "fix-input" }),
        ),
        (
            Recovery::fix_input(Some(one("confirm", json!(true))), None),
            json!({ "kind": "fix-input", "input": { "confirm": true } }),
        ),
    ] {
        assert!(built.is_err(), "{wire}: built");
        assert!(
            !passes_recovery_schema(&schemas, &wire),
            "{wire}: the schema accepts it"
        );
    }
}

#[test]
fn validate_checks_a_recovery_changed_after_it_was_built() {
    let mut recovery = Recovery::call("issue-check").unwrap();
    assert_eq!(recovery.validate(), Ok(()));
    if let Recovery::Call { command, .. } = &mut recovery {
        command.clear();
    }
    let refused = recovery.validate().unwrap_err();
    assert_eq!(refused.reason(), "a call recovery names its command");
}

#[test]
fn a_recovery_built_in_rust_serializes_as_the_spec_says() {
    let error = CommandError::new("LANE_PAUSED", "The lane is paused")
        .with_suggestion("Call lane-resume, then lane-enqueue again")
        .with_recovery(Recovery::call_with("lane-resume", None, None, Some(true)).unwrap());
    assert_eq!(
        serde_json::to_value(&error).unwrap(),
        json!({
            "code": "LANE_PAUSED",
            "message": "The lane is paused",
            "suggestion": "Call lane-resume, then lane-enqueue again",
            "recovery": { "kind": "call", "command": "lane-resume", "thenRetry": true },
        })
    );
    assert_eq!(
        serde_json::to_value(Recovery::retry(Some(30_000)).unwrap()).unwrap(),
        json!({ "kind": "retry", "afterMs": 30000 })
    );
    assert_eq!(
        serde_json::to_value(Recovery::retry(None).unwrap()).unwrap(),
        json!({ "kind": "retry" })
    );
    assert_eq!(
        serde_json::to_value(Recovery::fix_input(None, Some(vec!["branch".to_string()])).unwrap())
            .unwrap(),
        json!({ "kind": "fix-input", "needs": ["branch"] })
    );
    assert_eq!(
        serde_json::to_value(Recovery::external()).unwrap(),
        json!({ "kind": "external" })
    );
    assert_eq!(
        serde_json::to_value(Recovery::stop()).unwrap(),
        json!({ "kind": "stop" })
    );
    assert_eq!(
        serde_json::to_value(Recovery::call("issue-check").unwrap()).unwrap(),
        json!({ "kind": "call", "command": "issue-check" })
    );
}

#[test]
fn every_kind_is_named_in_spec_order() {
    let kinds: Vec<&str> = [
        Recovery::call("x").unwrap(),
        Recovery::fix_input(None, Some(vec!["a".to_string()])).unwrap(),
        Recovery::retry(None).unwrap(),
        Recovery::external(),
        Recovery::stop(),
    ]
    .iter()
    .map(Recovery::kind)
    .collect();
    assert_eq!(kinds, RECOVERY_KINDS);
    let schema: Value = serde_json::from_str(
        &std::fs::read_to_string(json_schema::schema_dir().join("error.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(
        schema["$defs"]["recovery"]["properties"]["kind"]["enum"],
        json!(RECOVERY_KINDS)
    );
}
