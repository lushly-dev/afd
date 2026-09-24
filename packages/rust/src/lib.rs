//! # AFD - Agent-First Development Core Library
//!
//! Core types and utilities for Agent-First Development in Rust.
//!
//! This crate provides the foundational types used across AFD applications:
//!
//! - **[`CommandResult`]**: Standard result type with UX-enabling fields
//! - **[`CommandError`]**: Actionable error structure
//! - **[`CommandDefinition`]**: Full command schema with handler
//! - **[`BatchResult`]**: Batch execution with aggregated confidence
//! - **[`StreamChunk`]**: Streaming results with progress feedback
//!
//! ## Quick Start
//!
//! ```rust
//! use afd::{success, failure, CommandError};
//!
//! // Return a successful result
//! fn get_user() -> afd::CommandResult<String> {
//!     success("user_123".to_string())
//! }
//!
//! // Return a failure with actionable error
//! fn create_user() -> afd::CommandResult<String> {
//!     failure(CommandError::validation(
//!         "Email already exists",
//!         Some("Use a different email address")
//!     ))
//! }
//! ```
//!
//! ## Wire format
//!
//! The serde representations match the TypeScript and Python implementations.
//! `tests/wire_fixtures.rs` round-trips the golden fixtures in `spec/wire/`.
//!
//! ## Features
//!
//! - `native` (default): command, batch and pipeline deadlines through
//!   `tokio::time::timeout` (Tokio's `time` feature only; the application
//!   provides the runtime)
//! - `wasm`: browser WebAssembly (`wasm32-unknown-unknown`), measuring
//!   durations with `web-time`

/// Compiles and runs the README examples as doctests.
#[doc = include_str!("../README.md")]
#[cfg(doctest)]
pub struct ReadmeDoctests;

// Module declarations
pub mod batch;
pub mod bootstrap;
pub mod commands;
pub mod connectors;
pub mod errors;
pub mod handoff;
pub mod mcp;
pub mod metadata;
pub mod pipeline;
pub mod result;
pub mod similarity;
pub mod streaming;
pub mod telemetry;
mod validation;
mod wire;

/// A monotonic `Instant` for every supported target.
///
/// `std::time::Instant::now()` traps on `wasm32-unknown-unknown`, so the
/// `wasm` feature switches to `web-time`, which reads `performance.now()`
/// there and is `std::time::Instant` everywhere else.
mod time {
    #[cfg(not(feature = "wasm"))]
    pub(crate) use std::time::Instant;
    #[cfg(feature = "wasm")]
    pub(crate) use web_time::Instant;
}

// ═══════════════════════════════════════════════════════════════════════════════
// RE-EXPORTS: Result types
// ═══════════════════════════════════════════════════════════════════════════════

pub use result::{
    error, failure, failure_with, is_failure, is_success, success, success_with, CommandResult,
    FailureOptions, ResultMetadata, ResultOptions,
};

// ═══════════════════════════════════════════════════════════════════════════════
// RE-EXPORTS: Error types
// ═══════════════════════════════════════════════════════════════════════════════

pub use errors::{
    create_error, error_codes, internal_error, is_command_error, not_found_error, rate_limit_error,
    timeout_error, validation_error, wrap_error, CommandError, ErrorCode,
};

// ═══════════════════════════════════════════════════════════════════════════════
// RE-EXPORTS: Metadata types
// ═══════════════════════════════════════════════════════════════════════════════

pub use metadata::{
    create_source, create_step, create_warning, update_step_status, Alternative, PlanStep,
    PlanStepError, PlanStepStatus, Source, SourceType, Warning, WarningSeverity,
};

// ═══════════════════════════════════════════════════════════════════════════════
// RE-EXPORTS: Command types
// ═══════════════════════════════════════════════════════════════════════════════

pub use commands::{
    command_to_mcp_tool, create_command_registry, default_expose, is_exposed_to,
    validate_command_name, BoxFuture, CommandContext, CommandDefinition, CommandExample,
    CommandHandler, CommandInterface, CommandMiddleware, CommandParameter, CommandRegistry,
    ExecutionTime, ExposeOptions, JsonSchema, JsonSchemaType, McpInputSchema, McpTool,
    MiddlewareNext,
};

// ═══════════════════════════════════════════════════════════════════════════════
// RE-EXPORTS: Connector types
// ═══════════════════════════════════════════════════════════════════════════════

pub use connectors::{
    GitHubConnectorOptions, Issue, IssueCreateOptions, IssueFilters, PackageManager,
    PackageManagerConnectorOptions, PrCreateOptions, PullRequest,
};

// ═══════════════════════════════════════════════════════════════════════════════
// RE-EXPORTS: MCP types
// ═══════════════════════════════════════════════════════════════════════════════

pub use mcp::{
    audio_content, create_mcp_error_response, create_mcp_null_id_error_response,
    create_mcp_request, create_mcp_response, is_mcp_notification, is_mcp_request, is_mcp_response,
    resource_link_content, text_content, McpAudioContent, McpClientCapabilities, McpContent,
    McpError, McpErrorCode, McpErrorCodes, McpId, McpImageContent, McpInitializeParams,
    McpInitializeResult, McpNotification, McpRequest, McpResourceContent, McpResourceLinkContent,
    McpResponse, McpServerCapabilities, McpTextContent, McpToolCallParams, McpToolCallResult,
    McpToolsListResult,
};

// ═══════════════════════════════════════════════════════════════════════════════
// RE-EXPORTS: Batch types
// ═══════════════════════════════════════════════════════════════════════════════

pub use batch::{
    calculate_batch_confidence, create_batch_request, create_batch_result,
    create_failed_batch_result, is_batch_command, is_batch_request, is_batch_result, BatchCommand,
    BatchCommandResult, BatchOptions, BatchRequest, BatchResult, BatchSummary, BatchTiming,
    BatchWarning,
};

// ═══════════════════════════════════════════════════════════════════════════════
// RE-EXPORTS: Streaming types
// ═══════════════════════════════════════════════════════════════════════════════

pub use streaming::{
    collect_stream_data, consume_stream, create_complete_chunk, create_data_chunk,
    create_error_chunk, create_progress_chunk, create_progress_chunk_with_steps,
    create_timeout_controller, is_complete_chunk, is_data_chunk, is_error_chunk, is_progress_chunk,
    is_stream_chunk, is_streamable_command, CompleteChunk, DataChunk, ErrorChunk, ProgressChunk,
    StreamCallbacks, StreamChunk, StreamOptions, StreamableCommand, TimeoutController,
};

// ═══════════════════════════════════════════════════════════════════════════════
// RE-EXPORTS: Pipeline types
// ═══════════════════════════════════════════════════════════════════════════════

pub use pipeline::{
    aggregate_pipeline_alternatives, aggregate_pipeline_confidence, aggregate_pipeline_reasoning,
    aggregate_pipeline_sources, aggregate_pipeline_warnings, build_confidence_breakdown,
    create_pipeline, evaluate_condition, execute_pipeline, get_nested_value, is_and_condition,
    is_eq_condition, is_exists_condition, is_gt_condition, is_gte_condition, is_lt_condition,
    is_lte_condition, is_ne_condition, is_not_condition, is_or_condition, is_pipeline_condition,
    is_pipeline_request, is_pipeline_result, is_pipeline_step, resolve_reference, resolve_variable,
    resolve_variables, CommandExecutor, PipelineAlternative, PipelineCondition,
    PipelineConditionAnd, PipelineConditionEq, PipelineConditionExists, PipelineConditionGt,
    PipelineConditionGte, PipelineConditionLt, PipelineConditionLte, PipelineConditionNe,
    PipelineConditionNot, PipelineConditionOr, PipelineContext, PipelineMetadata, PipelineOptions,
    PipelineRequest, PipelineResult, PipelineSource, PipelineStep, PipelineWarning, StepConfidence,
    StepMetadata, StepReasoning, StepResult, StepStatus, MAX_INPUT_DEPTH, MAX_REFERENCE_LENGTH,
};

// ═══════════════════════════════════════════════════════════════════════════════
// RE-EXPORTS: Bootstrap types
// ═══════════════════════════════════════════════════════════════════════════════

pub use bootstrap::{
    get_bootstrap_commands, register_bootstrap_commands, AfdDocsHandler, AfdHelpHandler,
    AfdSchemaHandler, CommandInfo, DocsInput, DocsOutput, HelpInput, HelpOutput, SchemaFormat,
    SchemaInfo, SchemaInput, SchemaOutput, BOOTSTRAP_CATEGORY, BOOTSTRAP_COMMAND_NAMES,
    BOOTSTRAP_TAGS,
};

// ═══════════════════════════════════════════════════════════════════════════════
// RE-EXPORTS: Handoff types
// ═══════════════════════════════════════════════════════════════════════════════

pub use handoff::{
    create_handoff, default_reconnect_policy, get_handoff_protocol, get_handoff_ttl, is_handoff,
    is_handoff_command, is_handoff_expired, is_handoff_protocol, is_reconnect_policy,
    CreateHandoffOptions, HandoffCommandLike, HandoffCredentials, HandoffMetadata, HandoffProtocol,
    HandoffResult, ReconnectPolicy,
};

// ═══════════════════════════════════════════════════════════════════════════════
// RE-EXPORTS: Telemetry types
// ═══════════════════════════════════════════════════════════════════════════════

pub use telemetry::{create_telemetry_event, is_telemetry_event, TelemetryEvent, TelemetrySink};

// ═══════════════════════════════════════════════════════════════════════════════
// RE-EXPORTS: Similarity helpers
// ═══════════════════════════════════════════════════════════════════════════════

pub use similarity::{calculate_similarity, find_similar_tools};

/// Crate version.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Check if the crate was compiled with native (tokio) support.
pub const fn is_native() -> bool {
    cfg!(feature = "native")
}

/// Check if the crate was compiled for WebAssembly.
pub const fn is_wasm() -> bool {
    cfg!(feature = "wasm")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_version() {
        assert!(!VERSION.is_empty());
    }

    #[test]
    fn test_success_result() {
        let result = success(42);
        assert!(result.success);
        assert_eq!(result.data, Some(42));
        assert!(result.error.is_none());
    }

    #[test]
    fn test_failure_result() {
        let error = CommandError::not_found("Item", "123");
        let result: CommandResult<()> = failure(error);
        assert!(!result.success);
        assert!(result.error.is_some());
        assert_eq!(result.error.as_ref().unwrap().code, "NOT_FOUND");
    }

    #[test]
    fn test_type_guards() {
        let success_result = success("ok".to_string());
        assert!(is_success(&success_result));
        assert!(!is_failure(&success_result));

        let error = CommandError::validation("bad input", None);
        let failure_result: CommandResult<String> = failure(error);
        assert!(!is_success(&failure_result));
        assert!(is_failure(&failure_result));
    }

    #[test]
    fn test_json_serialization() {
        let result = success(serde_json::json!({"name": "test"}));
        let json = serde_json::to_string(&result).unwrap();

        // Verify camelCase serialization
        assert!(json.contains("\"success\":true"));
    }

    #[test]
    fn test_error_codes() {
        assert_eq!(error_codes::NOT_FOUND, "NOT_FOUND");
        assert_eq!(error_codes::VALIDATION_ERROR, "VALIDATION_ERROR");
        assert_eq!(error_codes::TIMEOUT, "TIMEOUT");
    }

    #[test]
    fn test_metadata_types() {
        let source = Source::new(SourceType::Api).with_title("Test");
        assert_eq!(source.source_type, "api");

        let step = PlanStep::new("first", "fetch");
        assert_eq!(step.id, "first");
        assert_eq!(step.status, PlanStepStatus::Pending);

        let warning = Warning::new("DEPRECATION", "This is deprecated");
        assert_eq!(warning.code, "DEPRECATION");
    }

    #[test]
    fn test_streaming_types() {
        let progress = create_progress_chunk(0.5, "Halfway done");
        assert_eq!(progress.progress, 0.5);

        let data = create_data_chunk("partial", 0, false);
        assert!(!data.is_last);
    }

    #[test]
    fn test_feature_detection() {
        // At least one should be true in test builds
        let _native = is_native();
        let _wasm = is_wasm();
    }
}
