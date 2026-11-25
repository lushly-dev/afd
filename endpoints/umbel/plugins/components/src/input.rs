//! What the host's input schemas cannot express: AFD's schema subset has no `pattern`, so the
//! caller's identifiers are checked here, against the format's own patterns, before they can
//! appear in an answer or a message.

use std::collections::HashSet;

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
    check_versions(input)
}

/// `versions`: at most 32 entries, each an npm package name to a semantic version.
fn check_versions(input: &Value) -> Result<(), Outcome> {
    let Some(versions) = input.get("versions").and_then(Value::as_object) else {
        return Ok(());
    };
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
    Ok(())
}

/// `components-check`'s fields (amendment A30): `source` is required, and bounded as the brief's
/// is.
pub(crate) fn check_check(input: &Value) -> Result<(), Outcome> {
    let Some(source) = input.get("source").and_then(Value::as_str) else {
        return Err(fail::invalid("pass `source`, the markup or code to check"));
    };
    if source.len() > MAX_SOURCE_BYTES {
        return Err(fail::invalid("`source` is longer than 262 144 UTF-8 bytes"));
    }
    check(input, "library", patterns::LIBRARY)?;
    check_versions(input)
}

/// At most 8 facet keys in a pattern-list filter (matching the pack format cap).
const MAX_FACET_KEYS: usize = 8;
/// At most 16 values per facet key.
const MAX_FACET_VALUES: usize = 16;

/// `components-pattern-list`'s fields (amendment A31.3).
pub(crate) fn check_pattern_list(input: &Value) -> Result<(), Outcome> {
    check(input, "library", patterns::LIBRARY)?;
    if let Some(facets) = input.get("facets").and_then(Value::as_object) {
        if facets.len() > MAX_FACET_KEYS {
            return Err(fail::invalid("`facets` holds more than 8 facet keys"));
        }
        for (key, values) in facets {
            if !patterns::FACET_KEY.accepts(key) {
                return Err(fail::invalid(
                    "each key of `facets` must match the format's facetKey pattern",
                ));
            }
            let Some(arr) = values.as_array() else {
                return Err(fail::invalid(
                    "each value of `facets` must be an array of facet values",
                ));
            };
            if arr.is_empty() || arr.len() > MAX_FACET_VALUES {
                return Err(fail::invalid(
                    "each value list in `facets` must hold 1 to 16 facet values",
                ));
            }
            if arr
                .iter()
                .any(|v| !v.as_str().is_some_and(|s| patterns::FACET_VALUE.accepts(s)))
            {
                return Err(fail::invalid(
                    "each value in `facets` must match the format's facetValue pattern",
                ));
            }
        }
    }
    let Some(after) = input.get("after").and_then(Value::as_str) else {
        return Ok(());
    };
    let (library, pattern) = match after.split_once('/') {
        Some((library, pattern)) => (Some(library), pattern),
        None => (None, after),
    };
    if library.is_some_and(|id| !patterns::LIBRARY.accepts(id))
        || !patterns::PATTERN.accepts(pattern)
    {
        return Err(fail::invalid(
            "`after` must be a pattern id, or <library>/<pattern>, as the last answer's next.after gave it",
        ));
    }
    Ok(())
}

/// `components-pattern-open`'s fields (amendment A31.4).
pub(crate) fn check_pattern_open(input: &Value) -> Result<(), Outcome> {
    let Some(pattern) = input.get("pattern").and_then(Value::as_str) else {
        return Err(fail::invalid("pass `pattern`, the pattern id to open"));
    };
    if !patterns::PATTERN.accepts(pattern) {
        return Err(fail::invalid(
            "`pattern` does not match the format's pattern",
        ));
    }
    check(input, "library", patterns::LIBRARY)?;
    if let Some(sections) = input.get("sections").and_then(Value::as_array) {
        let mut seen = HashSet::new();
        for item in sections {
            let Some(name) = item.as_str() else {
                return Err(fail::invalid("each of `sections` must be a section name"));
            };
            if !seen.insert(name) {
                return Err(fail::invalid("`sections` must not repeat a section name"));
            }
        }
    }
    if let Some(implementation) = input.get("implementation").and_then(Value::as_str) {
        let valid = match implementation.split_once('/') {
            Some((library, target)) => {
                patterns::LIBRARY.accepts(library)
                    && (patterns::TAG.accepts(target) || patterns::COPY_NAME.accepts(target))
            }
            None => {
                patterns::TAG.accepts(implementation) || patterns::COPY_NAME.accepts(implementation)
            }
        };
        if !valid {
            return Err(fail::invalid(
                "`implementation` must be a tag, a copy name, or <library>/<tag|copyName>",
            ));
        }
    }
    if input.get("skip").is_some() {
        let sections = input.get("sections").and_then(Value::as_array);
        let single_paginated = sections.is_some_and(|list| {
            list.len() == 1 && matches!(list[0].as_str(), Some("implementations" | "gates"))
        });
        if !single_paginated {
            return Err(fail::invalid(
                "`skip` requires `sections` to name exactly one paginated section (`implementations` or `gates`)",
            ));
        }
    }
    Ok(())
}
