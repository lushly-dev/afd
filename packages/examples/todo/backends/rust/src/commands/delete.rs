use afd::{CommandHandler, CommandResult, CommandError, CommandContext, success, failure};
use crate::store;
use serde::{Deserialize, Serialize};
use async_trait::async_trait;

#[derive(Deserialize)]
pub struct DeleteInput {
    pub id: String,
}

#[derive(Serialize)]
pub struct DeleteOutput {
    pub id: String,
    pub deleted: bool,
}

pub struct DeleteHandler;

#[async_trait]
impl CommandHandler for DeleteHandler {
    async fn execute(&self, input: serde_json::Value, _context: CommandContext) -> CommandResult<serde_json::Value> {
        let input: DeleteInput = match serde_json::from_value(input) {
            Ok(i) => i,
            Err(e) => return failure(CommandError::validation(&e.to_string(), None)),
        };

        let deleted = store::delete(&input.id);
        if deleted {
            success(serde_json::to_value(DeleteOutput { id: input.id, deleted: true }).unwrap())
        } else {
            failure(CommandError::not_found("Todo", &input.id))
        }
    }
}
