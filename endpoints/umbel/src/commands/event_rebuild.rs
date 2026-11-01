//! `event-rebuild`: rebuild one or every event stream from the journal. CLI only.

use super::{Builtin, blocking, returns_object};
use crate::events::{Cursor, EventsError, Projector};
use crate::workspace::{SpaceId, Workspace};
use afd::{CommandContext, CommandDefinition, CommandHandler, CommandResult, ExposeOptions};
use afd::{failure, success};
use async_trait::async_trait;
use serde_json::{Value, json};
use std::sync::Arc;

struct Handler {
    workspace: Arc<Workspace>,
    projector: Arc<Projector>,
}

#[async_trait]
impl CommandHandler for Handler {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        // Absent means every space; a given space has been checked by the space middleware.
        let spaces: Vec<SpaceId> = match input.get("space") {
            None | Some(Value::Null) => self
                .workspace
                .spaces()
                .iter()
                .map(|space| space.id.clone())
                .collect(),
            Some(_) => match self.workspace.resolve_space(&input, &context) {
                Ok(space) => vec![space],
                Err(error) => return failure(error),
            },
        };
        let projector = Arc::clone(&self.projector);
        let rebuilt = blocking(move || {
            let lock = projector.lock().map_err(|error| error.to_command_error())?;
            projector
                .rebuild(&lock, &spaces)
                .map_err(|error: EventsError| error.to_command_error())
        })
        .await;
        match rebuilt {
            Ok(rebuilt) => success(json!({
                "rebuilt": rebuilt
                    .iter()
                    .map(|stream| json!({
                        "space": stream.space.as_str(),
                        "events": stream.events,
                        "head": Cursor::new(stream.space.clone(), stream.events).to_string(),
                    }))
                    .collect::<Vec<_>>(),
            })),
            Err(error) => failure(error),
        }
    }
}

/// `event-rebuild`: rewrites host state, so only the CLI and trusted host code reach it.
pub(crate) fn event_rebuild(workspace: Arc<Workspace>, projector: Arc<Projector>) -> Builtin {
    let mut definition = CommandDefinition::new(
        "event-rebuild",
        "Rebuild one or every event stream from the journal",
        vec![],
        Handler {
            workspace,
            projector,
        },
    )
    .with_category("events")
    .with_returns(returns_object(
        "rebuilt: space, events and head of each stream",
    ))
    .with_expose(
        ExposeOptions::new()
            .with_palette(false)
            .with_mcp(false)
            .with_agent(false)
            .with_cli(true),
    );
    definition.mutation = true;
    Builtin {
        definition,
        schema: json!({
            "type": "object",
            "properties": {
                "space": {
                    "type": "string",
                    "description": "The space to rebuild; default: every space"
                },
            },
            "additionalProperties": false,
        }),
    }
}
