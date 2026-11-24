#![no_main]

use async_trait::async_trait;
use libfuzzer_sys::fuzz_target;
use serde_json::Value;

struct NoopHandler;

#[async_trait]
impl afd::CommandHandler for NoopHandler {
    async fn execute(&self, input: Value, _context: afd::CommandContext) -> afd::CommandResult<Value> {
        afd::success(input)
    }
}

fn sample_command() -> afd::CommandDefinition {
    afd::CommandDefinition::new(
        "fuzz-validate",
        "Validation fuzz target",
        vec![
            afd::CommandParameter::required_string("name", "Name"),
            afd::CommandParameter::required_number("count", "Count"),
            afd::CommandParameter::required_boolean("active", "Active"),
            afd::CommandParameter::optional_string("mode", "Mode")
                .with_enum(vec![Value::from("fast"), Value::from("safe")]),
        ],
        NoopHandler,
    )
}

fuzz_target!(|data: &[u8]| {
    let Ok(input) = serde_json::from_slice::<Value>(data) else {
        return;
    };
    let registry = afd::CommandRegistry::new();
    let command = sample_command();
    let _ = registry.validate(&command, input);
});
