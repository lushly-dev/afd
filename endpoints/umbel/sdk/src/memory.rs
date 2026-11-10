//! The memory methods of [`Cx`] (phase 3 specification, section 6): grant `memory` reads under the
//! caller's reader filter, and grant `memory_write` writes, whose identity, authority, access,
//! scan and quota ceilings the host owns.
//!
//! Every method takes the space explicitly and the host refuses a space outside the call's;
//! [`SpaceCx`] binds one, as for the other stores.

use umbel_store::memory::{
    Confirm, ForgetReceipt, Invalidate, KeyFileState, LeftOut, MemoryChange, MemoryCounts,
    MemoryList, MemoryPage, MemoryReceipt, MemoryUsage, MemoryVersionMeta, RecallPage, RecallQuery,
    ReindexReceipt, Retention, SweepReceipt,
};
use umbel_store::{
    AsOf, ForgetSelector, MemoryBatch, MemoryClass, MemoryRecord, Millis, PushFilter, ReadFlags,
    Rev, ScopeQuery,
};

use crate::cx::{Cx, HostError};
use crate::store::SpaceCx;

/// Which write path a memory write takes: the host fills `authority` from it and the call
/// (section 3.3), and captures are always private (section 3.2).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum MemoryPath {
    /// `memory-remember`: `person`, `tool` or `agent`.
    Remember,
    /// `memory-capture`: `transcript` or `agent`, always private.
    Capture,
    /// `memory-import`: `import`.
    Import,
}

/// A memory write as a plugin asks for it.
#[derive(Debug, Clone, PartialEq)]
pub struct MemoryWriteRequest {
    /// The path.
    pub path: MemoryPath,
    /// The input's `share`: `None` when absent, else `private`, `space` or `group:<g>`. The host
    /// turns it into the access set of every entry, whatever the entries carry.
    pub share: Option<String>,
    /// The batch. The host overwrites each entry's `scope.space`, `scope.principal`,
    /// `scope.agent`, `access`, the envelope's identity fields and `authority`, and the batch's
    /// `at`; it unions its scan's findings into `flags` and caps `quota`.
    pub batch: MemoryBatch,
}

/// `memory-erase`'s call as the plugin asks for it (phase 5 specification, section 8.4): the
/// target principal, the ids (or all of the target's records), whether it is the dry run, and the
/// plan and erase request it presents.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EraseCall {
    /// The principal whose records are erased, `<kind>:<id>`.
    pub principal: String,
    /// Only these of the target's records; `None` for all of them.
    pub ids: Option<Vec<String>>,
    /// The dry run: a count and the plan, nothing erased.
    pub dry_run: bool,
    /// The plan the dry run gave; required for the erase.
    pub plan: Option<String>,
    /// The erase request a second eraser approves (`erase_approvals = 2`).
    pub request: Option<String>,
}

/// What `memory-erase` did, as the host answers it: counts, ids of requests and plans, never a
/// record's id or text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EraseAnswer {
    /// The dry run: how many records the erase would reach, and the plan that names them.
    Planned {
        /// The records.
        count: u64,
        /// `sha256:` and 64 hex digits.
        plan: String,
    },
    /// The first of two erasers approved: nothing is erased until a second, other eraser
    /// approves the same plan before `expires_at`.
    Awaiting {
        /// `x-` and 20 hex digits.
        request: String,
        /// When the request expires.
        expires_at: umbel_store::Millis,
    },
    /// The records were erased.
    Erased {
        /// How many.
        erased: u64,
        /// Whether the write-ahead log and the index were rewritten yet.
        wal: umbel_store::memory::WalState,
        /// Every eraser who approved, first first.
        erasers: Vec<String>,
        /// The erase request the second eraser approved.
        request: Option<String>,
    },
}

/// What `memory-erase-preview` may show of a call (phase 5 section 8.4): the count only when the
/// plan presented names the records as they are now, and the pending request it approves.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ErasePreview {
    /// How many records the plan presented names, when it still names them; `None` for a dry
    /// run.
    pub count: Option<u64>,
    /// The first eraser of the request presented, and when it expires.
    pub request: Option<(String, umbel_store::Millis)>,
    /// `erase_approvals`: 1 or 2.
    pub approvals: u64,
}

/// `left_out`'s arguments (section 5.2).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LeftOutQuery {
    /// The labels.
    pub scope: ScopeQuery,
    /// The classes asked for; empty is every class.
    pub classes: Vec<MemoryClass>,
    /// The push rule.
    pub push: PushFilter,
    /// The instants.
    pub as_of: AsOf,
    /// The clock expiry is measured against.
    pub now: Millis,
}

impl Cx {
    /// Grant `memory`: one record.
    ///
    /// # Errors
    /// See [`HostServices::memory_get`](crate::HostServices::memory_get).
    pub fn memory_get(
        &self,
        space: &str,
        id: &str,
        as_of: AsOf,
        flags: ReadFlags,
    ) -> Result<Option<MemoryRecord>, HostError> {
        self.check_space(space)?;
        self.host()?.memory_get(space, id, as_of, flags)
    }

    /// Grant `memory`: every version of a record.
    ///
    /// # Errors
    /// See [`HostServices::memory_history`](crate::HostServices::memory_history).
    pub fn memory_history(&self, space: &str, id: &str) -> Result<Vec<MemoryRecord>, HostError> {
        self.check_space(space)?;
        self.host()?.memory_history(space, id)
    }

    /// Grant `memory`: list readable records.
    ///
    /// # Errors
    /// See [`HostServices::memory_list`](crate::HostServices::memory_list).
    pub fn memory_list(&self, space: &str, query: &MemoryList) -> Result<MemoryPage, HostError> {
        self.check_space(space)?;
        self.host()?.memory_list(space, query)
    }

    /// Grant `memory`: ranked recall.
    ///
    /// # Errors
    /// See [`HostServices::memory_recall`](crate::HostServices::memory_recall).
    pub fn memory_recall(&self, space: &str, query: &RecallQuery) -> Result<RecallPage, HostError> {
        self.check_space(space)?;
        self.host()?.memory_recall(space, query)
    }

    /// Grant `memory`: what a bundle's push rule leaves out.
    ///
    /// # Errors
    /// See [`HostServices::memory_left_out`](crate::HostServices::memory_left_out).
    pub fn memory_left_out(&self, space: &str, query: &LeftOutQuery) -> Result<LeftOut, HostError> {
        self.check_space(space)?;
        self.host()?.memory_left_out(space, query)
    }

    /// Grant `memory`: readable changes.
    ///
    /// # Errors
    /// See [`HostServices::memory_changes`](crate::HostServices::memory_changes).
    pub fn memory_changes(
        &self,
        space: &str,
        after: Rev,
        limit: u32,
        trace: Option<&str>,
    ) -> Result<Vec<MemoryChange>, HostError> {
        self.check_space(space)?;
        self.host()?.memory_changes(space, after, limit, trace)
    }

    /// Grant `memory`: counts over what the caller can read.
    ///
    /// # Errors
    /// See [`HostServices::memory_counts`](crate::HostServices::memory_counts).
    pub fn memory_counts(
        &self,
        space: &str,
        now: Millis,
        expiring_within_ms: Millis,
    ) -> Result<MemoryCounts, HostError> {
        self.check_space(space)?;
        self.host()?.memory_counts(space, now, expiring_within_ms)
    }

    /// Grant `memory`: the caller's own usage.
    ///
    /// # Errors
    /// See [`HostServices::memory_usage`](crate::HostServices::memory_usage).
    pub fn memory_usage(&self, space: &str, since: Millis) -> Result<MemoryUsage, HostError> {
        self.check_space(space)?;
        self.host()?.memory_usage(space, since)
    }

    /// Grant `memory`: the highest revision of a change the caller can read.
    ///
    /// # Errors
    /// See [`HostServices::memory_head`](crate::HostServices::memory_head).
    pub fn memory_head(&self, space: &str) -> Result<Rev, HostError> {
        self.check_space(space)?;
        self.host()?.memory_head(space)
    }

    /// Grant `memory`: the key file's state.
    ///
    /// # Errors
    /// See [`HostServices::memory_key_file`](crate::HostServices::memory_key_file).
    pub fn memory_key_file(&self, space: &str) -> Result<KeyFileState, HostError> {
        self.check_space(space)?;
        self.host()?.memory_key_file(space)
    }

    /// Grant `memory_write`: write a batch.
    ///
    /// # Errors
    /// See [`HostServices::memory_write`](crate::HostServices::memory_write).
    pub fn memory_write(
        &self,
        space: &str,
        request: MemoryWriteRequest,
    ) -> Result<MemoryReceipt, HostError> {
        self.check_space(space)?;
        self.host()?.memory_write(space, request)
    }

    /// Grant `memory_write`: invalidate a record.
    ///
    /// # Errors
    /// See [`HostServices::memory_invalidate`](crate::HostServices::memory_invalidate).
    pub fn memory_invalidate(
        &self,
        space: &str,
        request: Invalidate,
    ) -> Result<MemoryVersionMeta, HostError> {
        self.check_space(space)?;
        self.host()?.memory_invalidate(space, request)
    }

    /// Grant `memory_write`: confirm a record.
    ///
    /// # Errors
    /// See [`HostServices::memory_confirm`](crate::HostServices::memory_confirm).
    pub fn memory_confirm(
        &self,
        space: &str,
        request: Confirm,
    ) -> Result<MemoryVersionMeta, HostError> {
        self.check_space(space)?;
        self.host()?.memory_confirm(space, request)
    }

    /// Grant `memory_write`: forget the caller's records.
    ///
    /// # Errors
    /// See [`HostServices::memory_forget`](crate::HostServices::memory_forget).
    pub fn memory_forget(
        &self,
        space: &str,
        selector: ForgetSelector,
    ) -> Result<ForgetReceipt, HostError> {
        self.check_space(space)?;
        self.host()?.memory_forget(space, selector)
    }

    /// Grant `memory_write`: `memory-erase` (phase 5 section 8.4).
    ///
    /// # Errors
    /// See [`HostServices::memory_erase`](crate::HostServices::memory_erase).
    pub fn memory_erase(&self, space: &str, call: EraseCall) -> Result<EraseAnswer, HostError> {
        self.check_space(space)?;
        self.host()?.memory_erase(space, call)
    }

    /// Grant `memory_write`: what `memory-erase-preview` may show (phase 5 section 8.4).
    ///
    /// # Errors
    /// See [`HostServices::memory_erase_preview`](crate::HostServices::memory_erase_preview).
    pub fn memory_erase_preview(
        &self,
        space: &str,
        call: EraseCall,
    ) -> Result<ErasePreview, HostError> {
        self.check_space(space)?;
        self.host()?.memory_erase_preview(space, call)
    }

    /// Grant `memory_write`: purge records past their purge date.
    ///
    /// # Errors
    /// See [`HostServices::memory_sweep`](crate::HostServices::memory_sweep).
    pub fn memory_sweep(
        &self,
        space: &str,
        limit: u32,
        retention: Retention,
    ) -> Result<SweepReceipt, HostError> {
        self.check_space(space)?;
        self.host()?.memory_sweep(space, limit, retention)
    }

    /// Grant `memory_write`: rebuild the lexical lane.
    ///
    /// # Errors
    /// See [`HostServices::memory_reindex`](crate::HostServices::memory_reindex).
    pub fn memory_reindex(
        &self,
        space: &str,
        remove_orphans: bool,
    ) -> Result<ReindexReceipt, HostError> {
        self.check_space(space)?;
        self.host()?.memory_reindex(space, remove_orphans)
    }
}

impl SpaceCx<'_> {
    /// Grant `memory`: one record.
    ///
    /// # Errors
    /// See [`Cx::memory_get`].
    pub fn memory_get(
        &self,
        id: &str,
        as_of: AsOf,
        flags: ReadFlags,
    ) -> Result<Option<MemoryRecord>, HostError> {
        self.cx.memory_get(&self.space, id, as_of, flags)
    }

    /// Grant `memory`: every version of a record.
    ///
    /// # Errors
    /// See [`Cx::memory_history`].
    pub fn memory_history(&self, id: &str) -> Result<Vec<MemoryRecord>, HostError> {
        self.cx.memory_history(&self.space, id)
    }

    /// Grant `memory`: list readable records.
    ///
    /// # Errors
    /// See [`Cx::memory_list`].
    pub fn memory_list(&self, query: &MemoryList) -> Result<MemoryPage, HostError> {
        self.cx.memory_list(&self.space, query)
    }

    /// Grant `memory`: ranked recall.
    ///
    /// # Errors
    /// See [`Cx::memory_recall`].
    pub fn memory_recall(&self, query: &RecallQuery) -> Result<RecallPage, HostError> {
        self.cx.memory_recall(&self.space, query)
    }

    /// Grant `memory`: what a bundle's push rule leaves out.
    ///
    /// # Errors
    /// See [`Cx::memory_left_out`].
    pub fn memory_left_out(&self, query: &LeftOutQuery) -> Result<LeftOut, HostError> {
        self.cx.memory_left_out(&self.space, query)
    }

    /// Grant `memory`: readable changes.
    ///
    /// # Errors
    /// See [`Cx::memory_changes`].
    pub fn memory_changes(
        &self,
        after: Rev,
        limit: u32,
        trace: Option<&str>,
    ) -> Result<Vec<MemoryChange>, HostError> {
        self.cx.memory_changes(&self.space, after, limit, trace)
    }

    /// Grant `memory`: counts over what the caller can read.
    ///
    /// # Errors
    /// See [`Cx::memory_counts`].
    pub fn memory_counts(
        &self,
        now: Millis,
        expiring_within_ms: Millis,
    ) -> Result<MemoryCounts, HostError> {
        self.cx.memory_counts(&self.space, now, expiring_within_ms)
    }

    /// Grant `memory`: the caller's own usage.
    ///
    /// # Errors
    /// See [`Cx::memory_usage`].
    pub fn memory_usage(&self, since: Millis) -> Result<MemoryUsage, HostError> {
        self.cx.memory_usage(&self.space, since)
    }

    /// Grant `memory`: the highest readable revision.
    ///
    /// # Errors
    /// See [`Cx::memory_head`].
    pub fn memory_head(&self) -> Result<Rev, HostError> {
        self.cx.memory_head(&self.space)
    }

    /// Grant `memory`: the key file's state.
    ///
    /// # Errors
    /// See [`Cx::memory_key_file`].
    pub fn memory_key_file(&self) -> Result<KeyFileState, HostError> {
        self.cx.memory_key_file(&self.space)
    }

    /// Grant `memory_write`: write a batch.
    ///
    /// # Errors
    /// See [`Cx::memory_write`].
    pub fn memory_write(&self, request: MemoryWriteRequest) -> Result<MemoryReceipt, HostError> {
        self.cx.memory_write(&self.space, request)
    }

    /// Grant `memory_write`: invalidate a record.
    ///
    /// # Errors
    /// See [`Cx::memory_invalidate`].
    pub fn memory_invalidate(&self, request: Invalidate) -> Result<MemoryVersionMeta, HostError> {
        self.cx.memory_invalidate(&self.space, request)
    }

    /// Grant `memory_write`: confirm a record.
    ///
    /// # Errors
    /// See [`Cx::memory_confirm`].
    pub fn memory_confirm(&self, request: Confirm) -> Result<MemoryVersionMeta, HostError> {
        self.cx.memory_confirm(&self.space, request)
    }

    /// Grant `memory_write`: forget the caller's records.
    ///
    /// # Errors
    /// See [`Cx::memory_forget`].
    pub fn memory_forget(&self, selector: ForgetSelector) -> Result<ForgetReceipt, HostError> {
        self.cx.memory_forget(&self.space, selector)
    }

    /// Grant `memory_write`: purge records past their purge date.
    ///
    /// # Errors
    /// See [`Cx::memory_sweep`].
    pub fn memory_sweep(
        &self,
        limit: u32,
        retention: Retention,
    ) -> Result<SweepReceipt, HostError> {
        self.cx.memory_sweep(&self.space, limit, retention)
    }

    /// Grant `memory_write`: rebuild the lexical lane.
    ///
    /// # Errors
    /// See [`Cx::memory_reindex`].
    pub fn memory_reindex(&self, remove_orphans: bool) -> Result<ReindexReceipt, HostError> {
        self.cx.memory_reindex(&self.space, remove_orphans)
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use super::*;
    use crate::cx::CallContext;

    #[test]
    fn a_handle_without_grants_answers_not_granted_for_every_memory_method() {
        let cx = Cx::without_grants(CallContext {
            spaces: vec!["main".into()],
            ..CallContext::default()
        });
        let not_granted = |result: Result<(), HostError>| {
            assert!(
                matches!(result, Err(HostError::NotGranted(_))),
                "{result:?}"
            );
        };
        not_granted(cx.memory_history("main", "mem-x").map(drop));
        not_granted(cx.memory_head("main").map(drop));
        not_granted(cx.memory_key_file("main").map(drop));
        not_granted(cx.memory_usage("main", 0).map(drop));
        not_granted(cx.memory_counts("main", 0, 0).map(drop));
        not_granted(cx.memory_changes("main", 0, 10, None).map(drop));
        not_granted(
            cx.memory_forget("main", ForgetSelector::Session("s".into()))
                .map(drop),
        );
        not_granted(cx.memory_reindex("main", false).map(drop));
        not_granted(cx.memory_sweep("main", 10, Retention::default()).map(drop));
        // A space outside the call is refused before any grant is consulted.
        let outside = cx.memory_head("other").map(drop);
        assert!(matches!(outside, Err(HostError::NotGranted(m)) if m.contains("other")));
    }

    #[test]
    fn the_memory_errors_name_their_codes() {
        let shown = [
            HostError::QuotaExceeded {
                limit: umbel_store::memory::QuotaLimit::WritesPerHour,
                retry_after_ms: Some(5),
            },
            HostError::KeysMissing,
            HostError::KeysMismatch,
            HostError::KeyAbsent { id: "mem-a".into() },
            HostError::SealInvalid { id: "mem-a".into() },
        ]
        .map(|e| e.to_string());
        assert!(shown[0].starts_with("MEMORY_QUOTA_EXCEEDED") && shown[0].contains("5 ms"));
        assert!(shown[1].starts_with("MEMORY_KEYS_MISSING"));
        assert!(shown[2].starts_with("MEMORY_KEYS_MISMATCH"));
        assert!(shown[3].starts_with("MEMORY_KEY_ABSENT"));
        assert!(shown[4].starts_with("MEMORY_SEAL_INVALID"));
    }
}
