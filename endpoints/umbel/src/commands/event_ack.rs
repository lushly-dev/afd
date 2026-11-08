//! `event-ack`: store the caller's cursor in a space.
//!
//! A caller whose positions are sealed (phase 5 section 9.3) acknowledges a cursor version 1
//! event-list gave it, and is answered in cursor version 1 positions of events it can read; the
//! file stores the position, as every cursor file does. A version 0 string from such a caller is
//! refused as a malformed one is.

use super::event_list::{admits, legacy_of, person_of, sealed_cursor_refused};
use super::{
    Builtin, blocking, caller, consumer_arg, consumer_property, expose_everywhere_but_the_palette,
    returns_object,
};
use crate::access::{Caller, reader_filter};
use crate::events::{Cursor, Projector, read_cursor_as, scan_readable, write_cursor};
use crate::positions::{Kind, Presenter};
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
        let reader = Caller::of(self.workspace.config(), &context);
        let stored = blocking(move || {
            let presenter = Presenter::of(&workspace, &reader)?;
            let head = projector
                .tail(&space)
                .map_err(|error| error.to_command_error())?
                .seq;
            let cursor = if presenter.seals() {
                let seq = presenter
                    .open(Kind::Cursor, space.as_str(), &text)
                    .filter(|seq| *seq <= head)
                    .ok_or_else(|| sealed_cursor_refused("cursor"))?;
                Cursor::new(space.clone(), seq)
            } else {
                Cursor::within(&text, &space, head)?
            };
            let layout = workspace.layout();
            // A damaged previous file is replaced, so it does not block the acknowledgement.
            let person = person_of(&actor, &presenter);
            let previous = read_cursor_as(
                layout,
                &space,
                (&actor, &id, person),
                &consumer,
                &legacy_of(&workspace, &actor, &id, reader.principal()),
            )
            .ok()
            .flatten()
            .unwrap_or_else(|| Cursor::zero(space.clone()));
            let updated_at =
                chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
            write_cursor(
                layout,
                (&actor, &id, person),
                &consumer,
                &cursor,
                &updated_at,
            )
            .map_err(|error| error.to_command_error())?;
            let (acknowledged, previous) = if presenter.seals() {
                // The previous position as the last event the caller can read at or before it.
                let filter = reader_filter(workspace.config(), space.as_str(), &reader)?;
                let tokens = filter.token_list().unwrap_or_default();
                let path = layout.events_file(&space);
                let scan = scan_readable(&path, 0, previous.seq().min(head), 0, head, |event| {
                    admits(tokens, event)
                })
                .map_err(|error| error.to_sealed_command_error())?;
                (
                    presenter.cursor(&space, cursor.seq()),
                    presenter.cursor(&space, scan.marked),
                )
            } else {
                (cursor.to_string(), previous.to_string())
            };
            Ok(json!({
                "space": space.as_str(),
                "consumer": consumer,
                "acknowledged": acknowledged,
                "previous": previous,
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
