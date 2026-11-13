//! A lane row's pointer alone is never read as standing (records host specification, sections
//! 4.3 and 6.1; D160, D161), on the embedded backend, with rows written by hand: a record reads
//! affirmed only when the decision its lane row names is an affirmation, of the wording the row
//! holds now, made by the space's person. No service writes the rows these cases need, which is
//! the point: whatever leaves such a row behind, a read does not turn it into standing.

// Integration-test helpers fail by panicking; clippy exempts only `#[test]` bodies themselves.
#![allow(clippy::expect_used, clippy::unwrap_used)]

mod support;

use rusqlite::Connection;
use serde_json::json;
use support::open_with;
use umbel_store::conformance::samples;
use umbel_store::lane::{
    Decision, FindOrder, LaneWrite, Pointer, RecordDecision, RecordDecl, RecordFind, Standing,
    StandingView,
};
use umbel_store::{Assurance, DocumentStore, Expect, ReaderFilter};
use umbel_store_embedded::StoreOptions;

const NS: &str = "notes";
const AT: &str = "2026-11-02T10:00:00.000Z";
const PERSON: &str = "human:local";

fn note() -> RecordDecl {
    RecordDecl {
        kind: "note".to_owned(),
        standing: true,
        text: vec![Pointer::parse("/statement").unwrap()],
        keys: Vec::new(),
        matched: Some(0),
    }
}

fn everyone() -> ReaderFilter {
    ReaderFilter::tokens(["space"]).unwrap()
}

fn view(admit: &[Standing]) -> StandingView {
    StandingView {
        own: Vec::new(),
        command_writable: Vec::new(),
        person: vec![PERSON.to_owned()],
        admit: admit.to_vec(),
        levels: Vec::new(),
    }
}

fn all() -> StandingView {
    view(&[Standing::Unverified, Standing::Attested, Standing::Affirmed])
}

fn put(store: &dyn DocumentStore, id: &str, statement: &str) {
    store
        .put_declared_record(
            NS,
            &note(),
            id,
            json!({ "statement": statement }),
            samples::envelope(&["space"], "capture", AT),
            Expect::Absent,
            LaneWrite {
                evidence: None,
                flags: Vec::new(),
                model: None,
            },
            &everyone(),
        )
        .expect("a declared put");
}

fn affirm(store: &dyn DocumentStore, id: &str) -> u64 {
    store
        .decide_record(
            NS,
            &note(),
            id,
            RecordDecision {
                decision: Decision::Affirm,
                by: PERSON.to_owned(),
                at: AT.to_owned(),
                assurance: Assurance::terminal(),
                trace_id: None,
            },
            &all(),
            &everyone(),
        )
        .expect("affirm")
        .rev
        .expect("the affirmation took a revision")
}

fn standing(store: &dyn DocumentStore, id: &str) -> Standing {
    store
        .read_record(NS, &note(), id, &all(), &everyone())
        .expect("read")
        .expect("the record is readable")
        .label
        .expect("a label")
        .standing
}

/// How many records a call for affirmed records alone is given.
fn affirmed_total(store: &dyn DocumentStore) -> u64 {
    let query = RecordFind {
        kind: "note".to_owned(),
        keys: Vec::new(),
        standings: Vec::new(),
        verified_only: false,
        text: None,
        order: FindOrder::Id,
        after: None,
        limit: 200,
        total: true,
    };
    store
        .find_records(
            NS,
            &note(),
            &query,
            &view(&[Standing::Affirmed]),
            &everyone(),
        )
        .expect("find")
        .total
        .expect("a total")
}

#[test]
fn an_affirmation_is_of_the_wording_its_lane_row_holds_now() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let opened = open_with(dir.path(), "main", StoreOptions::default()).expect("opening");
    let store: &dyn DocumentStore = &*opened;
    put(store, "a", "Prune roses in late winter.");
    put(store, "b", "Roses want morning sun.");
    let a = affirm(store, "a");
    let b = affirm(store, "b");
    assert_eq!(standing(store, "a"), Standing::Affirmed);
    assert_eq!(affirmed_total(store), 2);
    let raw = Connection::open(dir.path().join("store").join("store.sqlite3")).expect("raw");
    let run = |sql: &str| {
        raw.execute_batch(sql).expect(sql);
    };
    let restore = format!(
        "UPDATE record_lane SET affirmed_seq = {a} WHERE id = 'a';
         UPDATE record_lane SET affirmed_seq = {b} WHERE id = 'b';"
    );

    // The lane row's wording is not the one the decision was made on: what a wording changed
    // behind the store's services would leave.
    let wording: String = raw
        .query_row(
            "SELECT wording_hash FROM record_lane WHERE id = 'a'",
            [],
            |r| r.get(0),
        )
        .expect("the wording hash");
    run("UPDATE record_lane SET wording_hash = 'sha256:0000' WHERE id = 'a'");
    assert_eq!(standing(store, "a"), Standing::Unverified);
    assert_eq!(standing(store, "b"), Standing::Affirmed);
    assert_eq!(affirmed_total(store), 1, "nor is it counted as affirmed");
    run(&format!(
        "UPDATE record_lane SET wording_hash = '{wording}' WHERE id = 'a'"
    ));
    assert_eq!(standing(store, "a"), Standing::Affirmed);

    // The row names another record's decision, which is of another wording.
    run(&format!(
        "UPDATE record_lane SET affirmed_seq = {b} WHERE id = 'a'"
    ));
    assert_eq!(standing(store, "a"), Standing::Unverified);
    assert_eq!(affirmed_total(store), 1);
    run(&restore);

    // The row names a decision that is not an affirmation.
    run(&format!(
        "UPDATE record_decisions SET decision = 'withdraw' WHERE seq = {a}"
    ));
    assert_eq!(standing(store, "a"), Standing::Unverified);
    assert_eq!(affirmed_total(store), 1);
    run(&format!(
        "UPDATE record_decisions SET decision = 'affirm' WHERE seq = {a}"
    ));

    // The row names a decision that is not stored: unverified, and no failure.
    run("UPDATE record_lane SET affirmed_seq = 99 WHERE id = 'a'");
    assert_eq!(standing(store, "a"), Standing::Unverified);
    assert_eq!(affirmed_total(store), 1);
    run(&restore);

    // The decision was made by someone who is not the space's person.
    run(&format!(
        "UPDATE record_decisions SET by = 'human:someone-else' WHERE seq = {a}"
    ));
    assert_eq!(standing(store, "a"), Standing::Unverified);
    assert_eq!(affirmed_total(store), 1);
    run(&format!(
        "UPDATE record_decisions SET by = '{PERSON}' WHERE seq = {a}"
    ));
    assert_eq!(standing(store, "a"), Standing::Affirmed);
    assert_eq!(affirmed_total(store), 2);
}
