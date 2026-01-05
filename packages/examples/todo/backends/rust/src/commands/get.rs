use afd::{CommandHandler, CommandResult, CommandError, CommandContext, success, failure};
use crate::store;
use serde::Deserialize;
use async_trait::async_trait;

#[derive(Deserialize)]
pub struct GetInput {
    pub id: String,
}

pub struct GetHandler;

#[async_trait]
impl CommandHandler for GetHandler {
    async fn execute(&self, input: serde_json::Value, _context: CommandContext) -> CommandResult<serde_json::Value> {
        let input: GetInput = match serde_json::from_value(input) {
            Ok(i) => i,
            Err(e) => return failure(CommandError::validation(&e.to_string(), None)),
        };

        match store::get(&input.id) {
            Some(todo) => success(serde_json::to_value(todo).unwrap()),
            None => failure(CommandError::not_found("Todo", &input.id)),
        }
    }
}
