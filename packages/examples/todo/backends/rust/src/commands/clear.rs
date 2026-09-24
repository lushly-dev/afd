use super::{ok, warning, Command};
use crate::store::TodoStore;
use afd::{CommandResult, WarningSeverity};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;

pub struct Clear(pub Arc<TodoStore>);

#[derive(Deserialize)]
pub struct Input {
    all: Option<bool>,
}

#[derive(Serialize)]
struct Output {
    cleared: usize,
    remaining: usize,
}

impl Command for Clear {
    type Input = Input;
    const NAME: &'static str = "todo-clear";
    const DESCRIPTION: &'static str = "Clear completed todos (or all if specified)";
    const MUTATION: bool = true;

    fn schema() -> Value {
        json!({
            "type": "object",
            "properties": {
                "all": {
                    "type": "boolean",
                    "description": "If true, clear all todos regardless of status"
                }
            }
        })
    }

    fn run(&self, input: Input) -> CommandResult<Value> {
        if input.all == Some(true) {
            let cleared = self.0.clear_all();
            let output = Output {
                cleared,
                remaining: 0,
            };
            return ok(
                &output,
                format!("Cleared all {cleared} todos"),
                1.0,
                Vec::new(),
            );
        }

        let (cleared, remaining) = self.0.clear_completed();
        let (reasoning, warnings) = if cleared > 0 {
            (
                format!("Cleared {cleared} completed todo(s), {remaining} remaining"),
                vec![warning(
                    "PERMANENT",
                    "This action cannot be undone".to_string(),
                    WarningSeverity::Info,
                )],
            )
        } else {
            (
                format!("No completed todos to clear, {remaining} remaining"),
                Vec::new(),
            )
        };
        ok(&Output { cleared, remaining }, reasoning, 1.0, warnings)
    }
}
