use super::{batch_confidence, not_found, ok, schema, warning, Command, FailedItem, Summary};
use crate::store::TodoStore;
use afd::{CommandResult, WarningSeverity};
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
    const DESCRIPTION: &'static str = "Delete multiple todos at once";
    const MUTATION: bool = true;

    fn schema() -> Value {
        json!({
            "type": "object",
            "properties": { "ids": schema::ids() },
            "required": ["ids"]
        })
    }

    fn run(&self, input: Input) -> CommandResult<Value> {
        let total = input.ids.len();
        let mut deleted_ids = Vec::new();
        let mut failed = Vec::new();

        for (index, id) in input.ids.into_iter().enumerate() {
            if self.0.delete(&id).is_some() {
                deleted_ids.push(id);
            } else {
                failed.push(FailedItem {
                    index,
                    error: not_found(&id),
                    id: Some(id),
                    input: None,
                });
            }
        }

        let summary = Summary {
            total,
            success_count: deleted_ids.len(),
            failure_count: failed.len(),
        };
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

        // Always flag the destructive batch; add a partial-success warning if needed.
        let mut warnings = vec![warning(
            "DESTRUCTIVE_BATCH",
            format!(
                "This operation permanently deleted {} todos",
                deleted_ids.len()
            ),
            WarningSeverity::Caution,
        )];
        if !failed.is_empty() && !deleted_ids.is_empty() {
            warnings.push(warning(
                "PARTIAL_SUCCESS",
                format!("{} of {total} items could not be deleted", failed.len()),
                WarningSeverity::Warning,
            ));
        }
        let confidence = batch_confidence(summary.success_count, total);
        ok(
            &Output {
                deleted_ids,
                failed,
                summary,
            },
            reasoning,
            confidence,
            warnings,
        )
    }
}
