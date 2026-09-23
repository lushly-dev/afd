//! Metadata types for command results.
//!
//! These types provide context and transparency for AI-powered commands. Their
//! JSON shapes match `packages/core/src/metadata.ts` and the golden fixtures in
//! `spec/wire/`.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ═══════════════════════════════════════════════════════════════════════════════
// SOURCE
// ═══════════════════════════════════════════════════════════════════════════════

/// Information source used by a command to produce its result.
///
/// Sources help users verify information and build trust.
///
/// # Example
///
/// ```rust
/// use afd::{Source, SourceType};
///
/// let source = Source::new(SourceType::Document)
///     .with_id("style-guide-v3")
///     .with_title("Style Guide")
///     .with_location("Chapter 3.2");
/// assert_eq!(source.source_type, "document");
/// ```
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct Source {
    /// Source type identifier.
    ///
    /// Common values are listed in [`SourceType`]; any string is accepted.
    #[serde(rename = "type")]
    pub source_type: String,

    /// Unique identifier for the source.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,

    /// Human-readable title for display.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,

    /// URL if the source is web-accessible.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,

    /// Specific location within the source (page, section, line, etc.).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub location: Option<String>,

    /// When the source was last accessed or retrieved (ISO timestamp).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub accessed_at: Option<String>,

    /// Confidence or relevance score for this source (0-1).
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "crate::wire::opt_number"
    )]
    pub relevance: Option<f64>,
}

/// Common source type identifiers.
///
/// [`Source::source_type`] is a free-form string on the wire; these are the
/// conventional values. Convert with `String::from` or pass directly to
/// [`Source::new`].
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
#[non_exhaustive]
pub enum SourceType {
    /// A document (`document`).
    Document,
    /// Web page or online resource (`url`).
    Url,
    /// Local or remote file (`file`).
    File,
    /// Database record (`database`).
    Database,
    /// API endpoint (`api`).
    Api,
    /// User-provided input (`user_input`).
    UserInput,
    /// Model output or internal knowledge (`model`).
    Model,
    /// Knowledge graph (`knowledge`).
    Knowledge,
    /// Other source type (`other`).
    Other,
}

impl SourceType {
    /// The wire identifier for this source type.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Document => "document",
            Self::Url => "url",
            Self::File => "file",
            Self::Database => "database",
            Self::Api => "api",
            Self::UserInput => "user_input",
            Self::Model => "model",
            Self::Knowledge => "knowledge",
            Self::Other => "other",
        }
    }
}

impl From<SourceType> for String {
    fn from(value: SourceType) -> Self {
        value.as_str().to_string()
    }
}

impl Source {
    /// Create a new source of the given type.
    pub fn new(source_type: impl Into<String>) -> Self {
        Self {
            source_type: source_type.into(),
            id: None,
            title: None,
            url: None,
            location: None,
            accessed_at: None,
            relevance: None,
        }
    }

    /// Set the source identifier.
    pub fn with_id(mut self, id: impl Into<String>) -> Self {
        self.id = Some(id.into());
        self
    }

    /// Set the display title.
    pub fn with_title(mut self, title: impl Into<String>) -> Self {
        self.title = Some(title.into());
        self
    }

    /// Add a URL to the source.
    pub fn with_url(mut self, url: impl Into<String>) -> Self {
        self.url = Some(url.into());
        self
    }

    /// Set the location within the source.
    pub fn with_location(mut self, location: impl Into<String>) -> Self {
        self.location = Some(location.into());
        self
    }

    /// Add an accessed-at timestamp.
    pub fn with_accessed_at(mut self, timestamp: impl Into<String>) -> Self {
        self.accessed_at = Some(timestamp.into());
        self
    }

    /// Add a relevance score, clamped to 0-1.
    pub fn with_relevance(mut self, relevance: f64) -> Self {
        self.relevance = Some(relevance.clamp(0.0, 1.0));
        self
    }
}

/// Create a source with an optional title and URL.
pub fn create_source(
    source_type: impl Into<String>,
    title: Option<&str>,
    url: Option<&str>,
) -> Source {
    let mut source = Source::new(source_type);
    source.title = title.map(ToString::to_string);
    source.url = url.map(ToString::to_string);
    source
}

// ═══════════════════════════════════════════════════════════════════════════════
// PLAN STEP
// ═══════════════════════════════════════════════════════════════════════════════

/// Status of a plan step.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
#[non_exhaustive]
pub enum PlanStepStatus {
    /// Step hasn't started yet (`pending`).
    Pending,
    /// Step is currently executing (`in_progress`).
    InProgress,
    /// Step completed successfully (`complete`).
    Complete,
    /// Step failed (`failed`).
    Failed,
    /// Step was skipped (`skipped`).
    Skipped,
}

/// Error information for a failed plan step.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct PlanStepError {
    /// Machine-readable error code.
    pub code: String,
    /// Human-readable error message.
    pub message: String,
}

impl PlanStepError {
    /// Create a plan step error.
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

impl From<crate::errors::CommandError> for PlanStepError {
    fn from(error: crate::errors::CommandError) -> Self {
        Self::new(error.code, error.message)
    }
}

/// A step in a multi-step plan or operation.
///
/// Plan steps give users visibility into what the system is doing.
///
/// # Example
///
/// ```rust
/// use afd::{PlanStep, PlanStepStatus};
///
/// let step = PlanStep::new("validate-input", "validate")
///     .with_description("Validate document format")
///     .with_status(PlanStepStatus::InProgress);
/// assert_eq!(step.id, "validate-input");
/// ```
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct PlanStep {
    /// Unique identifier for this step.
    pub id: String,

    /// The action being performed (a verb such as `fetch` or `validate`).
    pub action: String,

    /// Current status of this step.
    pub status: PlanStepStatus,

    /// Human-readable description of what this step does.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,

    /// IDs of steps that must complete before this one can start.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub depends_on: Option<Vec<String>>,

    /// Result data if the step is complete.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::wire::present"
    )]
    pub result: Option<serde_json::Value>,

    /// Error information if the step failed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<PlanStepError>,

    /// Progress of the step while in progress.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "crate::wire::opt_number"
    )]
    pub progress: Option<f64>,

    /// Estimated time remaining in milliseconds.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "crate::wire::opt_number"
    )]
    pub estimated_time_remaining_ms: Option<f64>,
}

impl PlanStep {
    /// Create a new pending plan step.
    pub fn new(id: impl Into<String>, action: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            action: action.into(),
            status: PlanStepStatus::Pending,
            description: None,
            depends_on: None,
            result: None,
            error: None,
            progress: None,
            estimated_time_remaining_ms: None,
        }
    }

    /// Update the status of the step.
    pub fn with_status(mut self, status: PlanStepStatus) -> Self {
        self.status = status;
        self
    }

    /// Set the description.
    pub fn with_description(mut self, description: impl Into<String>) -> Self {
        self.description = Some(description.into());
        self
    }

    /// Set the IDs of steps this one depends on.
    pub fn with_depends_on(mut self, depends_on: Vec<String>) -> Self {
        self.depends_on = Some(depends_on);
        self
    }

    /// Set the result data.
    pub fn with_result(mut self, result: serde_json::Value) -> Self {
        self.result = Some(result);
        self
    }

    /// Set the progress.
    pub fn with_progress(mut self, progress: f64) -> Self {
        self.progress = Some(progress);
        self
    }

    /// Set the estimated time remaining in milliseconds.
    pub fn with_estimated_time_remaining_ms(mut self, remaining_ms: f64) -> Self {
        self.estimated_time_remaining_ms = Some(remaining_ms);
        self
    }

    /// Record an error and mark the step as failed.
    pub fn with_error(mut self, code: impl Into<String>, message: impl Into<String>) -> Self {
        self.error = Some(PlanStepError::new(code, message));
        self.status = PlanStepStatus::Failed;
        self
    }
}

/// Create a new pending plan step.
pub fn create_step(id: &str, action: &str, description: Option<&str>) -> PlanStep {
    let mut step = PlanStep::new(id, action);
    step.description = description.map(ToString::to_string);
    step
}

/// Update the status of a step.
///
/// As in TypeScript's `updateStepStatus`, `result` is stored only when the new
/// status is [`PlanStepStatus::Complete`].
pub fn update_step_status(
    step: &mut PlanStep,
    status: PlanStepStatus,
    result: Option<serde_json::Value>,
) {
    step.status = status;
    if status == PlanStepStatus::Complete {
        if let Some(result) = result {
            step.result = Some(result);
        }
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
#[non_exhaustive]
pub struct Alternative<T> {
    /// The alternative data.
    pub data: T,

    /// Why this alternative wasn't selected.
    pub reason: String,

    /// Confidence in this alternative (0-1).
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "crate::wire::opt_number"
    )]
    pub confidence: Option<f64>,

    /// Label or name for this alternative (e.g. "Formal").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

impl<T> Alternative<T> {
    /// Create a new alternative.
    pub fn new(data: T, reason: impl Into<String>) -> Self {
        Self {
            data,
            reason: reason.into(),
            confidence: None,
            label: None,
        }
    }

    /// Add a confidence score, clamped to 0-1.
    pub fn with_confidence(mut self, confidence: f64) -> Self {
        self.confidence = Some(confidence.clamp(0.0, 1.0));
        self
    }

    /// Add a label.
    pub fn with_label(mut self, label: impl Into<String>) -> Self {
        self.label = Some(label.into());
        self
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// WARNING
// ═══════════════════════════════════════════════════════════════════════════════

/// Warning severity levels.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
#[non_exhaustive]
pub enum WarningSeverity {
    /// Informational, no action needed (`info`).
    Info,
    /// Something to be aware of (`warning`).
    Warning,
    /// May need attention before proceeding (`caution`).
    Caution,
}

/// A non-fatal warning or notice to surface to the user.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct Warning {
    /// Machine-readable warning code (SCREAMING_SNAKE_CASE).
    pub code: String,

    /// Human-readable warning message.
    pub message: String,

    /// Severity level for UI treatment.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub severity: Option<WarningSeverity>,

    /// Additional context or details.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub details: Option<HashMap<String, serde_json::Value>>,
}

impl Warning {
    /// Create a new warning without a severity.
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            severity: None,
            details: None,
        }
    }

    /// Set the severity.
    pub fn with_severity(mut self, severity: WarningSeverity) -> Self {
        self.severity = Some(severity);
        self
    }

    /// Add details.
    pub fn with_details(mut self, details: HashMap<String, serde_json::Value>) -> Self {
        self.details = Some(details);
        self
    }
}

/// Create a warning. The severity defaults to [`WarningSeverity::Warning`], as in TypeScript.
pub fn create_warning(code: &str, message: &str, severity: Option<WarningSeverity>) -> Warning {
    Warning::new(code, message).with_severity(severity.unwrap_or(WarningSeverity::Warning))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_source_creation() {
        let source = Source::new(SourceType::Url)
            .with_title("MDN Web Docs")
            .with_url("https://developer.mozilla.org")
            .with_relevance(0.95);

        assert_eq!(source.source_type, "url");
        assert_eq!(source.title.as_deref(), Some("MDN Web Docs"));
        assert_eq!(
            source.url,
            Some("https://developer.mozilla.org".to_string())
        );
        assert_eq!(source.relevance, Some(0.95));
    }

    #[test]
    fn test_source_accepts_any_type_string() {
        let source: Source =
            serde_json::from_value(serde_json::json!({"type": "custom-index"})).unwrap();
        assert_eq!(source.source_type, "custom-index");
        assert_eq!(
            serde_json::to_value(&source).unwrap(),
            serde_json::json!({"type": "custom-index"})
        );
    }

    #[test]
    fn test_plan_step() {
        let step = PlanStep::new("parse", "Parse input")
            .with_status(PlanStepStatus::Complete)
            .with_progress(100.0);

        assert_eq!(step.id, "parse");
        assert_eq!(step.status, PlanStepStatus::Complete);
        assert_eq!(
            serde_json::to_value(&step).unwrap(),
            serde_json::json!({
                "id": "parse",
                "action": "Parse input",
                "status": "complete",
                "progress": 100
            })
        );
    }

    #[test]
    fn test_plan_step_status_wire_names() {
        let statuses = [
            (PlanStepStatus::Pending, "pending"),
            (PlanStepStatus::InProgress, "in_progress"),
            (PlanStepStatus::Complete, "complete"),
            (PlanStepStatus::Failed, "failed"),
            (PlanStepStatus::Skipped, "skipped"),
        ];
        for (status, name) in statuses {
            assert_eq!(serde_json::to_value(status).unwrap(), name);
        }
    }

    #[test]
    fn test_update_step_status_stores_result_only_when_complete() {
        let mut step = create_step("fetch", "fetch", Some("Fetch data"));
        update_step_status(
            &mut step,
            PlanStepStatus::InProgress,
            Some(serde_json::json!(1)),
        );
        assert_eq!(step.result, None);
        update_step_status(
            &mut step,
            PlanStepStatus::Complete,
            Some(serde_json::json!(2)),
        );
        assert_eq!(step.result, Some(serde_json::json!(2)));
    }

    #[test]
    fn test_alternative() {
        let alt = Alternative::new("Option B", "Lower confidence")
            .with_confidence(0.7)
            .with_label("B");

        assert_eq!(alt.data, "Option B");
        assert_eq!(alt.reason, "Lower confidence");
        assert_eq!(alt.confidence, Some(0.7));
        assert_eq!(alt.label.as_deref(), Some("B"));
    }

    #[test]
    fn test_warning() {
        let warning = Warning::new("DEPRECATED_FEATURE", "This feature will be removed in v2")
            .with_severity(WarningSeverity::Caution);

        assert_eq!(warning.code, "DEPRECATED_FEATURE");
        assert_eq!(warning.severity, Some(WarningSeverity::Caution));
        assert_eq!(
            create_warning("A", "b", None).severity,
            Some(WarningSeverity::Warning)
        );
    }

    #[test]
    fn test_json_serialization() {
        let source = Source::new(SourceType::Api);
        let json = serde_json::to_string(&source).unwrap();
        assert_eq!(json, r#"{"type":"api"}"#);

        let severity = serde_json::to_string(&WarningSeverity::Info).unwrap();
        assert_eq!(severity, r#""info""#);
    }
}
