use afd::{CommandHandler, CommandResult, CommandError, CommandContext, success, failure};
use crate::types::Priority;
use crate::store;
use serde::Deserialize;
use async_trait::async_trait;

#[derive(Deserialize)]
pub struct UpdateInput {
    pub id: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub priority: Option<Priority>,
    pub completed: Option<bool>,
}

pub struct UpdateHandler;

#[async_trait]
impl CommandHandler for UpdateHandler {
    async fn execute(&self, input: serde_json::Value, _context: CommandContext) -> CommandResult<serde_json::Value> {
        let input: UpdateInput = match serde_json::from_value(input) {
            Ok(i) => i,
            Err(e) => return failure(CommandError::validation(&e.to_string(), None)),
        };

        match store::update(&input.id, input.title, input.description, input.priority, input.completed) {
            Some(todo) => success(serde_json::to_value(todo).unwrap()),
            None => failure(CommandError::not_found("Todo", &input.id)),
        }
    }
}
