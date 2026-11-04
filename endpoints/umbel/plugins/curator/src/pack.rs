//! The `settle` pack (phase 4 specification, sections 4.2, 6 and 7, and 11.1): the defaults of
//! settling, the bounds on one call, conflict sets, feedback and re-verification. A space
//! overrides it whole (D46); an override that does not load is `CURATOR_PACK_INVALID`.

use serde::Deserialize;
use umbel_sdk::{Cx, Outcome};
use umbel_store::memory::{DAY_MS, Millis};
use umbel_store::{Authority, MemoryClass};

use crate::fail;

/// The authorities a pack may admit (owner decision 9): never `transcript`, and `document` and
/// `external` are not memory authorities.
pub const SETTLING_AUTHORITIES: [Authority; 4] = [
    Authority::Person,
    Authority::Agent,
    Authority::Tool,
    Authority::Import,
];

/// The most memory list reads, full reads and drafts a pack may allow per call: the defaults of
/// section 4.1 and 4.6, and the batch's 50 proposals.
const MAX_RECORDS_CEILING: u32 = 5000;
const MAX_GETS_CEILING: u32 = 500;
const MAX_PROPOSALS_CEILING: u32 = 50;
/// The longest window, period or quiet a pack may set, in days.
const DAYS_CEILING: u32 = 3650;

/// Re-verification's defaults (section 6.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Reverify {
    /// A document is due this many days before its `stale_after`.
    pub lead_days: u32,
    /// The next `stale_after` is this many days after the verification.
    pub every_days: u32,
    /// At most this many `verify` drafts per run.
    pub max_per_run: u32,
}

/// `data/settle.toml` as written.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct Raw {
    semantic_days: u32,
    procedural_days: u32,
    min_sessions: u64,
    authorities: Vec<String>,
    #[serde(default)]
    min_confidence: Option<f64>,
    max_records: u32,
    max_gets: u32,
    max_proposals: u32,
    max_alternatives: u32,
    quiet_days: u32,
    every_hours: u32,
    reverify: Reverify,
}

/// The settle pack, checked.
#[derive(Debug, Clone, PartialEq)]
pub struct Settle {
    /// How long a semantic record's current version must stand unchanged, in days.
    pub semantic_days: u32,
    /// The same for a procedural record.
    pub procedural_days: u32,
    /// The least sum of observed sessions over a candidate's records.
    pub min_sessions: u64,
    /// The authorities that may settle, in tier order (`person` first).
    pub authorities: Vec<Authority>,
    /// A record's asserted confidence must be at least this, when set.
    pub min_confidence: Option<f64>,
    /// The most memory records one call lists.
    pub max_records: u32,
    /// The most memory records one call reads in full.
    pub max_gets: u32,
    /// The most proposals one run drafts.
    pub max_proposals: u32,
    /// The most members of a conflict set drafted as alternatives.
    pub max_alternatives: u32,
    /// How long a rejected draft's content stays undrafted, in days.
    pub quiet_days: u32,
    /// A run is overdue after twice this many hours.
    pub every_hours: u32,
    /// Re-verification.
    pub reverify: Reverify,
}

impl Default for Settle {
    /// The shipped pack's values (section 4.2's defaults).
    fn default() -> Self {
        Self {
            semantic_days: 7,
            procedural_days: 14,
            min_sessions: 2,
            authorities: vec![Authority::Person],
            min_confidence: None,
            max_records: 5000,
            max_gets: 500,
            max_proposals: 20,
            max_alternatives: 4,
            quiet_days: 90,
            every_hours: 24,
            reverify: Reverify {
                lead_days: 14,
                every_days: 180,
                max_per_run: 20,
            },
        }
    }
}

impl Settle {
    /// Read the space's settle pack.
    pub(crate) fn load(cx: &Cx) -> Result<Self, Outcome> {
        let bytes = cx
            .pack_read("settle", "data/settle.toml")
            .map_err(|error| fail::host(&error))?;
        let text = String::from_utf8(bytes)
            .map_err(|_| fail::pack_invalid("data/settle.toml is not UTF-8"))?;
        Self::parse(&text).map_err(|reason| fail::pack_invalid(&reason))
    }

    /// Parse and check the pack's text.
    ///
    /// # Errors
    /// The rule the text breaks, naming the key and never a value it does not own.
    pub fn parse(text: &str) -> Result<Self, String> {
        let raw: Raw = toml::from_str(text).map_err(|error| error.message().to_owned())?;
        let mut authorities = Vec::new();
        for name in &raw.authorities {
            match Authority::parse(name) {
                Some(Authority::Transcript) => {
                    return Err(
                        "authorities may not name transcript: a captured transcript never settles"
                            .into(),
                    );
                }
                Some(authority) if SETTLING_AUTHORITIES.contains(&authority) => {
                    authorities.push(authority);
                }
                _ => {
                    return Err("authorities lists only person, agent, tool and import".into());
                }
            }
        }
        authorities.sort();
        authorities.dedup();
        let settle = Self {
            semantic_days: raw.semantic_days,
            procedural_days: raw.procedural_days,
            min_sessions: raw.min_sessions,
            authorities,
            min_confidence: raw.min_confidence,
            max_records: raw.max_records,
            max_gets: raw.max_gets,
            max_proposals: raw.max_proposals,
            max_alternatives: raw.max_alternatives,
            quiet_days: raw.quiet_days,
            every_hours: raw.every_hours,
            reverify: raw.reverify,
        };
        settle.check()?;
        Ok(settle)
    }

    fn check(&self) -> Result<(), String> {
        let days = |name: &str, value: u32, least: u32| {
            if (least..=DAYS_CEILING).contains(&value) {
                Ok(())
            } else {
                Err(format!("{name} must be from {least} to {DAYS_CEILING}"))
            }
        };
        days("semantic_days", self.semantic_days, 1)?;
        days("procedural_days", self.procedural_days, 1)?;
        days("quiet_days", self.quiet_days, 0)?;
        days("reverify.lead_days", self.reverify.lead_days, 0)?;
        days("reverify.every_days", self.reverify.every_days, 1)?;
        if self.authorities.is_empty() {
            return Err("authorities must name at least one authority".into());
        }
        if !(1..=1000).contains(&self.min_sessions) {
            return Err("min_sessions must be from 1 to 1000".into());
        }
        if self
            .min_confidence
            .is_some_and(|c| !c.is_finite() || !(0.0..=1.0).contains(&c))
        {
            return Err("min_confidence must be a number from 0 to 1".into());
        }
        let bound = |name: &str, value: u32, least: u32, most: u32| {
            if (least..=most).contains(&value) {
                Ok(())
            } else {
                Err(format!("{name} must be from {least} to {most}"))
            }
        };
        bound("max_records", self.max_records, 1, MAX_RECORDS_CEILING)?;
        bound("max_gets", self.max_gets, 1, MAX_GETS_CEILING)?;
        bound(
            "max_proposals",
            self.max_proposals,
            1,
            MAX_PROPOSALS_CEILING,
        )?;
        bound("max_alternatives", self.max_alternatives, 2, 8)?;
        bound("every_hours", self.every_hours, 1, 8760)?;
        bound(
            "reverify.max_per_run",
            self.reverify.max_per_run,
            1,
            MAX_PROPOSALS_CEILING,
        )?;
        Ok(())
    }

    /// The settling window of `class`, or `None` for `episodic`, which never settles (D15).
    #[must_use]
    pub fn window(&self, class: MemoryClass) -> Option<Millis> {
        let days = match class {
            MemoryClass::Semantic => self.semantic_days,
            MemoryClass::Procedural => self.procedural_days,
            MemoryClass::Episodic => return None,
        };
        Some(Millis::from(days) * DAY_MS)
    }

    /// Whether `authority` may settle under this pack.
    #[must_use]
    pub fn admits(&self, authority: Authority) -> bool {
        self.authorities.contains(&authority)
    }

    /// The quiet period after a rejection.
    #[must_use]
    pub fn quiet(&self) -> Millis {
        Millis::from(self.quiet_days) * DAY_MS
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    const SHIPPED: &str = include_str!("../packs/settle/data/settle.toml");

    #[test]
    fn the_shipped_pack_is_the_specifications_defaults() {
        assert_eq!(Settle::parse(SHIPPED).unwrap(), Settle::default());
    }

    #[test]
    fn a_bad_pack_is_refused_naming_the_key() {
        let cases = [
            ("semantic_days = 7", "semantic_days = 0", "semantic_days"),
            ("max_gets = 500", "max_gets = 501", "max_gets"),
            ("max_proposals = 20", "max_proposals = 51", "max_proposals"),
            (
                "max_alternatives = 4",
                "max_alternatives = 1",
                "max_alternatives",
            ),
            ("min_sessions = 2", "min_sessions = 0", "min_sessions"),
            (
                "authorities = [\"person\"]",
                "authorities = []",
                "authorities",
            ),
            (
                "authorities = [\"person\"]",
                "authorities = [\"document\"]",
                "authorities",
            ),
        ];
        for (from, to, key) in cases {
            let text = SHIPPED.replace(from, to);
            assert_ne!(text, SHIPPED, "{from}");
            let error = Settle::parse(&text).unwrap_err();
            assert!(error.contains(key), "{to}: {error}");
        }
        let gate = SHIPPED.replace("# min_confidence = 0.7", "min_confidence = 1.5");
        assert!(Settle::parse(&gate).unwrap_err().contains("min_confidence"));
        assert!(Settle::parse(&format!("{SHIPPED}\nextra = 1\n")).is_err());
    }

    #[test]
    fn transcript_never_settles_and_widening_is_kept_in_tier_order() {
        let transcript = SHIPPED.replace(
            "authorities = [\"person\"]",
            "authorities = [\"transcript\"]",
        );
        assert!(
            Settle::parse(&transcript)
                .unwrap_err()
                .contains("transcript")
        );
        let wider = SHIPPED.replace(
            "authorities = [\"person\"]",
            "authorities = [\"import\", \"agent\", \"person\", \"agent\"]",
        );
        let settle = Settle::parse(&wider).unwrap();
        assert_eq!(
            settle.authorities,
            [Authority::Person, Authority::Agent, Authority::Import]
        );
        assert!(!settle.admits(Authority::Tool));
    }
}
