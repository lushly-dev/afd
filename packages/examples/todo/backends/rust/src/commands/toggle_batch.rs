use super::{batch_confidence, not_found, ok, schema, warning, Command, FailedItem};
use crate::store::{Changes, TodoStore};
use crate::types::Todo;
use afd::{CommandResult, WarningSeverity};
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
    const DESCRIPTION: &'static str =
        "Toggle completion status of multiple todos, or set all to a specific state";
    const MUTATION: bool = true;

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

    fn run(&self, input: Input) -> CommandResult<Value> {
        let total = input.ids.len();
        let mut succeeded: Vec<Todo> = Vec::new();
        let mut failed = Vec::new();

        for (index, id) in input.ids.into_iter().enumerate() {
            let updated = match input.completed {
                // Set mode: only write todos that are not already in that state.
                Some(target) => match self.0.get(&id) {
                    Some(todo) if todo.completed == target => Some(todo),
                    Some(_) => self.0.update(
                        &id,
                        Changes {
                            completed: Some(target),
                            ..Changes::default()
                        },
                    ),
                    None => None,
                },
                None => self.0.toggle(&id),
            };
            match updated {
                Some(todo) => succeeded.push(todo),
                None => failed.push(FailedItem {
                    index,
                    error: not_found(&id),
                    id: Some(id),
                    input: None,
                }),
            }
        }

        let marked_complete = succeeded.iter().filter(|todo| todo.completed).count();
        let summary = ToggleSummary {
            total,
            success_count: succeeded.len(),
            failure_count: failed.len(),
            marked_complete,
            marked_incomplete: succeeded.len() - marked_complete,
        };
        let mode = match input.completed {
            Some(true) => "set to complete",
            Some(false) => "set to incomplete",
            None => "toggled",
        };
        let reasoning = if failed.is_empty() {
            format!("Successfully {mode} all {} todos", succeeded.len())
        } else if succeeded.is_empty() {
            format!(
                "Failed to update any todos. All {} IDs were not found.",
                failed.len()
            )
        } else {
            format!(
                "{mode}: {} of {total} todos. {} were not found.",
                succeeded.len(),
                failed.len()
            )
        };
        let warnings = if !failed.is_empty() && !succeeded.is_empty() {
            vec![warning(
                "PARTIAL_SUCCESS",
                format!("{} of {total} items could not be toggled", failed.len()),
                WarningSeverity::Warning,
            )]
        } else {
            Vec::new()
        };
        let confidence = batch_confidence(summary.success_count, total);
        ok(
            &Output {
                succeeded,
                failed,
                summary,
            },
            reasoning,
            confidence,
            warnings,
        )
    }
}
