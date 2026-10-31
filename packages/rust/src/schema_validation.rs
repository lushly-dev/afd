//! Whole-schema validation without changing the legacy public schema types.
use std::collections::HashMap;

use serde_json::{json, Map, Value};

use crate::{error_codes, CommandError};

const ANNOTATIONS: &[&str] = &[
    "title",
    "description",
    "examples",
    "deprecated",
    "readOnly",
    "writeOnly",
    "$comment",
    "$schema",
    "$id",
    "default",
];
const KEYWORDS: &[&str] = &[
    "type",
    "properties",
    "required",
    "enum",
    "items",
    "minItems",
    "maxItems",
    "minLength",
    "maxLength",
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "additionalProperties",
    "$ref",
    "definitions",
    "$defs",
    "const",
];

pub(crate) fn compile(schema: &Value) -> Result<(), String> {
    inspect(schema, schema, "#")
}

fn inspect(schema: &Value, root: &Value, path: &str) -> Result<(), String> {
    let object = schema
        .as_object()
        .ok_or_else(|| format!("Schema at {path} must be an object"))?;
    for (key, value) in object {
        let location = format!("{path}/{key}");
        if !KEYWORDS.contains(&key.as_str()) && !ANNOTATIONS.contains(&key.as_str()) {
            return Err(format!("Unsupported keyword '{key}' at {location}"));
        }
        match key.as_str() {
            "properties" | "definitions" | "$defs" => {
                for (name, child) in value
                    .as_object()
                    .ok_or_else(|| format!("Expected object at {location}"))?
                {
                    inspect(child, root, &format!("{location}/{name}"))?;
                }
            }
            "items" => inspect(value, root, &location)?,
            "additionalProperties" if !value.is_boolean() => inspect(value, root, &location)?,
            "$ref" => {
                let reference = value
                    .as_str()
                    .ok_or_else(|| format!("Invalid $ref at {location}"))?;
                if target(root, reference).is_none() {
                    return Err(format!("Unresolved local $ref at {location}: {reference}"));
                }
            }
            "type" => {
                let types: Vec<&Value> = value
                    .as_array()
                    .map(|types| types.iter().collect())
                    .unwrap_or_else(|| vec![value]);
                if types.is_empty()
                    || types.iter().any(|kind| {
                        !matches!(
                            kind.as_str(),
                            Some(
                                "string"
                                    | "number"
                                    | "integer"
                                    | "boolean"
                                    | "object"
                                    | "array"
                                    | "null"
                            )
                        )
                    })
                {
                    return Err(format!("Invalid type at {location}"));
                }
            }
            "required"
                if !value
                    .as_array()
                    .is_some_and(|items| items.iter().all(Value::is_string)) =>
            {
                return Err(format!("Invalid required at {location}"))
            }
            "enum" if !value.as_array().is_some_and(|items| !items.is_empty()) => {
                return Err(format!("Invalid enum at {location}"))
            }
            "minLength" | "maxLength" | "minItems" | "maxItems"
                if !value
                    .as_f64()
                    .is_some_and(|number| number >= 0.0 && number.fract() == 0.0) =>
            {
                return Err(format!("Invalid size bound at {location}"))
            }
            "minimum" | "maximum" | "exclusiveMinimum" | "exclusiveMaximum"
                if !value.is_number() =>
            {
                return Err(format!("Invalid numeric bound at {location}"))
            }
            _ => {}
        }
    }
    Ok(())
}

fn target<'a>(root: &'a Value, reference: &str) -> Option<&'a Value> {
    if reference == "#" {
        return Some(root);
    }
    // The shared subset permits only a named definition, never a pointer
    // through annotation/default data that registration did not inspect.
    let name = reference
        .strip_prefix("#/definitions/")
        .or_else(|| reference.strip_prefix("#/$defs/"))?;
    if name.is_empty() || name.contains('/') {
        return None;
    }
    root.pointer(&reference[1..])
        .filter(|schema| schema.is_object())
}

fn kind(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

fn equal(left: &Value, right: &Value) -> bool {
    match (left, right) {
        (Value::Number(a), Value::Number(b)) => a.as_f64() == b.as_f64(),
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(a, b)| equal(a, b))
        }
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len()
                && a.iter()
                    .all(|(key, a)| b.get(key).is_some_and(|b| equal(a, b)))
        }
        _ => left == right,
    }
}

fn issue(errors: &mut Vec<Value>, path: &str, code: &str, message: String, expected: Option<&str>) {
    let mut error = json!({"path": if path.is_empty() { "(root)" } else {path}, "code":code, "message":message});
    if let Some(expected) = expected {
        error["expected"] = json!(expected);
    }
    errors.push(error);
}

fn child_path(path: &str, key: &str) -> String {
    if path.is_empty() {
        key.to_string()
    } else {
        format!("{path}.{key}")
    }
}

fn default_value<'a>(schema: &'a Value, root: &'a Value, depth: usize) -> Option<&'a Value> {
    if depth > 128 {
        return None;
    }
    schema.get("default").or_else(|| {
        schema["$ref"]
            .as_str()
            .and_then(|reference| target(root, reference))
            .and_then(|schema| default_value(schema, root, depth + 1))
    })
}

fn validate(
    value: Option<&Value>,
    schema: &Value,
    root: &Value,
    path: &str,
    errors: &mut Vec<Value>,
    depth: usize,
) -> Option<Value> {
    if depth > 128 {
        issue(
            errors,
            path,
            "invalid_type",
            "Input exceeds validation depth limit".into(),
            Some("object"),
        );
        return None;
    }
    if value.is_none() {
        if let Some(default) = default_value(schema, root, 0) {
            return Some(default.clone());
        }
    }
    if let Some(reference) = schema["$ref"].as_str() {
        let Some(target) = target(root, reference) else {
            issue(
                errors,
                path,
                "invalid_type",
                "Schema reference cannot be resolved".into(),
                Some("unknown"),
            );
            return None;
        };
        return validate(value, target, root, path, errors, depth + 1);
    }
    let allowed = schema.get("enum").and_then(Value::as_array);
    let constant = schema.get("const");
    let constraints = constant
        .map(|constant| vec![constant])
        .into_iter()
        .chain(allowed.map(|allowed| allowed.iter().collect::<Vec<_>>()));
    for values in constraints {
        if !value.is_some_and(|value| values.iter().any(|allowed| equal(value, allowed))) {
            let listed = values
                .iter()
                .map(|value| value.to_string())
                .collect::<Vec<_>>()
                .join("|");
            let message = if values.len() == 1 {
                format!("Invalid input: expected {listed}")
            } else {
                format!("Invalid option: expected one of {listed}")
            };
            issue(errors, path, "invalid_value", message, None);
            return None;
        }
    }
    let types: Vec<&str> = match schema.get("type") {
        Some(Value::String(name)) => vec![name.as_str()],
        Some(Value::Array(types)) => types.iter().filter_map(Value::as_str).collect(),
        _ => vec![],
    };
    let matches = value.is_some_and(|value| {
        types.is_empty()
            || types.iter().any(|expected| {
                *expected == kind(value)
                    || *expected == "integer"
                        && value.as_f64().is_some_and(|number| number.fract() == 0.0)
            })
    });
    if !matches {
        let non_null: Vec<&str> = types
            .iter()
            .copied()
            .filter(|name| *name != "null")
            .collect();
        if non_null.len() > 1 {
            issue(errors, path, "invalid_union", "Invalid input".into(), None);
        } else {
            let expected = non_null
                .first()
                .copied()
                .or_else(|| types.first().copied())
                .unwrap_or("nonoptional");
            let expected = if expected == "integer" {
                if value.is_some_and(Value::is_number) {
                    "int"
                } else {
                    "number"
                }
            } else {
                expected
            };
            issue(
                errors,
                path,
                "invalid_type",
                format!(
                    "Invalid input: expected {expected}, received {}",
                    value.map(kind).unwrap_or("undefined")
                ),
                Some(expected),
            );
        }
        return None;
    }
    let value = value.expect("checked presence");
    match value {
        Value::Object(object) => {
            let mut output = Map::new();
            let properties = schema.get("properties").and_then(Value::as_object);
            let required = schema.get("required").and_then(Value::as_array);
            if let Some(properties) = properties {
                for (key, property) in properties {
                    let present = object.get(key);
                    if present.is_some()
                        || default_value(property, root, 0).is_some()
                        || required.is_some_and(|required| required.contains(&json!(key)))
                    {
                        if let Some(parsed) = validate(
                            present,
                            property,
                            root,
                            &child_path(path, key),
                            errors,
                            depth + 1,
                        ) {
                            output.insert(key.clone(), parsed);
                        }
                    }
                }
            }
            if let Some(required) = required {
                for key in required.iter().filter_map(Value::as_str) {
                    if !object.contains_key(key)
                        && !properties.is_some_and(|properties| properties.contains_key(key))
                    {
                        issue(
                            errors,
                            &child_path(path, key),
                            "invalid_type",
                            "Invalid input: expected nonoptional, received undefined".into(),
                            Some("nonoptional"),
                        );
                    }
                }
            }
            let mut unknown = Vec::new();
            for (key, value) in object {
                if properties.is_some_and(|properties| properties.contains_key(key)) {
                    continue;
                }
                match schema.get("additionalProperties") {
                    Some(Value::Bool(false)) => unknown.push(key.clone()),
                    Some(Value::Object(_)) => {
                        if let Some(parsed) = validate(
                            Some(value),
                            &schema["additionalProperties"],
                            root,
                            &child_path(path, key),
                            errors,
                            depth + 1,
                        ) {
                            output.insert(key.clone(), parsed);
                        }
                    }
                    Some(Value::Bool(true)) => {
                        output.insert(key.clone(), value.clone());
                    }
                    _ if properties.is_none() => {
                        output.insert(key.clone(), value.clone());
                    }
                    _ => {}
                }
            }
            if !unknown.is_empty() {
                issue(
                    errors,
                    path,
                    "unrecognized_keys",
                    format!(
                        "Unrecognized key{}: {}",
                        if unknown.len() == 1 { "" } else { "s" },
                        unknown
                            .iter()
                            .map(|key| format!("\"{key}\""))
                            .collect::<Vec<_>>()
                            .join(", ")
                    ),
                    None,
                );
            }
            return Some(Value::Object(output));
        }
        Value::Array(items) => {
            let output: Vec<Value> = items
                .iter()
                .enumerate()
                .map(|(index, item)| {
                    schema
                        .get("items")
                        .map(|schema| {
                            validate(
                                Some(item),
                                schema,
                                root,
                                &child_path(path, &index.to_string()),
                                errors,
                                depth + 1,
                            )
                            .unwrap_or(Value::Null)
                        })
                        .unwrap_or_else(|| item.clone())
                })
                .collect();
            bounds(
                items.len() as f64,
                schema,
                path,
                errors,
                "minItems",
                "maxItems",
                "array",
                "items",
            );
            return Some(Value::Array(output));
        }
        Value::String(text) => bounds(
            text.chars().count() as f64,
            schema,
            path,
            errors,
            "minLength",
            "maxLength",
            "string",
            "characters",
        ),
        Value::Number(number) => {
            let number = number.as_f64().expect("finite JSON number");
            for (key, small, exclusive) in [
                ("minimum", true, false),
                ("maximum", false, false),
                ("exclusiveMinimum", true, true),
                ("exclusiveMaximum", false, true),
            ] {
                if let Some(bound) = schema[key].as_f64() {
                    let fails = if small {
                        number < bound || exclusive && number == bound
                    } else {
                        number > bound || exclusive && number == bound
                    };
                    if fails {
                        issue(
                            errors,
                            path,
                            if small { "too_small" } else { "too_big" },
                            format!(
                                "Too {}: expected number to be {}{}{}",
                                if small { "small" } else { "big" },
                                if small { ">" } else { "<" },
                                if exclusive { "" } else { "=" },
                                schema[key]
                            ),
                            None,
                        );
                    }
                }
            }
        }
        _ => {}
    }
    Some(value.clone())
}

#[allow(clippy::too_many_arguments)]
fn bounds(
    length: f64,
    schema: &Value,
    path: &str,
    errors: &mut Vec<Value>,
    minimum: &str,
    maximum: &str,
    kind: &str,
    unit: &str,
) {
    for (key, small) in [(minimum, true), (maximum, false)] {
        if let Some(bound) = schema[key].as_f64() {
            if if small {
                length < bound
            } else {
                length > bound
            } {
                issue(
                    errors,
                    path,
                    if small { "too_small" } else { "too_big" },
                    format!(
                        "Too {}: expected {kind} to have {}={} {unit}",
                        if small { "small" } else { "big" },
                        if small { ">" } else { "<" },
                        schema[key]
                    ),
                    None,
                );
            }
        }
    }
}

/// Validate one value against a schema [`compile`] accepted, as a declared context field's value
/// is validated (`spec/context-fields.md`).
///
/// Returns the parsed value (defaults applied, undeclared keys dropped, as for input), or each
/// problem as `{"path", "message"}`: a dotted path, empty for the value itself, as TypeScript
/// joins a Zod issue's path.
pub(crate) fn validate_value(schema: &Value, value: &Value) -> Result<Value, Vec<Value>> {
    let mut errors = Vec::new();
    let parsed = validate(Some(value), schema, schema, "", &mut errors, 0);
    if errors.is_empty() {
        return Ok(parsed.unwrap_or_else(|| value.clone()));
    }
    Err(errors
        .into_iter()
        .map(|error| {
            let path = match error["path"].as_str() {
                Some("(root)") | None => "",
                Some(path) => path,
            };
            json!({"path": path, "message": error["message"]})
        })
        .collect())
}

pub(crate) fn execute(schema: &Value, input: Value) -> Result<Value, Box<CommandError>> {
    let input = if input.is_null() { json!({}) } else { input };
    let mut errors = Vec::new();
    let parsed = validate(Some(&input), schema, schema, "", &mut errors, 0);
    if errors.is_empty() {
        return Ok(parsed.unwrap_or(Value::Null));
    }
    let properties = schema.get("properties").and_then(Value::as_object);
    let expected: Vec<String> = properties
        .map(|properties| properties.keys().cloned().collect())
        .unwrap_or_default();
    let unexpected: Vec<String> = input
        .as_object()
        .map(|object| {
            object
                .keys()
                .filter(|key| !expected.contains(key))
                .cloned()
                .collect()
        })
        .unwrap_or_default();
    let missing: Vec<String> = schema["required"]
        .as_array()
        .map(|required| {
            required
                .iter()
                .filter_map(Value::as_str)
                .filter(|key| {
                    input
                        .as_object()
                        .is_some_and(|input| !input.contains_key(*key))
                        && properties
                            .and_then(|properties| properties.get(*key))
                            .is_none_or(|property| default_value(property, schema, 0).is_none())
                })
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    let mut details = HashMap::new();
    details.insert("errors".into(), json!(errors));
    let mut parts = vec![errors
        .iter()
        .map(|error| {
            let description = if error["path"] == "(root)" {
                error["message"].as_str().unwrap().to_string()
            } else {
                format!(
                    "{}: {}",
                    error["path"].as_str().unwrap(),
                    error["message"].as_str().unwrap()
                )
            };
            if errors.len() > 1 {
                format!("- {description}")
            } else {
                description
            }
        })
        .collect::<Vec<_>>()
        .join("\n")];
    for (key, label, fields) in [
        ("unexpectedFields", "Unknown field(s)", &unexpected),
        ("missingFields", "Missing required field(s)", &missing),
        ("expectedFields", "Expected fields", &expected),
    ] {
        if !fields.is_empty() {
            details.insert(key.into(), json!(fields));
            parts.push(format!("{label}: {}", fields.join(", ")));
        }
    }
    Err(Box::new(
        CommandError::new(error_codes::VALIDATION_ERROR, "Input validation failed")
            .with_details(details)
            .with_suggestion(parts.join(". ")),
    ))
}
