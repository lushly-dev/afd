//! Pipeline types for chaining AFD commands.
//!
//! Pipelines enable declarative composition of commands where the output of one
//! becomes the input of the next. Key features:
//! - Variable resolution ($prev, $first, $steps[n], $steps.alias)
//! - Conditional execution with when clauses
//! - Trust signal propagation (confidence, reasoning, sources)
//! - Error propagation with actionable suggestions

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, OnceLock};
use std::time::Instant;

use crate::errors::CommandError;
use crate::metadata::{Alternative, Source, Warning};
use crate::result::CommandResult;
use crate::result::ResultMetadata;

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
/// let request = PipelineRequest {
///     id: Some("my-pipeline".to_string()),
///     steps: vec![
///         PipelineStep {
///             command: "user-get".to_string(),
///             input: Some(serde_json::json!({"id": 123})),
///             alias: Some("user".to_string()),
///             when: None,
///             stream: None,
///         },
///         PipelineStep {
///             command: "order-list".to_string(),
///             input: Some(serde_json::json!({"userId": "$prev.id"})),
///             alias: None,
///             when: None,
///             stream: None,
///         },
///     ],
///     options: None,
/// };
/// ```
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PipelineRequest {
    /// Unique identifier for the pipeline execution.
    /// Auto-generated if not provided.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,

    /// Ordered list of pipeline steps to execute.
    /// Steps are executed sequentially unless parallel is enabled.
    pub steps: Vec<PipelineStep>,

    /// Pipeline-level options.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub options: Option<PipelineOptions>,
}

/// A single step in a pipeline.
///
/// # Example
///
/// ```rust
/// use afd::pipeline::{PipelineStep, PipelineCondition};
///
/// let step = PipelineStep {
///     command: "order-list".to_string(),
///     input: Some(serde_json::json!({"userId": "$prev.id", "status": "active"})),
///     alias: Some("orders".to_string()),
///     when: Some(PipelineCondition::Exists { exists: "$prev.id".to_string() }),
///     stream: None,
/// };
/// ```
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PipelineStep {
    /// Command name to execute.
    pub command: String,

    /// Input for this step.
    ///
    /// Can reference outputs from previous steps using variables:
    /// - `$prev` - Output of immediately previous step
    /// - `$prev.field` - Specific field from previous output
    /// - `$first` - Output of first step
    /// - `$steps[n]` - Output of step at index n
    /// - `$steps.alias` - Output of step with matching `as` alias
    /// - `$input` - Original pipeline input
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input: Option<serde_json::Value>,

    /// Optional alias for referencing this step's output.
    ///
    /// Other steps can reference this step using `$steps.alias`.
    #[serde(rename = "as", skip_serializing_if = "Option::is_none")]
    pub alias: Option<String>,

    /// Condition for running this step.
    ///
    /// If the condition evaluates to false, the step is skipped.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub when: Option<PipelineCondition>,

    /// Enable streaming for this step.
    ///
    /// When true, the step will emit StreamChunk events through the
    /// pipeline's onProgress callback.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream: Option<bool>,
}

/// Options for pipeline execution.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct PipelineOptions {
    /// Continue on failure or stop immediately.
    ///
    /// - `false` (default): Pipeline stops on first failure
    /// - `true`: Continue executing, collect all errors
    #[serde(skip_serializing_if = "Option::is_none")]
    pub continue_on_failure: Option<bool>,

    /// Timeout for entire pipeline in milliseconds.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<u64>,

    /// Reserved for dependency-aware parallel execution. `true` is currently
    /// rejected with `UNSUPPORTED_OPTION`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parallel: Option<bool>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// PIPELINE CONDITION TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/// Conditional expression for pipeline steps.
///
/// Supports existence checks, comparisons, and logical combinations.
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
///     gt: ("$prev.items.length".to_string(), 0.0)
/// };
///
/// // Logical combination
/// let and = PipelineCondition::And {
///     and: vec![
///         PipelineCondition::Exists { exists: "$prev.userId".to_string() },
///         PipelineCondition::Eq {
///             eq: ("$steps.user.active".to_string(), serde_json::json!(true))
///         },
///     ]
/// };
/// ```
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum PipelineCondition {
    /// Check if a field exists in the context.
    #[serde(rename = "$exists")]
    Exists {
        /// Variable reference to check for existence
        #[serde(rename = "$exists")]
        exists: String,
    },

    /// Check if a field equals a value.
    #[serde(rename = "$eq")]
    Eq {
        /// (variable reference, expected value)
        #[serde(rename = "$eq")]
        eq: (String, serde_json::Value),
    },

    /// Check if a field does not equal a value.
    #[serde(rename = "$ne")]
    Ne {
        /// (variable reference, value to not equal)
        #[serde(rename = "$ne")]
        ne: (String, serde_json::Value),
    },

    /// Check if a field is greater than a value.
    #[serde(rename = "$gt")]
    Gt {
        /// (variable reference, value to compare against)
        #[serde(rename = "$gt")]
        gt: (String, f64),
    },

    /// Check if a field is greater than or equal to a value.
    #[serde(rename = "$gte")]
    Gte {
        /// (variable reference, value to compare against)
        #[serde(rename = "$gte")]
        gte: (String, f64),
    },

    /// Check if a field is less than a value.
    #[serde(rename = "$lt")]
    Lt {
        /// (variable reference, value to compare against)
        #[serde(rename = "$lt")]
        lt: (String, f64),
    },

    /// Check if a field is less than or equal to a value.
    #[serde(rename = "$lte")]
    Lte {
        /// (variable reference, value to compare against)
        #[serde(rename = "$lte")]
        lte: (String, f64),
    },

    /// Logical AND - all conditions must be true.
    #[serde(rename = "$and")]
    And {
        /// Array of conditions that must all be true
        #[serde(rename = "$and")]
        and: Vec<PipelineCondition>,
    },

    /// Logical OR - any condition must be true.
    #[serde(rename = "$or")]
    Or {
        /// Array of conditions where at least one must be true
        #[serde(rename = "$or")]
        or: Vec<PipelineCondition>,
    },

    /// Logical NOT - negates a condition.
    #[serde(rename = "$not")]
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
    #[serde(rename = "$gt")]
    pub gt: (String, f64),
}

/// Check if a field is greater than or equal to a value.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PipelineConditionGte {
    #[serde(rename = "$gte")]
    pub gte: (String, f64),
}

/// Check if a field is less than a value.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PipelineConditionLt {
    #[serde(rename = "$lt")]
    pub lt: (String, f64),
}

/// Check if a field is less than or equal to a value.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PipelineConditionLte {
    #[serde(rename = "$lte")]
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
/// use afd::pipeline::{PipelineResult, PipelineMetadata, StepResult, StepStatus};
///
/// let result: PipelineResult<serde_json::Value> = PipelineResult {
///     data: serde_json::json!([{"id": 1, "total": 100}]),
///     metadata: PipelineMetadata {
///         confidence: 0.87,
///         confidence_breakdown: vec![],
///         reasoning: vec![],
///         warnings: vec![],
///         sources: vec![],
///         alternatives: vec![],
///         execution_time_ms: 150,
///         completed_steps: 3,
///         total_steps: 3,
///         result_metadata: None,
///     },
///     steps: vec![],
/// };
/// ```
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PipelineResult<T = serde_json::Value> {
    /// Final output (last successful step's data).
    pub data: T,

    /// Aggregated metadata from all steps.
    pub metadata: PipelineMetadata,

    /// Results from each step.
    pub steps: Vec<StepResult>,
}

/// Aggregated metadata from pipeline execution.
///
/// Combines trust signals from all steps with pipeline-specific fields.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PipelineMetadata {
    /// Minimum confidence across all steps (weakest link principle).
    ///
    /// The pipeline is only as trustworthy as its least confident step.
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

    /// Total execution time (sum of all steps).
    pub execution_time_ms: u64,

    /// Number of steps completed successfully.
    pub completed_steps: u32,

    /// Total number of steps in the pipeline.
    pub total_steps: u32,

    /// Additional result metadata.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_metadata: Option<ResultMetadata>,
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
            execution_time_ms: 0,
            completed_steps: 0,
            total_steps: 0,
            result_metadata: None,
        }
    }
}

/// Confidence information for a single step.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StepConfidence {
    /// Step index (0-based).
    pub step: usize,

    /// Step alias if provided.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alias: Option<String>,

    /// Command that was executed.
    pub command: String,

    /// Confidence score for this step (0-1).
    pub confidence: f64,

    /// Explanation of why this confidence level.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<String>,
}

/// Reasoning from a single step.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StepReasoning {
    /// Which step provided this reasoning.
    pub step_index: usize,

    /// Command that was executed.
    pub command: String,

    /// Explanation of WHY this step made its decisions.
    pub reasoning: String,
}

/// Warning from a pipeline step.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PipelineWarning {
    /// Warning code for programmatic handling.
    pub code: String,

    /// Human-readable warning message.
    pub message: String,

    /// Which step generated this warning.
    pub step_index: usize,

    /// Step alias if provided.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step_alias: Option<String>,
}

impl From<(&Warning, usize, Option<&str>)> for PipelineWarning {
    fn from((warning, step_index, step_alias): (&Warning, usize, Option<&str>)) -> Self {
        Self {
            code: warning.code.clone(),
            message: warning.message.clone(),
            step_index,
            step_alias: step_alias.map(|s| s.to_string()),
        }
    }
}

/// Source used by a pipeline step.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PipelineSource {
    /// Human-readable name for the source.
    pub name: String,

    /// Which step used this source.
    pub step_index: usize,

    /// URL or URI to the source.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

impl From<(&Source, usize)> for PipelineSource {
    fn from((source, step_index): (&Source, usize)) -> Self {
        Self {
            name: source.name.clone(),
            step_index,
            url: source.url.clone(),
        }
    }
}

/// Alternative suggested by a pipeline step.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PipelineAlternative {
    /// The alternative data.
    pub data: serde_json::Value,

    /// Why this alternative wasn't selected.
    pub reason: String,

    /// Which step suggested this alternative.
    pub step_index: usize,

    /// Confidence in this alternative (0-1).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f64>,
}

impl<T: Serialize> From<(&Alternative<T>, usize)> for PipelineAlternative {
    fn from((alt, step_index): (&Alternative<T>, usize)) -> Self {
        Self {
            data: serde_json::to_value(&alt.data).unwrap_or(serde_json::Value::Null),
            reason: alt.reason.clone(),
            step_index,
            confidence: alt.confidence,
        }
    }
}

/// Result of a single pipeline step.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StepResult {
    /// Step index (0-based).
    pub index: usize,

    /// Step alias if provided.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alias: Option<String>,

    /// Command that was executed.
    pub command: String,

    /// Step status.
    pub status: StepStatus,

    /// Step output (if successful).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,

    /// Step error (if failed).
    ///
    /// Includes suggestion following AFD error patterns.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<CommandError>,

    /// Step execution time in milliseconds.
    pub execution_time_ms: u64,

    /// Full step metadata (confidence, reasoning, sources, etc.).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<StepMetadata>,
}

/// Metadata for a single step result.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct StepMetadata {
    /// Confidence score for this step (0-1).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f64>,

    /// Reasoning for this step's result.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<String>,

    /// Sources used by this step.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sources: Option<Vec<Source>>,

    /// Warnings from this step.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warnings: Option<Vec<Warning>>,

    /// Alternatives considered by this step.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alternatives: Option<Vec<Alternative<serde_json::Value>>>,
}

/// Possible statuses for a pipeline step.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum StepStatus {
    /// Step completed successfully.
    Success,
    /// Step failed.
    Failure,
    /// Step was skipped (condition not met).
    Skipped,
}

// ═══════════════════════════════════════════════════════════════════════════════
// PIPELINE CONTEXT
// ═══════════════════════════════════════════════════════════════════════════════

/// Context available during pipeline execution.
///
/// Used for variable resolution.
#[derive(Debug, Clone, Default)]
pub struct PipelineContext {
    /// Original pipeline input.
    pub pipeline_input: Option<serde_json::Value>,

    /// Result of the previous step.
    pub previous_result: Option<StepResult>,

    /// All completed step results.
    pub steps: Vec<StepResult>,
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
    if let Some(obj) = value.as_object() {
        if let Some(steps) = obj.get("steps") {
            return steps.is_array()
                && steps
                    .as_array()
                    .map(|arr| arr.iter().all(is_pipeline_step))
                    .unwrap_or(false);
        }
    }
    false
}

/// Type guard to check if a value is a PipelineStep.
pub fn is_pipeline_step(value: &serde_json::Value) -> bool {
    if let Some(obj) = value.as_object() {
        if let Some(command) = obj.get("command") {
            return command.is_string();
        }
    }
    false
}

/// Type guard to check if a value is a PipelineResult.
pub fn is_pipeline_result(value: &serde_json::Value) -> bool {
    if let Some(obj) = value.as_object() {
        return obj.contains_key("data")
            && obj.contains_key("metadata")
            && obj.contains_key("steps")
            && obj.get("steps").map(|s| s.is_array()).unwrap_or(false);
    }
    false
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
///
/// # Arguments
///
/// * `steps` - Pipeline steps
/// * `options` - Optional pipeline options
///
/// # Returns
///
/// A PipelineRequest object
pub fn create_pipeline(
    steps: Vec<PipelineStep>,
    options: Option<PipelineOptions>,
) -> PipelineRequest {
    PipelineRequest {
        id: None,
        steps,
        options,
    }
}

/// Calculate aggregated confidence from step results.
///
/// Uses the "weakest link" principle - pipeline confidence is the minimum
/// of all step confidences.
///
/// # Arguments
///
/// * `steps` - Array of step results
///
/// # Returns
///
/// Minimum confidence across all successful steps (0 if no successful steps)
pub fn aggregate_pipeline_confidence(steps: &[StepResult]) -> f64 {
    let confidences: Vec<f64> = steps
        .iter()
        .filter(|s| s.status == StepStatus::Success)
        .map(|s| {
            s.metadata
                .as_ref()
                .and_then(|m| m.confidence)
                .unwrap_or(1.0)
        })
        .collect();

    if confidences.is_empty() {
        0.0
    } else {
        confidences.iter().cloned().fold(f64::INFINITY, f64::min)
    }
}

/// Aggregate reasoning from all steps.
///
/// # Arguments
///
/// * `steps` - Array of step results
///
/// # Returns
///
/// Array of step reasoning with attribution
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

/// Aggregate warnings from all steps.
///
/// # Arguments
///
/// * `steps` - Array of step results
///
/// # Returns
///
/// Array of pipeline warnings with step attribution
pub fn aggregate_pipeline_warnings(steps: &[StepResult]) -> Vec<PipelineWarning> {
    let mut warnings = Vec::new();

    for step in steps {
        if let Some(metadata) = &step.metadata {
            if let Some(step_warnings) = &metadata.warnings {
                for warning in step_warnings {
                    warnings.push(PipelineWarning::from((
                        warning,
                        step.index,
                        step.alias.as_deref(),
                    )));
                }
            }
        }
    }

    warnings
}

/// Aggregate sources from all steps.
///
/// # Arguments
///
/// * `steps` - Array of step results
///
/// # Returns
///
/// Array of pipeline sources with step attribution
pub fn aggregate_pipeline_sources(steps: &[StepResult]) -> Vec<PipelineSource> {
    let mut sources = Vec::new();

    for step in steps {
        if let Some(metadata) = &step.metadata {
            if let Some(step_sources) = &metadata.sources {
                for source in step_sources {
                    sources.push(PipelineSource::from((source, step.index)));
                }
            }
        }
    }

    sources
}

/// Aggregate alternatives from all steps.
///
/// # Arguments
///
/// * `steps` - Array of step results
///
/// # Returns
///
/// Array of pipeline alternatives with step attribution
pub fn aggregate_pipeline_alternatives(steps: &[StepResult]) -> Vec<PipelineAlternative> {
    let mut alternatives = Vec::new();

    for step in steps {
        if let Some(metadata) = &step.metadata {
            if let Some(step_alts) = &metadata.alternatives {
                for alt in step_alts {
                    alternatives.push(PipelineAlternative::from((alt, step.index)));
                }
            }
        }
    }

    alternatives
}

/// Build confidence breakdown from step results.
///
/// # Arguments
///
/// * `steps` - Array of step results
/// * `step_defs` - Original step definitions for alias lookup
///
/// # Returns
///
/// Array of step confidence information
pub fn build_confidence_breakdown(
    steps: &[StepResult],
    step_defs: Option<&[PipelineStep]>,
) -> Vec<StepConfidence> {
    steps
        .iter()
        .filter(|s| s.status == StepStatus::Success)
        .map(|s| {
            let alias = s.alias.clone().or_else(|| {
                step_defs.and_then(|defs| defs.get(s.index).and_then(|d| d.alias.clone()))
            });

            StepConfidence {
                step: s.index,
                alias,
                command: s.command.clone(),
                confidence: s
                    .metadata
                    .as_ref()
                    .and_then(|m| m.confidence)
                    .unwrap_or(1.0),
                reasoning: s.metadata.as_ref().and_then(|m| m.reasoning.clone()),
            }
        })
        .collect()
}

// ═══════════════════════════════════════════════════════════════════════════════
// VARIABLE RESOLUTION
// ═══════════════════════════════════════════════════════════════════════════════

/// Matches a `$steps[n]` prefix; compiled once.
fn step_index_pattern() -> &'static regex::Regex {
    static PATTERN: OnceLock<regex::Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        regex::Regex::new(r"^\$steps\[(\d+)\]").expect("step index regex should be valid")
    })
}

/// Matches an `items[0]` path segment; compiled once rather than per segment.
fn array_index_pattern() -> &'static regex::Regex {
    static PATTERN: OnceLock<regex::Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        regex::Regex::new(r"^(\w+)\[(\d+)\]$").expect("array index regex should be valid")
    })
}

/// Resolve a single variable reference to its value from pipeline context.
///
/// Supports the following variable patterns:
/// - `$prev` - Output of immediately previous step
/// - `$prev.field.subfield` - Nested field from previous output
/// - `$first` - Output of first step
/// - `$first.field` - Field from first step output
/// - `$steps[n]` - Output of step at index n
/// - `$steps[n].field` - Field from step at index n
/// - `$steps.alias` - Output of step with matching `as` alias
/// - `$steps.alias.field` - Field from aliased step
/// - `$input` - Original pipeline input
/// - `$input.field` - Field from pipeline input
///
/// # Arguments
///
/// * `reference` - Variable reference (e.g., '$prev', '$prev.field', '$steps.alias.field')
/// * `context` - Pipeline execution context
///
/// # Returns
///
/// The resolved value, or None if not found
///
/// # Example
///
/// ```rust
/// use afd::pipeline::{resolve_variable, PipelineContext};
///
/// let context = PipelineContext::default();
/// let value = resolve_variable("$prev", &context);
/// ```
pub fn resolve_variable(reference: &str, context: &PipelineContext) -> Option<serde_json::Value> {
    if !reference.starts_with('$') {
        return Some(serde_json::Value::String(reference.to_string()));
    }

    // $prev - previous step's data
    if reference == "$prev" {
        return context
            .previous_result
            .as_ref()
            .and_then(|r| r.data.clone());
    }

    // $first - first step's data
    if reference == "$first" {
        return context.steps.first().and_then(|s| s.data.clone());
    }

    // $input - original pipeline input
    if reference == "$input" {
        return context.pipeline_input.clone();
    }

    // $steps[n] - step at index n
    if reference.starts_with("$steps[") {
        if let Some(captures) = step_index_pattern().captures(reference) {
            let index: usize = captures.get(1)?.as_str().parse().ok()?;
            let step = context.steps.get(index)?;
            let remaining = &reference[captures.get(0)?.end()..];
            if let Some(path) = remaining.strip_prefix('.') {
                return get_nested_value(step.data.as_ref()?, path);
            }
            return step.data.clone();
        }
    }

    // $steps.alias - step with alias
    if let Some(rest) = reference.strip_prefix("$steps.") {
        let dot_index = rest.find('.');
        let alias = match dot_index {
            Some(idx) => &rest[..idx],
            None => rest,
        };
        let step = context
            .steps
            .iter()
            .find(|s| s.alias.as_deref() == Some(alias))?;
        if let Some(idx) = dot_index {
            return get_nested_value(step.data.as_ref()?, &rest[idx + 1..]);
        }
        return step.data.clone();
    }

    // $prev.field - field from previous step
    if let Some(path) = reference.strip_prefix("$prev.") {
        let data = context
            .previous_result
            .as_ref()
            .and_then(|r| r.data.as_ref())?;
        return get_nested_value(data, path);
    }

    // $first.field - field from first step
    if let Some(path) = reference.strip_prefix("$first.") {
        let data = context.steps.first().and_then(|s| s.data.as_ref())?;
        return get_nested_value(data, path);
    }

    // $input.field - field from pipeline input
    if let Some(path) = reference.strip_prefix("$input.") {
        let data = context.pipeline_input.as_ref()?;
        return get_nested_value(data, path);
    }

    None
}

/// Alias for `resolve_variable` for backwards compatibility.
pub fn resolve_reference(reference: &str, context: &PipelineContext) -> Option<serde_json::Value> {
    resolve_variable(reference, context)
}

/// Resolve all variable references in an input value.
///
/// # Arguments
///
/// * `input` - Input value potentially containing variable references
/// * `context` - Pipeline execution context
///
/// # Returns
///
/// Input value with all variables resolved
pub fn resolve_variables(
    input: &serde_json::Value,
    context: &PipelineContext,
) -> serde_json::Value {
    match input {
        serde_json::Value::String(s) if s.starts_with('$') => {
            resolve_variable(s, context).unwrap_or(serde_json::Value::Null)
        }
        serde_json::Value::Array(arr) => serde_json::Value::Array(
            arr.iter()
                .map(|item| resolve_variables(item, context))
                .collect(),
        ),
        serde_json::Value::Object(obj) => {
            let mut new_obj = serde_json::Map::new();
            for (key, value) in obj {
                new_obj.insert(key.clone(), resolve_variables(value, context));
            }
            serde_json::Value::Object(new_obj)
        }
        other => other.clone(),
    }
}

/// Get a nested value from a JSON value using dot notation.
///
/// # Arguments
///
/// * `obj` - The JSON value to traverse
/// * `path` - Dot-separated path (e.g., 'user.profile.name')
///
/// # Returns
///
/// The value at the path, or None if not found
///
/// # Example
///
/// ```rust
/// use afd::pipeline::get_nested_value;
///
/// let obj = serde_json::json!({"user": {"name": "Alice"}});
/// let name = get_nested_value(&obj, "user.name");
/// assert_eq!(name, Some(serde_json::json!("Alice")));
/// ```
pub fn get_nested_value(obj: &serde_json::Value, path: &str) -> Option<serde_json::Value> {
    let parts: Vec<&str> = path.split('.').collect();
    let mut current = obj;

    for part in parts {
        // Handle array index notation (e.g., 'items[0]')
        if let Some(captures) = array_index_pattern().captures(part) {
            let prop = captures.get(1)?.as_str();
            let index: usize = captures.get(2)?.as_str().parse().ok()?;
            current = current.get(prop)?.get(index)?;
        } else {
            current = current.get(part)?;
        }
    }

    Some(current.clone())
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONDITION EVALUATION
// ═══════════════════════════════════════════════════════════════════════════════

/// Evaluate a pipeline condition against the current context.
///
/// # Arguments
///
/// * `condition` - The condition to evaluate
/// * `context` - Pipeline execution context
///
/// # Returns
///
/// true if the condition is met, false otherwise
pub fn evaluate_condition(condition: &PipelineCondition, context: &PipelineContext) -> bool {
    match condition {
        PipelineCondition::Exists { exists } => {
            let value = resolve_variable(exists, context);
            value.is_some() && !value.as_ref().map(|v| v.is_null()).unwrap_or(true)
        }
        PipelineCondition::Eq {
            eq: (ref_str, expected),
        } => {
            let value = resolve_variable(ref_str, context);
            value.as_ref() == Some(expected)
        }
        PipelineCondition::Ne {
            ne: (ref_str, expected),
        } => {
            let value = resolve_variable(ref_str, context);
            value.as_ref() != Some(expected)
        }
        PipelineCondition::Gt {
            gt: (ref_str, threshold),
        } => {
            let value = resolve_variable(ref_str, context);
            value
                .and_then(|v| v.as_f64())
                .map(|n| n > *threshold)
                .unwrap_or(false)
        }
        PipelineCondition::Gte {
            gte: (ref_str, threshold),
        } => {
            let value = resolve_variable(ref_str, context);
            value
                .and_then(|v| v.as_f64())
                .map(|n| n >= *threshold)
                .unwrap_or(false)
        }
        PipelineCondition::Lt {
            lt: (ref_str, threshold),
        } => {
            let value = resolve_variable(ref_str, context);
            value
                .and_then(|v| v.as_f64())
                .map(|n| n < *threshold)
                .unwrap_or(false)
        }
        PipelineCondition::Lte {
            lte: (ref_str, threshold),
        } => {
            let value = resolve_variable(ref_str, context);
            value
                .and_then(|v| v.as_f64())
                .map(|n| n <= *threshold)
                .unwrap_or(false)
        }
        PipelineCondition::And { and: conditions } => {
            conditions.iter().all(|c| evaluate_condition(c, context))
        }
        PipelineCondition::Or { or: conditions } => {
            conditions.iter().any(|c| evaluate_condition(c, context))
        }
        PipelineCondition::Not { not: inner } => !evaluate_condition(inner, context),
    }
}

/// Execute a pipeline of chained commands with variable resolution.
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
            data: serde_json::Value::Null,
            metadata: PipelineMetadata {
                confidence: 0.0,
                confidence_breakdown: vec![],
                reasoning: vec![],
                warnings: vec![],
                sources: vec![],
                alternatives: vec![],
                execution_time_ms: 0,
                completed_steps: 0,
                total_steps: 0,
                result_metadata: None,
            },
            steps: vec![],
        };
    }

    let mut pipeline_context = PipelineContext {
        pipeline_input: context
            .as_ref()
            .map(|ctx| serde_json::Value::Object(ctx.clone().into_iter().collect())),
        previous_result: None,
        steps: vec![],
    };

    let mut step_results = Vec::new();
    let options = request.options.clone().unwrap_or_default();
    let base_context = context.unwrap_or_default();

    let unsupported_deadline = !cfg!(feature = "native") && options.timeout_ms.is_some();
    if options.parallel == Some(true) || unsupported_deadline {
        let unsupported = CommandError {
            code: "UNSUPPORTED_OPTION".to_string(),
            message: if unsupported_deadline {
                "Pipeline deadlines require the native feature".to_string()
            } else {
                "Parallel pipeline execution is not supported".to_string()
            },
            suggestion: Some(if unsupported_deadline {
                "Enable the native feature or omit timeoutMs".to_string()
            } else {
                "Remove parallel or set it to false to execute steps sequentially".to_string()
            }),
            retryable: Some(false),
            details: None,
            cause: None,
        };
        for (i, step) in request.steps.iter().enumerate() {
            step_results.push(StepResult {
                index: i,
                alias: step.alias.clone(),
                command: step.command.clone(),
                status: if i == 0 {
                    StepStatus::Failure
                } else {
                    StepStatus::Skipped
                },
                data: None,
                error: (i == 0).then_some(unsupported.clone()),
                execution_time_ms: 0,
                metadata: None,
            });
        }
        return PipelineResult {
            data: serde_json::Value::Null,
            metadata: PipelineMetadata {
                confidence: 0.0,
                confidence_breakdown: vec![],
                reasoning: vec![],
                warnings: vec![],
                sources: vec![],
                alternatives: vec![],
                execution_time_ms: 0,
                completed_steps: 0,
                total_steps: request.steps.len() as u32,
                result_metadata: None,
            },
            steps: step_results,
        };
    }

    for (i, step) in request.steps.iter().enumerate() {
        let step_start = Instant::now();

        if let Some(condition) = &step.when {
            if !evaluate_condition(condition, &pipeline_context) {
                let skipped = StepResult {
                    index: i,
                    alias: step.alias.clone(),
                    command: step.command.clone(),
                    status: StepStatus::Skipped,
                    data: None,
                    error: None,
                    execution_time_ms: 0,
                    metadata: None,
                };
                step_results.push(skipped.clone());
                pipeline_context.steps.push(skipped);
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

        let execution = execute(step.command.clone(), resolved_input, step_context);
        let result = if let Some(timeout_ms) = options.timeout_ms {
            let elapsed_ms = start_time.elapsed().as_millis() as u64;
            let remaining_ms = timeout_ms.saturating_sub(elapsed_ms);
            if remaining_ms == 0 {
                Err(())
            } else {
                #[cfg(feature = "native")]
                {
                    tokio::time::timeout(std::time::Duration::from_millis(remaining_ms), execution)
                        .await
                        .map_err(|_| ())
                }
                #[cfg(not(feature = "native"))]
                {
                    Ok(execution.await)
                }
            }
        } else {
            Ok(execution.await)
        };
        let result = match result {
            Ok(result) => result,
            Err(()) => {
                let timeout_error = CommandError {
                    code: "PIPELINE_TIMEOUT".to_string(),
                    message: format!(
                        "Pipeline timeout exceeded ({:?}ms)",
                        options.timeout_ms.unwrap_or(0)
                    ),
                    suggestion: Some(
                        "Increase timeoutMs or reduce the number of pipeline steps".to_string(),
                    ),
                    retryable: Some(true),
                    details: None,
                    cause: None,
                };
                step_results.push(StepResult {
                    index: i,
                    alias: step.alias.clone(),
                    command: step.command.clone(),
                    status: StepStatus::Failure,
                    data: None,
                    error: Some(timeout_error.clone()),
                    execution_time_ms: step_start.elapsed().as_millis() as u64,
                    metadata: None,
                });
                for (j, remaining_step) in request.steps.iter().enumerate().skip(i + 1) {
                    step_results.push(StepResult {
                        index: j,
                        alias: remaining_step.alias.clone(),
                        command: remaining_step.command.clone(),
                        status: StepStatus::Skipped,
                        data: None,
                        error: Some(timeout_error.clone()),
                        execution_time_ms: 0,
                        metadata: None,
                    });
                }
                break;
            }
        };
        let step_execution_time_ms = step_start.elapsed().as_millis() as u64;

        if result.success {
            let step_result = StepResult {
                index: i,
                alias: step.alias.clone(),
                command: step.command.clone(),
                status: StepStatus::Success,
                data: result.data.clone(),
                error: None,
                execution_time_ms: step_execution_time_ms,
                metadata: Some(StepMetadata {
                    confidence: result.confidence,
                    reasoning: result.reasoning.clone(),
                    sources: result.sources.clone(),
                    warnings: result.warnings.clone(),
                    alternatives: result.alternatives.clone(),
                }),
            };
            step_results.push(step_result.clone());
            pipeline_context.steps.push(step_result.clone());
            pipeline_context.previous_result = Some(step_result);
        } else {
            let step_result = StepResult {
                index: i,
                alias: step.alias.clone(),
                command: step.command.clone(),
                status: StepStatus::Failure,
                data: None,
                error: result.error.clone(),
                execution_time_ms: step_execution_time_ms,
                metadata: None,
            };
            step_results.push(step_result);

            pipeline_context
                .steps
                .push(step_results.last().cloned().expect("step was added"));

            if options.continue_on_failure != Some(true) {
                for (j, remaining_step) in request.steps.iter().enumerate().skip(i + 1) {
                    step_results.push(StepResult {
                        index: j,
                        alias: remaining_step.alias.clone(),
                        command: remaining_step.command.clone(),
                        status: StepStatus::Skipped,
                        data: None,
                        error: None,
                        execution_time_ms: 0,
                        metadata: None,
                    });
                }
                break;
            }
        }
    }

    let final_data = step_results
        .iter()
        .rev()
        .find(|step| step.status == StepStatus::Success)
        .and_then(|step| step.data.clone())
        .unwrap_or(serde_json::Value::Null);

    PipelineResult {
        data: final_data,
        metadata: PipelineMetadata {
            confidence: aggregate_pipeline_confidence(&step_results),
            confidence_breakdown: build_confidence_breakdown(&step_results, Some(&request.steps)),
            reasoning: aggregate_pipeline_reasoning(&step_results),
            warnings: aggregate_pipeline_warnings(&step_results),
            sources: aggregate_pipeline_sources(&step_results),
            alternatives: aggregate_pipeline_alternatives(&step_results),
            execution_time_ms: start_time.elapsed().as_millis() as u64,
            completed_steps: step_results
                .iter()
                .filter(|step| step.status == StepStatus::Success)
                .count() as u32,
            total_steps: request.steps.len() as u32,
            result_metadata: None,
        },
        steps: step_results,
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;
    use crate::result::{failure, success};

    #[test]
    fn test_pipeline_request_creation() {
        let request = create_pipeline(
            vec![PipelineStep {
                command: "test-command".to_string(),
                input: Some(serde_json::json!({"key": "value"})),
                alias: Some("step1".to_string()),
                when: None,
                stream: None,
            }],
            None,
        );

        assert!(request.id.is_none());
        assert_eq!(request.steps.len(), 1);
        assert_eq!(request.steps[0].command, "test-command");
    }

    #[test]
    fn test_pipeline_step_serialization() {
        let step = PipelineStep {
            command: "user-get".to_string(),
            input: Some(serde_json::json!({"id": 123})),
            alias: Some("user".to_string()),
            when: None,
            stream: None,
        };

        let json = serde_json::to_string(&step).unwrap();
        assert!(json.contains("\"command\":\"user-get\""));
        assert!(json.contains("\"as\":\"user\""));
    }

    #[test]
    fn test_pipeline_condition_exists() {
        let context = PipelineContext {
            previous_result: Some(StepResult {
                index: 0,
                alias: None,
                command: "test".to_string(),
                status: StepStatus::Success,
                data: Some(serde_json::json!({"email": "test@example.com"})),
                error: None,
                execution_time_ms: 10,
                metadata: None,
            }),
            ..Default::default()
        };

        let condition = PipelineCondition::Exists {
            exists: "$prev.email".to_string(),
        };
        assert!(evaluate_condition(&condition, &context));

        let condition_missing = PipelineCondition::Exists {
            exists: "$prev.phone".to_string(),
        };
        assert!(!evaluate_condition(&condition_missing, &context));
    }

    #[test]
    fn test_pipeline_condition_eq() {
        let context = PipelineContext {
            previous_result: Some(StepResult {
                index: 0,
                alias: None,
                command: "test".to_string(),
                status: StepStatus::Success,
                data: Some(serde_json::json!({"tier": "premium"})),
                error: None,
                execution_time_ms: 10,
                metadata: None,
            }),
            ..Default::default()
        };

        let condition = PipelineCondition::Eq {
            eq: ("$prev.tier".to_string(), serde_json::json!("premium")),
        };
        assert!(evaluate_condition(&condition, &context));

        let condition_ne = PipelineCondition::Eq {
            eq: ("$prev.tier".to_string(), serde_json::json!("basic")),
        };
        assert!(!evaluate_condition(&condition_ne, &context));
    }

    #[test]
    fn test_pipeline_condition_numeric() {
        let context = PipelineContext {
            previous_result: Some(StepResult {
                index: 0,
                alias: None,
                command: "test".to_string(),
                status: StepStatus::Success,
                data: Some(serde_json::json!({"count": 5})),
                error: None,
                execution_time_ms: 10,
                metadata: None,
            }),
            ..Default::default()
        };

        let gt = PipelineCondition::Gt {
            gt: ("$prev.count".to_string(), 3.0),
        };
        assert!(evaluate_condition(&gt, &context));

        let lt = PipelineCondition::Lt {
            lt: ("$prev.count".to_string(), 10.0),
        };
        assert!(evaluate_condition(&lt, &context));

        let gte = PipelineCondition::Gte {
            gte: ("$prev.count".to_string(), 5.0),
        };
        assert!(evaluate_condition(&gte, &context));

        let lte = PipelineCondition::Lte {
            lte: ("$prev.count".to_string(), 5.0),
        };
        assert!(evaluate_condition(&lte, &context));
    }

    #[test]
    fn test_pipeline_condition_logical() {
        let context = PipelineContext {
            previous_result: Some(StepResult {
                index: 0,
                alias: None,
                command: "test".to_string(),
                status: StepStatus::Success,
                data: Some(serde_json::json!({"active": true, "tier": "premium"})),
                error: None,
                execution_time_ms: 10,
                metadata: None,
            }),
            ..Default::default()
        };

        let and = PipelineCondition::And {
            and: vec![
                PipelineCondition::Eq {
                    eq: ("$prev.active".to_string(), serde_json::json!(true)),
                },
                PipelineCondition::Eq {
                    eq: ("$prev.tier".to_string(), serde_json::json!("premium")),
                },
            ],
        };
        assert!(evaluate_condition(&and, &context));

        let or = PipelineCondition::Or {
            or: vec![
                PipelineCondition::Eq {
                    eq: ("$prev.tier".to_string(), serde_json::json!("basic")),
                },
                PipelineCondition::Eq {
                    eq: ("$prev.tier".to_string(), serde_json::json!("premium")),
                },
            ],
        };
        assert!(evaluate_condition(&or, &context));

        let not = PipelineCondition::Not {
            not: Box::new(PipelineCondition::Eq {
                eq: ("$prev.tier".to_string(), serde_json::json!("basic")),
            }),
        };
        assert!(evaluate_condition(&not, &context));
    }

    #[test]
    fn test_resolve_variable_prev() {
        let context = PipelineContext {
            previous_result: Some(StepResult {
                index: 0,
                alias: None,
                command: "test".to_string(),
                status: StepStatus::Success,
                data: Some(serde_json::json!({"id": 123, "name": "Test"})),
                error: None,
                execution_time_ms: 10,
                metadata: None,
            }),
            ..Default::default()
        };

        let prev = resolve_variable("$prev", &context);
        assert_eq!(prev, Some(serde_json::json!({"id": 123, "name": "Test"})));

        let prev_id = resolve_variable("$prev.id", &context);
        assert_eq!(prev_id, Some(serde_json::json!(123)));

        let prev_name = resolve_variable("$prev.name", &context);
        assert_eq!(prev_name, Some(serde_json::json!("Test")));
    }

    #[test]
    fn test_resolve_variable_first() {
        let context = PipelineContext {
            steps: vec![
                StepResult {
                    index: 0,
                    alias: None,
                    command: "first".to_string(),
                    status: StepStatus::Success,
                    data: Some(serde_json::json!({"first_data": true})),
                    error: None,
                    execution_time_ms: 10,
                    metadata: None,
                },
                StepResult {
                    index: 1,
                    alias: None,
                    command: "second".to_string(),
                    status: StepStatus::Success,
                    data: Some(serde_json::json!({"second_data": true})),
                    error: None,
                    execution_time_ms: 10,
                    metadata: None,
                },
            ],
            ..Default::default()
        };

        let first = resolve_variable("$first", &context);
        assert_eq!(first, Some(serde_json::json!({"first_data": true})));
    }

    #[test]
    fn test_resolve_variable_alias() {
        let context = PipelineContext {
            steps: vec![StepResult {
                index: 0,
                alias: Some("user".to_string()),
                command: "user-get".to_string(),
                status: StepStatus::Success,
                data: Some(serde_json::json!({"id": 456, "email": "user@test.com"})),
                error: None,
                execution_time_ms: 10,
                metadata: None,
            }],
            ..Default::default()
        };

        let user = resolve_variable("$steps.user", &context);
        assert_eq!(
            user,
            Some(serde_json::json!({"id": 456, "email": "user@test.com"}))
        );

        let email = resolve_variable("$steps.user.email", &context);
        assert_eq!(email, Some(serde_json::json!("user@test.com")));
    }

    #[test]
    fn test_resolve_variable_input() {
        let context = PipelineContext {
            pipeline_input: Some(serde_json::json!({"userId": 789})),
            ..Default::default()
        };

        let input = resolve_variable("$input", &context);
        assert_eq!(input, Some(serde_json::json!({"userId": 789})));

        let user_id = resolve_variable("$input.userId", &context);
        assert_eq!(user_id, Some(serde_json::json!(789)));
    }

    #[test]
    fn test_resolve_variables_object() {
        let context = PipelineContext {
            previous_result: Some(StepResult {
                index: 0,
                alias: None,
                command: "test".to_string(),
                status: StepStatus::Success,
                data: Some(serde_json::json!({"id": 123})),
                error: None,
                execution_time_ms: 10,
                metadata: None,
            }),
            ..Default::default()
        };

        let input = serde_json::json!({
            "userId": "$prev.id",
            "status": "active"
        });

        let resolved = resolve_variables(&input, &context);
        assert_eq!(
            resolved,
            serde_json::json!({
                "userId": 123,
                "status": "active"
            })
        );
    }

    #[test]
    fn test_get_nested_value() {
        let obj = serde_json::json!({
            "user": {
                "profile": {
                    "name": "Alice"
                }
            },
            "items": [1, 2, 3]
        });

        let name = get_nested_value(&obj, "user.profile.name");
        assert_eq!(name, Some(serde_json::json!("Alice")));

        let missing = get_nested_value(&obj, "user.missing.field");
        assert_eq!(missing, None);
    }

    #[test]
    fn test_aggregate_confidence() {
        let steps = vec![
            StepResult {
                index: 0,
                alias: None,
                command: "cmd1".to_string(),
                status: StepStatus::Success,
                data: Some(serde_json::json!({})),
                error: None,
                execution_time_ms: 10,
                metadata: Some(StepMetadata {
                    confidence: Some(0.9),
                    ..Default::default()
                }),
            },
            StepResult {
                index: 1,
                alias: None,
                command: "cmd2".to_string(),
                status: StepStatus::Success,
                data: Some(serde_json::json!({})),
                error: None,
                execution_time_ms: 10,
                metadata: Some(StepMetadata {
                    confidence: Some(0.7),
                    ..Default::default()
                }),
            },
            StepResult {
                index: 2,
                alias: None,
                command: "cmd3".to_string(),
                status: StepStatus::Failure,
                data: None,
                error: Some(CommandError::internal("failed")),
                execution_time_ms: 10,
                metadata: Some(StepMetadata {
                    confidence: Some(0.5),
                    ..Default::default()
                }),
            },
        ];

        // Should use weakest link (0.7), ignoring failed step
        let confidence = aggregate_pipeline_confidence(&steps);
        assert!((confidence - 0.7).abs() < 0.001);
    }

    #[test]
    fn test_type_guards() {
        let request = serde_json::json!({
            "steps": [
                {"command": "test"}
            ]
        });
        assert!(is_pipeline_request(&request));

        let step = serde_json::json!({"command": "test"});
        assert!(is_pipeline_step(&step));

        let result = serde_json::json!({
            "data": {},
            "metadata": {},
            "steps": []
        });
        assert!(is_pipeline_result(&result));

        let condition = serde_json::json!({
            "$exists": "$prev.id"
        });
        assert!(is_pipeline_condition(&condition));
    }

    #[test]
    fn test_condition_type_guards() {
        let exists = PipelineCondition::from(PipelineConditionExists {
            exists: "$prev.id".to_string(),
        });
        let eq = PipelineCondition::from(PipelineConditionEq {
            eq: ("$prev.tier".to_string(), serde_json::json!("premium")),
        });
        let and = PipelineCondition::from(PipelineConditionAnd {
            and: vec![exists.clone(), eq.clone()],
        });

        assert!(is_exists_condition(&exists));
        assert!(is_eq_condition(&eq));
        assert!(is_and_condition(&and));
        assert!(!is_or_condition(&and));
    }

    #[test]
    fn test_resolve_reference_alias() {
        let context = PipelineContext {
            previous_result: Some(StepResult {
                index: 0,
                alias: None,
                command: "test".to_string(),
                status: StepStatus::Success,
                data: Some(serde_json::json!({"id": 123})),
                error: None,
                execution_time_ms: 10,
                metadata: None,
            }),
            ..Default::default()
        };

        assert_eq!(
            resolve_reference("$prev.id", &context),
            Some(serde_json::json!(123))
        );
    }

    #[test]
    fn test_step_status_serialization() {
        let success = StepStatus::Success;
        let json = serde_json::to_string(&success).unwrap();
        assert_eq!(json, "\"success\"");

        let failure = StepStatus::Failure;
        let json = serde_json::to_string(&failure).unwrap();
        assert_eq!(json, "\"failure\"");

        let skipped = StepStatus::Skipped;
        let json = serde_json::to_string(&skipped).unwrap();
        assert_eq!(json, "\"skipped\"");
    }

    #[test]
    fn test_pipeline_metadata_default() {
        let metadata = PipelineMetadata::default();
        assert_eq!(metadata.confidence, 1.0);
        assert_eq!(metadata.completed_steps, 0);
        assert_eq!(metadata.total_steps, 0);
        assert!(metadata.warnings.is_empty());
    }

    #[test]
    fn test_aggregate_warnings() {
        let steps = vec![StepResult {
            index: 0,
            alias: Some("step1".to_string()),
            command: "cmd1".to_string(),
            status: StepStatus::Success,
            data: Some(serde_json::json!({})),
            error: None,
            execution_time_ms: 10,
            metadata: Some(StepMetadata {
                warnings: Some(vec![Warning::new("DEPRECATION", "This is deprecated")]),
                ..Default::default()
            }),
        }];

        let warnings = aggregate_pipeline_warnings(&steps);
        assert_eq!(warnings.len(), 1);
        assert_eq!(warnings[0].code, "DEPRECATION");
        assert_eq!(warnings[0].step_index, 0);
        assert_eq!(warnings[0].step_alias, Some("step1".to_string()));
    }

    #[tokio::test]
    async fn test_execute_pipeline_single_step() {
        let executor: CommandExecutor = Arc::new(|name, _input, _ctx| {
            Box::pin(async move {
                if name == "user-get" {
                    success(serde_json::json!({"id": 1, "name": "Alice"}))
                } else {
                    failure(CommandError::new(
                        "COMMAND_NOT_FOUND",
                        format!("Command '{name}' not found"),
                    ))
                }
            })
        });

        let result = execute_pipeline(
            &PipelineRequest {
                id: None,
                steps: vec![PipelineStep {
                    command: "user-get".to_string(),
                    input: Some(serde_json::json!({"id": 1})),
                    alias: None,
                    when: None,
                    stream: None,
                }],
                options: None,
            },
            &executor,
            None,
        )
        .await;

        assert_eq!(result.data, serde_json::json!({"id": 1, "name": "Alice"}));
        assert_eq!(result.steps.len(), 1);
        assert_eq!(result.steps[0].status, StepStatus::Success);
    }

    #[tokio::test]
    async fn test_execute_pipeline_stops_on_failure() {
        let executor: CommandExecutor = Arc::new(|name, _input, _ctx| {
            Box::pin(async move {
                match name.as_str() {
                    "step-a" => success(serde_json::json!("a")),
                    "step-b" => failure(CommandError::new("FAIL", "Step B failed")),
                    _ => success(serde_json::json!("c")),
                }
            })
        });

        let result = execute_pipeline(
            &PipelineRequest {
                id: None,
                steps: vec![
                    PipelineStep {
                        command: "step-a".to_string(),
                        input: None,
                        alias: None,
                        when: None,
                        stream: None,
                    },
                    PipelineStep {
                        command: "step-b".to_string(),
                        input: None,
                        alias: None,
                        when: None,
                        stream: None,
                    },
                    PipelineStep {
                        command: "step-c".to_string(),
                        input: None,
                        alias: None,
                        when: None,
                        stream: None,
                    },
                ],
                options: None,
            },
            &executor,
            None,
        )
        .await;

        assert_eq!(result.steps[0].status, StepStatus::Success);
        assert_eq!(result.steps[1].status, StepStatus::Failure);
        assert_eq!(result.steps[2].status, StepStatus::Skipped);
    }

    #[tokio::test]
    async fn test_parallel_pipeline_is_rejected_before_execution() {
        let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let executor_calls = Arc::clone(&calls);
        let executor: CommandExecutor = Arc::new(move |_name, _input, _ctx| {
            executor_calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Box::pin(async { success(serde_json::json!({})) })
        });
        let result = execute_pipeline(
            &PipelineRequest {
                id: None,
                steps: vec![PipelineStep {
                    command: "step-a".to_string(),
                    input: None,
                    alias: None,
                    when: None,
                    stream: None,
                }],
                options: Some(PipelineOptions {
                    parallel: Some(true),
                    ..Default::default()
                }),
            },
            &executor,
            None,
        )
        .await;

        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 0);
        assert_eq!(
            result.steps[0].error.as_ref().unwrap().code,
            "UNSUPPORTED_OPTION"
        );
    }

    #[tokio::test]
    async fn test_pipeline_timeout_interrupts_current_step() {
        let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let executor_calls = Arc::clone(&calls);
        let executor: CommandExecutor = Arc::new(move |_name, _input, _ctx| {
            executor_calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Box::pin(async {
                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                success(serde_json::json!({}))
            })
        });
        let result = execute_pipeline(
            &PipelineRequest {
                id: None,
                steps: vec![PipelineStep {
                    command: "slow-step".to_string(),
                    input: None,
                    alias: None,
                    when: None,
                    stream: None,
                }],
                options: Some(PipelineOptions {
                    timeout_ms: Some(5),
                    ..Default::default()
                }),
            },
            &executor,
            None,
        )
        .await;

        assert_eq!(
            result.steps[0].error.as_ref().unwrap().code,
            if cfg!(feature = "native") {
                "PIPELINE_TIMEOUT"
            } else {
                "UNSUPPORTED_OPTION"
            }
        );
        assert_eq!(
            calls.load(std::sync::atomic::Ordering::SeqCst),
            usize::from(cfg!(feature = "native"))
        );
        assert!(result.metadata.execution_time_ms < 100);
    }
}
