use afd::{CommandHandler, CommandResult, CommandError, CommandContext, success, failure};
use crate::types::{Todo, Priority};
use crate::store;
use serde::{Deserialize, Serialize};
use async_trait::async_trait;

#[derive(Deserialize)]
pub struct CreateInput {
    pub title: String,
    pub description: Option<String>,
    pub priority: Option<Priority>,
}

pub struct CreateHandler;

#[async_trait]
impl CommandHandler for CreateHandler {
    async fn execute(&self, input: serde_json::Value, _context: CommandContext) -> CommandResult<serde_json::Value> {
        let input: CreateInput = match serde_json::from_value(input) {
            Ok(i) => i,
            Err(e) => return failure(CommandError::validation(&e.to_string(), None)),
        };

        if input.title.trim().is_empty() {
            return failure(CommandError::validation("Title cannot be empty", None));
        }

        let todo = store::create(input.title, input.description, input.priority);
        success(serde_json::to_value(todo).unwrap())
    }
}
