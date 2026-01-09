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
//! ## Features
//!
//! - `native` (default): Includes async runtime support via tokio
//! - `wasm`: Enables WebAssembly compatibility via wasm-bindgen

// Module declarations
pub mod batch;
pub mod commands;
pub mod errors;
pub mod metadata;
pub mod pipeline;
pub mod result;
pub mod streaming;

// ═══════════════════════════════════════════════════════════════════════════════
// RE-EXPORTS: Result types
// ═══════════════════════════════════════════════════════════════════════════════

pub use result::{
    failure, failure_with, is_failure, is_success, success, success_with, CommandResult,
    FailureOptions, ResultMetadata, ResultOptions,
};

// ═══════════════════════════════════════════════════════════════════════════════
// RE-EXPORTS: Error types
// ═══════════════════════════════════════════════════════════════════════════════

pub use errors::{
    create_error, error_codes, internal_error, is_command_error, not_found_error, rate_limit_error,
    timeout_error, validation_error, CommandError,
};

// ═══════════════════════════════════════════════════════════════════════════════
// RE-EXPORTS: Metadata types
// ═══════════════════════════════════════════════════════════════════════════════

pub use metadata::{
    create_source, create_step, create_warning, update_step_status, Alternative, PlanStep,
    PlanStepStatus, Source, SourceType, Warning, WarningSeverity,
};

// ═══════════════════════════════════════════════════════════════════════════════
// RE-EXPORTS: Command types
// ═══════════════════════════════════════════════════════════════════════════════

pub use commands::{
    command_to_mcp_tool, create_command_registry, CommandContext, CommandDefinition,
    CommandHandler, CommandParameter, CommandRegistry, ExecutionTime, JsonSchema, JsonSchemaType,
    McpInputSchema, McpTool,
};

// ═══════════════════════════════════════════════════════════════════════════════
// RE-EXPORTS: Batch types
// ═══════════════════════════════════════════════════════════════════════════════

pub use batch::{
    calculate_batch_confidence, create_batch_request, create_batch_result,
    create_failed_batch_result, is_batch_command, is_batch_request, is_batch_result, BatchCommand,
    BatchCommandResult, BatchOptions, BatchRequest, BatchResult, BatchSummary, BatchTiming,
};

// ═══════════════════════════════════════════════════════════════════════════════
// RE-EXPORTS: Streaming types
// ═══════════════════════════════════════════════════════════════════════════════

pub use streaming::{
    collect_stream_data, create_complete_chunk, create_data_chunk, create_error_chunk,
    create_progress_chunk, create_progress_chunk_with_steps, is_complete_chunk, is_data_chunk,
    is_error_chunk, is_progress_chunk, is_stream_chunk, CompleteChunk, DataChunk, ErrorChunk,
    ProgressChunk, StreamCallbacks, StreamChunk, StreamOptions,
};

// ═══════════════════════════════════════════════════════════════════════════════
// RE-EXPORTS: Pipeline types
// ═══════════════════════════════════════════════════════════════════════════════

pub use pipeline::{
    aggregate_pipeline_alternatives, aggregate_pipeline_confidence, aggregate_pipeline_reasoning,
    aggregate_pipeline_sources, aggregate_pipeline_warnings, build_confidence_breakdown,
    create_pipeline, evaluate_condition, get_nested_value, is_pipeline_request, is_pipeline_result,
    is_pipeline_step, resolve_variable, resolve_variables, PipelineAlternative, PipelineCondition,
    PipelineContext, PipelineMetadata, PipelineOptions, PipelineRequest, PipelineResult,
    PipelineSource, PipelineStep, PipelineWarning, StepConfidence, StepMetadata, StepReasoning,
    StepResult, StepStatus,
};

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
        let source = Source::new("Test", SourceType::Api);
        assert_eq!(source.name, "Test");

        let step = PlanStep::new(1, "First step");
        assert_eq!(step.step, 1);

        let warning = Warning::new("DEPRECATION", "This is deprecated");
        assert_eq!(warning.code, "DEPRECATION");
    }

    #[test]
    fn test_streaming_types() {
        let progress = create_progress_chunk(50.0, "Halfway done");
        assert_eq!(progress.progress, 50.0);

        let data = create_data_chunk("partial", false);
        assert!(!data.is_final);
    }

    #[test]
    fn test_feature_detection() {
        // At least one should be true in test builds
        let _native = is_native();
        let _wasm = is_wasm();
    }
}
