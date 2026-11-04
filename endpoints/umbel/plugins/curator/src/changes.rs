//! The memory changes feed a run reads (phase 4 specification, sections 4.1 and 9.1): the
//! changes after the state's `memoryAfter`, under the caller's reader filter (filtered by the
//! access each record had at the change), with no text.
//!
//! What a run takes from it is the records **erased** (`Erased`, a forget): their drafts are
//! withdrawn and redacted through the batch's `erased` notice, and the curator's own records
//! citing them keep nothing of them. `Invalidated`, `Purged` and expiry are caught by the
//! re-check, which reads each open draft's sources at `now` (section 9.1), and `Confirmed`
//! changes nothing here. A run reads at most [`MAX_CHANGES`] changes and stops at
//! [`MAX_ERASED`] erased records, the batch's cap, so the next run continues where it stopped.

use std::collections::BTreeSet;

use umbel_sdk::{Cx, HostError, Outcome};
use umbel_store::memory::{MAX_MEMORY_CHANGES_LIMIT, MemoryChangeKind};

use crate::fail;

/// The most changes one run reads.
pub(crate) const MAX_CHANGES: u64 = 5000;
/// The most erased records one run names to the batch (its `erased` cap).
pub(crate) const MAX_ERASED: usize = 400;

/// What one run read of the feed.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct Changes {
    /// The records erased after the cursor, by id.
    pub(crate) erased: BTreeSet<String>,
    /// The revision the next run continues after.
    pub(crate) next: u64,
    /// Whether a bound stopped the read before the end.
    pub(crate) more: bool,
}

/// The caller's readable memory changes in `space` after `after`.
pub(crate) fn read(cx: &Cx, space: &str, after: u64) -> Result<Changes, Outcome> {
    let mut changes = Changes {
        next: after,
        ..Changes::default()
    };
    let mut read = 0u64;
    loop {
        let page = match cx.memory_changes(space, changes.next, MAX_MEMORY_CHANGES_LIMIT, None) {
            Ok(page) => page,
            Err(HostError::NotProvisioned) => return Ok(changes),
            Err(error) => return Err(fail::host(&error)),
        };
        let full = page.len() >= MAX_MEMORY_CHANGES_LIMIT as usize;
        for change in &page {
            if read >= MAX_CHANGES
                || (change.kind == MemoryChangeKind::Erased
                    && changes.erased.len() >= MAX_ERASED
                    && !changes.erased.contains(&change.id))
            {
                changes.more = true;
                return Ok(changes);
            }
            read += 1;
            changes.next = change.rev;
            if change.kind == MemoryChangeKind::Erased {
                changes.erased.insert(change.id.clone());
            }
        }
        if !full {
            return Ok(changes);
        }
    }
}
