use super::*;
use crate::result::{failure, success, success_with, ResultOptions};
use serde_json::json;
use std::sync::atomic::{AtomicUsize, Ordering};

fn ok_step(index: usize, data: serde_json::Value) -> StepResult {
    StepResult::new(index, format!("cmd-{index}"), StepStatus::Success).with_data(data)
}

fn context_with_prev(data: serde_json::Value) -> PipelineContext {
    let mut context = PipelineContext::default();
    context.push_step(ok_step(0, data));
    context
}

fn counting_executor(calls: Arc<AtomicUsize>) -> CommandExecutor {
    Arc::new(move |_name, input, _ctx| {
        calls.fetch_add(1, Ordering::SeqCst);
        Box::pin(async move { success(input) })
    })
}

/// Executor that echoes its input as data.
fn echo_executor() -> CommandExecutor {
    counting_executor(Arc::new(AtomicUsize::new(0)))
}

fn nested_object(levels: usize) -> serde_json::Value {
    let mut value = json!({});
    for _ in 1..levels {
        value = json!({ "a": value });
    }
    value
}

// ═══════════════════════════════════════════════════════════════════════════
// REQUEST AND CONDITION TYPES
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_pipeline_request_creation() {
    let request = create_pipeline(
        vec![PipelineStep::new("test-command")
            .with_input(json!({"key": "value"}))
            .with_alias("step1")],
        None,
    );

    assert!(request.id.is_none());
    assert_eq!(request.steps.len(), 1);
    assert_eq!(request.steps[0].command, "test-command");
}

#[test]
fn test_pipeline_step_serialization() {
    let step = PipelineStep::new("user-get")
        .with_input(json!({"id": 123}))
        .with_alias("user");

    let json = serde_json::to_string(&step).unwrap();
    assert!(json.contains("\"command\":\"user-get\""));
    assert!(json.contains("\"as\":\"user\""));
}

#[test]
fn test_pipeline_request_round_trip_with_input_and_conditions() {
    let json = json!({
        "id": "p-1",
        "input": {"userId": 7},
        "options": {"continueOnFailure": true, "timeoutMs": 250},
        "steps": [
            {"command": "user-get", "input": {"id": "$input.userId"}, "as": "user"},
            {
                "command": "order-list",
                "when": {"$and": [
                    {"$exists": "$steps.user.id"},
                    {"$not": {"$eq": ["$steps.user.tier", "free"]}},
                    {"$gte": ["$steps.user.orders", 1]}
                ]}
            }
        ]
    });
    let request: PipelineRequest = serde_json::from_value(json.clone()).unwrap();
    assert_eq!(request.input, Some(json!({"userId": 7})));
    assert!(matches!(
        request.steps[1].when,
        Some(PipelineCondition::And { .. })
    ));
    assert_eq!(serde_json::to_value(&request).unwrap(), json);
}

#[test]
fn test_malformed_envelopes_do_not_deserialize() {
    let step = json!({"command": "work-run"});
    for request in [
        json!({"steps": [{"command": " "}]}),
        json!({"steps": [{"command": "\u{feff}\n"}]}),
        json!({"steps": [{"command": "work-run", "input": []}]}),
        json!({"steps": [{"command": "work-run", "input": null}]}),
        json!({"steps": [{"command": "work-run", "input": "text"}]}),
        json!({"steps": [{"command": "work-run", "as": null}]}),
        json!({"steps": [{"command": "work-run", "when": null}]}),
        json!({"steps": [{"command": "work-run", "stream": null}]}),
        json!({"id": null, "steps": [step]}),
        json!({"steps": [step], "options": null}),
        json!({"steps": [step], "options": {"timeoutMs": -5}}),
        json!({"steps": [step], "options": {"timeoutMs": null}}),
        json!({"steps": [step], "options": {"continueOnFailure": null}}),
        json!({"steps": [step], "options": {"parallel": null}}),
        json!({"steps": [step], "options": {"onProgress": 1}}),
        json!({"steps": [step], "options": {"onProgress": null}}),
    ] {
        assert!(
            serde_json::from_value::<PipelineRequest>(request.clone()).is_err(),
            "{request} should not deserialize"
        );
    }

    let accepted: PipelineRequest = serde_json::from_value(json!({
        "input": null,
        "steps": [{"command": "work-run", "input": {}, "stream": false}],
        "options": {"timeoutMs": 0, "parallel": false}
    }))
    .unwrap();
    assert_eq!(accepted.input, Some(serde_json::Value::Null));
    assert_eq!(accepted.options.unwrap().timeout_ms, Some(0.0));
}

#[test]
fn test_pipeline_condition_rejects_multiple_operators() {
    let result: Result<PipelineCondition, _> =
        serde_json::from_value(json!({"$exists": "$prev", "$eq": ["$prev", 1]}));
    assert!(result.is_err());
}

#[test]
fn test_pipeline_condition_exists() {
    let context = context_with_prev(json!({"email": "test@example.com"}));

    let condition = PipelineCondition::Exists {
        exists: "$prev.email".to_string(),
    };
    assert!(evaluate_condition(&condition, &context));

    let condition_missing = PipelineCondition::Exists {
        exists: "$prev.phone".to_string(),
    };
    assert!(!evaluate_condition(&condition_missing, &context));
}

#[test]
fn test_pipeline_condition_eq() {
    let context = context_with_prev(json!({"tier": "premium"}));

    let condition = PipelineCondition::Eq {
        eq: ("$prev.tier".to_string(), json!("premium")),
    };
    assert!(evaluate_condition(&condition, &context));

    let condition_ne = PipelineCondition::Eq {
        eq: ("$prev.tier".to_string(), json!("basic")),
    };
    assert!(!evaluate_condition(&condition_ne, &context));
}

#[test]
fn test_spec_eq_and_ne_compare_structurally() {
    let context = context_with_prev(json!({"owner": {"id": 1, "roles": ["a", "b"]}}));
    let same = json!({"roles": ["a", "b"], "id": 1});
    let different = json!({"id": 1, "roles": ["b", "a"]});

    assert!(evaluate_condition(
        &PipelineCondition::Eq {
            eq: ("$prev.owner".to_string(), same.clone()),
        },
        &context
    ));
    assert!(!evaluate_condition(
        &PipelineCondition::Eq {
            eq: ("$prev.owner".to_string(), different.clone()),
        },
        &context
    ));
    assert!(!evaluate_condition(
        &PipelineCondition::Ne {
            ne: ("$prev.owner".to_string(), same),
        },
        &context
    ));
    assert!(evaluate_condition(
        &PipelineCondition::Ne {
            ne: ("$prev.owner".to_string(), different),
        },
        &context
    ));
}

#[test]
fn test_spec_exists_is_false_for_null() {
    let context = context_with_prev(json!({"value": null, "zero": 0, "empty": ""}));
    let exists = |reference: &str| {
        evaluate_condition(
            &PipelineCondition::Exists {
                exists: reference.to_string(),
            },
            &context,
        )
    };
    assert!(!exists("$prev.value"));
    assert!(!exists("$prev.missing"));
    assert!(exists("$prev.zero"));
    assert!(exists("$prev.empty"));
}

#[test]
fn test_spec_condition_literal_operands_are_absent() {
    let context = context_with_prev(json!({"id": "t9"}));
    for literal in ["text", "$$prev", "$prevx", "$9.99"] {
        let exists = PipelineCondition::Exists {
            exists: literal.to_string(),
        };
        let eq = PipelineCondition::Eq {
            eq: (literal.to_string(), json!(literal)),
        };
        let ne = PipelineCondition::Ne {
            ne: (literal.to_string(), json!("other")),
        };
        assert!(!evaluate_condition(&exists, &context), "{literal}");
        assert!(!evaluate_condition(&eq, &context), "{literal}");
        assert!(!evaluate_condition(&ne, &context), "{literal}");
    }
}

#[test]
fn test_spec_eq_compares_numbers_by_value() {
    let context = context_with_prev(json!({"n": 2, "f": 2.5, "list": [1, {"x": 3}]}));
    let eq = |reference: &str, expected: serde_json::Value| {
        evaluate_condition(
            &PipelineCondition::Eq {
                eq: (reference.to_string(), expected),
            },
            &context,
        )
    };
    assert!(eq("$prev.n", json!(2.0)));
    assert!(eq("$prev.f", json!(2.5)));
    assert!(eq("$prev.list", json!([1.0, {"x": 3.0}])));
    assert!(!eq("$prev.n", json!(2.5)));
    assert!(!eq("$prev.n", json!("2")));
    assert!(!evaluate_condition(
        &PipelineCondition::Ne {
            ne: ("$prev.n".to_string(), json!(2.0)),
        },
        &context
    ));
}

#[test]
fn test_pipeline_condition_numeric() {
    let context = context_with_prev(json!({"count": 5}));

    let gt = PipelineCondition::Gt {
        gt: ("$prev.count".to_string(), 3.0),
    };
    assert!(evaluate_condition(&gt, &context));

    let lt = PipelineCondition::Lt {
        lt: ("$prev.count".to_string(), 10.0),
    };
    assert!(evaluate_condition(&lt, &context));

    let gte = PipelineCondition::Gte {
        gte: ("$prev.count".to_string(), 5.0),
    };
    assert!(evaluate_condition(&gte, &context));

    let lte = PipelineCondition::Lte {
        lte: ("$prev.count".to_string(), 5.0),
    };
    assert!(evaluate_condition(&lte, &context));
}

#[test]
fn test_pipeline_condition_logical() {
    let context = context_with_prev(json!({"active": true, "tier": "premium"}));

    let and = PipelineCondition::And {
        and: vec![
            PipelineCondition::Eq {
                eq: ("$prev.active".to_string(), json!(true)),
            },
            PipelineCondition::Eq {
                eq: ("$prev.tier".to_string(), json!("premium")),
            },
        ],
    };
    assert!(evaluate_condition(&and, &context));

    let or = PipelineCondition::Or {
        or: vec![
            PipelineCondition::Eq {
                eq: ("$prev.tier".to_string(), json!("basic")),
            },
            PipelineCondition::Eq {
                eq: ("$prev.tier".to_string(), json!("premium")),
            },
        ],
    };
    assert!(evaluate_condition(&or, &context));

    let not = PipelineCondition::Not {
        not: Box::new(PipelineCondition::Eq {
            eq: ("$prev.tier".to_string(), json!("basic")),
        }),
    };
    assert!(evaluate_condition(&not, &context));
}

// ═══════════════════════════════════════════════════════════════════════════
// SPEC: REFERENCE FORMS
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_spec_reference_forms() {
    let mut context = PipelineContext::new(Some(json!({"user": {"id": 9}, "tags": ["a", "b"]})));
    context.push_step(
        ok_step(0, json!({"id": 1, "items": [{"sku": "x"}, {"sku": "y"}]})).with_alias("first"),
    );
    context.push_step(ok_step(1, json!({"id": 2, "name": "Second"})).with_alias("second"));

    let cases = [
        ("$prev", Some(json!({"id": 2, "name": "Second"}))),
        ("$prev.name", Some(json!("Second"))),
        (
            "$first",
            Some(json!({"id": 1, "items": [{"sku": "x"}, {"sku": "y"}]})),
        ),
        ("$first.items[1].sku", Some(json!("y"))),
        ("$first.items.0.sku", Some(json!("x"))),
        ("$steps[0].id", Some(json!(1))),
        ("$steps[1]", Some(json!({"id": 2, "name": "Second"}))),
        ("$steps.first.items[0]", Some(json!({"sku": "x"}))),
        ("$steps.second.id", Some(json!(2))),
        (
            "$input",
            Some(json!({"user": {"id": 9}, "tags": ["a", "b"]})),
        ),
        ("$input.user.id", Some(json!(9))),
        ("$input.tags[1]", Some(json!("b"))),
    ];
    for (reference, expected) in cases {
        assert_eq!(
            resolve_variable(reference, &context),
            expected,
            "{reference}"
        );
    }
}

#[test]
fn test_resolve_reference_alias() {
    let context = context_with_prev(json!({"id": 123}));
    assert_eq!(resolve_reference("$prev.id", &context), Some(json!(123)));
}

#[test]
fn test_resolve_variables_object() {
    let context = context_with_prev(json!({"id": 123}));

    let resolved = resolve_variables(
        &json!({
            "userId": "$prev.id",
            "status": "active"
        }),
        &context,
    );
    assert_eq!(resolved, json!({"userId": 123, "status": "active"}));
}

// ═══════════════════════════════════════════════════════════════════════════
// SPEC: LITERALS AND ESCAPING
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_spec_dollar_literals_pass_through() {
    let mut context = context_with_prev(json!({"id": 1, "a b": 2, "items": [[1, 2]]}));
    context.steps[0].alias = Some("user".to_string());
    for literal in [
        "$9.99",
        "$HOME",
        "$prevx",
        "$steps",
        "$prev.",
        "$prev..id",
        "$steps[x]",
        "$",
        "$input[0]",
        "$prev.a b",
        "$prev.a\tb",
        "$prev.items[0][1]",
        "$steps[0][1]",
        "$steps.user[0]",
        "$steps.my alias",
        " $prev",
        "$prev ",
    ] {
        assert_eq!(
            resolve_variable(literal, &context),
            Some(json!(literal)),
            "{literal}"
        );
    }

    let resolved = resolve_variables(
        &json!({"price": "$9.99", "home": "$HOME", "list": ["$prevx", "$9"]}),
        &context,
    );
    assert_eq!(
        resolved,
        json!({"price": "$9.99", "home": "$HOME", "list": ["$prevx", "$9"]})
    );
}

#[test]
fn test_spec_double_dollar_escape() {
    let context = context_with_prev(json!({"id": 1}));
    assert_eq!(resolve_variable("$$prev", &context), Some(json!("$prev")));
    assert_eq!(resolve_variable("$$9.99", &context), Some(json!("$9.99")));
    assert_eq!(resolve_variable("$$$prev", &context), Some(json!("$$prev")));
    assert_eq!(
        resolve_variables(&json!({"a": "$$prev.id", "b": ["$$"]}), &context),
        json!({"a": "$prev.id", "b": ["$"]})
    );

    // Unescaping applies at any length.
    let long = format!("$${}", "x".repeat(MAX_REFERENCE_LENGTH * 2));
    assert_eq!(resolve_variable(&long, &context), Some(json!(&long[1..])));
}

#[test]
fn test_spec_long_reference_is_literal() {
    let key = "k".repeat(MAX_REFERENCE_LENGTH);
    let mut input = serde_json::Map::new();
    input.insert(key.clone(), json!("secret"));
    let context = PipelineContext::new(Some(serde_json::Value::Object(input)));

    let reference = format!("$input.{key}");
    assert!(reference.chars().count() > MAX_REFERENCE_LENGTH);
    assert_eq!(
        resolve_variable(&reference, &context),
        Some(json!(reference))
    );

    // At the limit the same shape still resolves.
    let short_key = "k".repeat(MAX_REFERENCE_LENGTH - "$input.".len());
    let mut input = serde_json::Map::new();
    input.insert(short_key.clone(), json!("value"));
    let context = PipelineContext::new(Some(serde_json::Value::Object(input)));
    let reference = format!("$input.{short_key}");
    assert_eq!(reference.chars().count(), MAX_REFERENCE_LENGTH);
    assert_eq!(resolve_variable(&reference, &context), Some(json!("value")));
}

// ═══════════════════════════════════════════════════════════════════════════
// SPEC: WHAT A PATH MAY REACH
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_spec_double_underscore_segments_never_resolve() {
    let mut context = context_with_prev(json!({
        "__proto__": {"polluted": true},
        "__class__": "Secret",
        "nested": {"__globals__": 1},
        "items": [{"__x": 1}]
    }));
    context.push_step(ok_step(1, json!({"id": 5})).with_alias("__hidden"));
    context.previous_result = Some(context.steps[0].clone());

    for reference in [
        "$prev.__proto__",
        "$prev.__proto__.polluted",
        "$prev.__class__",
        "$prev.nested.__globals__",
        "$prev.items[0].__x",
        "$steps.__hidden",
        "$steps.__hidden.id",
        "$steps.__proto__",
    ] {
        assert_eq!(resolve_variable(reference, &context), None, "{reference}");
    }
}

#[test]
fn test_spec_only_own_keys_resolve() {
    let context = context_with_prev(json!({"name": "Alice", "constructor": "own"}));
    // `constructor` is an ordinary own key here, so it resolves; nothing else is reachable.
    assert_eq!(
        resolve_variable("$prev.constructor", &context),
        Some(json!("own"))
    );
    for reference in [
        "$prev.name.length",
        "$prev.prototype",
        "$prev.toString",
        "$prev.name.constructor",
    ] {
        assert_eq!(resolve_variable(reference, &context), None, "{reference}");
    }
    let without = context_with_prev(json!({"name": "Alice"}));
    assert_eq!(resolve_variable("$prev.constructor", &without), None);
}

#[test]
fn test_spec_out_of_bounds_indices_are_absent() {
    let context = context_with_prev(json!({"items": [1, 2, 3], "map": {"0": "zero"}}));
    assert_eq!(resolve_variable("$prev.items[2]", &context), Some(json!(3)));
    assert_eq!(resolve_variable("$prev.items.2", &context), Some(json!(3)));
    for reference in [
        "$prev.items[3]",
        "$prev.items.3",
        "$prev.items[18446744073709551616]",
        "$steps[1]",
        "$steps[99999999999999999999999]",
        "$prev.map[0]",
    ] {
        assert_eq!(resolve_variable(reference, &context), None, "{reference}");
    }
    // A numeric segment reads an own key of an object.
    assert_eq!(
        resolve_variable("$steps[0].map.0", &context),
        Some(json!("zero"))
    );
}

#[test]
fn test_get_nested_value() {
    let obj = json!({
        "user": {"profile": {"name": "Alice"}},
        "items": [1, 2, 3]
    });

    assert_eq!(
        get_nested_value(&obj, "user.profile.name"),
        Some(json!("Alice"))
    );
    assert_eq!(get_nested_value(&obj, "items[2]"), Some(json!(3)));
    assert_eq!(get_nested_value(&obj, "items.1"), Some(json!(2)));
    assert_eq!(get_nested_value(&obj, "user.missing.field"), None);
    assert_eq!(get_nested_value(&obj, "user..profile"), None);
    assert_eq!(get_nested_value(&obj, "__proto__"), None);
}

// ═══════════════════════════════════════════════════════════════════════════
// SPEC: UNRESOLVED REFERENCES
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_spec_unresolved_references_are_omitted_or_null() {
    let context = context_with_prev(json!({"id": 1}));
    let resolved = resolve_variables(
        &json!({
            "id": "$prev.id",
            "missing": "$prev.missing",
            "alias": "$steps.nope",
            "list": ["$prev.id", "$steps.nope", "$steps[7]"],
            "nested": {"input": "$input"}
        }),
        &context,
    );
    assert_eq!(
        resolved,
        json!({"id": 1, "list": [1, null, null], "nested": {}})
    );
    assert_eq!(
        resolve_variables(&json!("$steps.nope"), &context),
        serde_json::Value::Null
    );
}

#[test]
fn test_spec_skipped_and_failed_steps_are_unresolved() {
    let mut context = PipelineContext::default();
    context.push_step(StepResult::new(0, "a-skip", StepStatus::Skipped).with_alias("a"));
    context.push_step(
        StepResult::new(1, "b-fail", StepStatus::Failure)
            .with_alias("b")
            .with_error(CommandError::internal("boom")),
    );
    for reference in [
        "$prev",
        "$first",
        "$steps[0]",
        "$steps[1]",
        "$steps.a",
        "$steps.b",
    ] {
        assert_eq!(resolve_variable(reference, &context), None, "{reference}");
    }
}

#[test]
fn test_spec_when_over_unresolved_path_is_false() {
    let context = context_with_prev(json!({"id": 1}));
    let conditions = [
        PipelineCondition::Exists {
            exists: "$prev.missing".to_string(),
        },
        PipelineCondition::Eq {
            eq: ("$prev.missing".to_string(), serde_json::Value::Null),
        },
        PipelineCondition::Ne {
            ne: ("$prev.missing".to_string(), json!(1)),
        },
        PipelineCondition::Gt {
            gt: ("$steps.nope.count".to_string(), 0.0),
        },
        PipelineCondition::Lte {
            lte: ("$input.count".to_string(), 10.0),
        },
    ];
    for condition in &conditions {
        assert!(!evaluate_condition(condition, &context), "{condition:?}");
    }
    assert!(evaluate_condition(
        &PipelineCondition::Not {
            not: Box::new(conditions[0].clone())
        },
        &context
    ));
}

// ═══════════════════════════════════════════════════════════════════════════
// SPEC: $input
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_spec_input_comes_from_the_request() {
    let executor = echo_executor();
    let request = PipelineRequest::new(vec![PipelineStep::new("echo-run")
        .with_input(json!({"user": "$input.user", "all": "$input", "secret": "$input.token"}))])
    .with_input(json!({"user": "ada"}));

    let mut host_context = HashMap::new();
    host_context.insert("token".to_string(), json!("host-secret"));
    let result = execute_pipeline(&request, &executor, Some(host_context)).await;

    assert_eq!(
        result.data,
        Some(json!({"user": "ada", "all": {"user": "ada"}}))
    );
}

#[tokio::test]
async fn test_spec_input_without_request_input_is_absent() {
    let executor = echo_executor();
    let request = PipelineRequest::new(vec![PipelineStep::new("echo-run")
        .with_input(json!({"all": "$input", "user": "$input.user", "list": ["$input"]}))]);

    let mut host_context = HashMap::new();
    host_context.insert("user".to_string(), json!("host-user"));
    let result = execute_pipeline(&request, &executor, Some(host_context)).await;

    assert_eq!(result.data, Some(json!({"list": [null]})));
}

// ═══════════════════════════════════════════════════════════════════════════
// SPEC: LIMITS
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_spec_depth_over_limit_is_rejected_before_any_step() {
    let calls = Arc::new(AtomicUsize::new(0));
    let executor = counting_executor(Arc::clone(&calls));
    let request = PipelineRequest::new(vec![
        PipelineStep::new("first-run").with_input(json!({"ok": true})),
        PipelineStep::new("deep-run").with_input(nested_object(MAX_INPUT_DEPTH + 1)),
        PipelineStep::new("last-run"),
    ]);

    let result = execute_pipeline(&request, &executor, None).await;

    assert_eq!(calls.load(Ordering::SeqCst), 0);
    assert_eq!(result.data, None);
    assert_eq!(result.steps.len(), 3);
    assert_eq!(result.steps[1].status, StepStatus::Failure);
    assert_eq!(
        result.steps[1].error.as_ref().unwrap().code,
        "VALIDATION_ERROR"
    );
    assert_eq!(result.steps[0].status, StepStatus::Skipped);
    assert_eq!(result.steps[2].status, StepStatus::Skipped);
    assert_eq!(result.metadata.completed_steps, 0);
}

#[tokio::test]
async fn test_spec_request_input_depth_over_limit_is_rejected() {
    let calls = Arc::new(AtomicUsize::new(0));
    let executor = counting_executor(Arc::clone(&calls));
    let request = PipelineRequest::new(vec![
        PipelineStep::new("first-run").with_input(json!({"value": "$input"})),
        PipelineStep::new("second-run"),
    ])
    .with_input(json!([nested_object(MAX_INPUT_DEPTH)]));

    let result = execute_pipeline(&request, &executor, None).await;

    assert_eq!(calls.load(Ordering::SeqCst), 0);
    let error = result.steps[0].error.as_ref().unwrap();
    assert_eq!(error.code, "VALIDATION_ERROR");
    assert_eq!(
        error.details.as_ref().unwrap().get("field"),
        Some(&json!("input"))
    );
    assert_eq!(result.steps[1].status, StepStatus::Skipped);
}

#[tokio::test]
async fn test_spec_depth_at_limit_is_accepted() {
    let executor = echo_executor();
    let input = nested_object(MAX_INPUT_DEPTH);
    let request =
        PipelineRequest::new(vec![PipelineStep::new("deep-run").with_input(input.clone())]);

    let result = execute_pipeline(&request, &executor, None).await;

    assert_eq!(result.steps[0].status, StepStatus::Success);
    assert_eq!(result.data, Some(input));
}

#[test]
fn test_resolve_variables_never_recurses_past_the_limit() {
    let context = PipelineContext::default();
    let resolved = resolve_variables(&nested_object(MAX_INPUT_DEPTH + 2), &context);
    assert!(!exceeds_depth(&resolved, MAX_INPUT_DEPTH));
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPANSION LIMITS (spec/pipeline-variables.md, Limits; #1722)
// ═══════════════════════════════════════════════════════════════════════════

fn limit_of(template: serde_json::Value, context: &PipelineContext) -> ResolutionLimit {
    try_resolve_variables(&template, context).unwrap_err().limit
}

fn input_context(input: serde_json::Value) -> PipelineContext {
    PipelineContext::new(Some(input))
}

#[test]
fn test_repeated_fan_out_of_input_is_rejected() {
    let context = input_context(json!({"big": (0..1_000).collect::<Vec<_>>()}));
    assert_eq!(
        limit_of(json!({"items": vec!["$input.big"; 200]}), &context),
        ResolutionLimit::Nodes
    );
}

#[test]
fn test_a_single_large_reference_is_not_charged() {
    let context = input_context(json!({"rows": (0..105_000).collect::<Vec<_>>()}));
    let resolved = try_resolve_variables(&json!({"rows": "$input.rows"}), &context).unwrap();
    assert_eq!(resolved["rows"].as_array().unwrap().len(), 105_000);
}

#[test]
fn test_the_same_step_through_two_references_is_a_repeat() {
    let mut context = PipelineContext::default();
    context.push_step(
        ok_step(0, json!({"rows": (0..110_000).collect::<Vec<_>>()})).with_alias("load"),
    );
    assert!(try_resolve_variables(&json!({"a": "$prev.rows"}), &context).is_ok());
    assert_eq!(
        limit_of(
            json!({"a": "$prev.rows", "b": "$steps.load.rows"}),
            &context
        ),
        ResolutionLimit::Nodes
    );
}

#[test]
fn test_prev_reads_previous_result_when_it_differs_from_its_steps_entry() {
    // A hand-built context: `$prev` is `previous_result`, even beside a matching steps entry.
    let mut context = PipelineContext::default();
    context.push_step(ok_step(0, json!(1)));
    context.previous_result.as_mut().unwrap().data = Some(json!(2));
    assert_eq!(resolve_variable("$prev", &context), Some(json!(2)));
    assert_eq!(
        try_resolve_variables(&json!({"a": "$prev"}), &context).unwrap(),
        json!({"a": 2})
    );
}

#[test]
fn test_equal_strings_are_charged_as_repeats() {
    let text = "x".repeat(MAX_RESOLVED_CHARS / 2);
    let context = input_context(json!({"a": text, "b": text}));
    assert_eq!(
        try_resolve_variables(&json!({"a": "$input.a"}), &context).unwrap(),
        json!({"a": text})
    );
    assert_eq!(
        limit_of(
            json!({"a": "$input.a", "b": "$input.b", "c": "$input.a"}),
            &context
        ),
        ResolutionLimit::Chars
    );
}

#[test]
fn test_each_unresolved_array_element_costs_a_value() {
    assert_eq!(
        limit_of(
            json!(vec!["$steps.missing"; MAX_RESOLVED_NODES + 5]),
            &PipelineContext::default()
        ),
        ResolutionLimit::Nodes
    );
}

#[test]
fn test_the_node_budget_boundary() {
    // The array is one value and each literal one more.
    let context = PipelineContext::default();
    assert!(try_resolve_variables(&json!(vec!["x"; MAX_RESOLVED_NODES - 1]), &context).is_ok());
    assert_eq!(
        limit_of(json!(vec!["x"; MAX_RESOLVED_NODES]), &context),
        ResolutionLimit::Nodes
    );
}

#[test]
fn test_the_character_budget_boundary_counts_utf16_code_units() {
    // The key "s" is one character; an astral character is two code units.
    let fits = format!("{}\u{1F600}", "x".repeat(MAX_RESOLVED_CHARS - 3));
    let context = PipelineContext::default();
    assert!(try_resolve_variables(&json!({ "s": fits }), &context).is_ok());
    assert_eq!(
        limit_of(json!({ "s": format!("{fits}x") }), &context),
        ResolutionLimit::Chars
    );
}

#[test]
fn test_a_referenced_value_deeper_than_64_levels_is_rejected() {
    let context = input_context(json!({"deep": nested_object(MAX_INPUT_DEPTH + 1)}));
    assert_eq!(
        limit_of(json!({"leaf": "$input.deep"}), &context),
        ResolutionLimit::Depth
    );
    assert!(try_resolve_variables(&json!({"leaf": "$input.deep.a"}), &context).is_ok());
}

#[test]
fn test_a_template_deeper_than_64_levels_is_rejected() {
    assert_eq!(
        limit_of(
            nested_object(MAX_INPUT_DEPTH + 1),
            &PipelineContext::default()
        ),
        ResolutionLimit::Depth
    );
}

#[tokio::test]
async fn test_execute_pipeline_fails_an_over_limit_step_without_running_it() {
    let calls = Arc::new(AtomicUsize::new(0));
    let executor = counting_executor(calls.clone());
    let request = PipelineRequest::new(vec![
        PipelineStep::new("echo-run").with_input(json!({"items": vec!["$input.big"; 200]})),
        PipelineStep::new("after-run"),
    ])
    .with_input(json!({"big": (0..1_000).collect::<Vec<_>>()}));

    let result = execute_pipeline(&request, &executor, None).await;

    assert_eq!(calls.load(Ordering::SeqCst), 0);
    assert_eq!(result.steps[0].status, StepStatus::Failure);
    let error = result.steps[0].error.as_ref().unwrap();
    assert_eq!(error.code, "VALIDATION_ERROR");
    assert_eq!(error.retryable, Some(false));
    assert!(error.suggestion.is_some());
    let details = error.details.as_ref().unwrap();
    assert_eq!(details.get("stepIndex"), Some(&json!(0)));
    assert_eq!(details.get("limit"), Some(&json!("nodes")));
    assert_eq!(result.steps[1].status, StepStatus::Skipped);
}

// ═══════════════════════════════════════════════════════════════════════════
// AGGREGATION AND RESULT SHAPES
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_aggregate_confidence() {
    let steps = vec![
        ok_step(0, json!({})).with_metadata(StepMetadata::default().with_confidence(0.9)),
        ok_step(1, json!({})).with_metadata(StepMetadata::default().with_confidence(0.7)),
        StepResult::new(2, "cmd3", StepStatus::Failure)
            .with_error(CommandError::internal("failed"))
            .with_metadata(StepMetadata::default().with_confidence(0.5)),
    ];

    // Should use weakest link (0.7), ignoring failed step
    let confidence = aggregate_pipeline_confidence(&steps);
    assert!((confidence - 0.7).abs() < 0.001);
    assert_eq!(aggregate_pipeline_confidence(&[]), 0.0);
}

#[test]
fn test_type_guards() {
    assert!(is_pipeline_request(
        &json!({"steps": [{"command": "test"}]})
    ));
    assert!(is_pipeline_step(&json!({"command": "test"})));
    assert!(is_pipeline_result(
        &json!({"data": {}, "metadata": {}, "steps": []})
    ));
    assert!(is_pipeline_result(&json!({"metadata": {}, "steps": []})));
    assert!(is_pipeline_condition(&json!({"$exists": "$prev.id"})));
}

#[test]
fn test_condition_type_guards() {
    let exists = PipelineCondition::from(PipelineConditionExists {
        exists: "$prev.id".to_string(),
    });
    let eq = PipelineCondition::from(PipelineConditionEq {
        eq: ("$prev.tier".to_string(), json!("premium")),
    });
    let and = PipelineCondition::from(PipelineConditionAnd {
        and: vec![exists.clone(), eq.clone()],
    });

    assert!(is_exists_condition(&exists));
    assert!(is_eq_condition(&eq));
    assert!(is_and_condition(&and));
    assert!(!is_or_condition(&and));
}

#[test]
fn test_step_status_serialization() {
    assert_eq!(
        serde_json::to_string(&StepStatus::Success).unwrap(),
        "\"success\""
    );
    assert_eq!(
        serde_json::to_string(&StepStatus::Failure).unwrap(),
        "\"failure\""
    );
    assert_eq!(
        serde_json::to_string(&StepStatus::Skipped).unwrap(),
        "\"skipped\""
    );
}

#[test]
fn test_pipeline_metadata_default() {
    let metadata = PipelineMetadata::default();
    assert_eq!(metadata.confidence, 1.0);
    assert_eq!(metadata.completed_steps, 0);
    assert_eq!(metadata.total_steps, 0);
    assert!(metadata.warnings.is_empty());
}

#[test]
fn test_aggregate_warnings() {
    let steps = vec![ok_step(0, json!({})).with_alias("step1").with_metadata(
        StepMetadata::default().with_warnings(vec![Warning::new(
            "DEPRECATION",
            "This is deprecated",
        )
        .with_severity(WarningSeverity::Info)]),
    )];

    let warnings = aggregate_pipeline_warnings(&steps);
    assert_eq!(warnings.len(), 1);
    assert_eq!(warnings[0].code, "DEPRECATION");
    assert_eq!(warnings[0].severity, Some(WarningSeverity::Info));
    assert_eq!(warnings[0].step_index, 0);
    assert_eq!(warnings[0].step_alias, Some("step1".to_string()));
}

// ═══════════════════════════════════════════════════════════════════════════
// EXECUTION
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_execute_pipeline_single_step() {
    let executor: CommandExecutor = Arc::new(|name, _input, _ctx| {
        Box::pin(async move {
            if name == "user-get" {
                success_with(
                    json!({"id": 1, "name": "Alice"}),
                    ResultOptions {
                        confidence: Some(0.8),
                        reasoning: Some("Found".to_string()),
                        ..Default::default()
                    },
                )
            } else {
                failure(CommandError::new(
                    "COMMAND_NOT_FOUND",
                    format!("Command '{name}' not found"),
                ))
            }
        })
    });

    let result = execute_pipeline(
        &PipelineRequest::new(vec![PipelineStep::new("user-get")
            .with_input(json!({"id": 1}))
            .with_alias("user")]),
        &executor,
        None,
    )
    .await;

    assert_eq!(result.data, Some(json!({"id": 1, "name": "Alice"})));
    assert_eq!(result.steps.len(), 1);
    assert_eq!(result.steps[0].status, StepStatus::Success);
    assert_eq!(result.metadata.confidence, 0.8);
    assert_eq!(
        result.metadata.confidence_breakdown[0].alias.as_deref(),
        Some("user")
    );
    assert_eq!(result.metadata.reasoning[0].reasoning, "Found");
}

#[tokio::test]
async fn test_execute_pipeline_chains_references() {
    let executor = echo_executor();
    let request = PipelineRequest::new(vec![
        PipelineStep::new("first-run")
            .with_input(json!({"id": 1, "price": "$9.99"}))
            .with_alias("first"),
        PipelineStep::new("second-run").with_input(json!({
            "fromPrev": "$prev.id",
            "fromAlias": "$steps.first.price",
            "escaped": "$$prev"
        })),
    ]);

    let result = execute_pipeline(&request, &executor, None).await;

    assert_eq!(
        result.data,
        Some(json!({"fromPrev": 1, "fromAlias": "$9.99", "escaped": "$prev"}))
    );
}

#[tokio::test]
async fn test_execute_pipeline_when_skips_step() {
    let executor = echo_executor();
    let request = PipelineRequest::new(vec![
        PipelineStep::new("first-run").with_input(json!({"id": 1})),
        PipelineStep::new("guarded-run").with_when(PipelineCondition::Exists {
            exists: "$prev.missing".to_string(),
        }),
        PipelineStep::new("after-run")
            .with_input(json!({"prev": "$prev.id", "skipped": "$steps[1]"})),
    ]);

    let result = execute_pipeline(&request, &executor, None).await;

    assert_eq!(result.steps[1].status, StepStatus::Skipped);
    assert_eq!(result.data, Some(json!({"prev": 1})));
}

#[tokio::test]
async fn test_execute_pipeline_stops_on_failure() {
    let executor: CommandExecutor = Arc::new(|name, _input, _ctx| {
        Box::pin(async move {
            match name.as_str() {
                "step-a" => success(json!("a")),
                "step-b" => failure(CommandError::new("FAIL", "Step B failed")),
                _ => success(json!("c")),
            }
        })
    });

    let result = execute_pipeline(
        &PipelineRequest::new(vec![
            PipelineStep::new("step-a"),
            PipelineStep::new("step-b"),
            PipelineStep::new("step-c"),
        ]),
        &executor,
        None,
    )
    .await;

    assert_eq!(result.steps[0].status, StepStatus::Success);
    assert_eq!(result.steps[1].status, StepStatus::Failure);
    assert_eq!(result.steps[2].status, StepStatus::Skipped);
    assert_eq!(result.data, Some(json!("a")));
}

#[tokio::test]
async fn test_empty_pipeline_has_no_data() {
    let result = execute_pipeline(&PipelineRequest::new(vec![]), &echo_executor(), None).await;
    assert_eq!(result.data, None);
    assert_eq!(
        serde_json::to_value(&result).unwrap().get("data"),
        None,
        "absent data is omitted"
    );
}

#[tokio::test]
async fn test_parallel_pipeline_is_rejected_before_execution() {
    let calls = Arc::new(AtomicUsize::new(0));
    let executor = counting_executor(Arc::clone(&calls));
    let result = execute_pipeline(
        &PipelineRequest::new(vec![PipelineStep::new("step-a")])
            .with_options(PipelineOptions::new().with_parallel(true)),
        &executor,
        None,
    )
    .await;

    assert_eq!(calls.load(Ordering::SeqCst), 0);
    assert_eq!(
        result.steps[0].error.as_ref().unwrap().code,
        "UNSUPPORTED_OPTION"
    );
}

#[tokio::test]
async fn test_streaming_step_is_rejected_before_execution() {
    let calls = Arc::new(AtomicUsize::new(0));
    let executor = counting_executor(Arc::clone(&calls));
    // Deserialized from the wire, as `afd-pipe` receives it.
    let request: PipelineRequest = serde_json::from_value(json!({
        "steps": [
            { "command": "one", "as": "first" },
            { "command": "two", "stream": true },
            { "command": "three", "stream": true }
        ]
    }))
    .unwrap();

    let result = execute_pipeline(&request, &executor, None).await;

    assert_eq!(calls.load(Ordering::SeqCst), 0);
    let statuses: Vec<_> = result.steps.iter().map(|step| step.status).collect();
    assert_eq!(
        statuses,
        vec![
            StepStatus::Skipped,
            StepStatus::Failure,
            StepStatus::Skipped
        ]
    );
    assert_eq!(result.steps[0].index, 0);
    assert_eq!(result.steps[0].alias.as_deref(), Some("first"));
    assert_eq!(result.steps[0].command, "one");
    assert!(result.steps[0].error.is_none());
    let error = result.steps[1].error.as_ref().unwrap();
    assert_eq!(error.code, "UNSUPPORTED_OPTION");
    assert_eq!(
        error.message,
        "Streaming pipeline steps are not supported (step 1 sets stream: true)"
    );
    assert!(error
        .suggestion
        .as_deref()
        .unwrap()
        .starts_with("Remove stream or set it to false"));
    assert!(result.steps[2].error.is_none());
    assert!(result.data.is_none());
    assert_eq!(result.metadata.completed_steps, 0);
    assert_eq!(result.metadata.total_steps, 3);
}

#[tokio::test]
async fn test_stream_false_is_accepted() {
    let result = execute_pipeline(
        &PipelineRequest::new(vec![PipelineStep::new("one")
            .with_input(json!([1, 2]))
            .with_stream(false)]),
        &echo_executor(),
        None,
    )
    .await;

    assert_eq!(result.steps[0].status, StepStatus::Success);
    assert_eq!(result.data, Some(json!([1, 2])));
}

#[tokio::test]
async fn test_parallel_is_blamed_on_step_zero_even_when_a_step_streams() {
    let result = execute_pipeline(
        &PipelineRequest::new(vec![
            PipelineStep::new("one"),
            PipelineStep::new("two").with_stream(true),
        ])
        .with_options(PipelineOptions::new().with_parallel(true)),
        &echo_executor(),
        None,
    )
    .await;

    assert_eq!(
        result.steps[0].error.as_ref().unwrap().message,
        "Parallel pipeline execution is not supported"
    );
    assert_eq!(result.steps[1].status, StepStatus::Skipped);
}

#[tokio::test]
async fn test_invalid_timeout_is_rejected_before_execution() {
    let calls = Arc::new(AtomicUsize::new(0));
    let executor = counting_executor(Arc::clone(&calls));
    let result = execute_pipeline(
        &PipelineRequest::new(vec![PipelineStep::new("step-a")])
            .with_options(PipelineOptions::new().with_timeout_ms(-1.0)),
        &executor,
        None,
    )
    .await;

    assert_eq!(calls.load(Ordering::SeqCst), 0);
    assert_eq!(
        result.steps[0].error.as_ref().unwrap().code,
        "VALIDATION_ERROR"
    );
}

#[tokio::test]
async fn test_huge_timeout_does_not_overflow() {
    let result = execute_pipeline(
        &PipelineRequest::new(vec![PipelineStep::new("step-a")])
            .with_options(PipelineOptions::new().with_timeout_ms(f64::MAX)),
        &echo_executor(),
        None,
    )
    .await;
    let expected = if cfg!(feature = "native") {
        StepStatus::Success
    } else {
        StepStatus::Failure
    };
    assert_eq!(result.steps[0].status, expected);
}

#[cfg(feature = "native")]
#[tokio::test]
async fn test_zero_timeout_fails_the_first_step_that_would_run() {
    let calls = Arc::new(AtomicUsize::new(0));
    let result = execute_pipeline(
        &PipelineRequest::new(vec![
            PipelineStep::new("step-a").with_when(PipelineCondition::Exists {
                exists: "$prev".to_string(),
            }),
            PipelineStep::new("step-b"),
            PipelineStep::new("step-c"),
        ])
        .with_options(PipelineOptions::new().with_timeout_ms(0.0)),
        &counting_executor(Arc::clone(&calls)),
        None,
    )
    .await;

    assert_eq!(calls.load(Ordering::SeqCst), 0);
    // As in TypeScript, the `when` condition is checked first: step-a is
    // skipped without an error, and step-b fails at the deadline.
    assert_eq!(result.steps[0].status, StepStatus::Skipped);
    assert!(result.steps[0].error.is_none());
    assert_eq!(result.steps[1].status, StepStatus::Failure);
    let error = result.steps[1].error.as_ref().unwrap();
    assert_eq!(error.code, "PIPELINE_TIMEOUT");
    assert_eq!(error.message, "Pipeline timeout exceeded (0ms)");
    assert_eq!(result.steps[2].status, StepStatus::Skipped);
    assert_eq!(result.steps[2].error.as_ref(), Some(error));
    assert_eq!(result.metadata.completed_steps, 0);
}

#[cfg(feature = "native")]
#[tokio::test]
async fn test_step_that_ends_past_the_deadline_skips_later_steps() {
    let executor: CommandExecutor = Arc::new(|_name, input, _ctx| {
        Box::pin(async move {
            // Blocks without yielding, so the deadline cannot interrupt it.
            std::thread::sleep(std::time::Duration::from_millis(30));
            success(input)
        })
    });
    let result = execute_pipeline(
        &PipelineRequest::new(vec![
            PipelineStep::new("step-a"),
            PipelineStep::new("step-b"),
            PipelineStep::new("step-c"),
        ])
        .with_options(
            PipelineOptions::new()
                .with_timeout_ms(10.0)
                .with_continue_on_failure(true),
        ),
        &executor,
        None,
    )
    .await;

    // As in TypeScript, the later steps are skipped, not failed.
    assert_eq!(result.steps[0].status, StepStatus::Success);
    for step in &result.steps[1..] {
        assert_eq!(step.status, StepStatus::Skipped);
        assert_eq!(step.error.as_ref().unwrap().code, "PIPELINE_TIMEOUT");
    }
}

#[tokio::test]
async fn test_pipeline_timeout_interrupts_current_step() {
    let calls = Arc::new(AtomicUsize::new(0));
    let executor_calls = Arc::clone(&calls);
    let executor: CommandExecutor = Arc::new(move |_name, _input, _ctx| {
        executor_calls.fetch_add(1, Ordering::SeqCst);
        Box::pin(async {
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            success(json!({}))
        })
    });
    let result = execute_pipeline(
        &PipelineRequest::new(vec![
            PipelineStep::new("slow-step"),
            PipelineStep::new("next-step"),
        ])
        .with_options(PipelineOptions::new().with_timeout_ms(5.0)),
        &executor,
        None,
    )
    .await;

    let expected_code = if cfg!(feature = "native") {
        "PIPELINE_TIMEOUT"
    } else {
        "UNSUPPORTED_OPTION"
    };
    assert_eq!(result.steps[0].error.as_ref().unwrap().code, expected_code);
    assert_eq!(
        calls.load(Ordering::SeqCst),
        usize::from(cfg!(feature = "native"))
    );
    assert_eq!(result.steps[1].status, StepStatus::Skipped);
    assert!(result.metadata.execution_time_ms < 100.0);
}

// ═══════════════════════════════════════════════════════════════════════════
// PANICS
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_panicking_step_keeps_completed_results() {
    let executor: CommandExecutor = Arc::new(|name, input, _ctx| {
        if name == "sync-panic" {
            panic!("executor panicked before returning a future");
        }
        Box::pin(async move {
            if name == "async-panic" {
                panic!("handler panicked while running");
            }
            success(input)
        })
    });

    let result = execute_pipeline(
        &PipelineRequest::new(vec![
            PipelineStep::new("first-run").with_input(json!({"id": 1})),
            PipelineStep::new("async-panic"),
            PipelineStep::new("sync-panic"),
            PipelineStep::new("last-run").with_input(json!({"prev": "$prev.id"})),
        ])
        .with_options(PipelineOptions::new().with_continue_on_failure(true)),
        &executor,
        None,
    )
    .await;

    assert_eq!(result.steps[0].status, StepStatus::Success);
    assert_eq!(result.steps[0].data, Some(json!({"id": 1})));
    for index in [1, 2] {
        assert_eq!(result.steps[index].status, StepStatus::Failure);
        let error = result.steps[index].error.as_ref().unwrap();
        assert_eq!(error.code, "COMMAND_EXECUTION_ERROR");
        assert_eq!(error.message, "An internal error occurred");
    }
    assert_eq!(result.steps[3].status, StepStatus::Success);
    assert_eq!(result.data, Some(json!({"prev": 1})));
}

#[test]
fn test_reference_limit_counts_utf16_units_at_the_boundary() {
    for (suffix, resolved) in [("a", true), ("ab", false)] {
        let key = format!("{}{suffix}", "😀".repeat(508));
        let reference = format!("$input.{key}");
        assert_eq!(
            reference.encode_utf16().count(),
            if resolved { 1024 } else { 1025 }
        );
        let context = PipelineContext::new(Some(json!({key: "value"})));
        assert_eq!(
            resolve_variable(&reference, &context),
            Some(if resolved {
                json!("value")
            } else {
                json!(reference)
            })
        );
    }
}

#[cfg(feature = "server")]
#[test]
fn reads_step_data_only_for_references_to_earlier_steps() {
    use super::reads_step_data;
    for reference in [
        "$prev",
        "$prev.id",
        "$first",
        "$first.items[0]",
        "$steps[1]",
        "$steps.list.id",
        "$steps.input",
    ] {
        assert!(
            reads_step_data(&json!({ "nested": [{ "id": reference }] })),
            "{reference}"
        );
    }
    let long = format!("$prev.{}", "a".repeat(1100));
    for literal in [
        "$input",
        "$input.id",
        "$$prev",
        "$prevx",
        "$prev.a b",
        "$steps[0][1]",
        "$9.99",
        "prev",
        long.as_str(),
    ] {
        assert!(!reads_step_data(&json!({ "value": literal })), "{literal}");
    }
}

fn is_js_whitespace(c: char) -> bool {
    matches!(
        c,
        '\u{0009}'..='\u{000D}'
            | '\u{0020}'
            | '\u{00A0}'
            | '\u{1680}'
            | '\u{2000}'..='\u{200A}'
            | '\u{2028}'
            | '\u{2029}'
            | '\u{202F}'
            | '\u{205F}'
            | '\u{3000}'
            | '\u{FEFF}'
    )
}

#[test]
fn test_key_and_alias_whitespace_matches_javascript_across_all_chars() {
    let mut js_whitespace_count = 0usize;
    let empty = PipelineContext::default();
    for ch in '\0'..=char::MAX {
        let is_ws = is_js_whitespace(ch);
        if is_ws {
            js_whitespace_count += 1;
        }
        // `.` splits segments (`a.b` is two valid segments), so skip it here.
        if ch == '.' {
            continue;
        }
        let forbidden = is_ws || matches!(ch, '[' | ']');
        let key_ref = format!("$prev.a{ch}b");
        let alias_ref = format!("$steps.a{ch}b");
        if forbidden {
            assert_eq!(
                resolve_variable(&key_ref, &empty),
                Some(json!(key_ref)),
                "U+{:04X} must be rejected in key",
                ch as u32
            );
            assert_eq!(
                resolve_variable(&alias_ref, &empty),
                Some(json!(alias_ref)),
                "U+{:04X} must be rejected in alias",
                ch as u32
            );
        } else {
            assert_eq!(
                resolve_variable(&key_ref, &empty),
                None,
                "U+{:04X} must be allowed in key",
                ch as u32
            );
            assert_eq!(
                resolve_variable(&alias_ref, &empty),
                None,
                "U+{:04X} must be allowed in alias",
                ch as u32
            );
        }
    }
    assert_eq!(js_whitespace_count, 25);
}

#[test]
fn test_unicode_whitespace_edge_cases_in_keys_aliases_conditions_and_limits() {
    // Non-JS Unicode whitespace (U+001C..=U+001F, U+0085) is allowed in keys and aliases (#1962).
    for ch in ['\u{001C}', '\u{001D}', '\u{001E}', '\u{001F}', '\u{0085}'] {
        let key = format!("a{ch}b");
        let deep_key = format!("deep{ch}k");
        let alias = format!("step{ch}alias");
        let data = json!({
            key.clone(): "ok",
            deep_key.clone(): nested_object(MAX_INPUT_DEPTH + 1),
        });
        let mut context = PipelineContext::default();
        context.push_step(ok_step(0, data.clone()).with_alias(&alias));

        let key_ref = format!("$prev.{key}");
        let alias_ref = format!("$steps.{alias}.{key}");
        assert_eq!(resolve_variable(&key_ref, &context), Some(json!("ok")));
        assert_eq!(resolve_variable(&alias_ref, &context), Some(json!("ok")));
        assert_eq!(get_nested_value(&data, &key), Some(json!("ok")));
        assert!(evaluate_condition(
            &PipelineCondition::Exists {
                exists: key_ref.clone()
            },
            &context
        ));
        assert_eq!(
            limit_of(json!({ "x": format!("$prev.{deep_key}") }), &context),
            ResolutionLimit::Depth
        );
        #[cfg(feature = "server")]
        {
            assert!(super::reads_step_data(&json!({ "x": key_ref })));
            assert!(super::reads_step_data(
                &json!({ "x": format!("$steps.{alias}") })
            ));
        }
    }

    // JS Unicode whitespace (U+00A0, U+FEFF) is rejected even when the key exists.
    for ch in ['\u{00A0}', '\u{FEFF}'] {
        let key = format!("a{ch}b");
        let deep_key = format!("deep{ch}k");
        let alias = format!("step{ch}alias");
        let data = json!({
            key.clone(): "should-not-resolve",
            deep_key.clone(): nested_object(MAX_INPUT_DEPTH + 1),
        });
        let mut context = PipelineContext::default();
        context.push_step(ok_step(0, data.clone()).with_alias(&alias));

        let key_ref = format!("$prev.{key}");
        let alias_ref = format!("$steps.{alias}");
        let deep_ref = format!("$prev.{deep_key}");
        assert_eq!(resolve_variable(&key_ref, &context), Some(json!(key_ref)));
        assert_eq!(
            resolve_variable(&alias_ref, &context),
            Some(json!(alias_ref))
        );
        assert_eq!(get_nested_value(&data, &key), None);
        assert!(!evaluate_condition(
            &PipelineCondition::Exists {
                exists: key_ref.clone()
            },
            &context
        ));
        assert_eq!(
            try_resolve_variables(&json!({ "x": deep_ref }), &context).unwrap(),
            json!({ "x": deep_ref })
        );
        #[cfg(feature = "server")]
        {
            assert!(!super::reads_step_data(&json!({ "x": key_ref })));
            assert!(!super::reads_step_data(&json!({ "x": alias_ref })));
        }
    }
}
