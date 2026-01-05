use afd::{CommandHandler, CommandResult, CommandContext, success};
use crate::store;
use serde::Serialize;
use async_trait::async_trait;

#[derive(Serialize)]
pub struct ClearOutput {
    pub success: bool,
    pub message: String,
}

pub struct ClearHandler;

#[async_trait]
impl CommandHandler for ClearHandler {
    async fn execute(&self, _input: serde_json::Value, _context: CommandContext) -> CommandResult<serde_json::Value> {
        store::clear();
        success(serde_json::to_value(ClearOutput { 
            success: true, 
            message: "All todos cleared".to_string() 
        }).unwrap())
    }
}
