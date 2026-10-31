//! The meta-tools (`afd-call`, `afd-batch`, `afd-pipe`, `afd-discover`, `afd-detail`): their
//! MCP definitions, argument checks and the discovery tools.
//!
//! The definitions are TypeScript's, field for field (`spec/wire/meta-tools.json`; a test checks
//! both against it).

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;

use serde_json::{json, Map, Value};

use crate::approval::approval_mode;
use crate::{
    error_codes, success_with, CommandDefinition, CommandError, CommandResult, ResultMetadata,
    ResultOptions,
};

use super::strategy::{default_command_group, object_schema};

const CONFIRM_FLAG: &str = "Set to true to confirm a command that asks for confirmation, once the user intends it (only on servers that enforce confirmations)";
const CONFIRM_NAMES: &str = "Names of the commands that ask for confirmation and are confirmed, once the user intends them (only on servers that enforce confirmations)";

/// The `afd-call` tool.
pub fn call_tool() -> Value {
    json!({
        "name": "afd-call",
        "description": "Invoke any command by name with runtime input validation. Works in all server strategies.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "command": { "type": "string", "minLength": 1, "description": "Command name to invoke" },
                "input": { "type": "object", "description": "Command input (validated against the command's own schema at runtime)" },
                "confirm": { "description": CONFIRM_FLAG, "type": "boolean" },
            },
            "required": ["command"],
        },
    })
}

/// The `afd-batch` tool.
pub fn batch_tool() -> Value {
    json!({
        "name": "afd-batch",
        "description": "Execute multiple commands in a single batch request with partial success semantics",
        "inputSchema": {
            "type": "object",
            "properties": {
                "commands": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "id": { "description": "Optional client-provided ID for correlating results", "type": "string" },
                            "command": { "type": "string", "description": "The command name to execute" },
                            "input": { "type": "object", "description": "Input parameters for the command" },
                        },
                        "required": ["command"],
                    },
                    "description": "Array of commands to execute",
                },
                "options": {
                    "description": "Batch execution options",
                    "type": "object",
                    "properties": {
                        "stopOnError": { "description": "Stop execution on first error", "type": "boolean" },
                        "timeout": { "description": "Timeout in milliseconds for entire batch", "type": "number", "minimum": 0 },
                        "parallelism": {
                            "description": "Maximum commands to run concurrently (default 1)",
                            "type": "integer",
                            "minimum": 1,
                            "maximum": 9_007_199_254_740_991_u64,
                        },
                    },
                },
                "confirm": { "description": CONFIRM_NAMES, "type": "array", "items": { "type": "string" } },
            },
            "required": ["commands"],
        },
    })
}

const STEP_INPUT: &str = "Input parameters. A string value that is exactly $prev, $first, $steps[n], $steps.alias or $input, optionally followed by .path (e.g. $prev.items[0].id), is replaced by that data; unresolved references are omitted. Other strings are literals; start one with $$ to send a literal $ (e.g. $$prev).";

/// The `afd-pipe` tool.
pub fn pipe_tool() -> Value {
    json!({
        "name": "afd-pipe",
        "description": "Execute a pipeline of chained commands where the output of one becomes the input of the next",
        "inputSchema": {
            "type": "object",
            "properties": {
                "input": { "description": "Optional pipeline input (any JSON value), available to steps as $input and $input.<path>" },
                "steps": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "command": { "type": "string", "description": "Command name to execute" },
                            "input": {
                                "description": STEP_INPUT,
                                "type": "object",
                                "propertyNames": { "type": "string" },
                                "additionalProperties": {},
                            },
                            "as": { "description": "Optional alias for referencing this step's output", "type": "string" },
                            "when": {
                                "description": "Optional condition for running this step (e.g., { $exists: '$prev.id' })",
                                "type": "object",
                                "propertyNames": { "type": "string" },
                                "additionalProperties": {},
                            },
                        },
                        "required": ["command"],
                    },
                    "description": "Ordered list of pipeline steps to execute",
                },
                "options": {
                    "description": "Pipeline execution options",
                    "type": "object",
                    "properties": {
                        "continueOnFailure": { "description": "Continue on failure or stop immediately", "type": "boolean" },
                        "timeoutMs": { "description": "Timeout for entire pipeline in milliseconds", "type": "number", "minimum": 0 },
                    },
                },
                "confirm": { "description": CONFIRM_NAMES, "type": "array", "items": { "type": "string" } },
            },
            "required": ["steps"],
        },
    })
}

/// The `afd-discover` tool.
pub fn discover_tool() -> Value {
    json!({
        "name": "afd-discover",
        "description": "List available commands with optional filtering by category, tag, or search text. Returns compact summaries.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "category": { "description": "Filter commands by category", "type": "string" },
                "tag": {
                    "description": "Filter by tag(s). String for single, array for multiple.",
                    "anyOf": [{ "type": "string" }, { "type": "array", "items": { "type": "string" } }],
                },
                "tagMode": { "description": "Tag matching mode (default: any)", "type": "string", "enum": ["all", "any"] },
                "search": { "description": "Text search across names and descriptions", "type": "string" },
                "includeMutation": { "description": "Include mutation classification", "type": "boolean" },
                "limit": { "description": "Max results (1-200, default 50)", "type": "number" },
                "offset": { "description": "Results to skip for pagination", "type": "number" },
            },
        },
    })
}

/// The `afd-detail` tool.
pub fn detail_tool() -> Value {
    json!({
        "name": "afd-detail",
        "description": "Get the full input schema and metadata for one or more commands by name.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "command": {
                    "anyOf": [{ "type": "string" }, { "type": "array", "items": { "type": "string" } }],
                    "description": "Command name or names (exact match, kebab-case). String or array of strings (max 10).",
                },
            },
            "required": ["command"],
        },
    })
}

// ═══════════════════════════════════════════════════════════════════════════════
// ARGUMENT CHECKS
// ═══════════════════════════════════════════════════════════════════════════════

/// The schemas the arguments are checked against: the advertised ones, in the keywords the
/// crate's validator supports (`anyOf` of a string or string array becomes a type list, and an
/// `input` that TypeScript accepts as any value has no type).
fn check_schema(tool: &str) -> Value {
    let names = json!({ "type": ["string", "array"], "items": { "type": "string" } });
    match tool {
        "afd-call" => json!({
            "type": "object",
            "properties": {
                "command": { "type": "string", "minLength": 1 },
                "input": {},
                "confirm": { "type": "boolean" },
            },
            "required": ["command"],
        }),
        "afd-batch" => json!({
            "type": "object",
            "properties": {
                "commands": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "id": { "type": "string" },
                            "command": { "type": "string", "minLength": 1 },
                            "input": {},
                        },
                        "required": ["command"],
                    },
                },
                "options": {
                    "type": "object",
                    "properties": {
                        "stopOnError": { "type": "boolean" },
                        "timeout": { "type": "number", "minimum": 0 },
                        "parallelism": { "type": "integer", "minimum": 1 },
                    },
                },
                "confirm": { "type": "array", "items": { "type": "string" } },
            },
            "required": ["commands"],
        }),
        "afd-pipe" => json!({
            "type": "object",
            "properties": {
                "input": {},
                "steps": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "command": { "type": "string", "minLength": 1 },
                            "input": { "type": "object", "additionalProperties": true },
                            "as": { "type": "string" },
                            "when": { "type": "object", "additionalProperties": true },
                        },
                        "required": ["command"],
                    },
                },
                "options": {
                    "type": "object",
                    "properties": {
                        "continueOnFailure": { "type": "boolean" },
                        "timeoutMs": { "type": "number", "minimum": 0 },
                    },
                },
                "confirm": { "type": "array", "items": { "type": "string" } },
            },
            "required": ["steps"],
        }),
        "afd-discover" => json!({
            "type": "object",
            "properties": {
                "category": { "type": "string" },
                "tag": names,
                "tagMode": { "type": "string", "enum": ["all", "any"] },
                "search": { "type": "string" },
                "includeMutation": { "type": "boolean" },
                "limit": { "type": "number" },
                "offset": { "type": "number" },
            },
        }),
        _ => json!({
            "type": "object",
            "properties": { "command": names },
            "required": ["command"],
        }),
    }
}

/// Check meta-tool arguments: the parsed arguments, or the validation error.
pub(crate) fn check_args(tool: &str, args: Value) -> Result<Value, Box<CommandError>> {
    crate::schema_validation::execute(&check_schema(tool), args)
}

/// Check the arguments of `afd-call`, `afd-discover` or `afd-detail`. Top-level `null` values
/// count as omitted, since agents often send `null` for optional fields. Invalid arguments are a
/// `VALIDATION_ERROR`.
pub(crate) fn parse_args(
    tool: &str,
    args: &Map<String, Value>,
    usage: &str,
) -> Result<Value, Box<CommandError>> {
    let args: Map<String, Value> = args
        .iter()
        .filter(|(_, value)| !value.is_null())
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect();
    check_args(tool, Value::Object(args))
        .map_err(|error| Box::new(invalid_args(tool, &error, usage)))
}

/// The `VALIDATION_ERROR` of invalid meta-tool arguments.
pub(crate) fn invalid_args(tool: &str, error: &CommandError, usage: &str) -> CommandError {
    let mut invalid = CommandError::new(
        error_codes::VALIDATION_ERROR,
        format!("Invalid {tool} arguments"),
    )
    .with_suggestion(format!("{}. {usage}", usage_prefix(error)));
    if let Some(details) = &error.details {
        invalid = invalid.with_details(details.clone());
    }
    invalid
}

/// The validator's suggestion without its final period, to join with the usage.
pub(crate) fn usage_prefix(error: &CommandError) -> String {
    error
        .suggestion
        .clone()
        .unwrap_or_else(|| error.message.clone())
        .trim_end_matches('.')
        .to_owned()
}

// ═══════════════════════════════════════════════════════════════════════════════
// DISCOVER AND DETAIL
// ═══════════════════════════════════════════════════════════════════════════════

fn timed(data: Value, reasoning: String, started: Instant) -> CommandResult<Value> {
    let elapsed = started.elapsed().as_secs_f64() * 1000.0;
    let metadata =
        ResultMetadata::default().with_execution_time_ms((elapsed * 100.0).round() / 100.0);
    success_with(
        data,
        ResultOptions {
            reasoning: Some(reasoning),
            confidence: Some(1.0),
            metadata: Some(metadata),
            ..ResultOptions::default()
        },
    )
}

/// The first sentence of `description`, or at most `max` characters of it.
fn truncate_description(description: &str, max: usize) -> String {
    let first = split_sentence(description);
    if first.chars().count() <= max {
        return first.to_owned();
    }
    let cut: String = description.chars().take(max - 1).collect();
    format!("{cut}\u{2026}")
}

/// The text before the first `.` followed by whitespace.
fn split_sentence(text: &str) -> &str {
    let mut chars = text.char_indices().peekable();
    while let Some((index, ch)) = chars.next() {
        if ch == '.' && chars.peek().is_some_and(|(_, next)| next.is_whitespace()) {
            return &text[..index];
        }
    }
    text
}

fn matches_search(command: &CommandDefinition, query: &str) -> bool {
    let target = format!("{} {}", command.name, command.description).to_lowercase();
    query
        .to_lowercase()
        .split_whitespace()
        .all(|token| target.contains(token))
}

fn matches_tags(command: &CommandDefinition, tags: &[String], all: bool) -> bool {
    let own = command.tags.as_deref().unwrap_or_default();
    if own.is_empty() {
        return false;
    }
    if all {
        tags.iter().all(|tag| own.contains(tag))
    } else {
        tags.iter().any(|tag| own.contains(tag))
    }
}

fn strings(value: &Value) -> Vec<String> {
    match value {
        Value::String(text) => vec![text.clone()],
        Value::Array(items) => items
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect(),
        _ => vec![],
    }
}

fn format_number(value: f64) -> String {
    if value.fract() == 0.0 && value.abs() < 1e15 {
        format!("{}", value as i64)
    } else {
        value.to_string()
    }
}

/// `afd-discover` over `commands` (MCP-exposed and in the active context) with checked `args`.
pub(crate) fn discover(commands: &[Arc<CommandDefinition>], args: &Value) -> CommandResult<Value> {
    let started = Instant::now();
    let category = args["category"].as_str();
    let tags = strings(&args["tag"]);
    let all_tags_mode = args["tagMode"] == "all";
    let search = args["search"].as_str();
    let include_mutation = args["includeMutation"] == true;
    let limit = args["limit"].as_f64().unwrap_or(50.0);
    let offset = args["offset"].as_f64().unwrap_or(0.0);

    let mut categories: Vec<String> = Vec::new();
    let mut all_tags: Vec<String> = Vec::new();
    for command in commands {
        let group = default_command_group(command);
        if !categories.contains(&group) {
            categories.push(group);
        }
        for tag in command.tags.iter().flatten() {
            if !all_tags.contains(tag) {
                all_tags.push(tag.clone());
            }
        }
    }
    categories.sort();
    all_tags.sort();

    let filtered: Vec<&Arc<CommandDefinition>> = commands
        .iter()
        .filter(|command| {
            category.is_none_or(|category| default_command_group(command) == category)
        })
        .filter(|command| args["tag"].is_null() || matches_tags(command, &tags, all_tags_mode))
        .filter(|command| search.is_none_or(|search| matches_search(command, search)))
        .collect();
    let total = commands.len();
    let filtered_count = filtered.len();

    let limit = limit.clamp(1.0, 200.0).trunc();
    let offset = offset.max(0.0).trunc();
    let start = (offset as usize).min(filtered_count);
    let page: Vec<Value> = filtered
        .iter()
        .skip(start)
        .take(limit as usize)
        .map(|command| {
            let mut summary = json!({
                "name": command.name,
                "description": truncate_description(&command.description, 120),
                "category": default_command_group(command),
            });
            if include_mutation {
                summary["mutation"] = json!(command.mutation);
            }
            summary
        })
        .collect();
    let has_more = offset + limit < filtered_count as f64;
    let returned = page.len();
    let in_category = category
        .map(|category| format!(" in category '{category}'"))
        .unwrap_or_default();
    let more = if has_more {
        format!(
            ". Use offset: {} to see more.",
            format_number(offset + limit)
        )
    } else {
        String::new()
    };
    timed(
        json!({
            "commands": page,
            "total": total,
            "filtered": filtered_count,
            "returned": returned,
            "hasMore": has_more,
            "availableCategories": categories,
            "availableTags": all_tags,
        }),
        format!("Returned {returned} of {filtered_count} matching commands ({total} total){in_category}{more}"),
        started,
    )
}

/// The most names one `afd-detail` call resolves.
const MAX_DETAIL_NAMES: usize = 10;

/// `afd-detail` over `commands` (MCP-exposed and in the active context), with their tools.
pub(crate) fn detail(
    commands: &[(Arc<CommandDefinition>, Option<Value>)],
    args: &Value,
) -> CommandResult<Value> {
    let started = Instant::now();
    let names: Vec<String> = strings(&args["command"])
        .into_iter()
        .take(MAX_DETAIL_NAMES)
        .collect();
    let by_name: HashMap<&str, &(Arc<CommandDefinition>, Option<Value>)> = commands
        .iter()
        .map(|entry| (entry.0.name.as_str(), entry))
        .collect();
    let all_names: Vec<String> = commands
        .iter()
        .map(|(command, _)| command.name.clone())
        .collect();
    let entries: Vec<Value> = names
        .iter()
        .map(|name| match by_name.get(name.as_str()) {
            None => {
                let shown = crate::commands::truncate_name(name);
                json!({
                    "name": shown,
                    "found": false,
                    "error": {
                        "code": error_codes::COMMAND_NOT_FOUND,
                        "message": format!("No command named '{shown}'"),
                        "suggestion": crate::commands::not_found_suggestion(name, &all_names, true),
                    },
                })
            }
            Some((command, tool)) => detail_entry(command, tool.as_ref()),
        })
        .collect();
    let found = entries
        .iter()
        .filter(|entry| entry["found"] == true)
        .count();
    timed(
        Value::Array(entries),
        format!("Resolved {found} of {} requested commands", names.len()),
        started,
    )
}

fn detail_entry(command: &CommandDefinition, tool: Option<&Value>) -> Value {
    let mut entry = Map::new();
    entry.insert("name".into(), json!(command.name));
    entry.insert("found".into(), json!(true));
    entry.insert("description".into(), json!(command.description));
    let mut optional = |key: &str, value: Option<Value>| {
        if let Some(value) = value {
            entry.insert(key.into(), value);
        }
    };
    optional(
        "category",
        command.category.as_ref().map(|value| json!(value)),
    );
    optional("tags", command.tags.as_ref().map(|value| json!(value)));
    optional("mutation", Some(json!(command.mutation)));
    optional(
        "executionTime",
        command.execution_time.as_ref().map(|value| json!(value)),
    );
    optional("errors", command.errors.as_ref().map(|value| json!(value)));
    optional("inputSchema", Some(object_schema(tool)));
    optional(
        "outputSchema",
        command.returns.as_ref().map(|value| json!(value)),
    );
    optional("destructive", command.destructive.map(|value| json!(value)));
    optional(
        "confirmPrompt",
        command.confirm_prompt.as_ref().map(|value| json!(value)),
    );
    optional("undoable", command.undoable.map(|value| json!(value)));
    optional(
        "approval",
        approval_mode(command.approval.as_ref()).map(|value| json!(value)),
    );
    optional("handoff", command.handoff.then_some(Value::Bool(true)));
    optional(
        "handoffProtocol",
        command.handoff_protocol.as_ref().map(|value| json!(value)),
    );
    optional(
        "version",
        command.version.as_ref().map(|value| json!(value)),
    );
    // Every command afd-detail can see is MCP-exposed, so callable.
    optional("callable", Some(json!(true)));
    Value::Object(entry)
}
