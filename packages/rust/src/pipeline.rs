//! Pipeline types for chaining AFD commands.
//!
//! Pipelines enable declarative composition of commands where the output of one
//! becomes the input of the next. Key features:
//! - Variable resolution ($prev, $first, $steps[n], $steps.alias)
//! - Conditional execution with when clauses
//! - Trust signal propagation (confidence, reasoning, sources)
//! - Error propagation with actionable suggestions

use serde::{Deserialize, Serialize};

use crate::errors::CommandError;
use crate::metadata::{Alternative, Source, Warning};
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

    /// Execute steps in parallel where dependencies allow.
    ///
    /// Steps that don't reference $prev can potentially run in parallel.
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
pub fn create_pipeline(steps: Vec<PipelineStep>, options: Option<PipelineOptions>) -> PipelineRequest {
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
            let alias = s
                .alias
                .clone()
                .or_else(|| step_defs.and_then(|defs| defs.get(s.index).and_then(|d| d.alias.clone())));

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
        return context.previous_result.as_ref().and_then(|r| r.data.clone());
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
        let re = regex::Regex::new(r"^\$steps\[(\d+)\]").ok()?;
        if let Some(captures) = re.captures(reference) {
            let index: usize = captures.get(1)?.as_str().parse().ok()?;
            let step = context.steps.get(index)?;
            let remaining = &reference[captures.get(0)?.end()..];
            if remaining.starts_with('.') {
                return get_nested_value(step.data.as_ref()?, &remaining[1..]);
            }
            return step.data.clone();
        }
    }

    // $steps.alias - step with alias
    if reference.starts_with("$steps.") {
        let rest = &reference[7..]; // Remove '$steps.'
        let dot_index = rest.find('.');
        let alias = match dot_index {
            Some(idx) => &rest[..idx],
            None => rest,
        };
        let step = context.steps.iter().find(|s| s.alias.as_deref() == Some(alias))?;
        if let Some(idx) = dot_index {
            return get_nested_value(step.data.as_ref()?, &rest[idx + 1..]);
        }
        return step.data.clone();
    }

    // $prev.field - field from previous step
    if reference.starts_with("$prev.") {
        let data = context.previous_result.as_ref().and_then(|r| r.data.as_ref())?;
        return get_nested_value(data, &reference[6..]);
    }

    // $first.field - field from first step
    if reference.starts_with("$first.") {
        let data = context.steps.first().and_then(|s| s.data.as_ref())?;
        return get_nested_value(data, &reference[7..]);
    }

    // $input.field - field from pipeline input
    if reference.starts_with("$input.") {
        let data = context.pipeline_input.as_ref()?;
        return get_nested_value(data, &reference[7..]);
    }

    None
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
        serde_json::Value::Array(arr) => {
            serde_json::Value::Array(arr.iter().map(|item| resolve_variables(item, context)).collect())
        }
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
        let array_re = regex::Regex::new(r"^(\w+)\[(\d+)\]$").ok()?;
        if let Some(captures) = array_re.captures(part) {
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
        PipelineCondition::Eq { eq: (ref_str, expected) } => {
            let value = resolve_variable(ref_str, context);
            value.as_ref() == Some(expected)
        }
        PipelineCondition::Ne { ne: (ref_str, expected) } => {
            let value = resolve_variable(ref_str, context);
            value.as_ref() != Some(expected)
        }
        PipelineCondition::Gt { gt: (ref_str, threshold) } => {
            let value = resolve_variable(ref_str, context);
            value
                .and_then(|v| v.as_f64())
                .map(|n| n > *threshold)
                .unwrap_or(false)
        }
        PipelineCondition::Gte { gte: (ref_str, threshold) } => {
            let value = resolve_variable(ref_str, context);
            value
                .and_then(|v| v.as_f64())
                .map(|n| n >= *threshold)
                .unwrap_or(false)
        }
        PipelineCondition::Lt { lt: (ref_str, threshold) } => {
            let value = resolve_variable(ref_str, context);
            value
                .and_then(|v| v.as_f64())
                .map(|n| n < *threshold)
                .unwrap_or(false)
        }
        PipelineCondition::Lte { lte: (ref_str, threshold) } => {
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

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

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
        let mut context = PipelineContext::default();
        context.previous_result = Some(StepResult {
            index: 0,
            alias: None,
            command: "test".to_string(),
            status: StepStatus::Success,
            data: Some(serde_json::json!({"email": "test@example.com"})),
            error: None,
            execution_time_ms: 10,
            metadata: None,
        });

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
        let mut context = PipelineContext::default();
        context.previous_result = Some(StepResult {
            index: 0,
            alias: None,
            command: "test".to_string(),
            status: StepStatus::Success,
            data: Some(serde_json::json!({"tier": "premium"})),
            error: None,
            execution_time_ms: 10,
            metadata: None,
        });

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
        let mut context = PipelineContext::default();
        context.previous_result = Some(StepResult {
            index: 0,
            alias: None,
            command: "test".to_string(),
            status: StepStatus::Success,
            data: Some(serde_json::json!({"count": 5})),
            error: None,
            execution_time_ms: 10,
            metadata: None,
        });

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
        let mut context = PipelineContext::default();
        context.previous_result = Some(StepResult {
            index: 0,
            alias: None,
            command: "test".to_string(),
            status: StepStatus::Success,
            data: Some(serde_json::json!({"active": true, "tier": "premium"})),
            error: None,
            execution_time_ms: 10,
            metadata: None,
        });

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
        let mut context = PipelineContext::default();
        context.previous_result = Some(StepResult {
            index: 0,
            alias: None,
            command: "test".to_string(),
            status: StepStatus::Success,
            data: Some(serde_json::json!({"id": 123, "name": "Test"})),
            error: None,
            execution_time_ms: 10,
            metadata: None,
        });

        let prev = resolve_variable("$prev", &context);
        assert_eq!(prev, Some(serde_json::json!({"id": 123, "name": "Test"})));

        let prev_id = resolve_variable("$prev.id", &context);
        assert_eq!(prev_id, Some(serde_json::json!(123)));

        let prev_name = resolve_variable("$prev.name", &context);
        assert_eq!(prev_name, Some(serde_json::json!("Test")));
    }

    #[test]
    fn test_resolve_variable_first() {
        let mut context = PipelineContext::default();
        context.steps = vec![
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
        ];

        let first = resolve_variable("$first", &context);
        assert_eq!(first, Some(serde_json::json!({"first_data": true})));
    }

    #[test]
    fn test_resolve_variable_alias() {
        let mut context = PipelineContext::default();
        context.steps = vec![StepResult {
            index: 0,
            alias: Some("user".to_string()),
            command: "user-get".to_string(),
            status: StepStatus::Success,
            data: Some(serde_json::json!({"id": 456, "email": "user@test.com"})),
            error: None,
            execution_time_ms: 10,
            metadata: None,
        }];

        let user = resolve_variable("$steps.user", &context);
        assert_eq!(user, Some(serde_json::json!({"id": 456, "email": "user@test.com"})));

        let email = resolve_variable("$steps.user.email", &context);
        assert_eq!(email, Some(serde_json::json!("user@test.com")));
    }

    #[test]
    fn test_resolve_variable_input() {
        let mut context = PipelineContext::default();
        context.pipeline_input = Some(serde_json::json!({"userId": 789}));

        let input = resolve_variable("$input", &context);
        assert_eq!(input, Some(serde_json::json!({"userId": 789})));

        let user_id = resolve_variable("$input.userId", &context);
        assert_eq!(user_id, Some(serde_json::json!(789)));
    }

    #[test]
    fn test_resolve_variables_object() {
        let mut context = PipelineContext::default();
        context.previous_result = Some(StepResult {
            index: 0,
            alias: None,
            command: "test".to_string(),
            status: StepStatus::Success,
            data: Some(serde_json::json!({"id": 123})),
            error: None,
            execution_time_ms: 10,
            metadata: None,
        });

        let input = serde_json::json!({
            "userId": "$prev.id",
            "status": "active"
        });

        let resolved = resolve_variables(&input, &context);
        assert_eq!(resolved, serde_json::json!({
            "userId": 123,
            "status": "active"
        }));
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
}
