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

/// The most bytes of `source` (specification, section 6.1).
pub(crate) const MAX_SOURCE_BYTES: usize = 262_144;
/// The most entries in `versions`.
const MAX_VERSIONS: usize = 32;

/// A rule id as `known` takes it: bare, or `<library>/<id>`.
fn known_id(value: &str) -> bool {
    match value.split_once('/') {
        Some((library, id)) => patterns::LIBRARY.accepts(library) && patterns::ID.accepts(id),
        None => patterns::ID.accepts(value),
    }
}

/// `components-brief`'s fields, and its rule that at least one of `tags` and `source` is given
/// (the schema subset has no `anyOf`; amendment A1).
pub(crate) fn check_brief(input: &Value) -> Result<(), Outcome> {
    let tags = input.get("tags").and_then(Value::as_array);
    let source = input.get("source").and_then(Value::as_str);
    if tags.is_none() && source.is_none() {
        return Err(fail::invalid("pass `tags`, `source` or both"));
    }
    if tags
        .into_iter()
        .flatten()
        .any(|tag| !tag.as_str().is_some_and(|tag| patterns::TAG.accepts(tag)))
    {
        return Err(fail::invalid(
            "each of `tags` must be a custom element name the format accepts",
        ));
    }
    if source.is_some_and(|source| source.len() > MAX_SOURCE_BYTES) {
        return Err(fail::invalid("`source` is longer than 262 144 UTF-8 bytes"));
    }
    check(input, "library", patterns::LIBRARY)?;
    if input
        .get("known")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .any(|id| !id.as_str().is_some_and(known_id))
    {
        return Err(fail::invalid(
            "each of `known` must be a rule id, bare or as <library>/<id>",
        ));
    }
    if let Some(versions) = input.get("versions").and_then(Value::as_object) {
        if versions.len() > MAX_VERSIONS {
            return Err(fail::invalid("`versions` holds more than 32 packages"));
        }
        let bad = versions.iter().any(|(package, version)| {
            !patterns::PACKAGE.accepts(package)
                || !version
                    .as_str()
                    .is_some_and(|version| patterns::VERSION.accepts(version))
        });
        if bad {
            return Err(fail::invalid(
                "each of `versions` must map an npm package name to a semantic version",
            ));
        }
    }
    Ok(())
}
