//! A drafted proposal's memory sources, read from the memory store (phase 4 specification,
//! sections 3.2 and 8.2; D91, D102): through this instance's read-only `memory` grant (owner
//! decision 7), **only under the caller's reader filter** (owner decision 4), never a derivation
//! read. A batch reads each source once; approve reads them again under the approver's filter.
//!
//! The memory evidence entry the drafter wrote ([`Entry`]) and the record are compared field by
//! field here, and every refusal names its check, never the content:
//! `PROPOSAL_DRAFT_MISMATCH` with `details.check`. When the `memory` grant is withheld, nothing
//! can be verified, and a memory claim is `PROPOSAL_DRAFT_UNVERIFIABLE` (step 3b, amendment 1),
//! never accepted.

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::rc::Rc;

use serde::Deserialize;
use serde_json::{Value, json};
use umbel_sdk::{HostError, Outcome, failure};
use umbel_store::{AsOf, Authority, MemoryClass, MemoryRecord, ReadFlags, Sensitivity};

use super::common::Caller;
use crate::fail;

/// `PROPOSAL_DRAFT_UNVERIFIABLE`'s claim for memory evidence.
pub(crate) const CLAIM_MEMORY: &str = "memory-evidence";

/// `PROPOSAL_DRAFT_MISMATCH` (section 11.3): a drafter's claim that a check of section 3.2 ran
/// against and found false. `details.check` names the check, never the content; nothing is
/// stored.
pub(crate) fn mismatch(check: &str) -> Outcome {
    failure(
        "PROPOSAL_DRAFT_MISMATCH",
        &format!(
            "the drafter's claim does not match the memory store or the fixed rendering (check {check}), so the draft is not stored"
        ),
        "Run the drafter again: it renders from the memory records as they are now. A mismatch that repeats is a fault in the drafter.",
    )
    .with_error_details(json!({ "check": check }))
}

/// `PROPOSAL_DRAFT_MISMATCH` at approve (section 8.2): a copied field no longer equals the record.
pub(crate) fn mismatch_at_approve(check: &str) -> Outcome {
    failure(
        "PROPOSAL_DRAFT_MISMATCH",
        &format!(
            "a memory record this draft cites no longer matches what the draft copied from it (check {check}); nothing is applied"
        ),
        "Reject the proposal; the drafter's next run withdraws it and drafts again from the record as it is.",
    )
    .with_error_details(json!({ "check": check }))
}

/// `PROPOSAL_DRAFT_UNVERIFIABLE` (step 3b, amendment 1): a listed drafter's claim that this
/// instance cannot verify, so nothing labelled as verified is stored or applied.
/// `details.claim` names the claim, never the content.
pub(crate) fn unverifiable(claim: &str) -> Outcome {
    failure(
        "PROPOSAL_DRAFT_UNVERIFIABLE",
        "the drafter's claim cannot be verified against the memory store and the fixed rendering by this knowledge instance, so it is refused",
        "Memory claims need the knowledge plugin's read-only memory grant (not denied in umbel.toml); content is accepted only as the fixed rendering of memory records, on a create.",
    )
    .with_error_details(json!({ "claim": claim }))
}

/// `PROPOSAL_SOURCE_GONE` (section 8.2): a source unreadable, not live or not at its version.
pub(crate) fn gone() -> Outcome {
    failure(
        "PROPOSAL_SOURCE_GONE",
        "a memory record this draft cites is no longer readable, live and at the version it cites; nothing is applied",
        "Reject the proposal or leave it: the drafter's next run withdraws it and drafts again from what is still remembered.",
    )
}

/// The counts a memory evidence entry carries.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Observed {
    pub(crate) sessions: u64,
    pub(crate) principals: u64,
}

/// A memory evidence entry as section 2.1 shapes it: the fields a drafter copied from a record.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Entry {
    pub(crate) kind: String,
    #[serde(rename = "ref")]
    pub(crate) reference: String,
    pub(crate) principal: String,
    pub(crate) content_hash: String,
    pub(crate) class: String,
    pub(crate) authority: String,
    pub(crate) origin: String,
    pub(crate) constraints: Value,
    pub(crate) access: Value,
    pub(crate) sensitivity: String,
    pub(crate) confirmation: Value,
    pub(crate) observations: Observed,
    #[serde(default)]
    pub(crate) excerpt: Option<String>,
}

impl Entry {
    /// The entry `value`, with its record id and version, or `None` when it is not section 2.1's
    /// shape: `ref` is `mem-<24 hex>@<version>`, the version from 1 without leading zeros.
    pub(crate) fn parse(value: &Value) -> Option<(Self, String, u32)> {
        let entry: Self = serde_json::from_value(value.clone()).ok()?;
        if entry.kind != "memory" {
            return None;
        }
        let (id, version) = entry.reference.split_once('@')?;
        let hex = id.strip_prefix("mem-")?;
        let well_formed =
            hex.len() == 24 && hex.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'));
        let number: u32 = version.parse().ok()?;
        if !well_formed || number == 0 || number.to_string() != version {
            return None;
        }
        let id = id.to_owned();
        Some((entry, id, number))
    }

    /// The first copied field (section 3.2's "Copied fields" row) that is not exactly the record's,
    /// as its check name.
    pub(crate) fn copied_mismatch(&self, record: &MemoryRecord) -> Option<&'static str> {
        let value = |v: Result<Value, serde_json::Error>| v.unwrap_or(Value::Null);
        if self.principal != record.scope.principal {
            Some("copied-principal")
        } else if self.class != record.class.as_str() {
            Some("copied-class")
        } else if Some(self.authority.as_str()) != record.provenance.authority.as_deref() {
            Some("copied-authority")
        } else if Value::String(self.origin.clone())
            != value(serde_json::to_value(record.provenance.origin))
        {
            Some("copied-origin")
        } else if self.constraints != value(serde_json::to_value(&record.provenance.constraints)) {
            Some("copied-constraints")
        } else if self.access != json!(record.access.tokens()) {
            Some("copied-access")
        } else if Value::String(self.sensitivity.clone())
            != value(serde_json::to_value(record.sensitivity))
        {
            Some("copied-sensitivity")
        } else if self.confirmation != value(serde_json::to_value(&record.provenance.confirmation))
        {
            Some("copied-confirmation")
        } else {
            None
        }
    }

    /// The copied access set's tokens.
    pub(crate) fn access_tokens(&self) -> Vec<String> {
        self.access
            .as_array()
            .map(|tokens| {
                tokens
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default()
    }

    /// The copied sensitivity.
    pub(crate) fn sensitivity(&self) -> Option<Sensitivity> {
        serde_json::from_value(Value::String(self.sensitivity.clone())).ok()
    }
}

/// Why a record read at `now` is not a source a draft may cite (section 3.2's "Source exists"
/// row, beyond its absence): not live, flagged, a class that never settles, or an authority that
/// is not a memory authority that may settle (`transcript` never does, owner decision 9).
pub(crate) fn unusable(record: &MemoryRecord, now: i64) -> Option<&'static str> {
    let live = record.invalidation.is_none()
        && record.superseded_by.is_none()
        && record.recorded_at <= now
        && record.recorded_until.is_none_or(|end| end > now)
        && record.valid_from <= now
        && record.valid_until.is_none_or(|end| end > now)
        && record.expires_at > now;
    if !live {
        Some("source-not-live")
    } else if !record.flags.is_empty() {
        Some("source-flagged")
    } else if !matches!(
        record.class,
        MemoryClass::Semantic | MemoryClass::Procedural
    ) {
        Some("source-class")
    } else if !matches!(
        record.authority(),
        Some(Authority::Person | Authority::Agent | Authority::Tool | Authority::Import)
    ) {
        Some("source-authority")
    } else {
        None
    }
}

/// A sensitivity's rank: `public` < `internal` < `confidential` < `restricted`.
pub(crate) fn rank(sensitivity: Sensitivity) -> u8 {
    match sensitivity {
        Sensitivity::Public => 0,
        Sensitivity::Internal => 1,
        Sensitivity::Confidential => 2,
        Sensitivity::Restricted => 3,
    }
}

/// What a read of one source found.
#[derive(Clone)]
pub(crate) enum Read {
    /// No version the caller can read: absent, forgotten, purged or unreadable alike.
    Missing,
    /// Versions the caller can read, none of them current at `now`: invalidated or superseded.
    NotLive,
    /// The version current at `now`, flagged and expired ones included.
    Record(Rc<MemoryRecord>),
}

impl Read {
    /// Whether the store still holds a version of the record the caller can read.
    pub(crate) fn exists(&self) -> bool {
        !matches!(self, Self::Missing)
    }
}

/// Why a source could not be read at all.
pub(crate) enum Unread {
    /// The `memory` grant is withheld (or the space is unreadable): nothing can be verified.
    Withheld,
    /// The store failed.
    Failed(Outcome),
}

/// The memory sources of one call, each read once, under the caller's reader filter.
pub(crate) struct Sources<'c, 'a> {
    caller: &'c Caller<'a>,
    read: RefCell<BTreeMap<String, Read>>,
}

impl<'c, 'a> Sources<'c, 'a> {
    pub(crate) fn new(caller: &'c Caller<'a>) -> Self {
        Self {
            caller,
            read: RefCell::new(BTreeMap::new()),
        }
    }

    /// The record `id` at the caller's `now`, under the caller's reader filter.
    ///
    /// # Errors
    /// [`Unread::Withheld`] without the `memory` grant; [`Unread::Failed`] for a store failure.
    pub(crate) fn read(&self, id: &str) -> Result<Read, Unread> {
        if let Some(found) = self.read.borrow().get(id) {
            return Ok(found.clone());
        }
        let found = self.fetch(id)?;
        self.read.borrow_mut().insert(id.to_owned(), found.clone());
        Ok(found)
    }

    fn fetch(&self, id: &str) -> Result<Read, Unread> {
        let caller = self.caller;
        let flags = ReadFlags {
            include_flagged: true,
            include_expired: true,
            now: caller.now_ms,
        };
        let unread = |error: HostError| match error {
            HostError::NotGranted(_) => Err(Unread::Withheld),
            HostError::NotProvisioned | HostError::NotFound(_) => Ok(Read::Missing),
            other => Err(Unread::Failed(fail::host(&other))),
        };
        match caller
            .cx
            .memory_get(&caller.space, id, AsOf::at(caller.now_ms), flags)
        {
            Ok(Some(record)) => return Ok(Read::Record(Rc::new(record))),
            Ok(None) => {}
            Err(error) => return unread(error),
        }
        match caller.cx.memory_history(&caller.space, id) {
            Ok(versions) if versions.is_empty() => Ok(Read::Missing),
            Ok(_) => Ok(Read::NotLive),
            Err(error) => unread(error),
        }
    }
}
