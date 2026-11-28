//! `todo-clear`, the one todo change with no way back, so the one held for approval: any caller
//! that is not a person waits until a person approves (the server's approval middleware,
//! `APPROVALS`).

use super::{ids_in, ok, plural, schema, warning, Command, Reply};
use crate::store::TodoStore;
use afd::{
    ActorKind, ApprovalDecision, ApprovalPolicy, CommandContext, CommandExample, CommandResult,
    IdempotencySupport, WarningSeverity,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;

pub struct Clear(pub Arc<TodoStore>);

#[derive(Deserialize)]
pub struct Input {
    all: Option<bool>,
    deleted: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Output {
    cleared: usize,
    remaining: usize,
    /// The todos removed for good.
    cleared_ids: Vec<String>,
}

/// What a clear removes.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Scope {
    Completed,
    Deleted,
    All,
}

fn scope(all: bool, deleted: bool) -> Scope {
    if all {
        Scope::All
    } else if deleted {
        Scope::Deleted
    } else {
        Scope::Completed
    }
}

/// The text a person approves: what goes for good, and how many that is when the call is held.
/// The approval covers the call's input, not those todos, so the text says the count is as of
/// now.
pub fn summarize_clear(store: &TodoStore, input: &Value) -> String {
    let flag = |name: &str| input.get(name).and_then(Value::as_bool) == Some(true);
    let now = |count: usize| {
        let noun = if count == 1 { "todo" } else { "todos" };
        format!(" ({count} {noun} now)")
    };
    let (completed, live, deleted) = store.counts();
    match scope(flag("all"), flag("deleted")) {
        Scope::All => format!(
            "Remove every todo for good, live and deleted{}",
            now(live + deleted)
        ),
        Scope::Deleted => format!("Empty the deleted todos for good{}", now(deleted)),
        Scope::Completed => format!("Remove the completed todos for good{}", now(completed)),
    }
}

impl Command for Clear {
    type Input = Input;
    const NAME: &'static str = "todo-clear";
    const TITLE: &'static str = "Clear todos for good";
    const DESCRIPTION: &'static str = "Remove todos for good: completed ones, or the deleted \
         todos with deleted: true, or every todo with all: true. Nothing undoes it. Where the \
         server holds clears for approval, a caller that is not a person waits for a person to \
         approve; elsewhere it is gated only by its confirmation prompt, where the server \
         enforces confirmations";
    const TAGS: &'static [&'static str] = &["todo", "clear", "write", "batch", "destructive"];
    const MUTATION: bool = true;
    const IDEMPOTENCY: Option<IdempotencySupport> = Some(IdempotencySupport::Natural);
    const DESTRUCTIVE: bool = true;
    // Enforced when the server runs with CONFIRMATIONS=enforce (spec/confirmation-cases.json).
    const CONFIRM_PROMPT: Option<&'static str> = Some("Delete these todos? This cannot be undone.");

    fn schema() -> Value {
        json!({
            "type": "object",
            "properties": {
                "all": {
                    "type": "boolean",
                    "description": "If true, remove every todo, live and deleted, regardless of status"
                },
                "deleted": {
                    "type": "boolean",
                    "description": "If true, empty the deleted todos instead of removing completed ones"
                }
            }
        })
    }

    fn output() -> Value {
        json!({
            "type": "object",
            "properties": {
                "cleared": { "type": "integer" },
                "remaining": { "type": "integer" },
                "clearedIds": schema::strings()
            },
            "required": ["cleared", "remaining", "clearedIds"]
        })
    }

    fn examples() -> Vec<CommandExample> {
        vec![
            CommandExample::new("Remove the completed todos", json!({})),
            CommandExample::new("Empty the deleted todos", json!({ "deleted": true })),
        ]
    }

    /// Nothing undoes a clear, so only a person runs it without approval.
    fn approval() -> Option<ApprovalPolicy> {
        Some(ApprovalPolicy::when(|_input, context| {
            match context.actor.as_ref().map(|actor| actor.kind) {
                Some(ActorKind::Human) => ApprovalDecision::NotRequired,
                _ => ApprovalDecision::Required,
            }
        }))
    }

    fn changed(data: &Value) -> Vec<String> {
        ids_in(&data["clearedIds"])
    }

    fn run(&self, input: Input, _context: &CommandContext) -> CommandResult<Value> {
        let what = scope(input.all == Some(true), input.deleted == Some(true));
        let result = match what {
            Scope::All => self.0.clear_all(),
            Scope::Deleted => self.0.clear_deleted(),
            Scope::Completed => self.0.clear_completed(),
        };
        let cleared = result.cleared_ids.len();
        let remaining = result.remaining;
        let s = plural(cleared);
        let reasoning = match what {
            Scope::All => format!("Cleared all {cleared} todos"),
            Scope::Deleted => format!("Emptied {cleared} deleted todo{s}, {remaining} remaining"),
            Scope::Completed if cleared > 0 => {
                format!("Cleared {cleared} completed todo{s}, {remaining} remaining")
            }
            Scope::Completed => format!("No completed todos to clear, {remaining} remaining"),
        };
        let mut reply = Reply::new(reasoning, 1.0);
        if cleared > 0 {
            reply = reply.warn(warning(
                "PERMANENT",
                "This action cannot be undone",
                WarningSeverity::Info,
            ));
        }
        let output = Output {
            cleared,
            remaining,
            cleared_ids: result.cleared_ids,
        };
        ok(&output, reply)
    }
}
