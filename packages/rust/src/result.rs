//! Core result types for AFD commands.
//!
//! The `CommandResult` struct is the standard return type for all AFD commands.
//! It includes both core fields (success, data, error) and UX-enabling fields
//! (confidence, reasoning, sources, etc.) that help build user trust.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::errors::CommandError;
use crate::metadata::{Alternative, PlanStep, Source, Warning};

/// Execution metadata included in command results.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResultMetadata {
    /// Time taken to execute the command in milliseconds.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_time_ms: Option<u64>,

    /// Version of the command that produced this result.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command_version: Option<String>,

    /// Unique trace ID for debugging and correlation.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trace_id: Option<String>,

    /// Timestamp when the command was executed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<String>,

    /// Additional arbitrary metadata.
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
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
#[serde(rename_all = "camelCase")]
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
    /// The type varies by command.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<T>,

    /// Error information when `success` is `false`.
    /// Contains code, message, and recovery suggestions.
    #[serde(skip_serializing_if = "Option::is_none")]
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f64>,

    /// Explanation of why this result was produced.
    ///
    /// Enables: Transparency ("why did the agent do this?")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<String>,

    /// Information sources used to produce this result.
    ///
    /// Enables: Source attribution, verification, trust
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sources: Option<Vec<Source>>,

    /// Steps in a multi-step operation.
    ///
    /// Enables: Plan visualization, progress tracking
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan: Option<Vec<PlanStep>>,

    /// Other options the agent considered.
    ///
    /// Enables: Alternative exploration, user choice
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alternatives: Option<Vec<Alternative<T>>>,

    /// Non-fatal issues to surface to the user.
    ///
    /// Enables: Proactive transparency about potential problems
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warnings: Option<Vec<Warning>>,

    /// Execution metadata for debugging and monitoring.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<ResultMetadata>,
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
            metadata: None,
        }
    }
}

/// Options for creating command results.
#[derive(Debug, Clone)]
pub struct ResultOptions<T> {
    pub confidence: Option<f64>,
    pub reasoning: Option<String>,
    pub sources: Option<Vec<Source>>,
    pub plan: Option<Vec<PlanStep>>,
    pub alternatives: Option<Vec<Alternative<T>>>,
    pub warnings: Option<Vec<Warning>>,
    pub metadata: Option<ResultMetadata>,
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
            metadata: None,
        }
    }
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
        error: None,
        confidence: None,
        reasoning: None,
        sources: None,
        plan: None,
        alternatives: None,
        warnings: None,
        metadata: None,
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
///     ..Default::default()
/// });
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
        metadata: options.metadata,
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
        data: None,
        error: Some(error),
        confidence: None,
        reasoning: None,
        sources: None,
        plan: None,
        alternatives: None,
        warnings: None,
        metadata: None,
    }
}

/// Create a failed command result with additional options.
pub fn failure_with<T>(error: CommandError, options: FailureOptions) -> CommandResult<T> {
    CommandResult {
        success: false,
        data: None,
        error: Some(error),
        confidence: None,
        reasoning: None,
        sources: None,
        plan: None,
        alternatives: None,
        warnings: options.warnings,
        metadata: options.metadata,
    }
}

/// Options for creating failure results.
#[derive(Debug, Clone, Default)]
pub struct FailureOptions {
    pub warnings: Option<Vec<Warning>>,
    pub metadata: Option<ResultMetadata>,
}

/// Type guard to check if a result is successful.
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
}
