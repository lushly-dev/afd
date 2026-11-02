//! What the `store-*` commands share: the space of the call, the caller's view of it and the
//! errors of the stores.

use afd::{CommandContext, CommandError, CommandInterface};
use serde_json::{Value, json};
use umbel_store::ReaderFilter;

use crate::access::{effective_principal_of, reader_filter};
use crate::workspace::{SpaceId, Workspace};

/// The input property every `store-*` command takes.
pub(super) fn space_property() -> Value {
    json!({
        "type": "string",
        "description": "The space; default: the workspace's default space"
    })
}

/// The space of the call and the caller's reader filter in it. The space check (D26) has already
/// refused an undeclared space; `SPACE_NOT_READABLE` is refused here, before anything is opened.
///
/// # Errors
/// `SPACE_NOT_FOUND`, `SPACE_NOT_READABLE`.
pub(super) fn view(
    workspace: &Workspace,
    input: &Value,
    context: &CommandContext,
) -> Result<(SpaceId, ReaderFilter), CommandError> {
    let space = workspace.resolve_space(input, context)?;
    let filter = reader_filter(
        workspace.config(),
        space.as_str(),
        effective_principal_of(context).as_deref(),
    )?;
    Ok((space, filter))
}

/// Whether the call is a person at the command line: the one caller who is shown totals that
/// include what the reader filter would hide (the files are theirs to read anyway).
pub(super) fn is_cli_human(context: &CommandContext) -> bool {
    context.interface == Some(CommandInterface::Cli)
        && context
            .actor
            .as_ref()
            .is_some_and(|actor| actor.kind == afd::ActorKind::Human)
}
