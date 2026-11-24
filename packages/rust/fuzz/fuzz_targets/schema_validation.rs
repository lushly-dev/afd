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

fuzz_target!(|data: &[u8]| {
    // Expect a two-element JSON array `[schema, input]` so both schema compilation and
    // whole-schema validation are exercised on arbitrary structured inputs.
    let Ok(Value::Array(mut pair)) = serde_json::from_slice::<Value>(data) else {
        return;
    };
    if pair.len() != 2 {
        return;
    }
    let input = pair.pop().unwrap();
    let schema = pair.pop().unwrap();
    let registry = afd::CommandRegistry::new();
    let command = afd::CommandDefinition::new(
        "fuzz-schema",
        "Schema validation fuzz target",
        vec![],
        NoopHandler,
    );
    if registry.register_with_schema(command, schema).is_ok() {
        let lookup = afd::CommandDefinition::new(
            "fuzz-schema",
            "Schema validation fuzz target",
            vec![],
            NoopHandler,
        );
        let _ = registry.validate(&lookup, input);
    }
});
