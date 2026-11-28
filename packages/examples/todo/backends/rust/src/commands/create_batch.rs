use super::{
    batch_confidence, ok, schema, stamp, todo_ids_in, warning, Command, FailedItem, Reply, Summary,
};
use crate::store::{NewTodo, TodoStore};
use crate::types::{Priority, Todo};
use afd::{
    CommandContext, CommandError, CommandExample, CommandResult, IdempotencySupport, TaskSupport,
    WarningSeverity,
};
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
    const TITLE: &'static str = "Create several todos";
    const DESCRIPTION: &'static str = "Create multiple todos at once with partial failure support";
    const TAGS: &'static [&'static str] = &["todo", "create", "write", "batch"];
    const MUTATION: bool = true;
    const IDEMPOTENCY: Option<IdempotencySupport> = Some(IdempotencySupport::Keyed);
    // Keyed in its handler, not by the registry's idempotency step: it may run as an MCP task,
    // on which the step does not act (`spec/idempotency.md`, D5 and S11).
    const KEYED_IN_HANDLER: bool = true;
    const UNDOABLE: bool = true;
    const TASK: TaskSupport = TaskSupport::Optional;

    fn schema() -> Value {
        json!({
            "type": "object",
            "properties": {
                "todos": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": 100,
                    "description": "Todos to create (1-100)",
                    "items": {
                        "type": "object",
                        "properties": {
                            "title": schema::title("Todo title (1-200 characters)"),
                            "description": schema::description("Optional description"),
                            "priority": schema::priority_with_default()
                        },
                        "required": ["title"]
                    }
                }
            },
            "required": ["todos"]
        })
    }

    fn output() -> Value {
        json!({
            "type": "object",
            "properties": {
                "succeeded": schema::todos(),
                "failed": schema::failed(),
                "summary": schema::summary()
            },
            "required": ["succeeded", "failed", "summary"]
        })
    }

    fn examples() -> Vec<CommandExample> {
        vec![CommandExample::new(
            "Two todos at once",
            json!({
                "todos": [
                    { "title": "Net the brassicas" },
                    { "title": "Sow the broad beans", "priority": "low" }
                ]
            }),
        )]
    }

    fn changed(data: &Value) -> Vec<String> {
        todo_ids_in(&data["succeeded"])
    }

    fn run(&self, input: Input, context: &CommandContext) -> CommandResult<Value> {
        let stamp = stamp(context);
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
                id: stamp.new_id(),
                title,
                description: item.description.map(|d| d.trim().to_string()),
                priority: item.priority,
                now: stamp.now,
            }));
            context.report_progress(format!("Created {} of {total} todos", succeeded.len()));
        }

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
        let mut reply = Reply::new(reasoning, batch_confidence(succeeded.len(), total));
        if !failed.is_empty() && !succeeded.is_empty() {
            reply = reply.warn(warning(
                "PARTIAL_SUCCESS",
                format!("{} of {total} items failed", failed.len()),
                WarningSeverity::Warning,
            ));
        }
        if !succeeded.is_empty() {
            let ids: Vec<&str> = succeeded.iter().map(|todo| todo.id.as_str()).collect();
            reply = reply.undo("todo-delete-batch", json!({ "ids": ids }));
        }
        let summary = Summary::new(total, succeeded.len(), failed.len());
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
