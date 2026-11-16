use super::{ok, Command, Reply};
use crate::store::TodoStore;
use afd::{CommandContext, CommandExample, CommandResult};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;

pub struct Stats(pub Arc<TodoStore>);

#[derive(Deserialize)]
pub struct Input {}

impl Command for Stats {
    type Input = Input;
    const NAME: &'static str = "todo-stats";
    const TITLE: &'static str = "Todo statistics";
    const DESCRIPTION: &'static str =
        "Compute counts of the live todos by status and priority, and the completion rate";
    const TAGS: &'static [&'static str] = &["todo", "stats", "read", "safe"];
    const MUTATION: bool = false;
    const REQUIRES: &'static [&'static str] = &["todo-list"];

    fn schema() -> Value {
        json!({ "type": "object", "properties": {} })
    }

    fn output() -> Value {
        json!({
            "type": "object",
            "properties": {
                "total": { "type": "integer" },
                "completed": { "type": "integer" },
                "pending": { "type": "integer" },
                "byPriority": {
                    "type": "object",
                    "properties": {
                        "low": { "type": "integer" },
                        "medium": { "type": "integer" },
                        "high": { "type": "integer" }
                    },
                    "required": ["low", "medium", "high"]
                },
                "completionRate": { "type": "number" }
            },
            "required": ["total", "completed", "pending", "byPriority", "completionRate"]
        })
    }

    fn examples() -> Vec<CommandExample> {
        vec![CommandExample::new(
            "Counts by status and priority",
            json!({}),
        )]
    }

    fn run(&self, _input: Input, _context: &CommandContext) -> CommandResult<Value> {
        let stats = self.0.stats();
        let reasoning = if stats.total == 0 {
            "No todos yet".to_string()
        } else {
            format!(
                "{} total todos, {} completed, {} pending, {}% completion rate",
                stats.total,
                stats.completed,
                stats.pending,
                // Rounded half up, as JavaScript's Math.round (the rate is never negative)
                (stats.completion_rate * 100.0 + 0.5).floor()
            )
        };
        ok(&stats, Reply::new(reasoning, 1.0))
    }
}
