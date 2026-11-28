//! The todo registry the binary serves: the commands and, unless `APPROVALS=off`, the approval
//! hold on `todo-clear`, as the TypeScript backend's `src/server-options.ts` assembles its server.
//! The MCP server adds the context and bootstrap commands (`server::mcp_server`).

use std::sync::Arc;

use afd::{
    create_approval_middleware, success, ApprovalMiddlewareOptions, ApprovalPolicy, ApprovalRelay,
    CommandContext, CommandDefinition, CommandHandler, CommandParameter, CommandRegistry,
    CommandResult, ContextConfig, ExposeOptions, TaskSupport,
};
use async_trait::async_trait;
use serde_json::{json, Value};

use crate::commands::{register_commands, summarize_clear};
use crate::store::TodoStore;

/// Whether calls are held for approval (`APPROVALS`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Approvals {
    /// Hold `todo-clear` for any caller that is not a person (the default).
    Agents,
    /// Hold nothing. The shared conformance suites run so, as they set `CONFIRMATIONS`.
    Off,
}

impl Approvals {
    /// `APPROVALS`: `agents` (the default) or `off`, exactly, as TypeScript and Python read it.
    pub fn from_env(value: Option<&str>) -> Result<Self, String> {
        match value {
            None | Some("agents") => Ok(Self::Agents),
            Some("off") => Ok(Self::Off),
            Some(other) => Err(format!("APPROVALS must be agents or off, not \"{other}\"")),
        }
    }
}

/// The key that signs approval tokens: `TODO_APPROVAL_SECRET` (at least 32 bytes) when set, so
/// several processes accept each other's tokens; else a random key for this process.
pub fn approval_secret(value: Option<String>) -> Result<Vec<u8>, String> {
    match value {
        Some(secret) if secret.len() >= 32 => Ok(secret.into_bytes()),
        Some(_) => Err("TODO_APPROVAL_SECRET must be at least 32 bytes".to_string()),
        // Two version 4 UUIDs from the OS random source: 244 random bits.
        None => Ok([uuid::Uuid::new_v4(), uuid::Uuid::new_v4()]
            .iter()
            .flat_map(|id| id.into_bytes())
            .collect()),
    }
}

/// The server's contexts, the same as the TypeScript backend's `src/contexts.ts`. With no
/// context entered every command is visible; `todo-reading` limits an agent to the commands
/// that read, and `todo-editing` shows every command.
pub fn contexts() -> Vec<ContextConfig> {
    vec![
        ContextConfig::new("todo-reading")
            .with_description(
                "Review todos without changing them: list, get, stats and history only",
            )
            .with_triggers(["review", "summarize", "report", "what is left"]),
        ContextConfig::new("todo-editing")
            .with_description("Add, change, complete and remove todos")
            .with_triggers(["add", "create", "complete", "update", "delete", "clear"]),
    ]
}

/// The todo commands over `store`, the idempotency step and, with [`Approvals::Agents`], the
/// approval middleware signing with `secret` (unused with [`Approvals::Off`]).
///
/// With [`Approvals::Off`] there is no approval middleware, and the registry refuses a command
/// whose approval policy holds calls without one (`APPROVAL_UNAVAILABLE`), so `todo-clear` is
/// served without its policy: it runs for every caller, and `_meta.approval` does not advertise a
/// hold the server does not make.
///
/// A held `todo-clear` asks the person behind an MCP client that declares form elicitation
/// (`ApprovalRelay::McpElicitation`), with a summary of what would go; a client that cannot be
/// asked gets `APPROVAL_REQUIRED`. The middleware runs before each handler, so a held call never
/// reaches the change history.
pub fn registry(
    store: Arc<TodoStore>,
    approvals: Approvals,
    secret: &[u8],
) -> Result<Arc<CommandRegistry>, String> {
    let registry = Arc::new(CommandRegistry::new());
    match approvals {
        Approvals::Agents => register_commands(&registry, &store)?,
        Approvals::Off => {
            for (mut definition, schema) in crate::commands::definitions(&store) {
                if !matches!(
                    definition.approval,
                    None | Some(ApprovalPolicy::NotRequired)
                ) {
                    definition.approval = None;
                }
                registry.register_with_schema(definition, schema)?;
            }
        }
    }
    // The idempotency step answers a repeat of a `keyed` command's call that carries a key, from
    // an in-memory store (`spec/idempotency.md`, S1 to S13).
    registry.set_idempotency(afd::IdempotencyOptions::new())?;
    if approvals == Approvals::Agents {
        // Built after the commands are registered: `registry.list()` is a snapshot.
        let options = ApprovalMiddlewareOptions::new(secret, registry.list())
            .with_relay(ApprovalRelay::McpElicitation)
            .with_summarize(move |command, input, _context| {
                (command == "todo-clear").then(|| summarize_clear(&store, input))
            });
        registry.add_middleware(create_approval_middleware(options)?);
    }
    Ok(registry)
}

struct InternalPing;

#[async_trait]
impl CommandHandler for InternalPing {
    async fn execute(&self, _input: Value, _context: CommandContext) -> CommandResult<Value> {
        success(json!({ "pong": true }))
    }
}

/// Register the private `todo-internal-ping` command (not exposed to MCP) used by the shared
/// protocol conformance suite (`spec/protocol-conformance.json`) to verify D4 hiding.
pub fn register_protocol_conformance_command(registry: &CommandRegistry) -> Result<(), String> {
    let command = CommandDefinition::new(
        "todo-internal-ping",
        "Private internal probe not exposed to MCP",
        vec![],
        InternalPing,
    )
    .with_expose(ExposeOptions {
        palette: false,
        mcp: false,
        agent: true,
        cli: false,
        apps: false,
    });
    registry
        .register(command)
        .map_err(|error| error.to_string())
}

struct SlowTask;

#[async_trait]
impl CommandHandler for SlowTask {
    async fn execute(&self, input: Value, _context: CommandContext) -> CommandResult<Value> {
        let delay_ms = input
            .get("delayMs")
            .and_then(Value::as_u64)
            .unwrap_or(0)
            .min(10_000);
        tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
        success(json!({ "delayedMs": delay_ms }))
    }
}

/// Register the `todo-slow-task` command used by the shared tasks conformance suite
/// (`TASK_CONFORMANCE=1`) to verify execution run budgets and post-completion retention.
pub fn register_task_conformance_command(registry: &CommandRegistry) -> Result<(), String> {
    let command = CommandDefinition::new(
        "todo-slow-task",
        "Sleep for delayMs to test task execution budgets and retention",
        vec![CommandParameter::required_number(
            "delayMs",
            "Milliseconds to sleep before returning",
        )],
        SlowTask,
    )
    .with_expose(ExposeOptions {
        palette: false,
        mcp: true,
        agent: true,
        cli: false,
        apps: false,
    })
    .with_task(TaskSupport::Optional);
    let schema = json!({
        "type": "object",
        "properties": {
            "delayMs": { "type": "integer", "minimum": 0, "maximum": 10000 }
        },
        "required": ["delayMs"]
    });
    registry
        .register_with_schema(command, schema)
        .map_err(|error| error.to_string())
}
