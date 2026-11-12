//! The seam for erasure (records host specification, sections 5.2, 15.2 and 17): after a
//! `records` row is deleted and the log checkpointed, neither file of the store holds the
//! record's text, a term of it, a key value or its vector.
//!
//! No service deletes a record yet: the erasure specification (the plan's P16) adds the delete
//! itself. This test runs the one statement that specification will run, `DELETE FROM records`,
//! on a connection with the two pragmas every connection of the store has (`foreign_keys` and
//! `secure_delete`, which `sqlite.rs` and `secure_delete.rs` hold the store's own connections
//! to), and reads the raw bytes of every file in the store directory. It also writes the vector
//! by hand, since vectors are written from that specification's step B5.

// Integration-test helpers fail by panicking; clippy exempts only `#[test]` bodies themselves.
#![allow(clippy::expect_used, clippy::unwrap_used)]

mod support;

use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};
use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde_json::json;
use support::open_with;
use umbel_store::conformance::samples;
use umbel_store::lane::{
    FindOrder, LaneWrite, Pointer, RecordDecl, RecordFind, Standing, StandingView,
};
use umbel_store::{DocumentStore, Expect, ReaderFilter};
use umbel_store_embedded::{StoreOptions, WalCheckpoint};

/// A fresh random canary of 24 lowercase letters.
fn canary() -> String {
    let mut out = String::from("canary");
    let mut hasher = RandomState::new().build_hasher();
    hasher.write_u8(1);
    let mut bits = hasher.finish();
    for _ in 0..18 {
        out.push(char::from(b'a' + u8::try_from(bits % 26).unwrap()));
        bits /= 26;
        if bits == 0 {
            let mut more = RandomState::new().build_hasher();
            more.write_u8(2);
            bits = more.finish();
        }
    }
    out
}

/// Every file of the store directory whose raw bytes hold `needle`.
fn files_holding(dir: &Path, needle: &[u8]) -> Vec<PathBuf> {
    let mut hits = Vec::new();
    for entry in std::fs::read_dir(dir.join("store")).expect("the store directory") {
        let path = entry.expect("an entry").path();
        if !path.is_file() {
            continue;
        }
        let bytes = std::fs::read(&path).expect("the file's bytes");
        if bytes.windows(needle.len()).any(|window| window == needle) {
            hits.push(path);
        }
    }
    hits
}

fn decl() -> RecordDecl {
    RecordDecl {
        kind: "note".to_owned(),
        standing: true,
        text: vec![
            Pointer::parse("/statement").unwrap(),
            Pointer::parse("/why").unwrap(),
        ],
        keys: vec![
            Pointer::parse("/bed").unwrap(),
            Pointer::parse("/tags").unwrap(),
        ],
        matched: Some(0),
    }
}

fn view() -> StandingView {
    StandingView {
        own: Vec::new(),
        command_writable: Vec::new(),
        person: Vec::new(),
        admit: vec![Standing::Unverified, Standing::Attested, Standing::Affirmed],
    }
}

fn everyone() -> ReaderFilter {
    ReaderFilter::tokens(["space"]).unwrap()
}

fn put(store: &dyn DocumentStore, id: &str, body: serde_json::Value) {
    store
        .put_declared_record(
            "notes",
            &decl(),
            id,
            body,
            samples::envelope(&["space"], "t", "2026-11-12T09:00:00.000Z"),
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

/// A connection with the pragmas every connection of the store has.
fn store_connection(dir: &Path) -> Connection {
    let conn = Connection::open(dir.join("store").join("store.sqlite3")).expect("a connection");
    conn.pragma_update(None, "foreign_keys", "ON")
        .expect("foreign_keys");
    conn.query_row("PRAGMA secure_delete = ON", [], |r| r.get::<_, i64>(0))
        .expect("secure_delete");
    conn
}

#[test]
fn a_deleted_record_leaves_no_text_term_key_or_vector_in_either_file() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let store = open_with(dir.path(), "main", StoreOptions::default()).expect("opening");
    assert!(store.info().expect("info").secure_delete);
    assert!(store.info().expect("info").foreign_keys);
    let (statement, why, bed, tag) = (canary(), canary(), canary(), canary());
    // The record to delete, and one that stays and shares its ordinary words.
    put(
        &*store,
        "gone",
        json!({
            "statement": format!("Mulch {statement} keeps the soil cool."),
            "why": format!("Bare soil dries, said {why}."),
            "bed": bed,
            "tags": [tag, "soil"],
        }),
    );
    put(
        &*store,
        "kept",
        json!({
            "statement": "Mulch keeps the soil cool and holds water through summer.",
            "bed": "south",
            "tags": ["soil"],
        }),
    );
    let conn = store_connection(dir.path());
    let lane: i64 = conn
        .query_row(
            "SELECT lane FROM record_lane WHERE ns = 'notes' AND kind = 'note' AND id = 'gone'",
            [],
            |r| r.get(0),
        )
        .expect("the lane row");
    // Its vector: sixteen numbers no other row holds, as section 5.1 stores them.
    let vector: Vec<u8> = (0..16u32)
        .flat_map(|n| (0.731_f32 + n as f32 * 0.017).to_le_bytes())
        .collect();
    conn.execute(
        "INSERT INTO record_vectors (lane, model, vector) VALUES (?1, 'potion@0123456789abcdef', ?2)",
        rusqlite::params![lane, vector],
    )
    .expect("a vector");
    // The record's own terms: the ones no other record holds. The tokenizer lower-cases and
    // stems, so they are read from the table and not guessed.
    let terms: Vec<String> = conn
        .prepare(
            "SELECT DISTINCT t.term FROM record_terms t WHERE t.lane = ?1 AND length(t.term) >= 12
               AND NOT EXISTS (SELECT 1 FROM record_terms o WHERE o.term = t.term AND o.lane <> t.lane)",
        )
        .expect("prepare")
        .query_map([lane], |r| r.get(0))
        .expect("query")
        .collect::<Result<_, _>>()
        .expect("rows");
    assert_eq!(
        terms.len(),
        2,
        "one term a canary, in each text field: {terms:?}"
    );
    drop(conn);
    assert_eq!(
        store.truncate_wal().expect("checkpoint"),
        WalCheckpoint::Clean
    );

    let mut needles: Vec<(&str, Vec<u8>)> = vec![
        ("the statement's text", statement.clone().into_bytes()),
        ("the second text value", why.clone().into_bytes()),
        ("a key value", bed.clone().into_bytes()),
        ("a key value of a list", tag.clone().into_bytes()),
        ("the vector", vector.clone()),
    ];
    for term in &terms {
        needles.push(("a term", term.clone().into_bytes()));
    }
    // The control: before the delete, the scan finds every one of them.
    for (what, needle) in &needles {
        assert!(
            !files_holding(dir.path(), needle).is_empty(),
            "{what} is in the store before the delete"
        );
    }

    // The one statement an erasure runs: every lane row goes with the `records` row, by cascade.
    let conn = store_connection(dir.path());
    let deleted = conn
        .execute(
            "DELETE FROM records WHERE ns = 'notes' AND kind = 'note' AND id = 'gone'",
            [],
        )
        .expect("the delete");
    assert_eq!(deleted, 1);
    for table in [
        "record_lane",
        "record_terms",
        "record_keys",
        "record_vectors",
    ] {
        let left: i64 = conn
            .query_row(
                &format!("SELECT COUNT(*) FROM {table} WHERE lane = ?1"),
                [lane],
                |r| r.get(0),
            )
            .expect("count");
        assert_eq!(left, 0, "{table} keeps no row of the deleted record");
    }
    let access: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM record_access WHERE ns = 'notes' AND kind = 'note' AND id = 'gone'",
            [],
            |r| r.get(0),
        )
        .expect("count");
    assert_eq!(access, 0);
    drop(conn);
    assert_eq!(
        store.truncate_wal().expect("checkpoint"),
        WalCheckpoint::Clean
    );

    for (what, needle) in &needles {
        let hits = files_holding(dir.path(), needle);
        assert!(hits.is_empty(), "{what} is still in {hits:?}");
    }

    // The record that stayed is whole, and found by the words the two shared.
    let query = RecordFind {
        kind: "note".to_owned(),
        keys: Vec::new(),
        standings: Vec::new(),
        verified_only: false,
        text: Some(umbel_store::lane::TextQuery {
            query: "mulch soil".to_owned(),
            fields: Vec::new(),
        }),
        order: FindOrder::Rank,
        after: None,
        limit: 10,
        total: true,
    };
    let page = store
        .find_records("notes", &decl(), &query, &view(), &everyone())
        .expect("find");
    assert_eq!(page.total, Some(1));
    assert_eq!(page.items[0].record.id, "kept");
    assert!(
        store
            .read_record("notes", &decl(), "gone", &view(), &everyone())
            .expect("read")
            .is_none()
    );
}
