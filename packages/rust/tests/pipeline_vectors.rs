//! The language-neutral vectors in `spec/vectors/pipeline-variables.json`.
//!
//! The TypeScript implementation generated the expected values; any
//! difference between Rust and TypeScript on these inputs fails here.
//! TypeScript, Python and C++ load the same file (see
//! `spec/vectors/README.md`).

use afd::{
    evaluate_condition, resolve_variable, resolve_variables, PipelineCondition, PipelineContext,
    StepResult, StepStatus,
};
use serde_json::{json, Value};
use std::path::PathBuf;

fn load_vectors(name: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../spec/vectors")
        .join(name);
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("cannot read {}: {error}", path.display()));
    serde_json::from_str(&text)
        .unwrap_or_else(|error| panic!("{} is not valid JSON: {error}", path.display()))
}

fn context_from(spec: &Value) -> PipelineContext {
    let mut context = PipelineContext::new(Some(spec["input"].clone()));
    for entry in spec["steps"].as_array().expect("steps is an array") {
        let index = entry["index"].as_u64().expect("index is a number") as usize;
        let status = match entry["status"].as_str() {
            Some("success") => StepStatus::Success,
            _ => StepStatus::Failure,
        };
        let mut step = StepResult::new(index, format!("step-{index}"), status);
        if let Some(alias) = entry.get("alias").and_then(Value::as_str) {
            step = step.with_alias(alias);
        }
        if let Some(data) = entry.get("data") {
            step = step.with_data(data.clone());
        }
        context.steps.push(step);
    }
    let previous = spec["previous"].as_u64().expect("previous is a number") as usize;
    context.previous_result = Some(context.steps[previous].clone());
    context
}

/// A short, printable name: some references are 1024 characters or hold a no-break space.
fn label(text: &str) -> String {
    let printable = format!("{text:?}");
    if printable.chars().count() > 60 {
        let start: String = printable.chars().take(40).collect();
        format!("{start}... ({} chars)", text.chars().count())
    } else {
        printable
    }
}

#[test]
fn pipeline_references_and_conditions_match_the_typescript_vectors() {
    let vectors = load_vectors("pipeline-variables.json");
    let context = context_from(&vectors["context"]);
    let mut mismatches = Vec::new();

    let references = vectors["references"].as_array().expect("references");
    assert!(references.len() >= 40);
    for vector in references {
        let reference = vector["reference"].as_str().expect("reference is a string");
        let expected = if vector["resolved"] == json!(true) {
            Some(vector["value"].clone())
        } else {
            None
        };
        let resolved = resolve_variable(reference, &context);
        // Inside a step input, an unresolved reference is omitted from its object.
        let input = resolve_variables(&json!({ "value": reference }), &context);
        let expected_input = match &expected {
            Some(value) => json!({ "value": value }),
            None => json!({}),
        };
        if resolved != expected || input != expected_input {
            mismatches.push(format!(
                "reference {}: expected {expected:?}, got {resolved:?} (step input {input})",
                label(reference)
            ));
        }
    }

    let conditions = vectors["conditions"].as_array().expect("conditions");
    assert!(conditions.len() >= 20);
    for vector in conditions {
        let condition: PipelineCondition = serde_json::from_value(vector["condition"].clone())
            .unwrap_or_else(|error| panic!("{} does not parse: {error}", vector["condition"]));
        let expected = vector["expected"].as_bool().expect("expected is a boolean");
        if evaluate_condition(&condition, &context) != expected {
            mismatches.push(format!(
                "condition {}: expected {expected}",
                vector["condition"]
            ));
        }
    }

    assert!(mismatches.is_empty(), "{}", mismatches.join("\n"));
}
