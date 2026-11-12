//! A record lane's rebuild beside other writers (records host specification, section 12.1), on
//! the embedded backend, through the `testkit` feature's rebuild hook, which lets a test act
//! between two chunks or while one holds the write lock, with no sleep in shipped code:
//!
//! - two rebuilds at once under two declarations leave the kind with the later one's rows only;
//! - a writer that waits on the store's lock gets its turn between two chunks;
//! - a wording edited while its kind was undeclared loses its standing in the rebuild, whatever
//!   the declaration the rebuild runs under.
//!
//! The last sets an affirmation and an evidence row by hand: that specification's step B3 is
//! what writes them.

// Integration-test helpers fail by panicking; clippy exempts only `#[test]` bodies themselves.
#![allow(clippy::expect_used, clippy::unwrap_used)]

use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::time::Duration;

use rusqlite::Connection;
use serde_json::{Value, json};
use umbel_store::conformance::samples;
use umbel_store::lane::{
    FindOrder, KeyFilter, LaneLimits, LaneState, LaneWrite, Pointer, RecordDecl, RecordFind,
    Standing, StandingView,
};
use umbel_store::{DocumentStore, Expect, MemoryFlag, ReaderFilter};
use umbel_store_embedded::{RebuildPoint, SqliteStore, StoreOptions};

const NS: &str = "notes";
const AT: &str = "2026-11-12T09:00:00.000Z";

fn pointer(text: &str) -> Pointer {
    Pointer::parse(text).unwrap()
}

/// The kind `note` with its keys in the order given.
fn decl(standing: bool, keys: &[&str]) -> RecordDecl {
    RecordDecl {
        kind: "note".to_owned(),
        standing,
        text: vec![pointer("/statement")],
        keys: keys.iter().map(|key| pointer(key)).collect(),
        matched: Some(0),
    }
}

fn everyone() -> ReaderFilter {
    ReaderFilter::tokens(["space"]).unwrap()
}

fn view() -> StandingView {
    StandingView {
        own: Vec::new(),
        command_writable: Vec::new(),
        admit: vec![Standing::Unverified, Standing::Attested, Standing::Affirmed],
    }
}

fn no_scan(_text: &str) -> Vec<MemoryFlag> {
    Vec::new()
}

fn open(dir: &Path) -> SqliteStore {
    SqliteStore::open(dir, "main", StoreOptions::default()).expect("opening")
}

/// A store whose rebuilds write one record a chunk.
fn one_a_chunk(dir: &Path) -> SqliteStore {
    open(dir).with_lane_limits(LaneLimits {
        reindex_chunk: 1,
        ..LaneLimits::default()
    })
}

fn note(statement: &str) -> Value {
    json!({ "statement": statement, "bed": "north", "tags": ["roses"] })
}

/// Records of `note` written through the path an undeclared kind takes.
fn undeclared(store: &SqliteStore, ids: &[&str]) {
    for id in ids {
        store
            .put_record(
                NS,
                "note",
                id,
                note("Prune roses in late winter."),
                samples::envelope(&["space"], "t", AT),
                Expect::Any,
            )
            .expect("put_record");
    }
}

fn by_key(decl: &RecordDecl, key: &str, value: &str) -> RecordFind {
    RecordFind {
        kind: decl.kind.clone(),
        keys: vec![KeyFilter {
            key: pointer(key),
            any: vec![value.to_owned()],
        }],
        standings: Vec::new(),
        verified_only: false,
        text: None,
        order: FindOrder::Id,
        after: None,
        limit: 200,
        total: true,
    }
}

#[test]
fn two_rebuilds_under_two_declarations_leave_only_the_later_ones_rows() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let ids = ["a", "b", "c", "d", "e", "f"];
    undeclared(&open(dir.path()), &ids);
    // The same pointers in two orders: under `first` key 0 is the bed, under `second` the tags.
    let first = decl(false, &["/bed", "/tags"]);
    let second = decl(false, &["/tags", "/bed"]);
    // After the first rebuild's first chunk, a second rebuild runs whole, under the other
    // declaration, on another handle: it ends with the kind ready under `second`.
    let other = Arc::new(open(dir.path()));
    let ran = Arc::new(AtomicUsize::new(0));
    let hook = {
        let (other, second, ran) = (Arc::clone(&other), second.clone(), Arc::clone(&ran));
        Arc::new(move |point: RebuildPoint| {
            if point == RebuildPoint::AfterChunk(0) {
                let report = other
                    .reindex_records(NS, &second, &no_scan, None, false)
                    .expect("the second rebuild");
                assert!(
                    !report.superseded,
                    "the later rebuild is the one that stands"
                );
                assert_eq!(report.records, 6);
                ran.fetch_add(1, Ordering::SeqCst);
            }
        })
    };
    let store = one_a_chunk(dir.path()).with_rebuild_hook(hook);
    let report = store
        .reindex_records(NS, &first, &no_scan, None, false)
        .expect("the first rebuild");
    assert_eq!(
        ran.load(Ordering::SeqCst),
        1,
        "the second rebuild ran in between"
    );
    assert!(
        report.superseded,
        "the earlier rebuild says it was overtaken"
    );
    assert_eq!(
        report.records, 1,
        "and wrote nothing after the later one began"
    );

    // The kind is ready under the later declaration, and every lane row is that declaration's.
    assert_eq!(
        store.lane_status(NS, &second).expect("status").state,
        LaneState::Ready
    );
    assert_eq!(
        store.lane_status(NS, &first).expect("status").state,
        LaneState::Stale
    );
    let found = store
        .find_records(
            NS,
            &second,
            &by_key(&second, "/tags", "roses"),
            &view(),
            &everyone(),
        )
        .expect("find");
    assert_eq!(found.total, Some(6), "every record is found by its tag");
    let found = store
        .find_records(
            NS,
            &second,
            &by_key(&second, "/bed", "north"),
            &view(),
            &everyone(),
        )
        .expect("find");
    assert_eq!(found.total, Some(6), "and by its bed");
    let raw = Connection::open(dir.path().join("store").join("store.sqlite3")).expect("raw");
    let misplaced: i64 = raw
        .query_row(
            "SELECT COUNT(*) FROM record_keys WHERE (key = 0 AND value = 'north') OR (key = 1 AND value = 'roses')",
            [],
            |r| r.get(0),
        )
        .expect("count");
    assert_eq!(
        misplaced, 0,
        "no key row sits at the other declaration's position"
    );

    // An undeclared put overtakes a rebuild the same way: it stops, and the kind stays stale.
    let writer = Arc::new(open(dir.path()));
    let hook = {
        let writer = Arc::clone(&writer);
        Arc::new(move |point: RebuildPoint| {
            if point == RebuildPoint::AfterChunk(1) {
                undeclared(&writer, &["g"]);
            }
        })
    };
    let store = one_a_chunk(dir.path()).with_rebuild_hook(hook);
    let report = store
        .reindex_records(NS, &second, &no_scan, None, false)
        .expect("a rebuild an undeclared put overtakes");
    assert!(report.superseded);
    assert_eq!(report.records, 2, "it stops at the chunk after the put");
    assert_eq!(
        store.lane_status(NS, &second).expect("status").state,
        LaneState::Stale,
        "a write the rebuild did not see is never forgotten"
    );
    let again = open(dir.path())
        .reindex_records(NS, &second, &no_scan, None, false)
        .expect("running it again");
    assert_eq!((again.records, again.superseded), (7, false));
}

#[test]
fn a_waiting_writer_gets_its_turn_between_two_chunks() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    undeclared(&open(dir.path()), &["a", "b", "c", "d", "e"]);
    let declared = decl(false, &["/bed", "/tags"]);
    let go = Arc::new(AtomicBool::new(false));
    let got_in = Arc::new(AtomicBool::new(false));
    // A writer of another kind: it starts while the rebuild's second chunk holds the lock.
    let writer = {
        let (go, path) = (Arc::clone(&go), dir.path().to_owned());
        std::thread::spawn(move || {
            let store = open(&path);
            while !go.load(Ordering::SeqCst) {
                std::thread::sleep(Duration::from_millis(1));
            }
            store.put_record(
                NS,
                "log",
                "watered",
                json!({ "line": "Watered the north bed." }),
                samples::envelope(&["space"], "t", AT),
                Expect::Absent,
            )
        })
    };
    let reader = Arc::new(open(dir.path()));
    let hook = {
        let (go, got_in, reader) = (Arc::clone(&go), Arc::clone(&got_in), Arc::clone(&reader));
        Arc::new(move |point: RebuildPoint| match point {
            // The lock is held: let the writer start, and stay until it is deep in its wait,
            // where the busy handler sleeps longest between tries.
            RebuildPoint::InChunk(1) => {
                go.store(true, Ordering::SeqCst);
                std::thread::sleep(Duration::from_millis(400));
            }
            // The very next chunk: the writer's record is committed, or it did not get in.
            RebuildPoint::InChunk(2) => {
                let written = reader
                    .get_record(NS, "log", "watered", &everyone())
                    .expect("a read beside the rebuild");
                got_in.store(written.is_some(), Ordering::SeqCst);
            }
            _ => {}
        })
    };
    let store = one_a_chunk(dir.path()).with_rebuild_hook(hook);
    let report = store
        .reindex_records(NS, &declared, &no_scan, None, false)
        .expect("the rebuild");
    let written = writer.join().expect("the writer's thread");
    assert!(
        written.is_ok(),
        "the writer was never refused as busy: {written:?}"
    );
    assert!(
        got_in.load(Ordering::SeqCst),
        "the writer's record was committed between the second chunk and the third"
    );
    // Another kind's write is no reason for the rebuild to stop.
    assert_eq!((report.records, report.superseded), (5, false));
    assert_eq!(
        store.lane_status(NS, &declared).expect("status").state,
        LaneState::Ready
    );
}

#[test]
fn a_wording_edited_while_undeclared_loses_its_standing_under_any_declaration() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let store = open(dir.path());
    let standing = decl(true, &["/bed", "/tags"]);
    let plain = decl(false, &["/bed", "/tags"]);
    for id in ["edited", "kept"] {
        store
            .put_declared_record(
                NS,
                &standing,
                id,
                note("Prune roses in late winter."),
                samples::envelope(&["space"], "t", AT),
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
    // What step B3 will write: each record affirmed, with evidence and a vector.
    let raw = Connection::open(dir.path().join("store").join("store.sqlite3")).expect("raw");
    raw.execute_batch(
        "UPDATE record_lane SET affirmed_seq = 99;
         INSERT INTO record_evidence (lane, doc, doc_hash, units, rule, speaker, verbatim)
           SELECT lane, 'journal/roses', 'sha256:00', '[1]', 'sentences/1', NULL, 1 FROM record_lane;
         INSERT INTO record_vectors (lane, model, vector)
           SELECT lane, 'potion@0123456789abcdef', x'0000803f' FROM record_lane;",
    )
    .expect("standing facts");
    let status = store.lane_status(NS, &standing).expect("status");
    assert_eq!((status.affirmed, status.evidence), (2, 2));

    // A version of the plugin that does not declare the kind rewrites one wording.
    store
        .put_record(
            NS,
            "note",
            "edited",
            note("Prune roses in early spring."),
            samples::envelope(&["space"], "t", AT),
            Expect::Any,
        )
        .expect("an undeclared edit");
    // The next version declares it without standing, and the lane is rebuilt under that.
    let report = store
        .reindex_records(NS, &plain, &no_scan, None, false)
        .expect("a rebuild under a declaration without standing");
    assert_eq!(
        (report.records, report.wordings_changed, report.superseded),
        (2, 1, false),
        "the edited wording is counted, whatever the kind is declared as"
    );
    let left = |sql: &str| -> Vec<String> {
        raw.prepare(sql)
            .expect("prepare")
            .query_map([], |r| r.get(0))
            .expect("query")
            .collect::<Result<_, _>>()
            .expect("rows")
    };
    let affirmed = "SELECT id FROM record_lane WHERE affirmed_seq IS NOT NULL ORDER BY id";
    let evidence =
        "SELECT l.id FROM record_evidence e JOIN record_lane l ON l.lane = e.lane ORDER BY l.id";
    let vectors =
        "SELECT l.id FROM record_vectors v JOIN record_lane l ON l.lane = v.lane ORDER BY l.id";
    for (what, sql) in [
        ("affirmed", affirmed),
        ("evidence", evidence),
        ("vectors", vectors),
    ] {
        assert_eq!(
            left(sql),
            ["kept"],
            "{what}: the edited wording keeps nothing, the other record everything"
        );
    }
    // Declared with standing again: the new wording did not inherit the old one's affirmation.
    let report = store
        .reindex_records(NS, &standing, &no_scan, None, false)
        .expect("a rebuild under the standing declaration");
    assert_eq!(report.wordings_changed, 0, "nothing more changed");
    let status = store.lane_status(NS, &standing).expect("status");
    assert_eq!(
        (status.state, status.affirmed, status.evidence),
        (LaneState::Ready, 1, 1)
    );
    assert_eq!(left(affirmed), ["kept"]);
}
