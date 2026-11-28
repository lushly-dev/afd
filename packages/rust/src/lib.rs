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
//!   `tokio::time::timeout`, the retry middleware's default wait through
//!   `tokio::time::sleep`, and with `journal-file` the `AsyncFileJournalSink` on
//!   Tokio's blocking pool (Tokio's `time`, `rt` and `sync` features; the
//!   application provides the runtime)
//! - `wasm`: browser WebAssembly (`wasm32-unknown-unknown`) randomness (`getrandom`'s `wasm_js`
//!   backend) for every call's dispatch id and for `approval`; without it calls on that target
//!   carry no dispatch id. Durations use `web-time` on `wasm32-unknown-unknown` automatically
//!   without this feature
//! - `frontmatter`: [`frontmatter`], the YAML 1.2 core-schema frontmatter reader (`saphyr-parser`);
//!   `server` enables it
//! - `server`: [`server`], the MCP server (`rmcp`) over Streamable HTTP and stdio; needs Rust 1.88
//! - `server-auth`: `server::auth`, OAuth 2.1 resource-server authorization for the MCP server
//!   over HTTP (`spec/authorization.md`): the bearer layer, AFD's JWT verifier (`jsonwebtoken` on
//!   `aws-lc-rs`), protected-resource metadata and scope decisions; implies `server`. A command's
//!   [`scopes`](CommandDefinition::scopes) and [`Credentials`] need no feature
//! - `journal-file` (default): [`FileJournalSink`], a command journal in a
//!   JSON Lines file (`std::fs`)
//! - `journal-file-shared`: `FileJournalSink::shared`, several sinks and processes appending to
//!   one file under an OS file lock (`std::fs::File::lock`; needs Rust 1.89)
//! - `approval` (default): the approval middleware ([`create_approval_middleware`]), with
//!   HMAC-SHA256 tokens and an OS-random nonce (`getrandom`; with `wasm`, through the browser's
//!   `crypto.getRandomValues`, on Rust 1.85 or later), and the approval summary its
//!   `on_approval_accepted` hook is given. Approval policies and their reporting need no feature.

// docs.rs builds with `--cfg docsrs` on nightly, where the `doc(cfg)` badges on
// feature-gated items need the unstable `doc_cfg` feature.
#![cfg_attr(docsrs, feature(doc_cfg))]
#![forbid(unsafe_code)]

/// Compiles and runs the README examples as doctests.
#[doc = include_str!("../README.md")]
#[cfg(doctest)]
pub struct ReadmeDoctests;

// Module declarations
pub mod actor;
pub mod approval;
pub mod approval_display;
pub mod direct;
pub use direct::{DirectApprovalHook, DirectApprovalRequest, DirectClient};
pub mod batch;
pub mod bootstrap;
pub mod builtin_names;
pub mod cancellation;
mod canonical;
pub mod clock;
pub mod commands;
pub mod connectors;
pub mod context_fields;
pub mod contexts;
pub mod credentials;
pub mod errors;
#[cfg(feature = "frontmatter")]
#[cfg_attr(docsrs, doc(cfg(feature = "frontmatter")))]
pub mod frontmatter;
pub mod handoff;
pub mod idempotency;
pub mod journal;
pub mod mcp;
mod meta_keys;
pub mod metadata;
pub mod middleware;
pub mod output_budget;
pub mod pipeline;
pub mod result;
mod schema_legacy;
mod schema_validation;
#[cfg(feature = "server")]
#[cfg_attr(docsrs, doc(cfg(feature = "server")))]
pub mod server;
pub mod similarity;
pub mod stream_executor;
pub mod streaming;
pub mod telemetry;
mod wire;

/// A monotonic `Instant` for every supported target.
///
/// - On native targets with `native`, it is `tokio::time::Instant` even when
///   Cargo also enables the `wasm` feature. Batch and pipeline deadlines
///   are computed with it and enforced with `tokio::time::timeout`, so both
///   read the same clock. Outside a paused Tokio test clock,
///   `tokio::time::Instant::now()` is `std::time::Instant::now()`, so this
///   changes nothing in production. Under `tokio::time::pause()` (as in
///   `tests/batch_controls_vectors.rs`), deadlines and durations follow the
///   paused clock instead of disagreeing with it.
/// - `std::time::Instant::now()` and `std::time::SystemTime::now()` trap on
///   `wasm32-unknown-unknown`, so that target selects `web-time` automatically
///   (`performance.now()` and `Date.now()`), with or without the `wasm` feature.
/// - Otherwise it is `std::time::Instant`.
mod time {
    #[cfg(not(all(target_family = "wasm", target_os = "unknown")))]
    use std::time as platform_time;
    #[cfg(all(target_family = "wasm", target_os = "unknown"))]
    use web_time as platform_time;

    #[cfg(any(
        not(feature = "native"),
        all(target_family = "wasm", target_os = "unknown")
    ))]
    pub(crate) use platform_time::Instant;
    #[cfg(all(
        feature = "native",
        not(all(target_family = "wasm", target_os = "unknown"))
    ))]
    pub(crate) use tokio::time::Instant;

    // `std::time::SystemTime::now()` traps on `wasm32-unknown-unknown` too; `web-time` reads
    // `Date.now()` there.
    pub(crate) use platform_time::SystemTime;
}

// ═══════════════════════════════════════════════════════════════════════════════
// RE-EXPORTS: Result types
// ═══════════════════════════════════════════════════════════════════════════════

pub use result::{
    error, execution_failure, failure, failure_with, is_failure, is_success, success, success_with,
    CommandResult, FailureOptions, ResultMetadata, ResultOptions,
};

// ═══════════════════════════════════════════════════════════════════════════════
// RE-EXPORTS: Error types
// ═══════════════════════════════════════════════════════════════════════════════

pub use errors::{
    create_error, error_codes, internal_error, is_command_error, is_command_recovery,
    not_found_error, rate_limit_error, timeout_error, validation_error, wrap_error, CommandError,
    ErrorCode, ErrorCodeInfo, InvalidRecovery, Recovery, ERROR_CODE_CATALOG,
    HOST_ERROR_CODE_PREFIX, MAX_AFTER_MS, RECOVERY_KINDS,
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
    check_batch_limits, command_result_output_schema, command_to_mcp_tool,
    command_tool_annotations, create_command_registry, default_expose, is_exposed_to,
    validate_command_name, BoxFuture, CallGrant, CommandConfirmationMode, CommandContext,
    CommandDefinition, CommandExample, CommandHandler, CommandInterface, CommandMiddleware,
    CommandParameter, CommandRegistry, ExecutionTime, ExposeOptions, JsonSchema, JsonSchemaType,
    McpInputSchema, McpTool, MiddlewareNext, TaskSupport, DEFAULT_COMMAND_TIMEOUT_MS,
    DEFAULT_MAX_BATCH_PARALLELISM, DEFAULT_MAX_BATCH_SIZE, DEFAULT_MAX_VALIDATION_ISSUES,
};

pub use cancellation::{
    CancellationSignal, CancellationToken, Cancelled, MAX_PROGRESS_MESSAGE_BYTES,
};

pub use canonical::{approval_id, input_digest};
pub use credentials::{
    credentials_binding, is_scope_token, principal_binding, Credentials, IncompleteCredentials,
};
pub use idempotency::{
    check_idempotency_options, derive_idempotency_key, invalid_idempotency_key_error,
    is_idempotency_key, is_idempotency_support, IdempotencyOptions, IdempotencyRecord,
    IdempotencyRecordState, IdempotencyRequestKind, IdempotencyReservation,
    IdempotencyReserveOutcome, IdempotencySettlement, IdempotencyStore, IdempotencySupport,
    InMemoryIdempotencyStore, AFD_IDEMPOTENCY_KEY_META_KEY, DEFAULT_IDEMPOTENCY_LEASE_MS,
    DEFAULT_IDEMPOTENCY_TTL_MS, IDEMPOTENT_REPLAY_KEY,
};
pub use meta_keys::{check_meta_entry, MCP_APPS_META_KEY};
pub use output_budget::{OutputBudget, AFD_OUTPUT_BUDGET_META_KEY, MAX_OUTPUT_BUDGET_BYTES};

pub use contexts::{
    get_context_commands, register_context_commands, ContextConfig, ContextStack,
    AFD_CONTEXT_META_KEY, DEFAULT_CONTEXT_MAX_DEPTH,
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

pub use stream_executor::{execute_stream, StreamExecutorOptions};
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
    create_pipeline, evaluate_condition, execute_pipeline, execute_pipeline_with_cancellation,
    get_nested_value, is_and_condition, is_eq_condition, is_exists_condition, is_gt_condition,
    is_gte_condition, is_lt_condition, is_lte_condition, is_ne_condition, is_not_condition,
    is_or_condition, is_pipeline_condition, is_pipeline_request, is_pipeline_result,
    is_pipeline_step, resolve_reference, resolve_variable, resolve_variables,
    try_resolve_variables, CommandExecutor, PipelineAlternative, PipelineCondition,
    PipelineConditionAnd, PipelineConditionEq, PipelineConditionExists, PipelineConditionGt,
    PipelineConditionGte, PipelineConditionLt, PipelineConditionLte, PipelineConditionNe,
    PipelineConditionNot, PipelineConditionOr, PipelineContext, PipelineMetadata, PipelineOptions,
    PipelineRequest, PipelineResult, PipelineSource, PipelineStep, PipelineWarning, StepConfidence,
    StepMetadata, StepReasoning, StepResult, StepStatus, MAX_INPUT_DEPTH, MAX_REFERENCE_LENGTH,
    MAX_RESOLVED_CHARS, MAX_RESOLVED_NODES,
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
// RE-EXPORTS: Names of the tools an AFD server provides itself
// ═══════════════════════════════════════════════════════════════════════════════

pub use builtin_names::{
    is_afd_builtin_name, AFD_BOOTSTRAP_COMMAND_NAMES, AFD_BUILTIN_TOOL_NAMES,
    AFD_CONTEXT_COMMAND_NAMES, AFD_META_TOOL_NAMES,
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
// RE-EXPORTS: Command journal
// ═══════════════════════════════════════════════════════════════════════════════

#[cfg(all(feature = "native", feature = "journal-file"))]
#[cfg_attr(docsrs, doc(cfg(all(feature = "native", feature = "journal-file"))))]
pub use journal::AsyncFileJournalSink;
#[cfg(feature = "journal-file")]
#[cfg_attr(docsrs, doc(cfg(feature = "journal-file")))]
pub use journal::FileJournalSink;
pub use journal::{
    create_context_digest, is_journal_entry, journal_actor, parse_journal, replay_journal,
    serialize_journal, serialize_journal_entry, JournalContextDigest, JournalEntry, JournalRange,
    JournalRecord, JournalRecorder, JournalRedactInfo, JournalSink, JournalTape, MemoryJournalSink,
    ReplayDifference, ReplayDifferenceKind, ReplayEntryReport, ReplayJournalOptions, ReplayReport,
    ReplayStatus,
};
#[cfg(feature = "journal-file-shared")]
#[cfg_attr(docsrs, doc(cfg(feature = "journal-file-shared")))]
pub use journal::{JournalFileLock, JournalLockError};

// ═══════════════════════════════════════════════════════════════════════════════
// RE-EXPORTS: Approvals
// ═══════════════════════════════════════════════════════════════════════════════

pub use approval::{
    approval_mode, ApprovalDecision, ApprovalMode, ApprovalPolicy, ApprovalPolicyFn,
    ApprovalRejection,
};
#[cfg(feature = "approval")]
#[cfg_attr(docsrs, doc(cfg(feature = "approval")))]
pub use approval::{
    canonical_json, create_approval_middleware, ApprovalMiddlewareOptions, ApprovalNonceStore,
    ApprovalRelay, ApprovalReplay, ApprovalRequest, ApprovalSummary, ApprovalVia,
    OnApprovalAccepted,
};
pub use approval_display::{
    approval_display, hides_characters, is_hidden_code_point, ApprovalDisplay,
    ApprovalDisplayLimits, ApprovalDisplayRefusal, APPROVAL_DISPLAY_LIMITS,
};

// ═══════════════════════════════════════════════════════════════════════════════
// RE-EXPORTS: Context primitives (actor, clock, random)
// ═══════════════════════════════════════════════════════════════════════════════

pub use actor::{
    is_actor, is_actor_kind, with_context_defaults, Actor, ActorKind, ContextDefaults, ACTOR_KINDS,
};
pub use clock::{
    fixed_clock, seeded_random, Clock, ClockInstant, ManualClock, RandomSource, SeededRandom,
    SystemClock, SystemRandom, SYSTEM_CLOCK, SYSTEM_RANDOM,
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

/// The AFD contract version (`spec/VERSION` in the repository) this crate implements.
///
/// The contract covers the wire shapes, the pipeline variables, the behavior vectors and the todo
/// conformance suite that every AFD language shares. Its `MAJOR.MINOR` version is independent of
/// [`VERSION`]: implementations that report the same contract version are meant to agree on
/// everything it covers. It reads `1.0-rc` until every language loads every vector file. `afd-help`
/// reports it as `contractVersion`.
pub const CONTRACT_VERSION: &str = "1.0-rc";

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
