use super::{ok, Command};
use crate::store::TodoStore;
use afd::CommandResult;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;

pub struct Stats(pub Arc<TodoStore>);

#[derive(Deserialize)]
pub struct Input {}

impl Command for Stats {
    type Input = Input;
    const NAME: &'static str = "todo-stats";
    const DESCRIPTION: &'static str = "Get todo statistics";
    const MUTATION: bool = false;

    fn schema() -> Value {
        json!({ "type": "object", "properties": {} })
    }

    fn run(&self, _input: Input) -> CommandResult<Value> {
        let stats = self.0.stats();
        let reasoning = if stats.total == 0 {
            "No todos yet".to_string()
        } else {
            format!(
                "{} total todos, {} completed, {} pending, {}% completion rate",
                stats.total,
                stats.completed,
                stats.pending,
                (stats.completion_rate * 100.0).round()
            )
        };
        ok(&stats, reasoning, 1.0, Vec::new())
    }
}
