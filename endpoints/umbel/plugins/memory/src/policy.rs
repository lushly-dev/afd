//! The `policy` pack (section 8.11): each class's lifetimes, the expiring-soon window and the
//! quota. A space overrides it whole (D46); an override that does not load refuses the write.

use serde::Deserialize;
use umbel_sdk::{Cx, Outcome};
use umbel_store::MemoryClass;
use umbel_store::memory::{DAY_MS, Millis, Quota, Retention};

use crate::fail;

/// The host's ceiling on any class's `max_ttl_days`, which no pack passes (section 8.11).
pub(crate) const MAX_TTL_DAYS_CEILING: u32 = 3650;

/// One class's lifetimes, in days.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ClassPolicy {
    pub(crate) default_ttl_days: u32,
    pub(crate) max_ttl_days: u32,
    pub(crate) purge_after_days: u32,
}

/// The three classes.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Classes {
    pub(crate) episodic: ClassPolicy,
    pub(crate) semantic: ClassPolicy,
    pub(crate) procedural: ClassPolicy,
}

/// The write and storage limits, before the host's ceilings.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct QuotaPolicy {
    pub(crate) writes_per_hour: u64,
    pub(crate) bytes_per_hour: u64,
    pub(crate) stored_records: u64,
    pub(crate) stored_bytes: u64,
}

/// `data/policy.toml`.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Policy {
    pub(crate) expiring_soon_days: u32,
    pub(crate) classes: Classes,
    pub(crate) quota: QuotaPolicy,
}

impl Policy {
    /// Read the space's policy pack.
    pub(crate) fn load(cx: &Cx) -> Result<Self, Outcome> {
        let bytes = cx
            .pack_read("policy", "data/policy.toml")
            .map_err(|error| fail::host(&error))?;
        let text = String::from_utf8(bytes)
            .map_err(|_| fail::pack_invalid("policy", "data/policy.toml is not UTF-8"))?;
        Self::parse(&text).map_err(|reason| fail::pack_invalid("policy", &reason))
    }

    /// Parse and check the pack's text.
    pub(crate) fn parse(text: &str) -> Result<Self, String> {
        let policy: Self = toml::from_str(text).map_err(|error| error.message().to_owned())?;
        policy.check()?;
        Ok(policy)
    }

    fn check(&self) -> Result<(), String> {
        for class in MemoryClass::ALL {
            let c = self.class(class);
            let name = class.as_str();
            if c.default_ttl_days == 0 || c.max_ttl_days == 0 || c.purge_after_days == 0 {
                return Err(format!(
                    "classes.{name}: every number of days is at least 1"
                ));
            }
            if c.default_ttl_days > c.max_ttl_days {
                return Err(format!(
                    "classes.{name}: default_ttl_days must not pass max_ttl_days"
                ));
            }
            if c.max_ttl_days > MAX_TTL_DAYS_CEILING {
                return Err(format!(
                    "classes.{name}: max_ttl_days must be at most {MAX_TTL_DAYS_CEILING}, the host's ceiling"
                ));
            }
        }
        if self.expiring_soon_days == 0 || self.expiring_soon_days > MAX_TTL_DAYS_CEILING {
            return Err("expiring_soon_days must be from 1 to 3650".into());
        }
        let q = &self.quota;
        if q.writes_per_hour == 0
            || q.bytes_per_hour == 0
            || q.stored_records == 0
            || q.stored_bytes == 0
        {
            return Err("every quota limit is at least 1".into());
        }
        Ok(())
    }

    /// One class's lifetimes.
    pub(crate) fn class(&self, class: MemoryClass) -> ClassPolicy {
        match class {
            MemoryClass::Episodic => self.classes.episodic,
            MemoryClass::Semantic => self.classes.semantic,
            MemoryClass::Procedural => self.classes.procedural,
        }
    }

    /// The quota the store checks; the host caps it by its ceilings.
    pub(crate) fn quota(&self) -> Quota {
        Quota {
            writes_per_hour: self.quota.writes_per_hour,
            bytes_per_hour: self.quota.bytes_per_hour,
            stored_records: self.quota.stored_records,
            stored_bytes: self.quota.stored_bytes,
        }
    }

    /// What the purge before a write measures against.
    pub(crate) fn retention(&self) -> Retention {
        Retention {
            episodic_days: self.classes.episodic.purge_after_days,
            semantic_days: self.classes.semantic.purge_after_days,
            procedural_days: self.classes.procedural.purge_after_days,
        }
    }

    /// The expiring-soon window.
    pub(crate) fn expiring_soon_ms(&self) -> Millis {
        Millis::from(self.expiring_soon_days) * DAY_MS
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    const DEFAULT: &str = include_str!("../packs/policy/data/policy.toml");

    #[test]
    fn the_default_pack_loads_with_the_specifications_numbers() {
        let policy = Policy::parse(DEFAULT).expect("the default pack loads");
        assert_eq!(policy.expiring_soon_days, 14);
        let episodic = policy.class(MemoryClass::Episodic);
        assert_eq!(
            (
                episodic.default_ttl_days,
                episodic.max_ttl_days,
                episodic.purge_after_days
            ),
            (30, 90, 30)
        );
        assert_eq!(policy.class(MemoryClass::Semantic).max_ttl_days, 730);
        assert_eq!(policy.class(MemoryClass::Procedural).max_ttl_days, 1095);
        assert_eq!(policy.quota().writes_per_hour, 600);
        assert_eq!(policy.quota().stored_bytes, 2_147_483_648);
        assert_eq!(policy.retention(), Retention::default());
    }

    #[test]
    fn a_bad_pack_is_refused() {
        let over = DEFAULT.replace("max_ttl_days = 1095", "max_ttl_days = 4000");
        assert!(Policy::parse(&over).unwrap_err().contains("3650"));
        let inverted = DEFAULT.replace("default_ttl_days = 30\n", "default_ttl_days = 100\n");
        assert!(Policy::parse(&inverted).is_err());
        assert!(Policy::parse("expiring_soon_days = 14\n").is_err());
        let unknown = format!("{DEFAULT}\nextra = 1\n");
        assert!(Policy::parse(&unknown).is_err());
    }
}
