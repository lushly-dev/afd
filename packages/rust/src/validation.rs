//! Input validation against a command's declared parameters.
//!
//! [`CommandRegistry::execute`](crate::CommandRegistry::execute) runs this
//! before a handler is called. A parameter is checked against its `schema`
//! when it has one, and otherwise against its `type` and `enum`, which is the
//! same schema [`command_to_mcp_tool`](crate::command_to_mcp_tool) advertises.
//!
//! Results follow the TypeScript engine (`packages/server/src/execution.ts`
//! and `validation.ts`). A failure is a `VALIDATION_ERROR` with the message
//! `Input validation failed`, the formatted issues in `suggestion`, and
//! `details` holding `errors` (`path`, `message`, `code`, `expected`),
//! `expectedFields`, `unexpectedFields` and `missingFields`. Issue codes and
//! `expected` type names are Zod's; the wording of each `message` is this
//! crate's own. Valid input reaches the handler without the keys its schema
//! does not declare, as with Zod's default object parsing.

use regex::Regex;
use serde::Serialize;
use serde_json::{Map, Value};
use std::collections::HashMap;

use crate::commands::{CommandParameter, JsonSchema, JsonSchemaType};
use crate::errors::{error_codes, CommandError};

/// At most this many issues are collected for one input.
const MAX_ISSUES: usize = 50;

/// At most this many issues are listed in the suggestion.
const MAX_ISSUES_IN_SUGGESTION: usize = 5;

/// At most this many enum values are listed in one issue.
const MAX_ENUM_VALUES_IN_MESSAGE: usize = 10;

/// The path of an issue with the input as a whole, as in TypeScript.
const ROOT_PATH: &str = "(root)";

/// Zod issue codes, which the TypeScript server reports in `details.errors`.
mod issue_codes {
    pub const INVALID_TYPE: &str = "invalid_type";
    pub const INVALID_VALUE: &str = "invalid_value";
    pub const TOO_SMALL: &str = "too_small";
    pub const TOO_BIG: &str = "too_big";
    pub const INVALID_FORMAT: &str = "invalid_format";
}

/// One problem with one input field: an entry of `details.errors`.
#[derive(Debug, Clone, PartialEq, Serialize)]
struct Issue {
    /// Dot-separated path such as `filter.tags.1`, or `(root)`.
    path: String,
    message: String,
    /// A Zod issue code.
    code: &'static str,
    /// Zod's name for the expected type, for `invalid_type` only.
    #[serde(skip_serializing_if = "Option::is_none")]
    expected: Option<&'static str>,
}

#[derive(Default)]
struct Issues {
    items: Vec<Issue>,
    truncated: bool,
}

impl Issues {
    fn push(&mut self, path: &str, code: &'static str, message: String) {
        self.push_issue(path, code, None, message);
    }

    fn push_invalid_type(&mut self, path: &str, expected: &'static str, message: String) {
        self.push_issue(path, issue_codes::INVALID_TYPE, Some(expected), message);
    }

    fn push_issue(
        &mut self,
        path: &str,
        code: &'static str,
        expected: Option<&'static str>,
        message: String,
    ) {
        if self.items.len() < MAX_ISSUES {
            self.items.push(Issue {
                path: path.to_string(),
                message,
                code,
                expected,
            });
        } else {
            self.truncated = true;
        }
    }

    fn is_full(&self) -> bool {
        self.items.len() >= MAX_ISSUES
    }
}

/// Validate `input` against `parameters` and apply parameter defaults.
///
/// - A command without parameters accepts any input unchanged.
/// - Otherwise the input must be a JSON object; `null` counts as `{}`.
/// - An absent or `null` parameter takes its `default` when it has one. A
///   required parameter without a default must be present and not `null`.
/// - Present values must match the parameter's schema: type, `enum`, numeric
///   and length bounds, `pattern`, array `items`, and object `properties`,
///   `required` and `additionalProperties`.
/// - Keys that no parameter declares are dropped, and so are the keys of a
///   nested object that its schema's `properties` do not declare (unless the
///   schema has `additionalProperties`).
///
/// Returns the input to pass to the handler, or a `VALIDATION_ERROR`.
pub(crate) fn validate_input(
    parameters: &[CommandParameter],
    input: Value,
) -> Result<Value, Box<CommandError>> {
    if parameters.is_empty() {
        return Ok(input);
    }

    let mut object = match input {
        Value::Null => Map::new(),
        Value::Object(object) => object,
        other => {
            let mut issues = Issues::default();
            issues.push_invalid_type(
                ROOT_PATH,
                "object",
                format!(
                    "Input must be a JSON object, got {}",
                    value_type_name(&other)
                ),
            );
            return Err(validation_failure(parameters, &issues, &[], &[]));
        }
    };

    let mut issues = Issues::default();
    let mut missing = Vec::new();
    for parameter in parameters {
        let present = object
            .get(&parameter.name)
            .is_some_and(|value| !value.is_null());
        if !present {
            if let Some(default) = &parameter.default {
                object.insert(parameter.name.clone(), default.clone());
            } else if parameter.required {
                missing.push(parameter.name.clone());
                issues.push_invalid_type(
                    &parameter.name,
                    expected_type_name(declared_type(parameter), None),
                    "is required".to_string(),
                );
            }
            continue;
        }

        let value = &object[&parameter.name];
        match &parameter.schema {
            Some(schema) => check_schema(value, schema, &parameter.name, &mut issues),
            None => {
                let schema = JsonSchema {
                    schema_type: Some(parameter.param_type.clone()),
                    enum_values: parameter.enum_values.clone(),
                    ..JsonSchema::default()
                };
                check_schema(value, &schema, &parameter.name, &mut issues);
            }
        }
    }

    if issues.items.is_empty() {
        object.retain(|key, _| parameters.iter().any(|parameter| &parameter.name == key));
        for parameter in parameters {
            if let (Some(schema), Some(value)) =
                (&parameter.schema, object.get_mut(&parameter.name))
            {
                strip_undeclared(value, schema);
            }
        }
        return Ok(Value::Object(object));
    }

    let unexpected: Vec<String> = object
        .keys()
        .filter(|key| !parameters.iter().any(|parameter| &parameter.name == *key))
        .cloned()
        .collect();
    Err(validation_failure(
        parameters,
        &issues,
        &missing,
        &unexpected,
    ))
}

/// Check `value` against `schema`, recording problems under `path`.
///
/// Recursion follows the schema, which the command author wrote, so its depth
/// is bounded by the schema and not by the (untrusted) input.
fn check_schema(value: &Value, schema: &JsonSchema, path: &str, issues: &mut Issues) {
    if issues.is_full() {
        issues.truncated = true;
        return;
    }

    if let Some(expected) = &schema.schema_type {
        if !type_matches(value, expected) {
            issues.push_invalid_type(
                path,
                expected_type_name(expected, Some(value)),
                format!(
                    "must be {}, got {}",
                    with_article(schema_type_name(expected)),
                    value_type_name(value)
                ),
            );
            return;
        }
    }

    if let Some(allowed) = &schema.enum_values {
        if !allowed.contains(value) {
            issues.push(
                path,
                issue_codes::INVALID_VALUE,
                format!("must be one of {}", format_values(allowed)),
            );
            return;
        }
    }

    match value {
        Value::Number(number) => {
            let number = number.as_f64().unwrap_or(f64::NAN);
            if let Some(minimum) = schema.minimum {
                if number < minimum {
                    issues.push(
                        path,
                        issue_codes::TOO_SMALL,
                        format!("must be at least {minimum}"),
                    );
                }
            }
            if let Some(maximum) = schema.maximum {
                if number > maximum {
                    issues.push(
                        path,
                        issue_codes::TOO_BIG,
                        format!("must be at most {maximum}"),
                    );
                }
            }
        }
        Value::String(text) => {
            let length = text.chars().count();
            if let Some(min_length) = schema.min_length {
                if length < min_length {
                    issues.push(
                        path,
                        issue_codes::TOO_SMALL,
                        format!("must be at least {min_length} characters long"),
                    );
                }
            }
            if let Some(max_length) = schema.max_length {
                if length > max_length {
                    issues.push(
                        path,
                        issue_codes::TOO_BIG,
                        format!("must be at most {max_length} characters long"),
                    );
                }
            }
            if let Some(pattern) = &schema.pattern {
                // An invalid pattern is a bug in the definition, not in the input.
                if Regex::new(pattern).is_ok_and(|regex| !regex.is_match(text)) {
                    issues.push(
                        path,
                        issue_codes::INVALID_FORMAT,
                        format!("must match the pattern {pattern}"),
                    );
                }
            }
        }
        Value::Array(items) => {
            if let Some(min_length) = schema.min_length {
                if items.len() < min_length {
                    issues.push(
                        path,
                        issue_codes::TOO_SMALL,
                        format!("must have at least {min_length} items"),
                    );
                }
            }
            if let Some(max_length) = schema.max_length {
                if items.len() > max_length {
                    issues.push(
                        path,
                        issue_codes::TOO_BIG,
                        format!("must have at most {max_length} items"),
                    );
                }
            }
            if let Some(item_schema) = &schema.items {
                for (index, item) in items.iter().enumerate() {
                    if issues.is_full() {
                        issues.truncated = true;
                        break;
                    }
                    check_schema(item, item_schema, &format!("{path}.{index}"), issues);
                }
            }
        }
        Value::Object(object) => {
            for key in schema.required.iter().flatten() {
                if !object.contains_key(key) {
                    let property_type = schema
                        .properties
                        .as_ref()
                        .and_then(|properties| properties.get(key))
                        .and_then(|property| property.schema_type.as_ref());
                    let path = format!("{path}.{key}");
                    let message = "is required".to_string();
                    match property_type {
                        Some(expected) => issues.push_invalid_type(
                            &path,
                            expected_type_name(expected, None),
                            message,
                        ),
                        None => issues.push(&path, issue_codes::INVALID_TYPE, message),
                    }
                }
            }
            if let Some(properties) = &schema.properties {
                for (key, property_schema) in properties {
                    if let Some(property) = object.get(key) {
                        check_schema(property, property_schema, &format!("{path}.{key}"), issues);
                    }
                }
            }
            if let Some(additional) = &schema.additional_properties {
                for (key, property) in object {
                    let declared = schema
                        .properties
                        .as_ref()
                        .is_some_and(|properties| properties.contains_key(key));
                    if !declared {
                        check_schema(property, additional, &format!("{path}.{key}"), issues);
                    }
                }
            }
        }
        Value::Null | Value::Bool(_) => {}
    }
}

/// Drop the object keys that `schema` does not declare, as Zod's default
/// object parsing does. An object schema without `properties` declares no
/// shape and keeps every key; one with `additionalProperties` keeps the extra
/// keys, which [`check_schema`] has checked against it.
///
/// Called on valid input only. Recursion follows the schema, as in
/// [`check_schema`].
fn strip_undeclared(value: &mut Value, schema: &JsonSchema) {
    match value {
        Value::Object(object) => {
            if let Some(properties) = &schema.properties {
                if schema.additional_properties.is_none() {
                    object.retain(|key, _| properties.contains_key(key));
                }
            }
            for (key, property) in object.iter_mut() {
                let property_schema = schema
                    .properties
                    .as_ref()
                    .and_then(|properties| properties.get(key))
                    .or(schema.additional_properties.as_deref());
                if let Some(property_schema) = property_schema {
                    strip_undeclared(property, property_schema);
                }
            }
        }
        Value::Array(items) => {
            if let Some(item_schema) = &schema.items {
                for item in items {
                    strip_undeclared(item, item_schema);
                }
            }
        }
        _ => {}
    }
}

fn type_matches(value: &Value, expected: &JsonSchemaType) -> bool {
    match expected {
        JsonSchemaType::String => value.is_string(),
        JsonSchemaType::Number => value.is_number(),
        JsonSchemaType::Integer => {
            value.is_i64()
                || value.is_u64()
                || value
                    .as_f64()
                    .is_some_and(|number| number.is_finite() && number.fract() == 0.0)
        }
        JsonSchemaType::Boolean => value.is_boolean(),
        JsonSchemaType::Object => value.is_object(),
        JsonSchemaType::Array => value.is_array(),
        JsonSchemaType::Null => value.is_null(),
    }
}

/// The type a parameter declares: its schema's type, or else its `type`.
fn declared_type(parameter: &CommandParameter) -> &JsonSchemaType {
    parameter
        .schema
        .as_ref()
        .and_then(|schema| schema.schema_type.as_ref())
        .unwrap_or(&parameter.param_type)
}

/// Zod's name for `schema_type`, which TypeScript reports as `expected`.
/// `value` is the rejected value, or `None` when the field is missing. As
/// `z.number().int()` does, an integer expects `int` when the value is a
/// number (with a fraction) and `number` otherwise.
fn expected_type_name(schema_type: &JsonSchemaType, value: Option<&Value>) -> &'static str {
    match schema_type {
        JsonSchemaType::Integer if value.is_some_and(Value::is_number) => "int",
        JsonSchemaType::Integer => "number",
        other => schema_type_name(other),
    }
}

fn schema_type_name(schema_type: &JsonSchemaType) -> &'static str {
    match schema_type {
        JsonSchemaType::String => "string",
        JsonSchemaType::Number => "number",
        JsonSchemaType::Integer => "integer",
        JsonSchemaType::Boolean => "boolean",
        JsonSchemaType::Object => "object",
        JsonSchemaType::Array => "array",
        JsonSchemaType::Null => "null",
    }
}

fn value_type_name(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

fn with_article(type_name: &str) -> String {
    match type_name {
        "null" => "null".to_string(),
        "integer" | "object" | "array" => format!("an {type_name}"),
        _ => format!("a {type_name}"),
    }
}

fn format_values(values: &[Value]) -> String {
    let mut listed: Vec<String> = values
        .iter()
        .take(MAX_ENUM_VALUES_IN_MESSAGE)
        .map(Value::to_string)
        .collect();
    if values.len() > MAX_ENUM_VALUES_IN_MESSAGE {
        listed.push(format!(
            "and {} more",
            values.len() - MAX_ENUM_VALUES_IN_MESSAGE
        ));
    }
    listed.join(", ")
}

fn validation_failure(
    parameters: &[CommandParameter],
    issues: &Issues,
    missing: &[String],
    unexpected: &[String],
) -> Box<CommandError> {
    let expected: Vec<&str> = parameters
        .iter()
        .map(|parameter| parameter.name.as_str())
        .collect();

    // As in TypeScript, an empty field list is left out.
    let mut details = HashMap::new();
    details.insert("errors".to_string(), serde_json::json!(issues.items));
    details.insert("expectedFields".to_string(), serde_json::json!(expected));
    if !unexpected.is_empty() {
        details.insert(
            "unexpectedFields".to_string(),
            serde_json::json!(unexpected),
        );
    }
    if !missing.is_empty() {
        details.insert("missingFields".to_string(), serde_json::json!(missing));
    }

    Box::new(
        CommandError::new(error_codes::VALIDATION_ERROR, "Input validation failed")
            .with_suggestion(suggestion(issues, &expected, unexpected, missing))
            .with_retryable(false)
            .with_details(details),
    )
}

/// The issues, then the unknown, missing and expected fields, joined as
/// TypeScript's `formatEnhancedValidationError` joins them.
fn suggestion(
    issues: &Issues,
    expected: &[&str],
    unexpected: &[String],
    missing: &[String],
) -> String {
    let mut parts = vec![format_issues(issues)];
    if !unexpected.is_empty() {
        parts.push(format!("Unknown field(s): {}", unexpected.join(", ")));
    }
    if !missing.is_empty() {
        parts.push(format!("Missing required field(s): {}", missing.join(", ")));
    }
    if !expected.is_empty() {
        parts.push(format!("Expected fields: {}", expected.join(", ")));
    }
    parts.join(". ")
}

/// `path: message` for a single issue, and a `- path: message` line for each
/// of several, as TypeScript's `formatValidationErrors`. A `(root)` issue is
/// its message alone. Unlike TypeScript, at most [`MAX_ISSUES_IN_SUGGESTION`]
/// issues are listed.
fn format_issues(issues: &Issues) -> String {
    let describe = |issue: &Issue| {
        if issue.path == ROOT_PATH {
            issue.message.clone()
        } else {
            format!("{}: {}", issue.path, issue.message)
        }
    };
    if let [issue] = issues.items.as_slice() {
        return describe(issue);
    }
    let mut lines: Vec<String> = issues
        .items
        .iter()
        .take(MAX_ISSUES_IN_SUGGESTION)
        .map(|issue| format!("- {}", describe(issue)))
        .collect();
    if issues.items.len() > MAX_ISSUES_IN_SUGGESTION || issues.truncated {
        lines.push("- and more".to_string());
    }
    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn priority() -> CommandParameter {
        CommandParameter::optional_string("priority", "Priority").with_enum(vec![
            json!("low"),
            json!("medium"),
            json!("high"),
        ])
    }

    fn parameters() -> Vec<CommandParameter> {
        vec![
            CommandParameter::required_string("title", "Title"),
            priority(),
            CommandParameter::required_boolean("done", "Done").with_default(json!(false)),
        ]
    }

    fn issues_of(error: &CommandError) -> Vec<Value> {
        error.details.as_ref().unwrap()["errors"]
            .as_array()
            .unwrap()
            .clone()
    }

    #[test]
    fn accepts_valid_input_applies_defaults_and_drops_undeclared_keys() {
        let input = validate_input(
            &parameters(),
            json!({"title": "Buy milk", "priority": "low", "extra": 1}),
        )
        .unwrap();
        assert_eq!(
            input,
            json!({"title": "Buy milk", "priority": "low", "done": false})
        );
    }

    #[test]
    fn commands_without_parameters_accept_anything() {
        assert_eq!(
            validate_input(&[], json!("anything")).unwrap(),
            json!("anything")
        );
        assert_eq!(validate_input(&[], Value::Null).unwrap(), Value::Null);
        assert_eq!(
            validate_input(&[], json!({"extra": 1})).unwrap(),
            json!({"extra": 1})
        );
    }

    #[test]
    fn null_input_counts_as_an_empty_object() {
        let parameters = vec![priority()];
        assert_eq!(validate_input(&parameters, Value::Null).unwrap(), json!({}));
    }

    #[test]
    fn reports_missing_required_fields() {
        let error = validate_input(&parameters(), json!({})).unwrap_err();
        assert_eq!(error.code, "VALIDATION_ERROR");
        assert_eq!(error.message, "Input validation failed");
        assert_eq!(error.retryable, Some(false));
        assert_eq!(
            error.suggestion.as_deref(),
            Some(
                "title: is required. Missing required field(s): title. \
                 Expected fields: title, priority, done"
            )
        );
        let details = error.details.as_ref().unwrap();
        assert_eq!(details["missingFields"], json!(["title"]));
        assert_eq!(
            details["expectedFields"],
            json!(["title", "priority", "done"])
        );
        assert!(!details.contains_key("unexpectedFields"));
    }

    #[test]
    fn null_for_a_required_field_is_missing() {
        let error = validate_input(&parameters(), json!({"title": null})).unwrap_err();
        assert_eq!(
            issues_of(&error),
            vec![json!({
                "path": "title",
                "message": "is required",
                "code": "invalid_type",
                "expected": "string",
            })]
        );
    }

    #[test]
    fn reports_type_and_enum_mismatches() {
        let error = validate_input(
            &parameters(),
            json!({"title": 42, "priority": "urgent", "done": "yes", "typo": true}),
        )
        .unwrap_err();
        assert_eq!(
            issues_of(&error),
            vec![
                json!({
                    "path": "title",
                    "message": "must be a string, got number",
                    "code": "invalid_type",
                    "expected": "string",
                }),
                json!({
                    "path": "priority",
                    "message": r#"must be one of "low", "medium", "high""#,
                    "code": "invalid_value",
                }),
                json!({
                    "path": "done",
                    "message": "must be a boolean, got string",
                    "code": "invalid_type",
                    "expected": "boolean",
                }),
            ]
        );
        assert_eq!(
            error.suggestion.as_deref(),
            Some(
                "- title: must be a string, got number\n\
                 - priority: must be one of \"low\", \"medium\", \"high\"\n\
                 - done: must be a boolean, got string. \
                 Unknown field(s): typo. Expected fields: title, priority, done"
            )
        );
        let details = error.details.as_ref().unwrap();
        assert_eq!(details["unexpectedFields"], json!(["typo"]));
        assert!(!details.contains_key("missingFields"));
    }

    #[test]
    fn rejects_non_object_input() {
        let error = validate_input(&parameters(), json!([1, 2])).unwrap_err();
        assert_eq!(
            issues_of(&error),
            vec![json!({
                "path": "(root)",
                "message": "Input must be a JSON object, got array",
                "code": "invalid_type",
                "expected": "object",
            })]
        );
        // A root issue is listed without its path, as in TypeScript.
        assert_eq!(
            error.suggestion.as_deref(),
            Some("Input must be a JSON object, got array. Expected fields: title, priority, done")
        );
    }

    #[test]
    fn integers_accept_whole_numbers_only() {
        let parameters = vec![CommandParameter {
            param_type: JsonSchemaType::Integer,
            ..CommandParameter::required_number("count", "Count")
        }];
        assert!(validate_input(&parameters, json!({"count": 3})).is_ok());
        assert!(validate_input(&parameters, json!({"count": 3.0})).is_ok());

        // Zod's `z.number().int()` expects `int` for a fraction and `number`
        // for a value that is not a number at all.
        let fraction = validate_input(&parameters, json!({"count": 3.5})).unwrap_err();
        assert_eq!(issues_of(&fraction)[0]["expected"], "int");
        let text = validate_input(&parameters, json!({"count": "3"})).unwrap_err();
        assert_eq!(issues_of(&text)[0]["expected"], "number");
        let missing = validate_input(&parameters, json!({})).unwrap_err();
        assert_eq!(issues_of(&missing)[0]["expected"], "number");
    }

    fn filter_parameters() -> Vec<CommandParameter> {
        let tag_schema = JsonSchema {
            schema_type: Some(JsonSchemaType::String),
            min_length: Some(2),
            pattern: Some("^[a-z]+$".to_string()),
            ..JsonSchema::default()
        };
        let filter_schema = JsonSchema {
            schema_type: Some(JsonSchemaType::Object),
            required: Some(vec!["tags".to_string()]),
            properties: Some(HashMap::from([
                (
                    "tags".to_string(),
                    JsonSchema {
                        schema_type: Some(JsonSchemaType::Array),
                        items: Some(Box::new(tag_schema)),
                        max_length: Some(3),
                        ..JsonSchema::default()
                    },
                ),
                (
                    "limit".to_string(),
                    JsonSchema {
                        schema_type: Some(JsonSchemaType::Number),
                        minimum: Some(1.0),
                        maximum: Some(100.0),
                        ..JsonSchema::default()
                    },
                ),
            ])),
            ..JsonSchema::default()
        };
        vec![CommandParameter {
            param_type: JsonSchemaType::Object,
            schema: Some(filter_schema),
            ..CommandParameter::required_string("filter", "Filter")
        }]
    }

    #[test]
    fn nested_schemas_are_checked() {
        let parameters = filter_parameters();
        assert!(validate_input(
            &parameters,
            json!({"filter": {"tags": ["home", "work"], "limit": 10}})
        )
        .is_ok());

        let error = validate_input(
            &parameters,
            json!({"filter": {"tags": ["ok", "X1", "a", 5], "limit": 0}}),
        )
        .unwrap_err();
        let mut issues = issues_of(&error);
        issues.sort_by_key(|issue| issue["path"].to_string());
        assert_eq!(
            issues,
            vec![
                json!({
                    "path": "filter.limit",
                    "message": "must be at least 1",
                    "code": "too_small",
                }),
                json!({
                    "path": "filter.tags",
                    "message": "must have at most 3 items",
                    "code": "too_big",
                }),
                json!({
                    "path": "filter.tags.1",
                    "message": "must match the pattern ^[a-z]+$",
                    "code": "invalid_format",
                }),
                json!({
                    "path": "filter.tags.2",
                    "message": "must be at least 2 characters long",
                    "code": "too_small",
                }),
                json!({
                    "path": "filter.tags.3",
                    "message": "must be a string, got number",
                    "code": "invalid_type",
                    "expected": "string",
                }),
            ]
        );

        let error = validate_input(&parameters, json!({"filter": {}})).unwrap_err();
        assert_eq!(
            issues_of(&error),
            vec![json!({
                "path": "filter.tags",
                "message": "is required",
                "code": "invalid_type",
                "expected": "array",
            })]
        );
    }

    #[test]
    fn nested_undeclared_keys_are_dropped() {
        let input = validate_input(
            &filter_parameters(),
            json!({"filter": {"tags": ["home"], "junk": 1}, "extra": 2}),
        )
        .unwrap();
        assert_eq!(input, json!({"filter": {"tags": ["home"]}}));
    }

    #[test]
    fn undeclared_keys_are_dropped_inside_array_items() {
        let parameters = vec![CommandParameter {
            param_type: JsonSchemaType::Array,
            schema: Some(JsonSchema {
                schema_type: Some(JsonSchemaType::Array),
                items: Some(Box::new(JsonSchema {
                    schema_type: Some(JsonSchemaType::Object),
                    properties: Some(HashMap::from([(
                        "title".to_string(),
                        JsonSchema {
                            schema_type: Some(JsonSchemaType::String),
                            ..JsonSchema::default()
                        },
                    )])),
                    ..JsonSchema::default()
                })),
                ..JsonSchema::default()
            }),
            ..CommandParameter::required_string("todos", "Todos")
        }];
        let input = validate_input(
            &parameters,
            json!({"todos": [{"title": "a", "x": 1}, {"title": "b"}]}),
        )
        .unwrap();
        assert_eq!(input, json!({"todos": [{"title": "a"}, {"title": "b"}]}));
    }

    #[test]
    fn open_objects_keep_their_keys() {
        // An object parameter with no `properties` declares no shape.
        let parameters = vec![CommandParameter {
            param_type: JsonSchemaType::Object,
            ..CommandParameter::required_string("metadata", "Metadata")
        }];
        let input = validate_input(&parameters, json!({"metadata": {"any": {"thing": 1}}}));
        assert_eq!(input.unwrap(), json!({"metadata": {"any": {"thing": 1}}}));

        // `additionalProperties` keeps the extra keys, stripped by its own schema.
        let parameters = vec![CommandParameter {
            param_type: JsonSchemaType::Object,
            schema: Some(JsonSchema {
                schema_type: Some(JsonSchemaType::Object),
                properties: Some(HashMap::from([(
                    "name".to_string(),
                    JsonSchema {
                        schema_type: Some(JsonSchemaType::String),
                        ..JsonSchema::default()
                    },
                )])),
                additional_properties: Some(Box::new(JsonSchema {
                    schema_type: Some(JsonSchemaType::Object),
                    properties: Some(HashMap::from([(
                        "value".to_string(),
                        JsonSchema {
                            schema_type: Some(JsonSchemaType::Number),
                            ..JsonSchema::default()
                        },
                    )])),
                    ..JsonSchema::default()
                })),
                ..JsonSchema::default()
            }),
            ..CommandParameter::required_string("labels", "Labels")
        }];
        let input = validate_input(
            &parameters,
            json!({"labels": {"name": "n", "a": {"value": 1, "junk": true}}}),
        );
        assert_eq!(
            input.unwrap(),
            json!({"labels": {"name": "n", "a": {"value": 1}}})
        );
    }

    #[test]
    fn issue_collection_is_bounded() {
        let parameters = vec![CommandParameter {
            param_type: JsonSchemaType::Array,
            schema: Some(JsonSchema {
                schema_type: Some(JsonSchemaType::Array),
                items: Some(Box::new(JsonSchema {
                    schema_type: Some(JsonSchemaType::String),
                    ..JsonSchema::default()
                })),
                ..JsonSchema::default()
            }),
            ..CommandParameter::required_string("ids", "IDs")
        }];
        let input = json!({"ids": vec![0; 10_000]});
        let error = validate_input(&parameters, input).unwrap_err();
        assert_eq!(issues_of(&error).len(), MAX_ISSUES);
        let suggestion = error.suggestion.as_deref().unwrap();
        assert_eq!(
            suggestion.lines().count(),
            MAX_ISSUES_IN_SUGGESTION + 1,
            "{suggestion}"
        );
        assert!(
            suggestion.ends_with("- and more. Expected fields: ids"),
            "{suggestion}"
        );
    }
}
