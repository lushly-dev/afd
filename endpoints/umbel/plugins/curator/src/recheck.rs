//! The re-check of open drafts (phase 4 specification, sections 7.3 and 9.1; owner decision 7,
//! D103). **Every run re-checks every draft of the caller's that may be open**: each source is
//! read with `memory_get` at `now`, under the caller's reader filter, which covers expiry by the
//! clock and the loss of readability the changes feed cannot show the caller.
//!
//! | A source | The draft |
//! | --- | --- |
//! | erased (the feed's `Erased`) | redacted and withdrawn through the batch's `erased` notice |
//! | absent, unreadable, invalidated or superseded, flagged, expired, or at another version (a confirmation writes one) | withdrawn with `source-changed`, not redacted |
//! | standing at its version | kept |
//!
//! A source at another version is withdrawn because the knowledge plugin's approve refuses a draft
//! whose source is not at its cited version (section 8.2); the candidate re-settles and the next
//! draft cites the new version, with a confirmation's raised authority (step 5's amendments).
//!
//! Two more reasons withdraw an open draft:
//! - **superseded alternatives** (section 4.4): a member of a conflict set was applied, so the
//!   others' drafts are withdrawn with `superseded-alternative`;
//! - **a stale key** (section 7.3's recovery): a draft a run recorded as about to be submitted
//!   whose proposal is not the one the current draft number derives, or whose candidate no longer
//!   renders the same, is withdrawn before anything is drafted again under a new key.
//!
//! A candidate whose draft is withdrawn is not drafted again in the same run.

use std::collections::{BTreeMap, BTreeSet};

use umbel_store::MemoryRecord;
use umbel_store::memory::Millis;

use crate::evaluate::{Candidate, Status};
use crate::records::{SourceRef, Stored};
use crate::settle;

/// Whether every recorded source stands at `now`: read, live, unflagged and at its version.
#[must_use]
pub fn stands(
    recorded: &[SourceRef],
    current: &BTreeMap<String, Option<MemoryRecord>>,
    now: Millis,
) -> bool {
    !recorded.is_empty()
        && recorded.iter().all(|source| {
            current
                .get(&source.id)
                .and_then(Option::as_ref)
                .is_some_and(|record| {
                    settle::live(record, now)
                        && record.flags.is_empty()
                        && record.record_version == source.record_version
                })
        })
}

/// The conflict sets with an applied member, from the caller's records.
#[must_use]
pub fn applied_sets(stored: &[Stored]) -> BTreeSet<String> {
    stored
        .iter()
        .filter(|s| s.status == Status::Applied)
        .filter_map(|s| s.conflict_set.clone())
        .collect()
}

/// Whether the live `candidate` renders the draft `stored` recorded: the same sources at the same
/// versions, content hash, settling snapshot, conflict set and document.
#[must_use]
pub fn renders_as_recorded(stored: &Stored, candidate: &Candidate) -> bool {
    let live: Vec<SourceRef> = candidate
        .sources
        .iter()
        .map(|s| SourceRef {
            id: s.id.clone(),
            record_version: s.record_version,
        })
        .collect();
    live == stored.sources
        && stored.content_hash.as_deref() == Some(candidate.content_hash.as_str())
        && stored.snapshot == candidate.snapshot
        && stored.conflict_set == candidate.conflict_set
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn a_source_that_is_not_read_does_not_stand() {
        let recorded = vec![SourceRef {
            id: "mem-1".into(),
            record_version: 1,
        }];
        let mut current = BTreeMap::new();
        assert!(!stands(&recorded, &current, 0));
        current.insert("mem-1".to_owned(), None);
        assert!(!stands(&recorded, &current, 0));
        assert!(!stands(&[], &current, 0), "a draft with no sources");
    }
}
