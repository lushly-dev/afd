use super::{batch_confidence, ok, schema, warning, Command, FailedItem, Summary};
use crate::store::{NewTodo, TodoStore};
use crate::types::{Priority, Todo};
use afd::{CommandError, CommandResult, WarningSeverity};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;

pub struct CreateBatch(pub Arc<TodoStore>);

#[derive(Deserialize, Serialize)]
pub struct Item {
    title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    priority: Priority,
}

#[derive(Deserialize)]
pub struct Input {
    todos: Vec<Item>,
}

#[derive(Serialize)]
struct Output {
    succeeded: Vec<Todo>,
    failed: Vec<FailedItem>,
    summary: Summary,
}

impl Command for CreateBatch {
    type Input = Input;
    const NAME: &'static str = "todo-create-batch";
    const DESCRIPTION: &'static str = "Create multiple todos at once with partial failure support";
    const MUTATION: bool = true;

    fn schema() -> Value {
        json!({
            "type": "object",
            "properties": {
                "todos": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": 100,
                    "description": "Todos to create (1 to 100)",
                    "items": {
                        "type": "object",
                        "properties": {
                            "title": schema::title(),
                            "description": schema::description(),
                            "priority": schema::priority_with_default("Priority (default: medium)")
                        },
                        "required": ["title"]
                    }
                }
            },
            "required": ["todos"]
        })
    }

    fn run(&self, input: Input) -> CommandResult<Value> {
        let total = input.todos.len();
        let mut succeeded = Vec::new();
        let mut failed = Vec::new();

        for (index, item) in input.todos.into_iter().enumerate() {
            // The schema allows "   "; a title must still have visible text.
            let title = item.title.trim().to_string();
            if title.is_empty() {
                failed.push(FailedItem {
                    index,
                    id: None,
                    input: serde_json::to_value(&item).ok(),
                    error: CommandError::new("VALIDATION_ERROR", "Title is required")
                        .with_suggestion("Provide a non-empty title for this todo")
                        .with_retryable(false),
                });
                continue;
            }
            succeeded.push(self.0.create(NewTodo {
                title,
                description: item.description.map(|d| d.trim().to_string()),
                priority: item.priority,
            }));
        }

        let summary = Summary {
            total,
            success_count: succeeded.len(),
            failure_count: failed.len(),
        };
        let reasoning = if failed.is_empty() {
            format!("Successfully created all {} todos", succeeded.len())
        } else if succeeded.is_empty() {
            format!(
                "Failed to create any todos. All {} items had errors.",
                failed.len()
            )
        } else {
            format!(
                "Created {} of {total} todos. {} failed validation.",
                succeeded.len(),
                failed.len()
            )
        };
        let warnings = if !failed.is_empty() && !succeeded.is_empty() {
            vec![warning(
                "PARTIAL_SUCCESS",
                format!("{} of {total} items failed", failed.len()),
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
