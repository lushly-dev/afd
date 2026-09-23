//! Streaming types for progressive command results.
//!
//! Streaming allows commands to report progress and partial data
//! before the final result is ready.

use serde::{de::Deserializer, ser::Serializer, Deserialize, Serialize};
use std::time::{Duration, Instant};

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
#[derive(Debug, Clone)]
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

/// Wire representation of a stream chunk without the duplicated inner
/// `chunk_type` field. The public chunk structs retain that field for source
/// compatibility, while the union has one canonical discriminator.
#[derive(Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum StreamChunkRef<'a, T> {
    Progress {
        progress: f64,
        message: &'a str,
        #[serde(rename = "currentStep", skip_serializing_if = "Option::is_none")]
        current_step: Option<u32>,
        #[serde(rename = "totalSteps", skip_serializing_if = "Option::is_none")]
        total_steps: Option<u32>,
    },
    Data {
        data: &'a T,
        #[serde(rename = "isFinal")]
        is_final: bool,
        #[serde(rename = "sequence", skip_serializing_if = "Option::is_none")]
        sequence: Option<u32>,
    },
    Complete {
        data: &'a T,
        #[serde(rename = "durationMs", skip_serializing_if = "Option::is_none")]
        duration_ms: Option<u64>,
    },
    Error {
        error: &'a CommandError,
        recoverable: bool,
    },
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum StreamChunkWire<T> {
    Progress {
        progress: f64,
        message: String,
        #[serde(rename = "currentStep", default)]
        current_step: Option<u32>,
        #[serde(rename = "totalSteps", default)]
        total_steps: Option<u32>,
    },
    Data {
        data: T,
        #[serde(rename = "isFinal", default)]
        is_final: bool,
        #[serde(default)]
        sequence: Option<u32>,
    },
    Complete {
        data: T,
        #[serde(rename = "durationMs", default)]
        duration_ms: Option<u64>,
    },
    Error {
        error: CommandError,
        #[serde(default)]
        recoverable: bool,
    },
}

impl<T: Serialize> Serialize for StreamChunk<T> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let wire = match self {
            Self::Progress(chunk) => StreamChunkRef::Progress {
                progress: chunk.progress,
                message: &chunk.message,
                current_step: chunk.current_step,
                total_steps: chunk.total_steps,
            },
            Self::Data(chunk) => StreamChunkRef::Data {
                data: &chunk.data,
                is_final: chunk.is_final,
                sequence: chunk.sequence,
            },
            Self::Complete(chunk) => StreamChunkRef::Complete {
                data: &chunk.data,
                duration_ms: chunk.duration_ms,
            },
            Self::Error(chunk) => StreamChunkRef::Error {
                error: &chunk.error,
                recoverable: chunk.recoverable,
            },
        };

        wire.serialize(serializer)
    }
}

impl<'de, T: Deserialize<'de>> Deserialize<'de> for StreamChunk<T> {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Ok(match StreamChunkWire::deserialize(deserializer)? {
            StreamChunkWire::Progress {
                progress,
                message,
                current_step,
                total_steps,
            } => Self::Progress(ProgressChunk {
                chunk_type: "progress".to_string(),
                progress,
                message,
                current_step,
                total_steps,
            }),
            StreamChunkWire::Data {
                data,
                is_final,
                sequence,
            } => Self::Data(DataChunk {
                chunk_type: "data".to_string(),
                data,
                is_final,
                sequence,
            }),
            StreamChunkWire::Complete { data, duration_ms } => Self::Complete(CompleteChunk {
                chunk_type: "complete".to_string(),
                data,
                duration_ms,
            }),
            StreamChunkWire::Error { error, recoverable } => Self::Error(ErrorChunk {
                chunk_type: "error".to_string(),
                error,
                recoverable,
            }),
        })
    }
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

/// Callback invoked with a [`ProgressChunk`].
pub type ProgressCallback = Box<dyn Fn(&ProgressChunk) + Send + Sync>;
/// Callback invoked with a [`DataChunk`].
pub type DataCallback<T> = Box<dyn Fn(&DataChunk<T>) + Send + Sync>;
/// Callback invoked with a [`CompleteChunk`].
pub type CompleteCallback<T> = Box<dyn Fn(&CompleteChunk<T>) + Send + Sync>;
/// Callback invoked with an [`ErrorChunk`].
pub type ErrorCallback = Box<dyn Fn(&ErrorChunk) + Send + Sync>;

/// Callbacks for handling stream events.
pub struct StreamCallbacks<T> {
    /// Called when progress is reported.
    pub on_progress: Option<ProgressCallback>,
    /// Called when partial data is available.
    pub on_data: Option<DataCallback<T>>,
    /// Called when the stream completes.
    pub on_complete: Option<CompleteCallback<T>>,
    /// Called when an error occurs.
    pub on_error: Option<ErrorCallback>,
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

/// Marker metadata for commands that support streaming.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StreamableCommand {
    /// Indicates this command supports streaming responses.
    pub streamable: bool,

    /// Type of data emitted in stream chunks.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream_data_type: Option<String>,

    /// Whether progress updates are emitted.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub emits_progress: Option<bool>,

    /// Estimated items-per-second throughput.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub estimated_throughput: Option<f64>,
}

/// Simple timeout tracker for streaming operations.
#[derive(Debug, Clone)]
pub struct TimeoutController {
    started_at: Instant,
    timeout: Duration,
}

impl TimeoutController {
    /// Create a new timeout controller.
    pub fn new(timeout_ms: u64) -> Self {
        Self {
            started_at: Instant::now(),
            timeout: Duration::from_millis(timeout_ms),
        }
    }

    /// Return the elapsed time since the controller started.
    pub fn elapsed(&self) -> Duration {
        self.started_at.elapsed()
    }

    /// Return the remaining time before expiry, if any.
    pub fn remaining(&self) -> Option<Duration> {
        self.timeout.checked_sub(self.elapsed())
    }

    /// Check whether the timeout has elapsed.
    pub fn is_expired(&self) -> bool {
        self.elapsed() >= self.timeout
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

/// Check if a value is a streamable command marker.
pub fn is_streamable_command<T: Serialize>(value: &T) -> bool {
    if let Ok(json) = serde_json::to_value(value) {
        json.get("streamable") == Some(&serde_json::json!(true))
    } else {
        false
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// STREAM UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

/// Consume a stream and fan out events to callbacks.
pub async fn consume_stream<T, I>(
    stream: I,
    callbacks: &StreamCallbacks<T>,
) -> Result<CompleteChunk<T>, ErrorChunk>
where
    I: IntoIterator<Item = StreamChunk<T>>,
{
    for chunk in stream {
        match chunk {
            StreamChunk::Progress(progress) => {
                if let Some(callback) = &callbacks.on_progress {
                    callback(&progress);
                }
            }
            StreamChunk::Data(data) => {
                if let Some(callback) = &callbacks.on_data {
                    callback(&data);
                }
            }
            StreamChunk::Complete(complete) => {
                if let Some(callback) = &callbacks.on_complete {
                    callback(&complete);
                }
                return Ok(complete);
            }
            StreamChunk::Error(error) => {
                if let Some(callback) = &callbacks.on_error {
                    callback(&error);
                }
                return Err(error);
            }
        }
    }

    let error = create_error_chunk(
        CommandError::new(
            "STREAM_ENDED_UNEXPECTEDLY",
            "Stream ended without completion or error signal",
        )
        .with_suggestion("This may indicate a connection issue. Try again.")
        .with_retryable(true),
        true,
    );

    if let Some(callback) = &callbacks.on_error {
        callback(&error);
    }

    Err(error)
}

/// Create a timeout controller for stream operations.
pub fn create_timeout_controller(timeout_ms: u64) -> TimeoutController {
    TimeoutController::new(timeout_ms)
}

/// Collect all data chunks from a stream into a single result.
pub fn collect_stream_data<T: Clone>(chunks: &[StreamChunk<T>]) -> Vec<T> {
    chunks
        .iter()
        .filter_map(|chunk| match chunk {
            StreamChunk::Data(data_chunk) => Some(data_chunk.data.clone()),
            _ => None,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    use std::thread;

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
    fn test_is_streamable_command() {
        let streamable = StreamableCommand {
            streamable: true,
            stream_data_type: Some("todo".to_string()),
            emits_progress: Some(true),
            estimated_throughput: None,
        };
        assert!(is_streamable_command(&streamable));

        let not_streamable = serde_json::json!({ "streamable": false });
        assert!(!is_streamable_command(&not_streamable));
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
        assert_eq!(data, vec!["chunk1", "chunk2"]);
    }

    #[test]
    fn test_stream_chunk_wire_round_trip_has_one_discriminator() {
        let chunks = vec![
            StreamChunk::Progress(create_progress_chunk_with_steps(25.0, "Starting", 1, 4)),
            StreamChunk::Data({
                let mut chunk = create_data_chunk(serde_json::json!({"id": 1}), false);
                chunk.sequence = Some(2);
                chunk
            }),
            StreamChunk::Complete(create_complete_chunk(
                serde_json::json!({"done": true}),
                Some(42),
            )),
            StreamChunk::Error(create_error_chunk(CommandError::internal("failed"), true)),
        ];

        for chunk in chunks {
            let json = serde_json::to_value(&chunk).expect("chunk should serialize");
            let original = json.clone();
            assert_eq!(
                json.get("type").and_then(|value| value.as_str()),
                Some(match &chunk {
                    StreamChunk::Progress(_) => "progress",
                    StreamChunk::Data(_) => "data",
                    StreamChunk::Complete(_) => "complete",
                    StreamChunk::Error(_) => "error",
                })
            );
            assert_eq!(
                json.as_object()
                    .unwrap()
                    .keys()
                    .filter(|key| *key == "type")
                    .count(),
                1
            );
            let expected_type = json
                .get("type")
                .and_then(|value| value.as_str())
                .map(str::to_owned);

            let decoded: StreamChunk<serde_json::Value> =
                serde_json::from_value(json).expect("chunk should deserialize");
            let reencoded = serde_json::to_value(decoded).expect("decoded chunk should serialize");
            assert_eq!(reencoded, original);
            assert_eq!(
                reencoded.get("type").and_then(|value| value.as_str()),
                expected_type.as_deref()
            );
        }
    }

    #[tokio::test]
    async fn test_consume_stream_returns_complete_chunk() {
        let progress_seen = Arc::new(Mutex::new(0usize));
        let data_seen = Arc::new(Mutex::new(0usize));

        let callbacks = StreamCallbacks {
            on_progress: {
                let progress_seen = Arc::clone(&progress_seen);
                Some(Box::new(move |_| {
                    *progress_seen.lock().unwrap() += 1;
                }))
            },
            on_data: {
                let data_seen = Arc::clone(&data_seen);
                Some(Box::new(move |_| {
                    *data_seen.lock().unwrap() += 1;
                }))
            },
            on_complete: None,
            on_error: None,
        };

        let chunks = vec![
            StreamChunk::Progress(create_progress_chunk(10.0, "Starting")),
            StreamChunk::Data(create_data_chunk("partial".to_string(), false)),
            StreamChunk::Complete(create_complete_chunk("done".to_string(), Some(50))),
        ];

        let result = consume_stream(chunks, &callbacks)
            .await
            .expect("stream should complete");
        assert_eq!(result.data, "done");
        assert_eq!(*progress_seen.lock().unwrap(), 1);
        assert_eq!(*data_seen.lock().unwrap(), 1);
    }

    #[test]
    fn test_timeout_controller() {
        let controller = create_timeout_controller(5);
        assert!(!controller.is_expired());
        assert!(controller.remaining().is_some());

        thread::sleep(Duration::from_millis(10));

        assert!(controller.is_expired());
        assert!(controller.remaining().is_none());
    }
}
