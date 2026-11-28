use super::{
    batch_confidence, ids_in, ok, plural, schema, warning, Command, FailedItem, Reply, Summary,
    EXAMPLE_ID,
};
use crate::store::TodoStore;
use crate::types::Todo;
use afd::{
    CommandContext, CommandError, CommandExample, CommandResult, IdempotencySupport,
    WarningSeverity,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;

pub struct Restore(pub Arc<TodoStore>);

#[derive(Deserialize)]
pub struct Input {
    ids: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Output {
    restored_ids: Vec<String>,
    /// The restored todos, as before the delete.
    restored: Vec<Todo>,
    failed: Vec<FailedItem>,
    summary: Summary,
}

impl Command for Restore {
    type Input = Input;
    const NAME: &'static str = "todo-restore";
    const TITLE: &'static str = "Restore deleted todos";
    const DESCRIPTION: &'static str = "Bring deleted todos back exactly as they were. Find \
         deleted todos with todo-list { deleted: true }; a delete result names this command and \
         its ids as its undo";
    const TAGS: &'static [&'static str] = &["todo", "restore", "write", "batch", "undo"];
    const MUTATION: bool = true;
    const IDEMPOTENCY: Option<IdempotencySupport> = Some(IdempotencySupport::Natural);
    const UNDOABLE: bool = true;

    fn schema() -> Value {
        schema::ids_input()
    }

    fn output() -> Value {
        json!({
            "type": "object",
            "properties": {
                "restoredIds": schema::strings(),
                "restored": schema::todos(),
                "failed": schema::failed(),
                "summary": schema::summary()
            },
            "required": ["restoredIds", "restored", "failed", "summary"]
        })
    }

    fn examples() -> Vec<CommandExample> {
        vec![CommandExample::new(
            "Undo a delete",
            json!({ "ids": [EXAMPLE_ID] }),
        )]
    }

    fn changed(data: &Value) -> Vec<String> {
        ids_in(&data["restoredIds"])
    }

    fn run(&self, input: Input, _context: &CommandContext) -> CommandResult<Value> {
        let total = input.ids.len();
        let mut restored: Vec<Todo> = Vec::new();
        let mut failed = Vec::new();
        for (index, id) in input.ids.into_iter().enumerate() {
            if let Some(todo) = self.0.restore(&id) {
                restored.push(todo);
                continue;
            }
            let error = if self.0.get(&id).is_some() {
                CommandError::new("NOT_FOUND", format!("Todo \"{id}\" is not deleted"))
                    .with_suggestion("It is already a live todo: use todo-get to read it")
            } else {
                CommandError::new("NOT_FOUND", format!("No deleted todo has ID \"{id}\""))
                    .with_suggestion(
                        "Use todo-list { deleted: true } to see the deleted todos, and todo-list \
                         to see the live ones",
                    )
            };
            failed.push(FailedItem::by_id(index, id, error.with_retryable(false)));
        }

        let restored_ids: Vec<String> = restored.iter().map(|todo| todo.id.clone()).collect();
        let reasoning = if failed.is_empty() {
            format!("Restored {} todo{}", restored.len(), plural(restored.len()))
        } else if restored.is_empty() {
            let which = if total == 1 { "that ID" } else { "those IDs" };
            format!("Restored none of {total}: no deleted todo has {which}")
        } else {
            format!(
                "Restored {} of {total} todos; {} could not be restored",
                restored.len(),
                failed.len()
            )
        };
        let mut reply = Reply::new(reasoning, batch_confidence(restored.len(), total));
        if !failed.is_empty() && !restored.is_empty() {
            reply = reply.warn(warning(
                "PARTIAL_SUCCESS",
                format!("{} of {total} could not be restored", failed.len()),
                WarningSeverity::Warning,
            ));
        }
        if !restored_ids.is_empty() {
            reply = reply.undo("todo-delete-batch", json!({ "ids": restored_ids }));
        }
        let summary = Summary::new(total, restored.len(), failed.len());
        ok(
            &Output {
                restored_ids,
                restored,
                failed,
                summary,
            },
            reply,
        )
    }
}
