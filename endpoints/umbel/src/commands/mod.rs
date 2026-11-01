//! The built-in commands: the ones the host registers itself.
//!
//! Every name follows D22, every input schema is closed, every command declares `returns`, and
//! every `expose` flag is set explicitly.

mod event_ack;
mod event_list;
mod event_rebuild;
mod plugin_check;
mod plugin_list;
mod plugin_new;
mod plugin_show;
mod skill_export;
mod skill_list;
mod space_list;
#[cfg(feature = "store-embedded")]
mod store_backup;
#[cfg(feature = "store-embedded")]
mod store_check;
#[cfg(feature = "store-embedded")]
mod store_common;
#[cfg(feature = "store-embedded")]
mod store_doctor;
#[cfg(feature = "store-embedded")]
mod store_show;
mod workspace_doctor;
mod workspace_show;

use afd::{CommandDefinition, ExposeOptions, JsonSchema, JsonSchemaType};
use serde_json::{Value, json};

pub(crate) use event_ack::event_ack;
pub(crate) use event_list::{event_list, read_events};
pub(crate) use event_rebuild::event_rebuild;
pub(crate) use plugin_check::plugin_check;
pub(crate) use plugin_list::plugin_list;
pub(crate) use plugin_new::plugin_new;
pub(crate) use plugin_show::plugin_show;
pub(crate) use skill_export::skill_export;
pub(crate) use skill_list::skill_list;
pub(crate) use space_list::space_list;
#[cfg(feature = "store-embedded")]
pub(crate) use store_backup::store_backup;
#[cfg(feature = "store-embedded")]
pub(crate) use store_check::store_check;
#[cfg(feature = "store-embedded")]
pub(crate) use store_doctor::checks as store_doctor_checks;
#[cfg(feature = "store-embedded")]
pub(crate) use store_show::store_show;
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

/// `VALIDATION_ERROR` for an argument the input schema cannot express.
pub(crate) fn validation_error(message: String, suggestion: &str) -> afd::CommandError {
    afd::CommandError::new(afd::error_codes::VALIDATION_ERROR, message)
        .with_suggestion(suggestion)
        .with_retryable(false)
}

/// The `consumer` argument: `default` when absent, else a valid consumer name.
pub(crate) fn consumer_arg(input: &Value) -> Result<String, afd::CommandError> {
    match input.get("consumer") {
        None | Some(Value::Null) => Ok("default".to_owned()),
        Some(Value::String(consumer)) if crate::events::valid_consumer(consumer) => {
            Ok(consumer.clone())
        }
        Some(_) => Err(validation_error(
            "consumer must match ^[a-z0-9][a-z0-9._-]{0,63}$".to_owned(),
            "Pass a consumer of 1 to 64 lowercase letters, digits, dots, underscores or hyphens, starting with a letter or digit, or omit it for \"default\".",
        )),
    }
}

/// The caller named by the principal the host set: its actor and non-empty id. `None` for a
/// bare `registry.execute`, or an actor without an id.
pub(crate) fn caller(context: &afd::CommandContext) -> Option<(afd::Actor, String)> {
    let principal = crate::principal::Principal::from_context(context)?;
    let id = principal.actor.id.clone().filter(|id| !id.is_empty())?;
    Some((principal.actor, id))
}

/// The JSON schema property for `consumer`.
pub(crate) fn consumer_property() -> Value {
    json!({
        "type": "string",
        "maxLength": 64,
        "description": "One reader among the sessions of one principal, matching ^[a-z0-9][a-z0-9._-]{0,63}$ (AFD's schema checker has no pattern keyword, so the handler enforces it); default \"default\""
    })
}

/// Run blocking work off the async threads, mapping a failed task to an error result.
pub(crate) async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, afd::CommandError> + Send + 'static,
) -> Result<T, afd::CommandError> {
    tokio::task::spawn_blocking(work)
        .await
        .unwrap_or_else(|error| {
            Err(afd::CommandError::new(
                afd::error_codes::INTERNAL_ERROR,
                format!("The command's blocking work did not finish: {error}"),
            )
            .with_suggestion("Retry the command; if it fails again, run umbel workspace doctor.")
            .with_retryable(true))
        })
}
