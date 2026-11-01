//! Resolving the space of a call (D26).

use crate::workspace::{SpaceId, Workspace};
use afd::{CommandContext, CommandError};
use serde_json::Value;

/// `SPACE_NOT_FOUND`: the space is not declared in this workspace.
pub const SPACE_NOT_FOUND: &str = "SPACE_NOT_FOUND";

impl Workspace {
    /// The space a call runs in: `input.space` when given, else the default space. An undeclared
    /// space is `SPACE_NOT_FOUND`.
    ///
    /// The space middleware calls this before the handler runs and every handler calls it
    /// again to learn its space; there is one implementation, so the two agree. `context` is
    /// taken so that a later phase can bind a default space to a context (D26) without changing
    /// any caller.
    ///
    /// # Errors
    /// `SPACE_NOT_FOUND`, with the suggestion "Call space-list for the spaces of this workspace."
    pub fn resolve_space(
        &self,
        input: &Value,
        _context: &CommandContext,
    ) -> Result<SpaceId, CommandError> {
        let given = match input.get("space") {
            None | Some(Value::Null) => return Ok(self.default_space().clone()),
            Some(Value::String(space)) => space.as_str(),
            Some(_) => "",
        };
        if self.has_space(given)
            && let Ok(id) = SpaceId::parse(given)
        {
            return Ok(id);
        }
        let shown: String = given.chars().take(64).collect();
        Err(CommandError::new(
            SPACE_NOT_FOUND,
            format!("Space '{shown}' is not declared in this workspace"),
        )
        .with_suggestion("Call space-list for the spaces of this workspace.")
        .with_retryable(false))
    }
}
