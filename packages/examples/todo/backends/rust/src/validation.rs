//! Input validation against each command's JSON Schema.
//!
//! The schema is the single source of truth: `tools/list` advertises it and
//! [`validate`] enforces it before a handler runs, the way Zod does in the
//! TypeScript backend. It supports the subset the todo spec uses: `type`
//! (`object`, `array`, `string`, `integer`, `boolean`), `properties`,
//! `required`, `default`, `enum`, `minLength`/`maxLength` (in characters),
//! `minimum`/`maximum` and `minItems`/`maxItems`.
//!
//! Failures are `VALIDATION_ERROR`s with a `suggestion` and structured
//! `details` (`errors[].path`, `missingFields`, `expectedFields`,
//! `unexpectedFields`), matching the TypeScript server. Unknown fields are
//! dropped, like Zod's default object parsing, and listed in
//! `unexpectedFields`.

use afd::CommandError;
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::collections::HashMap;

/// One problem with the input.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct FieldError {
    /// Dotted path to the field, such as `title` or `todos.1.title`.
    pub path: String,
    pub message: String,
    /// `required`, `invalid_type`, `too_small`, `too_big` or `invalid_enum_value`.
    pub code: &'static str,
}

/// Validate `input` against an object `schema`, returning the input with
/// defaults applied and unknown fields removed.
pub fn validate(schema: &Value, input: Value) -> Result<Map<String, Value>, Box<CommandError>> {
    let mut errors = Vec::new();
    let mut missing = Vec::new();
    let mut unexpected = Vec::new();

    let object = match input {
        Value::Null => Map::new(),
        Value::Object(object) => object,
        other => {
            errors.push(FieldError {
                path: String::new(),
                message: format!("Expected an object, received {}", kind(&other)),
                code: "invalid_type",
            });
            Map::new()
        }
    };

    let output = check_object(
        schema,
        object,
        "",
        &mut errors,
        &mut missing,
        &mut unexpected,
    );

    if errors.is_empty() {
        return Ok(output);
    }

    let expected: Vec<String> = properties(schema).keys().cloned().collect();
    let suggestion = suggestion(&errors, &missing, &expected);
    let mut details = HashMap::new();
    details.insert("errors".to_string(), json!(errors));
    details.insert("missingFields".to_string(), json!(missing));
    details.insert("expectedFields".to_string(), json!(expected));
    details.insert("unexpectedFields".to_string(), json!(unexpected));
    Err(Box::new(
        CommandError::validation("Input validation failed", Some(&suggestion))
            .with_details(details),
    ))
}

fn suggestion(errors: &[FieldError], missing: &[String], expected: &[String]) -> String {
    if !missing.is_empty() {
        return format!(
            "Provide the required field(s): {}. Expected fields: {}",
            missing.join(", "),
            expected.join(", ")
        );
    }
    let fixes: Vec<String> = errors
        .iter()
        .take(3)
        .map(|error| {
            if error.path.is_empty() {
                error.message.clone()
            } else {
                format!("{}: {}", error.path, error.message)
            }
        })
        .collect();
    format!("Fix the input: {}", fixes.join("; "))
}

fn properties(schema: &Value) -> Map<String, Value> {
    schema
        .get("properties")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default()
}

fn join(path: &str, key: &str) -> String {
    if path.is_empty() {
        key.to_string()
    } else {
        format!("{path}.{key}")
    }
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

fn check_object(
    schema: &Value,
    mut object: Map<String, Value>,
    path: &str,
    errors: &mut Vec<FieldError>,
    missing: &mut Vec<String>,
    unexpected: &mut Vec<String>,
) -> Map<String, Value> {
    let props = properties(schema);
    let required: Vec<&str> = schema
        .get("required")
        .and_then(Value::as_array)
        .map(|names| names.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();

    let mut output = Map::new();
    for (name, value) in std::mem::take(&mut object) {
        let Some(property) = props.get(&name) else {
            unexpected.push(join(path, &name));
            continue;
        };
        let value = check(
            property,
            value,
            &join(path, &name),
            errors,
            missing,
            unexpected,
        );
        output.insert(name, value);
    }

    for (name, property) in &props {
        if output.contains_key(name) {
            continue;
        }
        if required.contains(&name.as_str()) {
            let field = join(path, name);
            missing.push(field.clone());
            errors.push(FieldError {
                path: field,
                message: "Required".to_string(),
                code: "required",
            });
        } else if let Some(default) = property.get("default") {
            output.insert(name.clone(), default.clone());
        }
    }
    output
}

fn check(
    schema: &Value,
    value: Value,
    path: &str,
    errors: &mut Vec<FieldError>,
    missing: &mut Vec<String>,
    unexpected: &mut Vec<String>,
) -> Value {
    fn fail(errors: &mut Vec<FieldError>, path: &str, code: &'static str, message: String) {
        errors.push(FieldError {
            path: path.to_string(),
            message,
            code,
        });
    }
    let expected = schema.get("type").and_then(Value::as_str).unwrap_or("any");
    let number = |key: &str| schema.get(key).and_then(Value::as_f64);
    let count = |key: &str| {
        schema
            .get(key)
            .and_then(Value::as_u64)
            .and_then(|n| usize::try_from(n).ok())
    };

    let value = match (expected, value) {
        ("string", Value::String(text)) => {
            let length = text.chars().count();
            if let Some(min) = count("minLength").filter(|min| length < *min) {
                fail(
                    errors,
                    path,
                    "too_small",
                    format!("Must be at least {min} character(s)"),
                );
            }
            if let Some(max) = count("maxLength").filter(|max| length > *max) {
                fail(
                    errors,
                    path,
                    "too_big",
                    format!("Must be at most {max} character(s)"),
                );
            }
            Value::String(text)
        }
        ("integer", Value::Number(n)) => {
            let as_float = n.as_f64().unwrap_or(f64::NAN);
            if !as_float.is_finite() || as_float.fract() != 0.0 {
                fail(
                    errors,
                    path,
                    "invalid_type",
                    "Expected integer, received number".to_string(),
                );
            } else {
                if let Some(min) = number("minimum").filter(|min| as_float < *min) {
                    fail(
                        errors,
                        path,
                        "too_small",
                        format!("Must be greater than or equal to {min}"),
                    );
                }
                if let Some(max) = number("maximum").filter(|max| as_float > *max) {
                    fail(
                        errors,
                        path,
                        "too_big",
                        format!("Must be less than or equal to {max}"),
                    );
                }
            }
            Value::Number(n)
        }
        ("boolean", value @ Value::Bool(_)) => value,
        ("array", Value::Array(items)) => {
            if let Some(min) = count("minItems").filter(|min| items.len() < *min) {
                fail(
                    errors,
                    path,
                    "too_small",
                    format!("Must contain at least {min} item(s)"),
                );
            }
            if let Some(max) = count("maxItems").filter(|max| items.len() > *max) {
                fail(
                    errors,
                    path,
                    "too_big",
                    format!("Must contain at most {max} item(s)"),
                );
            }
            let item_schema = schema.get("items").cloned().unwrap_or(Value::Null);
            let mut checked = Vec::with_capacity(items.len());
            for (index, item) in items.into_iter().enumerate() {
                let item_path = join(path, &index.to_string());
                checked.push(check(
                    &item_schema,
                    item,
                    &item_path,
                    errors,
                    missing,
                    unexpected,
                ));
            }
            Value::Array(checked)
        }
        ("object", Value::Object(object)) => Value::Object(check_object(
            schema, object, path, errors, missing, unexpected,
        )),
        ("any", value) => value,
        (expected, value) => {
            let message = format!("Expected {expected}, received {}", kind(&value));
            fail(errors, path, "invalid_type", message);
            value
        }
    };

    if let Some(allowed) = schema.get("enum").and_then(Value::as_array) {
        if !allowed.contains(&value) {
            let names: Vec<String> = allowed
                .iter()
                .map(|v| v.as_str().map_or_else(|| v.to_string(), str::to_string))
                .collect();
            let message = format!("Must be one of: {}", names.join(", "));
            fail(errors, path, "invalid_enum_value", message);
        }
    }
    value
}

#[cfg(test)]
mod tests {
    use super::*;

    fn schema() -> Value {
        json!({
            "type": "object",
            "properties": {
                "title": { "type": "string", "minLength": 1, "maxLength": 5 },
                "priority": { "type": "string", "enum": ["low", "medium", "high"], "default": "medium" },
                "limit": { "type": "integer", "minimum": 1, "maximum": 100 },
                "done": { "type": "boolean" },
                "items": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": 2,
                    "items": {
                        "type": "object",
                        "properties": { "title": { "type": "string", "minLength": 1 } },
                        "required": ["title"]
                    }
                }
            },
            "required": ["title"]
        })
    }

    fn details(error: &CommandError) -> &HashMap<String, Value> {
        error
            .details
            .as_ref()
            .expect("validation errors carry details")
    }

    #[test]
    fn applies_defaults_and_drops_unknown_fields() {
        let output = validate(&schema(), json!({ "title": "abc", "extra": 1 })).expect("valid");
        assert_eq!(
            Value::Object(output),
            json!({ "title": "abc", "priority": "medium" })
        );
    }

    #[test]
    fn treats_null_as_an_empty_object() {
        let error = validate(&schema(), Value::Null).expect_err("title is required");
        assert_eq!(details(&error)["missingFields"], json!(["title"]));
    }

    #[test]
    fn reports_missing_fields_with_a_suggestion() {
        let error = validate(&schema(), json!({})).expect_err("title is required");
        assert_eq!(error.code, "VALIDATION_ERROR");
        assert!(error.suggestion.as_deref().unwrap_or("").contains("title"));
        assert_eq!(details(&error)["errors"][0]["path"], "title");
        assert_eq!(details(&error)["errors"][0]["code"], "required");
    }

    #[test]
    fn reports_wrong_types_by_path() {
        let error = validate(&schema(), json!({ "title": 123 })).expect_err("wrong type");
        assert_eq!(details(&error)["errors"][0]["path"], "title");
        assert_eq!(details(&error)["errors"][0]["code"], "invalid_type");
        assert_eq!(details(&error)["missingFields"], json!([]));
    }

    #[test]
    fn enforces_string_lengths_in_characters() {
        assert!(validate(&schema(), json!({ "title": "ééééé" })).is_ok());
        let error = validate(&schema(), json!({ "title": "123456" })).expect_err("too long");
        assert_eq!(details(&error)["errors"][0]["code"], "too_big");
        assert!(validate(&schema(), json!({ "title": "" })).is_err());
    }

    #[test]
    fn enforces_enums_integers_and_booleans() {
        for input in [
            json!({ "title": "a", "priority": "urgent" }),
            json!({ "title": "a", "limit": 101 }),
            json!({ "title": "a", "limit": 0 }),
            json!({ "title": "a", "limit": 1.5 }),
            json!({ "title": "a", "done": "yes" }),
        ] {
            assert!(validate(&schema(), input.clone()).is_err(), "{input}");
        }
        assert!(validate(
            &schema(),
            json!({ "title": "a", "limit": 100, "done": false })
        )
        .is_ok());
    }

    #[test]
    fn validates_array_items_with_nested_paths() {
        let error = validate(
            &schema(),
            json!({ "title": "a", "items": [{ "title": "" }] }),
        )
        .expect_err("empty nested title");
        assert_eq!(details(&error)["errors"][0]["path"], "items.0.title");

        let error = validate(&schema(), json!({ "title": "a", "items": [] })).expect_err("empty");
        assert_eq!(details(&error)["errors"][0]["code"], "too_small");
    }

    #[test]
    fn rejects_a_non_object_input() {
        let error = validate(&schema(), json!([1, 2])).expect_err("not an object");
        assert_eq!(details(&error)["errors"][0]["path"], "");
    }
}
