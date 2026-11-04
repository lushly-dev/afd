//! Memory records written straight through `main`'s memory store, as phase 3's tests and a
//! library embedder do (D14), and drafts built from them the way the curator will build them
//! (phase 4 section 4.5), through the shared `umbel_okf::draft`, so the knowledge plugin's checks
//! (section 3.2) are tested against what a faithful drafter sends.
//!
//! Write records before the host first reads memory, or reopen the host after: each host keeps
//! the store it opened.
#![allow(dead_code, unreachable_pub, clippy::unwrap_used, clippy::expect_used)]

use std::collections::BTreeSet;

use serde_json::{Value, json};
use umbel_okf::draft::{self, Draft, Rationale};
use umbel_store::conformance::samples;
use umbel_store::memory::{DAY_MS, Forget, Invalidate, InvalidationReason, format_instant};
use umbel_store::{
    AsOf, Authority, ForgetSelector, MemoryRecord, MemoryStore, MemoryWrite, Origin, ReadFlags,
    ReaderFilter,
};
use umbel_store_embedded::{SqliteMemoryStore, StoreOptions};

use super::Fx;

/// The hosts' fixed clock, 2026-01-01T00:00:00.000Z.
pub const NOW: i64 = 1_767_225_600_000;
/// When the records are written: thirty days earlier.
pub const T0: i64 = NOW - 30 * DAY_MS;
/// The settling instant the drafts carry: ten days after the records were written.
pub const SETTLED: i64 = T0 + 10 * DAY_MS;
/// The batch caller: the person at the command line.
pub const CALLER: &str = "human:local";

/// `main`'s memory store.
pub fn store(fx: &Fx) -> SqliteMemoryStore {
    SqliteMemoryStore::open(&fx.state_dir("main"), "main", StoreOptions::default())
        .unwrap()
        .with_machine_backup_exclusion(false)
}

/// A semantic record `mem-<n as 24 hex>` of `owner` in `main`, readable by `access`: authority
/// `person`, origin `user-stated`, one constraint, one tag, confidence 0.8, observed in session
/// `s1`, valid from [`T0`] and expiring 400 days later.
pub fn entry(n: u64, owner: &str, access: &[&str], subject: &str, text: &str) -> MemoryWrite {
    let mut entry = samples::memory_entry(n, owner, access, subject, text);
    entry.scope.space = "main".to_owned();
    entry.scope.session = Some("s1".to_owned());
    entry.tags = vec!["deploy".to_owned()];
    entry.valid_from = T0;
    entry.expires_at = T0 + 400 * DAY_MS;
    entry.envelope.origin = Origin::UserStated;
    entry.envelope.observed_at = format_instant(T0);
    entry.envelope.constraints = Some(vec!["staging only".to_owned()]);
    entry.envelope.confidence = Some(0.8);
    samples::set_authority(&mut entry, Authority::Person);
    samples::agree(&mut entry);
    entry
}

/// The record id of [`entry`]`(n, ..)`.
pub fn id(n: u64) -> String {
    samples::memory_id(n)
}

/// Write `entries` at [`T0`], each in its own batch (a batch has one principal and authority).
pub fn write(fx: &Fx, entries: Vec<MemoryWrite>) {
    let store = store(fx);
    for entry in entries {
        store.write(samples::memory_batch(T0, vec![entry])).unwrap();
    }
}

/// A reader that reads every record these tests write.
fn everyone() -> ReaderFilter {
    ReaderFilter::tokens([
        "space",
        "group:platform",
        "principal:human:ada",
        "principal:human:local",
        "principal:human:bo",
    ])
    .unwrap()
}

/// Record `id` as the store holds it at [`NOW`], flagged and expired included.
pub fn record(fx: &Fx, id: &str) -> MemoryRecord {
    let flags = ReadFlags {
        include_flagged: true,
        include_expired: true,
        now: NOW,
    };
    store(fx)
        .get(id, AsOf::at(NOW), flags, &everyone())
        .unwrap()
        .unwrap_or_else(|| panic!("no record {id}"))
}

/// Invalidate `id` as its owner, from a day before [`NOW`].
pub fn invalidate(fx: &Fx, id: &str, owner: &str) {
    store(fx)
        .invalidate(
            Invalidate {
                id: id.to_owned(),
                at: NOW - DAY_MS,
                valid_until: NOW - DAY_MS,
                by: owner.to_owned(),
                reason: InvalidationReason::Outdated,
                note: None,
                expect_version: None,
                trace_id: None,
            },
            &everyone(),
        )
        .unwrap();
}

/// Forget `id` as its owner.
pub fn forget(fx: &Fx, id: &str, owner: &str) {
    store(fx)
        .forget(Forget {
            owner: owner.to_owned(),
            selector: ForgetSelector::Ids(vec![id.to_owned()]),
            at: NOW - DAY_MS,
            trace_id: None,
        })
        .unwrap();
}

/// Section 2.1's memory evidence entry for `record`, as a faithful drafter copies it, with
/// `principals` the distinct principals of the draft's sources.
pub fn evidence(record: &MemoryRecord, principals: usize) -> Value {
    json!({
        "kind": "memory",
        "ref": format!("{}@{}", record.id, record.record_version),
        "principal": record.scope.principal,
        "contentHash": record.content_hash,
        "class": record.class.as_str(),
        "authority": record.provenance.authority,
        "origin": record.provenance.origin,
        "constraints": record.provenance.constraints,
        "access": record.access.tokens(),
        "sensitivity": record.sensitivity,
        "confirmation": record.provenance.confirmation,
        "observations": { "sessions": record.observations.sessions, "principals": principals },
        "excerpt": draft::excerpt(&record.text),
    })
}

/// How a draft is placed: the target collection and prefix, the draft count, the conflict set.
pub struct Place<'a> {
    pub collection: &'a str,
    pub prefix: &'a str,
    pub drafts: u32,
    pub conflict_set: Option<&'a str>,
}

impl Default for Place<'_> {
    fn default() -> Self {
        Self {
            collection: "handbook",
            prefix: "learned/",
            drafts: 0,
            conflict_set: None,
        }
    }
}

/// The candidate id of `records` for [`CALLER`] in `main`.
pub fn candidate(records: &[MemoryRecord]) -> String {
    let lowest = records.iter().map(|r| r.id.as_str()).min().unwrap();
    draft::candidate_id("main", CALLER, lowest)
}

/// A batch item drafting `records` as one candidate, exactly as section 4.5 renders it for the
/// instance `curator` and the caller [`CALLER`], `scheduled`.
pub fn drafted(records: &[MemoryRecord], place: &Place<'_>) -> Value {
    let first = &records[0];
    let candidate = candidate(records);
    let doc = draft::document_id(
        place.collection,
        place.prefix,
        place.conflict_set.unwrap_or(&candidate),
    );
    let principals: BTreeSet<&str> = records.iter().map(|r| r.scope.principal.as_str()).collect();
    let content = draft::render(&Draft {
        class: first.class,
        subject: &first.subject,
        text: &first.text,
        tags: records.iter().flat_map(|r| r.tags.clone()).collect(),
        constraints: records
            .iter()
            .flat_map(|r| r.provenance.constraints.clone().unwrap_or_default())
            .collect(),
        plugin: "curator",
        instance: "curator",
        settled_at: SETTLED,
    });
    let rationale = Rationale {
        class: first.class,
        authority: records
            .iter()
            .filter_map(MemoryRecord::authority)
            .min()
            .unwrap(),
        sessions: records.iter().map(|r| r.observations.sessions).sum(),
        principals: principals.len() as u64,
        settled_at: SETTLED,
    }
    .render();
    let confidence = records
        .iter()
        .filter_map(|r| r.provenance.confidence)
        .reduce(f64::max);
    let mut item = json!({
        "idempotency_key": draft::idempotency_key("curator", &candidate, place.drafts),
        "change": { "op": "create", "doc": doc, "content": content },
        "rationale": rationale,
        "evidence": records.iter().map(|r| evidence(r, principals.len())).collect::<Vec<_>>(),
        "confidence": confidence,
        "drafter": { "mode": "scheduled", "candidate": candidate },
        "derivedFrom": records.iter().map(|r| json!({ "kind": "memory", "id": r.id, "contentHash": r.content_hash })).collect::<Vec<_>>(),
    });
    if let Some(set) = place.conflict_set {
        item["conflictSet"] = json!(set);
    }
    item
}

/// [`drafted`] as a promotion of [`CALLER`]'s own records.
pub fn promoted(records: &[MemoryRecord]) -> Value {
    let mut item = drafted(records, &Place::default());
    item["drafter"]["mode"] = json!("promoted");
    item["drafter"]["promotedBy"] = json!(CALLER);
    item
}

/// `item` with its content re-rendered from `draft` changes, keeping everything else.
pub fn rerendered(item: &Value, records: &[MemoryRecord], settled_at: i64) -> Value {
    let first = &records[0];
    let mut item = item.clone();
    item["change"]["content"] = json!(draft::render(&Draft {
        class: first.class,
        subject: &first.subject,
        text: &first.text,
        tags: records.iter().flat_map(|r| r.tags.clone()).collect(),
        constraints: records
            .iter()
            .flat_map(|r| r.provenance.constraints.clone().unwrap_or_default())
            .collect(),
        plugin: "curator",
        instance: "curator",
        settled_at,
    }));
    let mut rationale = Rationale::parse(item["rationale"].as_str().unwrap()).unwrap();
    rationale.settled_at = settled_at;
    item["rationale"] = json!(rationale.render());
    item
}
