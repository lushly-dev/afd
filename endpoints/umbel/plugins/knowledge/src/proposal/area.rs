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
//! approve_over_mcp = false         # approve and reject over MCP, on the person page (phase 5 7.3)
//! ```
//!
//! `auto` is off by default: an area lists a rule kind only when its deployer enables it, and the
//! only kind is `deprecate-declared` ([`super::auto`]). Any other value fails the configuration.
//!
//! `approve_over_mcp` is off by default too (owner decision 7, D116): only an area that sets it
//! lets an approver decide its proposals over MCP, through the person page. It needs a non-empty
//! `approvers` list, since over MCP approvers must be listed (section 7.3): an empty list, which
//! admits any human at a terminal, would admit every verified person who reads the target.

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
    /// Whether its proposals may be approved and rejected over MCP, on the person page (phase 5
    /// section 7.3); false by default (owner decision 7, D116).
    pub(crate) approve_over_mcp: bool,
}

impl Area {
    /// The policy as the record keeps its version: the canonical JSON of what governs a decision
    /// under `rule` (`person`, or `auto:<rule>`). It covers the area's `auto` list when the area
    /// lists one (phase 4 section 8.3); an area that lists none keeps the version it had before
    /// the list existed, and covers `approve_over_mcp` only when the area sets it (phase 5 step 6),
    /// for the same reason.
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
        if self.approve_over_mcp {
            policy["approveOverMcp"] = json!(true);
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
    parse(&config)
}

/// The areas of the instance's configuration `config` ([`load`]'s second check).
fn parse(config: &Value) -> Result<Vec<Area>, Outcome> {
    let Some(areas) = config.get("areas").and_then(Value::as_object) else {
        return Ok(Vec::new());
    };
    let invalid = |id: &str, why: &str| {
        failure(
            "AREA_CONFIG_INVALID",
            &format!("the area `{id}` is not usable: {why}"),
            "Fix [plugins.knowledge.config.areas.<id>] in umbel.toml: space and collection are required, approvers are principal:human:<id> or group:<id> entries, auto lists only deprecate-declared, and approve_over_mcp needs approvers.",
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
        // The MCP approval relay (phase 5 section 7.3): a boolean, and only beside a listed
        // approver. The configuration schema refuses both at load; this is the second check.
        let approve_over_mcp = match area.get("approve_over_mcp") {
            None | Some(Value::Null) => false,
            Some(Value::Bool(set)) => *set,
            Some(_) => return Err(invalid(id, "approve_over_mcp is true or false")),
        };
        if approve_over_mcp && approvers.is_empty() {
            return Err(invalid(
                id,
                "approve_over_mcp needs a non-empty approvers list: over MCP approvers must be listed",
            ));
        }
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
            approve_over_mcp,
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

#[cfg(test)]
mod tests {
    use super::*;

    fn area(extra: Value) -> Value {
        let mut table = json!({ "space": "alpha", "collection": "handbook" });
        if let (Some(table), Some(extra)) = (table.as_object_mut(), extra.as_object()) {
            table.extend(extra.clone());
        }
        json!({ "areas": { "handbook": table } })
    }

    #[test]
    fn approve_over_mcp_is_off_by_default_and_needs_listed_approvers() {
        let off = parse(&area(json!({}))).unwrap_or_default();
        assert!(!off[0].approve_over_mcp);
        let on = parse(&area(
            json!({ "approvers": ["group:kb-owners"], "approve_over_mcp": true }),
        ))
        .unwrap_or_default();
        assert!(on[0].approve_over_mcp);
        // Over MCP approvers must be listed: an empty list (any human at a terminal) is refused.
        for refused in [
            json!({ "approve_over_mcp": true }),
            json!({ "approvers": [], "approve_over_mcp": true }),
            json!({ "approvers": ["group:kb-owners"], "approve_over_mcp": "yes" }),
        ] {
            assert!(parse(&area(refused.clone())).is_err(), "{refused}");
        }
    }

    #[test]
    fn the_policy_version_changes_only_for_an_area_that_opts_in() {
        let before = parse(&area(json!({ "approvers": ["group:kb-owners"] })))
            .unwrap_or_default()
            .remove(0);
        let mut explicit_off = before.clone();
        explicit_off.approve_over_mcp = false;
        assert_eq!(
            before.policy_version("person"),
            explicit_off.policy_version("person")
        );
        let mut on = before.clone();
        on.approve_over_mcp = true;
        assert_ne!(before.policy_version("person"), on.policy_version("person"));
    }
}
