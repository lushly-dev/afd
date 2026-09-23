//! Golden wire fixture round trips (`spec/wire/*.json`).
//!
//! Every fixture must deserialize into the native Rust types and serialize
//! back to JSON equal to the file. See `spec/wire/README.md`.

use afd::{
    is_failure, is_success, BatchResult, CommandResult, PipelineResult, PlanStepStatus, StepStatus,
    StreamChunk, WarningSeverity,
};
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;
use std::path::PathBuf;

fn wire_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../spec/wire")
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
