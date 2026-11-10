//! `memory-erase` at the embedded memory store (phase 5 specification, section 8.4; step 10):
//! `erase_targets` selects by owner whatever the access set, the legacy principals included, and
//! answers ids and versions only; the plan binds every id and version; the erase runs phase 3's
//! forget path only for the plan presented, takes an erase request once in its own first
//! transaction, and voids a request whose plan no longer holds; requests expire and are purged.

#![allow(clippy::expect_used, clippy::unwrap_used)]

mod support;

use support::open_memory;
use umbel_store::conformance::samples;
use umbel_store::memory::{AsOf, Erase, EraseOutcome, EraseRequest, WalState, erase_plan};
use umbel_store::{MemoryStore, ReadFlags, ReaderFilter};
use umbel_store_embedded::StoreOptions;

const BO: &str = "human:corp/bo";
const LEGACY: &str = "human:bo";
const CY: &str = "human:corp/cy";
const T0: i64 = samples::MEMORY_AT;
const PLAN_ID: &str = "x-0123456789abcdef0123";

fn owners() -> Vec<String> {
    vec![BO.to_owned(), LEGACY.to_owned()]
}

/// Bo's shared, bo's private, the legacy principal's private, and cy's records: 1, 2, 3 and 4.
fn seeded(dir: &std::path::Path) -> std::sync::Arc<umbel_store_embedded::SqliteMemoryStore> {
    let m = open_memory(dir, "main", StoreOptions::default()).unwrap();
    let entries = vec![
        samples::memory_entry(1, BO, &["space"], "shared", "bo shared"),
        samples::memory_entry(2, BO, &["principal:human:corp/bo"], "private", "bo private"),
        samples::memory_entry(3, LEGACY, &["principal:human:bo"], "legacy", "bo legacy"),
        samples::memory_entry(4, CY, &["space"], "cy", "cy's own"),
    ];
    for entry in entries {
        m.write(samples::memory_batch(T0, vec![entry])).unwrap();
    }
    m
}

fn erase(plan: &str, request: Option<&str>) -> Erase {
    Erase {
        owners: owners(),
        ids: None,
        plan: plan.to_owned(),
        request: request.map(str::to_owned),
        at: T0 + 1,
        trace_id: Some("t-erase".to_owned()),
    }
}

fn request(plan: &str, expires_at: i64) -> EraseRequest {
    EraseRequest {
        id: PLAN_ID.to_owned(),
        target: BO.to_owned(),
        plan: plan.to_owned(),
        first: "human:corp/ada".to_owned(),
        at: T0,
        expires_at,
    }
}

#[test]
fn the_targets_are_the_owners_records_whatever_their_access() {
    let dir = tempfile::tempdir().unwrap();
    let m = seeded(dir.path());
    let targets = m.erase_targets(&owners(), None).unwrap();
    let ids: Vec<&str> = targets.iter().map(|t| t.id.as_str()).collect();
    assert_eq!(
        ids,
        [
            samples::memory_id(1).as_str(),
            samples::memory_id(2).as_str(),
            samples::memory_id(3).as_str()
        ]
    );
    assert!(targets.iter().all(|t| t.record_version == 1));
    // Narrowed by ids, and another owner's id among them is not a target.
    let named = vec![samples::memory_id(2), samples::memory_id(4)];
    let some = m.erase_targets(&owners(), Some(&named)).unwrap();
    assert_eq!(some.len(), 1);
    assert_eq!(some[0].id, samples::memory_id(2));
    // Only the namespaced principal: the legacy one's record is not reached.
    assert_eq!(m.erase_targets(&[BO.to_owned()], None).unwrap().len(), 2);
}

#[test]
fn the_erase_runs_only_for_the_plan_and_leaves_others_alone() {
    let dir = tempfile::tempdir().unwrap();
    let m = seeded(dir.path());
    let plan = erase_plan(&m.erase_targets(&owners(), None).unwrap());
    // Another plan erases nothing.
    let other = erase_plan(&m.erase_targets(&[BO.to_owned()], None).unwrap());
    assert_eq!(
        m.erase(erase(&other, None)).unwrap(),
        EraseOutcome::PlanStale
    );
    assert_eq!(m.erase_targets(&owners(), None).unwrap().len(), 3);
    match m.erase(erase(&plan, None)).unwrap() {
        EraseOutcome::Erased(receipt) => {
            assert_eq!(receipt.erased, 3);
            assert_eq!(receipt.wal, WalState::Clean);
        }
        other => panic!("{other:?}"),
    }
    assert!(m.erase_targets(&owners(), None).unwrap().is_empty());
    // Cy's record stays, readable as before.
    let reader = ReaderFilter::tokens(["principal:human:corp/cy", "space"]).unwrap();
    let flags = ReadFlags::at(T0 + 2);
    assert!(
        m.get(&samples::memory_id(4), AsOf::at(T0 + 2), flags, &reader)
            .unwrap()
            .is_some()
    );
    // The keys of the erased records are destroyed, and nothing is left to settle.
    let keys = m.key_status().unwrap();
    assert_eq!(keys.destroyed, 3, "{keys:?}");
    assert_eq!(keys.unsettled, 0, "{keys:?}");
    // Presented again, the plan no longer names anything there: stale, nothing more erased.
    assert_eq!(
        m.erase(erase(&plan, None)).unwrap(),
        EraseOutcome::PlanStale
    );
}

#[test]
fn a_request_is_taken_once_and_a_stale_plan_voids_it() {
    let dir = tempfile::tempdir().unwrap();
    let m = seeded(dir.path());
    let plan = erase_plan(&m.erase_targets(&owners(), None).unwrap());
    m.erase_request_create(request(&plan, T0 + 600_000), T0)
        .unwrap();
    // Its id is used once.
    assert!(
        m.erase_request_create(request(&plan, T0 + 600_000), T0)
            .is_err()
    );
    assert_eq!(
        m.erase_request(PLAN_ID, T0 + 1).unwrap(),
        Some(request(&plan, T0 + 600_000))
    );
    // A request for another plan is voided, and nothing is erased.
    let other = erase_plan(&m.erase_targets(&[BO.to_owned()], None).unwrap());
    assert_eq!(
        m.erase(erase(&other, Some(PLAN_ID))).unwrap(),
        EraseOutcome::PlanStale
    );
    assert_eq!(m.erase_request(PLAN_ID, T0 + 1).unwrap(), None);
    assert_eq!(
        m.erase(erase(&plan, Some(PLAN_ID))).unwrap(),
        EraseOutcome::RequestGone
    );
    assert_eq!(m.erase_targets(&owners(), None).unwrap().len(), 3);
    // A fresh request runs once; the second erase finds it gone.
    m.erase_request_create(request(&plan, T0 + 600_000), T0)
        .unwrap();
    assert!(matches!(
        m.erase(erase(&plan, Some(PLAN_ID))).unwrap(),
        EraseOutcome::Erased(_)
    ));
    assert_eq!(m.erase_request(PLAN_ID, T0 + 2).unwrap(), None);
    assert_eq!(
        m.erase(erase(&plan, Some(PLAN_ID))).unwrap(),
        EraseOutcome::RequestGone
    );
}

#[test]
fn a_request_expires_and_is_purged_and_a_void_removes_it() {
    let dir = tempfile::tempdir().unwrap();
    let m = seeded(dir.path());
    let plan = erase_plan(&m.erase_targets(&owners(), None).unwrap());
    m.erase_request_create(request(&plan, T0 + 600_000), T0)
        .unwrap();
    assert!(m.erase_request(PLAN_ID, T0 + 599_999).unwrap().is_some());
    // At its expiry it is gone, and an erase naming it erases nothing.
    assert_eq!(m.erase_request(PLAN_ID, T0 + 600_000).unwrap(), None);
    let mut late = erase(&plan, Some(PLAN_ID));
    late.at = T0 + 600_000;
    assert_eq!(m.erase(late).unwrap(), EraseOutcome::RequestGone);
    assert_eq!(m.erase_targets(&owners(), None).unwrap().len(), 3);
    // A void removes a pending one, once.
    m.erase_request_create(request(&plan, T0 + 1_200_000), T0 + 600_000)
        .unwrap();
    assert!(m.erase_request_void(PLAN_ID).unwrap());
    assert!(!m.erase_request_void(PLAN_ID).unwrap());
}

#[test]
fn an_unwritten_store_has_no_targets_and_no_requests() {
    let dir = tempfile::tempdir().unwrap();
    let m = open_memory(dir.path(), "main", StoreOptions::default()).unwrap();
    assert!(matches!(
        m.erase_targets(&owners(), None),
        Err(umbel_store::StoreError::NotProvisioned)
    ));
    assert!(matches!(
        m.erase_request(PLAN_ID, T0),
        Err(umbel_store::StoreError::NotProvisioned)
    ));
    assert!(!dir.path().join("memory.sqlite3").exists());
}
