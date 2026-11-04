//! Conflict sets (phase 4 specification, section 4.4): one caller's candidates whose subjects
//! normalise to the same key (`umbel_okf::draft::subject_key`) and whose content differs.
//!
//! - The set's id is `k-` and 20 hex of SHA-256 of `<space>\0<principal>\0<lowest member id>`,
//!   fixed when it first forms: a member that a run recorded with a set keeps it.
//! - At most `max_alternatives` members, by id order, are drafted as alternatives on the set's
//!   path; the rest are skipped with `conflict-too-large`.
//! - A candidate that can never be drafted (too many sources, higher sensitivity) joins no set,
//!   so it takes no alternative's place (step 4, amendment 6).
//! - **The curator never chooses** (D15): every admitted member is drafted, and a person decides.

use std::collections::{BTreeMap, BTreeSet};

use crate::evaluate::{Candidate, Reason, Status};

/// Whether `candidate` can ever be drafted, and so may join a conflict set.
fn draftable(candidate: &Candidate) -> bool {
    !matches!(
        candidate.reason,
        Some(Reason::TooManySources | Reason::SensitivityHigher)
    )
}

/// Assign conflict sets to `candidates` (ordered by id) of `principal` in `space`, and skip the
/// members past `max_alternatives` that are not yet drafted or decided.
pub fn assign(candidates: &mut [Candidate], space: &str, principal: &str, max_alternatives: usize) {
    let mut by_key: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    for (index, candidate) in candidates.iter().enumerate() {
        if draftable(candidate) {
            by_key
                .entry(candidate.subject_key.clone())
                .or_default()
                .push(index);
        }
    }
    for mut members in by_key.into_values() {
        let hashes: BTreeSet<&str> = members
            .iter()
            .map(|&i| candidates[i].content_hash.as_str())
            .collect();
        if hashes.len() < 2 {
            continue;
        }
        members.sort_by(|&a, &b| candidates[a].id.cmp(&candidates[b].id));
        // Fixed when the set first forms: a member a run recorded with a set keeps it.
        let set = members
            .iter()
            .filter_map(|&i| candidates[i].conflict_set.clone())
            .min()
            .unwrap_or_else(|| {
                umbel_okf::draft::conflict_set_id(space, principal, &candidates[members[0]].id)
            });
        for (position, &index) in members.iter().enumerate() {
            let candidate = &mut candidates[index];
            candidate.conflict_set = Some(set.clone());
            if position >= max_alternatives
                && matches!(candidate.status, Status::Settling | Status::Ready)
            {
                candidate.status = Status::Skipped;
                candidate.reason = Some(Reason::ConflictTooLarge);
                candidate.mode = None;
            }
        }
    }
}
