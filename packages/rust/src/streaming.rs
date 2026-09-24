//! Streaming types for progressive command results.
//!
//! Streaming allows commands to report progress and partial data
//! before the final result is ready. The chunk shapes match
//! `packages/core/src/streaming.ts` and `spec/wire/stream-chunks.json`: every
//! chunk carries a `type` discriminator (`progress`, `data`, `complete` or
//! `error`).

use serde::{de::Deserializer, ser::Serializer, Deserialize, Serialize};
use std::time::Duration;

use crate::errors::CommandError;
use crate::result::ResultMetadata;
use crate::time::Instant;

// ═══════════════════════════════════════════════════════════════════════════════
// STREAM CHUNK TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/// Progress update during command execution.
///
/// Serializes with `"type": "progress"`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename = "progress", rename_all = "camelCase")]
#[non_exhaustive]
pub struct ProgressChunk {
    /// Progress fraction (0-1).
    #[serde(serialize_with = "crate::wire::number")]
    pub progress: f64,

    /// Human-readable status message.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,

    /// Current step number when tracking a multi-step workflow.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_step: Option<u32>,

    /// Total number of steps when tracking a multi-step workflow.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total_steps: Option<u32>,

    /// Number of items processed so far.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub items_processed: Option<u64>,

    /// Total number of items to process.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub items_total: Option<u64>,

    /// Estimated time remaining in milliseconds.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "crate::wire::opt_number"
    )]
    pub estimated_time_remaining_ms: Option<f64>,

    /// Current phase or stage of the operation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phase: Option<String>,
}

impl ProgressChunk {
    /// Set the estimated time remaining in milliseconds.
    pub fn with_estimated_time_remaining_ms(mut self, remaining_ms: f64) -> Self {
        self.estimated_time_remaining_ms = Some(remaining_ms);
        self
    }

    /// Set item counts.
    pub fn with_items(mut self, processed: u64, total: u64) -> Self {
        self.items_processed = Some(processed);
        self.items_total = Some(total);
        self
    }

    /// Set the current phase.
    pub fn with_phase(mut self, phase: impl Into<String>) -> Self {
        self.phase = Some(phase.into());
        self
    }
}

/// Partial data emitted during streaming.
///
/// Serializes with `"type": "data"`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename = "data", rename_all = "camelCase")]
#[non_exhaustive]
pub struct DataChunk<T = serde_json::Value> {
    /// The data payload for this chunk.
    pub data: T,

    /// Index of this chunk in the sequence (0-based).
    pub index: usize,

    /// Whether this is the last data chunk.
    pub is_last: bool,

    /// Optional chunk ID for deduplication.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chunk_id: Option<String>,
}

impl<T> DataChunk<T> {
    /// Set the chunk ID.
    pub fn with_chunk_id(mut self, chunk_id: impl Into<String>) -> Self {
        self.chunk_id = Some(chunk_id.into());
        self
    }
}

/// Completion signal for a stream.
///
/// Serializes with `"type": "complete"`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(
    tag = "type",
    rename = "complete",
    rename_all = "camelCase",
    bound(deserialize = "T: Deserialize<'de>")
)]
#[non_exhaustive]
pub struct CompleteChunk<T = serde_json::Value> {
    /// Total number of data chunks emitted.
    pub total_chunks: usize,

    /// Total duration of the stream in milliseconds.
    #[serde(serialize_with = "crate::wire::number")]
    pub total_duration_ms: f64,

    /// Final result data (summary or complete result).
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::wire::present"
    )]
    pub data: Option<T>,

    /// Human-readable summary of what was accomplished.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<String>,

    /// Confidence in the overall result (0-1).
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "crate::wire::opt_number"
    )]
    pub confidence: Option<f64>,

    /// Execution metadata.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<ResultMetadata>,
}

impl<T> CompleteChunk<T> {
    /// Set the final data.
    pub fn with_data(mut self, data: T) -> Self {
        self.data = Some(data);
        self
    }

    /// Set the reasoning.
    pub fn with_reasoning(mut self, reasoning: impl Into<String>) -> Self {
        self.reasoning = Some(reasoning.into());
        self
    }

    /// Set the confidence.
    pub fn with_confidence(mut self, confidence: f64) -> Self {
        self.confidence = Some(confidence);
        self
    }

    /// Set the metadata.
    pub fn with_metadata(mut self, metadata: ResultMetadata) -> Self {
        self.metadata = Some(metadata);
        self
    }
}

/// Error signal for a stream.
///
/// Serializes with `"type": "error"`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename = "error", rename_all = "camelCase")]
#[non_exhaustive]
pub struct ErrorChunk {
    /// The error that occurred.
    pub error: CommandError,

    /// Number of chunks successfully emitted before the error.
    pub chunks_before_error: usize,

    /// Whether the stream can be resumed or retried.
    pub recoverable: bool,

    /// If recoverable, the position to resume from.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resume_from: Option<usize>,
}

impl ErrorChunk {
    /// Set the resume position.
    pub fn with_resume_from(mut self, resume_from: usize) -> Self {
        self.resume_from = Some(resume_from);
        self
    }
}

/// A chunk from a streaming command, discriminated by its `type` field.
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
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

impl<T> From<ProgressChunk> for StreamChunk<T> {
    fn from(chunk: ProgressChunk) -> Self {
        Self::Progress(chunk)
    }
}

impl<T> From<DataChunk<T>> for StreamChunk<T> {
    fn from(chunk: DataChunk<T>) -> Self {
        Self::Data(chunk)
    }
}

impl<T> From<CompleteChunk<T>> for StreamChunk<T> {
    fn from(chunk: CompleteChunk<T>) -> Self {
        Self::Complete(chunk)
    }
}

impl<T> From<ErrorChunk> for StreamChunk<T> {
    fn from(chunk: ErrorChunk) -> Self {
        Self::Error(chunk)
    }
}

/// Each chunk struct writes its own `type` tag, so the union serializes the
/// inner chunk as is.
impl<T: Serialize> Serialize for StreamChunk<T> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match self {
            Self::Progress(chunk) => chunk.serialize(serializer),
            Self::Data(chunk) => chunk.serialize(serializer),
            Self::Complete(chunk) => chunk.serialize(serializer),
            Self::Error(chunk) => chunk.serialize(serializer),
        }
    }
}

#[derive(Deserialize)]
#[serde(
    tag = "type",
    rename_all = "lowercase",
    bound(deserialize = "T: Deserialize<'de>")
)]
enum StreamChunkWire<T> {
    Progress(ProgressChunk),
    Data(DataChunk<T>),
    Complete(CompleteChunk<T>),
    Error(ErrorChunk),
}

impl<'de, T: Deserialize<'de>> Deserialize<'de> for StreamChunk<T> {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Ok(match StreamChunkWire::deserialize(deserializer)? {
            StreamChunkWire::Progress(chunk) => Self::Progress(chunk),
            StreamChunkWire::Data(chunk) => Self::Data(chunk),
            StreamChunkWire::Complete(chunk) => Self::Complete(chunk),
            StreamChunkWire::Error(chunk) => Self::Error(chunk),
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

/// Create a progress chunk. `progress` is a fraction, clamped to 0-1.
pub fn create_progress_chunk(progress: f64, message: &str) -> ProgressChunk {
    ProgressChunk {
        progress: progress.clamp(0.0, 1.0),
        message: Some(message.to_string()),
        current_step: None,
        total_steps: None,
        items_processed: None,
        items_total: None,
        estimated_time_remaining_ms: None,
        phase: None,
    }
}

/// Create a progress chunk with step info. `progress` is clamped to 0-1.
pub fn create_progress_chunk_with_steps(
    progress: f64,
    message: &str,
    current_step: u32,
    total_steps: u32,
) -> ProgressChunk {
    ProgressChunk {
        current_step: Some(current_step),
        total_steps: Some(total_steps),
        ..create_progress_chunk(progress, message)
    }
}

/// Create a data chunk.
pub fn create_data_chunk<T>(data: T, index: usize, is_last: bool) -> DataChunk<T> {
    DataChunk {
        data,
        index,
        is_last,
        chunk_id: None,
    }
}

/// Create a completion chunk. Add data, reasoning and confidence with the
/// `with_*` builders.
pub fn create_complete_chunk<T>(total_chunks: usize, total_duration_ms: f64) -> CompleteChunk<T> {
    CompleteChunk {
        total_chunks,
        total_duration_ms,
        data: None,
        reasoning: None,
        confidence: None,
        metadata: None,
    }
}

/// Create an error chunk.
pub fn create_error_chunk(
    error: CommandError,
    chunks_before_error: usize,
    recoverable: bool,
) -> ErrorChunk {
    ErrorChunk {
        error,
        chunks_before_error,
        recoverable,
        resume_from: None,
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TYPE GUARDS
// ═══════════════════════════════════════════════════════════════════════════════

fn chunk_type<T: Serialize>(value: &T) -> Option<serde_json::Value> {
    serde_json::to_value(value).ok()
}

fn has_type(json: &serde_json::Value, expected: &str) -> bool {
    json.get("type").and_then(serde_json::Value::as_str) == Some(expected)
}

/// Check if a value is a ProgressChunk.
pub fn is_progress_chunk<T: Serialize>(value: &T) -> bool {
    chunk_type(value)
        .is_some_and(|json| has_type(&json, "progress") && json.get("progress").is_some())
}

/// Check if a value is a DataChunk.
pub fn is_data_chunk<T: Serialize>(value: &T) -> bool {
    chunk_type(value).is_some_and(|json| has_type(&json, "data") && json.get("data").is_some())
}

/// Check if a value is a CompleteChunk.
pub fn is_complete_chunk<T: Serialize>(value: &T) -> bool {
    chunk_type(value)
        .is_some_and(|json| has_type(&json, "complete") && json.get("totalChunks").is_some())
}

/// Check if a value is an ErrorChunk.
pub fn is_error_chunk<T: Serialize>(value: &T) -> bool {
    chunk_type(value).is_some_and(|json| has_type(&json, "error") && json.get("error").is_some())
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
// `ErrorChunk` is the public stream wire type; boxing it would change this public signature.
#[allow(clippy::result_large_err)]
pub async fn consume_stream<T, I>(
    stream: I,
    callbacks: &StreamCallbacks<T>,
) -> Result<CompleteChunk<T>, ErrorChunk>
where
    I: IntoIterator<Item = StreamChunk<T>>,
{
    let mut chunks_seen = 0usize;
    for chunk in stream {
        match chunk {
            StreamChunk::Progress(progress) => {
                if let Some(callback) = &callbacks.on_progress {
                    callback(&progress);
                }
            }
            StreamChunk::Data(data) => {
                chunks_seen += 1;
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
        chunks_seen,
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
        let chunk = create_progress_chunk(0.5, "Processing...");
        assert_eq!(chunk.progress, 0.5);
        assert_eq!(chunk.message.as_deref(), Some("Processing..."));
    }

    #[test]
    fn test_progress_chunk_clamping() {
        let chunk = create_progress_chunk(1.5, "Test");
        assert_eq!(chunk.progress, 1.0);

        let chunk = create_progress_chunk(-10.0, "Test");
        assert_eq!(chunk.progress, 0.0);
    }

    #[test]
    fn test_data_chunk() {
        let chunk = create_data_chunk("partial data", 0, false);
        assert_eq!(chunk.data, "partial data");
        assert!(!chunk.is_last);
    }

    #[test]
    fn test_complete_chunk() {
        let chunk = create_complete_chunk(3, 1500.0).with_data("final result");
        assert_eq!(chunk.data, Some("final result"));
        assert_eq!(chunk.total_chunks, 3);
        assert_eq!(chunk.total_duration_ms, 1500.0);
    }

    #[test]
    fn test_error_chunk() {
        let error = CommandError::timeout("test", 5000);
        let chunk = create_error_chunk(error.clone(), 2, true);
        assert!(chunk.recoverable);
        assert_eq!(chunk.chunks_before_error, 2);
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
        let progress = create_progress_chunk(0.5, "Test");
        assert!(is_progress_chunk(&progress));

        let data = create_data_chunk("test", 0, false);
        assert!(is_data_chunk(&data));

        let complete = create_complete_chunk::<String>(0, 0.0);
        assert!(is_complete_chunk(&complete));

        let error = create_error_chunk(CommandError::internal("test"), 0, false);
        assert!(is_error_chunk(&error));

        let wrapped: StreamChunk<String> = StreamChunk::from(progress);
        assert!(is_stream_chunk(&wrapped));
        assert!(!is_data_chunk(&wrapped));
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
            create_progress_chunk(0.25, "Starting").into(),
            create_data_chunk("chunk1".to_string(), 0, false).into(),
            create_progress_chunk(0.75, "Almost done").into(),
            create_data_chunk("chunk2".to_string(), 1, true).into(),
            create_complete_chunk(2, 100.0).into(),
        ];

        let data = collect_stream_data(&chunks);
        assert_eq!(data, vec!["chunk1", "chunk2"]);
    }

    #[test]
    fn test_stream_chunk_wire_round_trip_has_one_discriminator() {
        let chunks: Vec<StreamChunk> = vec![
            create_progress_chunk_with_steps(0.25, "Starting", 1, 4).into(),
            create_data_chunk(serde_json::json!({"id": 1}), 2, false)
                .with_chunk_id("chunk-2")
                .into(),
            create_complete_chunk(3, 42.0)
                .with_data(serde_json::json!({"done": true}))
                .into(),
            create_error_chunk(CommandError::internal("failed"), 3, true).into(),
        ];

        for chunk in chunks {
            let json = serde_json::to_value(&chunk).expect("chunk should serialize");
            assert_eq!(
                json.get("type").and_then(|value| value.as_str()),
                Some(match &chunk {
                    StreamChunk::Progress(_) => "progress",
                    StreamChunk::Data(_) => "data",
                    StreamChunk::Complete(_) => "complete",
                    StreamChunk::Error(_) => "error",
                })
            );

            let decoded: StreamChunk<serde_json::Value> =
                serde_json::from_value(json.clone()).expect("chunk should deserialize");
            assert_eq!(decoded, chunk);
            let reencoded = serde_json::to_value(decoded).expect("decoded chunk should serialize");
            assert_eq!(reencoded, json);
        }
    }

    #[test]
    fn test_stream_chunk_rejects_unknown_type() {
        let result: Result<StreamChunk, _> =
            serde_json::from_value(serde_json::json!({"type": "bogus", "progress": 1}));
        assert!(result.is_err());
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

        let chunks: Vec<StreamChunk<String>> = vec![
            create_progress_chunk(0.1, "Starting").into(),
            create_data_chunk("partial".to_string(), 0, true).into(),
            create_complete_chunk(1, 50.0)
                .with_data("done".to_string())
                .into(),
        ];

        let result = consume_stream(chunks, &callbacks)
            .await
            .expect("stream should complete");
        assert_eq!(result.data.as_deref(), Some("done"));
        assert_eq!(*progress_seen.lock().unwrap(), 1);
        assert_eq!(*data_seen.lock().unwrap(), 1);
    }

    #[tokio::test]
    async fn test_consume_stream_without_terminal_chunk_reports_chunks_seen() {
        let chunks: Vec<StreamChunk<String>> =
            vec![create_data_chunk("partial".to_string(), 0, false).into()];
        let error = consume_stream(chunks, &StreamCallbacks::default())
            .await
            .expect_err("stream should fail");
        assert_eq!(error.error.code, "STREAM_ENDED_UNEXPECTEDLY");
        assert_eq!(error.chunks_before_error, 1);
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
