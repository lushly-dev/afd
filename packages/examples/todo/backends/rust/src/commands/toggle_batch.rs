use super::{
    batch_confidence, not_found, ok, schema, stamp, todo_ids_in, warning, Command, FailedItem,
    Reply, EXAMPLE_ID, OTHER_ID,
};
use crate::store::{Changes, TodoStore};
use crate::types::Todo;
use afd::{CommandContext, CommandExample, CommandResult, IdempotencySupport, WarningSeverity};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;

pub struct ToggleBatch(pub Arc<TodoStore>);

#[derive(Deserialize)]
pub struct Input {
    ids: Vec<String>,
    completed: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ToggleSummary {
    total: usize,
    success_count: usize,
    failure_count: usize,
    marked_complete: usize,
    marked_incomplete: usize,
}

#[derive(Serialize)]
struct Output {
    succeeded: Vec<Todo>,
    failed: Vec<FailedItem>,
    summary: ToggleSummary,
}

impl Command for ToggleBatch {
    type Input = Input;
    const NAME: &'static str = "todo-toggle-batch";
    const TITLE: &'static str = "Toggle several todos";
    const DESCRIPTION: &'static str = "Toggle the completion status of the listed todos, or set \
         them all to completed: true or false";
    const TAGS: &'static [&'static str] = &["todo", "toggle", "write", "batch"];
    const MUTATION: bool = true;
    const IDEMPOTENCY: Option<IdempotencySupport> = Some(IdempotencySupport::Keyed);
    const UNDOABLE: bool = true;
    const REQUIRES: &'static [&'static str] = &["todo-list"];

    fn schema() -> Value {
        json!({
            "type": "object",
            "properties": {
                "ids": schema::ids(),
                "completed": {
                    "type": "boolean",
                    "description": "If set, mark every todo with this state instead of toggling each one"
                }
            },
            "required": ["ids"]
        })
    }

    fn output() -> Value {
        json!({
            "type": "object",
            "properties": {
                "succeeded": schema::todos(),
                "failed": schema::failed(),
                "summary": {
                    "type": "object",
                    "properties": {
                        "total": { "type": "integer" },
                        "successCount": { "type": "integer" },
                        "failureCount": { "type": "integer" },
                        "markedComplete": { "type": "integer" },
                        "markedIncomplete": { "type": "integer" }
                    },
                    "required": [
                        "total",
                        "successCount",
                        "failureCount",
                        "markedComplete",
                        "markedIncomplete"
                    ]
                }
            },
            "required": ["succeeded", "failed", "summary"]
        })
    }

    fn examples() -> Vec<CommandExample> {
        vec![CommandExample::new(
            "Mark two todos done",
            json!({ "ids": [EXAMPLE_ID, OTHER_ID], "completed": true }),
        )]
    }

    fn changed(data: &Value) -> Vec<String> {
        todo_ids_in(&data["succeeded"])
    }

    fn run(&self, input: Input, context: &CommandContext) -> CommandResult<Value> {
        let now = stamp(context).now;
        let total = input.ids.len();
        let mut succeeded: Vec<Todo> = Vec::new();
        let mut failed = Vec::new();
        // The todos this call changed, and the state each had before.
        let mut changed: Vec<(String, bool)> = Vec::new();

        for (index, id) in input.ids.into_iter().enumerate() {
            let Some(existing) = self.0.get(&id) else {
                failed.push(FailedItem::by_id(index, id.clone(), not_found(&id)));
                continue;
            };
            let updated = match input.completed {
                None => self.0.toggle(&id, now),
                Some(target) if target != existing.completed => self.0.update(
                    &id,
                    Changes {
                        completed: Some(target),
                        ..Changes::default()
                    },
                    now,
                ),
                // Already in the requested state.
                Some(_) => {
                    succeeded.push(existing);
                    continue;
                }
            };
            match updated {
                Some(todo) => {
                    changed.push((id, existing.completed));
                    succeeded.push(todo);
                }
                None => failed.push(FailedItem::by_id(index, id.clone(), not_found(&id))),
            }
        }

        let marked_complete = succeeded.iter().filter(|todo| todo.completed).count();
        let marked_incomplete = succeeded.len() - marked_complete;
        let set_mode = input.completed.is_some();
        let mode = match input.completed {
            Some(true) => "set to complete",
            Some(false) => "set to incomplete",
            None => "toggled",
        };
        let reasoning = if failed.is_empty() {
            let mut text = format!("Successfully {mode} all {} todos", succeeded.len());
            if set_mode {
                text.push_str(&format!(
                    " ({marked_complete} complete, {marked_incomplete} incomplete)"
                ));
            }
            text
        } else if succeeded.is_empty() {
            format!(
                "Failed to update any todos. All {} IDs were not found.",
                failed.len()
            )
        } else {
            let mut capitalized = mode.to_string();
            capitalized[..1].make_ascii_uppercase();
            format!(
                "{capitalized} {} of {total} todos. {} were not found.",
                succeeded.len(),
                failed.len()
            )
        };

        let mut reply = Reply::new(reasoning, batch_confidence(succeeded.len(), total));
        if !failed.is_empty() && !succeeded.is_empty() {
            reply = reply.warn(warning(
                "PARTIAL_SUCCESS",
                format!("{} of {total} items could not be toggled", failed.len()),
                WarningSeverity::Warning,
            ));
        }
        // One call undoes this only when every changed todo had the same state before.
        match changed.first() {
            Some((_, first)) if changed.iter().all(|(_, before)| before == first) => {
                let ids: Vec<&str> = changed.iter().map(|(id, _)| id.as_str()).collect();
                reply = reply.undo(
                    "todo-toggle-batch",
                    json!({ "ids": ids, "completed": first }),
                );
            }
            Some(_) => {
                reply = reply.warn(warning(
                    "NO_SINGLE_UNDO",
                    "These todos had different states before, so no single call undoes this. \
                     Set each group back with todo-toggle-batch and completed, or each todo \
                     with todo-update.",
                    WarningSeverity::Info,
                ));
            }
            None => {}
        }
        let summary = ToggleSummary {
            total,
            success_count: succeeded.len(),
            failure_count: failed.len(),
            marked_complete,
            marked_incomplete,
        };
        ok(
            &Output {
                succeeded,
                failed,
                summary,
            },
            reply,
        )
    }
}
