//! The eleven todo commands of `spec/commands.schema.json`.
//!
//! Each command declares its input as a JSON Schema. [`Validated`] checks the
//! input against it (see `validation.rs`) before the typed handler runs, and
//! the server advertises the same schema in `tools/list`, so the advertised
//! and enforced contracts cannot drift apart.

mod clear;
mod create;
mod create_batch;
mod delete;
mod delete_batch;
mod get;
mod list;
mod stats;
mod toggle;
mod toggle_batch;
mod update;

#[cfg(test)]
mod tests;

use crate::store::TodoStore;
use crate::validation::validate;
use afd::{
    failure, success_with, CommandContext, CommandDefinition, CommandError, CommandHandler,
    CommandParameter, CommandRegistry, CommandResult, ExposeOptions, JsonSchemaType, ResultOptions,
    Warning, WarningSeverity,
};
use async_trait::async_trait;
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;
use std::sync::Arc;

/// A command with a typed input and a JSON Schema describing it.
pub trait Command: Send + Sync + 'static {
    type Input: DeserializeOwned + Send;
    const NAME: &'static str;
    const DESCRIPTION: &'static str;
    const MUTATION: bool;

    /// JSON Schema of the input object.
    fn schema() -> Value;

    fn run(&self, input: Self::Input) -> CommandResult<Value>;
}

/// Runs a [`Command`] after validating its input against its schema.
struct Validated<C> {
    schema: Value,
    command: C,
}

#[async_trait]
impl<C: Command> CommandHandler for Validated<C> {
    async fn execute(&self, input: Value, _context: CommandContext) -> CommandResult<Value> {
        let input = match validate(&self.schema, input) {
            Ok(input) => input,
            Err(error) => return failure(*error),
        };
        match serde_json::from_value::<C::Input>(Value::Object(input)) {
            Ok(input) => self.command.run(input),
            // The schema and the input type disagree: a bug in this backend.
            Err(error) => failure(
                CommandError::internal(&format!("{}: {error}", C::NAME))
                    .with_suggestion("Report this bug; the command's schema and input type differ"),
            ),
        }
    }
}

/// A command as advertised by `tools/list`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tool {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

/// The todo commands are meant for remote agents and the command line, so
/// each opts in to `mcp` and `cli`; the defaults keep both closed.
fn exposure() -> ExposeOptions {
    ExposeOptions {
        mcp: true,
        cli: true,
        ..ExposeOptions::default()
    }
}

/// Registry metadata for each top-level property, derived from the schema so
/// that `required` and the defaults cannot disagree with validation.
fn parameters(schema: &Value) -> Vec<CommandParameter> {
    let required: Vec<&str> = schema
        .get("required")
        .and_then(Value::as_array)
        .map(|names| names.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    let Some(properties) = schema.get("properties").and_then(Value::as_object) else {
        return Vec::new();
    };
    properties
        .iter()
        .map(|(name, property)| CommandParameter {
            name: name.clone(),
            param_type: match property.get("type").and_then(Value::as_str) {
                Some("integer") => JsonSchemaType::Integer,
                Some("number") => JsonSchemaType::Number,
                Some("boolean") => JsonSchemaType::Boolean,
                Some("array") => JsonSchemaType::Array,
                Some("object") => JsonSchemaType::Object,
                _ => JsonSchemaType::String,
            },
            description: property
                .get("description")
                .and_then(Value::as_str)
                .unwrap_or(name)
                .to_string(),
            required: required.contains(&name.as_str()),
            default: property.get("default").cloned(),
            enum_values: property.get("enum").and_then(Value::as_array).cloned(),
            schema: None,
        })
        .collect()
}

/// Register one command and return its tool description.
fn register<C: Command>(registry: &mut CommandRegistry, command: C) -> Result<Tool, String> {
    let schema = C::schema();
    let mut definition = CommandDefinition::new(
        C::NAME,
        C::DESCRIPTION,
        parameters(&schema),
        Validated {
            schema: schema.clone(),
            command,
        },
    )
    .with_category("todo")
    .with_version("1.0.0")
    .with_expose(exposure());
    if C::MUTATION {
        definition = definition.as_mutation();
    }
    registry.register(definition)?;
    Ok(Tool {
        name: C::NAME.to_string(),
        description: C::DESCRIPTION.to_string(),
        input_schema: schema,
    })
}

/// Register every todo command against `store`. Returns the tool descriptions
/// in registration order.
pub fn register_commands(
    registry: &mut CommandRegistry,
    store: &Arc<TodoStore>,
) -> Result<Vec<Tool>, String> {
    let store = || Arc::clone(store);
    Ok(vec![
        register(registry, create::Create(store()))?,
        register(registry, list::List(store()))?,
        register(registry, get::Get(store()))?,
        register(registry, update::Update(store()))?,
        register(registry, toggle::Toggle(store()))?,
        register(registry, delete::Delete(store()))?,
        register(registry, clear::Clear(store()))?,
        register(registry, stats::Stats(store()))?,
        register(registry, create_batch::CreateBatch(store()))?,
        register(registry, delete_batch::DeleteBatch(store()))?,
        register(registry, toggle_batch::ToggleBatch(store()))?,
    ])
}

// ═══════════════════════════════════════════════════════════════════════════════
// Shared helpers
// ═══════════════════════════════════════════════════════════════════════════════

/// A successful result with reasoning, confidence and optional warnings.
fn ok<T: Serialize>(
    data: &T,
    reasoning: String,
    confidence: f64,
    warnings: Vec<Warning>,
) -> CommandResult<Value> {
    match serde_json::to_value(data) {
        Ok(data) => success_with(
            data,
            ResultOptions {
                reasoning: Some(reasoning),
                confidence: Some(confidence),
                warnings: (!warnings.is_empty()).then_some(warnings),
                ..ResultOptions::default()
            },
        ),
        Err(error) => failure(
            CommandError::internal(&format!("Could not serialize the result: {error}"))
                .with_suggestion("Retry the command; report this bug if it persists"),
        ),
    }
}

fn warning(code: &str, message: String, severity: WarningSeverity) -> Warning {
    Warning::new(code, message).with_severity(severity)
}

/// `NOT_FOUND` with the same message and suggestion as the TypeScript backend.
fn not_found(id: &str) -> CommandError {
    CommandError::new("NOT_FOUND", format!("Todo with ID \"{id}\" not found"))
        .with_suggestion("Use todo-list to see available todos")
        .with_retryable(false)
}

/// JSON Schema pieces shared by several commands.
mod schema {
    use serde_json::{json, Value};

    pub fn title() -> Value {
        json!({ "type": "string", "minLength": 1, "maxLength": 200, "description": "Todo title" })
    }

    pub fn description() -> Value {
        json!({ "type": "string", "maxLength": 1000, "description": "Optional details" })
    }

    pub fn priority(description: &str) -> Value {
        json!({ "type": "string", "enum": ["low", "medium", "high"], "description": description })
    }

    pub fn priority_with_default(description: &str) -> Value {
        json!({
            "type": "string",
            "enum": ["low", "medium", "high"],
            "default": "medium",
            "description": description
        })
    }

    pub fn id() -> Value {
        json!({ "type": "string", "minLength": 1, "description": "Todo ID" })
    }

    pub fn ids() -> Value {
        json!({
            "type": "array",
            "items": { "type": "string", "minLength": 1 },
            "minItems": 1,
            "maxItems": 100,
            "description": "Todo IDs (1 to 100)"
        })
    }
}

/// Counts shared by the batch commands' `summary`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Summary {
    total: usize,
    success_count: usize,
    failure_count: usize,
}

/// A batch item that failed, reported by index (spec `FailedItem`).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FailedItem {
    index: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    input: Option<Value>,
    error: CommandError,
}

/// Confidence of a batch: the share of items that succeeded.
fn batch_confidence(succeeded: usize, total: usize) -> f64 {
    if total == 0 {
        0.0
    } else {
        succeeded as f64 / total as f64
    }
}
