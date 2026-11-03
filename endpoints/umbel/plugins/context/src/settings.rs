//! The instance's configuration and the `bundle` pack (section 9.7).

use serde::Deserialize;
use serde_json::Value;
use umbel_sdk::{Cx, Outcome};
use umbel_store::Authority;

use crate::fail;
use crate::select::Section;

/// The authorities a push setting may list.
const PUSHABLE: [Authority; 5] = [
    Authority::Person,
    Authority::Tool,
    Authority::Agent,
    Authority::Import,
    Authority::Transcript,
];

/// `[plugins.context.config]` (the manifest's `schema`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Settings {
    /// Bundle only knowledge a person verified, and omit every memory section.
    pub(crate) verified_only: bool,
    /// Authorities admitted for the caller's own records (default `person` only).
    pub(crate) push_authorities: Vec<Authority>,
    /// Authorities admitted for another principal's readable records (default `person` only).
    pub(crate) push_foreign_authorities: Vec<Authority>,
}

/// A push list from the configuration; absent or unreadable is `person` alone, the narrow
/// default (owner decision 2). The host has already checked the list against the schema.
fn authorities(config: &Value, key: &str) -> Vec<Authority> {
    let Some(names) = config.get(key).and_then(Value::as_array) else {
        return vec![Authority::Person];
    };
    PUSHABLE
        .into_iter()
        .filter(|authority| {
            names
                .iter()
                .any(|name| name.as_str() == Some(authority.as_str()))
        })
        .collect()
}

impl Settings {
    pub(crate) fn load(cx: &Cx) -> Self {
        let config = cx.config().unwrap_or(Value::Null);
        Self {
            verified_only: config
                .get("verified_only")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            push_authorities: authorities(&config, "push_authorities"),
            push_foreign_authorities: authorities(&config, "push_foreign_authorities"),
        }
    }
}

/// `[shares]` of the pack.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, default)]
pub(crate) struct Shares {
    pub(crate) knowledge: f64,
    pub(crate) semantic: f64,
    pub(crate) procedural: f64,
    pub(crate) episodic: f64,
}

impl Default for Shares {
    fn default() -> Self {
        Self {
            knowledge: 0.5,
            semantic: 0.25,
            procedural: 0.15,
            episodic: 0.1,
        }
    }
}

impl Shares {
    pub(crate) fn of(&self, section: Section) -> f64 {
        match section {
            Section::Knowledge => self.knowledge,
            Section::Semantic => self.semantic,
            Section::Procedural => self.procedural,
            Section::Episodic => self.episodic,
        }
    }
}

/// `data/bundle.toml` of the `bundle` pack (a space overrides it whole, D46).
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, default)]
pub(crate) struct Bundle {
    pub(crate) shares: Shares,
    pub(crate) max_items: usize,
    pub(crate) per_authority_cap: usize,
    pub(crate) max_item_bytes: usize,
    pub(crate) secondary_weight: f64,
    pub(crate) draft_factor: f64,
    pub(crate) stop_words: Vec<String>,
}

impl Default for Bundle {
    fn default() -> Self {
        Self {
            shares: Shares::default(),
            max_items: 24,
            per_authority_cap: 8,
            max_item_bytes: 4000,
            secondary_weight: 0.1,
            draft_factor: 0.8,
            stop_words: Vec::new(),
        }
    }
}

impl Bundle {
    /// Read the pack; a pack that does not load is `CONTEXT_PACK_INVALID`.
    pub(crate) fn load(cx: &Cx) -> Result<Self, Outcome> {
        let bytes = cx
            .pack_read("bundle", "data/bundle.toml")
            .map_err(|error| fail::host(&error))?;
        let text = String::from_utf8(bytes).map_err(|_| fail::pack_invalid("it is not UTF-8"))?;
        let bundle: Self =
            toml::from_str(&text).map_err(|error| fail::pack_invalid(&error.to_string()))?;
        bundle
            .check()
            .map_err(|reason| fail::pack_invalid(&reason))?;
        Ok(bundle)
    }

    fn check(&self) -> Result<(), String> {
        let unit = |name: &str, value: f64| {
            if value.is_finite() && (0.0..=1.0).contains(&value) {
                Ok(())
            } else {
                Err(format!("{name} must be a number from 0 to 1"))
            }
        };
        for section in Section::ALL {
            unit(
                &format!("shares.{}", section.name()),
                self.shares.of(section),
            )?;
        }
        unit("secondary_weight", self.secondary_weight)?;
        unit("draft_factor", self.draft_factor)?;
        // The bundle schema holds at most 24 items in a section.
        if !(1..=24).contains(&self.max_items) {
            return Err("max_items must be from 1 to 24".into());
        }
        if !(1..=64).contains(&self.per_authority_cap) {
            return Err("per_authority_cap must be from 1 to 64".into());
        }
        if !(256..=16_000).contains(&self.max_item_bytes) {
            return Err("max_item_bytes must be from 256 to 16000".into());
        }
        if self.stop_words.len() > 1000
            || self
                .stop_words
                .iter()
                .any(|word| word.is_empty() || word.len() > 64)
        {
            return Err("stop_words lists at most 1000 words of 1 to 64 bytes".into());
        }
        Ok(())
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn the_push_lists_default_to_person_and_keep_tier_order() {
        assert_eq!(
            authorities(&json!({}), "push_authorities"),
            [Authority::Person]
        );
        assert_eq!(
            authorities(
                &json!({ "push_authorities": ["agent", "person", "tool"] }),
                "push_authorities"
            ),
            [Authority::Person, Authority::Tool, Authority::Agent]
        );
        // Authorities a bundle never pushes are not admitted even when listed.
        assert!(authorities(&json!({ "p": ["document", "external"] }), "p").is_empty());
    }

    #[test]
    fn the_shipped_pack_loads_and_checks() {
        let text = include_str!("../packs/bundle/data/bundle.toml");
        let bundle: Bundle = toml::from_str(text).unwrap();
        bundle.check().unwrap();
        assert_eq!(bundle.max_items, 24);
        assert_eq!(bundle.per_authority_cap, 8);
        assert!(bundle.stop_words.iter().any(|w| w == "the"));
        let mut bad = bundle;
        bad.max_items = 25;
        assert!(bad.check().is_err());
    }
}
