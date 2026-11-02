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
        Err(space_not_found(given))
    }

    /// The spaces a call runs in: the entries of `input.spaces` when given, each resolved like
    /// `space` (phase 2 specification, section 3.3, rule 9); else the one space of
    /// [`Workspace::resolve_space`]. Giving both `space` and `spaces` is `VALIDATION_ERROR`, and
    /// so is an empty list or a repeated entry.
    ///
    /// # Errors
    /// `SPACE_NOT_FOUND` for an undeclared entry, with the suggestion of `resolve_space`;
    /// `VALIDATION_ERROR` as above.
    pub fn resolve_spaces(
        &self,
        input: &Value,
        context: &CommandContext,
    ) -> Result<Vec<SpaceId>, CommandError> {
        let listed = match input.get("spaces") {
            None | Some(Value::Null) => return Ok(vec![self.resolve_space(input, context)?]),
            Some(Value::Array(listed)) => listed,
            Some(_) => {
                return Err(invalid("spaces must be an array of space ids"));
            }
        };
        if matches!(input.get("space"), Some(value) if !value.is_null()) {
            return Err(invalid("give either space or spaces, not both"));
        }
        if listed.is_empty() {
            return Err(invalid("spaces must name at least one space"));
        }
        let mut resolved: Vec<SpaceId> = Vec::new();
        for entry in listed {
            let name = entry.as_str().unwrap_or_default();
            if !self.has_space(name) {
                return Err(space_not_found(name));
            }
            let id = SpaceId::parse(name).map_err(|_| space_not_found(name))?;
            if resolved.contains(&id) {
                return Err(invalid("spaces must not repeat a space"));
            }
            resolved.push(id);
        }
        Ok(resolved)
    }
}

fn space_not_found(given: &str) -> CommandError {
    let shown: String = given.chars().take(64).collect();
    CommandError::new(
        SPACE_NOT_FOUND,
        format!("Space '{shown}' is not declared in this workspace"),
    )
    .with_suggestion("Call space-list for the spaces of this workspace.")
    .with_retryable(false)
}

fn invalid(message: &str) -> CommandError {
    CommandError::new(afd::error_codes::VALIDATION_ERROR, message)
        .with_suggestion("Pass space or spaces, one of them, with declared space ids.")
        .with_retryable(false)
}
