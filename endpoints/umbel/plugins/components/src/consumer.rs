//! Deployment-owned consumer rules, outside Specimen's library format.
use std::collections::{BTreeMap, BTreeSet};

use serde::Deserialize;
use serde_json::Value;
use umbel_sdk::{Cx, Outcome, failure};

use crate::pack::patterns;
use crate::{fail, scan};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Consumers {
    version: u8,
    consumers: BTreeMap<String, Profile>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Profile {
    exclude_rules: Vec<String>,
}

fn invalid() -> Outcome {
    failure(
        "CONSUMERS_INVALID",
        "the deployment's consumer map is unreadable or invalid",
        "Repair data/consumers.json in the space's components/consumers pack; use version 1 and library-qualified rule ids.",
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

fn read(cx: &Cx) -> Result<Consumers, Outcome> {
    let bytes = cx
        .pack_read("consumers", "data/consumers.json")
        .map_err(|_| invalid())?;
    if bytes.len() > 65_536 {
        return Err(invalid());
    }
    let map: Consumers = serde_json::from_slice(&bytes).map_err(|_| invalid())?;
    if map.version != 1
        || map.consumers.len() > 32
        || map.consumers.iter().any(|(name, profile)| {
            !patterns::LIBRARY.accepts(name)
                || scan::identifier_hit(name)
                || profile.exclude_rules.len() > 256
                || profile.exclude_rules.iter().any(|id| !qualified(id))
        })
    {
        return Err(invalid());
    }
    Ok(map)
}

pub(crate) fn check(cx: &Cx) -> Outcome {
    match read(cx) {
        Ok(_) => umbel_sdk::success(serde_json::json!({})),
        Err(outcome) => outcome,
    }
}

/// No consumer means no file read and the original brief. All profiles are checked before use;
/// neither a parser error nor deployment text is copied into a refusal.
pub(crate) fn load(input: &Value, cx: &Cx) -> Result<BTreeSet<String>, Outcome> {
    let Some(name) = input.get("consumer").and_then(Value::as_str) else {
        return Ok(BTreeSet::new());
    };
    if !patterns::LIBRARY.accepts(name) || scan::identifier_hit(name) {
        return Err(fail::invalid(
            "`consumer` must be a checked name of at most 64 characters",
        ));
    }
    let map = read(cx)?;
    let profile = map.consumers.get(name).ok_or_else(|| failure(
        "CONSUMER_NOT_FOUND",
        "the requested consumer is not configured in this space",
        "Configure the consumer in the space's components/consumers pack, or omit consumer for the library's general guidance.",
    ))?;
    Ok(profile.exclude_rules.iter().cloned().collect())
}
