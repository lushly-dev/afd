//! The memory grants of a call (phase 3 specification, section 6, D74): `memory` reads under the
//! caller's reader filter, and `memory_write` writes whose identity, authority, access, scan and
//! quota ceilings the host owns, with the ownership and authority rules of section 6.3.
//!
//! Compiled plugins are trusted code (D42), so this is API discipline, written into the host so
//! that a later world's components inherit it. Error codes the plugin answers with lead each
//! message (`MEMORY_SHARE_NOT_ALLOWED: ...`), as `STORE_WRITE_NOT_ALLOWED` does for the stores.

use std::sync::Arc;

use umbel_sdk::{
    EraseAnswer, EraseCall, ErasePreview, HostError as ServiceError, LeftOutQuery, MemoryPath,
    MemoryWriteRequest,
};
use umbel_store::memory::{
    Confirm, DAY_MS, Erase, EraseOutcome, EraseRequest, Forget, ForgetReceipt, Invalidate,
    KeyFileState, LeftOut, MemoryChange, MemoryCounts, MemoryList, MemoryPage, MemoryReceipt,
    MemoryUsage, MemoryVersionMeta, Quota, RecallPage, RecallQuery, ReindexReceipt, Retention,
    Sweep, SweepReceipt, check_erase_ids, check_principal, erase_plan, format_instant,
    is_erase_plan, is_erase_request_id,
};
use umbel_store::{
    AccessSet, AsOf, Authority, ForgetSelector, MemoryFlag, MemoryRecord, MemoryStore, MemoryWrite,
    Millis, Origin, ReadFlags, ReaderFilter, Rev, StoreError,
};

use super::grants::CallServices;
use crate::access::effective_principal_of;
use crate::authority::{Prompts, write_authority};
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

/// The command `memory-erase` (phase 5 section 8.4): only a person decision for it erases.
pub(crate) const ERASE_COMMAND: &str = "memory-erase";

/// How the caller of one call is a person (phase 5 sections 7.1, 8.1 and 8.3, and step 10's
/// settlement for the library).
#[derive(Debug, Clone, PartialEq, Eq)]
enum Proof {
    /// The CLI's terminal check covering this command (D71, D86): not an attestation.
    Terminal,
    /// A decision on the person page for this very call, as the host attests it.
    Verified(umbel_sdk::PersonDecision),
    /// An embedding application's human through the library: its own word, which Umbel did not
    /// check. Counts only for the operator's person (step 10).
    Embedder,
}

/// What section 6.3 checks a record against.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Change {
    /// Invalidate or supersede: the owner (with equivalents), or a person holding an `editors`
    /// token (phase 5 section 8.3, owner decision 10).
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

    fn policy(&self) -> MemoryWritePolicy {
        self.shared.memory_policy.clone().unwrap_or_default()
    }

    /// How this call's caller is a person, if it is: a decision on the person page for this very
    /// call first, then the CLI's terminal check, then the library's word.
    fn proof(&self) -> Option<Proof> {
        if let Some(decided) = &self.verified {
            return Some(Proof::Verified(decided.clone()));
        }
        if crate::authority::terminal_person(
            &self.context,
            self.command.as_deref(),
            &self.prompts(),
        ) {
            return Some(Proof::Terminal);
        }
        crate::authority::embedder_human(&self.context).then_some(Proof::Embedder)
    }

    /// Whether `principal` is the operator's person (`human:<principal.local_id>`, or a legacy
    /// principal that maps to it).
    fn is_operators_person(&self, principal: &str) -> bool {
        let config = self.shared.workspace.config();
        let operator = format!("human:{}", config.principal.local_id);
        crate::access::identities(config, Some(&operator))
            .iter()
            .any(|identity| identity == principal)
    }

    /// The person `principal` is proven to be for a confirmation or a change of another's record
    /// (step 10): a decision for this call, the CLI's terminal check, or the library's word only
    /// for the operator's person, since an embedder's person is otherwise unchecked.
    fn person_as(&self, principal: &str) -> Option<Proof> {
        match self.proof()? {
            Proof::Embedder if !self.is_operators_person(principal) => None,
            proof => Some(proof),
        }
    }

    /// The legacy principals `principal` stands for (phase 5 section 4.6), without itself.
    fn equivalents_of(&self, principal: &str) -> Vec<String> {
        crate::access::identities(self.shared.workspace.config(), Some(principal))
            .into_iter()
            .filter(|identity| identity != principal)
            .collect()
    }

    /// `principal`'s person: the namespaced principal a legacy one maps to, else itself, so two
    /// principals are one person exactly when these are equal (section 4.6, one way).
    fn person_of(&self, principal: &str) -> String {
        self.shared
            .workspace
            .config()
            .principal
            .equivalents
            .get(principal)
            .cloned()
            .unwrap_or_else(|| principal.to_owned())
    }

    /// Whether `principal` holds a token of `role` (`editors` or `erasers`, phase 5 sections 8.3
    /// and 8.4): a `principal:` entry naming it or a legacy principal it stands for, or a
    /// `group:` it is a named member of (with equivalents) or holds by its own token's claims. A
    /// group's `*` names no one here: these roles change and erase other people's records, so
    /// every holder is named.
    fn holds_role(&self, role: &[String], principal: &str) -> bool {
        let config = self.shared.workspace.config();
        let identities = crate::access::identities(config, Some(principal));
        let claimed = crate::access::claim_groups_of(&self.context);
        role.iter().any(|token| {
            if let Some(named) = token.strip_prefix("principal:") {
                return identities.iter().any(|identity| identity == named);
            }
            let Some(group) = token.strip_prefix("group:") else {
                return false;
            };
            claimed.iter().any(|held| held == group)
                || config
                    .access
                    .groups
                    .iter()
                    .find(|declared| declared.id == group)
                    .is_some_and(|declared| {
                        declared
                            .members
                            .iter()
                            .any(|member| identities.contains(member))
                    })
        })
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

    /// Section 6.3 for one record: authority first, then ownership. Returns the current version
    /// the caller can read, `None` for a forget of a record it cannot.
    fn may_change(
        &self,
        store: &dyn MemoryStore,
        filter: &ReaderFilter,
        id: &str,
        principal: &str,
        change: Change,
    ) -> Result<Option<MemoryRecord>> {
        let history = match store.history(id, filter) {
            Ok(history) => history,
            Err(StoreError::NotProvisioned) => Vec::new(),
            Err(error) => return Err(host_error(error)),
        };
        let Some(current) = history.into_iter().find(|v| v.recorded_until.is_none()) else {
            if change == Change::Forget {
                // The store counts it in `notFound`, like every record that is not the caller's.
                return Ok(None);
            }
            return Err(not_found(id));
        };
        if current.authority() == Some(Authority::Person)
            && !self.person()
            && self.verified.is_none()
        {
            return Err(refused(
                "MEMORY_AUTHORITY_TOO_LOW",
                format!("`{id}` has authority person; only a person at a terminal may change it"),
            ));
        }
        // The caller owns its own records and those of the legacy principals it stands for
        // (phase 5 section 4.6). Another principal's record changes only for a person holding an
        // `editors` token (section 8.3, owner decision 10): whatever `agents_may_share` says, never
        // an agent, and over MCP only with a decision on the person page for this call; a sharing
        // writer no longer may.
        if change == Change::Replace
            && !crate::access::identities(self.shared.workspace.config(), Some(principal))
                .contains(&current.scope.principal)
            && !(self.person_as(principal).is_some()
                && self.holds_role(&self.policy().editors, principal))
        {
            return Err(refused(
                "MEMORY_NOT_OWNED",
                format!("`{id}` is another principal's record"),
            ));
        }
        Ok(Some(current))
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
        // The writing principal's chain (envelope version 3, phase 5 section 2.4), from the
        // principal the host set; empty without a token or assertion.
        let chain = crate::principal::Principal::chain_of(&self.context);
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
            // Section 8.2 (step 5, amendment 1): only a `person` observation renews an expiry,
            // and `origin` defaults by the authority, which only the host knows.
            if authority != Authority::Person {
                entry.renew = None;
            }
            let envelope = &mut entry.envelope;
            if envelope.origin == Origin::Unspecified {
                envelope.origin = if authority == Authority::Person {
                    Origin::UserStated
                } else {
                    Origin::AgentInferred
                };
            }
            envelope.version = umbel_store::MEMORY_ENVELOPE_VERSION;
            envelope.delegation_chain = Some(chain.clone());
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
        for entry in &batch.entries {
            for target in &entry.supersedes {
                let current =
                    self.may_change(store.as_ref(), &filter, target, &principal, Change::Replace)?;
                // Section 8.2 (step 5, amendment 2): a supersede keeps the project and the
                // access set, so it cannot quietly widen who sees the replacement.
                if let Some(current) = current
                    && (current.scope.project != entry.scope.project || current.access != access)
                {
                    return Err(invalid(
                        "MEMORY_SCOPE_MISMATCH",
                        format!(
                            "`{target}` is in another project or has another access set than the record replacing it"
                        ),
                    ));
                }
            }
        }
        let receipt = store.write(batch).map_err(host_error)?;
        if !receipt.replayed
            && receipt.refused.is_none()
            && let (Some(from), Some(to)) = (receipt.from_rev, receipt.to_rev)
        {
            let count = (receipt.entries.len() + receipt.superseded.len()) as u64;
            self.note_memory(from, to, count);
            self.shared.ledger.note_authority(
                self.context.trace_id.as_deref().unwrap_or_default(),
                authority.as_str(),
            );
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
        // How the person was proven (envelope version 3, phase 5 sections 2.4 and 7.1): a decision
        // on the person page for this very call; the terminal check at the CLI; or, through the
        // library, the embedding application's own word, recorded as `embedder` and admitted only
        // for the operator's person (step 10's settlement). Nothing else confirms.
        let assurance = match self.person_as(&principal) {
            Some(Proof::Verified(decided)) => umbel_store::Assurance::verified(
                &decided.namespace,
                &decided.auth_time,
                &decided.acr,
            ),
            Some(Proof::Terminal) => umbel_store::Assurance::terminal(),
            Some(Proof::Embedder) => umbel_store::Assurance::embedder(),
            None => {
                return Err(refused(
                    "MEMORY_CONFIRM_NOT_ALLOWED",
                    "only a person confirms a record: at a terminal, on the person page, or the operator's person through the library (sections 3.3 and 8.7)",
                ));
            }
        };
        request.at = self.now();
        request.equivalents = self.equivalents_of(&principal);
        request.by = principal;
        request.trace_id = self.trace();
        request.assurance = Some(assurance);
        let meta = store.confirm(request, &filter).map_err(host_error)?;
        self.note_memory(meta.rev, meta.rev, 1);
        // The event carries the confirmation the host performed and the authority it gave.
        let trace = self.context.trace_id.clone().unwrap_or_default();
        self.shared
            .ledger
            .note_authority(&trace, Authority::Person.as_str());
        let confirmed = store
            .history(&meta.id, &filter)
            .ok()
            .and_then(|history| history.into_iter().last())
            .and_then(|record| record.provenance.confirmation)
            .and_then(|confirmation| serde_json::to_value(confirmation).ok());
        if let Some(confirmation) = confirmed {
            self.shared.ledger.note_confirmation(&trace, confirmation);
        }
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
                equivalents: self.equivalents_of(&principal),
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

    /// `MEMORY_ERASE_NOT_ALLOWED` unless `principal` holds an `erasers` token (section 8.4).
    fn check_eraser(&self, principal: &str) -> Result<()> {
        if self.holds_role(&self.policy().erasers, principal) {
            Ok(())
        } else {
            Err(refused(
                "MEMORY_ERASE_NOT_ALLOWED",
                "only a person the deployer lists under the memory_write grant's erasers erases",
            ))
        }
    }

    /// The target principal, the principals it stands for (its records are the target's), and
    /// the ids, each checked (section 8.4).
    fn erase_scope(&self, call: &EraseCall) -> Result<(Vec<String>, Option<Vec<String>>)> {
        check_principal("principal", &call.principal)
            .map_err(|_| invalid("MEMORY_INVALID", "principal must be <kind>:<id>"))?;
        crate::workspace::parse_principal(&call.principal)
            .map_err(|_| invalid("MEMORY_INVALID", "principal is not a principal string"))?;
        if let Some(ids) = &call.ids {
            check_erase_ids(ids).map_err(|error| invalid("MEMORY_INVALID", error))?;
        }
        if call
            .plan
            .as_deref()
            .is_some_and(|plan| !is_erase_plan(plan))
        {
            return Err(invalid(
                "MEMORY_INVALID",
                "plan is the value the dry run gave: sha256: and 64 hex digits",
            ));
        }
        if call
            .request
            .as_deref()
            .is_some_and(|id| !is_erase_request_id(id))
        {
            return Err(invalid(
                "MEMORY_INVALID",
                "request is the id the first eraser's answer gave: x- and 20 hex digits",
            ));
        }
        if call.dry_run && (call.plan.is_some() || call.request.is_some()) {
            return Err(invalid(
                "MEMORY_INVALID",
                "a dry run takes no plan and no request",
            ));
        }
        if !call.dry_run && call.plan.is_none() {
            return Err(invalid(
                "MEMORY_INVALID",
                "an erase presents the plan its dry run gave",
            ));
        }
        let owners =
            crate::access::identities(self.shared.workspace.config(), Some(&call.principal));
        Ok((owners, call.ids.clone()))
    }

    /// `MEMORY_ERASE_PLAN_STALE` (section 10.5).
    fn plan_stale() -> ServiceError {
        invalid(
            "MEMORY_ERASE_PLAN_STALE",
            "the target's records changed since the dry run, or since the erase request",
        )
    }

    /// `MEMORY_ERASE_REQUEST_EXPIRED` (section 10.5): the request ran, expired, was voided, never
    /// existed, or is for another target, alike.
    fn request_expired() -> ServiceError {
        invalid(
            "MEMORY_ERASE_REQUEST_EXPIRED",
            "no erase request with that id is pending for this principal",
        )
    }

    /// `MEMORY_ERASE_SECOND_ERASER_REQUIRED` (section 10.5).
    fn second_eraser_required() -> ServiceError {
        invalid(
            "MEMORY_ERASE_SECOND_ERASER_REQUIRED",
            "the erase request is yours: a second eraser, another person, approves it",
        )
    }

    /// The target's records an erase reaches now: none before the store's first write.
    fn erase_targets_now(
        store: &dyn MemoryStore,
        owners: &[String],
        ids: Option<&[String]>,
    ) -> Result<Vec<umbel_store::memory::EraseTarget>> {
        match store.erase_targets(owners, ids) {
            Ok(targets) => Ok(targets),
            Err(StoreError::NotProvisioned) => Ok(Vec::new()),
            Err(error) => Err(host_error(error)),
        }
    }

    /// The request `call` names, read back: `None` when it names none, `Some(None)` when it is not
    /// pending (it ran, expired, was voided or never existed).
    fn named_request(
        &self,
        store: &dyn MemoryStore,
        call: &EraseCall,
    ) -> Result<Option<Option<EraseRequest>>> {
        let Some(id) = &call.request else {
            return Ok(None);
        };
        match store.erase_request(id, self.now()) {
            Ok(found) => Ok(Some(found)),
            Err(StoreError::NotProvisioned) => Ok(Some(None)),
            Err(error) => Err(host_error(error)),
        }
    }

    /// [`erase_step`]'s refusal as the plugin answers it, voiding a stale request when told to.
    fn erase_refusal(
        &self,
        store: &dyn MemoryStore,
        call: &EraseCall,
        refusal: Refusal,
    ) -> ServiceError {
        match refusal {
            Refusal::Expired => Self::request_expired(),
            Refusal::SecondEraser => Self::second_eraser_required(),
            Refusal::Stale { void } => {
                if void && let Some(id) = &call.request {
                    let _ = store.erase_request_void(id);
                }
                Self::plan_stale()
            }
        }
    }

    /// `memory-erase` (phase 5 section 8.4, owner decision 9): a verified eraser, the target's
    /// records by owner whatever their access set (D85's "blind"), a dry-run plan the erase must
    /// present, and the two-person rule; counts only.
    pub(super) fn svc_memory_erase(&self, space: &str, call: EraseCall) -> Result<EraseAnswer> {
        let (store, _filter, principal) = self.memory_writing(space)?;
        // The caller is verified for this very call, on the person page (7.2): no terminal check,
        // no library word and no form answer erases (owner decision 9).
        if self.command.as_deref() != Some(ERASE_COMMAND) || self.verified.is_none() {
            return Err(refused(
                "MEMORY_ERASE_NOT_ALLOWED",
                "memory-erase needs a person verified on the person page for this call",
            ));
        }
        self.check_eraser(&principal)?;
        let (owners, ids) = self.erase_scope(&call)?;
        let now = self.now();
        let current = Self::erase_targets_now(store.as_ref(), &owners, ids.as_deref())?;
        let current_plan = erase_plan(&current);
        if call.dry_run {
            return Ok(EraseAnswer::Planned {
                count: current.len() as u64,
                plan: current_plan,
            });
        }
        let plan = call.plan.clone().unwrap_or_default();
        let policy = self.policy();
        let named = self.named_request(store.as_ref(), &call)?;
        let step = erase_step(
            named.as_ref().map(Option::as_ref),
            &call.principal,
            &principal,
            &plan,
            &current_plan,
            policy.erase_approvals,
            &|a, b| self.person_of(a) == self.person_of(b),
        )
        .map_err(|refusal| self.erase_refusal(store.as_ref(), &call, refusal))?;
        let first = match step {
            Step::Request => {
                // The first of two erasers: nothing is erased; a request waits for a second.
                let request = new_request_id().ok_or_else(|| {
                    ServiceError::Io("no random bits for an erase request's id".to_owned())
                })?;
                let window = i64::try_from(policy.erase_approval_window_s)
                    .unwrap_or(i64::MAX)
                    .saturating_mul(1000);
                let expires_at = now.saturating_add(window);
                store
                    .erase_request_create(
                        EraseRequest {
                            id: request.clone(),
                            target: call.principal.clone(),
                            plan,
                            first: principal,
                            at: now,
                            expires_at,
                        },
                        now,
                    )
                    .map_err(host_error)?;
                return Ok(EraseAnswer::Awaiting {
                    request,
                    expires_at,
                });
            }
            Step::Erase { first } => first,
        };
        let before = head_or_zero(store.as_ref())?;
        // The store checks the plan again, and takes the request, in the erase's own first
        // transaction: a write or another approval between here and there erases nothing.
        let outcome = store
            .erase(Erase {
                owners,
                ids,
                plan: plan.clone(),
                request: call.request.clone(),
                at: now,
                trace_id: self.trace(),
            })
            .map_err(host_error)?;
        let receipt = match outcome {
            EraseOutcome::Erased(receipt) => receipt,
            EraseOutcome::PlanStale => return Err(Self::plan_stale()),
            EraseOutcome::RequestGone => return Err(Self::request_expired()),
        };
        let erasers: Vec<String> = first.into_iter().chain([principal]).collect();
        if receipt.erased > 0 {
            let after = head_or_zero(store.as_ref())?;
            self.note_memory(before + 1, after.max(before + 1), receipt.erased);
            // The erased principal's notice (section 8.4): every eraser who acted, the count, the
            // request and the plan, host-owned on the event, which the plugin sends to the erased
            // principal's own stream.
            self.shared.ledger.note_erasure(
                self.context.trace_id.as_deref().unwrap_or_default(),
                serde_json::json!({
                    "erasers": erasers,
                    "count": receipt.erased,
                    "request": call.request,
                    "plan": plan,
                }),
            );
        }
        Ok(EraseAnswer::Erased {
            erased: receipt.erased,
            wal: receipt.wal,
            erasers,
            request: call.request,
        })
    }

    /// What `memory-erase-preview` may show (section 8.4). Run as the host's check before a
    /// decision for `memory-erase` is begun (`CallContext::person_check`), it first makes every
    /// check the erase makes but the decision itself (the eraser, the call's shape, [`erase_step`]),
    /// voiding a request whose plan no longer holds, so no person is asked about an erase that
    /// cannot run. On the page and at the command line it applies [`erase_step`] too, and reads,
    /// blind, only what the plan presented already names: the count while the plan still holds,
    /// and a pending request's first eraser and expiry.
    pub(super) fn svc_memory_erase_preview(
        &self,
        space: &str,
        call: EraseCall,
    ) -> Result<ErasePreview> {
        let (store, _filter, principal) = self.memory_writing(space)?;
        let checking = self
            .person_check()
            .is_some_and(|check| check.command == ERASE_COMMAND);
        if checking {
            self.check_eraser(&principal)?;
        }
        let (owners, ids) = self.erase_scope(&call)?;
        let approvals = self.policy().erase_approvals;
        if call.dry_run {
            return Ok(ErasePreview {
                count: None,
                request: None,
                approvals,
            });
        }
        let plan = call.plan.clone().unwrap_or_default();
        let current = Self::erase_targets_now(store.as_ref(), &owners, ids.as_deref())?;
        let named = self.named_request(store.as_ref(), &call)?;
        erase_step(
            named.as_ref().map(Option::as_ref),
            &call.principal,
            &principal,
            &plan,
            &erase_plan(&current),
            approvals,
            &|a, b| self.person_of(a) == self.person_of(b),
        )
        .map_err(|refusal| match refusal {
            // Only the host's own check of a listed eraser's call voids a request.
            Refusal::Stale { .. } if !checking => Self::plan_stale(),
            refusal => self.erase_refusal(store.as_ref(), &call, refusal),
        })?;
        Ok(ErasePreview {
            count: Some(current.len() as u64),
            request: named
                .flatten()
                .map(|pending| (pending.first, pending.expires_at)),
            approvals,
        })
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

/// Why [`erase_step`] refuses (section 10.5's codes).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Refusal {
    /// `MEMORY_ERASE_REQUEST_EXPIRED`: the request named is not pending for this target.
    Expired,
    /// `MEMORY_ERASE_SECOND_ERASER_REQUIRED`: the approving eraser is the requesting person.
    SecondEraser,
    /// `MEMORY_ERASE_PLAN_STALE`; `void` when a request named is voided with it.
    Stale {
        /// Whether the request named is voided.
        void: bool,
    },
}

/// What an erase (not a dry run) does next.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Step {
    /// Record an erase request and erase nothing: the first of two erasers.
    Request,
    /// Erase, approved by `first` (a request's first eraser) and the caller.
    Erase {
        /// The first eraser of the request approved, if one was.
        first: Option<String>,
    },
}

/// The two-person rule and the plan for an erase presenting `plan` as the eraser `principal`
/// (section 8.4, owner decision 9's strengthening), apart from the stores so every rule is held by
/// a test of its own. `named` is the request the call names, read back (`None`: it names none;
/// `Some(None)`: not pending). A named request must be pending for this `target`, by another
/// person (`same_person`, through equivalents), for this plan, which the records must still
/// have, else it is voided; without one, the plan must hold, and with `approvals` of 2 the call
/// only records a request.
pub(crate) fn erase_step(
    named: Option<Option<&EraseRequest>>,
    target: &str,
    principal: &str,
    plan: &str,
    current: &str,
    approvals: u64,
    same_person: &dyn Fn(&str, &str) -> bool,
) -> std::result::Result<Step, Refusal> {
    match named {
        Some(None) => Err(Refusal::Expired),
        Some(Some(pending)) if pending.target != target => Err(Refusal::Expired),
        Some(Some(pending)) if same_person(&pending.first, principal) => Err(Refusal::SecondEraser),
        Some(Some(pending)) if pending.plan != plan || current != plan => {
            Err(Refusal::Stale { void: true })
        }
        Some(Some(pending)) => Ok(Step::Erase {
            first: Some(pending.first.clone()),
        }),
        None if current != plan => Err(Refusal::Stale { void: false }),
        None if approvals >= 2 => Ok(Step::Request),
        None => Ok(Step::Erase { first: None }),
    }
}

/// An erase request's id: `x-` and 20 lowercase hex digits, 80 bits from the operating system.
fn new_request_id() -> Option<String> {
    let mut bits = [0_u8; 10];
    getrandom::fill(&mut bits).ok()?;
    Some(format!(
        "x-{}",
        bits.iter().map(|b| format!("{b:02x}")).collect::<String>()
    ))
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
    #![allow(clippy::unwrap_used)]
    use super::*;

    fn request(first: &str, plan: &str) -> EraseRequest {
        EraseRequest {
            id: "x-0123456789abcdef0123".to_owned(),
            target: "human:corp/bo".to_owned(),
            plan: plan.to_owned(),
            first: first.to_owned(),
            at: 0,
            expires_at: 600_000,
        }
    }

    /// One person when the legacy `human:ada` maps to `human:corp/ada`, as `[principal.equivalents]`
    /// says.
    fn same(a: &str, b: &str) -> bool {
        let person = |p: &str| {
            if p == "human:ada" {
                "human:corp/ada"
            } else {
                p
            }
            .to_owned()
        };
        person(a) == person(b)
    }

    #[test]
    fn one_eraser_erases_when_the_plan_holds_and_two_record_a_request_first() {
        let step = |approvals| {
            erase_step(
                None,
                "human:corp/bo",
                "human:corp/ada",
                "P",
                "P",
                approvals,
                &same,
            )
        };
        assert_eq!(step(1), Ok(Step::Erase { first: None }));
        assert_eq!(step(2), Ok(Step::Request));
        // A plan the records no longer have erases nothing and records nothing.
        let stale = erase_step(None, "human:corp/bo", "human:corp/ada", "P", "Q", 2, &same);
        assert_eq!(stale, Err(Refusal::Stale { void: false }));
    }

    #[test]
    fn a_second_eraser_must_be_another_person_with_the_same_plan_for_the_same_target() {
        let pending = request("human:corp/ada", "P");
        let second = |principal: &str, plan: &str, current: &str, target: &str| {
            erase_step(
                Some(Some(&pending)),
                target,
                principal,
                plan,
                current,
                2,
                &same,
            )
        };
        assert_eq!(
            second("human:corp/cy", "P", "P", "human:corp/bo"),
            Ok(Step::Erase {
                first: Some("human:corp/ada".to_owned())
            })
        );
        // The same person, as any client of theirs or through a legacy equivalent.
        assert_eq!(
            second("human:corp/ada", "P", "P", "human:corp/bo"),
            Err(Refusal::SecondEraser)
        );
        assert_eq!(
            second("human:ada", "P", "P", "human:corp/bo"),
            Err(Refusal::SecondEraser)
        );
        // Another plan, or records that changed, void the request.
        assert_eq!(
            second("human:corp/cy", "Q", "Q", "human:corp/bo"),
            Err(Refusal::Stale { void: true })
        );
        assert_eq!(
            second("human:corp/cy", "P", "Q", "human:corp/bo"),
            Err(Refusal::Stale { void: true })
        );
        // A request for another target is not this one; one not pending has expired.
        assert_eq!(
            second("human:corp/cy", "P", "P", "human:corp/dee"),
            Err(Refusal::Expired)
        );
        assert_eq!(
            erase_step(
                Some(None),
                "human:corp/bo",
                "human:corp/cy",
                "P",
                "P",
                2,
                &same
            ),
            Err(Refusal::Expired)
        );
        // Whatever erase_approvals says now, a request named is approved as a second eraser.
        assert_eq!(
            erase_step(
                Some(Some(&pending)),
                "human:corp/bo",
                "human:corp/cy",
                "P",
                "P",
                1,
                &same
            ),
            Ok(Step::Erase {
                first: Some("human:corp/ada".to_owned())
            })
        );
    }

    #[test]
    fn request_ids_are_eighty_random_bits() {
        let a = new_request_id().unwrap();
        let b = new_request_id().unwrap();
        assert!(umbel_store::memory::is_erase_request_id(&a), "{a}");
        assert_ne!(a, b);
    }

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
