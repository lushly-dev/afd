//! The instance's configuration and the ranking pack.

use serde::Deserialize;
use umbel_sdk::{Cx, Outcome, failure};

/// `[plugins.knowledge.config]` (the manifest's `schema`): how strictly searches treat content.
#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct Settings {
    /// Warn `UNVERIFIED_CONTENT` for hits no person has verified.
    pub(crate) warn_unverified: bool,
    /// Restrict every search and open to documents verified by a person (tier `human` or `owner`).
    pub(crate) verified_only: bool,
}

impl Settings {
    pub(crate) fn load(cx: &Cx) -> Self {
        let Ok(config) = cx.config() else {
            return Self::default();
        };
        let flag = |name: &str| config.get(name).and_then(serde_json::Value::as_bool);
        Self {
            warn_unverified: flag("warn_unverified").unwrap_or(false),
            verified_only: flag("verified_only").unwrap_or(false),
        }
    }
}

/// `data/ranking.toml` of the `ranking` pack (decision D46: a space overrides it whole).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(deny_unknown_fields, default)]
pub(crate) struct Ranking {
    pub(crate) aggregation: Aggregation,
    pub(crate) status: StatusAdjustment,
    pub(crate) fusion: Fusion,
    pub(crate) index: IndexSettings,
}

/// How a document's chunks make its score.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, default)]
pub(crate) struct Aggregation {
    /// The weight of the next best chunks beside the best one.
    pub(crate) secondary_weight: f64,
    /// How many of the next best chunks count.
    pub(crate) secondary_count: usize,
}

/// How a document's status changes its score.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, default)]
pub(crate) struct StatusAdjustment {
    /// The factor for a `draft` document.
    pub(crate) draft_factor: f64,
}

/// Reciprocal rank fusion across spaces.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, default)]
pub(crate) struct Fusion {
    /// The constant of `1 / (k + rank)`.
    pub(crate) rrf_k: f64,
}

/// What the indexer copies from the frontmatter.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(deny_unknown_fields, default)]
pub(crate) struct IndexSettings {
    /// Frontmatter keys searchable as `meta.<key>`.
    pub(crate) filterable: Vec<String>,
}

impl Default for Aggregation {
    fn default() -> Self {
        Self {
            secondary_weight: 0.1,
            secondary_count: 2,
        }
    }
}

impl Default for StatusAdjustment {
    fn default() -> Self {
        Self { draft_factor: 0.8 }
    }
}

impl Default for Fusion {
    fn default() -> Self {
        Self { rrf_k: 60.0 }
    }
}

impl Ranking {
    /// Read the pack; a pack that does not load is `KNOWLEDGE_PACK_INVALID`.
    pub(crate) fn load(cx: &Cx) -> Result<Self, Outcome> {
        let bytes = cx
            .pack_read("ranking", "data/ranking.toml")
            .map_err(|error| crate::fail::host(&error))?;
        let invalid = |reason: String| {
            failure(
                "KNOWLEDGE_PACK_INVALID",
                &format!("the ranking pack does not load: {reason}"),
                "Fix data/ranking.toml in spaces/<space>/packs/knowledge/ranking/, or remove the override to use the default.",
            )
        };
        let text = String::from_utf8(bytes).map_err(|_| invalid("it is not UTF-8".into()))?;
        let ranking: Self = toml::from_str(&text).map_err(|error| invalid(error.to_string()))?;
        ranking.check().map_err(invalid)?;
        Ok(ranking)
    }

    fn check(&self) -> Result<(), String> {
        let finite = |name: &str, value: f64, low: f64, high: f64| {
            if value.is_finite() && value >= low && value <= high {
                Ok(())
            } else {
                Err(format!("{name} must be a number from {low} to {high}"))
            }
        };
        finite(
            "aggregation.secondary_weight",
            self.aggregation.secondary_weight,
            0.0,
            1.0,
        )?;
        if self.aggregation.secondary_count > 10 {
            return Err("aggregation.secondary_count must be at most 10".into());
        }
        finite("status.draft_factor", self.status.draft_factor, 0.0, 1.0)?;
        finite("fusion.rrf_k", self.fusion.rrf_k, 1.0, 1000.0)?;
        if self.index.filterable.len() > 32
            || self
                .index
                .filterable
                .iter()
                .any(|key| key.is_empty() || key.len() > 64 || key.chars().any(char::is_whitespace))
        {
            return Err("index.filterable lists at most 32 keys of 1 to 64 characters".into());
        }
        Ok(())
    }
}
