//! The language-neutral vectors in `spec/vectors/batch-controls.json`.
//!
//! The TypeScript executors generated the expected values on a virtual clock;
//! here the cases run on Tokio's paused clock, so handler delays and deadlines
//! take no real time. Any difference between Rust and TypeScript fails here.
//! TypeScript, Python and C++ load the same file (see
//! `spec/vectors/README.md`).
//!
//! Rust rejects some invalid envelopes when it deserializes the request. That
//! counts as the expected rejection, because nothing runs.

use afd::{
    execute_pipeline, failure, success, BatchRequest, CommandContext, CommandDefinition,
    CommandError, CommandExecutor, CommandHandler, CommandRegistry, CommandResult, PipelineRequest,
};
use async_trait::async_trait;
use serde_json::{json, Map, Value};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

/// Cases where Rust knowingly differs from TypeScript: `(case name, reason)`.
///
/// A listed case that matches TypeScript fails the test, so the list stays
/// honest: remove the entry when the divergence is fixed.
const KNOWN_DIVERGENCES: &[(&str, &str)] = &[];

fn load_vectors() -> Value {
    let path =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../spec/vectors/batch-controls.json");
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("cannot read {}: {error}", path.display()));
    serde_json::from_str(&text)
        .unwrap_or_else(|error| panic!("{} is not valid JSON: {error}", path.display()))
}

// ═══════════════════════════════════════════════════════════════════════════
// HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

/// Every handler call in start order, and how many handlers ran at once.
#[derive(Default)]
struct Record {
    /// `(command, input, batch index)` for each call.
    calls: Vec<(String, Value, Option<usize>)>,
    active: usize,
    peak: usize,
}

type SharedRecord = Arc<Mutex<Record>>;

fn lock(record: &SharedRecord) -> std::sync::MutexGuard<'_, Record> {
    record.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Counts a handler as running until it is dropped, including when the
/// executor drops the handler's future at a deadline.
struct Running(SharedRecord);

impl Drop for Running {
    fn drop(&mut self) {
        lock(&self.0).active -= 1;
    }
}

/// Run the declarative handler `spec` for one call, as the README describes.
async fn run_handler(
    spec: Value,
    command: String,
    input: Value,
    index: Option<usize>,
    record: SharedRecord,
) -> CommandResult<Value> {
    let _running = {
        let mut state = lock(&record);
        state.calls.push((command, input.clone(), index));
        state.active += 1;
        state.peak = state.peak.max(state.active);
        Running(Arc::clone(&record))
    };
    if spec["untilCancelled"] == json!(true) {
        // Only the executor's deadline ends this call, by dropping it.
        std::future::pending::<()>().await;
    } else if let Some(delay_ms) = spec["delayMs"].as_u64().filter(|&delay_ms| delay_ms > 0) {
        tokio::time::sleep(Duration::from_millis(delay_ms)).await;
    }
    match spec.get("fail") {
        Some(error) => failure(CommandError::new(
            error["code"].as_str().expect("fail.code is a string"),
            error["message"].as_str().expect("fail.message is a string"),
        )),
        None => success(input),
    }
}

/// A registered command that runs one declarative handler.
struct VectorHandler {
    command: String,
    spec: Value,
    record: SharedRecord,
}

#[async_trait]
impl CommandHandler for VectorHandler {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        // Each command's trace ID is batch-<index>; keep the index so a result
        // can say whether its command ran.
        let index = context
            .trace_id
            .as_deref()
            .and_then(|trace_id| trace_id.strip_prefix("batch-"))
            .and_then(|index| index.parse().ok());
        run_handler(
            self.spec.clone(),
            self.command.clone(),
            input,
            index,
            Arc::clone(&self.record),
        )
        .await
    }
}

fn handlers_of(vector: &Value) -> &Map<String, Value> {
    vector["handlers"]
        .as_object()
        .expect("handlers is an object")
}

fn registry_for(vector: &Value, record: &SharedRecord) -> CommandRegistry {
    let registry = CommandRegistry::new();
    for (command, spec) in handlers_of(vector) {
        let handler = VectorHandler {
            command: command.clone(),
            spec: spec.clone(),
            record: Arc::clone(record),
        };
        registry
            .register(CommandDefinition::new(
                command,
                "Vector handler",
                vec![],
                handler,
            ))
            .unwrap_or_else(|error| panic!("cannot register {command}: {error}"));
    }
    registry
}

fn executor_for(vector: &Value, record: &SharedRecord) -> CommandExecutor {
    let handlers = handlers_of(vector).clone();
    let record = Arc::clone(record);
    Arc::new(move |command, input, _context| {
        let spec = handlers.get(&command).cloned();
        let record = Arc::clone(&record);
        Box::pin(async move {
            match spec {
                Some(spec) => run_handler(spec, command, input, None, record).await,
                None => failure(CommandError::new(
                    "NO_HANDLER",
                    format!("No handler for {command}"),
                )),
            }
        })
    })
}

// ═══════════════════════════════════════════════════════════════════════════
// PROJECTIONS (as in packages/core/src/batch-controls-vectors.test.ts)
// ═══════════════════════════════════════════════════════════════════════════

/// `code` and `message` of a wire-format error, and `retryable` only when
/// the vector's error gives it (the README's comparison rules).
fn project_error(error: &Value, expected: &Value) -> Value {
    let mut projected = json!({ "code": error["code"], "message": error["message"] });
    if expected.get("retryable").is_some() {
        if let Some(retryable) = error.get("retryable") {
            projected["retryable"] = retryable.clone();
        }
    }
    projected
}

fn copy_field(from: &Value, to: &mut Map<String, Value>, field: &str) {
    if let Some(value) = from.get(field) {
        to.insert(field.to_string(), value.clone());
    }
}

/// Project a batch result in its wire format. `ran` holds the indexes of the
/// commands whose handlers ran; only the others report `durationMs`.
fn project_batch(result: &Value, ran: &[usize], expected: &Value) -> Value {
    if result["success"] != json!(true) {
        return json!({
            "success": false,
            "error": project_error(&result["error"], &expected["error"]),
            "results": result["results"],
        });
    }
    let results: Vec<Value> = result["results"]
        .as_array()
        .expect("results is an array")
        .iter()
        .enumerate()
        .map(|(position, entry)| {
            let mut projected = Map::new();
            copy_field(entry, &mut projected, "id");
            copy_field(entry, &mut projected, "index");
            copy_field(entry, &mut projected, "command");
            let outcome = &entry["result"];
            projected.insert("success".to_string(), outcome["success"].clone());
            if outcome["success"] == json!(true) {
                projected.insert("data".to_string(), outcome["data"].clone());
            } else {
                let expected_error = &expected["results"][position]["error"];
                projected.insert(
                    "error".to_string(),
                    project_error(&outcome["error"], expected_error),
                );
            }
            let index = entry["index"].as_u64().map(|index| index as usize);
            if !index.is_some_and(|index| ran.contains(&index)) {
                copy_field(entry, &mut projected, "durationMs");
            }
            Value::Object(projected)
        })
        .collect();
    json!({ "success": true, "summary": result["summary"], "results": results })
}

/// Project a pipeline result in its wire format.
fn project_pipeline(result: &Value, expected: &Value) -> Value {
    let mut projected = Map::new();
    copy_field(result, &mut projected, "data");
    copy_field(&result["metadata"], &mut projected, "completedSteps");
    copy_field(&result["metadata"], &mut projected, "totalSteps");
    let steps: Vec<Value> = result["steps"]
        .as_array()
        .expect("steps is an array")
        .iter()
        .enumerate()
        .map(|(position, step)| {
            let mut projected = Map::new();
            for field in ["index", "command", "alias", "status", "data"] {
                copy_field(step, &mut projected, field);
            }
            if let Some(error) = step.get("error") {
                let expected_error = &expected["steps"][position]["error"];
                projected.insert("error".to_string(), project_error(error, expected_error));
            }
            Value::Object(projected)
        })
        .collect();
    projected.insert("steps".to_string(), Value::Array(steps));
    Value::Object(projected)
}

/// `expected` without `calls` and `peakConcurrency`: the projected result.
fn expected_outcome(expected: &Value) -> Value {
    let mut outcome = expected.as_object().expect("expected is an object").clone();
    outcome.remove("calls");
    outcome.remove("peakConcurrency");
    Value::Object(outcome)
}

fn recorded_calls(record: &SharedRecord) -> Value {
    lock(record)
        .calls
        .iter()
        .map(|(command, input, _)| json!({ "command": command, "input": input }))
        .collect()
}

// ═══════════════════════════════════════════════════════════════════════════
// RUNNING THE CASES
// ═══════════════════════════════════════════════════════════════════════════

/// Whether a case sets a deadline that the executor would enforce.
///
/// Without `native`, such a deadline returns `UNSUPPORTED_OPTION`.
#[cfg(not(feature = "native"))]
fn sets_deadline(request: &Value, option: &str) -> bool {
    request["options"][option]
        .as_f64()
        .is_some_and(|timeout| timeout >= 0.0)
}

/// Run one batch case. `Err` describes how Rust differs from the vector.
async fn run_batch_case(vector: &Value) -> Result<(), String> {
    let expected = &vector["expected"];
    let rejects = expected["success"] == json!(false);
    let request: BatchRequest<Value> = match serde_json::from_value(vector["request"].clone()) {
        Ok(request) => request,
        // Nothing runs when the envelope does not deserialize.
        Err(_) if rejects && expected["calls"] == json!([]) => return Ok(()),
        Err(error) => return Err(format!("the request does not deserialize: {error}")),
    };

    let record = SharedRecord::default();
    let registry = registry_for(vector, &record);
    let result = registry
        .execute_batch_with_context(request, CommandContext::new().with_trace_id("batch"))
        .await;
    let wire = serde_json::to_value(&result).expect("a batch result serializes");

    let calls = recorded_calls(&record);
    let (ran, peak): (Vec<usize>, usize) = {
        let state = lock(&record);
        (
            state.calls.iter().filter_map(|call| call.2).collect(),
            state.peak,
        )
    };
    let mut problems = Vec::new();
    if calls != expected["calls"] {
        problems.push(format!(
            "calls: expected {}, got {calls}",
            expected["calls"]
        ));
    }
    if let Some(expected_peak) = expected["peakConcurrency"].as_u64() {
        if peak as u64 != expected_peak {
            problems.push(format!(
                "peakConcurrency: expected {expected_peak}, got {peak}"
            ));
        }
    }
    let outcome = project_batch(&wire, &ran, expected);
    let expected_outcome = expected_outcome(expected);
    if outcome != expected_outcome {
        problems.push(format!(
            "result: expected {expected_outcome}, got {outcome}"
        ));
    }
    if problems.is_empty() {
        Ok(())
    } else {
        Err(problems.join("; "))
    }
}

/// Run one pipeline case. `Err` describes how Rust differs from the vector.
async fn run_pipeline_case(vector: &Value) -> Result<(), String> {
    let expected = &vector["expected"];
    // A rejected pipeline has one synthetic step, with index -1.
    let rejects = expected["steps"][0]["index"] == json!(-1);
    let request: PipelineRequest = match serde_json::from_value(vector["request"].clone()) {
        Ok(request) => request,
        // Nothing runs when the envelope does not deserialize.
        Err(_) if rejects && expected["calls"] == json!([]) => return Ok(()),
        Err(error) => return Err(format!("the request does not deserialize: {error}")),
    };

    let record = SharedRecord::default();
    let executor = executor_for(vector, &record);
    let result = execute_pipeline(&request, &executor, None).await;
    let wire = serde_json::to_value(&result).expect("a pipeline result serializes");

    let calls = recorded_calls(&record);
    let mut problems = Vec::new();
    if calls != expected["calls"] {
        problems.push(format!(
            "calls: expected {}, got {calls}",
            expected["calls"]
        ));
    }
    let outcome = project_pipeline(&wire, expected);
    let expected_outcome = expected_outcome(expected);
    if outcome != expected_outcome {
        problems.push(format!(
            "result: expected {expected_outcome}, got {outcome}"
        ));
    }
    if problems.is_empty() {
        Ok(())
    } else {
        Err(problems.join("; "))
    }
}

/// Compare each case's outcome with [`KNOWN_DIVERGENCES`], collecting mismatches.
fn check(kind: &str, name: &str, outcome: Result<(), String>, mismatches: &mut Vec<String>) {
    let known = KNOWN_DIVERGENCES
        .iter()
        .find(|(divergent, _)| *divergent == name);
    match (outcome, known) {
        (Ok(()), None) | (Err(_), Some(_)) => {}
        (Err(problem), None) => mismatches.push(format!("{kind}: {name}: {problem}")),
        (Ok(()), Some(_)) => mismatches.push(format!(
            "{kind}: {name}: listed in KNOWN_DIVERGENCES but matches TypeScript; remove it from the list"
        )),
    }
}

fn cases<'a>(vectors: &'a Value, kind: &str) -> &'a [Value] {
    let cases = vectors[kind].as_array().expect("cases are an array");
    assert!(cases.len() >= 20, "expected at least 20 {kind} cases");
    cases
}

fn name_of(vector: &Value) -> &str {
    vector["name"].as_str().expect("name is a string")
}

#[test]
fn known_divergences_name_existing_cases() {
    let vectors = load_vectors();
    let names: Vec<&str> = ["batch", "pipeline"]
        .iter()
        .flat_map(|kind| cases(&vectors, kind).iter().map(name_of))
        .collect();
    for (name, _) in KNOWN_DIVERGENCES {
        assert!(
            names.contains(name),
            "KNOWN_DIVERGENCES names no case: {name}"
        );
    }
}

#[tokio::test(start_paused = true)]
async fn batch_cases_match_the_typescript_vectors() {
    let vectors = load_vectors();
    let mut mismatches = Vec::new();
    for vector in cases(&vectors, "batch") {
        #[cfg(not(feature = "native"))]
        if sets_deadline(&vector["request"], "timeout") {
            continue;
        }
        let name = name_of(vector);
        check("batch", name, run_batch_case(vector).await, &mut mismatches);
    }
    assert!(mismatches.is_empty(), "{}", mismatches.join("\n"));
}

#[tokio::test(start_paused = true)]
async fn pipeline_cases_match_the_typescript_vectors() {
    let vectors = load_vectors();
    let mut mismatches = Vec::new();
    for vector in cases(&vectors, "pipeline") {
        #[cfg(not(feature = "native"))]
        if sets_deadline(&vector["request"], "timeoutMs") {
            continue;
        }
        let name = name_of(vector);
        check(
            "pipeline",
            name,
            run_pipeline_case(vector).await,
            &mut mismatches,
        );
    }
    assert!(mismatches.is_empty(), "{}", mismatches.join("\n"));
}
