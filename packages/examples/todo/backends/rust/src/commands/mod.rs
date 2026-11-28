//! The thirteen todo commands of `spec/commands.schema.json`, mirroring the TypeScript backend's
//! `src/commands`: the same metadata, inputs, limits, error codes, suggestions, result shapes
//! and undo.
//!
//! Each command declares its input as a whole JSON Schema, which the registry validates
//! (`CommandRegistry::register_with_schema`) and the MCP server advertises, so the advertised
//! and enforced contracts cannot drift apart. The handler gets the validated input, with
//! defaults filled and undeclared keys dropped, as a typed value.
//!
//! Every successful change is recorded in the store's history from its result (who, when,
//! which todos, the undo), by the handler wrapper rather than by middleware, so a host that
//! registers [`definitions`] in a registry of its own (Umbel's todo plugin) keeps the history
//! too. The registry's approval middleware runs before the handler, so a held call is never
//! recorded.

mod clear;
mod create;
mod create_batch;
mod delete;
mod delete_batch;
mod get;
mod history;
mod list;
mod restore;
mod stats;
mod toggle;
mod toggle_batch;
mod update;

#[cfg(test)]
mod tests;

pub use clear::summarize_clear;

use crate::store::{Change, ChangeActor, TodoStore};
use crate::types::iso;
use afd::{
    failure, success_with, Alternative, ApprovalPolicy, CommandContext, CommandDefinition,
    CommandError, CommandExample, CommandHandler, CommandRegistry, CommandResult, ExposeOptions,
    IdempotencySupport, JsonSchema, RandomSource, ResultOptions, TaskSupport, Warning,
    WarningSeverity,
};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;
use std::sync::Arc;

/// Commands that only read: visible in both contexts.
pub const READ_CONTEXTS: [&str; 2] = ["todo-reading", "todo-editing"];
/// Commands that change todos: hidden while reading.
pub const EDIT_CONTEXTS: [&str; 1] = ["todo-editing"];

/// The ids the examples use.
const EXAMPLE_ID: &str = "todo-1700000000000-abc1234";
const OTHER_ID: &str = "todo-1700000000000-def5678";

/// A command with a typed input, a JSON Schema describing it and the shape of its data.
pub trait Command: Send + Sync + 'static {
    type Input: DeserializeOwned + Send;
    const NAME: &'static str;
    /// A short label, the MCP tool `title`.
    const TITLE: &'static str;
    const DESCRIPTION: &'static str;
    const TAGS: &'static [&'static str];
    const MUTATION: bool;
    /// Whether the command deletes data, sent to MCP clients as `destructiveHint`.
    const DESTRUCTIVE: bool = false;
    /// Whether its result names an undo.
    const UNDOABLE: bool = false;
    /// Commands to call first (metadata only).
    const REQUIRES: &'static [&'static str] = &[];
    /// The confirmation question, enforced when the server runs with `CONFIRMATIONS`.
    const CONFIRM_PROMPT: Option<&'static str> = None;
    /// Whether this command may or must run as an MCP task.
    const TASK: TaskSupport = TaskSupport::Never;
    /// What the command promises about repeating a call (`spec/idempotency.md`, D1 to D5).
    const IDEMPOTENCY: Option<IdempotencySupport> = None;
    /// Whether the handler answers a repeat with the same idempotency key itself (the handler's
    /// tier): for a `keyed` command that may run as an MCP task, on which the registry's step
    /// does not act (D5, S11).
    const KEYED_IN_HANDLER: bool = false;

    /// JSON Schema of the input object.
    fn schema() -> Value;

    /// JSON Schema of the result's `data`.
    fn output() -> Value;

    /// Inputs that show how to call it.
    fn examples() -> Vec<CommandExample>;

    /// The approval policy: every change declares one, `not-required` unless it says otherwise.
    fn approval() -> Option<ApprovalPolicy> {
        Self::MUTATION.then_some(ApprovalPolicy::NotRequired)
    }

    /// The todos a successful change touched, read from its result's data. Reads touch none,
    /// and a change that touched none is not recorded.
    fn changed(_data: &Value) -> Vec<String> {
        Vec::new()
    }

    fn run(&self, input: Self::Input, context: &CommandContext) -> CommandResult<Value>;
}

/// Runs a [`Command`] on the validated input and records a successful change in the history.
struct Handler<C> {
    command: C,
    store: Arc<TodoStore>,
}

#[async_trait]
impl<C: Command> CommandHandler for Handler<C> {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        // The scope and digest of a repeat the handler answers itself (K5, S4).
        let keyed = C::KEYED_IN_HANDLER
            .then(|| keyed_call(&context, &input))
            .flatten();
        let input = match serde_json::from_value::<C::Input>(input) {
            Ok(input) => input,
            // The schema and the input type disagree: a bug in this backend.
            Err(error) => {
                return failure(
                    CommandError::internal(&format!("{}: {error}", C::NAME)).with_suggestion(
                        "Report this bug; the command's schema and input type differ",
                    ),
                )
            }
        };
        if !C::MUTATION {
            return self.command.run(input, &context);
        }
        // The change and its history entry under one lock, so entries keep the changes' order.
        // A repeat with the same key waits here for the first call, then gets its answer.
        let _changing = self.store.changing();
        let now = context.clock().now();
        if let Some((scope, digest)) = &keyed {
            if let Some(answer) = self.store.keyed_answer(scope, now) {
                return if answer.digest == *digest {
                    answer.result
                } else {
                    failure(key_reused())
                };
            }
        }
        let result = self.command.run(input, &context);
        if result.success {
            record::<C>(&self.store, &result, &context);
            // Kept once it succeeded; a failure keeps nothing, so a repeat runs again.
            if let Some((scope, digest)) = keyed {
                self.store
                    .keep_keyed_answer(scope, digest, result.clone(), now);
            }
        }
        result
    }
}

/// The scope and digest of a call a command keys in its handler, when the call carries a key:
/// the caller (its kind, id and whom it acts for) and the key (K5), and the input as sent.
fn keyed_call(context: &CommandContext, input: &Value) -> Option<(String, String)> {
    let key = context.idempotency_key.as_deref()?;
    let actor = context.actor.as_ref();
    let scope = serde_json::json!([
        actor.map(|actor| actor.kind),
        actor.and_then(|actor| actor.id.clone()),
        actor.and_then(|actor| actor.on_behalf_of.clone()),
        key,
    ]);
    Some((scope.to_string(), input.to_string()))
}

/// The refusal of a key held for a call with another input (`IDEMPOTENCY_KEY_REUSED`).
fn key_reused() -> CommandError {
    CommandError::new(
        afd::error_codes::IDEMPOTENCY_KEY_REUSED,
        "This idempotency key is already held for a batch with other todos",
    )
    .with_suggestion(
        "Use a new idempotency key for a different batch. Reuse a key only to repeat the same batch.",
    )
    .with_retryable(false)
    .with_recovery(afd::Recovery::stop())
    .with_details(std::collections::HashMap::from([(
        "meta".to_owned(),
        serde_json::json!(afd::AFD_IDEMPOTENCY_KEY_META_KEY),
    )]))
}

/// Add a successful change to the history: who (the context's actor), when (the context's
/// clock), which todos, and the undo the result named.
fn record<C: Command>(store: &TodoStore, result: &CommandResult<Value>, context: &CommandContext) {
    let Some(data) = result.data.as_ref() else {
        return;
    };
    let ids = C::changed(data);
    if ids.is_empty() {
        return;
    }
    let undo_args = result
        .undo_args
        .as_ref()
        .map(|args| args.iter().map(|(k, v)| (k.clone(), v.clone())).collect());
    store.record(Change {
        seq: 0,
        at: iso(&time(context.clock().now())),
        actor: actor(context),
        command: C::NAME.to_string(),
        ids,
        undo_command: result.undo_command.clone(),
        undo_args,
        superseded: None,
    });
}

/// Who is calling, from `context.actor`; `unknown` when the surface set none.
fn actor(context: &CommandContext) -> ChangeActor {
    match &context.actor {
        Some(actor) => ChangeActor {
            kind: serde_json::to_value(actor.kind)
                .ok()
                .and_then(|kind| kind.as_str().map(str::to_string))
                .unwrap_or_else(|| "unknown".to_string()),
            id: actor.id.clone(),
        },
        None => ChangeActor {
            kind: "unknown".to_string(),
            id: None,
        },
    }
}

/// Epoch milliseconds as a time; out-of-range clocks fall back to the epoch.
fn time(ms: i64) -> DateTime<Utc> {
    DateTime::from_timestamp_millis(ms).unwrap_or_default()
}

/// The time and id source for one change, from the context's clock and random (the system's
/// when a caller sets neither), so tests and replays control both.
struct Stamp<'a> {
    at: i64,
    now: DateTime<Utc>,
    random: &'a dyn RandomSource,
}

impl Stamp<'_> {
    /// A new todo id, `todo-<ms>-<7 base-36 digits>`, as TypeScript makes them, so a seeded
    /// random gives the same ids in every language.
    fn new_id(&self) -> String {
        const DIGITS: &[u8; 36] = b"0123456789abcdefghijklmnopqrstuvwxyz";
        let mut value = (self.random.next() * 36f64.powi(7)).floor() as u64;
        let mut digits = Vec::new();
        loop {
            digits.push(DIGITS[(value % 36) as usize]);
            value /= 36;
            if value == 0 {
                break;
            }
        }
        while digits.len() < 7 {
            digits.push(b'0');
        }
        digits.reverse();
        format!(
            "todo-{}-{}",
            self.at,
            String::from_utf8(digits).unwrap_or_default()
        )
    }
}

fn stamp(context: &CommandContext) -> Stamp<'_> {
    let at = context.clock().now();
    Stamp {
        at,
        now: time(at),
        random: context.random(),
    }
}

/// The todo commands are meant for remote agents and the command line, so each opts in to
/// `mcp` and `cli`; the defaults keep both closed.
fn exposure() -> ExposeOptions {
    ExposeOptions {
        mcp: true,
        cli: true,
        ..ExposeOptions::default()
    }
}

/// One command's definition and the JSON Schema of its input.
fn definition<C: Command>(command: C, store: &Arc<TodoStore>) -> (CommandDefinition, Value) {
    let returns = serde_json::from_value::<JsonSchema>(C::output())
        .unwrap_or_else(|error| panic!("{}: the output schema does not parse: {error}", C::NAME));
    let contexts: &[&str] = if C::MUTATION {
        &EDIT_CONTEXTS
    } else {
        &READ_CONTEXTS
    };
    let mut definition = CommandDefinition::new(
        C::NAME,
        C::DESCRIPTION,
        Vec::new(),
        Handler {
            command,
            store: Arc::clone(store),
        },
    )
    .with_title(C::TITLE)
    .with_category("todo")
    .with_version("1.0.0")
    .with_tags(C::TAGS.iter().map(|tag| tag.to_string()).collect())
    .with_contexts(contexts.iter().copied())
    .with_expose(exposure())
    .with_examples(C::examples())
    .with_returns(returns);
    if C::MUTATION {
        definition = definition.as_mutation();
    }
    if C::DESTRUCTIVE {
        definition = definition.with_destructive(true);
    }
    if C::UNDOABLE {
        definition = definition.with_undoable(true);
    }
    if !C::REQUIRES.is_empty() {
        definition = definition.with_requires(C::REQUIRES.iter().copied());
    }
    if let Some(prompt) = C::CONFIRM_PROMPT {
        definition = definition.with_confirm_prompt(prompt);
    }
    if let Some(approval) = C::approval() {
        definition = definition.with_approval(approval);
    }
    if C::TASK != TaskSupport::Never {
        definition = definition.with_task(C::TASK);
    }
    if let Some(idempotency) = C::IDEMPOTENCY {
        definition = definition.with_idempotency(idempotency);
    }
    (definition, C::schema())
}

/// The thirteen todo commands over `store`, each with the JSON Schema of its input, in the
/// TypeScript backend's order. Nothing is registered: the caller decides where they go.
pub fn definitions(store: &Arc<TodoStore>) -> Vec<(CommandDefinition, Value)> {
    let s = || Arc::clone(store);
    vec![
        definition(create::Create(s()), store),
        definition(list::List(s()), store),
        definition(get::Get(s()), store),
        definition(update::Update(s()), store),
        definition(toggle::Toggle(s()), store),
        definition(delete::Delete(s()), store),
        definition(clear::Clear(s()), store),
        definition(stats::Stats(s()), store),
        definition(create_batch::CreateBatch(s()), store),
        definition(delete_batch::DeleteBatch(s()), store),
        definition(toggle_batch::ToggleBatch(s()), store),
        definition(restore::Restore(s()), store),
        definition(history::History(s()), store),
    ]
}

/// Register every todo command against `store`, each validated by its whole input schema.
pub fn register_commands(registry: &CommandRegistry, store: &Arc<TodoStore>) -> Result<(), String> {
    for (definition, schema) in definitions(store) {
        registry.register_with_schema(definition, schema)?;
    }
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════════════
// Shared helpers
// ═══════════════════════════════════════════════════════════════════════════════

/// What a successful result says besides its data.
struct Reply {
    reasoning: String,
    confidence: f64,
    warnings: Vec<Warning>,
    /// The command that undoes this change, and its input.
    undo: Option<(&'static str, Value)>,
    alternatives: Vec<Alternative<Value>>,
}

impl Reply {
    fn new(reasoning: String, confidence: f64) -> Self {
        Self {
            reasoning,
            confidence,
            warnings: Vec::new(),
            undo: None,
            alternatives: Vec::new(),
        }
    }

    fn warn(mut self, warning: Warning) -> Self {
        self.warnings.push(warning);
        self
    }

    fn undo(mut self, command: &'static str, args: Value) -> Self {
        self.undo = Some((command, args));
        self
    }
}

/// A successful result with `data` and what `reply` says.
fn ok<T: Serialize>(data: &T, reply: Reply) -> CommandResult<Value> {
    let data = match serde_json::to_value(data) {
        Ok(data) => data,
        Err(error) => {
            return failure(
                CommandError::internal(&format!("Could not serialize the result: {error}"))
                    .with_suggestion("Retry the command; report this bug if it persists"),
            )
        }
    };
    let (undo_command, undo_args) = match reply.undo {
        Some((command, Value::Object(args))) => {
            (Some(command.to_string()), Some(args.into_iter().collect()))
        }
        _ => (None, None),
    };
    success_with(
        data,
        ResultOptions {
            reasoning: Some(reply.reasoning),
            confidence: Some(reply.confidence),
            warnings: (!reply.warnings.is_empty()).then_some(reply.warnings),
            alternatives: (!reply.alternatives.is_empty()).then_some(reply.alternatives),
            undo_command,
            undo_args,
            ..ResultOptions::default()
        },
    )
}

fn warning(code: &str, message: impl Into<String>, severity: WarningSeverity) -> Warning {
    Warning::new(code, message.into()).with_severity(severity)
}

/// How to find a todo that is not live: the list, or the deleted list and todo-restore.
const NOT_FOUND_SUGGESTION: &str = "Use todo-list to see available todos. If it was deleted, \
     find it with todo-list { deleted: true } and bring it back with todo-restore.";

/// `NOT_FOUND` for an id with no live todo, with the same message and suggestion as the
/// TypeScript backend.
fn not_found(id: &str) -> CommandError {
    CommandError::new("NOT_FOUND", format!("Todo with ID \"{id}\" not found"))
        .with_suggestion(NOT_FOUND_SUGGESTION)
        .with_retryable(false)
}

/// The string ids in `value`, an array.
fn ids_in(value: &Value) -> Vec<String> {
    value
        .as_array()
        .map(|ids| {
            ids.iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

/// The ids of the todos in `value`, an array of todos.
fn todo_ids_in(value: &Value) -> Vec<String> {
    value
        .as_array()
        .map(|todos| {
            todos
                .iter()
                .filter_map(|todo| todo["id"].as_str())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

/// The id of the todo in `data`.
fn todo_id_in(data: &Value) -> Vec<String> {
    data["id"]
        .as_str()
        .map(str::to_string)
        .into_iter()
        .collect()
}

/// JSON Schema pieces shared by several commands.
mod schema {
    use serde_json::{json, Value};

    pub fn title(description: &str) -> Value {
        json!({ "type": "string", "minLength": 1, "maxLength": 200, "description": description })
    }

    pub fn description(description: &str) -> Value {
        json!({ "type": "string", "maxLength": 1000, "description": description })
    }

    pub fn priority(description: &str) -> Value {
        json!({ "type": "string", "enum": ["low", "medium", "high"], "description": description })
    }

    pub fn priority_with_default() -> Value {
        json!({
            "type": "string",
            "enum": ["low", "medium", "high"],
            "default": "medium",
            "description": "Priority: low, medium or high"
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
            "description": "Todo IDs (1-100)"
        })
    }

    pub fn ids_input() -> Value {
        json!({
            "type": "object",
            "properties": { "ids": ids() },
            "required": ["ids"]
        })
    }

    pub fn id_input() -> Value {
        json!({
            "type": "object",
            "properties": { "id": id() },
            "required": ["id"]
        })
    }

    // ─── Outputs (the `data` of each result) ──────────────────────────────────

    pub fn todo() -> Value {
        json!({
            "type": "object",
            "description": "A todo",
            "properties": {
                "id": { "type": "string" },
                "title": { "type": "string" },
                "description": { "type": "string" },
                "priority": { "type": "string", "enum": ["low", "medium", "high"] },
                "completed": { "type": "boolean" },
                "createdAt": { "type": "string" },
                "updatedAt": { "type": "string" },
                "completedAt": { "type": "string" },
                "deletedAt": {
                    "type": "string",
                    "description": "When it was deleted; set only on a deleted todo"
                }
            },
            "required": ["id", "title", "priority", "completed", "createdAt", "updatedAt"]
        })
    }

    pub fn todos() -> Value {
        json!({ "type": "array", "items": todo() })
    }

    pub fn strings() -> Value {
        json!({ "type": "array", "items": { "type": "string" } })
    }

    fn item_error() -> Value {
        json!({
            "type": "object",
            "description": "What failed and how to recover",
            "properties": {
                "code": { "type": "string" },
                "message": { "type": "string" },
                "suggestion": { "type": "string" }
            },
            "required": ["code", "message"]
        })
    }

    /// Batch items that failed: by index, with the id (or, for creates, the input).
    pub fn failed() -> Value {
        json!({
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "index": { "type": "integer" },
                    "id": { "type": "string" },
                    "input": { "type": "object" },
                    "error": item_error()
                },
                "required": ["index", "error"]
            }
        })
    }

    pub fn summary() -> Value {
        json!({
            "type": "object",
            "properties": {
                "total": { "type": "integer" },
                "successCount": { "type": "integer" },
                "failureCount": { "type": "integer" }
            },
            "required": ["total", "successCount", "failureCount"]
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

impl Summary {
    fn new(total: usize, succeeded: usize, failed: usize) -> Self {
        Self {
            total,
            success_count: succeeded,
            failure_count: failed,
        }
    }
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

impl FailedItem {
    fn by_id(index: usize, id: String, error: CommandError) -> Self {
        Self {
            index,
            id: Some(id),
            input: None,
            error,
        }
    }
}

/// Confidence of a batch: the share of items that succeeded.
fn batch_confidence(succeeded: usize, total: usize) -> f64 {
    if total == 0 {
        0.0
    } else {
        succeeded as f64 / total as f64
    }
}

/// `"s"` unless `count` is one.
fn plural(count: usize) -> &'static str {
    if count == 1 {
        ""
    } else {
        "s"
    }
}
