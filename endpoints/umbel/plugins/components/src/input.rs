//! What the host's input schemas cannot express: AFD's schema subset has no `pattern`, so the
//! caller's identifiers are checked here, against the format's own patterns, before they can
//! appear in an answer or a message.

use serde_json::Value;
use umbel_sdk::Outcome;

use crate::fail;
use crate::pack::patterns::{self, Pattern};

/// A field that, when present, must be accepted by `pattern`.
fn check(input: &Value, key: &str, pattern: Pattern) -> Result<(), Outcome> {
    match input.get(key).and_then(Value::as_str) {
        Some(value) if !pattern.accepts(value) => Err(fail::invalid(&format!(
            "`{key}` does not match the format's pattern"
        ))),
        _ => Ok(()),
    }
}

/// `components-list`'s fields.
pub(crate) fn check_list(input: &Value) -> Result<(), Outcome> {
    check(input, "library", patterns::LIBRARY)?;
    check(input, "prefix", patterns::ELEMENT)?;
    let Some(after) = input.get("after").and_then(Value::as_str) else {
        return Ok(());
    };
    let (library, tag) = match after.split_once('/') {
        Some((library, tag)) => (Some(library), tag),
        None => (None, after),
    };
    if library.is_some_and(|id| !patterns::LIBRARY.accepts(id)) || !patterns::TAG.accepts(tag) {
        return Err(fail::invalid(
            "`after` must be a tag, or <library>/<tag>, as the last answer's next.after gave it",
        ));
    }
    Ok(())
}

/// `components-open`'s fields.
pub(crate) fn check_open(input: &Value) -> Result<(), Outcome> {
    check(input, "tag", patterns::TAG)?;
    check(input, "library", patterns::LIBRARY)
}
