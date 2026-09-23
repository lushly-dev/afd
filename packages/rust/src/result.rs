//! Core result types for AFD commands.
//!
//! The `CommandResult` struct is the standard return type for all AFD commands.
//! It includes both core fields (success, data, error) and UX-enabling fields
//! (confidence, reasoning, sources, etc.) that help build user trust.
//!
//! The JSON shape matches `packages/core/src/result.ts` and the golden fixtures
//! in `spec/wire/`.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::errors::CommandError;
use crate::metadata::{Alternative, PlanStep, Source, Warning};

/// Execution metadata included in command results.
///
/// Keys other than the named fields are kept in [`extra`](Self::extra), so
/// metadata added by other implementations survives a round trip.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct ResultMetadata {
    /// Time taken to execute the command in milliseconds.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "crate::wire::opt_number"
    )]
    pub execution_time_ms: Option<f64>,

    /// Version of the command that produced this result.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command_version: Option<String>,

    /// Unique trace ID for debugging and correlation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trace_id: Option<String>,

    /// Timestamp when the command was executed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<String>,

    /// Additional arbitrary metadata.
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

impl ResultMetadata {
    /// Create empty metadata.
    pub fn new() -> Self {
        Self::default()
    }

    /// Set the execution time in milliseconds.
    pub fn with_execution_time_ms(mut self, execution_time_ms: f64) -> Self {
        self.execution_time_ms = Some(execution_time_ms);
        self
    }

    /// Set the command version.
    pub fn with_command_version(mut self, version: impl Into<String>) -> Self {
        self.command_version = Some(version.into());
        self
    }

    /// Set the trace ID.
    pub fn with_trace_id(mut self, trace_id: impl Into<String>) -> Self {
        self.trace_id = Some(trace_id.into());
        self
    }

    /// Set the timestamp.
    pub fn with_timestamp(mut self, timestamp: impl Into<String>) -> Self {
        self.timestamp = Some(timestamp.into());
        self
    }

    /// Add an arbitrary metadata entry.
    pub fn with_extra(mut self, key: impl Into<String>, value: serde_json::Value) -> Self {
        self.extra.insert(key.into(), value);
        self
    }
}

/// Standard result type for all AFD commands.
///
/// # Type Parameters
///
/// * `T` - The type of the primary result data
///
/// # Example
///
/// ```rust
/// use afd::{CommandResult, success};
///
/// let result: CommandResult<String> = success("Hello!".to_string());
/// assert!(result.success);
/// assert_eq!(result.data, Some("Hello!".to_string()));
/// ```
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", bound(deserialize = "T: Deserialize<'de>"))]
#[non_exhaustive]
pub struct CommandResult<T> {
    // ═══════════════════════════════════════════════════════════════════════════
    // CORE FIELDS (Required for all commands)
    // ═══════════════════════════════════════════════════════════════════════════
    /// Whether the command executed successfully.
    ///
    /// - `true`: Command completed without errors, `data` contains the result
    /// - `false`: Command failed, `error` contains details
    pub success: bool,

    /// The primary result data when `success` is `true`.
    ///
    /// A JSON `null` is kept as data when `T` can hold it (for example
    /// `serde_json::Value`), so `success(Value::Null)` survives a round trip.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::wire::present"
    )]
    pub data: Option<T>,

    /// Error information when `success` is `false`.
    /// Contains code, message, and recovery suggestions.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<CommandError>,

    // ═══════════════════════════════════════════════════════════════════════════
    // UX-ENABLING FIELDS (Recommended for good agent experiences)
    // ═══════════════════════════════════════════════════════════════════════════
    /// Agent's confidence in this result (0-1).
    ///
    /// Guidelines:
    /// - 0.9 - 1.0: Very high confidence, auto-apply safe
    /// - 0.7 - 0.9: High confidence, show as recommendation
    /// - 0.5 - 0.7: Moderate confidence, require confirmation
    /// - < 0.5: Low confidence, show alternatives prominently
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "crate::wire::opt_number"
    )]
    pub confidence: Option<f64>,

    /// Explanation of why this result was produced.
    ///
    /// Enables: Transparency ("why did the agent do this?")
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<String>,

    /// Information sources used to produce this result.
    ///
    /// Enables: Source attribution, verification, trust
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sources: Option<Vec<Source>>,

    /// Steps in a multi-step operation.
    ///
    /// Enables: Plan visualization, progress tracking
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan: Option<Vec<PlanStep>>,

    /// Other options the agent considered.
    ///
    /// Enables: Alternative exploration, user choice
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alternatives: Option<Vec<Alternative<T>>>,

    /// Non-fatal issues to surface to the user.
    ///
    /// Enables: Proactive transparency about potential problems
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub warnings: Option<Vec<Warning>>,

    /// Helpful next steps for the user.
    ///
    /// Enables: Guided exploration, discoverability
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub suggestions: Option<Vec<String>>,

    /// Execution metadata for debugging and monitoring.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<ResultMetadata>,

    // ═══════════════════════════════════════════════════════════════════════════
    // UNDO FIELDS (For serializable undo over MCP)
    // ═══════════════════════════════════════════════════════════════════════════
    /// Command that reverses this operation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub undo_command: Option<String>,

    /// Arguments to pass to [`undo_command`](Self::undo_command).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub undo_args: Option<HashMap<String, serde_json::Value>>,
}

impl<T> Default for CommandResult<T> {
    fn default() -> Self {
        Self {
            success: false,
            data: None,
            error: None,
            confidence: None,
            reasoning: None,
            sources: None,
            plan: None,
            alternatives: None,
            warnings: None,
            suggestions: None,
            metadata: None,
            undo_command: None,
            undo_args: None,
        }
    }
}

/// Options for creating successful command results.
#[derive(Debug, Clone)]
pub struct ResultOptions<T> {
    pub confidence: Option<f64>,
    pub reasoning: Option<String>,
    pub sources: Option<Vec<Source>>,
    pub plan: Option<Vec<PlanStep>>,
    pub alternatives: Option<Vec<Alternative<T>>>,
    pub warnings: Option<Vec<Warning>>,
    pub suggestions: Option<Vec<String>>,
    pub metadata: Option<ResultMetadata>,
    pub undo_command: Option<String>,
    pub undo_args: Option<HashMap<String, serde_json::Value>>,
}

impl<T> Default for ResultOptions<T> {
    fn default() -> Self {
        Self {
            confidence: None,
            reasoning: None,
            sources: None,
            plan: None,
            alternatives: None,
            warnings: None,
            suggestions: None,
            metadata: None,
            undo_command: None,
            undo_args: None,
        }
    }
}

/// Options for creating failure results.
#[derive(Debug, Clone, Default)]
pub struct FailureOptions {
    pub confidence: Option<f64>,
    pub reasoning: Option<String>,
    pub sources: Option<Vec<Source>>,
    pub plan: Option<Vec<PlanStep>>,
    pub warnings: Option<Vec<Warning>>,
    pub suggestions: Option<Vec<String>>,
    pub metadata: Option<ResultMetadata>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/// Create a successful command result.
///
/// # Arguments
///
/// * `data` - The result data
///
/// # Example
///
/// ```rust
/// use afd::success;
///
/// let result = success("Hello!".to_string());
/// assert!(result.success);
/// ```
pub fn success<T>(data: T) -> CommandResult<T> {
    CommandResult {
        success: true,
        data: Some(data),
        ..CommandResult::default()
    }
}

/// Create a successful command result with additional options.
///
/// # Arguments
///
/// * `data` - The result data
/// * `options` - Additional UX-enabling fields
///
/// # Example
///
/// ```rust
/// use afd::{success_with, ResultOptions};
///
/// let result = success_with("Hello!".to_string(), ResultOptions {
///     confidence: Some(0.95),
///     suggestions: Some(vec!["Try todo-list next".to_string()]),
///     ..Default::default()
/// });
/// assert_eq!(result.confidence, Some(0.95));
/// ```
pub fn success_with<T>(data: T, options: ResultOptions<T>) -> CommandResult<T> {
    CommandResult {
        success: true,
        data: Some(data),
        error: None,
        confidence: options.confidence,
        reasoning: options.reasoning,
        sources: options.sources,
        plan: options.plan,
        alternatives: options.alternatives,
        warnings: options.warnings,
        suggestions: options.suggestions,
        metadata: options.metadata,
        undo_command: options.undo_command,
        undo_args: options.undo_args,
    }
}

/// Create a failed command result.
///
/// # Arguments
///
/// * `error` - The error details
///
/// # Example
///
/// ```rust
/// use afd::{failure, CommandResult, CommandError};
///
/// let error = CommandError::validation("Invalid input", Some("Check the format"));
/// let result: CommandResult<()> = failure(error);
/// assert!(!result.success);
/// ```
pub fn failure<T>(error: CommandError) -> CommandResult<T> {
    CommandResult {
        success: false,
        error: Some(error),
        ..CommandResult::default()
    }
}

/// Create a failed command result with additional options.
pub fn failure_with<T>(error: CommandError, options: FailureOptions) -> CommandResult<T> {
    CommandResult {
        success: false,
        error: Some(error),
        confidence: options.confidence,
        reasoning: options.reasoning,
        sources: options.sources,
        plan: options.plan,
        warnings: options.warnings,
        suggestions: options.suggestions,
        metadata: options.metadata,
        ..CommandResult::default()
    }
}

/// Create a failed command result from a code and message.
pub fn error<T>(code: &str, message: &str, suggestion: Option<&str>) -> CommandResult<T> {
    let mut error = CommandError::new(code, message);
    error.suggestion = suggestion.map(ToString::to_string);
    failure(error)
}

/// Type guard to check if a result is successful.
///
/// Matches TypeScript's `isSuccess`: `success` is `true` and `data` is present
/// (a JSON `null` counts as present).
///
/// # Example
///
/// ```rust
/// use afd::{success, is_success};
///
/// let result = success("data".to_string());
/// assert!(is_success(&result));
/// ```
pub fn is_success<T>(result: &CommandResult<T>) -> bool {
    result.success && result.data.is_some()
}

/// Type guard to check if a result is a failure.
///
/// # Example
///
/// ```rust
/// use afd::{failure, is_failure, CommandResult, CommandError};
///
/// let error = CommandError::not_found("Item", "123");
/// let result: CommandResult<()> = failure(error);
/// assert!(is_failure(&result));
/// ```
pub fn is_failure<T>(result: &CommandResult<T>) -> bool {
    !result.success && result.error.is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_success_result() {
        let result: CommandResult<String> = success("hello".to_string());
        assert!(result.success);
        assert_eq!(result.data, Some("hello".to_string()));
        assert!(result.error.is_none());
    }

    #[test]
    fn test_failure_result() {
        let error = CommandError::not_found("Todo", "123");
        let result: CommandResult<String> = failure(error.clone());
        assert!(!result.success);
        assert!(result.data.is_none());
        assert_eq!(result.error.as_ref().unwrap().code, "NOT_FOUND");
    }

    #[test]
    fn test_is_success() {
        let result = success("data".to_string());
        assert!(is_success(&result));
        assert!(!is_failure(&result));
    }

    #[test]
    fn test_is_failure() {
        let error = CommandError::validation("bad input", None);
        let result: CommandResult<()> = failure(error);
        assert!(is_failure(&result));
        assert!(!is_success(&result));
    }

    #[test]
    fn test_json_serialization() {
        let result = success("hello".to_string());
        let json = serde_json::to_string(&result).unwrap();

        // Verify camelCase serialization
        assert!(json.contains("\"success\":true"));
        assert!(json.contains("\"data\":\"hello\""));

        // Verify None fields are omitted
        assert!(!json.contains("\"error\""));
        assert!(!json.contains("\"confidence\""));
    }

    #[test]
    fn test_null_data_round_trips_as_success() {
        let result = success(serde_json::Value::Null);
        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(json, serde_json::json!({"success": true, "data": null}));

        let decoded: CommandResult<serde_json::Value> = serde_json::from_value(json).unwrap();
        assert!(is_success(&decoded));
        assert!(!is_failure(&decoded));
        assert_eq!(decoded, result);

        let unit: CommandResult<()> =
            serde_json::from_value(serde_json::to_value(success(())).unwrap()).unwrap();
        assert!(is_success(&unit));
    }

    #[test]
    fn test_suggestions_and_undo_round_trip() {
        let mut undo_args = HashMap::new();
        undo_args.insert("id".to_string(), serde_json::json!("todo-2"));
        let result = success_with(
            serde_json::json!({"id": "todo-2"}),
            ResultOptions {
                suggestions: Some(vec!["Use todo-list".to_string()]),
                undo_command: Some("todo-delete".to_string()),
                undo_args: Some(undo_args),
                ..Default::default()
            },
        );
        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(json["suggestions"], serde_json::json!(["Use todo-list"]));
        assert_eq!(json["undoCommand"], "todo-delete");
        assert_eq!(json["undoArgs"], serde_json::json!({"id": "todo-2"}));

        let decoded: CommandResult<serde_json::Value> = serde_json::from_value(json).unwrap();
        assert_eq!(decoded, result);
    }

    #[test]
    fn test_unknown_metadata_keys_are_kept() {
        let json = serde_json::json!({
            "success": true,
            "data": 1,
            "metadata": {"executionTimeMs": 1.5, "region": "eu", "traceId": "t"}
        });
        let decoded: CommandResult<serde_json::Value> =
            serde_json::from_value(json.clone()).unwrap();
        let metadata = decoded.metadata.as_ref().unwrap();
        assert_eq!(metadata.execution_time_ms, Some(1.5));
        assert_eq!(metadata.extra.get("region"), Some(&serde_json::json!("eu")));
        assert_eq!(serde_json::to_value(&decoded).unwrap(), json);
    }

    #[test]
    fn test_success_with_options() {
        let opts = ResultOptions {
            confidence: Some(0.95),
            reasoning: Some("Test reasoning".to_string()),
            ..Default::default()
        };
        let result = success_with("data".to_string(), opts);

        assert_eq!(result.confidence, Some(0.95));
        assert_eq!(result.reasoning, Some("Test reasoning".to_string()));
    }

    #[test]
    fn test_error_helper() {
        let result: CommandResult<()> = error("BAD_INPUT", "Input was invalid", Some("Try again"));
        assert!(!result.success);
        assert_eq!(result.error.as_ref().unwrap().code, "BAD_INPUT");
        assert_eq!(
            result.error.as_ref().unwrap().suggestion,
            Some("Try again".to_string())
        );
    }
}
