//! Streaming types for progressive command results.
//!
//! Streaming allows commands to report progress and partial data
//! before the final result is ready.

use serde::{Deserialize, Serialize};

use crate::errors::CommandError;

// ═══════════════════════════════════════════════════════════════════════════════
// STREAM CHUNK TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/// Progress update during command execution.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProgressChunk {
    /// Chunk type identifier.
    #[serde(rename = "type")]
    pub chunk_type: String,

    /// Progress percentage (0-100).
    pub progress: f64,

    /// Human-readable status message.
    pub message: String,

    /// Current step number (if applicable).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_step: Option<u32>,

    /// Total steps (if applicable).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_steps: Option<u32>,
}

/// Partial data emitted during streaming.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DataChunk<T = serde_json::Value> {
    /// Chunk type identifier.
    #[serde(rename = "type")]
    pub chunk_type: String,

    /// The partial data.
    pub data: T,

    /// Whether this is the final data chunk.
    #[serde(default)]
    pub is_final: bool,

    /// Sequence number for ordering.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sequence: Option<u32>,
}

/// Completion signal for a stream.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CompleteChunk<T = serde_json::Value> {
    /// Chunk type identifier.
    #[serde(rename = "type")]
    pub chunk_type: String,

    /// Final result data.
    pub data: T,

    /// Total execution time in milliseconds.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
}

/// Error signal for a stream.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ErrorChunk {
    /// Chunk type identifier.
    #[serde(rename = "type")]
    pub chunk_type: String,

    /// The error that occurred.
    pub error: CommandError,

    /// Whether the stream can recover from this error.
    #[serde(default)]
    pub recoverable: bool,
}

/// A chunk from a streaming command.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum StreamChunk<T = serde_json::Value> {
    /// Progress update.
    Progress(ProgressChunk),
    /// Partial data.
    Data(DataChunk<T>),
    /// Stream completed successfully.
    Complete(CompleteChunk<T>),
    /// Stream encountered an error.
    Error(ErrorChunk),
}

// ═══════════════════════════════════════════════════════════════════════════════
// STREAM OPTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/// Options for streaming commands.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StreamOptions {
    /// Enable progress reporting.
    #[serde(default = "default_true")]
    pub report_progress: bool,

    /// Minimum interval between progress updates (ms).
    #[serde(default = "default_progress_interval")]
    pub progress_interval_ms: u64,

    /// Enable partial data chunks.
    #[serde(default)]
    pub emit_partial_data: bool,

    /// Timeout for the entire stream (ms).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<u64>,

    /// Maximum buffer size for partial data.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub buffer_size: Option<usize>,
}

fn default_true() -> bool {
    true
}

fn default_progress_interval() -> u64 {
    100
}

impl Default for StreamOptions {
    fn default() -> Self {
        Self {
            report_progress: true,
            progress_interval_ms: 100,
            emit_partial_data: false,
            timeout_ms: None,
            buffer_size: None,
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// STREAM CALLBACKS (for native async usage)
// ═══════════════════════════════════════════════════════════════════════════════

/// Callbacks for handling stream events.
pub struct StreamCallbacks<T> {
    /// Called when progress is reported.
    pub on_progress: Option<Box<dyn Fn(&ProgressChunk) + Send + Sync>>,
    /// Called when partial data is available.
    pub on_data: Option<Box<dyn Fn(&DataChunk<T>) + Send + Sync>>,
    /// Called when the stream completes.
    pub on_complete: Option<Box<dyn Fn(&CompleteChunk<T>) + Send + Sync>>,
    /// Called when an error occurs.
    pub on_error: Option<Box<dyn Fn(&ErrorChunk) + Send + Sync>>,
}

impl<T> Default for StreamCallbacks<T> {
    fn default() -> Self {
        Self {
            on_progress: None,
            on_data: None,
            on_complete: None,
            on_error: None,
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FACTORY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/// Create a progress chunk.
pub fn create_progress_chunk(progress: f64, message: &str) -> ProgressChunk {
    ProgressChunk {
        chunk_type: "progress".to_string(),
        progress: progress.clamp(0.0, 100.0),
        message: message.to_string(),
        current_step: None,
        total_steps: None,
    }
}

/// Create a progress chunk with step info.
pub fn create_progress_chunk_with_steps(
    progress: f64,
    message: &str,
    current_step: u32,
    total_steps: u32,
) -> ProgressChunk {
    ProgressChunk {
        chunk_type: "progress".to_string(),
        progress: progress.clamp(0.0, 100.0),
        message: message.to_string(),
        current_step: Some(current_step),
        total_steps: Some(total_steps),
    }
}

/// Create a data chunk.
pub fn create_data_chunk<T>(data: T, is_final: bool) -> DataChunk<T> {
    DataChunk {
        chunk_type: "data".to_string(),
        data,
        is_final,
        sequence: None,
    }
}

/// Create a complete chunk.
pub fn create_complete_chunk<T>(data: T, duration_ms: Option<u64>) -> CompleteChunk<T> {
    CompleteChunk {
        chunk_type: "complete".to_string(),
        data,
        duration_ms,
    }
}

/// Create an error chunk.
pub fn create_error_chunk(error: CommandError, recoverable: bool) -> ErrorChunk {
    ErrorChunk {
        chunk_type: "error".to_string(),
        error,
        recoverable,
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TYPE GUARDS
// ═══════════════════════════════════════════════════════════════════════════════

/// Check if a value is a ProgressChunk.
pub fn is_progress_chunk<T: Serialize>(value: &T) -> bool {
    if let Ok(json) = serde_json::to_value(value) {
        json.get("type") == Some(&serde_json::json!("progress"))
            && json.get("progress").is_some()
            && json.get("message").is_some()
    } else {
        false
    }
}

/// Check if a value is a DataChunk.
pub fn is_data_chunk<T: Serialize>(value: &T) -> bool {
    if let Ok(json) = serde_json::to_value(value) {
        json.get("type") == Some(&serde_json::json!("data")) && json.get("data").is_some()
    } else {
        false
    }
}

/// Check if a value is a CompleteChunk.
pub fn is_complete_chunk<T: Serialize>(value: &T) -> bool {
    if let Ok(json) = serde_json::to_value(value) {
        json.get("type") == Some(&serde_json::json!("complete")) && json.get("data").is_some()
    } else {
        false
    }
}

/// Check if a value is an ErrorChunk.
pub fn is_error_chunk<T: Serialize>(value: &T) -> bool {
    if let Ok(json) = serde_json::to_value(value) {
        json.get("type") == Some(&serde_json::json!("error")) && json.get("error").is_some()
    } else {
        false
    }
}

/// Check if a value is any type of StreamChunk.
pub fn is_stream_chunk<T: Serialize>(value: &T) -> bool {
    is_progress_chunk(value)
        || is_data_chunk(value)
        || is_complete_chunk(value)
        || is_error_chunk(value)
}

// ═══════════════════════════════════════════════════════════════════════════════
// STREAM UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

/// Collect all data chunks from a stream into a single result.
pub fn collect_stream_data<T: Clone>(chunks: &[StreamChunk<T>]) -> Vec<T> {
    chunks
        .iter()
        .filter_map(|chunk| match chunk {
            StreamChunk::Data(data_chunk) => Some(data_chunk.data.clone()),
            StreamChunk::Complete(complete_chunk) => Some(complete_chunk.data.clone()),
            _ => None,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_progress_chunk() {
        let chunk = create_progress_chunk(50.0, "Processing...");
        assert_eq!(chunk.progress, 50.0);
        assert_eq!(chunk.message, "Processing...");
    }

    #[test]
    fn test_progress_chunk_clamping() {
        let chunk = create_progress_chunk(150.0, "Test");
        assert_eq!(chunk.progress, 100.0);

        let chunk = create_progress_chunk(-10.0, "Test");
        assert_eq!(chunk.progress, 0.0);
    }

    #[test]
    fn test_data_chunk() {
        let chunk = create_data_chunk("partial data", false);
        assert_eq!(chunk.data, "partial data");
        assert!(!chunk.is_final);
    }

    #[test]
    fn test_complete_chunk() {
        let chunk = create_complete_chunk("final result", Some(1500));
        assert_eq!(chunk.data, "final result");
        assert_eq!(chunk.duration_ms, Some(1500));
    }

    #[test]
    fn test_error_chunk() {
        let error = CommandError::timeout("test", 5000);
        let chunk = create_error_chunk(error.clone(), true);
        assert!(chunk.recoverable);
        assert_eq!(chunk.error.code, "TIMEOUT");
    }

    #[test]
    fn test_stream_options_default() {
        let opts = StreamOptions::default();
        assert!(opts.report_progress);
        assert_eq!(opts.progress_interval_ms, 100);
        assert!(!opts.emit_partial_data);
    }

    #[test]
    fn test_type_guards() {
        let progress = create_progress_chunk(50.0, "Test");
        assert!(is_progress_chunk(&progress));

        let data = create_data_chunk("test", false);
        assert!(is_data_chunk(&data));

        let complete = create_complete_chunk("done", None);
        assert!(is_complete_chunk(&complete));

        let error = create_error_chunk(CommandError::internal("test"), false);
        assert!(is_error_chunk(&error));
    }

    #[test]
    fn test_collect_stream_data() {
        let chunks: Vec<StreamChunk<String>> = vec![
            StreamChunk::Progress(create_progress_chunk(25.0, "Starting")),
            StreamChunk::Data(create_data_chunk("chunk1".to_string(), false)),
            StreamChunk::Progress(create_progress_chunk(75.0, "Almost done")),
            StreamChunk::Data(create_data_chunk("chunk2".to_string(), false)),
            StreamChunk::Complete(create_complete_chunk("final".to_string(), Some(100))),
        ];

        let data = collect_stream_data(&chunks);
        assert_eq!(data, vec!["chunk1", "chunk2", "final"]);
    }
}
