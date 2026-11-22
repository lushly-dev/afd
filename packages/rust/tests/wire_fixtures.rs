//! Golden wire fixture round trips (`spec/wire/*.json`).
//!
//! Every fixture must deserialize into the native Rust types and serialize
//! back to JSON equal to the file. See `spec/wire/README.md`.

use afd::{
    command_result_output_schema, is_failure, is_success, ActorKind, BatchResult, CommandResult,
    PipelineResult, PlanStepStatus, StepStatus, StreamChunk, WarningSeverity,
};
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;

fn wire_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../spec/wire")
}

fn schema_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../spec/schema")
}

struct SchemaRegistry {
    by_id: HashMap<String, Value>,
    by_file: HashMap<String, String>,
}

impl SchemaRegistry {
    fn load() -> Self {
        let mut by_id = HashMap::new();
        let mut by_file = HashMap::new();
        for file in [
            "error.json",
            "result.json",
            "output-envelope.json",
            "batch.json",
            "pipeline.json",
            "stream.json",
        ] {
            let path = schema_dir().join(file);
            let text = std::fs::read_to_string(&path)
                .unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()));
            let schema: Value = serde_json::from_str(&text)
                .unwrap_or_else(|e| panic!("invalid JSON in {file}: {e}"));
            let id = schema["$id"]
                .as_str()
                .unwrap_or_else(|| panic!("{file} missing $id"))
                .to_string();
            by_file.insert(file.to_string(), id.clone());
            by_id.insert(id, schema);
        }
        Self { by_id, by_file }
    }

    fn resolve_ref<'a>(&'a self, current_id: &str, reference: &str) -> (&'a str, &'a Value) {
        let (target_id, fragment) = match reference.split_once('#') {
            Some(("", frag)) => (current_id.to_string(), frag),
            Some((rel, frag)) => (resolve_relative_id(current_id, rel), frag),
            None => (resolve_relative_id(current_id, reference), ""),
        };
        let (stored_id, root) = self
            .by_id
            .get_key_value(&target_id)
            .unwrap_or_else(|| panic!("unresolved schema $ref: {reference} -> {target_id}"));
        if fragment.is_empty() {
            return (stored_id.as_str(), root);
        }
        let target = root
            .pointer(fragment)
            .unwrap_or_else(|| panic!("unresolved pointer {fragment} in {stored_id}"));
        (stored_id.as_str(), target)
    }

    fn validate_file(&self, file: &str, value: &Value) -> Result<(), String> {
        let id = self.by_file.get(file).expect("known schema file");
        let root = &self.by_id[id];
        self.validate_node(id, root, value, "$")
    }

    fn validate_node(
        &self,
        current_id: &str,
        schema: &Value,
        value: &Value,
        path: &str,
    ) -> Result<(), String> {
        if let Some(b) = schema.as_bool() {
            return if b {
                Ok(())
            } else {
                Err(format!("{path}: schema is false"))
            };
        }
        let obj = schema
            .as_object()
            .ok_or_else(|| format!("{path}: schema must be object or bool"))?;

        if let Some(reference) = obj.get("$ref").and_then(Value::as_str) {
            let (next_id, target) = self.resolve_ref(current_id, reference);
            self.validate_node(next_id, target, value, path)?;
        }
        if let Some(expected) = obj.get("const") {
            if value != expected {
                return Err(format!("{path}: expected const {expected}, got {value}"));
            }
        }
        if let Some(allowed) = obj.get("enum").and_then(Value::as_array) {
            if !allowed.iter().any(|item| item == value) {
                return Err(format!("{path}: {value} not in enum {allowed:?}"));
            }
        }
        if let Some(kind) = obj.get("type") {
            let types: Vec<&str> = match kind {
                Value::String(s) => vec![s.as_str()],
                Value::Array(arr) => arr.iter().filter_map(Value::as_str).collect(),
                _ => vec![],
            };
            if !types.iter().any(|t| matches_type(value, t)) {
                return Err(format!("{path}: expected type {types:?}, got {value}"));
            }
        }
        if let Some(s) = value.as_str() {
            if let Some(min) = obj.get("minLength").and_then(Value::as_u64) {
                if (s.chars().count() as u64) < min {
                    return Err(format!("{path}: string shorter than {min}"));
                }
            }
        }
        if let Some(n) = value.as_f64() {
            if let Some(min) = obj.get("minimum").and_then(Value::as_f64) {
                if n < min {
                    return Err(format!("{path}: {n} < minimum {min}"));
                }
            }
            if let Some(max) = obj.get("maximum").and_then(Value::as_f64) {
                if n > max {
                    return Err(format!("{path}: {n} > maximum {max}"));
                }
            }
        }
        if let Some(arr) = value.as_array() {
            if let Some(item_schema) = obj.get("items") {
                for (i, item) in arr.iter().enumerate() {
                    self.validate_node(current_id, item_schema, item, &format!("{path}[{i}]"))?;
                }
            }
        }
        if let Some(map) = value.as_object() {
            if let Some(req) = obj.get("required").and_then(Value::as_array) {
                for key in req.iter().filter_map(Value::as_str) {
                    if !map.contains_key(key) {
                        return Err(format!("{path}: missing required property '{key}'"));
                    }
                }
            }
            let props = obj.get("properties").and_then(Value::as_object);
            for (k, v) in map {
                if let Some(prop_schema) = props.and_then(|p| p.get(k)) {
                    self.validate_node(current_id, prop_schema, v, &format!("{path}.{k}"))?;
                } else if let Some(addl) = obj.get("additionalProperties") {
                    if addl == &Value::Bool(false) {
                        return Err(format!("{path}: unexpected property '{k}'"));
                    } else if addl.is_object() {
                        self.validate_node(current_id, addl, v, &format!("{path}.{k}"))?;
                    }
                }
            }
        }
        if let Some(branches) = obj.get("allOf").and_then(Value::as_array) {
            for branch in branches {
                self.validate_node(current_id, branch, value, path)?;
            }
        }
        if let Some(branches) = obj.get("oneOf").and_then(Value::as_array) {
            let matches = branches
                .iter()
                .filter(|b| self.validate_node(current_id, b, value, path).is_ok())
                .count();
            if matches != 1 {
                return Err(format!("{path}: expected 1 oneOf match, got {matches}"));
            }
        }
        if let Some(cond) = obj.get("if") {
            let matched = self.validate_node(current_id, cond, value, path).is_ok();
            if matched {
                if let Some(then_branch) = obj.get("then") {
                    self.validate_node(current_id, then_branch, value, path)?;
                }
            } else if let Some(else_branch) = obj.get("else") {
                self.validate_node(current_id, else_branch, value, path)?;
            }
        }
        if let Some(neg) = obj.get("not") {
            if self.validate_node(current_id, neg, value, path).is_ok() {
                return Err(format!("{path}: matched forbidden 'not' schema"));
            }
        }
        Ok(())
    }
}

fn resolve_relative_id(base_id: &str, rel: &str) -> String {
    if rel.contains("://") {
        return rel.to_string();
    }
    let prefix = base_id.rsplit_once('/').map(|(p, _)| p).unwrap_or(base_id);
    format!("{prefix}/{rel}")
}

fn matches_type(value: &Value, expected: &str) -> bool {
    match expected {
        "null" => value.is_null(),
        "boolean" => value.is_boolean(),
        "string" => value.is_string(),
        "array" => value.is_array(),
        "object" => value.is_object(),
        "number" => value.is_number(),
        "integer" => {
            value.as_i64().is_some()
                || value.as_u64().is_some()
                || value.as_f64().is_some_and(|n| n.fract() == 0.0)
        }
        _ => false,
    }
}

fn load(name: &str) -> Value {
    let path = wire_dir().join(name);
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("cannot read {}: {error}", path.display()));
    serde_json::from_str(&text)
        .unwrap_or_else(|error| panic!("{} is not valid JSON: {error}", path.display()))
}

/// Deserialize `name` into `T`, serialize it back, and require equality with the file.
fn round_trip<T: DeserializeOwned + Serialize>(name: &str) -> T {
    let original = load(name);
    let typed: T = serde_json::from_value(original.clone())
        .unwrap_or_else(|error| panic!("{name} does not deserialize: {error}"));
    let reencoded = serde_json::to_value(&typed)
        .unwrap_or_else(|error| panic!("{name} does not serialize: {error}"));
    assert_eq!(reencoded, original, "{name} changed on a round trip");
    typed
}

#[test]
fn every_fixture_round_trips() {
    let mut names: Vec<String> = std::fs::read_dir(wire_dir())
        .expect("spec/wire should exist")
        .map(|entry| entry.expect("readable entry").file_name())
        .map(|name| name.to_string_lossy().into_owned())
        .filter(|name| name.ends_with(".json"))
        .collect();
    names.sort();
    assert!(!names.is_empty(), "no fixtures found in spec/wire");

    for name in &names {
        match name.as_str() {
            "result-success-minimal.json" | "result-success-full.json" | "result-failure.json" => {
                round_trip::<CommandResult<Value>>(name);
            }
            "batch-result.json" => {
                round_trip::<BatchResult>(name);
            }
            "pipeline-result.json" => {
                round_trip::<PipelineResult>(name);
            }
            "stream-chunks.json" => {
                round_trip::<Vec<StreamChunk>>(name);
            }
            other => panic!("no Rust type is mapped for spec/wire/{other}; add it to this test"),
        }
    }
}

#[test]
fn minimal_success_fields_are_typed() {
    let result: CommandResult<Value> = round_trip("result-success-minimal.json");
    assert!(is_success(&result));
    let metadata = result.metadata.expect("metadata");
    assert_eq!(metadata.execution_time_ms, Some(0.0));
    assert_eq!(metadata.command_version.as_deref(), Some("1.0.0"));
    assert_eq!(metadata.trace_id.as_deref(), Some("trace-fixture"));
    // The caller's kind: the fixtures come from MCP calls.
    assert_eq!(metadata.actor_kind, Some(ActorKind::Agent));
    assert!(metadata.extra.is_empty());
}

#[test]
fn unknown_actor_kinds_read_as_absent() {
    let mut fixture = load("result-success-minimal.json");
    fixture["metadata"]["actorKind"] = Value::String("robot".to_string());
    let result: CommandResult<Value> = serde_json::from_value(fixture).unwrap();
    let metadata = result.metadata.expect("metadata");
    assert_eq!(metadata.actor_kind, None);
    assert!(metadata.extra.is_empty());
}

#[test]
fn full_success_fields_are_typed() {
    let result: CommandResult<Value> = round_trip("result-success-full.json");
    assert!(is_success(&result));
    assert_eq!(result.confidence, Some(0.92));

    let source = &result.sources.as_ref().expect("sources")[0];
    assert_eq!(source.source_type, "document");
    assert_eq!(source.id.as_deref(), Some("doc-7"));
    assert_eq!(source.relevance, Some(0.8));

    let plan = result.plan.as_ref().expect("plan");
    assert_eq!(plan[0].status, PlanStepStatus::Complete);
    assert_eq!(plan[1].status, PlanStepStatus::Failed);
    assert_eq!(
        plan[1].depends_on.as_deref(),
        Some(&["validate".to_string()][..])
    );
    assert_eq!(plan[1].error.as_ref().expect("error").code, "STORE_BUSY");

    let alternative = &result.alternatives.as_ref().expect("alternatives")[0];
    assert_eq!(alternative.label.as_deref(), Some("Completed"));

    let warning = &result.warnings.as_ref().expect("warnings")[0];
    assert_eq!(warning.severity, Some(WarningSeverity::Caution));
    assert!(warning.details.is_some());

    assert_eq!(
        result.suggestions.as_deref(),
        Some(&["Use todo-list to review existing todos".to_string()][..])
    );
    assert_eq!(result.undo_command.as_deref(), Some("todo-delete"));
    assert!(result.undo_args.is_some());

    let metadata = result.metadata.expect("metadata");
    assert_eq!(metadata.command_version.as_deref(), Some("2.1.0"));
    assert_eq!(
        metadata.extra.get("region"),
        Some(&Value::String("test".to_string()))
    );
}

#[test]
fn failure_fields_are_typed() {
    let result: CommandResult<Value> = round_trip("result-failure.json");
    assert!(is_failure(&result));
    let error = result.error.expect("error");
    assert_eq!(error.code, "NOT_FOUND");
    assert_eq!(
        error.suggestion.as_deref(),
        Some("Use todo-list to see available todos")
    );
    assert_eq!(error.retryable, Some(false));
}

#[test]
fn batch_fields_are_typed() {
    let result: BatchResult = round_trip("batch-result.json");
    assert!(result.success, "a batch with a failed command still ran");
    assert_eq!(result.summary.total, 2);
    assert_eq!(result.summary.success_count, 1);
    assert_eq!(result.summary.failure_count, 1);
    assert_eq!(result.summary.skipped_count, 0);
    assert_eq!(result.results[1].index, 1);
    assert_eq!(result.results[1].id, "second");
    assert!(!result.results[1].result.success);
    assert_eq!(result.timing.completed_at, "2026-01-01T00:00:00.000Z");
    assert_eq!(result.confidence, 0.75);
    assert_eq!(
        result.metadata.and_then(|metadata| metadata.trace_id),
        Some("trace-fixture".to_string())
    );
}

#[test]
fn pipeline_fields_are_typed() {
    let result: PipelineResult = round_trip("pipeline-result.json");
    assert!(result.data.is_some());
    let metadata = &result.metadata;
    assert_eq!(metadata.confidence, 0.92);
    assert_eq!(metadata.completed_steps, 2);
    assert_eq!(
        metadata.confidence_breakdown[0].alias.as_deref(),
        Some("first")
    );
    assert_eq!(metadata.reasoning[0].step_index, 1);
    assert_eq!(
        metadata.warnings[0].severity,
        Some(WarningSeverity::Caution)
    );
    assert!(metadata.warnings[0].details.is_some());
    assert_eq!(metadata.sources[0].source_type, "document");
    assert_eq!(metadata.sources[0].step_index, 1);
    assert_eq!(metadata.alternatives[0].label.as_deref(), Some("Completed"));
    assert!(metadata.extra.is_empty());

    assert_eq!(result.steps[0].status, StepStatus::Success);
    assert_eq!(result.steps[0].alias.as_deref(), Some("first"));
    let step_metadata = result.steps[1].metadata.as_ref().expect("step metadata");
    assert_eq!(step_metadata.confidence, Some(0.92));
    assert_eq!(step_metadata.sources.as_ref().map(Vec::len), Some(1));
    assert!(step_metadata.extra.is_empty());
}

#[test]
fn stream_chunk_fields_are_typed() {
    let chunks: Vec<StreamChunk> = round_trip("stream-chunks.json");
    assert_eq!(chunks.len(), 4);
    match &chunks[0] {
        StreamChunk::Progress(chunk) => {
            assert_eq!(chunk.progress, 0.5);
            assert_eq!(chunk.current_step, Some(1));
            assert_eq!(chunk.message.as_deref(), Some("Halfway"));
        }
        other => panic!("expected progress, got {other:?}"),
    }
    match &chunks[1] {
        StreamChunk::Data(chunk) => {
            assert_eq!(chunk.index, 0);
            assert!(!chunk.is_last);
            assert_eq!(chunk.chunk_id.as_deref(), Some("chunk-0"));
        }
        other => panic!("expected data, got {other:?}"),
    }
    match &chunks[2] {
        StreamChunk::Complete(chunk) => {
            assert_eq!(chunk.total_chunks, 1);
            assert_eq!(chunk.confidence, Some(1.0));
            assert!(chunk.data.is_some());
        }
        other => panic!("expected complete, got {other:?}"),
    }
    match &chunks[3] {
        StreamChunk::Error(chunk) => {
            assert_eq!(chunk.error.code, "STREAM_ERROR");
            assert_eq!(chunk.chunks_before_error, 1);
            assert!(!chunk.recoverable);
        }
        other => panic!("expected error, got {other:?}"),
    }
}

#[test]
fn every_wire_fixture_validates_against_spec_schema() {
    let schemas = SchemaRegistry::load();
    for (fixture, schema) in [
        ("result-success-minimal.json", "result.json"),
        ("result-success-full.json", "result.json"),
        ("result-failure.json", "result.json"),
        ("batch-result.json", "batch.json"),
        ("pipeline-result.json", "pipeline.json"),
    ] {
        let value = load(fixture);
        schemas
            .validate_file(schema, &value)
            .unwrap_or_else(|e| panic!("{fixture} failed {schema}: {e}"));
    }
    let chunks = load("stream-chunks.json");
    for (index, chunk) in chunks.as_array().expect("chunks array").iter().enumerate() {
        schemas
            .validate_file("stream.json", chunk)
            .unwrap_or_else(|e| panic!("stream-chunks[{index}] failed stream.json: {e}"));
    }

    // Negative cases: the schemas reject malformed results, errors and stream chunks.
    assert!(schemas
        .validate_file(
            "result.json",
            &json!({ "success": true, "confidence": 1.5 })
        )
        .is_err());
    assert!(schemas
        .validate_file(
            "result.json",
            &json!({ "success": true, "error": { "code": "E", "message": "bad" } })
        )
        .is_err());
    assert!(schemas
        .validate_file("result.json", &json!({ "success": false }))
        .is_err());
    assert!(schemas
        .validate_file(
            "result.json",
            &json!({ "success": false, "data": {}, "error": { "code": "E", "message": "bad" } })
        )
        .is_err());
    assert!(schemas
        .validate_file(
            "result.json",
            &json!({ "success": true, "unknownField": 1 })
        )
        .is_err());
    assert!(schemas
        .validate_file("error.json", &json!({ "message": "missing code" }))
        .is_err());
    assert!(schemas
        .validate_file("stream.json", &json!({ "type": "unknown" }))
        .is_err());
}

#[test]
fn output_schema_envelope_matches_spec() {
    let path = schema_dir().join("output-envelope.json");
    let spec: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let data = json!({ "type": "object", "properties": { "id": { "type": "string" } } });
    let actual = command_result_output_schema(&data);
    let mut expected_props = spec["properties"].as_object().unwrap().clone();
    expected_props.insert("data".to_string(), data);
    assert_eq!(
        actual,
        json!({
            "type": spec["type"],
            "properties": expected_props,
            "required": spec["required"],
        })
    );
}
