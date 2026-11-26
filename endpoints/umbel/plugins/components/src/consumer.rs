//! Deployment-owned consumer profiles, outside Specimen's library format: rule exclusions
//! (amendment A25) and the deployment's own guidance statements (amendment A28).
use std::collections::{BTreeMap, BTreeSet, HashSet};

use serde::{Deserialize, Deserializer};
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

/// Version 1 requires `exclude_rules` and has no `statements`; version 2 makes both optional;
/// version 3 adds optional `patternBindings` (`<sourceLib>/<pattern>` -> `<localLib>/<pattern>`).
/// A key that is present is `Some`, and `Some(None)` when it is `null`, which no version accepts.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Profile {
    #[serde(default, deserialize_with = "present")]
    exclude_rules: Option<Option<Vec<String>>>,
    #[serde(default, deserialize_with = "present")]
    statements: Option<Option<Vec<Statement>>>,
    #[serde(rename = "patternBindings", default, deserialize_with = "present")]
    pattern_bindings: Option<Option<BTreeMap<String, String>>>,
}

/// A key's value with `null` kept apart from a missing key, which `#[serde(default)]` gives.
fn present<'de, D: Deserializer<'de>, T: Deserialize<'de>>(
    deserializer: D,
) -> Result<Option<Option<T>>, D::Error> {
    Option::<T>::deserialize(deserializer).map(Some)
}

impl Profile {
    fn exclusions(&self) -> &[String] {
        self.exclude_rules
            .as_ref()
            .and_then(Option::as_deref)
            .unwrap_or_default()
    }

    fn statements(&self) -> &[Statement] {
        self.statements
            .as_ref()
            .and_then(Option::as_deref)
            .unwrap_or_default()
    }

    fn bindings(&self) -> Option<&BTreeMap<String, String>> {
        self.pattern_bindings.as_ref().and_then(Option::as_ref)
    }
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
    pub(crate) pattern_bindings: BTreeMap<String, String>,
}

fn invalid() -> Outcome {
    failure(
        "CONSUMERS_INVALID",
        "the deployment's consumer map is unreadable or invalid",
        "Repair data/consumers.json in the space's components/consumers pack: version 1, 2 or 3, library-qualified rule ids, optional v3 patternBindings (<library>/<pattern> -> <library>/<pattern>, at most 256), and at most 24 statements a consumer, each with a unique statement id and one line of 1 to 240 characters, 4096 bytes of ids and text in all; at most 32 consumers and 256 exclusions each, in a file of at most 64 KiB.",
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

fn qualified_pattern(value: &str) -> bool {
    patterns::accepts_qualified_pattern(value)
        && value.split_once('/').is_some_and(|(library, pattern)| {
            !scan::identifier_hit(library) && !scan::identifier_hit(pattern)
        })
        && !scan::identifier_hit(value)
}

fn bindings_ok(bindings: Option<&BTreeMap<String, String>>) -> bool {
    let Some(bindings) = bindings else {
        return true;
    };
    bindings.len() <= 256
        && bindings
            .iter()
            .all(|(source, target)| qualified_pattern(source) && qualified_pattern(target))
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
        && statements
            .iter()
            .map(|s| s.id.len() + s.text.len())
            .sum::<usize>()
            <= MAX_STATEMENT_BYTES
        && statements
            .iter()
            .all(|s| statement_ok(s) && ids.insert(s.id.as_str()))
}

fn profile_ok(version: u8, name: &str, profile: &Profile) -> bool {
    let null = matches!(profile.exclude_rules, Some(None))
        || matches!(profile.statements, Some(None))
        || matches!(profile.pattern_bindings, Some(None));
    let v1_shape =
        version != 1 || (profile.exclude_rules.is_some() && profile.statements.is_none());
    let bindings_shape = version >= 3 || profile.pattern_bindings.is_none();
    let exclusions = profile.exclusions();
    !null
        && v1_shape
        && bindings_shape
        && patterns::LIBRARY.accepts(name)
        && !scan::identifier_hit(name)
        && exclusions.len() <= 256
        && exclusions.iter().all(|id| qualified(id))
        && statements_ok(profile.statements())
        && bindings_ok(profile.bindings())
}

fn read(cx: &Cx) -> Result<Consumers, Outcome> {
    let bytes = cx
        .pack_read("consumers", "data/consumers.json")
        .map_err(|_| invalid())?;
    if bytes.len() > 65_536 {
        return Err(invalid());
    }
    let map: Consumers = serde_json::from_slice(&bytes).map_err(|_| invalid())?;
    if !matches!(map.version, 1..=3)
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
/// config key, since the caller named nothing. With a default set, omitting `consumer` gives the
/// default's profile, not the general brief, so the suggestion says so.
/// `default` is `None` with no `default_consumer`, otherwise whether the map holds it.
fn not_found(by_default: bool, default: Option<bool>) -> Outcome {
    if by_default {
        failure(
            "CONSUMER_NOT_FOUND",
            "the deployment's default consumer is not configured in this space",
            "Add the consumer that `default_consumer` in [plugins.components.config] names to the space's components/consumers pack, or set `default_consumer` to a configured consumer; a call can also pass `consumer` to use another configured one.",
        )
    } else if default == Some(false) {
        failure(
            "CONSUMER_NOT_FOUND",
            "the requested consumer is not configured in this space",
            "Configure the consumer in the space's components/consumers pack. The deployment's `default_consumer` is not configured here either, so omitting consumer fails too: add it to the pack, or change it in [plugins.components.config].",
        )
    } else if default == Some(true) {
        failure(
            "CONSUMER_NOT_FOUND",
            "the requested consumer is not configured in this space",
            "Configure the consumer in the space's components/consumers pack, or omit consumer to use the deployment's default consumer.",
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
        Some(name) if !map.consumers.contains_key(&name) => not_found(true, Some(false)),
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
    let profile = map.consumers.get(name).ok_or_else(|| {
        not_found(
            by_default,
            default.map(|default| map.consumers.contains_key(default)),
        )
    })?;
    Ok(Some(Selected {
        name: name.to_owned(),
        excluded: profile.exclusions().iter().cloned().collect(),
        statements: profile.statements().to_vec(),
        pattern_bindings: profile.bindings().cloned().unwrap_or_default(),
    }))
}
