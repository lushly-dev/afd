//! Error types for AFD commands.
//!
//! Errors should be actionable - they tell the user what went wrong
//! AND what they can do about it.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Standard error structure for command failures.
///
/// All errors should be actionable - users should know what to do next.
///
/// # Example
///
/// ```rust
/// use afd::CommandError;
///
/// let error = CommandError {
///     code: "RATE_LIMITED".to_string(),
///     message: "API rate limit exceeded".to_string(),
///     suggestion: Some("Wait 60 seconds and try again".to_string()),
///     retryable: Some(true),
///     details: None,
///     cause: None,
/// };
/// ```
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    /// Machine-readable error code.
    ///
    /// Use SCREAMING_SNAKE_CASE for consistency.
    /// Should be unique within your application.
    pub code: String,

    /// Human-readable error message.
    ///
    /// Should be clear and concise, describing what went wrong.
    pub message: String,

    /// What the user can do about this error.
    ///
    /// This is the most important field for UX - it turns an error
    /// from a dead-end into a recoverable situation.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggestion: Option<String>,

    /// Whether retrying the same request might succeed.
    ///
    /// - `true`: Transient error, retry may work (rate limits, timeouts)
    /// - `false`: Permanent error, retry won't help (not found, validation)
    /// - `None`: Unknown, treat as non-retryable
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retryable: Option<bool>,

    /// Additional technical details for debugging.
    ///
    /// May include stack traces, request IDs, timestamps, etc.
    /// Avoid exposing sensitive information.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<HashMap<String, serde_json::Value>>,

    /// Original error that caused this error, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cause: Option<Box<CommandError>>,
}

impl CommandError {
    /// Create a new CommandError with standard fields.
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            suggestion: None,
            retryable: None,
            details: None,
            cause: None,
        }
    }

    /// Add a suggestion to the error.
    pub fn with_suggestion(mut self, suggestion: impl Into<String>) -> Self {
        self.suggestion = Some(suggestion.into());
        self
    }

    /// Set whether the error is retryable.
    pub fn with_retryable(mut self, retryable: bool) -> Self {
        self.retryable = Some(retryable);
        self
    }

    /// Add details to the error.
    pub fn with_details(mut self, details: HashMap<String, serde_json::Value>) -> Self {
        self.details = Some(details);
        self
    }

    /// Create a not found error.
    ///
    /// # Example
    ///
    /// ```rust
    /// use afd::CommandError;
    ///
    /// let error = CommandError::not_found("Todo", "123");
    /// assert_eq!(error.code, "NOT_FOUND");
    /// ```
    pub fn not_found(resource: &str, id: &str) -> Self {
        let mut details = HashMap::new();
        details.insert("resourceType".to_string(), serde_json::json!(resource));
        details.insert("resourceId".to_string(), serde_json::json!(id));

        Self {
            code: "NOT_FOUND".to_string(),
            message: format!("{} with ID '{}' not found", resource, id),
            suggestion: Some(format!(
                "Verify the {} ID exists and try again",
                resource.to_lowercase()
            )),
            retryable: Some(false),
            details: Some(details),
            cause: None,
        }
    }

    /// Create a validation error.
    ///
    /// # Example
    ///
    /// ```rust
    /// use afd::CommandError;
    ///
    /// let error = CommandError::validation("Invalid email format", Some("Use a valid email address"));
    /// assert_eq!(error.code, "VALIDATION_ERROR");
    /// ```
    pub fn validation(message: &str, suggestion: Option<&str>) -> Self {
        Self {
            code: "VALIDATION_ERROR".to_string(),
            message: message.to_string(),
            suggestion: suggestion.map(|s| s.to_string()),
            retryable: Some(false),
            details: None,
            cause: None,
        }
    }

    /// Create a rate limit error.
    pub fn rate_limited(retry_after_seconds: Option<u32>) -> Self {
        let suggestion = match retry_after_seconds {
            Some(secs) => format!("Wait {} seconds and try again", secs),
            None => "Wait a moment and try again".to_string(),
        };

        let details = retry_after_seconds.map(|secs| {
            let mut d = HashMap::new();
            d.insert("retryAfterSeconds".to_string(), serde_json::json!(secs));
            d
        });

        Self {
            code: "RATE_LIMITED".to_string(),
            message: "Rate limit exceeded".to_string(),
            suggestion: Some(suggestion),
            retryable: Some(true),
            details,
            cause: None,
        }
    }

    /// Create a timeout error.
    pub fn timeout(operation_name: &str, timeout_ms: u64) -> Self {
        let mut details = HashMap::new();
        details.insert("operationName".to_string(), serde_json::json!(operation_name));
        details.insert("timeoutMs".to_string(), serde_json::json!(timeout_ms));

        Self {
            code: "TIMEOUT".to_string(),
            message: format!(
                "Operation '{}' timed out after {}ms",
                operation_name, timeout_ms
            ),
            suggestion: Some(
                "Try again with a simpler request or contact support if this persists".to_string(),
            ),
            retryable: Some(true),
            details: Some(details),
            cause: None,
        }
    }

    /// Create an internal error.
    pub fn internal(message: &str) -> Self {
        Self {
            code: "INTERNAL_ERROR".to_string(),
            message: message.to_string(),
            suggestion: Some("Please try again. If this persists, contact support.".to_string()),
            retryable: Some(true),
            details: None,
            cause: None,
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// STANDARD ERROR CODES
// ═══════════════════════════════════════════════════════════════════════════════

/// Standard error codes for common scenarios.
///
/// Use these for consistency across AFD applications.
pub mod error_codes {
    // Validation Errors (4xx range)
    pub const VALIDATION_ERROR: &str = "VALIDATION_ERROR";
    pub const INVALID_INPUT: &str = "INVALID_INPUT";
    pub const MISSING_REQUIRED_FIELD: &str = "MISSING_REQUIRED_FIELD";
    pub const INVALID_FORMAT: &str = "INVALID_FORMAT";

    // Resource Errors
    pub const NOT_FOUND: &str = "NOT_FOUND";
    pub const ALREADY_EXISTS: &str = "ALREADY_EXISTS";
    pub const CONFLICT: &str = "CONFLICT";

    // Authorization Errors
    pub const UNAUTHORIZED: &str = "UNAUTHORIZED";
    pub const FORBIDDEN: &str = "FORBIDDEN";
    pub const TOKEN_EXPIRED: &str = "TOKEN_EXPIRED";

    // Rate Limiting
    pub const RATE_LIMITED: &str = "RATE_LIMITED";
    pub const QUOTA_EXCEEDED: &str = "QUOTA_EXCEEDED";

    // Network/Service Errors
    pub const SERVICE_UNAVAILABLE: &str = "SERVICE_UNAVAILABLE";
    pub const TIMEOUT: &str = "TIMEOUT";
    pub const CONNECTION_ERROR: &str = "CONNECTION_ERROR";

    // Internal Errors
    pub const INTERNAL_ERROR: &str = "INTERNAL_ERROR";
    pub const NOT_IMPLEMENTED: &str = "NOT_IMPLEMENTED";
    pub const UNKNOWN_ERROR: &str = "UNKNOWN_ERROR";

    // Command-specific
    pub const COMMAND_NOT_FOUND: &str = "COMMAND_NOT_FOUND";
    pub const INVALID_COMMAND_ARGS: &str = "INVALID_COMMAND_ARGS";
    pub const COMMAND_CANCELLED: &str = "COMMAND_CANCELLED";
}

// ═══════════════════════════════════════════════════════════════════════════════
// ERROR FACTORY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/// Create a CommandError with standard fields.
pub fn create_error(code: &str, message: &str) -> CommandError {
    CommandError::new(code, message)
}

/// Create a validation error.
pub fn validation_error(message: &str, details: Option<HashMap<String, serde_json::Value>>) -> CommandError {
    CommandError {
        code: error_codes::VALIDATION_ERROR.to_string(),
        message: message.to_string(),
        suggestion: Some("Check the input and try again".to_string()),
        retryable: Some(false),
        details,
        cause: None,
    }
}

/// Create a not found error.
pub fn not_found_error(resource_type: &str, resource_id: &str) -> CommandError {
    CommandError::not_found(resource_type, resource_id)
}

/// Create a rate limit error.
pub fn rate_limit_error(retry_after_seconds: Option<u32>) -> CommandError {
    CommandError::rate_limited(retry_after_seconds)
}

/// Create a timeout error.
pub fn timeout_error(operation_name: &str, timeout_ms: u64) -> CommandError {
    CommandError::timeout(operation_name, timeout_ms)
}

/// Create an internal error.
pub fn internal_error(message: &str) -> CommandError {
    CommandError::internal(message)
}

/// Type guard to check if a value is a CommandError.
pub fn is_command_error<T: Serialize>(value: &T) -> bool {
    if let Ok(json) = serde_json::to_value(value) {
        json.get("code").is_some() && json.get("message").is_some()
    } else {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_not_found_error() {
        let error = CommandError::not_found("Todo", "123");
        assert_eq!(error.code, "NOT_FOUND");
        assert!(error.message.contains("Todo"));
        assert!(error.message.contains("123"));
        assert_eq!(error.retryable, Some(false));
    }

    #[test]
    fn test_validation_error() {
        let error = CommandError::validation("Invalid email", Some("Use a valid format"));
        assert_eq!(error.code, "VALIDATION_ERROR");
        assert_eq!(error.suggestion, Some("Use a valid format".to_string()));
    }

    #[test]
    fn test_rate_limited_error() {
        let error = CommandError::rate_limited(Some(60));
        assert_eq!(error.code, "RATE_LIMITED");
        assert_eq!(error.retryable, Some(true));
        assert!(error.suggestion.as_ref().unwrap().contains("60"));
    }

    #[test]
    fn test_json_serialization() {
        let error = CommandError::not_found("Item", "abc");
        let json = serde_json::to_string(&error).unwrap();
        
        // Verify camelCase serialization
        assert!(json.contains("\"code\":\"NOT_FOUND\""));
        assert!(json.contains("\"resourceType\""));
        assert!(json.contains("\"resourceId\""));
    }

    #[test]
    fn test_builder_pattern() {
        let error = CommandError::new("CUSTOM_ERROR", "Something went wrong")
            .with_suggestion("Try again later")
            .with_retryable(true);
        
        assert_eq!(error.code, "CUSTOM_ERROR");
        assert_eq!(error.suggestion, Some("Try again later".to_string()));
        assert_eq!(error.retryable, Some(true));
    }
}
