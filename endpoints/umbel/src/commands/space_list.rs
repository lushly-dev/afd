//! `space-list`: the spaces, with stream heads.

use super::{Builtin, blocking, empty_input, expose_everywhere_but_the_palette, returns_object};
use crate::events::{Cursor, Projector};
use crate::workspace::Workspace;
use afd::{CommandContext, CommandDefinition, CommandHandler, CommandResult, failure, success};
use async_trait::async_trait;
use serde_json::{Value, json};
use std::sync::Arc;

struct Handler {
    workspace: Arc<Workspace>,
    projector: Arc<Projector>,
}

#[async_trait]
impl CommandHandler for Handler {
    async fn execute(&self, _input: Value, _context: CommandContext) -> CommandResult<Value> {
        let workspace = Arc::clone(&self.workspace);
        let projector = Arc::clone(&self.projector);
        let spaces = blocking(move || {
            let events_error = |error: crate::events::EventsError| error.to_command_error();
            projector.catch_up_if_pending().map_err(events_error)?;
            workspace
                .spaces()
                .iter()
                .map(|space| {
                    let events = projector.tail(&space.id).map_err(events_error)?.seq;
                    Ok(json!({
                        "id": space.id.as_str(),
                        "title": space.title,
                        "default": &space.id == workspace.default_space(),
                        "events": events,
                        "head": Cursor::new(space.id.clone(), events).to_string(),
                    }))
                })
                .collect::<Result<Vec<Value>, afd::CommandError>>()
        })
        .await;
        match spaces {
            Ok(spaces) => success(json!({ "spaces": spaces })),
            Err(error) => failure(error),
        }
    }
}

/// `space-list`.
pub(crate) fn space_list(workspace: Arc<Workspace>, projector: Arc<Projector>) -> Builtin {
    let definition = CommandDefinition::new(
        "space-list",
        "The spaces of this workspace, with the number of events and the head cursor of each",
        vec![],
        Handler {
            workspace,
            projector,
        },
    )
    .with_category("workspace")
    .with_returns(returns_object(
        "spaces: id, title, default, events and head",
    ))
    .with_expose(expose_everywhere_but_the_palette());
    Builtin {
        definition,
        schema: empty_input(),
    }
}
