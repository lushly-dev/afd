//! `todo-history`: the recent changes, newest first, from the history the command wrapper
//! records (`commands/mod.rs`). An entry offers its undo only while it is the latest change to
//! each of its todos, so undoing an old entry never overwrites a later edit.

use super::{ok, Command, Reply};
use crate::store::{Change, TodoStore};
use afd::{CommandContext, CommandExample, CommandResult};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::sync::Arc;

pub struct History(pub Arc<TodoStore>);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Input {
    limit: usize,
    offset: usize,
    actor: Option<String>,
    todo_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Output {
    entries: Vec<Change>,
    total: usize,
    has_more: bool,
}

/// Newest first, each entry's undo kept only while no later change touched its todos.
pub fn with_current_undo(changes: Vec<Change>) -> Vec<Change> {
    let mut touched_later: HashSet<String> = HashSet::new();
    let mut entries = Vec::with_capacity(changes.len());
    for mut change in changes.into_iter().rev() {
        let superseded = change.ids.iter().any(|id| touched_later.contains(id));
        touched_later.extend(change.ids.iter().cloned());
        if superseded && change.undo_command.is_some() {
            change.undo_command = None;
            change.undo_args = None;
            change.superseded = Some(true);
        }
        entries.push(change);
    }
    entries
}

impl Command for History {
    type Input = Input;
    const NAME: &'static str = "todo-history";
    const TITLE: &'static str = "Todo change history";
    // States HISTORY_LIMIT, which the tests check.
    const DESCRIPTION: &'static str = "List the recent changes to the todos, newest first: what \
         changed, who changed it, when, and the undo command and arguments for each change that \
         is still the latest to its todos. Keeps the latest 1000 changes";
    const TAGS: &'static [&'static str] = &["todo", "history", "read", "undo"];
    const MUTATION: bool = false;

    fn schema() -> Value {
        json!({
            "type": "object",
            "properties": {
                "limit": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 100,
                    "default": 20,
                    "description": "Maximum entries (1-100)"
                },
                "offset": {
                    "type": "integer",
                    "minimum": 0,
                    "default": 0,
                    "description": "Offset for pagination"
                },
                "actor": {
                    "type": "string",
                    "minLength": 1,
                    "description": "Only changes by this kind of actor: human, agent, service, script or test"
                },
                "todoId": {
                    "type": "string",
                    "minLength": 1,
                    "description": "Only changes that touched this todo"
                }
            }
        })
    }

    fn output() -> Value {
        json!({
            "type": "object",
            "properties": {
                "entries": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "seq": { "type": "integer" },
                            "at": { "type": "string" },
                            "actor": {
                                "type": "object",
                                "properties": {
                                    "kind": { "type": "string" },
                                    "id": { "type": "string" }
                                },
                                "required": ["kind"]
                            },
                            "command": { "type": "string" },
                            "ids": { "type": "array", "items": { "type": "string" } },
                            "undoCommand": { "type": "string" },
                            "undoArgs": { "type": "object" },
                            "superseded": {
                                "type": "boolean",
                                "description": "Set when a later change touched the same todos, so its undo is not offered"
                            }
                        },
                        "required": ["seq", "at", "actor", "command", "ids"]
                    }
                },
                "total": { "type": "integer" },
                "hasMore": { "type": "boolean" }
            },
            "required": ["entries", "total", "hasMore"]
        })
    }

    fn examples() -> Vec<CommandExample> {
        vec![
            CommandExample::new("The last five changes", json!({ "limit": 5 })),
            CommandExample::new("What agents changed", json!({ "actor": "agent" })),
        ]
    }

    fn run(&self, input: Input, _context: &CommandContext) -> CommandResult<Value> {
        let matching: Vec<Change> = with_current_undo(self.0.history())
            .into_iter()
            .filter(|entry| {
                input
                    .actor
                    .as_deref()
                    .is_none_or(|kind| entry.actor.kind == kind)
                    && input
                        .todo_id
                        .as_ref()
                        .is_none_or(|id| entry.ids.contains(id))
            })
            .collect();
        let total = matching.len();
        let entries: Vec<Change> = matching
            .into_iter()
            .skip(input.offset)
            .take(input.limit)
            .collect();
        let reasoning = if total == 0 {
            "No changes recorded that match".to_string()
        } else {
            let mut text = format!(
                "{total} change{} recorded",
                if total == 1 { "" } else { "s" }
            );
            if let Some(latest) = entries.first() {
                text.push_str(&format!(
                    "; the latest shown is {} by {} at {}",
                    latest.command, latest.actor.kind, latest.at
                ));
            }
            text
        };
        let has_more = input.offset + entries.len() < total;
        ok(
            &Output {
                entries,
                total,
                has_more,
            },
            Reply::new(reasoning, 1.0),
        )
    }
}
