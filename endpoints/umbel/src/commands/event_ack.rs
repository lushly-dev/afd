//! `event-ack`: store the caller's cursor in a space.

use super::{
    Builtin, blocking, caller, consumer_arg, consumer_property, expose_everywhere_but_the_palette,
    returns_object,
};
use crate::events::{Cursor, Projector, read_cursor, write_cursor};
use crate::workspace::Workspace;
use afd::{CommandContext, CommandDefinition, CommandError, CommandHandler, CommandResult};
use afd::{failure, success};
use async_trait::async_trait;
use serde_json::{Value, json};
use std::sync::Arc;

struct Handler {
    workspace: Arc<Workspace>,
    projector: Arc<Projector>,
}

fn unauthorized() -> CommandError {
    CommandError::new(
        afd::error_codes::UNAUTHORIZED,
        "event-ack stores a cursor for a caller, and this call has none",
    )
    .with_suggestion("Call through Host::context(actor) with an actor that has an id.")
    .with_retryable(false)
}

#[async_trait]
impl CommandHandler for Handler {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let Some((actor, id)) = caller(&context) else {
            return failure(unauthorized());
        };
        let space = match self.workspace.resolve_space(&input, &context) {
            Ok(space) => space,
            Err(error) => return failure(error),
        };
        let consumer = match consumer_arg(&input) {
            Ok(consumer) => consumer,
            Err(error) => return failure(error),
        };
        let text = input
            .get("cursor")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        let workspace = Arc::clone(&self.workspace);
        let projector = Arc::clone(&self.projector);
        let stored = blocking(move || {
            let head = projector
                .tail(&space)
                .map_err(|error| error.to_command_error())?
                .seq;
            let cursor = Cursor::within(&text, &space, head)?;
            let layout = workspace.layout();
            // A damaged previous file is replaced, so it does not block the acknowledgement.
            let previous = read_cursor(layout, &space, &actor, &id, &consumer)
                .ok()
                .flatten()
                .unwrap_or_else(|| Cursor::zero(space.clone()));
            let updated_at =
                chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
            write_cursor(layout, &actor, &id, &consumer, &cursor, &updated_at)
                .map_err(|error| error.to_command_error())?;
            Ok(json!({
                "space": space.as_str(),
                "consumer": consumer,
                "acknowledged": cursor.to_string(),
                "previous": previous.to_string(),
            }))
        })
        .await;
        match stored {
            Ok(data) => success(data),
            Err(error) => failure(error),
        }
    }
}

/// `event-ack`.
pub(crate) fn event_ack(workspace: Arc<Workspace>, projector: Arc<Projector>) -> Builtin {
    let mut definition = CommandDefinition::new(
        "event-ack",
        "Store your cursor in a space, so event-list resumes after it",
        vec![],
        Handler {
            workspace,
            projector,
        },
    )
    .with_category("events")
    .with_returns(returns_object("space, consumer, acknowledged and previous"))
    .with_expose(expose_everywhere_but_the_palette());
    definition.mutation = true;
    Builtin {
        definition,
        schema: json!({
            "type": "object",
            "properties": {
                "space": {
                    "type": "string",
                    "description": "The space; default: the workspace's default space"
                },
                "cursor": {
                    "type": "string",
                    "description": "A cursor of the space, as event-list returned it; an earlier one replays"
                },
                "consumer": consumer_property(),
            },
            "required": ["cursor"],
            "additionalProperties": false,
        }),
    }
}
