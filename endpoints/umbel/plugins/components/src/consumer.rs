//! Deployment-owned consumer profiles, outside Specimen's library format: rule exclusions
//! (amendment A25) and the deployment's own guidance statements (amendment A28).
use std::collections::{BTreeMap, BTreeSet, HashSet};

use serde::Deserialize;
use serde_json::Value;
use umbel_sdk::{Cx, Outcome, failure};

use crate::pack::{patterns, text};
use crate::{Settings, fail, scan};

/// The most statements one consumer states.
pub(crate) const MAX_STATEMENTS: usize = 24;
/// The most UTF-8 bytes of statement text one consumer states. The statements sit in a brief's
/// floor, so this bounds what they cost every brief.
pub(crate) const MAX_STATEMENT_BYTES: usize = 4_096;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Consumers {
    version: u8,
    consumers: BTreeMap<String, Profile>,
}

/// Version 1 requires `exclude_rules` and has no `statements`; version 2 makes both optional.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Profile {
    exclude_rules: Option<Vec<String>>,
    statements: Option<Vec<Statement>>,
}

/// One of the deployment's statements, in the pack's statement form without a basis: a
/// deployment's statement is always `authored`.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Statement {
    pub(crate) id: String,
    pub(crate) text: String,
}

/// The profile a call uses.
#[derive(Debug, Default)]
pub(crate) struct Selected {
    pub(crate) name: String,
    pub(crate) excluded: BTreeSet<String>,
    pub(crate) statements: Vec<Statement>,
}

fn invalid() -> Outcome {
    failure(
        "CONSUMERS_INVALID",
        "the deployment's consumer map is unreadable or invalid",
        "Repair data/consumers.json in the space's components/consumers pack: version 1 or 2, library-qualified rule ids, and at most 24 statements a consumer, each with a unique statement id and one line of text, 4096 bytes of text in all.",
    )
}

fn qualified(value: &str) -> bool {
    value.split_once('/').is_some_and(|(library, id)| {
        patterns::LIBRARY.accepts(library)
            && patterns::ID.accepts(id)
            && !scan::identifier_hit(library)
            && !scan::identifier_hit(id)
    })
}

/// The pack's rules for a statement: a checked, scanned id, and one line of 1 to 240 code points
/// with no control or bidirectional character.
fn statement_ok(statement: &Statement) -> bool {
    let length = statement.text.chars().count();
    patterns::ID.accepts(&statement.id)
        && !scan::identifier_hit(&statement.id)
        && (1..=text::STATEMENT).contains(&length)
        && text::allowed(&statement.text, false)
}

fn statements_ok(statements: &[Statement]) -> bool {
    let mut ids = HashSet::new();
    statements.len() <= MAX_STATEMENTS
        && statements.iter().map(|s| s.text.len()).sum::<usize>() <= MAX_STATEMENT_BYTES
        && statements
            .iter()
            .all(|s| statement_ok(s) && ids.insert(s.id.as_str()))
}

fn profile_ok(version: u8, name: &str, profile: &Profile) -> bool {
    let shape = version != 1 || (profile.exclude_rules.is_some() && profile.statements.is_none());
    let exclusions = profile.exclude_rules.as_deref().unwrap_or_default();
    shape
        && patterns::LIBRARY.accepts(name)
        && !scan::identifier_hit(name)
        && exclusions.len() <= 256
        && exclusions.iter().all(|id| qualified(id))
        && statements_ok(profile.statements.as_deref().unwrap_or_default())
}

fn read(cx: &Cx) -> Result<Consumers, Outcome> {
    let bytes = cx
        .pack_read("consumers", "data/consumers.json")
        .map_err(|_| invalid())?;
    if bytes.len() > 65_536 {
        return Err(invalid());
    }
    let map: Consumers = serde_json::from_slice(&bytes).map_err(|_| invalid())?;
    if !matches!(map.version, 1 | 2)
        || map.consumers.len() > 32
        || !map
            .consumers
            .iter()
            .all(|(name, profile)| profile_ok(map.version, name, profile))
    {
        return Err(invalid());
    }
    Ok(map)
}

/// `CONSUMER_NOT_FOUND`; for a name the deployment's default chose, the suggestion names the
/// config key, since the caller named nothing.
fn not_found(by_default: bool) -> Outcome {
    if by_default {
        failure(
            "CONSUMER_NOT_FOUND",
            "the deployment's default consumer is not configured in this space",
            "Add the consumer that `default_consumer` in [plugins.components.config] names to the space's components/consumers pack, or set `default_consumer` to a configured consumer; a call can also pass `consumer` to use another configured one.",
        )
    } else {
        failure(
            "CONSUMER_NOT_FOUND",
            "the requested consumer is not configured in this space",
            "Configure the consumer in the space's components/consumers pack, or omit consumer for the library's general guidance.",
        )
    }
}

/// The doctor's check of a `consumers` override: the map as a call reads it, and the deployment's
/// `default_consumer` in it when one is configured.
pub(crate) fn check(cx: &Cx) -> Outcome {
    let map = match read(cx) {
        Ok(map) => map,
        Err(outcome) => return outcome,
    };
    match Settings::load(cx).default_consumer {
        Some(name) if !map.consumers.contains_key(&name) => not_found(true),
        _ => umbel_sdk::success(serde_json::json!({})),
    }
}

/// The call's `consumer`, else the deployment's `default_consumer`. Neither means no file read and
/// the original brief. All profiles are checked before use; neither a parser error nor deployment
/// text is copied into a refusal.
pub(crate) fn load(
    input: &Value,
    default: Option<&str>,
    cx: &Cx,
) -> Result<Option<Selected>, Outcome> {
    let (name, by_default) = match input.get("consumer").and_then(Value::as_str) {
        Some(name) => {
            if !patterns::LIBRARY.accepts(name) || scan::identifier_hit(name) {
                return Err(fail::invalid(
                    "`consumer` must be a checked name of at most 64 characters",
                ));
            }
            (name, false)
        }
        None => match default {
            Some(name) => (name, true),
            None => return Ok(None),
        },
    };
    // A default is not checked like a call's name: one the map's rules would refuse cannot be in a
    // valid map, so it is not found.
    let map = read(cx)?;
    let profile = map
        .consumers
        .get(name)
        .ok_or_else(|| not_found(by_default))?;
    Ok(Some(Selected {
        name: name.to_owned(),
        excluded: profile.exclude_rules.iter().flatten().cloned().collect(),
        statements: profile.statements.clone().unwrap_or_default(),
    }))
}
