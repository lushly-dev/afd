use afd::{CommandHandler, CommandResult, CommandError, CommandContext, success, failure};
use crate::types::TodoFilter;
use crate::store;
use async_trait::async_trait;

pub struct ListHandler;

#[async_trait]
impl CommandHandler for ListHandler {
    async fn execute(&self, input: serde_json::Value, _context: CommandContext) -> CommandResult<serde_json::Value> {
        let filter: TodoFilter = if input.is_null() {
            TodoFilter::default()
        } else {
            match serde_json::from_value(input) {
                Ok(f) => f,
                Err(e) => return failure(CommandError::validation(&e.to_string(), None)),
            }
        };

        let todos = store::list(filter);
        success(serde_json::to_value(todos).unwrap())
    }
}
