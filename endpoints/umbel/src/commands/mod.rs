//! The built-in commands: the ones the host registers itself.
//!
//! Every name follows D22, every input schema is closed, every command declares `returns`, and
//! every `expose` flag is set explicitly.

mod space_list;
mod workspace_doctor;
mod workspace_show;

use afd::{CommandDefinition, ExposeOptions, JsonSchema, JsonSchemaType};
use serde_json::{Value, json};

pub(crate) use space_list::space_list;
pub(crate) use workspace_doctor::workspace_doctor;
pub(crate) use workspace_show::workspace_show;

/// A built-in command and the whole input schema to register it with.
pub(crate) struct Builtin {
    pub definition: CommandDefinition,
    pub schema: Value,
}

/// `{}`, closed.
pub(crate) fn empty_input() -> Value {
    json!({ "type": "object", "properties": {}, "additionalProperties": false })
}

/// `returns`: an object described in words (the exact shape is in the specification).
pub(crate) fn returns_object(description: &str) -> JsonSchema {
    JsonSchema {
        schema_type: Some(JsonSchemaType::Object),
        description: Some(description.to_owned()),
        ..JsonSchema::default()
    }
}

/// Every flag explicit: palette off, MCP, agent and CLI on.
pub(crate) fn expose_everywhere_but_the_palette() -> ExposeOptions {
    ExposeOptions::new()
        .with_palette(false)
        .with_mcp(true)
        .with_agent(true)
        .with_cli(true)
}
