//! Access and sensitivity (phase 4 specification, section 5.1; owner decision 5, D94).
//!
//! A drafted proposal is readable by anyone who can read its target, before any approval. So a
//! candidate is drafted on a schedule only when every token of the target's access set is in every
//! source's access set, and no source is more sensitive than the target. Otherwise it needs its
//! owner's promotion at a terminal (wider readers), or is skipped (higher sensitivity, which no
//! promotion overrides). The knowledge plugin computes the same rule from the memory store and
//! refuses a draft whose mode disagrees (section 3.2), and approve checks it again (8.2).

use std::collections::BTreeSet;

use umbel_store::{MemoryRecord, Sensitivity};

use crate::target::Target;

/// A sensitivity's rank: `public` < `internal` < `confidential` < `restricted`.
#[must_use]
pub fn rank(sensitivity: Sensitivity) -> u8 {
    match sensitivity {
        Sensitivity::Public => 0,
        Sensitivity::Internal => 1,
        Sensitivity::Confidential => 2,
        Sensitivity::Restricted => 3,
    }
}

/// What section 5.1 says of drafting `sources` into `target`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Rule {
    /// The target's readers are within every source's: drafted on a schedule.
    Within,
    /// The target has readers some source does not: only the owner's promotion drafts it.
    Widens,
    /// A source is more sensitive than the target: never drafted there.
    MoreSensitive,
}

/// Section 5.1's rule for `sources` and `target`. Sensitivity is checked first, since no promotion
/// overrides it.
#[must_use]
pub fn rule(target: &Target, sources: &[MemoryRecord]) -> Rule {
    if sources
        .iter()
        .any(|s| rank(s.sensitivity) > rank(target.sensitivity))
    {
        return Rule::MoreSensitive;
    }
    let widens = target.access.iter().any(|token| {
        sources
            .iter()
            .any(|s| !s.access.tokens().iter().any(|t| t == token))
    });
    if widens { Rule::Widens } else { Rule::Within }
}

/// A candidate record's access set (section 2.3): the intersection of its sources' sets, with
/// `principal:<caller>` added, sorted. Never wider than the caller's own token plus what every
/// source allows.
#[must_use]
pub fn candidate_access(sources: &[MemoryRecord], principal: &str) -> Vec<String> {
    let mut common: Option<BTreeSet<String>> = None;
    for source in sources {
        let tokens: BTreeSet<String> = source.access.tokens().iter().cloned().collect();
        common = Some(match common {
            None => tokens,
            Some(so_far) => so_far.intersection(&tokens).cloned().collect(),
        });
    }
    let mut access = common.unwrap_or_default();
    access.insert(format!("principal:{principal}"));
    access.into_iter().collect()
}
