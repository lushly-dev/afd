//! `space-list`: the spaces, with stream heads.

use super::{Builtin, empty_input, expose_everywhere_but_the_palette, returns_object};
use crate::workspace::Workspace;
use afd::{CommandContext, CommandDefinition, CommandHandler, CommandResult, success};
use async_trait::async_trait;
use serde_json::{Value, json};
use std::sync::Arc;

struct Handler {
    workspace: Arc<Workspace>,
}

/// The number of complete events in a stream. An event is one complete line, and `seq` runs from
/// 1 by 1, so the count is the head's `seq`. A torn last line is not counted.
fn stream_length(path: &std::path::Path) -> u64 {
    std::fs::read(path)
        .map(|bytes| bytes.iter().filter(|byte| **byte == b'\n').count() as u64)
        .unwrap_or(0)
}

#[async_trait]
impl CommandHandler for Handler {
    async fn execute(&self, _input: Value, _context: CommandContext) -> CommandResult<Value> {
        let layout = self.workspace.layout();
        let spaces: Vec<Value> = self
            .workspace
            .spaces()
            .iter()
            .map(|space| {
                let events = stream_length(&layout.events_file(&space.id));
                json!({
                    "id": space.id.as_str(),
                    "title": space.title,
                    "default": &space.id == self.workspace.default_space(),
                    "events": events,
                    "head": format!("v0:{}:{events}", space.id),
                })
            })
            .collect();
        success(json!({ "spaces": spaces }))
    }
}

/// `space-list`.
pub(crate) fn space_list(workspace: Arc<Workspace>) -> Builtin {
    let definition = CommandDefinition::new(
        "space-list",
        "The spaces of this workspace, with the number of events and the head cursor of each",
        vec![],
        Handler { workspace },
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
