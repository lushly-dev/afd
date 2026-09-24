//! Input validation against a command's declared parameters.
//!
//! [`CommandRegistry::execute`](crate::CommandRegistry::execute) runs this
//! before a handler is called. A parameter is checked against its `schema`
//! when it has one, and otherwise against its `type` and `enum`, which is the
//! same schema [`command_to_mcp_tool`](crate::command_to_mcp_tool) advertises.

use regex::Regex;
use serde_json::{Map, Value};
use std::collections::HashMap;

use crate::commands::{CommandParameter, JsonSchema, JsonSchemaType};
use crate::errors::{error_codes, CommandError};

/// At most this many issues are collected for one input.
const MAX_ISSUES: usize = 50;

/// At most this many issues are summarized in the error message.
const MAX_ISSUES_IN_MESSAGE: usize = 5;

/// At most this many parameters are listed in the suggestion.
const MAX_PARAMETERS_IN_SUGGESTION: usize = 20;

/// At most this many enum values are listed in one issue.
const MAX_ENUM_VALUES_IN_MESSAGE: usize = 10;

/// One problem with one input field.
#[derive(Debug, Clone, PartialEq)]
struct Issue {
    path: String,
    message: String,
}

#[derive(Default)]
struct Issues {
    items: Vec<Issue>,
    truncated: bool,
}

impl Issues {
    fn push(&mut self, path: &str, message: String) {
        if self.items.len() < MAX_ISSUES {
            self.items.push(Issue {
                path: path.to_string(),
                message,
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
/// - Keys that no parameter declares are kept and passed through.
///
/// Returns the input to pass to the handler, or a `VALIDATION_ERROR`.
pub(crate) fn validate_input(
    command_name: &str,
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
            issues.push(
                "input",
                format!("must be a JSON object, got {}", value_type_name(&other)),
            );
            return Err(validation_failure(
                command_name,
                parameters,
                &issues,
                &[],
                &[],
            ));
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
                issues.push(&parameter.name, "is required".to_string());
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
        return Ok(Value::Object(object));
    }

    let unexpected: Vec<String> = object
        .keys()
        .filter(|key| !parameters.iter().any(|parameter| &parameter.name == *key))
        .cloned()
        .collect();
    Err(validation_failure(
        command_name,
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
            issues.push(
                path,
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
            issues.push(path, format!("must be one of {}", format_values(allowed)));
            return;
        }
    }

    match value {
        Value::Number(number) => {
            let number = number.as_f64().unwrap_or(f64::NAN);
            if let Some(minimum) = schema.minimum {
                if number < minimum {
                    issues.push(path, format!("must be at least {minimum}"));
                }
            }
            if let Some(maximum) = schema.maximum {
                if number > maximum {
                    issues.push(path, format!("must be at most {maximum}"));
                }
            }
        }
        Value::String(text) => {
            let length = text.chars().count();
            if let Some(min_length) = schema.min_length {
                if length < min_length {
                    issues.push(
                        path,
                        format!("must be at least {min_length} characters long"),
                    );
                }
            }
            if let Some(max_length) = schema.max_length {
                if length > max_length {
                    issues.push(
                        path,
                        format!("must be at most {max_length} characters long"),
                    );
                }
            }
            if let Some(pattern) = &schema.pattern {
                // An invalid pattern is a bug in the definition, not in the input.
                if Regex::new(pattern).is_ok_and(|regex| !regex.is_match(text)) {
                    issues.push(path, format!("must match the pattern {pattern}"));
                }
            }
        }
        Value::Array(items) => {
            if let Some(min_length) = schema.min_length {
                if items.len() < min_length {
                    issues.push(path, format!("must have at least {min_length} items"));
                }
            }
            if let Some(max_length) = schema.max_length {
                if items.len() > max_length {
                    issues.push(path, format!("must have at most {max_length} items"));
                }
            }
            if let Some(item_schema) = &schema.items {
                for (index, item) in items.iter().enumerate() {
                    if issues.is_full() {
                        issues.truncated = true;
                        break;
                    }
                    check_schema(item, item_schema, &format!("{path}[{index}]"), issues);
                }
            }
        }
        Value::Object(object) => {
            for key in schema.required.iter().flatten() {
                if !object.contains_key(key) {
                    issues.push(&format!("{path}.{key}"), "is required".to_string());
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

/// `title (string, required)`, `priority (string, one of "low", "high")`.
fn describe_parameter(parameter: &CommandParameter) -> String {
    let schema_type = parameter
        .schema
        .as_ref()
        .and_then(|schema| schema.schema_type.as_ref())
        .unwrap_or(&parameter.param_type);
    let mut parts = vec![schema_type_name(schema_type).to_string()];
    if parameter.required && parameter.default.is_none() {
        parts.push("required".to_string());
    }
    let enum_values = parameter
        .schema
        .as_ref()
        .and_then(|schema| schema.enum_values.as_ref())
        .or(parameter.enum_values.as_ref());
    if let Some(values) = enum_values {
        parts.push(format!("one of {}", format_values(values)));
    }
    format!("{} ({})", parameter.name, parts.join(", "))
}

fn validation_failure(
    command_name: &str,
    parameters: &[CommandParameter],
    issues: &Issues,
    missing: &[String],
    unexpected: &[String],
) -> Box<CommandError> {
    let mut summary: Vec<String> = issues
        .items
        .iter()
        .take(MAX_ISSUES_IN_MESSAGE)
        .map(|issue| format!("{} {}", issue.path, issue.message))
        .collect();
    let hidden = issues.items.len().saturating_sub(MAX_ISSUES_IN_MESSAGE);
    if hidden > 0 || issues.truncated {
        summary.push("and more".to_string());
    }

    let mut expected: Vec<String> = parameters
        .iter()
        .take(MAX_PARAMETERS_IN_SUGGESTION)
        .map(describe_parameter)
        .collect();
    if parameters.len() > MAX_PARAMETERS_IN_SUGGESTION {
        expected.push(format!(
            "and {} more",
            parameters.len() - MAX_PARAMETERS_IN_SUGGESTION
        ));
    }

    let errors: Vec<Value> = issues
        .items
        .iter()
        .map(|issue| serde_json::json!({ "path": issue.path, "message": issue.message }))
        .collect();
    let mut details = HashMap::new();
    details.insert("errors".to_string(), Value::Array(errors));
    details.insert(
        "expectedFields".to_string(),
        serde_json::json!(parameters
            .iter()
            .map(|parameter| parameter.name.as_str())
            .collect::<Vec<_>>()),
    );
    details.insert("missingFields".to_string(), serde_json::json!(missing));
    details.insert(
        "unexpectedFields".to_string(),
        serde_json::json!(unexpected),
    );

    Box::new(
        CommandError::new(
            error_codes::VALIDATION_ERROR,
            format!(
                "Input validation failed for '{command_name}': {}",
                summary.join("; ")
            ),
        )
        .with_suggestion(format!(
            "Fix the listed fields and retry. Expected parameters: {}",
            expected.join(", ")
        ))
        .with_retryable(false)
        .with_details(details),
    )
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
    fn accepts_valid_input_and_applies_defaults() {
        let input = validate_input(
            "todo-create",
            &parameters(),
            json!({"title": "Buy milk", "priority": "low", "extra": 1}),
        )
        .unwrap();
        assert_eq!(
            input,
            json!({"title": "Buy milk", "priority": "low", "done": false, "extra": 1})
        );
    }

    #[test]
    fn commands_without_parameters_accept_anything() {
        assert_eq!(
            validate_input("todo-stats", &[], json!("anything")).unwrap(),
            json!("anything")
        );
        assert_eq!(
            validate_input("todo-stats", &[], Value::Null).unwrap(),
            Value::Null
        );
    }

    #[test]
    fn null_input_counts_as_an_empty_object() {
        let parameters = vec![priority()];
        assert_eq!(
            validate_input("todo-list", &parameters, Value::Null).unwrap(),
            json!({})
        );
    }

    #[test]
    fn reports_missing_required_fields() {
        let error = validate_input("todo-create", &parameters(), json!({})).unwrap_err();
        assert_eq!(error.code, "VALIDATION_ERROR");
        assert_eq!(error.retryable, Some(false));
        assert!(
            error.message.contains("title is required"),
            "{}",
            error.message
        );
        let suggestion = error.suggestion.as_deref().unwrap();
        assert!(
            suggestion.contains("title (string, required)"),
            "{suggestion}"
        );
        assert!(
            suggestion.contains(r#"priority (string, one of "low", "medium", "high")"#),
            "{suggestion}"
        );
        let details = error.details.as_ref().unwrap();
        assert_eq!(details["missingFields"], json!(["title"]));
    }

    #[test]
    fn null_for_a_required_field_is_missing() {
        let error =
            validate_input("todo-create", &parameters(), json!({"title": null})).unwrap_err();
        assert_eq!(
            issues_of(&error),
            vec![json!({"path": "title", "message": "is required"})]
        );
    }

    #[test]
    fn reports_type_and_enum_mismatches() {
        let error = validate_input(
            "todo-create",
            &parameters(),
            json!({"title": 42, "priority": "urgent", "done": "yes", "typo": true}),
        )
        .unwrap_err();
        assert_eq!(
            issues_of(&error),
            vec![
                json!({"path": "title", "message": "must be a string, got number"}),
                json!({"path": "priority", "message": r#"must be one of "low", "medium", "high""#}),
                json!({"path": "done", "message": "must be a boolean, got string"}),
            ]
        );
        assert_eq!(
            error.details.as_ref().unwrap()["unexpectedFields"],
            json!(["typo"])
        );
    }

    #[test]
    fn rejects_non_object_input() {
        let error = validate_input("todo-create", &parameters(), json!([1, 2])).unwrap_err();
        assert!(
            error
                .message
                .contains("input must be a JSON object, got array"),
            "{}",
            error.message
        );
    }

    #[test]
    fn integers_accept_whole_numbers_only() {
        let parameters = vec![CommandParameter {
            param_type: JsonSchemaType::Integer,
            ..CommandParameter::required_number("count", "Count")
        }];
        assert!(validate_input("item-count", &parameters, json!({"count": 3})).is_ok());
        assert!(validate_input("item-count", &parameters, json!({"count": 3.0})).is_ok());
        assert!(validate_input("item-count", &parameters, json!({"count": 3.5})).is_err());
    }

    #[test]
    fn nested_schemas_are_checked() {
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
        let parameters = vec![CommandParameter {
            param_type: JsonSchemaType::Object,
            schema: Some(filter_schema),
            ..CommandParameter::required_string("filter", "Filter")
        }];

        assert!(validate_input(
            "todo-search",
            &parameters,
            json!({"filter": {"tags": ["home", "work"], "limit": 10}})
        )
        .is_ok());

        let error = validate_input(
            "todo-search",
            &parameters,
            json!({"filter": {"tags": ["ok", "X1", "a", 5], "limit": 0}}),
        )
        .unwrap_err();
        let mut issues = issues_of(&error);
        issues.sort_by_key(|issue| issue["path"].to_string());
        assert_eq!(
            issues,
            vec![
                json!({"path": "filter.limit", "message": "must be at least 1"}),
                json!({"path": "filter.tags", "message": "must have at most 3 items"}),
                json!({"path": "filter.tags[1]", "message": "must match the pattern ^[a-z]+$"}),
                json!({"path": "filter.tags[2]", "message": "must be at least 2 characters long"}),
                json!({"path": "filter.tags[3]", "message": "must be a string, got number"}),
            ]
        );

        let error = validate_input("todo-search", &parameters, json!({"filter": {}})).unwrap_err();
        assert_eq!(
            issues_of(&error),
            vec![json!({"path": "filter.tags", "message": "is required"})]
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
        let error = validate_input("item-get", &parameters, input).unwrap_err();
        assert_eq!(issues_of(&error).len(), MAX_ISSUES);
        assert!(error.message.ends_with("and more"), "{}", error.message);
    }
}
