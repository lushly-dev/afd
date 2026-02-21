//! Batch command types for executing multiple commands.
//!
//! Batch operations allow executing multiple commands in a single request.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::errors::CommandError;
use crate::result::CommandResult;

// ═══════════════════════════════════════════════════════════════════════════════
// BATCH COMMAND TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/// A single command in a batch request.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BatchCommand<T = serde_json::Value> {
    /// Unique identifier for this command in the batch.
    pub id: String,

    /// Command name to execute.
    pub command: String,

    /// Input data for the command.
    pub input: T,

    /// Optional tags for categorization.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,

    /// Optional priority (higher = more important).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<i32>,
}

impl<T> BatchCommand<T> {
    /// Create a new batch command.
    pub fn new(id: impl Into<String>, command: impl Into<String>, input: T) -> Self {
        Self {
            id: id.into(),
            command: command.into(),
            input,
            tags: None,
            priority: None,
        }
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
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BatchOptions {
    /// Continue executing remaining commands if one fails.
    #[serde(default)]
    pub continue_on_error: bool,

    /// Maximum number of concurrent command executions.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_concurrency: Option<usize>,

    /// Timeout for the entire batch in milliseconds.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<u64>,

    /// Stop batch if this many commands fail.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_failures: Option<usize>,
}

impl Default for BatchOptions {
    fn default() -> Self {
        Self {
            continue_on_error: false,
            max_concurrency: None,
            timeout_ms: None,
            max_failures: None,
        }
    }
}

/// A batch request containing multiple commands.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BatchRequest<T = serde_json::Value> {
    /// Commands to execute.
    pub commands: Vec<BatchCommand<T>>,

    /// Execution options.
    #[serde(default)]
    pub options: BatchOptions,

    /// Additional context for the batch.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<HashMap<String, serde_json::Value>>,
}

impl<T> BatchRequest<T> {
    /// Create a new batch request.
    pub fn new(commands: Vec<BatchCommand<T>>) -> Self {
        Self {
            commands,
            options: BatchOptions::default(),
            context: None,
        }
    }

    /// Set batch options.
    pub fn with_options(mut self, options: BatchOptions) -> Self {
        self.options = options;
        self
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// BATCH RESULT TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/// Result for a single command in a batch.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchCommandResult<T = serde_json::Value> {
    /// ID matching the original command.
    pub id: String,

    /// The command that was executed.
    pub command: String,

    /// The result of execution.
    pub result: CommandResult<T>,

    /// Execution time in milliseconds.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
}

impl<T> BatchCommandResult<T> {
    /// Create a successful batch command result.
    pub fn success(id: impl Into<String>, command: impl Into<String>, result: CommandResult<T>) -> Self {
        Self {
            id: id.into(),
            command: command.into(),
            result,
            duration_ms: None,
        }
    }

    /// Set the duration.
    pub fn with_duration(mut self, duration_ms: u64) -> Self {
        self.duration_ms = Some(duration_ms);
        self
    }
}

/// Summary statistics for a batch execution.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BatchSummary {
    /// Total commands in the batch.
    pub total: usize,

    /// Number of successful commands.
    pub succeeded: usize,

    /// Number of failed commands.
    pub failed: usize,

    /// Number of skipped commands.
    pub skipped: usize,

    /// Average confidence across successful commands (if applicable).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub average_confidence: Option<f64>,
}

impl BatchSummary {
    /// Create a new batch summary.
    pub fn new(total: usize, succeeded: usize, failed: usize, skipped: usize) -> Self {
        Self {
            total,
            succeeded,
            failed,
            skipped,
            average_confidence: None,
        }
    }

    /// Calculate success rate.
    pub fn success_rate(&self) -> f64 {
        if self.total == 0 {
            0.0
        } else {
            self.succeeded as f64 / self.total as f64
        }
    }
}

/// Timing information for batch execution.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BatchTiming {
    /// When the batch started (ISO timestamp).
    pub started_at: String,

    /// When the batch ended (ISO timestamp).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<String>,

    /// Total duration in milliseconds.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_ms: Option<u64>,

    /// Average time per command in milliseconds.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub average_ms: Option<u64>,
}

/// Complete result of a batch operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchResult<T = serde_json::Value> {
    /// Whether all commands succeeded.
    pub success: bool,

    /// Results for each command.
    pub results: Vec<BatchCommandResult<T>>,

    /// Summary statistics.
    pub summary: BatchSummary,

    /// Timing information.
    pub timing: BatchTiming,

    /// Batch-level error if the batch itself failed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<CommandError>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// FACTORY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/// Create a batch request from commands.
pub fn create_batch_request<T>(commands: Vec<BatchCommand<T>>) -> BatchRequest<T> {
    BatchRequest::new(commands)
}

/// Create a batch result from individual results.
pub fn create_batch_result<T>(
    results: Vec<BatchCommandResult<T>>,
    started_at: &str,
    ended_at: &str,
    total_ms: u64,
) -> BatchResult<T> {
    let total = results.len();
    let succeeded = results.iter().filter(|r| r.result.success).count();
    let failed = total - succeeded;

    // Calculate average confidence from successful results
    let confidences: Vec<f64> = results
        .iter()
        .filter_map(|r| {
            if r.result.success {
                r.result.confidence
            } else {
                None
            }
        })
        .collect();

    let average_confidence = if confidences.is_empty() {
        None
    } else {
        Some(confidences.iter().sum::<f64>() / confidences.len() as f64)
    };

    let average_ms = if total > 0 {
        Some(total_ms / total as u64)
    } else {
        None
    };

    BatchResult {
        success: failed == 0,
        results,
        summary: BatchSummary {
            total,
            succeeded,
            failed,
            skipped: 0,
            average_confidence,
        },
        timing: BatchTiming {
            started_at: started_at.to_string(),
            ended_at: Some(ended_at.to_string()),
            total_ms: Some(total_ms),
            average_ms,
        },
        error: None,
    }
}

/// Create a failed batch result.
pub fn create_failed_batch_result<T>(error: CommandError, started_at: &str) -> BatchResult<T> {
    BatchResult {
        success: false,
        results: vec![],
        summary: BatchSummary::new(0, 0, 0, 0),
        timing: BatchTiming {
            started_at: started_at.to_string(),
            ended_at: None,
            total_ms: None,
            average_ms: None,
        },
        error: Some(error),
    }
}

/// Calculate combined confidence from batch results.
pub fn calculate_batch_confidence<T>(results: &[BatchCommandResult<T>]) -> Option<f64> {
    let confidences: Vec<f64> = results
        .iter()
        .filter_map(|r| {
            if r.result.success {
                r.result.confidence
            } else {
                None
            }
        })
        .collect();

    if confidences.is_empty() {
        None
    } else {
        Some(confidences.iter().sum::<f64>() / confidences.len() as f64)
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TYPE GUARDS
// ═══════════════════════════════════════════════════════════════════════════════

/// Check if a value is a BatchRequest.
pub fn is_batch_request<T: Serialize>(value: &T) -> bool {
    if let Ok(json) = serde_json::to_value(value) {
        json.get("commands").is_some() && json.get("options").is_some()
    } else {
        false
    }
}

/// Check if a value is a BatchResult.
pub fn is_batch_result<T: Serialize>(value: &T) -> bool {
    if let Ok(json) = serde_json::to_value(value) {
        json.get("results").is_some() && json.get("summary").is_some() && json.get("timing").is_some()
    } else {
        false
    }
}

/// Check if a value is a BatchCommand.
pub fn is_batch_command<T: Serialize>(value: &T) -> bool {
    if let Ok(json) = serde_json::to_value(value) {
        json.get("id").is_some() && json.get("command").is_some() && json.get("input").is_some()
    } else {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::result::success;

    #[test]
    fn test_batch_command_creation() {
        let cmd = BatchCommand::new("1", "todo-create", serde_json::json!({"title": "Test"}))
            .with_priority(10)
            .with_tags(vec!["important".to_string()]);

        assert_eq!(cmd.id, "1");
        assert_eq!(cmd.command, "todo-create");
        assert_eq!(cmd.priority, Some(10));
    }

    #[test]
    fn test_batch_request() {
        let commands = vec![
            BatchCommand::new("1", "cmd1", serde_json::json!({})),
            BatchCommand::new("2", "cmd2", serde_json::json!({})),
        ];

        let request = BatchRequest::new(commands).with_options(BatchOptions {
            continue_on_error: true,
            ..Default::default()
        });

        assert_eq!(request.commands.len(), 2);
        assert!(request.options.continue_on_error);
    }

    #[test]
    fn test_batch_result_creation() {
        let results = vec![
            BatchCommandResult::success("1", "cmd1", success::<String>("result1".to_string())),
            BatchCommandResult::success("2", "cmd2", success::<String>("result2".to_string())),
        ];

        let batch_result = create_batch_result(
            results,
            "2025-01-01T00:00:00Z",
            "2025-01-01T00:00:01Z",
            1000,
        );

        assert!(batch_result.success);
        assert_eq!(batch_result.summary.total, 2);
        assert_eq!(batch_result.summary.succeeded, 2);
        assert_eq!(batch_result.summary.failed, 0);
    }

    #[test]
    fn test_batch_summary_success_rate() {
        let summary = BatchSummary::new(10, 8, 2, 0);
        assert!((summary.success_rate() - 0.8).abs() < f64::EPSILON);
    }

    #[test]
    fn test_type_guards() {
        let cmd = BatchCommand::new("1", "test", serde_json::json!({}));
        assert!(is_batch_command(&cmd));

        let request = BatchRequest::new(vec![cmd]);
        assert!(is_batch_request(&request));
    }
}
