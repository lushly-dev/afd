//! Metadata types for command results.
//!
//! These types provide context and transparency for AI-powered commands.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ═══════════════════════════════════════════════════════════════════════════════
// SOURCE
// ═══════════════════════════════════════════════════════════════════════════════

/// Attribution information for where data came from.
///
/// Sources help users verify information and build trust.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    /// Human-readable name for the source.
    pub name: String,

    /// Type of source.
    pub source_type: SourceType,

    /// URL or URI to the source.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,

    /// ISO timestamp when the source was accessed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accessed_at: Option<String>,

    /// Relevance score (0-1).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relevance: Option<f64>,

    /// Brief excerpt or context from the source.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snippet: Option<String>,
}

/// Types of sources.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SourceType {
    /// Web page or online resource.
    Url,
    /// Local or remote file.
    File,
    /// Database record.
    Database,
    /// API endpoint.
    Api,
    /// Knowledge graph or internal model.
    Knowledge,
    /// User-provided input.
    User,
    /// Other source type.
    Other,
}

impl Source {
    /// Create a new source.
    pub fn new(name: impl Into<String>, source_type: SourceType) -> Self {
        Self {
            name: name.into(),
            source_type,
            url: None,
            accessed_at: None,
            relevance: None,
            snippet: None,
        }
    }

    /// Add a URL to the source.
    pub fn with_url(mut self, url: impl Into<String>) -> Self {
        self.url = Some(url.into());
        self
    }

    /// Add an accessed_at timestamp.
    pub fn with_accessed_at(mut self, timestamp: impl Into<String>) -> Self {
        self.accessed_at = Some(timestamp.into());
        self
    }

    /// Add a relevance score.
    pub fn with_relevance(mut self, relevance: f64) -> Self {
        self.relevance = Some(relevance.clamp(0.0, 1.0));
        self
    }

    /// Add a snippet.
    pub fn with_snippet(mut self, snippet: impl Into<String>) -> Self {
        self.snippet = Some(snippet.into());
        self
    }
}

/// Create a source with common defaults.
pub fn create_source(name: &str, source_type: SourceType, url: Option<&str>) -> Source {
    let mut source = Source::new(name, source_type);
    if let Some(u) = url {
        source.url = Some(u.to_string());
    }
    source
}

// ═══════════════════════════════════════════════════════════════════════════════
// PLAN STEP
// ═══════════════════════════════════════════════════════════════════════════════

/// Status of a plan step.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum PlanStepStatus {
    /// Step hasn't started yet.
    Pending,
    /// Step is currently executing.
    Running,
    /// Step completed successfully.
    Completed,
    /// Step failed.
    Failed,
    /// Step was skipped.
    Skipped,
}

/// A step in a multi-step plan.
///
/// Plan steps give users visibility into what the system is doing.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlanStep {
    /// Step identifier (usually 1, 2, 3...).
    pub step: u32,

    /// Human-readable description of the step.
    pub description: String,

    /// Current status of the step.
    pub status: PlanStepStatus,

    /// Execution time in milliseconds (if completed).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,

    /// Error message if the step failed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,

    /// Additional details about the step.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<HashMap<String, serde_json::Value>>,
}

impl PlanStep {
    /// Create a new pending plan step.
    pub fn new(step: u32, description: impl Into<String>) -> Self {
        Self {
            step,
            description: description.into(),
            status: PlanStepStatus::Pending,
            duration_ms: None,
            error: None,
            details: None,
        }
    }

    /// Update the status of the step.
    pub fn with_status(mut self, status: PlanStepStatus) -> Self {
        self.status = status;
        self
    }

    /// Set the duration.
    pub fn with_duration(mut self, duration_ms: u64) -> Self {
        self.duration_ms = Some(duration_ms);
        self
    }

    /// Set the error message.
    pub fn with_error(mut self, error: impl Into<String>) -> Self {
        self.error = Some(error.into());
        self.status = PlanStepStatus::Failed;
        self
    }
}

/// Create a plan step.
pub fn create_step(step: u32, description: &str, status: PlanStepStatus) -> PlanStep {
    PlanStep::new(step, description).with_status(status)
}

/// Update the status of a step and optionally set duration/error.
pub fn update_step_status(
    step: &mut PlanStep,
    status: PlanStepStatus,
    duration_ms: Option<u64>,
    error: Option<&str>,
) {
    step.status = status;
    if let Some(d) = duration_ms {
        step.duration_ms = Some(d);
    }
    if let Some(e) = error {
        step.error = Some(e.to_string());
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ALTERNATIVE
// ═══════════════════════════════════════════════════════════════════════════════

/// An alternative result that was considered but not selected.
///
/// Showing alternatives helps users understand the decision-making process.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Alternative<T> {
    /// The alternative data.
    pub data: T,

    /// Why this alternative wasn't selected.
    pub reason: String,

    /// Confidence in this alternative (0-1).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f64>,
}

impl<T> Alternative<T> {
    /// Create a new alternative.
    pub fn new(data: T, reason: impl Into<String>) -> Self {
        Self {
            data,
            reason: reason.into(),
            confidence: None,
        }
    }

    /// Add a confidence score.
    pub fn with_confidence(mut self, confidence: f64) -> Self {
        self.confidence = Some(confidence.clamp(0.0, 1.0));
        self
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// WARNING
// ═══════════════════════════════════════════════════════════════════════════════

/// Warning severity levels.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum WarningSeverity {
    /// Low severity - informational.
    Low,
    /// Medium severity - should review.
    Medium,
    /// High severity - needs attention.
    High,
}

/// A warning that should be shown to the user.
///
/// Warnings are non-fatal issues that don't prevent success but
/// should be communicated to the user.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Warning {
    /// Warning code for programmatic handling.
    pub code: String,

    /// Human-readable warning message.
    pub message: String,

    /// Warning severity.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub severity: Option<WarningSeverity>,

    /// Context about the warning.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<HashMap<String, serde_json::Value>>,
}

impl Warning {
    /// Create a new warning.
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            severity: None,
            context: None,
        }
    }

    /// Set the severity.
    pub fn with_severity(mut self, severity: WarningSeverity) -> Self {
        self.severity = Some(severity);
        self
    }

    /// Add context.
    pub fn with_context(mut self, context: HashMap<String, serde_json::Value>) -> Self {
        self.context = Some(context);
        self
    }
}

/// Create a warning.
pub fn create_warning(code: &str, message: &str, severity: Option<WarningSeverity>) -> Warning {
    Warning::new(code, message).with_severity(severity.unwrap_or(WarningSeverity::Medium))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_source_creation() {
        let source = Source::new("MDN Web Docs", SourceType::Url)
            .with_url("https://developer.mozilla.org")
            .with_relevance(0.95);

        assert_eq!(source.name, "MDN Web Docs");
        assert_eq!(source.source_type, SourceType::Url);
        assert_eq!(source.url, Some("https://developer.mozilla.org".to_string()));
        assert_eq!(source.relevance, Some(0.95));
    }

    #[test]
    fn test_plan_step() {
        let step = PlanStep::new(1, "Parse input")
            .with_status(PlanStepStatus::Completed)
            .with_duration(150);

        assert_eq!(step.step, 1);
        assert_eq!(step.status, PlanStepStatus::Completed);
        assert_eq!(step.duration_ms, Some(150));
    }

    #[test]
    fn test_alternative() {
        let alt = Alternative::new("Option B", "Lower confidence").with_confidence(0.7);

        assert_eq!(alt.data, "Option B");
        assert_eq!(alt.reason, "Lower confidence");
        assert_eq!(alt.confidence, Some(0.7));
    }

    #[test]
    fn test_warning() {
        let warning = Warning::new("DEPRECATED_FEATURE", "This feature will be removed in v2")
            .with_severity(WarningSeverity::Medium);

        assert_eq!(warning.code, "DEPRECATED_FEATURE");
        assert_eq!(warning.severity, Some(WarningSeverity::Medium));
    }

    #[test]
    fn test_json_serialization() {
        let source = Source::new("Test", SourceType::Api);
        let json = serde_json::to_string(&source).unwrap();

        // Verify camelCase and lowercase enums
        assert!(json.contains("\"sourceType\":\"api\""));
    }
}
