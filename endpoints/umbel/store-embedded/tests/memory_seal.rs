//! Sealing (phase 3 section 5.4, D82): a record's body and version blobs are XChaCha20-Poly1305
//! under its own key from `memory.keys`, bound to space, id, owner, part and version. Round trip;
//! a blob moved to another record, owner, space, part or version does not open; a flipped bit does
//! not open; nonces differ; nothing sealed appears in `records` or `versions` in clear.

// Integration-test helpers fail by panicking; clippy exempts only `#[test]` bodies themselves.
#![allow(clippy::expect_used, clippy::unwrap_used)]

mod support;

use std::path::Path;

use chacha20poly1305::aead::{Aead, Payload};
use chacha20poly1305::{KeyInit, XChaCha20Poly1305, XNonce};
use rusqlite::Connection;
use support::open_memory;
use umbel_store::conformance::samples;
use umbel_store::memory::{AsOf, Invalidate, InvalidationReason, ReadFlags};
use umbel_store::{MemoryStore, ReaderFilter, Source, StoreError};
use umbel_store_embedded::StoreOptions;

const ADA: &str = "human:ada";
const P_ADA: &str = "principal:human:ada";
const T0: i64 = samples::MEMORY_AT;

fn ada() -> ReaderFilter {
    ReaderFilter::tokens([P_ADA, "space"]).expect("a valid reader")
}

fn db(dir: &Path) -> Connection {
    Connection::open(dir.join("store").join("memory.sqlite3")).expect("the database")
}

fn keys(dir: &Path) -> Connection {
    Connection::open(dir.join("store").join("memory.keys")).expect("the key file")
}

fn get(m: &dyn MemoryStore, n: u64) -> Result<Option<umbel_store::MemoryRecord>, StoreError> {
    m.get(
        &samples::memory_id(n),
        AsOf::at(T0 + 10),
        ReadFlags {
            include_flagged: true,
            include_expired: true,
            now: T0 + 10,
        },
        &ada(),
    )
}

/// Two records: 1 with constraint and source text and an invalidation note, 2 plain.
fn setup(dir: &Path) -> std::sync::Arc<umbel_store_embedded::SqliteMemoryStore> {
    let m = open_memory(dir, "main", StoreOptions::default()).expect("opening");
    let mut one = samples::memory_entry(1, ADA, &[P_ADA], "sealedsubjectqx", "sealedtextqx body");
    one.tags = vec!["sealedtagqx".into()];
    one.envelope.constraints = Some(vec!["sealedconstraintqx".into()]);
    one.envelope.sources = Some(vec![Source {
        resource: "file://sealedsourceqx".into(),
        id: None,
        title: None,
        author: None,
        last_modified: None,
    }]);
    let two = samples::memory_entry(2, ADA, &[P_ADA], "second", "another body");
    m.write(samples::memory_batch(T0, vec![one, two]))
        .expect("write");
    m.invalidate(
        Invalidate {
            id: samples::memory_id(1),
            at: T0 + 5,
            valid_until: T0 + 5,
            by: ADA.into(),
            reason: InvalidationReason::Wrong,
            note: Some("sealednoteqx".into()),
            expect_version: None,
            trace_id: None,
        },
        &ada(),
    )
    .expect("invalidate");
    m
}

fn aad(space: &str, id: &str, owner: &str, part: &str, version: u32) -> Vec<u8> {
    serde_json::json!(["umbel-memory-seal/1", space, id, owner, part, version])
        .to_string()
        .into_bytes()
}

fn open_blob(key: &[u8], blob: &[u8], aad: &[u8]) -> Option<Vec<u8>> {
    assert_eq!(blob[0], 0x01, "seal version 1");
    let cipher = XChaCha20Poly1305::new_from_slice(key).expect("a 32-byte key");
    let nonce = <&XNonce>::try_from(&blob[1..25]).expect("a nonce");
    cipher
        .decrypt(
            nonce,
            Payload {
                msg: &blob[25..],
                aad,
            },
        )
        .ok()
}

#[test]
fn blobs_open_with_the_records_key_and_binding_and_hold_no_clear_text() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let m = setup(dir.path());
    let id = samples::memory_id(1);
    let raw = db(dir.path());
    let body: Vec<u8> = raw
        .query_row("SELECT sealed FROM records WHERE id = ?1", [&id], |r| {
            r.get(0)
        })
        .expect("the body");
    let key: Vec<u8> = keys(dir.path())
        .query_row("SELECT key FROM record_keys WHERE id = ?1", [&id], |r| {
            r.get(0)
        })
        .expect("the key");
    assert_eq!(key.len(), 32);
    // Opened here, independently of the store, with the binding of section 5.4.
    let plain = open_blob(&key, &body, &aad("main", &id, ADA, "body", 0)).expect("opens");
    let plain = String::from_utf8(plain).expect("JSON");
    assert!(plain.contains("sealedtextqx") && plain.contains("sealedtagqx"));
    for (space, rid, owner, part, version) in [
        ("beta", id.as_str(), ADA, "body", 0),
        ("main", "mem-other", ADA, "body", 0),
        ("main", id.as_str(), "human:bo", "body", 0),
        ("main", id.as_str(), ADA, "version", 0),
        ("main", id.as_str(), ADA, "body", 1),
    ] {
        assert!(
            open_blob(&key, &body, &aad(space, rid, owner, part, version)).is_none(),
            "{space} {rid} {owner} {part} {version}"
        );
    }
    let version: Vec<u8> = raw
        .query_row(
            "SELECT sealed FROM versions WHERE id = ?1 AND record_version = 2",
            [&id],
            |r| r.get(0),
        )
        .expect("version 2");
    let plain =
        open_blob(&key, &version, &aad("main", &id, ADA, "version", 2)).expect("version opens");
    let plain = String::from_utf8(plain).expect("JSON");
    assert!(plain.contains("sealednoteqx") && plain.contains("sealedconstraintqx"));
    // Nothing sealed is in clear in `records` or `versions`, in any column.
    for table in ["records", "versions"] {
        let mut stmt = raw
            .prepare(&format!("SELECT * FROM {table}"))
            .expect("a select");
        let width = stmt.column_count();
        let mut rows = stmt.query([]).expect("rows");
        while let Some(row) = rows.next().expect("a row") {
            for c in 0..width {
                let value = match row.get_ref(c).expect("a value") {
                    rusqlite::types::ValueRef::Text(t) | rusqlite::types::ValueRef::Blob(t) => {
                        t.to_vec()
                    }
                    _ => continue,
                };
                for canary in [
                    "sealedsubjectqx",
                    "sealedtextqx",
                    "sealedtagqx",
                    "sealedconstraintqx",
                    "sealedsourceqx",
                    "sealednoteqx",
                ] {
                    assert!(
                        !value.windows(canary.len()).any(|w| w == canary.as_bytes()),
                        "{canary} in clear in {table}"
                    );
                }
            }
        }
    }
    // And the store reads it all back.
    let history = m.history(&id, &ada()).expect("history");
    assert_eq!(history.len(), 2);
    assert_eq!(history[0].text, "sealedtextqx body");
    assert_eq!(
        history[1]
            .invalidation
            .as_ref()
            .and_then(|i| i.note.clone()),
        Some("sealednoteqx".to_owned())
    );
}

#[test]
fn a_moved_or_altered_blob_does_not_open() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let m = setup(dir.path());
    let raw = db(dir.path());
    // Record 1's body moved onto record 2: another id and another key.
    raw.execute(
        "UPDATE records SET sealed = (SELECT sealed FROM records WHERE id = ?1) WHERE id = ?2",
        [samples::memory_id(1), samples::memory_id(2)],
    )
    .expect("moving a blob");
    let fresh = open_memory(dir.path(), "main", StoreOptions::default()).expect("reopening");
    assert!(
        matches!(get(&*fresh, 2), Err(StoreError::SealInvalid { .. })),
        "a moved body: {:?}",
        get(&*fresh, 2).map(|r| r.is_some())
    );
    // Record 1's version 1 blob moved onto version 2 of the same record: another version.
    raw.execute(
        "UPDATE versions SET sealed = (SELECT sealed FROM versions WHERE id = ?1 AND \
         record_version = 1) WHERE id = ?1 AND record_version = 2",
        [samples::memory_id(1)],
    )
    .expect("moving a version blob");
    assert!(matches!(
        fresh.history(&samples::memory_id(1), &ada()),
        Err(StoreError::SealInvalid { .. })
    ));
    // A flipped bit in record 1's body.
    let mut body: Vec<u8> = raw
        .query_row(
            "SELECT sealed FROM records WHERE id = ?1",
            [samples::memory_id(1)],
            |r| r.get(0),
        )
        .expect("the body");
    let last = body.len() - 1;
    body[last] ^= 0x01;
    raw.execute(
        "UPDATE versions SET sealed = NULL WHERE id = ?1",
        [samples::memory_id(1)],
    )
    .expect("clearing version blobs");
    raw.execute(
        "UPDATE records SET sealed = ?1 WHERE id = ?2",
        rusqlite::params![body, samples::memory_id(1)],
    )
    .expect("flipping a bit");
    let any = AsOf::at(T0 + 1);
    assert!(matches!(
        fresh.get(
            &samples::memory_id(1),
            any,
            ReadFlags {
                include_flagged: true,
                include_expired: true,
                now: T0 + 1
            },
            &ada()
        ),
        Err(StoreError::SealInvalid { .. })
    ));
    drop(m);
}

#[test]
fn nonces_differ_between_seals_under_one_key() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let _m = setup(dir.path());
    let raw = db(dir.path());
    let mut stmt = raw
        .prepare("SELECT sealed FROM versions WHERE sealed IS NOT NULL UNION ALL SELECT sealed FROM records")
        .expect("blobs");
    let blobs: Vec<Vec<u8>> = stmt
        .query_map([], |r| r.get(0))
        .expect("blobs")
        .collect::<Result<_, _>>()
        .expect("blobs");
    assert!(blobs.len() >= 4, "{}", blobs.len());
    let mut nonces: Vec<&[u8]> = blobs.iter().map(|b| &b[1..25]).collect();
    nonces.sort_unstable();
    nonces.dedup();
    assert_eq!(nonces.len(), blobs.len(), "every seal has its own nonce");
}

#[test]
fn every_record_has_its_own_key() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let _m = setup(dir.path());
    let k = keys(dir.path());
    let found: Vec<Vec<u8>> = {
        let mut stmt = k.prepare("SELECT key FROM record_keys").expect("keys");
        stmt.query_map([], |r| r.get(0))
            .expect("keys")
            .collect::<Result<_, _>>()
            .expect("keys")
    };
    assert_eq!(found.len(), 2);
    assert_ne!(found[0], found[1]);
    let raw = db(dir.path());
    let store_id: String = raw
        .query_row("SELECT value FROM meta WHERE key = 'store_id'", [], |r| {
            r.get(0)
        })
        .expect("store id");
    let key_store: String = k
        .query_row("SELECT store_id FROM meta", [], |r| r.get(0))
        .expect("key file store id");
    assert_eq!(store_id, key_store, "matched by store id");
    assert_eq!(store_id.len(), 32);
}

/// The cost of a sealed write and a sealed recall, on a store of `UMBEL_SEAL_COST_RECORDS`
/// records (1000 by default): printed, not asserted, for the pull request (section 14's plan row
/// asks for the `release` profile: `cargo test --release --test memory_seal -- --nocapture cost`).
#[test]
fn cost_per_write_and_per_recall() {
    let total: u64 = std::env::var("UMBEL_SEAL_COST_RECORDS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(1000);
    let dir = tempfile::tempdir().expect("a temporary directory");
    let m = open_memory(dir.path(), "main", StoreOptions::default()).expect("opening");
    let text = |k: u64| {
        format!(
            "a paragraph of ordinary words for record {k}: rollbacks, canary flags, nightly \
             backups, restarts and the release train, about forty words long so the index has a \
             realistic size per record"
        )
    };
    let mut n = 1;
    while n <= total {
        let entries = (n..(n + 250).min(total + 1))
            .map(|k| {
                samples::memory_entry(
                    k,
                    ADA,
                    &[P_ADA],
                    &format!("record {k} about deploys"),
                    &text(k),
                )
            })
            .collect();
        m.write(samples::memory_batch(T0, entries))
            .expect("a batch");
        n += 250;
    }
    let rounds = 100_u64;
    let started = std::time::Instant::now();
    for k in 0..rounds {
        let id = total + 1 + k;
        m.write(samples::memory_batch(
            T0,
            vec![samples::memory_entry(
                id,
                ADA,
                &[P_ADA],
                &format!("record {id}"),
                &text(id),
            )],
        ))
        .expect("a write");
    }
    let write = started.elapsed() / u32::try_from(rounds).unwrap_or(1);
    let query = |q: &str, limit: u32| umbel_store::memory::RecallQuery {
        query: umbel_store::MemoryQuery::parse(q).expect("a query"),
        scope: umbel_store::ScopeQuery::default(),
        classes: Vec::new(),
        tags: Vec::new(),
        authorities: Vec::new(),
        push: None,
        as_of: AsOf::at(T0 + 10),
        flags: ReadFlags {
            include_flagged: true,
            include_expired: true,
            now: T0 + 10,
        },
        limit,
    };
    let mut recall = Vec::new();
    for limit in [10_u32, 50] {
        let q = query("rollbacks deploys", limit);
        let started = std::time::Instant::now();
        let mut hits = 0;
        for _ in 0..rounds {
            hits = m.recall(&q, &ada()).expect("recall").hits.len();
        }
        recall.push((
            limit,
            hits,
            started.elapsed() / u32::try_from(rounds).unwrap_or(1),
        ));
    }
    let started = std::time::Instant::now();
    for k in 1..=rounds {
        let _ = get(&*m, k).expect("get");
    }
    let get_cost = started.elapsed() / u32::try_from(rounds).unwrap_or(1);
    println!(
        "on {total} records: write of one record {write:?}; recall {recall:?} \
         (limit, hits, time); get {get_cost:?}"
    );
}
