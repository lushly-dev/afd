//! Variable references and `when` conditions (`spec/pipeline-variables.md`): what a step input
//! string or a condition means against the steps that have run.

use regex::Regex;
use std::sync::OnceLock;

use super::*;

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
    value.len() > MAX_REFERENCE_LENGTH
        && value.encode_utf16().take(MAX_REFERENCE_LENGTH + 1).count() > MAX_REFERENCE_LENGTH
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
