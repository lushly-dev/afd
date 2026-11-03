//! The memory grants of a call (phase 3 specification, section 6, D74): `memory` reads under the
//! caller's reader filter, and `memory_write` writes whose identity, authority, access, scan and
//! quota ceilings the host owns, with the ownership and authority rules of section 6.3.
//!
//! Compiled plugins are trusted code (D42), so this is API discipline, written into the host so
//! that a later world's components inherit it. Error codes the plugin answers with lead each
//! message (`MEMORY_SHARE_NOT_ALLOWED: ...`), as `STORE_WRITE_NOT_ALLOWED` does for the stores.

use std::sync::Arc;

use umbel_sdk::{HostError as ServiceError, LeftOutQuery, MemoryPath, MemoryWriteRequest};
use umbel_store::memory::{
    Confirm, DAY_MS, Forget, ForgetReceipt, Invalidate, KeyFileState, LeftOut, MemoryChange,
    MemoryCounts, MemoryList, MemoryPage, MemoryReceipt, MemoryUsage, MemoryVersionMeta, Quota,
    RecallPage, RecallQuery, ReindexReceipt, Retention, Sweep, SweepReceipt, format_instant,
};
use umbel_store::{
    AccessSet, AsOf, Authority, ForgetSelector, MemoryFlag, MemoryRecord, MemoryStore, MemoryWrite,
    Millis, ReadFlags, ReaderFilter, Rev, StoreError,
};

use super::grants::CallServices;
use crate::access::effective_principal_of;
use crate::authority::{Prompts, caller_is_person, write_authority};
use crate::store::host_error;
use crate::workspace::{DefaultAccess, MemoryWritePolicy};

type Result<T> = std::result::Result<T, ServiceError>;

/// The host's fixed ceilings, which no pack can pass (section 8.11).
pub(crate) const MAX_TTL_DAYS: i64 = 3650;
/// The most writes per hour a policy may allow.
pub(crate) const MAX_WRITES_PER_HOUR: u64 = 100_000;
/// The most bytes a principal may store.
pub(crate) const MAX_STORED_BYTES: u64 = 32 * 1024 * 1024 * 1024;

fn refused(code: &str, message: impl std::fmt::Display) -> ServiceError {
    ServiceError::NotGranted(format!("{code}: {message}"))
}

fn invalid(code: &str, message: impl std::fmt::Display) -> ServiceError {
    ServiceError::Invalid(format!("{code}: {message}"))
}

fn not_found(id: &str) -> ServiceError {
    ServiceError::NotFound(format!(
        "MEMORY_NOT_FOUND: no record `{id}` the caller can read"
    ))
}

/// The quota a plugin read from its pack, capped by the host's ceilings.
pub(crate) fn cap_quota(quota: Quota) -> Quota {
    Quota {
        writes_per_hour: quota.writes_per_hour.min(MAX_WRITES_PER_HOUR),
        stored_bytes: quota.stored_bytes.min(MAX_STORED_BYTES),
        ..quota
    }
}

/// The flags of an entry with the scan's findings over `subject`, `text`, `tags` and
/// `constraints` unioned in (section 6.2, rule 4), sorted and each once.
pub(crate) fn scanned_flags(entry: &MemoryWrite) -> Vec<MemoryFlag> {
    let mut flags = entry.flags.clone();
    let constraints = entry.envelope.constraints.iter().flatten();
    let texts = [entry.subject.as_str(), entry.text.as_str()]
        .into_iter()
        .chain(entry.tags.iter().map(String::as_str))
        .chain(constraints.map(String::as_str));
    for text in texts {
        let scan = umbel_scan::scan_content(text);
        if scan.is_instruction_like() {
            flags.push(MemoryFlag::InstructionLike);
        }
        if scan.has_hidden_text() {
            flags.push(MemoryFlag::HiddenText);
        }
    }
    flags.sort();
    flags.dedup();
    flags
}

/// What section 6.3 checks a record against.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Change {
    /// Invalidate or supersede: the owner, or a sharing writer who can read it.
    Replace,
    /// Forget by id: the store answers `notFound` for anything not the owner's; the host checks
    /// the authority first.
    Forget,
}

impl CallServices {
    fn prompts(&self) -> Prompts {
        self.shared.prompts.get().cloned().unwrap_or_default()
    }

    fn now(&self) -> Millis {
        self.context.clock().now()
    }

    fn trace(&self) -> Option<String> {
        self.context.trace_id.clone()
    }

    fn note_memory(&self, from: Rev, to: Rev, count: u64) {
        self.shared.ledger.note_memory(
            self.context.trace_id.as_deref().unwrap_or_default(),
            from,
            to,
            count,
        );
    }

    fn memory_store(&self, space: &str) -> Result<Arc<dyn MemoryStore>> {
        let store = self.shared.stores.memory(space).map_err(host_error)?;
        Ok(store as Arc<dyn MemoryStore>)
    }

    /// Grant `memory` on `space`: the store and the caller's filter. A read of the true head is
    /// never offered (section 6.1).
    fn memory_reading(&self, space: &str) -> Result<(Arc<dyn MemoryStore>, ReaderFilter)> {
        self.scoped("memory", space)?;
        let filter = self.filter(space)?;
        self.note_use();
        Ok((self.memory_store(space)?, filter))
    }

    /// Grant `memory_write` on `space`, under its `allow` list: the store, the caller's filter
    /// and effective principal. No effective principal is `MEMORY_PRINCIPAL_REQUIRED`.
    fn memory_writing(&self, space: &str) -> Result<(Arc<dyn MemoryStore>, ReaderFilter, String)> {
        self.allowed("memory_write", space, None)?;
        let principal = effective_principal_of(&self.context).ok_or_else(|| {
            invalid(
                "MEMORY_PRINCIPAL_REQUIRED",
                "a memory write needs a caller with an effective principal",
            )
        })?;
        let filter = self.filter(space)?;
        self.note_use();
        Ok((self.memory_store(space)?, filter, principal))
    }

    /// Whether the caller has authority `person` (section 3.3): the terminal check alone.
    fn person(&self) -> bool {
        caller_is_person(&self.context, self.command.as_deref(), &self.prompts())
    }

    fn policy(&self) -> MemoryWritePolicy {
        self.shared.memory_policy.clone().unwrap_or_default()
    }

    /// A sharing writer (section 3.2): authority `person`, or a token of the grant's `writers`
    /// held by a person, or by anyone when `agents_may_share`.
    fn sharing_writer(&self, filter: &ReaderFilter) -> bool {
        if self.person() {
            return true;
        }
        let policy = self.policy();
        let tokens = filter.token_list().unwrap_or_default();
        let listed = policy.writers.iter().any(|writer| tokens.contains(writer));
        let human = self
            .context
            .actor
            .as_ref()
            .is_some_and(|actor| actor.kind == afd::ActorKind::Human);
        listed && (human || policy.agents_may_share)
    }

    /// Section 3.2's access set for a write on `path` with the input `share`, whatever the
    /// plugin computed. A capture is private whatever it sent.
    fn access_for(
        &self,
        path: MemoryPath,
        share: Option<&str>,
        principal: &str,
        filter: &ReaderFilter,
    ) -> Result<AccessSet> {
        let private = format!("principal:{principal}");
        let token = match (path, share) {
            (MemoryPath::Capture, _) | (_, Some("private")) => private,
            (MemoryPath::Remember, None) => match self.policy().default_access {
                DefaultAccess::Private => private,
                DefaultAccess::Space => "space".to_owned(),
            },
            (_, None) => private,
            (_, Some("space")) => {
                if !self.sharing_writer(filter) {
                    return Err(refused(
                        "MEMORY_SHARE_NOT_ALLOWED",
                        "sharing a record with the space needs a sharing writer (section 3.2)",
                    ));
                }
                "space".to_owned()
            }
            (_, Some(group)) if group.starts_with("group:") => {
                let held = filter
                    .token_list()
                    .is_some_and(|tokens| tokens.iter().any(|t| t == group));
                if !self.sharing_writer(filter) || !held {
                    return Err(refused(
                        "MEMORY_SHARE_NOT_ALLOWED",
                        format!("sharing with `{group}` needs a sharing writer who holds it"),
                    ));
                }
                group.to_owned()
            }
            (_, Some(other)) => {
                return Err(invalid(
                    "MEMORY_INVALID",
                    format!("share `{other}` is not private, space or group:<g>"),
                ));
            }
        };
        AccessSet::new([token]).map_err(|error| invalid("MEMORY_INVALID", error))
    }

    /// Section 6.3 for one record: authority first, then ownership.
    fn may_change(
        &self,
        store: &dyn MemoryStore,
        filter: &ReaderFilter,
        id: &str,
        principal: &str,
        change: Change,
    ) -> Result<()> {
        let history = match store.history(id, filter) {
            Ok(history) => history,
            Err(StoreError::NotProvisioned) => Vec::new(),
            Err(error) => return Err(host_error(error)),
        };
        let Some(current) = history.iter().find(|v| v.recorded_until.is_none()) else {
            if change == Change::Forget {
                // The store counts it in `notFound`, like every record that is not the caller's.
                return Ok(());
            }
            return Err(not_found(id));
        };
        if current.authority() == Some(Authority::Person) && !self.person() {
            return Err(refused(
                "MEMORY_AUTHORITY_TOO_LOW",
                format!("`{id}` has authority person; only a person at a terminal may change it"),
            ));
        }
        if change == Change::Replace
            && current.scope.principal != principal
            && !self.sharing_writer(filter)
        {
            return Err(refused(
                "MEMORY_NOT_OWNED",
                format!("`{id}` is another principal's record"),
            ));
        }
        Ok(())
    }

    pub(super) fn svc_memory_get(
        &self,
        space: &str,
        id: &str,
        as_of: AsOf,
        flags: ReadFlags,
    ) -> Result<Option<MemoryRecord>> {
        let (store, filter) = self.memory_reading(space)?;
        store.get(id, as_of, flags, &filter).map_err(host_error)
    }

    pub(super) fn svc_memory_history(&self, space: &str, id: &str) -> Result<Vec<MemoryRecord>> {
        let (store, filter) = self.memory_reading(space)?;
        store.history(id, &filter).map_err(host_error)
    }

    pub(super) fn svc_memory_list(&self, space: &str, query: &MemoryList) -> Result<MemoryPage> {
        let (store, filter) = self.memory_reading(space)?;
        store.list(query, &filter).map_err(host_error)
    }

    pub(super) fn svc_memory_recall(&self, space: &str, query: &RecallQuery) -> Result<RecallPage> {
        let (store, filter) = self.memory_reading(space)?;
        store.recall(query, &filter).map_err(host_error)
    }

    pub(super) fn svc_memory_left_out(&self, space: &str, query: &LeftOutQuery) -> Result<LeftOut> {
        let (store, filter) = self.memory_reading(space)?;
        store
            .left_out(
                &query.scope,
                &query.classes,
                &query.push,
                query.as_of,
                query.now,
                &filter,
            )
            .map_err(host_error)
    }

    pub(super) fn svc_memory_changes(
        &self,
        space: &str,
        after: Rev,
        limit: u32,
        trace: Option<&str>,
    ) -> Result<Vec<MemoryChange>> {
        let (store, filter) = self.memory_reading(space)?;
        store
            .changes(after, limit, &filter, trace)
            .map_err(host_error)
    }

    pub(super) fn svc_memory_counts(
        &self,
        space: &str,
        now: Millis,
        expiring_within_ms: Millis,
    ) -> Result<MemoryCounts> {
        let (store, filter) = self.memory_reading(space)?;
        store
            .counts(now, expiring_within_ms, &filter)
            .map_err(host_error)
    }

    pub(super) fn svc_memory_usage(&self, space: &str, since: Millis) -> Result<MemoryUsage> {
        let (store, _filter) = self.memory_reading(space)?;
        let owner = effective_principal_of(&self.context).ok_or_else(|| {
            invalid(
                "MEMORY_PRINCIPAL_REQUIRED",
                "usage is the caller's own, and the caller has no effective principal",
            )
        })?;
        let agent = self.agent_actor().and_then(|actor| actor.id);
        store
            .usage(&owner, agent.as_deref(), since)
            .map_err(host_error)
    }

    /// The highest revision of a change the caller can read (F4's rule), never the true head.
    pub(super) fn svc_memory_head(&self, space: &str) -> Result<Rev> {
        let (store, filter) = self.memory_reading(space)?;
        let mut head = 0;
        loop {
            let page = store
                .changes(head, 1000, &filter, None)
                .map_err(host_error)?;
            let Some(last) = page.last() else {
                return Ok(head);
            };
            head = last.rev;
            if page.len() < 1000 {
                return Ok(head);
            }
        }
    }

    pub(super) fn svc_memory_key_file(&self, space: &str) -> Result<KeyFileState> {
        let (store, _filter) = self.memory_reading(space)?;
        store
            .key_status()
            .map(|status| status.file)
            .map_err(host_error)
    }

    pub(super) fn svc_memory_write(
        &self,
        space: &str,
        request: MemoryWriteRequest,
    ) -> Result<MemoryReceipt> {
        let (store, filter, principal) = self.memory_writing(space)?;
        let authority = write_authority(
            request.path,
            &self.context,
            self.command.as_deref(),
            &self.prompts(),
        );
        let access =
            self.access_for(request.path, request.share.as_deref(), &principal, &filter)?;
        let now = self.now();
        let agent = self.agent_actor();
        let mut batch = request.batch;
        batch.at = now;
        batch.quota = cap_quota(batch.quota);
        for entry in &mut batch.entries {
            let ceiling = now.saturating_add(MAX_TTL_DAYS * DAY_MS);
            let renew_over = entry
                .renew
                .is_some_and(|renew| renew.max_ttl_ms > MAX_TTL_DAYS * DAY_MS);
            if entry.expires_at > ceiling || renew_over {
                return Err(invalid(
                    "MEMORY_TTL_TOO_LONG",
                    format!("a memory record lives at most {MAX_TTL_DAYS} days"),
                ));
            }
            entry.scope.space = space.to_owned();
            entry.scope.principal = principal.clone();
            entry.scope.agent = agent.clone();
            entry.access = access.clone();
            entry.flags = scanned_flags(entry);
            let envelope = &mut entry.envelope;
            envelope.version = 2;
            envelope.space = space.to_owned();
            envelope.plugin = Some(self.shared.instance.clone());
            envelope.agent = agent.clone();
            envelope.principal = Some(principal.clone());
            envelope.trace_id = self.trace();
            envelope.observed_at = format_instant(now);
            envelope.authority = Some(authority.as_str().to_owned());
            envelope.confirmation = None;
            envelope.access = access.tokens().to_vec();
        }
        let targets: Vec<String> = batch
            .entries
            .iter()
            .flat_map(|entry| entry.supersedes.iter().cloned())
            .collect();
        for target in &targets {
            self.may_change(store.as_ref(), &filter, target, &principal, Change::Replace)?;
        }
        let receipt = store.write(batch).map_err(host_error)?;
        if !receipt.replayed
            && receipt.refused.is_none()
            && let (Some(from), Some(to)) = (receipt.from_rev, receipt.to_rev)
        {
            let count = (receipt.entries.len() + receipt.superseded.len()) as u64;
            self.note_memory(from, to, count);
        }
        Ok(receipt)
    }

    pub(super) fn svc_memory_invalidate(
        &self,
        space: &str,
        mut request: Invalidate,
    ) -> Result<MemoryVersionMeta> {
        let (store, filter, principal) = self.memory_writing(space)?;
        self.may_change(
            store.as_ref(),
            &filter,
            &request.id,
            &principal,
            Change::Replace,
        )?;
        request.at = self.now();
        request.by = principal;
        request.trace_id = self.trace();
        let meta = store.invalidate(request, &filter).map_err(host_error)?;
        self.note_memory(meta.rev, meta.rev, 1);
        Ok(meta)
    }

    pub(super) fn svc_memory_confirm(
        &self,
        space: &str,
        mut request: Confirm,
    ) -> Result<MemoryVersionMeta> {
        let (store, filter, principal) = self.memory_writing(space)?;
        if !self.person() {
            return Err(refused(
                "MEMORY_CONFIRM_NOT_ALLOWED",
                "only a person at a terminal confirms a record (sections 3.3 and 8.7)",
            ));
        }
        request.at = self.now();
        request.by = principal;
        request.trace_id = self.trace();
        let meta = store.confirm(request, &filter).map_err(host_error)?;
        self.note_memory(meta.rev, meta.rev, 1);
        Ok(meta)
    }

    pub(super) fn svc_memory_forget(
        &self,
        space: &str,
        selector: ForgetSelector,
    ) -> Result<ForgetReceipt> {
        let (store, filter, principal) = self.memory_writing(space)?;
        let person = self.person();
        match &selector {
            ForgetSelector::Ids(ids) if !person => {
                for id in ids {
                    self.may_change(store.as_ref(), &filter, id, &principal, Change::Forget)?;
                }
            }
            ForgetSelector::Ids(_) => {}
            _ if !person => {
                return Err(refused(
                    "MEMORY_FORGET_HUMAN_REQUIRED",
                    "a forget by session, project or time needs a person at a terminal; an agent forgets by ids",
                ));
            }
            _ => {}
        }
        let before = head_or_zero(store.as_ref())?;
        let receipt = store
            .forget(Forget {
                owner: principal,
                selector,
                at: self.now(),
                trace_id: self.trace(),
            })
            .map_err(host_error)?;
        if receipt.erased > 0 {
            let after = head_or_zero(store.as_ref())?;
            self.note_memory(before + 1, after.max(before + 1), receipt.erased);
        }
        Ok(receipt)
    }

    pub(super) fn svc_memory_sweep(
        &self,
        space: &str,
        limit: u32,
        retention: Retention,
    ) -> Result<SweepReceipt> {
        let (store, _filter, _principal) = self.memory_writing(space)?;
        let before = head_or_zero(store.as_ref())?;
        let receipt = store
            .sweep(Sweep {
                now: self.now(),
                limit,
                retention,
            })
            .map_err(host_error)?;
        if receipt.purged > 0 {
            let after = head_or_zero(store.as_ref())?;
            self.note_memory(before + 1, after.max(before + 1), receipt.purged);
        }
        Ok(receipt)
    }

    pub(super) fn svc_memory_reindex(
        &self,
        space: &str,
        remove_orphans: bool,
    ) -> Result<ReindexReceipt> {
        let (store, _filter, _principal) = self.memory_writing(space)?;
        store.reindex(remove_orphans).map_err(host_error)
    }
}

/// The store's head for the event's range, host-side only; 0 before the first write.
fn head_or_zero(store: &dyn MemoryStore) -> Result<Rev> {
    match store.head() {
        Ok(head) => Ok(head),
        Err(StoreError::NotProvisioned) => Ok(0),
        Err(error) => Err(host_error(error)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_ceilings_cap_a_pack_quota() {
        let capped = cap_quota(Quota::unlimited());
        assert_eq!(capped.writes_per_hour, MAX_WRITES_PER_HOUR);
        assert_eq!(capped.stored_bytes, MAX_STORED_BYTES);
        assert_eq!(capped.bytes_per_hour, u64::MAX);
        let low = Quota {
            writes_per_hour: 5,
            bytes_per_hour: 6,
            stored_records: 7,
            stored_bytes: 8,
        };
        assert_eq!(cap_quota(low), low);
    }
}
