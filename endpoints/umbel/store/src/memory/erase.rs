//! `memory-erase`'s store side (phase 5 specification, section 8.4; D85, D118): the target's
//! records selected by owner whatever their access set ([`super::MemoryStore::erase_targets`]),
//! the plan that names them, the erase itself on phase 3's forget path, and the two-person rule's
//! erase requests.
//!
//! **Blind.** No reader filter applies: the host selects the target principal (and the legacy
//! principals it stands for, section 4.6) and the store answers ids and versions only, never a
//! record's text, labels or access. Only the host's memory services call these methods, after
//! checking a verified eraser.

use sha2::{Digest, Sha256};

use super::{ForgetReceipt, MAX_FORGET_IDS, Millis, check_memory_id, check_principal};
use crate::error::{Result, StoreError};

/// Most principals an erase selects by: the target and the legacy principals it stands for.
pub const MAX_ERASE_OWNERS: usize = 64;

/// One record an erase would reach: its id and its current version.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct EraseTarget {
    /// The record.
    pub id: String,
    /// Its current (highest) version.
    pub record_version: u32,
}

/// The plan of `targets` (section 8.4): `sha256:` and the hex SHA-256 of the sorted
/// `<id>:<version>` lines, each ended by a newline. The empty set has a plan too, so an erase of
/// nothing is still bound to what the dry run saw.
#[must_use]
pub fn erase_plan(targets: &[EraseTarget]) -> String {
    let mut sorted: Vec<&EraseTarget> = targets.iter().collect();
    sorted.sort();
    let mut digest = Sha256::new();
    for target in sorted {
        digest.update(target.id.as_bytes());
        digest.update(b":");
        digest.update(target.record_version.to_string().as_bytes());
        digest.update(b"\n");
    }
    let hex: String = digest
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    format!("sha256:{hex}")
}

/// Whether `plan` has a plan's shape: `sha256:` and 64 lowercase hex digits.
#[must_use]
pub fn is_erase_plan(plan: &str) -> bool {
    plan.strip_prefix("sha256:").is_some_and(|hex| {
        hex.len() == 64 && hex.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
    })
}

/// Whether `id` is an erase request's id: `x-` and 20 lowercase hex digits (80 random bits).
#[must_use]
pub fn is_erase_request_id(id: &str) -> bool {
    id.strip_prefix("x-").is_some_and(|hex| {
        hex.len() == 20 && hex.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
    })
}

/// Check the owners an erase selects by: 1 to [`MAX_ERASE_OWNERS`] principal strings.
///
/// # Errors
/// [`StoreError::Invalid`].
pub fn check_erase_owners(owners: &[String]) -> Result<()> {
    if owners.is_empty() || owners.len() > MAX_ERASE_OWNERS {
        return Err(StoreError::invalid(
            "an erase selects by 1 to 64 principals: the target and its legacy principals",
        ));
    }
    owners
        .iter()
        .try_for_each(|owner| check_principal("an erase's principal", owner))
}

/// Check an erase's ids: 1 to [`MAX_FORGET_IDS`] memory ids, each once.
///
/// # Errors
/// [`StoreError::Invalid`].
pub fn check_erase_ids(ids: &[String]) -> Result<()> {
    if ids.is_empty() || ids.len() > MAX_FORGET_IDS {
        return Err(StoreError::invalid("an erase names 1 to 100 ids"));
    }
    for (index, id) in ids.iter().enumerate() {
        check_memory_id(id)?;
        if ids[..index].contains(id) {
            return Err(StoreError::invalid("an erase names each id once"));
        }
    }
    Ok(())
}

/// `erase`'s request: phase 3's forget path over exactly the records the plan names.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Erase {
    /// The target principal and the legacy principals it stands for: the records they own are
    /// the target's, whatever their access set.
    pub owners: Vec<String>,
    /// Only these of the target's records; `None` for all of them.
    pub ids: Option<Vec<String>>,
    /// The plan the eraser presents: the store erases only when the targets it selects now have
    /// this plan.
    pub plan: String,
    /// The erase request a second eraser approves: taken (deleted) in the erase's first
    /// transaction, and only if it is still pending with this plan.
    pub request: Option<String>,
    /// The command context's clock.
    pub at: Millis,
    /// The call's trace id.
    pub trace_id: Option<String>,
}

impl Erase {
    /// The request's own checks.
    ///
    /// # Errors
    /// [`StoreError::Invalid`].
    pub fn check(&self) -> Result<()> {
        check_erase_owners(&self.owners)?;
        if let Some(ids) = &self.ids {
            check_erase_ids(ids)?;
        }
        if !is_erase_plan(&self.plan) {
            return Err(StoreError::invalid(
                "an erase's plan is sha256: and 64 hex digits",
            ));
        }
        if self
            .request
            .as_deref()
            .is_some_and(|id| !is_erase_request_id(id))
        {
            return Err(StoreError::invalid(
                "an erase request's id is x- and 20 hex digits",
            ));
        }
        Ok(())
    }
}

/// What an erase did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EraseOutcome {
    /// The records were erased (or, for an empty plan, nothing was there to erase).
    Erased(ForgetReceipt),
    /// The targets no longer have the plan, or the request named holds another plan: nothing was
    /// erased. A request whose plan the records no longer have was voided; one holding another
    /// plan than the one presented was left as it was.
    PlanStale,
    /// The request named is not pending (it ran, expired, was voided, or never existed), or names
    /// another plan: nothing was erased.
    RequestGone,
}

/// One eraser's dry run (section 8.4: "a second eraser runs their own dry run, which must produce
/// the same plan"): who ran it, for which target and plan, until when. An erase takes it once; a
/// person's erase without one of their own for that target and plan is refused as stale.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EraseDryRun {
    /// The eraser's person: the namespaced principal a legacy one maps to, else itself.
    pub eraser: String,
    /// The target principal as named.
    pub target: String,
    /// The plan the dry run gave.
    pub plan: String,
    /// When it ran.
    pub at: Millis,
    /// When it may no longer be used.
    pub expires_at: Millis,
}

impl EraseDryRun {
    /// The dry run's own checks.
    ///
    /// # Errors
    /// [`StoreError::Invalid`].
    pub fn check(&self) -> Result<()> {
        check_principal("a dry run's eraser", &self.eraser)?;
        check_principal("a dry run's target", &self.target)?;
        if !is_erase_plan(&self.plan) {
            return Err(StoreError::invalid(
                "a dry run's plan is sha256: and 64 hex digits",
            ));
        }
        if self.expires_at <= self.at {
            return Err(StoreError::invalid("a dry run expires after it runs"));
        }
        Ok(())
    }
}

/// One erase request of the two-person rule (section 8.4): ids and a hash, never text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EraseRequest {
    /// `x-` and 20 hex digits.
    pub id: String,
    /// The target principal as the first eraser named it.
    pub target: String,
    /// The plan the first eraser approved.
    pub plan: String,
    /// The first eraser's effective principal.
    pub first: String,
    /// When it was made.
    pub at: Millis,
    /// When it expires.
    pub expires_at: Millis,
}

impl EraseRequest {
    /// The request's own checks.
    ///
    /// # Errors
    /// [`StoreError::Invalid`].
    pub fn check(&self) -> Result<()> {
        if !is_erase_request_id(&self.id) {
            return Err(StoreError::invalid(
                "an erase request's id is x- and 20 hex digits",
            ));
        }
        check_principal("an erase request's target", &self.target)?;
        check_principal("an erase request's eraser", &self.first)?;
        if !is_erase_plan(&self.plan) {
            return Err(StoreError::invalid(
                "an erase request's plan is sha256: and 64 hex digits",
            ));
        }
        if self.expires_at <= self.at {
            return Err(StoreError::invalid(
                "an erase request expires after it is made",
            ));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn target(id: &str, version: u32) -> EraseTarget {
        EraseTarget {
            id: id.to_owned(),
            record_version: version,
        }
    }

    #[test]
    fn the_plan_is_the_sorted_ids_and_versions_and_nothing_else() {
        let a = target("mem-000000000000000000000001", 1);
        let b = target("mem-000000000000000000000002", 3);
        let plan = erase_plan(&[a.clone(), b.clone()]);
        assert!(is_erase_plan(&plan));
        assert_eq!(plan, erase_plan(&[b.clone(), a.clone()]), "order-free");
        assert_ne!(
            plan,
            erase_plan(std::slice::from_ref(&a)),
            "a record more or less"
        );
        assert_ne!(
            plan,
            erase_plan(&[a.clone(), target("mem-000000000000000000000002", 4)]),
            "a version more"
        );
        assert!(is_erase_plan(&erase_plan(&[])));
        assert_ne!(erase_plan(&[]), plan);
    }

    #[test]
    fn shapes_are_checked() {
        assert!(is_erase_request_id("x-0123456789abcdef0123"));
        assert!(!is_erase_request_id("x-0123456789ABCDEF0123"));
        assert!(!is_erase_request_id("x-0123456789abcdef012"));
        assert!(!is_erase_request_id("p-0123456789abcdef0123"));
        assert!(!is_erase_plan("sha256:abc"));
        assert!(check_erase_owners(&[]).is_err());
        assert!(check_erase_owners(&["human:ada".to_owned()]).is_ok());
        assert!(check_erase_owners(&["ada".to_owned()]).is_err());
        let id = "mem-000000000000000000000001".to_owned();
        assert!(check_erase_ids(&[id.clone(), id.clone()]).is_err());
        assert!(check_erase_ids(&[id]).is_ok());
        assert!(check_erase_ids(&[]).is_err());
    }
}
