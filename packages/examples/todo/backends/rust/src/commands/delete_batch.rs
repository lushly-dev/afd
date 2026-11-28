use super::{
    batch_confidence, ids_in, not_found, ok, schema, stamp, warning, Command, FailedItem, Reply,
    Summary, EXAMPLE_ID, OTHER_ID,
};
use crate::store::TodoStore;
use afd::{CommandContext, CommandExample, CommandResult, IdempotencySupport, WarningSeverity};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;

pub struct DeleteBatch(pub Arc<TodoStore>);

#[derive(Deserialize)]
pub struct Input {
    ids: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Output {
    deleted_ids: Vec<String>,
    failed: Vec<FailedItem>,
    summary: Summary,
}

impl Command for DeleteBatch {
    type Input = Input;
    const NAME: &'static str = "todo-delete-batch";
    const TITLE: &'static str = "Delete several todos";
    const DESCRIPTION: &'static str = "Remove up to 100 todos in one call, reporting each id \
         that fails. They stay restorable with todo-restore until todo-clear empties the deleted \
         todos";
    const TAGS: &'static [&'static str] = &["todo", "delete", "write", "batch", "destructive"];
    const MUTATION: bool = true;
    const IDEMPOTENCY: Option<IdempotencySupport> = Some(IdempotencySupport::Natural);
    const DESTRUCTIVE: bool = true;
    // It can be undone, so it is not held for approval.
    const UNDOABLE: bool = true;

    fn schema() -> Value {
        schema::ids_input()
    }

    fn output() -> Value {
        json!({
            "type": "object",
            "properties": {
                "deletedIds": schema::strings(),
                "failed": schema::failed(),
                "summary": schema::summary()
            },
            "required": ["deletedIds", "failed", "summary"]
        })
    }

    fn examples() -> Vec<CommandExample> {
        vec![CommandExample::new(
            "Delete two todos",
            json!({ "ids": [EXAMPLE_ID, OTHER_ID] }),
        )]
    }

    fn changed(data: &Value) -> Vec<String> {
        ids_in(&data["deletedIds"])
    }

    fn run(&self, input: Input, context: &CommandContext) -> CommandResult<Value> {
        let now = stamp(context).now;
        let total = input.ids.len();
        let mut deleted_ids = Vec::new();
        let mut failed = Vec::new();

        for (index, id) in input.ids.into_iter().enumerate() {
            if self.0.delete(&id, now).is_some() {
                deleted_ids.push(id);
            } else {
                failed.push(FailedItem::by_id(index, id.clone(), not_found(&id)));
            }
        }

        let reasoning = if failed.is_empty() {
            format!("Successfully deleted all {} todos", deleted_ids.len())
        } else if deleted_ids.is_empty() {
            format!(
                "Failed to delete any todos. All {} IDs were not found.",
                failed.len()
            )
        } else {
            format!(
                "Deleted {} of {total} todos. {} were not found.",
                deleted_ids.len(),
                failed.len()
            )
        };
        let mut reply = Reply::new(reasoning, batch_confidence(deleted_ids.len(), total));
        if !deleted_ids.is_empty() {
            reply = reply
                .warn(warning(
                    "DESTRUCTIVE_BATCH",
                    format!(
                        "Deleted {} todos; todo-restore brings them back until todo-clear \
                         empties the deleted todos",
                        deleted_ids.len()
                    ),
                    WarningSeverity::Caution,
                ))
                .undo("todo-restore", json!({ "ids": deleted_ids }));
        }
        if !failed.is_empty() && !deleted_ids.is_empty() {
            reply = reply.warn(warning(
                "PARTIAL_SUCCESS",
                format!("{} of {total} items could not be deleted", failed.len()),
                WarningSeverity::Warning,
            ));
        }
        let summary = Summary::new(total, deleted_ids.len(), failed.len());
        ok(
            &Output {
                deleted_ids,
                failed,
                summary,
            },
            reply,
        )
    }
}
