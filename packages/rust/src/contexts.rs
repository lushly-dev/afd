//! Contexts: named scopes that narrow which commands a caller sees and runs.
//!
//! A command with `contexts` is available only while one of them is active; a command without
//! them is available in every context, and every command is available when no context is active
//! ([`CommandDefinition::is_accessible_in_context`]).
//!
//! [`CommandRegistry::execute`] enforces the active context of its [`CommandContext`] at
//! execution time, so batch items and pipeline steps are scoped as single calls are: a command
//! outside it returns `COMMAND_NOT_IN_CONTEXT` before its input is validated. A context carries
//! one of:
//!
//! - a [`ContextStack`] ([`CommandContext::with_context_stack`]): the persistent stack of one
//!   session (a stdio connection), which `afd-context-enter` and `afd-context-exit` change;
//! - a fixed active context ([`CommandContext::with_active_context`]): one request's context, as
//!   MCP 2026-07-28 sends it in `_meta["dev.afd/context"]`; the context tools validate but never
//!   change it;
//! - nothing: no scoping, and the context tools return `SESSION_REQUIRED`.
//!
//! [`register_context_commands`] adds `afd-context-list`, `afd-context-enter` and
//! `afd-context-exit` to a registry, as TypeScript's and Python's servers do when they configure
//! contexts. The MCP server (feature `server`) registers them through `McpServer::with_contexts`.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, PoisonError};

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::commands::{
    CommandContext, CommandDefinition, CommandHandler, CommandParameter, CommandRegistry,
    ExposeOptions,
};
use crate::errors::{error_codes, CommandError};
use crate::result::{failure, success_with, CommandResult, ResultOptions};

/// Default maximum depth of a [`ContextStack`], as in TypeScript and Python.
pub const DEFAULT_CONTEXT_MAX_DEPTH: usize = 16;

/// `_meta` key that selects the active context of one MCP 2026-07-28 request.
pub const AFD_CONTEXT_META_KEY: &str = "dev.afd/context";

/// A context a server configures, as `afd-context-list` reports it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[non_exhaustive]
pub struct ContextConfig {
    /// The context name, as commands list it in `contexts`.
    pub name: String,
    /// What the context is for.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Phrases that suggest entering the context.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub triggers: Option<Vec<String>>,
    /// Listing order: higher first.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<i64>,
}

impl ContextConfig {
    /// A context named `name`.
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            description: None,
            triggers: None,
            priority: None,
        }
    }

    /// Set the description.
    pub fn with_description(mut self, description: impl Into<String>) -> Self {
        self.description = Some(description.into());
        self
    }

    /// Set the triggers.
    pub fn with_triggers<I, S>(mut self, triggers: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        self.triggers = Some(triggers.into_iter().map(Into::into).collect());
        self
    }

    /// Set the priority.
    pub fn with_priority(mut self, priority: i64) -> Self {
        self.priority = Some(priority);
        self
    }
}

#[derive(Debug)]
struct StackState {
    entries: Vec<String>,
    max_depth: usize,
}

/// One session's stack of entered contexts. The top is the active context.
///
/// Clones share the stack. Re-entering the active context is a no-op, and entering fails once
/// `max_depth` contexts are stacked.
#[derive(Debug, Clone)]
pub struct ContextStack {
    state: Arc<Mutex<StackState>>,
}

impl Default for ContextStack {
    fn default() -> Self {
        Self::new()
    }
}

impl ContextStack {
    /// An empty stack of at most [`DEFAULT_CONTEXT_MAX_DEPTH`] contexts.
    pub fn new() -> Self {
        Self::with_max_depth(DEFAULT_CONTEXT_MAX_DEPTH)
    }

    /// An empty stack of at most `max_depth` contexts (at least 1).
    pub fn with_max_depth(max_depth: usize) -> Self {
        Self {
            state: Arc::new(Mutex::new(StackState {
                entries: Vec::new(),
                max_depth: max_depth.max(1),
            })),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, StackState> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// The active context: the top of the stack.
    pub fn active(&self) -> Option<String> {
        self.lock().entries.last().cloned()
    }

    /// The entered contexts, bottom first.
    pub fn entries(&self) -> Vec<String> {
        self.lock().entries.clone()
    }

    /// The maximum depth.
    pub fn max_depth(&self) -> usize {
        self.lock().max_depth
    }

    /// Enter `name`. Re-entering the active context changes nothing.
    ///
    /// # Errors
    /// The stack already holds `max_depth` contexts.
    pub fn enter(&self, name: impl Into<String>) -> Result<(), String> {
        let name = name.into();
        let mut state = self.lock();
        if state.entries.last() == Some(&name) {
            return Ok(());
        }
        if state.entries.len() >= state.max_depth {
            return Err(format!(
                "Context stack is limited to {} levels",
                state.max_depth
            ));
        }
        state.entries.push(name);
        Ok(())
    }

    /// Leave the active context, returning it.
    pub fn exit(&self) -> Option<String> {
        self.lock().entries.pop()
    }
}

/// The context state a [`CommandContext`] carries.
#[derive(Debug, Clone)]
pub(crate) enum ContextScope {
    /// A session's persistent stack.
    Session(ContextStack),
    /// One stateless request's active context, which the context tools never change.
    Request(Option<String>),
    /// A caller without a session (a stateless 2025 HTTP request): no active context, and it
    /// cannot enter one.
    #[cfg_attr(not(feature = "server"), allow(dead_code))]
    NoSession,
}

impl ContextScope {
    pub(crate) fn active(&self) -> Option<String> {
        match self {
            Self::Session(stack) => stack.active(),
            Self::Request(active) => active.clone(),
            Self::NoSession => None,
        }
    }
}

/// The `COMMAND_NOT_IN_CONTEXT` error for `command` outside `active`.
///
/// It names the `afd-context-*` tools when the caller can call them, and otherwise the contexts
/// the command belongs to (`spec/error-codes.md`).
pub(crate) fn not_in_context_error(
    command: &CommandDefinition,
    active: &str,
    context_tools: bool,
) -> CommandError {
    let suggestion = if context_tools {
        "Use afd-context-list to see available contexts, or afd-context-enter to switch.".to_owned()
    } else {
        let contexts: Vec<String> = command
            .contexts
            .iter()
            .flatten()
            .map(|context| format!("'{context}'"))
            .collect();
        format!(
            "Switch to a context this command belongs to ({}), or call it with no active context.",
            contexts.join(", ")
        )
    };
    CommandError::new(
        error_codes::COMMAND_NOT_IN_CONTEXT,
        format!(
            "Command '{}' is not available in context '{active}'",
            command.name
        ),
    )
    .with_suggestion(suggestion)
    .with_retryable(false)
}

fn stateless_hint() -> String {
    format!(
        "Context changes do not persist between stateless MCP requests. Send _meta[\"{AFD_CONTEXT_META_KEY}\"] with the context name on each tools/list and tools/call request instead."
    )
}

fn session_required() -> CommandResult<Value> {
    failure(
        CommandError::new(
            error_codes::SESSION_REQUIRED,
            "Entering or exiting a context needs an MCP session, and this request has none",
        )
        .with_suggestion(format!(
            "Send _meta[\"{AFD_CONTEXT_META_KEY}\"] with the context name on each tools/list and tools/call request, or connect over stdio, which keeps one context stack per connection"
        ))
        .with_retryable(false),
    )
}

fn done(data: Value, reasoning: String) -> CommandResult<Value> {
    success_with(
        data,
        ResultOptions {
            reasoning: Some(reasoning),
            confidence: Some(1.0),
            ..ResultOptions::default()
        },
    )
}

struct ContextList(Arc<Vec<ContextConfig>>);

#[async_trait]
impl CommandHandler for ContextList {
    async fn execute(&self, _input: Value, context: CommandContext) -> CommandResult<Value> {
        let active = context.active_context();
        let mut contexts: Vec<&ContextConfig> = self.0.iter().collect();
        // Stable: equal priorities keep their configured order.
        contexts.sort_by_key(|config| std::cmp::Reverse(config.priority.unwrap_or(0)));
        let listed: Vec<Value> = contexts
            .iter()
            .map(|config| {
                let mut entry = json!({ "name": config.name });
                if let Some(description) = config.description.as_ref().filter(|d| !d.is_empty()) {
                    entry["description"] = json!(description);
                }
                if let Some(triggers) = config.triggers.as_ref().filter(|t| !t.is_empty()) {
                    entry["triggers"] = json!(triggers);
                }
                if let Some(priority) = config.priority {
                    entry["priority"] = json!(priority);
                }
                entry
            })
            .collect();
        let reasoning = format!(
            "Found {} configured contexts. Active: {}",
            listed.len(),
            active.as_deref().unwrap_or("none")
        );
        done(
            json!({ "contexts": listed, "activeContext": active }),
            reasoning,
        )
    }
}

struct ContextEnter(Arc<Vec<ContextConfig>>);

#[async_trait]
impl CommandHandler for ContextEnter {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let scope = match &context.context_scope {
            None | Some(ContextScope::NoSession) => return session_required(),
            Some(scope) => scope,
        };
        let name = input["context"].as_str().unwrap_or_default().to_owned();
        if !self.0.iter().any(|config| config.name == name) {
            let available: Vec<&str> = self.0.iter().map(|config| config.name.as_str()).collect();
            return failure(
                CommandError::new(
                    error_codes::CONTEXT_NOT_FOUND,
                    format!("Context '{name}' is not configured"),
                )
                .with_suggestion(format!(
                    "Available contexts: {}. Use afd-context-list to see all contexts.",
                    available.join(", ")
                ))
                .with_retryable(false),
            );
        }
        let previous = scope.active();
        let stack = match scope {
            ContextScope::Session(stack) => stack,
            _ => {
                return done(
                    json!({ "entered": name, "previous": previous, "persisted": false }),
                    stateless_hint(),
                )
            }
        };
        if previous.as_deref() == Some(name.as_str()) {
            return done(
                json!({ "entered": name, "previous": previous }),
                format!("Already in context '{name}'; nothing changed"),
            );
        }
        if stack.enter(name.clone()).is_err() {
            return failure(
                CommandError::new(
                    error_codes::CONTEXT_DEPTH_EXCEEDED,
                    format!("Context stack is limited to {} levels", stack.max_depth()),
                )
                .with_suggestion("Call afd-context-exit to leave a context before entering another")
                .with_retryable(false),
            );
        }
        let was = previous
            .as_deref()
            .map(|previous| format!(" (was '{previous}')"))
            .unwrap_or_default();
        done(
            json!({ "entered": name, "previous": previous }),
            format!("Entered context '{name}'{was}"),
        )
    }
}

struct ContextExit;

#[async_trait]
impl CommandHandler for ContextExit {
    async fn execute(&self, _input: Value, context: CommandContext) -> CommandResult<Value> {
        let stack = match &context.context_scope {
            None | Some(ContextScope::NoSession) => return session_required(),
            Some(ContextScope::Request(active)) => {
                return done(
                    json!({ "exited": null, "current": active, "persisted": false }),
                    stateless_hint(),
                )
            }
            Some(ContextScope::Session(stack)) => stack,
        };
        let exited = stack.exit();
        let current = stack.active();
        let reasoning = match (&exited, &current) {
            (None, _) => "No active context to exit".to_owned(),
            (Some(exited), Some(current)) => {
                format!("Exited context '{exited}', now in '{current}'")
            }
            (Some(exited), None) => format!("Exited context '{exited}', no active context"),
        };
        done(json!({ "exited": exited, "current": current }), reasoning)
    }
}

fn context_command(
    name: &str,
    description: &str,
    parameters: Vec<CommandParameter>,
    mutation: bool,
    handler: impl CommandHandler + 'static,
) -> CommandDefinition {
    let tags = if mutation {
        &["bootstrap", "write", "context"][..]
    } else {
        &["bootstrap", "read", "safe", "context"][..]
    };
    let tags: Vec<String> = tags.iter().map(|tag| (*tag).to_owned()).collect();
    let mut command = CommandDefinition::new(name, description, parameters, handler)
        .with_category(crate::bootstrap::BOOTSTRAP_CATEGORY)
        .with_tags(tags)
        .with_version("1.0.0")
        .with_expose(ExposeOptions::new().with_mcp(true));
    if mutation {
        command = command.as_mutation();
    }
    command
}

/// The `afd-context-list`, `afd-context-enter` and `afd-context-exit` commands for `contexts`.
pub fn get_context_commands(contexts: Vec<ContextConfig>) -> Vec<CommandDefinition> {
    let contexts = Arc::new(contexts);
    let mut name = CommandParameter::required_string("context", "Context name to enter");
    name.schema = Some(crate::commands::JsonSchema {
        schema_type: Some(crate::commands::JsonSchemaType::String),
        description: Some("Context name to enter".to_owned()),
        min_length: Some(1),
        ..Default::default()
    });
    vec![
        context_command(
            "afd-context-list",
            "List all configured contexts with descriptions, priorities, and triggers",
            vec![],
            false,
            ContextList(Arc::clone(&contexts)),
        ),
        context_command(
            "afd-context-enter",
            "Enter a context to scope available tools",
            vec![name],
            true,
            ContextEnter(contexts),
        ),
        context_command(
            "afd-context-exit",
            "Exit the current context, popping back to the previous one",
            vec![],
            true,
            ContextExit,
        ),
    ]
}

/// Register the context commands for `contexts` into `registry`.
///
/// # Errors
/// Registers nothing when `contexts` is empty, names a context twice or names one that is
/// blank, or when a command with a context command's name is already registered.
pub fn register_context_commands(
    registry: &CommandRegistry,
    contexts: Vec<ContextConfig>,
) -> Result<(), String> {
    if contexts.is_empty() {
        return Err("Configure at least one context".to_owned());
    }
    let mut seen = HashMap::new();
    for config in &contexts {
        if config.name.trim().is_empty() {
            return Err("Context names must not be blank".to_owned());
        }
        if seen.insert(config.name.as_str(), ()).is_some() {
            return Err(format!("Context '{}' is configured twice", config.name));
        }
    }
    if let Some(name) = crate::builtin_names::AFD_CONTEXT_COMMAND_NAMES
        .iter()
        .find(|name| registry.has(name))
    {
        return Err(format!("Reserved context command name: {name}"));
    }
    for command in get_context_commands(contexts) {
        registry.register(command)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests;
