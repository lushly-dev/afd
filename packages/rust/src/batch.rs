//! Batch command types for executing multiple commands.
//!
//! Batch operations execute multiple commands in a single request with partial
//! success semantics: [`BatchResult::success`] is `true` whenever the batch
//! itself ran, even if some commands failed. The JSON shapes match
//! `packages/core/src/batch.ts` and `spec/wire/batch-result.json`.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::errors::CommandError;
use crate::result::{CommandResult, ResultMetadata};

// ═══════════════════════════════════════════════════════════════════════════════
// BATCH REQUEST TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/// A single command in a batch request.
///
/// # Example
///
/// ```rust
/// use afd::BatchCommand;
///
/// let command = BatchCommand::new("todo-create", serde_json::json!({"title": "Buy milk"}))
///     .with_id("create-1");
/// assert_eq!(command.id.as_deref(), Some("create-1"));
/// ```
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct BatchCommand<T = serde_json::Value> {
    /// Optional client-provided ID for correlating results.
    /// When absent, results use `cmd-<index>`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,

    /// Command name to execute.
    pub command: String,

    /// Input data for the command.
    #[serde(default)]
    pub input: T,

    /// Optional tags for categorization (Rust extension; ignored by other hosts).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,

    /// Optional priority, higher is more important (Rust extension; ignored by other hosts).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub priority: Option<i32>,
}

impl<T> BatchCommand<T> {
    /// Create a new batch command without an ID.
    pub fn new(command: impl Into<String>, input: T) -> Self {
        Self {
            id: None,
            command: command.into(),
            input,
            tags: None,
            priority: None,
        }
    }

    /// Set the correlation ID.
    pub fn with_id(mut self, id: impl Into<String>) -> Self {
        self.id = Some(id.into());
        self
    }

    /// Add tags to the command.
    pub fn with_tags(mut self, tags: Vec<String>) -> Self {
        self.tags = Some(tags);
        self
    }

    /// Set priority.
    pub fn with_priority(mut self, priority: i32) -> Self {
        self.priority = Some(priority);
        self
    }
}

/// Options for batch execution.
///
/// Every field is optional on the wire. By default a batch runs every command
/// sequentially (`stopOnError: false`, `parallelism: 1`) with no deadline.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct BatchOptions {
    /// Stop at the first failure and skip the remaining commands.
    /// Defaults to `false`: every command runs and all results are collected.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stop_on_error: Option<bool>,

    /// Timeout for the entire batch in milliseconds.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "crate::wire::opt_number"
    )]
    pub timeout: Option<f64>,

    /// Maximum number of commands to execute concurrently. Defaults to 1.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parallelism: Option<usize>,

    /// Stop the batch once this many commands have failed
    /// (Rust extension; ignored by other hosts).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_failures: Option<usize>,
}

impl BatchOptions {
    /// Create default options.
    pub fn new() -> Self {
        Self::default()
    }

    /// Stop at the first failure (`true`) or run every command (`false`).
    pub fn with_stop_on_error(mut self, stop_on_error: bool) -> Self {
        self.stop_on_error = Some(stop_on_error);
        self
    }

    /// Set the batch deadline in milliseconds.
    pub fn with_timeout(mut self, timeout_ms: f64) -> Self {
        self.timeout = Some(timeout_ms);
        self
    }

    /// Set the maximum number of concurrently executing commands.
    pub fn with_parallelism(mut self, parallelism: usize) -> Self {
        self.parallelism = Some(parallelism);
        self
    }

    /// Stop after this many failures.
    pub fn with_max_failures(mut self, max_failures: usize) -> Self {
        self.max_failures = Some(max_failures);
        self
    }

    /// Whether execution stops at the first failure (default `false`).
    pub fn stops_on_error(&self) -> bool {
        self.stop_on_error.unwrap_or(false)
    }
}

/// A batch request containing multiple commands.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(
    rename_all = "camelCase",
    bound(deserialize = "T: Deserialize<'de> + Default")
)]
#[non_exhaustive]
pub struct BatchRequest<T = serde_json::Value> {
    /// Commands to execute.
    pub commands: Vec<BatchCommand<T>>,

    /// Execution options.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub options: Option<BatchOptions>,

    /// Additional context for the batch (Rust extension; ignored by other hosts).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context: Option<HashMap<String, serde_json::Value>>,
}

impl<T> BatchRequest<T> {
    /// Create a new batch request with default options.
    pub fn new(commands: Vec<BatchCommand<T>>) -> Self {
        Self {
            commands,
            options: None,
            context: None,
        }
    }

    /// Set batch options.
    pub fn with_options(mut self, options: BatchOptions) -> Self {
        self.options = Some(options);
        self
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// BATCH RESULT TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/// Result for a single command in a batch.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", bound(deserialize = "T: Deserialize<'de>"))]
#[non_exhaustive]
pub struct BatchCommandResult<T = serde_json::Value> {
    /// The command's ID, or `cmd-<index>` when it had none.
    pub id: String,

    /// Index position in the original batch request.
    pub index: usize,

    /// The command that was executed.
    pub command: String,

    /// The result of execution.
    pub result: CommandResult<T>,

    /// Execution time for this command in milliseconds.
    #[serde(serialize_with = "crate::wire::number")]
    pub duration_ms: f64,
}

impl<T> BatchCommandResult<T> {
    /// Create a batch command result with a zero duration.
    pub fn new(
        id: impl Into<String>,
        index: usize,
        command: impl Into<String>,
        result: CommandResult<T>,
    ) -> Self {
        Self {
            id: id.into(),
            index,
            command: command.into(),
            result,
            duration_ms: 0.0,
        }
    }

    /// Set the duration in milliseconds.
    pub fn with_duration(mut self, duration_ms: f64) -> Self {
        self.duration_ms = duration_ms;
        self
    }
}

/// A warning surfaced from a command within a batch execution.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct BatchWarning {
    /// ID of the command that produced this warning.
    pub command_id: String,

    /// Machine-readable warning code.
    pub code: String,

    /// Human-readable warning message.
    pub message: String,
}

impl BatchWarning {
    /// Create a batch warning.
    pub fn new(
        command_id: impl Into<String>,
        code: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        Self {
            command_id: command_id.into(),
            code: code.into(),
            message: message.into(),
        }
    }
}

/// Summary statistics for a batch execution.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct BatchSummary {
    /// Total commands in the batch.
    pub total: usize,

    /// Number of successful commands.
    pub success_count: usize,

    /// Number of failed commands.
    pub failure_count: usize,

    /// Number of skipped commands (after a stop).
    pub skipped_count: usize,
}

impl BatchSummary {
    /// Create a new batch summary.
    pub fn new(
        total: usize,
        success_count: usize,
        failure_count: usize,
        skipped_count: usize,
    ) -> Self {
        Self {
            total,
            success_count,
            failure_count,
            skipped_count,
        }
    }

    /// Calculate success rate.
    pub fn success_rate(&self) -> f64 {
        if self.total == 0 {
            0.0
        } else {
            self.success_count as f64 / self.total as f64
        }
    }
}

/// Timing information for batch execution.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct BatchTiming {
    /// Total duration in milliseconds.
    #[serde(serialize_with = "crate::wire::number")]
    pub total_ms: f64,

    /// Average time per command in milliseconds.
    #[serde(serialize_with = "crate::wire::number")]
    pub average_ms: f64,

    /// When the batch started (ISO timestamp).
    pub started_at: String,

    /// When the batch completed (ISO timestamp).
    pub completed_at: String,
}

impl BatchTiming {
    /// Create timing information.
    pub fn new(
        started_at: impl Into<String>,
        completed_at: impl Into<String>,
        total_ms: f64,
        average_ms: f64,
    ) -> Self {
        Self {
            total_ms,
            average_ms,
            started_at: started_at.into(),
            completed_at: completed_at.into(),
        }
    }
}

/// Complete result of a batch operation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", bound(deserialize = "T: Deserialize<'de>"))]
#[non_exhaustive]
pub struct BatchResult<T = serde_json::Value> {
    /// Whether the batch executed, independent of individual command failures.
    /// `false` only when the batch itself could not run (see [`error`](Self::error)).
    pub success: bool,

    /// Results for each command, in request order.
    pub results: Vec<BatchCommandResult<T>>,

    /// Summary statistics.
    pub summary: BatchSummary,

    /// Timing information.
    pub timing: BatchTiming,

    /// Aggregated confidence (see [`calculate_batch_confidence`]).
    #[serde(serialize_with = "crate::wire::number")]
    pub confidence: f64,

    /// Human-readable summary of the batch execution.
    pub reasoning: String,

    /// Aggregated warnings surfaced by commands in the batch.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub warnings: Option<Vec<BatchWarning>>,

    /// Batch-level error if the batch itself failed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<CommandError>,

    /// Execution metadata.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<ResultMetadata>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// FACTORY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/// Create a batch request from commands.
pub fn create_batch_request<T>(commands: Vec<BatchCommand<T>>) -> BatchRequest<T> {
    BatchRequest::new(commands)
}

fn is_skipped<T>(result: &BatchCommandResult<T>) -> bool {
    result
        .result
        .error
        .as_ref()
        .map(|error| error.code.as_str())
        == Some("COMMAND_SKIPPED")
}

fn plural(count: usize) -> &'static str {
    if count == 1 {
        ""
    } else {
        "s"
    }
}

fn batch_reasoning(summary: &BatchSummary) -> String {
    let head = format!(
        "Executed {} command{}",
        summary.total,
        plural(summary.total)
    );
    if summary.success_count == summary.total {
        return format!("{head}: all succeeded");
    }
    let mut details = Vec::new();
    if summary.success_count > 0 {
        details.push(format!("{} succeeded", summary.success_count));
    }
    if summary.failure_count > 0 {
        details.push(format!("{} failed", summary.failure_count));
    }
    if summary.skipped_count > 0 {
        details.push(format!("{} skipped", summary.skipped_count));
    }
    format!("{head}: {}", details.join(", "))
}

/// Create a completed batch result from individual results.
///
/// As in TypeScript's `createBatchResult`, the batch is successful (it ran)
/// even when some commands failed; the summary and confidence describe how
/// the commands fared.
pub fn create_batch_result<T>(
    results: Vec<BatchCommandResult<T>>,
    timing: BatchTiming,
    metadata: Option<ResultMetadata>,
) -> BatchResult<T> {
    let total = results.len();
    let success_count = results.iter().filter(|r| r.result.success).count();
    let skipped_count = results.iter().filter(|r| is_skipped(r)).count();
    let summary = BatchSummary::new(
        total,
        success_count,
        total - success_count - skipped_count,
        skipped_count,
    );

    let warnings: Vec<BatchWarning> = results
        .iter()
        .flat_map(|result| {
            result
                .result
                .warnings
                .iter()
                .flatten()
                .map(|warning| BatchWarning::new(&result.id, &warning.code, &warning.message))
        })
        .collect();

    BatchResult {
        success: true,
        confidence: calculate_batch_confidence(&results),
        reasoning: batch_reasoning(&summary),
        results,
        summary,
        timing,
        warnings: (!warnings.is_empty()).then_some(warnings),
        error: None,
        metadata,
    }
}

/// Create a failed batch result (the batch itself could not run).
pub fn create_failed_batch_result<T>(error: CommandError, started_at: &str) -> BatchResult<T> {
    BatchResult {
        success: false,
        results: vec![],
        summary: BatchSummary::default(),
        timing: BatchTiming::new(started_at, chrono::Utc::now().to_rfc3339(), 0.0, 0.0),
        confidence: 0.0,
        reasoning: format!("Batch execution failed: {}", error.message),
        warnings: None,
        error: Some(error),
        metadata: None,
    }
}

/// Calculate the aggregated confidence of a batch.
///
/// `successRatio * 0.5 + averageCommandConfidence * 0.5`, where the average
/// covers successful commands and a command without a confidence counts as 1.
/// An empty batch has confidence 1.
pub fn calculate_batch_confidence<T>(results: &[BatchCommandResult<T>]) -> f64 {
    if results.is_empty() {
        return 1.0;
    }
    let successful: Vec<f64> = results
        .iter()
        .filter(|r| r.result.success)
        .map(|r| r.result.confidence.unwrap_or(1.0))
        .collect();
    let success_ratio = successful.len() as f64 / results.len() as f64;
    let average = if successful.is_empty() {
        0.0
    } else {
        successful.iter().sum::<f64>() / successful.len() as f64
    };
    success_ratio * 0.5 + average * 0.5
}

// ═══════════════════════════════════════════════════════════════════════════════
// TYPE GUARDS
// ═══════════════════════════════════════════════════════════════════════════════

/// Check if a value is a BatchRequest (has a `commands` array).
pub fn is_batch_request<T: Serialize>(value: &T) -> bool {
    serde_json::to_value(value)
        .map(|json| {
            json.get("commands")
                .is_some_and(serde_json::Value::is_array)
        })
        .unwrap_or(false)
}

/// Check if a value is a BatchResult.
pub fn is_batch_result<T: Serialize>(value: &T) -> bool {
    serde_json::to_value(value)
        .map(|json| {
            json.get("success").is_some()
                && json.get("results").is_some_and(serde_json::Value::is_array)
                && json.get("summary").is_some()
                && json.get("timing").is_some()
        })
        .unwrap_or(false)
}

/// Check if a value is a BatchCommand (has a string `command`).
pub fn is_batch_command<T: Serialize>(value: &T) -> bool {
    serde_json::to_value(value)
        .map(|json| {
            json.get("command")
                .is_some_and(serde_json::Value::is_string)
        })
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::metadata::Warning;
    use crate::result::{failure, success, success_with, ResultOptions};

    fn timing() -> BatchTiming {
        BatchTiming::new(
            "2025-01-01T00:00:00Z",
            "2025-01-01T00:00:01Z",
            1000.0,
            500.0,
        )
    }

    #[test]
    fn test_batch_command_creation() {
        let cmd = BatchCommand::new("todo-create", serde_json::json!({"title": "Test"}))
            .with_id("1")
            .with_priority(10)
            .with_tags(vec!["important".to_string()]);

        assert_eq!(cmd.id.as_deref(), Some("1"));
        assert_eq!(cmd.command, "todo-create");
        assert_eq!(cmd.priority, Some(10));
    }

    #[test]
    fn test_batch_command_id_is_optional_on_the_wire() {
        let cmd: BatchCommand =
            serde_json::from_value(serde_json::json!({"command": "todo-list", "input": {}}))
                .unwrap();
        assert!(cmd.id.is_none());
        assert_eq!(
            serde_json::to_value(&cmd).unwrap(),
            serde_json::json!({"command": "todo-list", "input": {}})
        );
    }

    #[test]
    fn test_batch_request_options_wire_names() {
        let request = BatchRequest::new(vec![BatchCommand::new("cmd-one", serde_json::json!({}))])
            .with_options(
                BatchOptions::new()
                    .with_stop_on_error(true)
                    .with_parallelism(2)
                    .with_timeout(500.0),
            );
        let json = serde_json::to_value(&request).unwrap();
        assert_eq!(
            json["options"],
            serde_json::json!({"stopOnError": true, "parallelism": 2, "timeout": 500})
        );
        let decoded: BatchRequest = serde_json::from_value(json).unwrap();
        assert_eq!(decoded, request);
    }

    #[test]
    fn test_batch_options_default_continues_on_error() {
        assert!(!BatchOptions::default().stops_on_error());
        let empty: BatchRequest =
            serde_json::from_value(serde_json::json!({"commands": []})).unwrap();
        assert!(empty.options.is_none());
    }

    #[test]
    fn test_batch_result_creation() {
        let results = vec![
            BatchCommandResult::new("1", 0, "cmd1", success::<String>("result1".to_string())),
            BatchCommandResult::new("2", 1, "cmd2", success::<String>("result2".to_string())),
        ];

        let batch_result = create_batch_result(results, timing(), None);

        assert!(batch_result.success);
        assert_eq!(batch_result.summary.total, 2);
        assert_eq!(batch_result.summary.success_count, 2);
        assert_eq!(batch_result.summary.failure_count, 0);
        assert_eq!(batch_result.confidence, 1.0);
        assert_eq!(batch_result.reasoning, "Executed 2 commands: all succeeded");
    }

    #[test]
    fn test_completed_batch_with_failures_is_still_successful() {
        let failed: CommandResult<String> = failure(CommandError::new("FAIL", "failed"));
        let skipped: CommandResult<String> =
            failure(CommandError::new("COMMAND_SKIPPED", "skipped"));
        let batch_result = create_batch_result(
            vec![
                BatchCommandResult::new("zero", 0, "cmd-zero", success("ok".to_string())),
                BatchCommandResult::new("one", 1, "cmd-one", failed),
                BatchCommandResult::new("two", 2, "cmd-two", skipped),
            ],
            timing(),
            None,
        );

        assert!(batch_result.success);
        assert_eq!(batch_result.summary.success_count, 1);
        assert_eq!(batch_result.summary.failure_count, 1);
        assert_eq!(batch_result.summary.skipped_count, 1);
        assert_eq!(
            batch_result.reasoning,
            "Executed 3 commands: 1 succeeded, 1 failed, 1 skipped"
        );
        // (1/3) * 0.5 + 1.0 * 0.5
        assert!((batch_result.confidence - (1.0 / 6.0 + 0.5)).abs() < 1e-9);
    }

    #[test]
    fn test_failed_batch_result() {
        let result: BatchResult =
            create_failed_batch_result(CommandError::new("BAD", "bad batch"), "now");
        assert!(!result.success);
        assert_eq!(result.confidence, 0.0);
        assert_eq!(result.reasoning, "Batch execution failed: bad batch");
    }

    #[test]
    fn test_batch_summary_success_rate() {
        let summary = BatchSummary::new(10, 8, 2, 0);
        assert!((summary.success_rate() - 0.8).abs() < f64::EPSILON);
    }

    #[test]
    fn test_batch_warnings_are_aggregated() {
        let warned_result = success_with(
            "result1".to_string(),
            ResultOptions {
                warnings: Some(vec![Warning::new(
                    "PARTIAL_DATA",
                    "Some records were skipped",
                )]),
                ..Default::default()
            },
        );

        let results = vec![
            BatchCommandResult::new("1", 0, "cmd1", warned_result),
            BatchCommandResult::new("2", 1, "cmd2", success::<String>("result2".to_string())),
        ];

        let batch_result = create_batch_result(results, timing(), None);

        let warnings = batch_result
            .warnings
            .expect("batch warnings should be present");
        assert_eq!(warnings.len(), 1);
        assert_eq!(warnings[0].command_id, "1");
        assert_eq!(warnings[0].code, "PARTIAL_DATA");
    }

    #[test]
    fn test_type_guards() {
        let cmd = BatchCommand::new("test-run", serde_json::json!({}));
        assert!(is_batch_command(&cmd));

        let request = BatchRequest::new(vec![cmd]);
        assert!(is_batch_request(&request));

        let result: BatchResult = create_batch_result(vec![], timing(), None);
        assert!(is_batch_result(&result));
    }
}
