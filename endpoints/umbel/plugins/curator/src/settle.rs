//! Settling (phase 4 specification, sections 4.1 to 4.3; D93): which of the caller's readable
//! records are eligible, how they group, and when a group has settled.
//!
//! A record is **eligible** at `now` when it is semantic or procedural, live (valid, current, not
//! invalidated or superseded, `expiresAt > now`), unflagged, of an authority the pack admits, and,
//! when the pack sets `min_confidence`, asserts at least that confidence. Eligible records group by
//! content hash and class; a group is one candidate. It has **settled** when every member's
//! current version has stood unchanged for the class's window and the members' observed sessions
//! sum to at least `min_sessions`. Its settling instant is the latest member's `recordedAt` plus
//! the window: the instant the stability rule first held for every member (step 4, amendment 2),
//! a pure function of the records, so it does not move between calls.
//!
//! Neither count counts writes (D81): `sessions` sums each record's distinct sessions (labels a
//! writer chose, D68, so they stop an accident, not an adversary) and `principals` counts the
//! distinct owners. The gate against poisoning is authority (owner decision 9).

use std::collections::{BTreeMap, BTreeSet};

use umbel_store::memory::Millis;
use umbel_store::{Authority, MemoryClass, MemoryRecord, Sensitivity};

use crate::access::rank;
use crate::pack::Settle;

/// Whether `record` is live at `now`: valid, the current version, not invalidated or superseded,
/// and not expired. The same rule the knowledge plugin's source check applies (section 3.2).
#[must_use]
pub fn live(record: &MemoryRecord, now: Millis) -> bool {
    record.invalidation.is_none()
        && record.superseded_by.is_none()
        && record.recorded_at <= now
        && record.recorded_until.is_none_or(|end| end > now)
        && record.valid_from <= now
        && record.valid_until.is_none_or(|end| end > now)
        && record.expires_at > now
}

/// Whether `record` may join a candidate at `now` under `settle` (section 4.2 but the window and
/// the sessions, which are the group's).
#[must_use]
pub fn eligible(record: &MemoryRecord, now: Millis, settle: &Settle) -> bool {
    settle.window(record.class).is_some()
        && live(record, now)
        && record.flags.is_empty()
        && record
            .authority()
            .is_some_and(|authority| settle.admits(authority))
        && settle.min_confidence.is_none_or(|least| {
            record
                .provenance
                .confidence
                .is_some_and(|confidence| confidence >= least)
        })
}

/// One group: the caller's eligible records with one content hash and class.
#[derive(Debug, Clone)]
pub struct Group {
    /// The class.
    pub class: MemoryClass,
    /// The members' common content hash.
    pub content_hash: String,
    /// Every member, ordered by id.
    pub members: Vec<MemoryRecord>,
}

/// What a candidate's rationale is rendered from, fixed when it first becomes ready (section 2.3).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Snapshot {
    /// The sum of the members' observed sessions.
    pub sessions: u64,
    /// The distinct owners.
    pub principals: u64,
    /// The highest authority among the members.
    pub authority: Authority,
    /// The settling instant: `generated.at`.
    pub settled_at: Millis,
}

/// Group `records` that are eligible at `now`: by content hash and class, members by id, groups by
/// their lowest member id. A record listed twice counts once.
#[must_use]
pub fn group(records: Vec<MemoryRecord>, now: Millis, settle: &Settle) -> Vec<Group> {
    let mut groups: BTreeMap<(String, MemoryClass), BTreeMap<String, MemoryRecord>> =
        BTreeMap::new();
    for record in records {
        if !eligible(&record, now, settle) {
            continue;
        }
        groups
            .entry((record.content_hash.as_str().to_owned(), record.class))
            .or_default()
            .insert(record.id.clone(), record);
    }
    let mut out: Vec<Group> = groups
        .into_iter()
        .map(|((content_hash, class), members)| Group {
            class,
            content_hash,
            members: members.into_values().collect(),
        })
        .collect();
    out.sort_by(|a, b| a.lowest().cmp(b.lowest()));
    out
}

impl Group {
    /// The lowest member id, which the candidate id derives from.
    #[must_use]
    pub fn lowest(&self) -> &str {
        self.members.first().map_or("", |record| record.id.as_str())
    }

    /// The sum of the members' observed sessions.
    #[must_use]
    pub fn sessions(&self) -> u64 {
        self.members.iter().map(|r| r.observations.sessions).sum()
    }

    /// The number of distinct owners.
    #[must_use]
    pub fn principals(&self) -> u64 {
        let owners: BTreeSet<&str> = self
            .members
            .iter()
            .map(|r| r.scope.principal.as_str())
            .collect();
        owners.len() as u64
    }

    /// The highest authority among the members (`Authority` orders `person` first).
    #[must_use]
    pub fn authority(&self) -> Option<Authority> {
        self.members
            .iter()
            .filter_map(MemoryRecord::authority)
            .min()
    }

    /// The highest asserted confidence, or `None` when no member asserts one.
    #[must_use]
    pub fn confidence(&self) -> Option<f64> {
        self.members
            .iter()
            .filter_map(|r| r.provenance.confidence)
            .reduce(f64::max)
    }

    /// The highest sensitivity among the members.
    #[must_use]
    pub fn sensitivity(&self) -> Sensitivity {
        self.members
            .iter()
            .map(|r| r.sensitivity)
            .max_by_key(|s| rank(*s))
            .unwrap_or(Sensitivity::Internal)
    }

    /// The instant every member's current version has stood for the class's window.
    #[must_use]
    pub fn stable_at(&self, settle: &Settle) -> Option<Millis> {
        let window = settle.window(self.class)?;
        let latest = self.members.iter().map(|r| r.recorded_at).max()?;
        latest.checked_add(window)
    }

    /// The snapshot when the group has settled at `now`, else `None`.
    #[must_use]
    pub fn settled(&self, now: Millis, settle: &Settle) -> Option<Snapshot> {
        let settled_at = self.stable_at(settle)?;
        if settled_at > now || self.sessions() < settle.min_sessions {
            return None;
        }
        Some(Snapshot {
            sessions: self.sessions(),
            principals: self.principals(),
            authority: self.authority()?,
            settled_at,
        })
    }
}
