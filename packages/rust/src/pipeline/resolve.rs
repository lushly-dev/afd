//! Variable references and `when` conditions (`spec/pipeline-variables.md`): what a step input
//! string or a condition means against the steps that have run.

use regex::Regex;
use std::collections::HashSet;
use std::sync::OnceLock;

use super::*;

/// JavaScript's `\s` (ECMAScript WhiteSpace and LineTerminator, 25 code points;
/// `spec/pipeline-variables.md`, #1962). Enumerated explicitly because Rust `regex`'s
/// Unicode `\s` includes U+0085 (NEL) and omits U+FEFF (BOM).
const JS_WHITESPACE: &str = r"\t\n\x0B\x0C\r \u{00A0}\u{1680}\u{2000}-\u{200A}\u{2028}\u{2029}\u{202F}\u{205F}\u{3000}\u{FEFF}";

/// The complete reference grammar; compiled once.
///
/// Groups: 1 = `prev`/`first`/`input`, 2 = step index, 3 = step alias, 4 = path.
fn reference_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        let pattern = format!(
            r"^\$(?:(prev|first|input)|steps\[([0-9]+)\]|steps\.([^.\[\]{JS_WHITESPACE}]+))((?:\.[^.\[\]{JS_WHITESPACE}]+(?:\[[0-9]+\])?)*)$"
        );
        Regex::new(&pattern).expect("reference regex should be valid")
    })
}

/// A path segment: a key with an optional `[index]`; compiled once.
fn path_segment_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        let pattern = format!(r"^([^.\[\]{JS_WHITESPACE}]+)(?:\[([0-9]+)\])?$");
        Regex::new(&pattern).expect("path segment regex should be valid")
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
    value.len() > MAX_REFERENCE_LENGTH
        && value.encode_utf16().take(MAX_REFERENCE_LENGTH + 1).count() > MAX_REFERENCE_LENGTH
}

/// The step `$prev` reads while one step input resolves under the budget: the step's entry in
/// `steps` when it holds the same step and data as `previous_result` (the executor stores a clone
/// there), so `$prev` and `$steps[N]` reach one value and a repeat is recognized by address.
/// Otherwise `previous_result`, which is always what `$prev` means.
fn canonical_previous(context: &PipelineContext) -> Option<&StepResult> {
    let previous = context.previous_result.as_ref()?;
    Some(
        context
            .steps
            .get(previous.index)
            .filter(|step| {
                step.index == previous.index
                    && step.status == previous.status
                    && step.command == previous.command
                    && step.alias == previous.alias
                    && step.data == previous.data
            })
            .unwrap_or(previous),
    )
}

fn resolve_string<'s, 'c>(value: &'s str, context: &'c PipelineContext) -> Resolution<'s, 'c> {
    resolve_string_with(value, context, context.previous_result.as_ref())
}

/// [`resolve_string`], with `previous` as the step `$prev` reads.
fn resolve_string_with<'s, 'c>(
    value: &'s str,
    context: &'c PipelineContext,
    previous: Option<&'c StepResult>,
) -> Resolution<'s, 'c> {
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
            "prev" => previous.and_then(|step| step.data.as_ref()),
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

/// Whether `value` holds a reference to an earlier step's data (`$prev`, `$first`, `$steps`),
/// so it is not known until the pipeline runs (#459). `$input` references and literals are known
/// up front. Iterative; containers nested deeper than [`MAX_INPUT_DEPTH`] count as reading step
/// data (the pipeline rejects them before any step runs).
#[cfg_attr(not(feature = "server"), allow(dead_code))]
pub(crate) fn reads_step_data(value: &serde_json::Value) -> bool {
    let mut pending = vec![(value, 1usize)];
    while let Some((value, depth)) = pending.pop() {
        match value {
            serde_json::Value::String(text) => {
                if text.starts_with("$$") || exceeds_reference_length(text) {
                    continue;
                }
                let reads = reference_pattern().captures(text).is_some_and(|captures| {
                    captures.get(1).map(|name| name.as_str()) != Some("input")
                });
                if reads {
                    return true;
                }
            }
            serde_json::Value::Array(items) if depth <= MAX_INPUT_DEPTH => {
                pending.extend(items.iter().map(|item| (item, depth + 1)));
            }
            serde_json::Value::Object(map) if depth <= MAX_INPUT_DEPTH => {
                pending.extend(map.values().map(|item| (item, depth + 1)));
            }
            serde_json::Value::Array(_) | serde_json::Value::Object(_) => return true,
            _ => {}
        }
    }
    false
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
/// escape reduced to `$`). See the [module documentation](crate::pipeline) for the rules.
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

/// Which limit a step input exceeded (`spec/pipeline-variables.md`, Limits).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResolutionLimit {
    /// The input, or a value copied into it, nests deeper than [`MAX_INPUT_DEPTH`] levels.
    Depth,
    /// More than [`MAX_RESOLVED_NODES`] values.
    Nodes,
    /// More than [`MAX_RESOLVED_CHARS`] string and key characters.
    Chars,
}

impl ResolutionLimit {
    /// The limit's name on the wire: `"depth"`, `"nodes"` or `"chars"`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Depth => "depth",
            Self::Nodes => "nodes",
            Self::Chars => "chars",
        }
    }
}

/// A step input exceeded the nesting depth or the expansion budget.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ResolutionLimitError {
    /// The limit it exceeded.
    pub limit: ResolutionLimit,
}

impl std::fmt::Display for ResolutionLimitError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self.limit {
            ResolutionLimit::Depth => write!(
                f,
                "Pipeline step input is nested deeper than {MAX_INPUT_DEPTH} levels"
            ),
            ResolutionLimit::Nodes => write!(
                f,
                "Pipeline variable expansion limit exceeded (more than {MAX_RESOLVED_NODES} values)"
            ),
            ResolutionLimit::Chars => write!(
                f,
                "Pipeline variable expansion limit exceeded (more than {MAX_RESOLVED_CHARS} characters)"
            ),
        }
    }
}

impl std::error::Error for ResolutionLimitError {}

fn limit(limit: ResolutionLimit) -> ResolutionLimitError {
    ResolutionLimitError { limit }
}

/// The expansion budget of one step input.
struct Budget<'c> {
    /// The step `$prev` reads ([`canonical_previous`]), found at the first `$prev`.
    previous: Option<Option<&'c StepResult>>,
    nodes: usize,
    chars: usize,
    /// Containers already expanded, by address, and non-empty strings, by value.
    seen_containers: HashSet<*const serde_json::Value>,
    seen_strings: HashSet<&'c str>,
}

impl<'c> Budget<'c> {
    fn new() -> Self {
        Self {
            previous: None,
            nodes: MAX_RESOLVED_NODES,
            chars: MAX_RESOLVED_CHARS,
            seen_containers: HashSet::new(),
            seen_strings: HashSet::new(),
        }
    }

    fn node(&mut self, charge: bool) -> Result<(), ResolutionLimitError> {
        if charge {
            self.nodes = self
                .nodes
                .checked_sub(1)
                .ok_or(limit(ResolutionLimit::Nodes))?;
        }
        Ok(())
    }

    /// Charge a string's length in UTF-16 code units, as JavaScript's `length`.
    fn text(&mut self, text: &str, charge: bool) -> Result<(), ResolutionLimitError> {
        if charge {
            self.chars = self
                .chars
                .checked_sub(text.encode_utf16().count())
                .ok_or(limit(ResolutionLimit::Chars))?;
        }
        Ok(())
    }

    /// Record a referenced value; `true` the first time this step input expands it.
    fn first_expansion(&mut self, value: &'c serde_json::Value) -> bool {
        match value {
            serde_json::Value::Array(_) | serde_json::Value::Object(_) => self
                .seen_containers
                .insert(value as *const serde_json::Value),
            serde_json::Value::String(text) if !text.is_empty() => {
                self.seen_strings.insert(text.as_str())
            }
            _ => false,
        }
    }
}

/// Copy a referenced value, at most [`MAX_INPUT_DEPTH`] levels deep, charging it when it is a
/// repeat.
fn copy_resolved(
    value: &serde_json::Value,
    depth: usize,
    budget: &mut Budget<'_>,
    charge: bool,
) -> Result<serde_json::Value, ResolutionLimitError> {
    budget.node(charge)?;
    match value {
        serde_json::Value::String(text) => {
            budget.text(text, charge)?;
            Ok(value.clone())
        }
        serde_json::Value::Array(_) | serde_json::Value::Object(_) if depth >= MAX_INPUT_DEPTH => {
            Err(limit(ResolutionLimit::Depth))
        }
        serde_json::Value::Array(items) => items
            .iter()
            .map(|item| copy_resolved(item, depth + 1, budget, charge))
            .collect::<Result<_, _>>()
            .map(serde_json::Value::Array),
        serde_json::Value::Object(map) => {
            let mut copied = serde_json::Map::new();
            for (key, item) in map {
                budget.text(key, charge)?;
                copied.insert(key.clone(), copy_resolved(item, depth + 1, budget, charge)?);
            }
            Ok(serde_json::Value::Object(copied))
        }
        _ => Ok(value.clone()),
    }
}

/// Resolve a step input under the budget; `None` is an unresolved reference.
fn resolve_bounded<'c>(
    input: &serde_json::Value,
    context: &'c PipelineContext,
    depth: usize,
    budget: &mut Budget<'c>,
) -> Result<Option<serde_json::Value>, ResolutionLimitError> {
    if let serde_json::Value::String(text) = input {
        let previous = if text.starts_with("$prev") {
            *budget
                .previous
                .get_or_insert_with(|| canonical_previous(context))
        } else {
            context.previous_result.as_ref()
        };
        return match resolve_string_with(text, context, previous) {
            Resolution::Literal(literal) => {
                budget.node(true)?;
                budget.text(literal, true)?;
                Ok(Some(serde_json::Value::String(literal.to_owned())))
            }
            Resolution::Absent => Ok(None),
            Resolution::Value(value) => {
                // The first expansion of a value is not charged, so one large step output still
                // flows through `$prev`; repeats are charged in full.
                let charge = !budget.first_expansion(value);
                budget.node(true)?;
                copy_resolved(value, 0, budget, charge).map(Some)
            }
        };
    }
    budget.node(true)?;
    match input {
        serde_json::Value::Array(_) | serde_json::Value::Object(_) if depth >= MAX_INPUT_DEPTH => {
            Err(limit(ResolutionLimit::Depth))
        }
        serde_json::Value::Array(items) => {
            let mut resolved = Vec::with_capacity(items.len());
            for item in items {
                resolved.push(match resolve_bounded(item, context, depth + 1, budget)? {
                    Some(value) => value,
                    None => {
                        budget.node(true)?;
                        serde_json::Value::Null
                    }
                });
            }
            Ok(Some(serde_json::Value::Array(resolved)))
        }
        serde_json::Value::Object(map) => {
            let mut resolved = serde_json::Map::new();
            for (key, item) in map {
                budget.text(key, true)?;
                if let Some(value) = resolve_bounded(item, context, depth + 1, budget)? {
                    resolved.insert(key.clone(), value);
                }
            }
            Ok(Some(serde_json::Value::Object(resolved)))
        }
        other => Ok(Some(other.clone())),
    }
}

/// Resolve all variable references in a step input, within the limits of
/// `spec/pipeline-variables.md` (as [`execute_pipeline`](super::execute_pipeline) does).
///
/// Unresolved references are omitted from objects and become `null` in
/// arrays; an unresolved top-level reference becomes `null`.
///
/// # Errors
///
/// [`ResolutionLimitError`] when the input, or a value copied into it, nests
/// deeper than [`MAX_INPUT_DEPTH`] levels, or the resolved input holds more
/// than [`MAX_RESOLVED_NODES`] values or [`MAX_RESOLVED_CHARS`] string and key
/// characters (UTF-16 code units). Only a repeated expansion of the same
/// referenced value is charged for its contents.
///
/// # Example
///
/// ```rust
/// use afd::pipeline::{try_resolve_variables, PipelineContext, ResolutionLimit};
///
/// let context = PipelineContext::new(Some(serde_json::json!({"rows": vec![0; 1_000]})));
/// let once = try_resolve_variables(&serde_json::json!({"a": "$input.rows"}), &context);
/// assert!(once.is_ok());
/// let fan_out = serde_json::json!({"a": vec!["$input.rows"; 200]});
/// let error = try_resolve_variables(&fan_out, &context).unwrap_err();
/// assert_eq!(error.limit, ResolutionLimit::Nodes);
/// ```
pub fn try_resolve_variables(
    input: &serde_json::Value,
    context: &PipelineContext,
) -> Result<serde_json::Value, ResolutionLimitError> {
    Ok(resolve_bounded(input, context, 0, &mut Budget::new())?.unwrap_or_default())
}

/// Resolve all variable references in an input value.
///
/// Unresolved references are omitted from objects and become `null` in
/// arrays; an unresolved top-level reference becomes `null`. Containers
/// nested deeper than [`MAX_INPUT_DEPTH`] are replaced by `null` (the pipeline
/// executor rejects such inputs before running any step).
///
/// This applies no expansion budget, so repeated references to a large value
/// copy it in full each time: for input you do not control, use
/// [`try_resolve_variables`], which the pipeline executor uses.
pub fn resolve_variables(
    input: &serde_json::Value,
    context: &PipelineContext,
) -> serde_json::Value {
    resolve_value(input, context, 1).unwrap_or_default()
}

/// Whether a value has containers nested deeper than `max_depth` levels.
///
/// The top-level container is level 1. Iterative, so it never overflows the stack.
pub(super) fn exceeds_depth(value: &serde_json::Value, max_depth: usize) -> bool {
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

/// A condition operand: the value of a reference, or `None` (absent) for a
/// literal or an unresolved reference. Absent operands make every comparison
/// false.
fn condition_operand<'c>(
    reference: &str,
    context: &'c PipelineContext,
) -> Option<&'c serde_json::Value> {
    match resolve_string(reference, context) {
        Resolution::Value(value) => Some(value),
        Resolution::Literal(_) | Resolution::Absent => None,
    }
}

/// Structural equality of JSON values, with numbers compared by value as
/// JavaScript compares them (`2` equals `2.0`).
fn json_equal(a: &serde_json::Value, b: &serde_json::Value) -> bool {
    use serde_json::Value;
    match (a, b) {
        (Value::Number(a), Value::Number(b)) => a.as_f64() == b.as_f64(),
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(a, b)| json_equal(a, b))
        }
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len()
                && a.iter()
                    .all(|(key, a)| b.get(key).is_some_and(|b| json_equal(a, b)))
        }
        _ => a == b,
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
/// The first operand of every comparison is a reference. A literal (such as
/// `"$$prev"` or `"text"`) or an unresolved reference is absent: `$exists` is
/// `false` (also for `null`) and every comparison, including `$ne`, is
/// `false`. `$eq` and `$ne` compare JSON values structurally, with numbers
/// compared by value.
pub fn evaluate_condition(condition: &PipelineCondition, context: &PipelineContext) -> bool {
    match condition {
        PipelineCondition::Exists { exists } => {
            condition_operand(exists, context).is_some_and(|value| !value.is_null())
        }
        PipelineCondition::Eq {
            eq: (reference, expected),
        } => condition_operand(reference, context).is_some_and(|value| json_equal(value, expected)),
        PipelineCondition::Ne {
            ne: (reference, expected),
        } => {
            condition_operand(reference, context).is_some_and(|value| !json_equal(value, expected))
        }
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
