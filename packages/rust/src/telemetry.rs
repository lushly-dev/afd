//! Telemetry types for AFD command execution tracking.
//!
//! This module provides simple event and sink primitives for recording
//! command execution outcomes across AFD applications.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::actor::ActorKind;
use crate::errors::CommandError;

/// Telemetry event representing a single command execution.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct TelemetryEvent {
    /// Name of the command that was executed.
    pub command_name: String,

    /// ISO timestamp when command execution started.
    pub started_at: String,

    /// ISO timestamp when command execution completed.
    pub completed_at: String,

    /// Duration of execution in milliseconds.
    pub duration_ms: u64,

    /// Whether the command executed successfully.
    pub success: bool,

    /// Error details if the command failed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<CommandError>,

    /// Trace ID for correlating related events.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trace_id: Option<String>,

    /// Confidence score from the result, if provided.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f64>,

    /// Additional metadata from the command result.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<HashMap<String, serde_json::Value>>,

    /// Input provided to the command.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input: Option<serde_json::Value>,

    /// Command version that was executed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command_version: Option<String>,

    /// Kind of principal that called the command (`context.actor.kind`), never its id.
    #[serde(
        default,
        deserialize_with = "crate::actor::deserialize_lenient_actor_kind",
        skip_serializing_if = "Option::is_none"
    )]
    pub actor_kind: Option<ActorKind>,
}

impl TelemetryEvent {
    /// Create a telemetry event with computed duration.
    pub fn new(
        command_name: impl Into<String>,
        started_at: impl Into<String>,
        completed_at: impl Into<String>,
        success: bool,
    ) -> Self {
        let started_at = started_at.into();
        let completed_at = completed_at.into();

        Self {
            command_name: command_name.into(),
            duration_ms: calculate_duration_ms(&started_at, &completed_at),
            started_at,
            completed_at,
            success,
            error: None,
            trace_id: None,
            confidence: None,
            metadata: None,
            input: None,
            command_version: None,
            actor_kind: None,
        }
    }

    /// Override the duration in milliseconds.
    pub fn with_duration_ms(mut self, duration_ms: u64) -> Self {
        self.duration_ms = duration_ms;
        self
    }

    /// Attach an execution error.
    pub fn with_error(mut self, error: CommandError) -> Self {
        self.error = Some(error);
        self
    }

    /// Attach a trace ID.
    pub fn with_trace_id(mut self, trace_id: impl Into<String>) -> Self {
        self.trace_id = Some(trace_id.into());
        self
    }

    /// Attach a confidence score.
    pub fn with_confidence(mut self, confidence: f64) -> Self {
        self.confidence = Some(confidence);
        self
    }

    /// Attach metadata.
    pub fn with_metadata(mut self, metadata: HashMap<String, serde_json::Value>) -> Self {
        self.metadata = Some(metadata);
        self
    }

    /// Attach the command input payload.
    pub fn with_input(mut self, input: serde_json::Value) -> Self {
        self.input = Some(input);
        self
    }

    /// Attach the command version.
    pub fn with_command_version(mut self, command_version: impl Into<String>) -> Self {
        self.command_version = Some(command_version.into());
        self
    }

    /// Attach the kind of principal that called the command.
    pub fn with_actor_kind(mut self, actor_kind: ActorKind) -> Self {
        self.actor_kind = Some(actor_kind);
        self
    }
}

/// Pluggable telemetry storage backend.
pub trait TelemetrySink: Send + Sync {
    /// Record a telemetry event.
    fn record(&self, event: &TelemetryEvent);

    /// Flush any buffered telemetry.
    fn flush(&self) {}
}

/// Create a telemetry event with computed duration.
pub fn create_telemetry_event(
    command_name: impl Into<String>,
    started_at: impl Into<String>,
    completed_at: impl Into<String>,
    success: bool,
) -> TelemetryEvent {
    TelemetryEvent::new(command_name, started_at, completed_at, success)
}

/// Type guard to check if a value is a telemetry event.
pub fn is_telemetry_event<T: Serialize>(value: &T) -> bool {
    if let Ok(json) = serde_json::to_value(value) {
        matches!(json.get("commandName"), Some(serde_json::Value::String(_)))
            && matches!(json.get("startedAt"), Some(serde_json::Value::String(_)))
            && matches!(json.get("completedAt"), Some(serde_json::Value::String(_)))
            && matches!(json.get("durationMs"), Some(serde_json::Value::Number(_)))
            && matches!(json.get("success"), Some(serde_json::Value::Bool(_)))
    } else {
        false
    }
}

fn calculate_duration_ms(started_at: &str, completed_at: &str) -> u64 {
    let started = chrono::DateTime::parse_from_rfc3339(started_at).ok();
    let completed = chrono::DateTime::parse_from_rfc3339(completed_at).ok();

    match (started, completed) {
        (Some(started), Some(completed)) => {
            let duration_ms = completed.timestamp_millis() - started.timestamp_millis();
            duration_ms.max(0) as u64
        }
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_telemetry_event() {
        let event = create_telemetry_event(
            "todo-create",
            "2024-01-15T10:30:00.000Z",
            "2024-01-15T10:30:00.150Z",
            true,
        );

        assert_eq!(event.command_name, "todo-create");
        assert_eq!(event.duration_ms, 150);
        assert!(event.success);
    }

    #[test]
    fn test_create_telemetry_event_with_optional_fields() {
        let mut metadata = HashMap::new();
        metadata.insert("region".to_string(), serde_json::json!("us-east"));

        let event = create_telemetry_event(
            "todo-create",
            "2024-01-15T10:30:00.000Z",
            "2024-01-15T10:30:00.150Z",
            false,
        )
        .with_duration_ms(200)
        .with_error(CommandError::new("NOT_FOUND", "Item not found"))
        .with_trace_id("trace-123")
        .with_confidence(0.95)
        .with_metadata(metadata.clone())
        .with_input(serde_json::json!({"title": "Test"}))
        .with_command_version("1.0.0")
        .with_actor_kind(ActorKind::Agent);

        assert_eq!(event.duration_ms, 200);
        assert_eq!(event.trace_id, Some("trace-123".to_string()));
        assert_eq!(event.confidence, Some(0.95));
        assert_eq!(event.metadata, Some(metadata));
        assert_eq!(event.command_version, Some("1.0.0".to_string()));
        assert_eq!(event.actor_kind, Some(ActorKind::Agent));
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(json["actorKind"], "agent");
        assert_eq!(
            serde_json::from_value::<TelemetryEvent>(json).unwrap(),
            event
        );
    }

    #[test]
    fn test_is_telemetry_event() {
        let event = create_telemetry_event(
            "todo-create",
            "2024-01-15T10:30:00.000Z",
            "2024-01-15T10:30:00.150Z",
            true,
        );
        assert!(is_telemetry_event(&event));

        let invalid = serde_json::json!({
            "commandName": "todo-create",
            "startedAt": "2024-01-15T10:30:00.000Z",
            "completedAt": "2024-01-15T10:30:00.150Z",
            "durationMs": "150",
            "success": true
        });
        assert!(!is_telemetry_event(&invalid));
    }
}
