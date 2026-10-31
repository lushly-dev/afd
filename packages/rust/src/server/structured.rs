//! Structured results (`spec/command-metadata.md`, "Structured results").
//!
//! Every tool result carries the whole result as `structuredContent` (built by the router's
//! `tool_result`), and under the individual strategy a command that declares `returns`
//! advertises a top-level `outputSchema` describing the `CommandResult` envelope with `data`
//! typed by `returns`, as TypeScript does. MCP clients validate
//! `structuredContent` against `outputSchema`, so
//! [`McpServer::with_advertise_output_schema`](super::McpServer::with_advertise_output_schema)
//! can switch the advertising off.

use serde_json::Value;

use crate::{command_result_output_schema, CommandDefinition};

/// `returns` as JSON Schema. An unset `type` serializes as `null`, which is not a schema.
fn data_schema(command: &CommandDefinition) -> Option<Value> {
    fn clean(value: &mut Value) {
        match value {
            Value::Object(map) => {
                if map.get("type").is_some_and(Value::is_null) {
                    map.remove("type");
                }
                // `default` and `enum` hold data, not schemas.
                map.iter_mut()
                    .filter(|(key, _)| !matches!(key.as_str(), "default" | "enum"))
                    .for_each(|(_, value)| clean(value));
            }
            Value::Array(items) => items.iter_mut().for_each(clean),
            _ => {}
        }
    }
    let mut schema = serde_json::to_value(command.returns.as_ref()?).ok()?;
    clean(&mut schema);
    Some(schema)
}

/// The top-level `outputSchema` of `command`'s tool, when it declares `returns`.
pub(crate) fn output_schema(command: &CommandDefinition) -> Option<Value> {
    data_schema(command).map(|schema| command_result_output_schema(&schema))
}
