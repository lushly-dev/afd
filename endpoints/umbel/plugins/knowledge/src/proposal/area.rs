//! Areas and who may approve (specification section 9.2): the part of a space's knowledge base one
//! approval policy governs, from the instance's configuration.
//!
//! ```toml
//! [plugins.knowledge.config.areas.handbook]
//! space = "main"
//! collection = "handbook"
//! prefix = ""                      # a document id prefix inside the collection
//! approvers = ["group:kb-owners"]  # "principal:human:<id>" or "group:<id>"; [] admits any human
//! allow_self_approval = false
//! auto = []                        # the auto-approval rules the area opts into (phase 4 section 8.3)
//! ```
//!
//! `auto` is off by default: an area lists a rule kind only when its deployer enables it, and the
//! only kind is `deprecate-declared` ([`super::auto`]). Any other value fails the configuration.

use serde_json::{Value, json};
use umbel_sdk::{Cx, Outcome, failure};
use umbel_store::{ContentHash, canonical_json};

/// One area of the knowledge base.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Area {
    pub(crate) id: String,
    pub(crate) space: String,
    pub(crate) collection: String,
    pub(crate) prefix: String,
    pub(crate) approvers: Vec<String>,
    pub(crate) allow_self_approval: bool,
    /// The auto-approval rules the area opts into, each one of [`super::auto::RULES`]; empty by
    /// default (owner decision 1, D98).
    pub(crate) auto: Vec<String>,
}

impl Area {
    /// The policy as the record keeps its version: the canonical JSON of what governs a decision
    /// under `rule` (`person`, or `auto:<rule>`). It covers the area's `auto` list when the area
    /// lists one (phase 4 section 8.3); an area that lists none keeps the version it had before
    /// the list existed.
    pub(crate) fn policy_version(&self, rule: &str) -> String {
        let mut policy = json!({
            "area": self.id,
            "space": self.space,
            "collection": self.collection,
            "prefix": self.prefix,
            "approvers": self.approvers,
            "allowSelfApproval": self.allow_self_approval,
            "rule": rule,
        });
        if !self.auto.is_empty() {
            policy["auto"] = json!(self.auto);
        }
        ContentHash::of(canonical_json(&policy).as_bytes()).to_string()
    }

    /// Whether the area opts into the auto-approval rule `rule`.
    pub(crate) fn lists(&self, rule: &str) -> bool {
        self.auto.iter().any(|listed| listed == rule)
    }

    /// Whether the area governs the document `id` of `space`.
    fn covers(&self, space: &str, id: &str) -> bool {
        if self.space != space {
            return false;
        }
        id.split_once('/').is_some_and(|(collection, path)| {
            collection == self.collection && path.starts_with(&self.prefix)
        })
    }

    /// Longer `collection/prefix` is more specific.
    fn weight(&self) -> usize {
        self.collection.len() + self.prefix.len()
    }

    /// Whether a caller holding `tokens` (its reader filter's, from the host) is among the
    /// approvers: an empty list admits any human, an entry `principal:human:<id>` matches the
    /// caller's own token, and `group:<g>` matches the group token the host adds for a group
    /// whose members hold the caller or `*`.
    pub(crate) fn admits(&self, tokens: &[String]) -> bool {
        self.approvers.is_empty()
            || self
                .approvers
                .iter()
                .any(|entry| tokens.iter().any(|token| token == entry))
    }
}

/// An approvers entry names a person or a group; only humans approve.
fn valid_approver(entry: &str) -> bool {
    if let Some(id) = entry.strip_prefix("principal:human:") {
        return !id.is_empty() && id.chars().count() <= 128 && !id.chars().any(char::is_control);
    }
    umbel_store::validate_token(entry).is_ok() && entry.starts_with("group:")
}

/// The configured areas.
///
/// # Errors
/// `AREA_CONFIG_INVALID` for an area that does not read, or an approver that is not a person or a
/// group (the configuration schema refuses most of these at open; this is the second check).
pub(crate) fn load(cx: &Cx) -> Result<Vec<Area>, Outcome> {
    let Ok(config) = cx.config() else {
        return Ok(Vec::new());
    };
    let Some(areas) = config.get("areas").and_then(Value::as_object) else {
        return Ok(Vec::new());
    };
    let invalid = |id: &str, why: &str| {
        failure(
            "AREA_CONFIG_INVALID",
            &format!("the area `{id}` is not usable: {why}"),
            "Fix [plugins.knowledge.config.areas.<id>] in umbel.toml: space and collection are required, approvers are principal:human:<id> or group:<id> entries, and auto lists only deprecate-declared.",
        )
    };
    let mut out = Vec::new();
    for (id, area) in areas {
        let text = |name: &str| area.get(name).and_then(Value::as_str);
        let (Some(space), Some(collection)) = (text("space"), text("collection")) else {
            return Err(invalid(id, "it needs a space and a collection"));
        };
        let approvers: Vec<String> = area
            .get("approvers")
            .and_then(Value::as_array)
            .map(|list| {
                list.iter()
                    .filter_map(|entry| entry.as_str().map(str::to_owned))
                    .collect()
            })
            .unwrap_or_default();
        if approvers.len()
            != area
                .get("approvers")
                .and_then(Value::as_array)
                .map_or(0, Vec::len)
            || approvers.iter().any(|entry| !valid_approver(entry))
        {
            return Err(invalid(
                id,
                "an approver is neither principal:human:<id> nor group:<id>",
            ));
        }
        // The auto-approval rules (phase 4 section 8.3): only the kinds this plugin implements,
        // each once. The configuration schema refuses anything else at load; this is the second
        // check, so no value can widen what a rule applies to.
        let auto = match area.get("auto") {
            None | Some(Value::Null) => Vec::new(),
            Some(Value::Array(list)) => {
                let mut rules: Vec<String> = Vec::new();
                for entry in list {
                    match entry.as_str() {
                        Some(rule)
                            if super::auto::RULES.contains(&rule)
                                && !rules.iter().any(|seen| seen == rule) =>
                        {
                            rules.push(rule.to_owned());
                        }
                        _ => {
                            return Err(invalid(
                                id,
                                "auto lists a rule that is not deprecate-declared, or lists it twice",
                            ));
                        }
                    }
                }
                rules
            }
            Some(_) => return Err(invalid(id, "auto is a list of rule kinds")),
        };
        out.push(Area {
            id: id.clone(),
            space: space.to_owned(),
            collection: collection.to_owned(),
            prefix: text("prefix").unwrap_or_default().to_owned(),
            approvers,
            allow_self_approval: area
                .get("allow_self_approval")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            auto,
        });
    }
    Ok(out)
}

/// The most specific area that governs the document `id` of `space`.
pub(crate) fn governing<'a>(areas: &'a [Area], space: &str, id: &str) -> Option<&'a Area> {
    areas
        .iter()
        .filter(|area| area.covers(space, id))
        .max_by(|a, b| a.weight().cmp(&b.weight()).then_with(|| b.id.cmp(&a.id)))
}

/// The area with this id.
pub(crate) fn by_id<'a>(areas: &'a [Area], id: &str) -> Option<&'a Area> {
    areas.iter().find(|area| area.id == id)
}
