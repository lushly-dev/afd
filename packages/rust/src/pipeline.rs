//! Pipeline types for chaining AFD commands.
//!
//! Pipelines enable declarative composition of commands where the output of one
//! becomes the input of the next. Key features:
//! - Variable resolution (`$prev`, `$first`, `$steps[n]`, `$steps.alias`, `$input`)
//! - Conditional execution with `when` clauses
//! - Trust signal propagation (confidence, reasoning, sources)
//! - Error propagation with actionable suggestions
//!
//! The JSON shapes match `packages/core/src/pipeline.ts` and
//! `spec/wire/pipeline-result.json`.
//!
//! # Variable references
//!
//! Resolution follows `spec/pipeline-variables.md`. A step input string is a
//! reference only when the whole string is one of:
//!
//! | Form | Resolves to |
//! | --- | --- |
//! | `$prev`, `$prev.<path>` | data of the previous successful step |
//! | `$first`, `$first.<path>` | data of the first step |
//! | `$steps[N]`, `$steps[N].<path>` | data of step `N` (0-based) |
//! | `$steps.<alias>`, `$steps.<alias>.<path>` | data of the step whose `as` is `<alias>` |
//! | `$input`, `$input.<path>` | [`PipelineRequest::input`] |
//!
//! A `<path>` is `.`-separated segments; a segment is a key (`user`) with at
//! most one index suffix (`items[2]`). Keys contain any characters except `.`,
//! `[`, `]` and whitespace. A purely numeric segment (`items.2`) is an own-key
//! lookup on an object and an index on an array.
//!
//! - Any other string starting with `$` (`$9.99`, `$HOME`, `$prevx`,
//!   `$prev.a b`, `$steps[0][1]`) is a literal and passes through unchanged.
//!   A string starting with `$$` is a literal with one `$` removed (`"$$prev"`
//!   becomes `"$prev"`), at any length. Would-be references longer than
//!   [`MAX_REFERENCE_LENGTH`] characters are literals.
//! - Traversal reads only own keys of JSON objects and in-bounds array
//!   indices; a segment or alias starting with `__` never resolves.
//! - An unresolved reference is absent: it is omitted from objects and becomes
//!   `null` in arrays. In `when` conditions `$exists` is `false` (also for
//!   `null`), comparisons with absent operands are `false`, and `$eq`/`$ne`
//!   compare JSON values structurally.
//! - [`execute_pipeline`] rejects step inputs and the request `input` nested
//!   deeper than [`MAX_INPUT_DEPTH`] levels (the outermost object or array is
//!   level 1) with `VALIDATION_ERROR` before any step runs.
//! - Options that are accepted but not implemented, `options.parallel` and a
//!   step's `stream: true`, fail that step (step 0 for `parallel`) with
//!   `UNSUPPORTED_OPTION` and skip every other step, so no command runs.

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::future::Future;
use std::panic::AssertUnwindSafe;
use std::pin::Pin;
use std::sync::{Arc, OnceLock};

use crate::commands::{deadline_after, elapsed_ms};
use crate::errors::CommandError;
use crate::metadata::{Alternative, Source, Warning, WarningSeverity};
use crate::result::CommandResult;
use crate::time::Instant;

/// Step inputs nested deeper than this many levels are rejected before any step runs.
pub const MAX_INPUT_DEPTH: usize = 64;

/// Reference strings longer than this many characters are literals.
pub const MAX_REFERENCE_LENGTH: usize = 1024;

// ═══════════════════════════════════════════════════════════════════════════════
// PIPELINE REQUEST TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/// Request to execute a pipeline of chained commands.
///
/// # Example
///
/// ```rust
/// use afd::pipeline::{PipelineRequest, PipelineStep};
///
/// let request = PipelineRequest::new(vec![
///     PipelineStep::new("user-get")
///         .with_input(serde_json::json!({"id": "$input.userId"}))
///         .with_alias("user"),
///     PipelineStep::new("order-list").with_input(serde_json::json!({"userId": "$prev.id"})),
/// ])
/// .with_id("my-pipeline")
/// .with_input(serde_json::json!({"userId": 123}));
///
/// assert_eq!(request.steps.len(), 2);
/// ```
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct PipelineRequest {
    /// Unique identifier for the pipeline execution.
    /// Auto-generated if not provided.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,

    /// Ordered list of pipeline steps to execute.
    pub steps: Vec<PipelineStep>,

    /// Pipeline-level options.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub options: Option<PipelineOptions>,

    /// Data that step inputs can reference as `$input`.
    ///
    /// This is the only source of `$input`; the host's execution context is
    /// never exposed to references.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::wire::present"
    )]
    pub input: Option<serde_json::Value>,
}

impl PipelineRequest {
    /// Create a request from steps.
    pub fn new(steps: Vec<PipelineStep>) -> Self {
        Self {
            id: None,
            steps,
            options: None,
            input: None,
        }
    }

    /// Set the pipeline ID.
    pub fn with_id(mut self, id: impl Into<String>) -> Self {
        self.id = Some(id.into());
        self
    }

    /// Set pipeline options.
    pub fn with_options(mut self, options: PipelineOptions) -> Self {
        self.options = Some(options);
        self
    }

    /// Set the data available to steps as `$input`.
    pub fn with_input(mut self, input: serde_json::Value) -> Self {
        self.input = Some(input);
        self
    }
}

/// A single step in a pipeline.
///
/// # Example
///
/// ```rust
/// use afd::pipeline::{PipelineCondition, PipelineStep};
///
/// let step = PipelineStep::new("order-list")
///     .with_input(serde_json::json!({"userId": "$prev.id", "status": "active"}))
///     .with_alias("orders")
///     .with_when(PipelineCondition::Exists { exists: "$prev.id".to_string() });
/// assert_eq!(
///     serde_json::to_value(&step).unwrap()["when"],
///     serde_json::json!({"$exists": "$prev.id"})
/// );
/// ```
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct PipelineStep {
    /// Command name to execute.
    pub command: String,

    /// Input for this step. String values may be variable references
    /// (see the [module documentation](self)).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input: Option<serde_json::Value>,

    /// Optional alias for referencing this step's output as `$steps.<alias>`.
    #[serde(rename = "as", default, skip_serializing_if = "Option::is_none")]
    pub alias: Option<String>,

    /// Condition for running this step. If it evaluates to false, the step is skipped.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub when: Option<PipelineCondition>,

    /// Not implemented: `Some(true)` fails this step with `UNSUPPORTED_OPTION`
    /// before any step runs, as in TypeScript. `Some(false)` is accepted.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stream: Option<bool>,
}

impl PipelineStep {
    /// Create a step for a command with no input.
    pub fn new(command: impl Into<String>) -> Self {
        Self {
            command: command.into(),
            input: None,
            alias: None,
            when: None,
            stream: None,
        }
    }

    /// Set the step input.
    pub fn with_input(mut self, input: serde_json::Value) -> Self {
        self.input = Some(input);
        self
    }

    /// Set the step alias (`as`).
    pub fn with_alias(mut self, alias: impl Into<String>) -> Self {
        self.alias = Some(alias.into());
        self
    }

    /// Set the `when` condition.
    pub fn with_when(mut self, condition: PipelineCondition) -> Self {
        self.when = Some(condition);
        self
    }

    /// Set `stream`. Streaming steps are not implemented: `true` makes
    /// [`execute_pipeline`] reject the pipeline with `UNSUPPORTED_OPTION`.
    pub fn with_stream(mut self, stream: bool) -> Self {
        self.stream = Some(stream);
        self
    }
}

/// Options for pipeline execution.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct PipelineOptions {
    /// Continue on failure or stop immediately.
    ///
    /// - `false` (default): Pipeline stops on first failure
    /// - `true`: Continue executing, collect all errors
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub continue_on_failure: Option<bool>,

    /// Timeout for the entire pipeline in milliseconds.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "crate::wire::opt_number"
    )]
    pub timeout_ms: Option<f64>,

    /// Reserved for dependency-aware parallel execution. `true` is currently
    /// rejected with `UNSUPPORTED_OPTION`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parallel: Option<bool>,
}

impl PipelineOptions {
    /// Create default options.
    pub fn new() -> Self {
        Self::default()
    }

    /// Continue after a failed step.
    pub fn with_continue_on_failure(mut self, continue_on_failure: bool) -> Self {
        self.continue_on_failure = Some(continue_on_failure);
        self
    }

    /// Set the pipeline deadline in milliseconds.
    pub fn with_timeout_ms(mut self, timeout_ms: f64) -> Self {
        self.timeout_ms = Some(timeout_ms);
        self
    }

    /// Request parallel execution (currently rejected).
    pub fn with_parallel(mut self, parallel: bool) -> Self {
        self.parallel = Some(parallel);
        self
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PIPELINE CONDITION TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/// Conditional expression for pipeline steps.
///
/// Each condition serializes as a single-key object, as in TypeScript:
/// `{"$exists": "$prev.id"}`, `{"$eq": ["$prev.tier", "premium"]}`,
/// `{"$and": [...]}`.
///
/// # Example
///
/// ```rust
/// use afd::pipeline::PipelineCondition;
///
/// // Check if field exists
/// let exists = PipelineCondition::Exists { exists: "$prev.email".to_string() };
///
/// // Check equality
/// let eq = PipelineCondition::Eq {
///     eq: ("$steps.user.tier".to_string(), serde_json::json!("premium"))
/// };
///
/// // Numeric comparison
/// let gt = PipelineCondition::Gt {
///     gt: ("$prev.count".to_string(), 0.0)
/// };
///
/// // Logical combination
/// let and = PipelineCondition::And { and: vec![exists, eq, gt] };
/// let json = serde_json::to_value(&and).unwrap();
/// assert_eq!(json["$and"][2], serde_json::json!({"$gt": ["$prev.count", 0]}));
/// ```
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged, deny_unknown_fields)]
#[non_exhaustive]
pub enum PipelineCondition {
    /// Check if a field exists (is resolved and not `null`).
    Exists {
        /// Variable reference to check for existence
        #[serde(rename = "$exists")]
        exists: String,
    },

    /// Check if a field equals a value.
    Eq {
        /// (variable reference, expected value)
        #[serde(rename = "$eq")]
        eq: (String, serde_json::Value),
    },

    /// Check if a field is present and does not equal a value.
    Ne {
        /// (variable reference, value to not equal)
        #[serde(rename = "$ne")]
        ne: (String, serde_json::Value),
    },

    /// Check if a field is greater than a value.
    Gt {
        /// (variable reference, value to compare against)
        #[serde(rename = "$gt", serialize_with = "crate::wire::reference_and_number")]
        gt: (String, f64),
    },

    /// Check if a field is greater than or equal to a value.
    Gte {
        /// (variable reference, value to compare against)
        #[serde(rename = "$gte", serialize_with = "crate::wire::reference_and_number")]
        gte: (String, f64),
    },

    /// Check if a field is less than a value.
    Lt {
        /// (variable reference, value to compare against)
        #[serde(rename = "$lt", serialize_with = "crate::wire::reference_and_number")]
        lt: (String, f64),
    },

    /// Check if a field is less than or equal to a value.
    Lte {
        /// (variable reference, value to compare against)
        #[serde(rename = "$lte", serialize_with = "crate::wire::reference_and_number")]
        lte: (String, f64),
    },

    /// Logical AND - all conditions must be true.
    And {
        /// Array of conditions that must all be true
        #[serde(rename = "$and")]
        and: Vec<PipelineCondition>,
    },

    /// Logical OR - any condition must be true.
    Or {
        /// Array of conditions where at least one must be true
        #[serde(rename = "$or")]
        or: Vec<PipelineCondition>,
    },

    /// Logical NOT - negates a condition.
    Not {
        /// Condition to negate
        #[serde(rename = "$not")]
        not: Box<PipelineCondition>,
    },
}

/// Check if a field exists in the context.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PipelineConditionExists {
    #[serde(rename = "$exists")]
    pub exists: String,
}

/// Check if a field equals a value.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PipelineConditionEq {
    #[serde(rename = "$eq")]
    pub eq: (String, serde_json::Value),
}

/// Check if a field does not equal a value.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PipelineConditionNe {
    #[serde(rename = "$ne")]
    pub ne: (String, serde_json::Value),
}

/// Check if a field is greater than a value.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PipelineConditionGt {
    #[serde(rename = "$gt", serialize_with = "crate::wire::reference_and_number")]
    pub gt: (String, f64),
}

/// Check if a field is greater than or equal to a value.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PipelineConditionGte {
    #[serde(rename = "$gte", serialize_with = "crate::wire::reference_and_number")]
    pub gte: (String, f64),
}

/// Check if a field is less than a value.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PipelineConditionLt {
    #[serde(rename = "$lt", serialize_with = "crate::wire::reference_and_number")]
    pub lt: (String, f64),
}

/// Check if a field is less than or equal to a value.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PipelineConditionLte {
    #[serde(rename = "$lte", serialize_with = "crate::wire::reference_and_number")]
    pub lte: (String, f64),
}

/// Logical AND - all conditions must be true.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PipelineConditionAnd {
    #[serde(rename = "$and")]
    pub and: Vec<PipelineCondition>,
}

/// Logical OR - any condition must be true.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PipelineConditionOr {
    #[serde(rename = "$or")]
    pub or: Vec<PipelineCondition>,
}

/// Logical NOT - negates a condition.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PipelineConditionNot {
    #[serde(rename = "$not")]
    pub not: Box<PipelineCondition>,
}

impl From<PipelineConditionExists> for PipelineCondition {
    fn from(value: PipelineConditionExists) -> Self {
        Self::Exists {
            exists: value.exists,
        }
    }
}

impl From<PipelineConditionEq> for PipelineCondition {
    fn from(value: PipelineConditionEq) -> Self {
        Self::Eq { eq: value.eq }
    }
}

impl From<PipelineConditionNe> for PipelineCondition {
    fn from(value: PipelineConditionNe) -> Self {
        Self::Ne { ne: value.ne }
    }
}

impl From<PipelineConditionGt> for PipelineCondition {
    fn from(value: PipelineConditionGt) -> Self {
        Self::Gt { gt: value.gt }
    }
}

impl From<PipelineConditionGte> for PipelineCondition {
    fn from(value: PipelineConditionGte) -> Self {
        Self::Gte { gte: value.gte }
    }
}

impl From<PipelineConditionLt> for PipelineCondition {
    fn from(value: PipelineConditionLt) -> Self {
        Self::Lt { lt: value.lt }
    }
}

impl From<PipelineConditionLte> for PipelineCondition {
    fn from(value: PipelineConditionLte) -> Self {
        Self::Lte { lte: value.lte }
    }
}

impl From<PipelineConditionAnd> for PipelineCondition {
    fn from(value: PipelineConditionAnd) -> Self {
        Self::And { and: value.and }
    }
}

impl From<PipelineConditionOr> for PipelineCondition {
    fn from(value: PipelineConditionOr) -> Self {
        Self::Or { or: value.or }
    }
}

impl From<PipelineConditionNot> for PipelineCondition {
    fn from(value: PipelineConditionNot) -> Self {
        Self::Not { not: value.not }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PIPELINE RESULT TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/// Result of executing a pipeline.
///
/// # Type Parameters
///
/// * `T` - Type of the final output data
///
/// # Example
///
/// ```rust
/// use afd::pipeline::{PipelineResult, StepStatus};
///
/// let result: PipelineResult = serde_json::from_value(serde_json::json!({
///     "data": [{"id": 1, "total": 100}],
///     "metadata": {
///         "confidence": 0.87,
///         "confidenceBreakdown": [],
///         "reasoning": [],
///         "warnings": [],
///         "sources": [],
///         "alternatives": [],
///         "executionTimeMs": 150,
///         "completedSteps": 1,
///         "totalSteps": 1
///     },
///     "steps": [{
///         "index": 0,
///         "command": "order-list",
///         "status": "success",
///         "data": [{"id": 1, "total": 100}],
///         "executionTimeMs": 150
///     }]
/// }))
/// .unwrap();
/// assert_eq!(result.steps[0].status, StepStatus::Success);
/// ```
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", bound(deserialize = "T: Deserialize<'de>"))]
#[non_exhaustive]
pub struct PipelineResult<T = serde_json::Value> {
    /// Final output: the last successful step's data. Absent when no step succeeded.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::wire::present"
    )]
    pub data: Option<T>,

    /// Aggregated metadata from all steps.
    pub metadata: PipelineMetadata,

    /// Results from each step.
    pub steps: Vec<StepResult>,
}

/// Aggregated metadata from pipeline execution.
///
/// Combines trust signals from all steps with pipeline-specific fields. Like
/// TypeScript's `PipelineMetadata extends ResultMetadata`, it may carry
/// `commandVersion`, `traceId`, `timestamp` and arbitrary extra keys.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct PipelineMetadata {
    /// Minimum confidence across all successful steps (weakest link principle).
    #[serde(serialize_with = "crate::wire::number")]
    pub confidence: f64,

    /// Per-step confidence breakdown.
    pub confidence_breakdown: Vec<StepConfidence>,

    /// Aggregated reasoning from all steps.
    pub reasoning: Vec<StepReasoning>,

    /// Warnings from ALL steps, tagged with step index.
    pub warnings: Vec<PipelineWarning>,

    /// Sources from ALL steps.
    pub sources: Vec<PipelineSource>,

    /// Alternatives from ANY step that suggested them.
    pub alternatives: Vec<PipelineAlternative>,

    /// Total execution time in milliseconds.
    #[serde(serialize_with = "crate::wire::number")]
    pub execution_time_ms: f64,

    /// Number of steps completed successfully.
    pub completed_steps: usize,

    /// Total number of steps in the pipeline.
    pub total_steps: usize,

    /// Version of the command that produced this result.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command_version: Option<String>,

    /// Trace ID for debugging and correlation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trace_id: Option<String>,

    /// Timestamp of the execution.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<String>,

    /// Additional arbitrary metadata.
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

impl Default for PipelineMetadata {
    fn default() -> Self {
        Self {
            confidence: 1.0,
            confidence_breakdown: Vec::new(),
            reasoning: Vec::new(),
            warnings: Vec::new(),
            sources: Vec::new(),
            alternatives: Vec::new(),
            execution_time_ms: 0.0,
            completed_steps: 0,
            total_steps: 0,
            command_version: None,
            trace_id: None,
            timestamp: None,
            extra: HashMap::new(),
        }
    }
}

/// Confidence information for a single step.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct StepConfidence {
    /// Step index (0-based).
    pub step: usize,

    /// Step alias if provided.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alias: Option<String>,

    /// Command that was executed.
    pub command: String,

    /// Confidence score for this step (0-1).
    #[serde(serialize_with = "crate::wire::number")]
    pub confidence: f64,

    /// Explanation of why this confidence level.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<String>,
}

/// Reasoning from a single step.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct StepReasoning {
    /// Which step provided this reasoning.
    pub step_index: usize,

    /// Command that was executed.
    pub command: String,

    /// Explanation of WHY this step made its decisions.
    pub reasoning: String,
}

/// Warning from a pipeline step (a [`Warning`] plus step attribution).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct PipelineWarning {
    /// Warning code for programmatic handling.
    pub code: String,

    /// Human-readable warning message.
    pub message: String,

    /// Severity level.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub severity: Option<WarningSeverity>,

    /// Additional context or details.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub details: Option<HashMap<String, serde_json::Value>>,

    /// Which step generated this warning.
    pub step_index: usize,

    /// Step alias if provided.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub step_alias: Option<String>,
}

impl From<(&Warning, usize, Option<&str>)> for PipelineWarning {
    fn from((warning, step_index, step_alias): (&Warning, usize, Option<&str>)) -> Self {
        Self {
            code: warning.code.clone(),
            message: warning.message.clone(),
            severity: warning.severity,
            details: warning.details.clone(),
            step_index,
            step_alias: step_alias.map(ToString::to_string),
        }
    }
}

/// Source used by a pipeline step (a [`Source`] plus step attribution).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct PipelineSource {
    /// Source type identifier.
    #[serde(rename = "type")]
    pub source_type: String,

    /// Unique identifier for the source.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,

    /// Human-readable title.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,

    /// URL if the source is web-accessible.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,

    /// Location within the source.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub location: Option<String>,

    /// When the source was accessed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub accessed_at: Option<String>,

    /// Relevance score (0-1).
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "crate::wire::opt_number"
    )]
    pub relevance: Option<f64>,

    /// Which step used this source.
    pub step_index: usize,
}

impl From<(&Source, usize)> for PipelineSource {
    fn from((source, step_index): (&Source, usize)) -> Self {
        Self {
            source_type: source.source_type.clone(),
            id: source.id.clone(),
            title: source.title.clone(),
            url: source.url.clone(),
            location: source.location.clone(),
            accessed_at: source.accessed_at.clone(),
            relevance: source.relevance,
            step_index,
        }
    }
}

/// Alternative suggested by a pipeline step (an [`Alternative`] plus step attribution).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct PipelineAlternative {
    /// The alternative data.
    pub data: serde_json::Value,

    /// Why this alternative wasn't selected.
    pub reason: String,

    /// Confidence in this alternative (0-1).
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "crate::wire::opt_number"
    )]
    pub confidence: Option<f64>,

    /// Label for this alternative.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,

    /// Which step suggested this alternative.
    pub step_index: usize,
}

impl<T: Serialize> From<(&Alternative<T>, usize)> for PipelineAlternative {
    fn from((alt, step_index): (&Alternative<T>, usize)) -> Self {
        Self {
            data: serde_json::to_value(&alt.data).unwrap_or(serde_json::Value::Null),
            reason: alt.reason.clone(),
            confidence: alt.confidence,
            label: alt.label.clone(),
            step_index,
        }
    }
}

/// Result of a single pipeline step.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct StepResult {
    /// Step index (0-based).
    pub index: usize,

    /// Step alias if provided.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alias: Option<String>,

    /// Command that was executed.
    pub command: String,

    /// Step status.
    pub status: StepStatus,

    /// Step output (if successful).
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::wire::present"
    )]
    pub data: Option<serde_json::Value>,

    /// Step error (if failed, or skipped because of a timeout).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<CommandError>,

    /// Step execution time in milliseconds.
    #[serde(serialize_with = "crate::wire::number")]
    pub execution_time_ms: f64,

    /// Step metadata (confidence, reasoning, sources, etc.).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<StepMetadata>,
}

impl StepResult {
    /// Create a step result with no data, error or metadata.
    pub fn new(index: usize, command: impl Into<String>, status: StepStatus) -> Self {
        Self {
            index,
            alias: None,
            command: command.into(),
            status,
            data: None,
            error: None,
            execution_time_ms: 0.0,
            metadata: None,
        }
    }

    /// Set the step alias.
    pub fn with_alias(mut self, alias: impl Into<String>) -> Self {
        self.alias = Some(alias.into());
        self
    }

    /// Set the step data.
    pub fn with_data(mut self, data: serde_json::Value) -> Self {
        self.data = Some(data);
        self
    }

    /// Set the step error.
    pub fn with_error(mut self, error: CommandError) -> Self {
        self.error = Some(error);
        self
    }

    /// Set the execution time in milliseconds.
    pub fn with_execution_time_ms(mut self, execution_time_ms: f64) -> Self {
        self.execution_time_ms = execution_time_ms;
        self
    }

    /// Set the step metadata.
    pub fn with_metadata(mut self, metadata: StepMetadata) -> Self {
        self.metadata = Some(metadata);
        self
    }
}

/// Metadata for a single step result.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct StepMetadata {
    /// Confidence score for this step (0-1).
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "crate::wire::opt_number"
    )]
    pub confidence: Option<f64>,

    /// Reasoning for this step's result.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<String>,

    /// Warnings from this step.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub warnings: Option<Vec<Warning>>,

    /// Sources used by this step.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sources: Option<Vec<Source>>,

    /// Alternatives considered by this step.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alternatives: Option<Vec<Alternative<serde_json::Value>>>,

    /// Additional arbitrary metadata.
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

impl StepMetadata {
    /// Collect the trust signals of a command result.
    pub fn from_result(result: &CommandResult<serde_json::Value>) -> Self {
        Self {
            confidence: result.confidence,
            reasoning: result.reasoning.clone(),
            warnings: result.warnings.clone(),
            sources: result.sources.clone(),
            alternatives: result.alternatives.clone(),
            extra: HashMap::new(),
        }
    }

    /// Set the confidence.
    pub fn with_confidence(mut self, confidence: f64) -> Self {
        self.confidence = Some(confidence);
        self
    }

    /// Set the reasoning.
    pub fn with_reasoning(mut self, reasoning: impl Into<String>) -> Self {
        self.reasoning = Some(reasoning.into());
        self
    }

    /// Set the warnings.
    pub fn with_warnings(mut self, warnings: Vec<Warning>) -> Self {
        self.warnings = Some(warnings);
        self
    }
}

/// Possible statuses for a pipeline step.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
#[non_exhaustive]
pub enum StepStatus {
    /// Step completed successfully.
    Success,
    /// Step failed.
    Failure,
    /// Step was skipped (condition not met, or the pipeline stopped).
    Skipped,
}

// ═══════════════════════════════════════════════════════════════════════════════
// PIPELINE CONTEXT
// ═══════════════════════════════════════════════════════════════════════════════

/// Context available during pipeline execution, used for variable resolution.
#[derive(Debug, Clone, Default)]
#[non_exhaustive]
pub struct PipelineContext {
    /// The pipeline request's `input`, referenced as `$input`.
    pub pipeline_input: Option<serde_json::Value>,

    /// Result of the previous successful step, referenced as `$prev`.
    pub previous_result: Option<StepResult>,

    /// All step results so far, in step order.
    pub steps: Vec<StepResult>,
}

impl PipelineContext {
    /// Create a context with the given `$input` data.
    pub fn new(pipeline_input: Option<serde_json::Value>) -> Self {
        Self {
            pipeline_input,
            ..Self::default()
        }
    }

    /// Record a step result. Successful steps also become `$prev`.
    pub fn push_step(&mut self, step: StepResult) {
        if step.status == StepStatus::Success {
            self.previous_result = Some(step.clone());
        }
        self.steps.push(step);
    }
}

/// Async command execution callback used by the pipeline executor.
pub type CommandExecutor = Arc<
    dyn Fn(
            String,
            serde_json::Value,
            HashMap<String, serde_json::Value>,
        ) -> Pin<Box<dyn Future<Output = CommandResult<serde_json::Value>> + Send>>
        + Send
        + Sync,
>;

// ═══════════════════════════════════════════════════════════════════════════════
// TYPE GUARDS
// ═══════════════════════════════════════════════════════════════════════════════

/// Type guard to check if a value is a PipelineRequest.
pub fn is_pipeline_request(value: &serde_json::Value) -> bool {
    value
        .get("steps")
        .and_then(serde_json::Value::as_array)
        .is_some_and(|steps| steps.iter().all(is_pipeline_step))
}

/// Type guard to check if a value is a PipelineStep.
pub fn is_pipeline_step(value: &serde_json::Value) -> bool {
    value
        .get("command")
        .is_some_and(serde_json::Value::is_string)
}

/// Type guard to check if a value is a PipelineResult.
pub fn is_pipeline_result(value: &serde_json::Value) -> bool {
    value.as_object().is_some_and(|obj| {
        obj.contains_key("metadata") && obj.get("steps").is_some_and(|s| s.is_array())
    })
}

/// Type guard to check if a value is a PipelineCondition.
pub fn is_pipeline_condition(value: &serde_json::Value) -> bool {
    let Some(obj) = value.as_object() else {
        return false;
    };

    if obj.len() != 1 {
        return false;
    }

    matches!(
        obj.keys().next().map(String::as_str),
        Some("$exists")
            | Some("$eq")
            | Some("$ne")
            | Some("$gt")
            | Some("$gte")
            | Some("$lt")
            | Some("$lte")
            | Some("$and")
            | Some("$or")
            | Some("$not")
    )
}

/// Type guard for `$exists` conditions.
pub fn is_exists_condition(condition: &PipelineCondition) -> bool {
    matches!(condition, PipelineCondition::Exists { .. })
}

/// Type guard for `$eq` conditions.
pub fn is_eq_condition(condition: &PipelineCondition) -> bool {
    matches!(condition, PipelineCondition::Eq { .. })
}

/// Type guard for `$ne` conditions.
pub fn is_ne_condition(condition: &PipelineCondition) -> bool {
    matches!(condition, PipelineCondition::Ne { .. })
}

/// Type guard for `$gt` conditions.
pub fn is_gt_condition(condition: &PipelineCondition) -> bool {
    matches!(condition, PipelineCondition::Gt { .. })
}

/// Type guard for `$gte` conditions.
pub fn is_gte_condition(condition: &PipelineCondition) -> bool {
    matches!(condition, PipelineCondition::Gte { .. })
}

/// Type guard for `$lt` conditions.
pub fn is_lt_condition(condition: &PipelineCondition) -> bool {
    matches!(condition, PipelineCondition::Lt { .. })
}

/// Type guard for `$lte` conditions.
pub fn is_lte_condition(condition: &PipelineCondition) -> bool {
    matches!(condition, PipelineCondition::Lte { .. })
}

/// Type guard for `$and` conditions.
pub fn is_and_condition(condition: &PipelineCondition) -> bool {
    matches!(condition, PipelineCondition::And { .. })
}

/// Type guard for `$or` conditions.
pub fn is_or_condition(condition: &PipelineCondition) -> bool {
    matches!(condition, PipelineCondition::Or { .. })
}

/// Type guard for `$not` conditions.
pub fn is_not_condition(condition: &PipelineCondition) -> bool {
    matches!(condition, PipelineCondition::Not { .. })
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/// Create a PipelineRequest from an array of steps.
pub fn create_pipeline(
    steps: Vec<PipelineStep>,
    options: Option<PipelineOptions>,
) -> PipelineRequest {
    PipelineRequest {
        options,
        ..PipelineRequest::new(steps)
    }
}

fn step_confidence(step: &StepResult) -> f64 {
    step.metadata
        .as_ref()
        .and_then(|m| m.confidence)
        .unwrap_or(1.0)
}

/// Calculate aggregated confidence from step results.
///
/// Uses the "weakest link" principle: the minimum confidence of all successful
/// steps (a step without a confidence counts as 1), or 0 if no step succeeded.
pub fn aggregate_pipeline_confidence(steps: &[StepResult]) -> f64 {
    steps
        .iter()
        .filter(|s| s.status == StepStatus::Success)
        .map(step_confidence)
        .reduce(f64::min)
        .unwrap_or(0.0)
}

/// Aggregate reasoning from all successful steps.
pub fn aggregate_pipeline_reasoning(steps: &[StepResult]) -> Vec<StepReasoning> {
    steps
        .iter()
        .filter(|s| s.status == StepStatus::Success)
        .filter_map(|s| {
            s.metadata
                .as_ref()
                .and_then(|m| m.reasoning.as_ref())
                .map(|reasoning| StepReasoning {
                    step_index: s.index,
                    command: s.command.clone(),
                    reasoning: reasoning.clone(),
                })
        })
        .collect()
}

/// Aggregate warnings from all steps, with step attribution.
pub fn aggregate_pipeline_warnings(steps: &[StepResult]) -> Vec<PipelineWarning> {
    steps
        .iter()
        .flat_map(|step| {
            step.metadata
                .iter()
                .flat_map(|metadata| metadata.warnings.iter().flatten())
                .map(move |warning| {
                    PipelineWarning::from((warning, step.index, step.alias.as_deref()))
                })
        })
        .collect()
}

/// Aggregate sources from all steps, with step attribution.
pub fn aggregate_pipeline_sources(steps: &[StepResult]) -> Vec<PipelineSource> {
    steps
        .iter()
        .flat_map(|step| {
            step.metadata
                .iter()
                .flat_map(|metadata| metadata.sources.iter().flatten())
                .map(move |source| PipelineSource::from((source, step.index)))
        })
        .collect()
}

/// Aggregate alternatives from all steps, with step attribution.
pub fn aggregate_pipeline_alternatives(steps: &[StepResult]) -> Vec<PipelineAlternative> {
    steps
        .iter()
        .flat_map(|step| {
            step.metadata
                .iter()
                .flat_map(|metadata| metadata.alternatives.iter().flatten())
                .map(move |alt| PipelineAlternative::from((alt, step.index)))
        })
        .collect()
}

/// Build the confidence breakdown of the successful steps.
///
/// `step_defs` supplies aliases for results that do not carry one.
pub fn build_confidence_breakdown(
    steps: &[StepResult],
    step_defs: Option<&[PipelineStep]>,
) -> Vec<StepConfidence> {
    steps
        .iter()
        .filter(|s| s.status == StepStatus::Success)
        .map(|s| StepConfidence {
            step: s.index,
            alias: s.alias.clone().or_else(|| {
                step_defs.and_then(|defs| defs.get(s.index).and_then(|d| d.alias.clone()))
            }),
            command: s.command.clone(),
            confidence: step_confidence(s),
            reasoning: s.metadata.as_ref().and_then(|m| m.reasoning.clone()),
        })
        .collect()
}

// ═══════════════════════════════════════════════════════════════════════════════
// VARIABLE RESOLUTION
// ═══════════════════════════════════════════════════════════════════════════════

/// The complete reference grammar; compiled once.
///
/// Groups: 1 = `prev`/`first`/`input`, 2 = step index, 3 = step alias, 4 = path.
fn reference_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(
            r"^\$(?:(prev|first|input)|steps\[([0-9]+)\]|steps\.([^.\[\]\s]+))((?:\.[^.\[\]\s]+(?:\[[0-9]+\])?)*)$",
        )
        .expect("reference regex should be valid")
    })
}

/// A path segment: a key with an optional `[index]`; compiled once.
fn path_segment_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(r"^([^.\[\]\s]+)(?:\[([0-9]+)\])?$").expect("path segment regex should be valid")
    })
}

/// How a string in a step input or condition was interpreted.
enum Resolution<'s, 'c> {
    /// Not a reference: pass the (unescaped) string through.
    Literal(&'s str),
    /// A reference that resolved to pipeline data.
    Value(&'c serde_json::Value),
    /// A reference that could not be resolved.
    Absent,
}

fn is_reserved(segment: &str) -> bool {
    segment.starts_with("__")
}

fn exceeds_reference_length(value: &str) -> bool {
    value.len() > MAX_REFERENCE_LENGTH && value.chars().count() > MAX_REFERENCE_LENGTH
}

fn resolve_string<'s, 'c>(value: &'s str, context: &'c PipelineContext) -> Resolution<'s, 'c> {
    if value.starts_with("$$") {
        return Resolution::Literal(&value[1..]);
    }
    if !value.starts_with('$') || exceeds_reference_length(value) {
        return Resolution::Literal(value);
    }
    let Some(captures) = reference_pattern().captures(value) else {
        return Resolution::Literal(value);
    };

    let root = if let Some(name) = captures.get(1) {
        match name.as_str() {
            "prev" => context
                .previous_result
                .as_ref()
                .and_then(|step| step.data.as_ref()),
            "first" => context.steps.first().and_then(|step| step.data.as_ref()),
            _ => context.pipeline_input.as_ref(),
        }
    } else if let Some(index) = captures.get(2) {
        index
            .as_str()
            .parse::<usize>()
            .ok()
            .and_then(|index| context.steps.get(index))
            .and_then(|step| step.data.as_ref())
    } else {
        captures
            .get(3)
            .map(|alias| alias.as_str())
            .filter(|alias| !is_reserved(alias))
            .and_then(|alias| {
                context
                    .steps
                    .iter()
                    .find(|step| step.alias.as_deref() == Some(alias))
            })
            .and_then(|step| step.data.as_ref())
    };

    let path = captures.get(4).map_or("", |path| path.as_str());
    let resolved = root.and_then(|root| match path.strip_prefix('.') {
        Some(path) => traverse(root, path),
        None => Some(root),
    });
    resolved.map_or(Resolution::Absent, Resolution::Value)
}

/// Follow one key: an own key of an object, or a numeric index into an array.
fn lookup_key<'v>(current: &'v serde_json::Value, key: &str) -> Option<&'v serde_json::Value> {
    if is_reserved(key) {
        return None;
    }
    match current {
        serde_json::Value::Object(map) => map.get(key),
        serde_json::Value::Array(items) if key.bytes().all(|b| b.is_ascii_digit()) => {
            items.get(key.parse::<usize>().ok()?)
        }
        _ => None,
    }
}

fn traverse<'v>(root: &'v serde_json::Value, path: &str) -> Option<&'v serde_json::Value> {
    let mut current = root;
    for segment in path.split('.') {
        let captures = path_segment_pattern().captures(segment)?;
        current = lookup_key(current, captures.get(1)?.as_str())?;
        if let Some(index) = captures.get(2) {
            current = current
                .as_array()?
                .get(index.as_str().parse::<usize>().ok()?)?;
        }
    }
    Some(current)
}

/// Resolve a single variable reference to its value from pipeline context.
///
/// Returns `None` when the string is a reference that cannot be resolved.
/// Strings that are not references are returned as literals (with a `$$`
/// escape reduced to `$`). See the [module documentation](self) for the rules.
///
/// # Example
///
/// ```rust
/// use afd::pipeline::{resolve_variable, PipelineContext};
///
/// let context = PipelineContext::new(Some(serde_json::json!({"user": {"id": 7}})));
/// assert_eq!(resolve_variable("$input.user.id", &context), Some(serde_json::json!(7)));
/// assert_eq!(resolve_variable("$prev", &context), None);
/// assert_eq!(resolve_variable("$9.99", &context), Some(serde_json::json!("$9.99")));
/// assert_eq!(resolve_variable("$$prev", &context), Some(serde_json::json!("$prev")));
/// ```
pub fn resolve_variable(reference: &str, context: &PipelineContext) -> Option<serde_json::Value> {
    match resolve_string(reference, context) {
        Resolution::Literal(literal) => Some(serde_json::Value::String(literal.to_string())),
        Resolution::Value(value) => Some(value.clone()),
        Resolution::Absent => None,
    }
}

/// Alias for `resolve_variable` for backwards compatibility.
pub fn resolve_reference(reference: &str, context: &PipelineContext) -> Option<serde_json::Value> {
    resolve_variable(reference, context)
}

fn resolve_value(
    input: &serde_json::Value,
    context: &PipelineContext,
    depth: usize,
) -> Option<serde_json::Value> {
    match input {
        serde_json::Value::String(value) => resolve_variable(value, context),
        serde_json::Value::Array(_) | serde_json::Value::Object(_) if depth > MAX_INPUT_DEPTH => {
            Some(serde_json::Value::Null)
        }
        serde_json::Value::Array(items) => Some(serde_json::Value::Array(
            items
                .iter()
                .map(|item| resolve_value(item, context, depth + 1).unwrap_or_default())
                .collect(),
        )),
        serde_json::Value::Object(map) => Some(serde_json::Value::Object(
            map.iter()
                .filter_map(|(key, value)| {
                    resolve_value(value, context, depth + 1).map(|value| (key.clone(), value))
                })
                .collect(),
        )),
        other => Some(other.clone()),
    }
}

/// Resolve all variable references in an input value.
///
/// Unresolved references are omitted from objects and become `null` in
/// arrays; an unresolved top-level reference becomes `null`. Containers
/// nested deeper than [`MAX_INPUT_DEPTH`] are replaced by `null` (the pipeline
/// executor rejects such inputs before running any step).
pub fn resolve_variables(
    input: &serde_json::Value,
    context: &PipelineContext,
) -> serde_json::Value {
    resolve_value(input, context, 1).unwrap_or_default()
}

/// Whether a value has containers nested deeper than `max_depth` levels.
///
/// The top-level container is level 1. Iterative, so it never overflows the stack.
fn exceeds_depth(value: &serde_json::Value, max_depth: usize) -> bool {
    let mut pending = vec![(value, 1usize)];
    while let Some((value, depth)) = pending.pop() {
        match value {
            serde_json::Value::Array(items) => {
                if depth > max_depth {
                    return true;
                }
                pending.extend(items.iter().map(|item| (item, depth + 1)));
            }
            serde_json::Value::Object(map) => {
                if depth > max_depth {
                    return true;
                }
                pending.extend(map.values().map(|item| (item, depth + 1)));
            }
            _ => {}
        }
    }
    false
}

/// Get a nested value from a JSON value using dot notation.
///
/// Follows the same rules as reference paths: own object keys, in-bounds
/// array indices (`items[0]` or `items.0`), and never a segment starting
/// with `__`.
///
/// # Example
///
/// ```rust
/// use afd::pipeline::get_nested_value;
///
/// let obj = serde_json::json!({"user": {"name": "Alice"}, "items": [1, 2]});
/// assert_eq!(get_nested_value(&obj, "user.name"), Some(serde_json::json!("Alice")));
/// assert_eq!(get_nested_value(&obj, "items[1]"), Some(serde_json::json!(2)));
/// assert_eq!(get_nested_value(&obj, "items[5]"), None);
/// ```
pub fn get_nested_value(obj: &serde_json::Value, path: &str) -> Option<serde_json::Value> {
    traverse(obj, path).cloned()
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONDITION EVALUATION
// ═══════════════════════════════════════════════════════════════════════════════

/// A condition operand: literals compare as strings; absent operands make
/// every comparison false.
fn condition_operand<'c>(
    reference: &str,
    context: &'c PipelineContext,
) -> Option<std::borrow::Cow<'c, serde_json::Value>> {
    match resolve_string(reference, context) {
        Resolution::Literal(literal) => Some(std::borrow::Cow::Owned(serde_json::Value::String(
            literal.to_string(),
        ))),
        Resolution::Value(value) => Some(std::borrow::Cow::Borrowed(value)),
        Resolution::Absent => None,
    }
}

fn compare_number(
    reference: &str,
    context: &PipelineContext,
    predicate: impl Fn(f64) -> bool,
) -> bool {
    condition_operand(reference, context)
        .and_then(|value| value.as_f64())
        .is_some_and(predicate)
}

/// Evaluate a pipeline condition against the current context.
///
/// An unresolved reference is absent: `$exists` is `false` (also for `null`)
/// and every comparison, including `$ne`, is `false`. `$eq` and `$ne` compare
/// JSON values structurally.
pub fn evaluate_condition(condition: &PipelineCondition, context: &PipelineContext) -> bool {
    match condition {
        PipelineCondition::Exists { exists } => {
            condition_operand(exists, context).is_some_and(|value| !value.is_null())
        }
        PipelineCondition::Eq {
            eq: (reference, expected),
        } => condition_operand(reference, context).is_some_and(|value| *value == *expected),
        PipelineCondition::Ne {
            ne: (reference, expected),
        } => condition_operand(reference, context).is_some_and(|value| *value != *expected),
        PipelineCondition::Gt {
            gt: (reference, threshold),
        } => compare_number(reference, context, |n| n > *threshold),
        PipelineCondition::Gte {
            gte: (reference, threshold),
        } => compare_number(reference, context, |n| n >= *threshold),
        PipelineCondition::Lt {
            lt: (reference, threshold),
        } => compare_number(reference, context, |n| n < *threshold),
        PipelineCondition::Lte {
            lte: (reference, threshold),
        } => compare_number(reference, context, |n| n <= *threshold),
        PipelineCondition::And { and: conditions } => {
            conditions.iter().all(|c| evaluate_condition(c, context))
        }
        PipelineCondition::Or { or: conditions } => {
            conditions.iter().any(|c| evaluate_condition(c, context))
        }
        PipelineCondition::Not { not: inner } => !evaluate_condition(inner, context),
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXECUTION
// ═══════════════════════════════════════════════════════════════════════════════

fn pipeline_error(code: &str, message: String, suggestion: &str, retryable: bool) -> CommandError {
    CommandError::new(code, message)
        .with_suggestion(suggestion)
        .with_retryable(retryable)
}

/// Check the request before any step runs. Returns the index of the step to
/// blame and the error.
fn preflight(
    request: &PipelineRequest,
    options: &PipelineOptions,
) -> Option<(usize, CommandError)> {
    if options.parallel == Some(true) {
        return Some((
            0,
            pipeline_error(
                "UNSUPPORTED_OPTION",
                "Parallel pipeline execution is not supported".to_string(),
                "Remove parallel or set it to false to execute steps sequentially",
                false,
            ),
        ));
    }
    if let Some(index) = request
        .steps
        .iter()
        .position(|step| step.stream == Some(true))
    {
        return Some((
            index,
            pipeline_error(
                "UNSUPPORTED_OPTION",
                format!(
                    "Streaming pipeline steps are not supported (step {index} sets stream: true)"
                ),
                "Remove stream or set it to false; to stream one command, use the /stream endpoint",
                false,
            ),
        ));
    }
    if let Some(timeout_ms) = options.timeout_ms {
        if !timeout_ms.is_finite() || timeout_ms < 0.0 {
            return Some((
                0,
                pipeline_error(
                    "VALIDATION_ERROR",
                    "timeoutMs must be a non-negative number".to_string(),
                    "Set timeoutMs to a non-negative number of milliseconds or omit it",
                    false,
                ),
            ));
        }
        if !cfg!(feature = "native") {
            return Some((
                0,
                pipeline_error(
                    "UNSUPPORTED_OPTION",
                    "Pipeline deadlines require the native feature".to_string(),
                    "Enable the native feature or omit timeoutMs",
                    false,
                ),
            ));
        }
    }
    let too_deep = |field: String, index: usize| {
        let mut details = HashMap::new();
        details.insert("maxDepth".to_string(), serde_json::json!(MAX_INPUT_DEPTH));
        details.insert("field".to_string(), serde_json::json!(field));
        (
            index,
            pipeline_error(
                "VALIDATION_ERROR",
                format!("{field} is nested deeper than {MAX_INPUT_DEPTH} levels"),
                "Flatten the input; nesting is limited to 64 levels",
                false,
            )
            .with_details(details),
        )
    };
    if request
        .input
        .as_ref()
        .is_some_and(|input| exceeds_depth(input, MAX_INPUT_DEPTH))
    {
        return Some(too_deep("input".to_string(), 0));
    }
    request
        .steps
        .iter()
        .position(|step| {
            step.input
                .as_ref()
                .is_some_and(|input| exceeds_depth(input, MAX_INPUT_DEPTH))
        })
        .map(|index| too_deep(format!("steps[{index}].input"), index))
}

fn empty_metadata(total_steps: usize) -> PipelineMetadata {
    PipelineMetadata {
        confidence: 0.0,
        total_steps,
        ..PipelineMetadata::default()
    }
}

/// Run a step's executor, turning a panic (while creating or polling the
/// future) into an `INTERNAL_ERROR` failure.
async fn run_step(
    execute: &CommandExecutor,
    command: String,
    input: serde_json::Value,
    context: HashMap<String, serde_json::Value>,
) -> CommandResult<serde_json::Value> {
    match std::panic::catch_unwind(AssertUnwindSafe(|| execute(command, input, context))) {
        Ok(execution) => crate::commands::run_guarded(execution).await,
        Err(_) => crate::result::failure(crate::commands::handler_panic_error()),
    }
}

/// Execute a pipeline of chained commands with variable resolution.
///
/// `context` is passed to every command invocation (with a per-step
/// `traceId`); it is never visible to `$input` references, which read
/// [`PipelineRequest::input`] only.
pub async fn execute_pipeline(
    request: &PipelineRequest,
    execute: &CommandExecutor,
    context: Option<HashMap<String, serde_json::Value>>,
) -> PipelineResult<serde_json::Value> {
    let start_time = Instant::now();
    let pipeline_id = request
        .id
        .clone()
        .unwrap_or_else(|| format!("pipeline-{}", chrono::Utc::now().timestamp_millis()));

    if request.steps.is_empty() {
        return PipelineResult {
            data: None,
            metadata: empty_metadata(0),
            steps: vec![],
        };
    }

    let options = request.options.clone().unwrap_or_default();
    let base_context = context.unwrap_or_default();

    if let Some((failed_index, error)) = preflight(request, &options) {
        let steps = request
            .steps
            .iter()
            .enumerate()
            .map(|(i, step)| {
                let mut result = StepResult::new(
                    i,
                    step.command.clone(),
                    if i == failed_index {
                        StepStatus::Failure
                    } else {
                        StepStatus::Skipped
                    },
                );
                result.alias = step.alias.clone();
                result.error = (i == failed_index).then(|| error.clone());
                result
            })
            .collect();
        return PipelineResult {
            data: None,
            metadata: empty_metadata(request.steps.len()),
            steps,
        };
    }

    let deadline = options
        .timeout_ms
        .and_then(|timeout_ms| deadline_after(start_time, timeout_ms));
    let timeout_error = || {
        pipeline_error(
            "PIPELINE_TIMEOUT",
            format!(
                "Pipeline timeout exceeded ({}ms)",
                options.timeout_ms.unwrap_or(0.0)
            ),
            "Increase timeoutMs or reduce the number of pipeline steps",
            true,
        )
    };

    let mut pipeline_context = PipelineContext::new(request.input.clone());
    let skip_from = |context: &mut PipelineContext, first: usize, error: Option<CommandError>| {
        for (j, remaining_step) in request.steps.iter().enumerate().skip(first) {
            let mut skipped =
                StepResult::new(j, remaining_step.command.clone(), StepStatus::Skipped);
            skipped.alias = remaining_step.alias.clone();
            skipped.error = error.clone();
            context.push_step(skipped);
        }
    };

    for (i, step) in request.steps.iter().enumerate() {
        let step_start = Instant::now();
        let mut step_result = StepResult::new(i, step.command.clone(), StepStatus::Skipped);
        step_result.alias = step.alias.clone();

        let remaining = deadline.map(|deadline| deadline.saturating_duration_since(step_start));
        if remaining.is_some_and(|remaining| remaining.is_zero()) {
            skip_from(&mut pipeline_context, i, Some(timeout_error()));
            break;
        }

        if let Some(condition) = &step.when {
            if !evaluate_condition(condition, &pipeline_context) {
                pipeline_context.push_step(step_result);
                continue;
            }
        }

        let resolved_input = step
            .input
            .as_ref()
            .map(|input| resolve_variables(input, &pipeline_context))
            .unwrap_or_else(|| serde_json::json!({}));

        let mut step_context = base_context.clone();
        step_context.insert(
            "traceId".to_string(),
            serde_json::json!(format!("{pipeline_id}-step-{i}")),
        );

        let execution = run_step(execute, step.command.clone(), resolved_input, step_context);
        let result = match remaining {
            None => Some(execution.await),
            #[cfg(feature = "native")]
            Some(remaining) => tokio::time::timeout(remaining, execution).await.ok(),
            // Unreachable: preflight rejects deadlines without `native`.
            #[cfg(not(feature = "native"))]
            Some(_) => Some(execution.await),
        };
        step_result.execution_time_ms = elapsed_ms(step_start);

        let Some(result) = result else {
            let error = timeout_error();
            step_result.status = StepStatus::Failure;
            step_result.error = Some(error.clone());
            pipeline_context.push_step(step_result);
            skip_from(&mut pipeline_context, i + 1, Some(error));
            break;
        };

        if result.success {
            step_result.status = StepStatus::Success;
            step_result.metadata = Some(StepMetadata::from_result(&result));
            step_result.data = result.data;
            pipeline_context.push_step(step_result);
        } else {
            step_result.status = StepStatus::Failure;
            step_result.error = result.error;
            pipeline_context.push_step(step_result);

            if options.continue_on_failure != Some(true) {
                skip_from(&mut pipeline_context, i + 1, None);
                break;
            }
        }
    }

    let step_results = pipeline_context.steps;
    let data = step_results
        .iter()
        .rev()
        .find(|step| step.status == StepStatus::Success)
        .and_then(|step| step.data.clone());

    PipelineResult {
        data,
        metadata: PipelineMetadata {
            confidence: aggregate_pipeline_confidence(&step_results),
            confidence_breakdown: build_confidence_breakdown(&step_results, Some(&request.steps)),
            reasoning: aggregate_pipeline_reasoning(&step_results),
            warnings: aggregate_pipeline_warnings(&step_results),
            sources: aggregate_pipeline_sources(&step_results),
            alternatives: aggregate_pipeline_alternatives(&step_results),
            execution_time_ms: elapsed_ms(start_time),
            completed_steps: step_results
                .iter()
                .filter(|step| step.status == StepStatus::Success)
                .count(),
            total_steps: request.steps.len(),
            ..PipelineMetadata::default()
        },
        steps: step_results,
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests;
