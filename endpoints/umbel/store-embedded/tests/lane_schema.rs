//! The embedded schema's versions 2 and 3 (records host specification, sections 5.1 and 15.2):
//! a version 1 store, with records in it, and a version 2 store, with a declared kind's lane in
//! it, each open as version 3 with their rows intact; every table and index of section 5.1 is
//! there; the schema version is a build constant; a kind declared after records of it exist is
//! stale until a rebuild; and no document of a migrated store is held to its file.
//!
//! `fixtures/store-v1.sql` and `store-v2.sql` are dumps of stores the code before each schema
//! wrote.

// Integration-test helpers fail by panicking; clippy exempts only `#[test]` bodies themselves.
#![allow(clippy::expect_used, clippy::unwrap_used)]

mod support;

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde_json::json;
use support::open_with;
use umbel_store::lane::{
    FindOrder, LaneState, LaneWrite, Pointer, RecordDecl, RecordFind, Standing, StandingView,
};
use umbel_store::{
    ChangeKind, DocumentStore, Expect, ReaderFilter, STORE_TRAITS_VERSION, StoreError,
    conformance::samples,
};
use umbel_store_embedded::{SCHEMA_VERSION, SqliteStore, StoreOptions};

const V1: &str = include_str!("fixtures/store-v1.sql");
const V2: &str = include_str!("fixtures/store-v2.sql");

fn database(dir: &Path) -> PathBuf {
    dir.join("store").join("store.sqlite3")
}

/// The version 1 store of the fixture, as a file under `dir`, in WAL mode as a store leaves it.
fn version_1(dir: &Path) -> Connection {
    std::fs::create_dir_all(dir.join("store")).expect("the store directory");
    let raw = Connection::open(database(dir)).expect("a raw connection");
    raw.query_row("PRAGMA journal_mode=WAL", [], |r| r.get::<_, String>(0))
        .expect("WAL");
    raw.execute_batch(V1).expect("the version 1 dump");
    assert_eq!(user_version(&raw), 1, "the fixture is a version 1 store");
    raw
}

fn user_version(raw: &Connection) -> u32 {
    raw.query_row("PRAGMA user_version", [], |r| r.get(0))
        .expect("user_version")
}

fn meta(raw: &Connection, key: &str) -> Option<String> {
    use rusqlite::OptionalExtension;
    raw.query_row("SELECT value FROM meta WHERE key = ?1", [key], |r| r.get(0))
        .optional()
        .expect("meta")
}

/// Every table and index of the database, by name, with its SQL.
fn objects(raw: &Connection) -> Vec<(String, String, String)> {
    raw.prepare(
        "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type, name",
    )
    .expect("prepare")
    .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
    .expect("query")
    .collect::<Result<_, _>>()
    .expect("rows")
}

fn names(raw: &Connection, kind: &str) -> BTreeSet<String> {
    objects(raw)
        .into_iter()
        .filter(|(found, _, _)| found == kind)
        .map(|(_, name, _)| name)
        .collect()
}

fn everyone() -> ReaderFilter {
    ReaderFilter::tokens(["space"]).unwrap()
}

fn all_seeing() -> ReaderFilter {
    ReaderFilter::tokens(["space", "group:growers", "principal:human:local"]).unwrap()
}

fn view() -> StandingView {
    StandingView {
        own: Vec::new(),
        command_writable: Vec::new(),
        person: Vec::new(),
        admit: vec![Standing::Unverified, Standing::Attested, Standing::Affirmed],
    }
}

/// The kind the fixture's notes would be declared as.
fn note() -> RecordDecl {
    RecordDecl {
        kind: "note".to_owned(),
        standing: false,
        text: vec![Pointer::parse("/statement").unwrap()],
        keys: vec![
            Pointer::parse("/bed").unwrap(),
            Pointer::parse("/tags").unwrap(),
        ],
        matched: Some(0),
    }
}

fn find_all(order: FindOrder) -> RecordFind {
    RecordFind {
        kind: "note".to_owned(),
        keys: Vec::new(),
        standings: Vec::new(),
        verified_only: false,
        text: None,
        order,
        after: None,
        limit: 200,
        total: true,
    }
}

#[test]
fn the_schema_version_is_a_build_constant() {
    assert_eq!(SCHEMA_VERSION, 3);
    let dir = tempfile::tempdir().expect("a temporary directory");
    let store = open_with(dir.path(), "main", StoreOptions::default()).expect("opening");
    assert_eq!(store.info().expect("info").schema_version, SCHEMA_VERSION);
    let raw = Connection::open(database(dir.path())).expect("a raw connection");
    assert_eq!(user_version(&raw), SCHEMA_VERSION);
    assert_eq!(
        meta(&raw, "store_traits_version").as_deref(),
        Some(STORE_TRAITS_VERSION.to_string().as_str())
    );
    assert_eq!(
        meta(&raw, "lane_normalisation").as_deref(),
        Some("1"),
        "the identical digest's normalisation version is recorded"
    );
}

#[test]
fn a_new_store_has_every_table_and_index_of_section_5_1() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    drop(open_with(dir.path(), "main", StoreOptions::default()).expect("opening"));
    let raw = Connection::open(database(dir.path())).expect("a raw connection");
    let tables = names(&raw, "table");
    for table in [
        "record_kinds",
        "record_lane",
        "record_terms",
        "record_keys",
        "record_vectors",
        "record_evidence",
        "record_decisions",
        "doc_own",
        "doc_held",
    ] {
        assert!(tables.contains(table), "{table} is missing: {tables:?}");
    }
    let indexes = names(&raw, "index");
    for index in [
        "record_lane_by_recency",
        "record_lane_by_digest",
        "record_terms_by_lane",
        "record_keys_by_lane",
        "record_evidence_by_doc",
        "record_decisions_by_record",
    ] {
        assert!(indexes.contains(index), "{index} is missing: {indexes:?}");
    }
    // Every lane table is STRICT, and the digest index is partial.
    for (kind, name, sql) in objects(&raw) {
        if kind == "table" && (name.starts_with("record_") || name.starts_with("doc_")) {
            assert!(sql.contains("STRICT"), "{name} is not STRICT");
        }
        if name == "record_lane_by_digest" {
            assert!(sql.contains("WHERE match_digest IS NOT NULL"), "{sql}");
        }
    }
    // Every lane row hangs from `record_lane`, which hangs from `records`, by cascade.
    for (table, parent) in [
        ("record_lane", "records"),
        ("record_terms", "record_lane"),
        ("record_keys", "record_lane"),
        ("record_vectors", "record_lane"),
        ("record_evidence", "record_lane"),
        ("doc_own", "documents"),
        ("doc_held", "documents"),
    ] {
        let found: Vec<(String, String)> = raw
            .prepare(&format!("PRAGMA foreign_key_list({table})"))
            .expect("prepare")
            .query_map([], |r| Ok((r.get(2)?, r.get(6)?)))
            .expect("query")
            .collect::<Result<_, _>>()
            .expect("rows");
        assert_eq!(
            found
                .first()
                .map(|(to, on_delete)| (to.as_str(), on_delete.as_str())),
            Some((parent, "CASCADE")),
            "{table}"
        );
    }
}

#[test]
fn a_version_1_store_opens_as_the_current_version_with_its_records_intact() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let raw = version_1(dir.path());
    let before = objects(&raw);
    let rows = |raw: &Connection, table: &str| -> Vec<String> {
        raw.prepare(&format!(
            "SELECT quote(rev) || content_hash FROM {table} ORDER BY 1"
        ))
        .expect("prepare")
        .query_map([], |r| r.get(0))
        .expect("query")
        .collect::<Result<_, _>>()
        .expect("rows")
    };
    let (records_before, documents_before) = (rows(&raw, "records"), rows(&raw, "documents"));
    assert_eq!(records_before.len(), 4);
    drop(raw);

    let store = open_with(dir.path(), "main", StoreOptions::default()).expect("migrating");
    assert_eq!(store.info().expect("info").schema_version, SCHEMA_VERSION);
    let raw = Connection::open(database(dir.path())).expect("a raw connection");
    assert_eq!(user_version(&raw), SCHEMA_VERSION);
    assert_eq!(meta(&raw, "space").as_deref(), Some("main"));
    assert_eq!(meta(&raw, "store_traits_version").as_deref(), Some("3"));
    assert_eq!(meta(&raw, "lane_normalisation").as_deref(), Some("1"));
    // Version 1's tables and indexes are as they were, statement for statement, and their rows.
    let after = objects(&raw);
    for object in &before {
        assert!(after.contains(object), "{} changed", object.1);
    }
    assert_eq!(rows(&raw, "records"), records_before);
    assert_eq!(rows(&raw, "documents"), documents_before);
    // The migrated schema is a new store's.
    let fresh_dir = tempfile::tempdir().expect("a temporary directory");
    drop(open_with(fresh_dir.path(), "main", StoreOptions::default()).expect("a new store"));
    let fresh = Connection::open(database(fresh_dir.path())).expect("a raw connection");
    assert_eq!(
        after,
        objects(&fresh),
        "a migrated store has a new store's schema"
    );
    // The lane is empty: the migration indexes nothing, declares nothing and holds no
    // document to a file.
    for table in [
        "record_kinds",
        "record_lane",
        "record_terms",
        "record_keys",
        "doc_held",
    ] {
        let count: i64 = raw
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
            .expect("count");
        assert_eq!(count, 0, "{table}");
    }

    // Every undeclared kind behaves as before.
    let note = store
        .get_record("notes", "note", "n1", &everyone())
        .expect("get")
        .expect("the note is readable");
    assert_eq!(note.rev, 6);
    assert_eq!(note.body["bed"], "east");
    assert!(
        store
            .get_record("notes", "note", "n2", &everyone())
            .expect("get")
            .is_none(),
        "a private note stays private"
    );
    let listed = store
        .list_records("notes", "note", None, 10, &all_seeing())
        .expect("list");
    assert_eq!(
        listed
            .items
            .iter()
            .map(|r| r.id.as_str())
            .collect::<Vec<_>>(),
        ["n1", "n2", "n3"]
    );
    assert!(
        store
            .get_document("journal/roses", &everyone())
            .expect("get")
            .is_some()
    );
    assert_eq!(store.head().expect("head"), 6);
    let changes = store
        .changes(0, 100, &ReaderFilter::derivation(), None)
        .expect("changes");
    assert_eq!(changes.len(), 6);
    assert_eq!(changes[0].kind, ChangeKind::Put);
    let written = store
        .put_record(
            "notes",
            "sync",
            "state",
            json!({ "cursor": 8 }),
            samples::envelope(&["space"], "t", "2026-11-12T09:00:00.000Z"),
            Expect::Any,
        )
        .expect("an undeclared put after the migration");
    assert_eq!(written.rev, 7);
    let untouched: i64 = raw
        .query_row("SELECT COUNT(*) FROM record_kinds", [], |r| r.get(0))
        .expect("count");
    assert_eq!(untouched, 0, "an undeclared put touches no lane table");

    // Opening again migrates nothing more.
    drop(store);
    let again = SqliteStore::open(dir.path(), "main", StoreOptions::default()).expect("reopening");
    assert_eq!(again.head().expect("head"), 7);
    assert_eq!(objects(&raw), after);
}

/// The version 2 store of the fixture, as a file under `dir`.
fn version_2(dir: &Path) -> Connection {
    std::fs::create_dir_all(dir.join("store")).expect("the store directory");
    let raw = Connection::open(database(dir)).expect("a raw connection");
    raw.query_row("PRAGMA journal_mode=WAL", [], |r| r.get::<_, String>(0))
        .expect("WAL");
    raw.execute_batch(V2).expect("the version 2 dump");
    assert_eq!(user_version(&raw), 2, "the fixture is a version 2 store");
    raw
}

#[test]
fn a_version_2_store_opens_as_version_3_with_its_lane_intact_and_no_document_held() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let raw = version_2(dir.path());
    let before = objects(&raw);
    let rows = |raw: &Connection, sql: &str| -> Vec<String> {
        raw.prepare(sql)
            .expect("prepare")
            .query_map([], |r| r.get(0))
            .expect("query")
            .collect::<Result<_, _>>()
            .expect("rows")
    };
    let tables = [
        "SELECT doc || content_hash || quote(rev) FROM documents ORDER BY 1",
        "SELECT id || content_hash || quote(rev) FROM records ORDER BY 1",
        "SELECT id || wording_hash || quote(lane) || quote(created_rev) FROM record_lane ORDER BY 1",
        "SELECT term || quote(lane) || quote(tf) FROM record_terms ORDER BY 1",
        "SELECT value || quote(lane) FROM record_keys ORDER BY 1",
        "SELECT kind || decl_hash || quote(stale) || quote(generation) FROM record_kinds ORDER BY 1",
        "SELECT quote(rev) || kind || target FROM changes ORDER BY 1",
    ];
    let rows_before: Vec<Vec<String>> = tables.iter().map(|sql| rows(&raw, sql)).collect();
    assert_eq!(rows_before[0].len(), 2, "two documents");
    assert_eq!(rows_before[2].len(), 2, "two lane rows");
    drop(raw);

    let store = open_with(dir.path(), "main", StoreOptions::default()).expect("migrating");
    assert_eq!(store.info().expect("info").schema_version, 3);
    let raw = Connection::open(database(dir.path())).expect("a raw connection");
    assert_eq!(user_version(&raw), 3);
    // Version 2's tables and indexes are as they were, statement for statement, and their rows.
    let after = objects(&raw);
    for object in &before {
        assert!(after.contains(object), "{} changed", object.1);
    }
    let rows_after: Vec<Vec<String>> = tables.iter().map(|sql| rows(&raw, sql)).collect();
    assert_eq!(rows_after, rows_before);
    // The migrated schema is a new store's.
    let fresh_dir = tempfile::tempdir().expect("a temporary directory");
    drop(open_with(fresh_dir.path(), "main", StoreOptions::default()).expect("a new store"));
    let fresh = Connection::open(database(fresh_dir.path())).expect("a raw connection");
    assert_eq!(
        after,
        objects(&fresh),
        "a migrated store has a new store's schema"
    );
    // The one new table is empty: no document a version 2 store holds was held to its file,
    // so none is the person's own by collection until the host holds it.
    let held: i64 = raw
        .query_row("SELECT COUNT(*) FROM doc_held", [], |r| r.get(0))
        .expect("count");
    assert_eq!(held, 0);
    assert_eq!(store.unheld_documents("journal").expect("unheld"), 1);
    assert_eq!(store.unheld_documents("talks").expect("unheld"), 1);

    // The lane serves as it did: the kind is ready under its declaration, with no rebuild.
    let note = RecordDecl {
        standing: true,
        text: vec![Pointer::parse("/statement").expect("a pointer")],
        keys: vec![Pointer::parse("/bed").expect("a pointer")],
        matched: Some(0),
        ..note()
    };
    assert_eq!(
        store.lane_status("notes", &note).expect("status").state,
        LaneState::Ready
    );
    let own = StandingView {
        own: vec![umbel_store::lane::OwnCollection {
            id: "journal".to_owned(),
            speaker: None,
        }],
        person: vec!["human:local".to_owned()],
        ..view()
    };
    let read = store
        .read_record("notes", &note, "n1", &own, &everyone())
        .expect("read")
        .expect("the note is readable");
    assert_eq!(read.record.body["statement"], "Prune roses in late winter.");
    assert_eq!(
        read.label.expect("a label").standing,
        Standing::Unverified,
        "a standing record of a migrated store reads unverified"
    );
    // Two handles opening it again migrate nothing more.
    let again = open_with(dir.path(), "main", StoreOptions::default()).expect("opening again");
    assert_eq!(again.info().expect("info").schema_version, 3);
    assert_eq!(objects(&raw), after);
}

#[test]
fn the_migration_sets_the_traits_version_a_store_was_created_under() {
    // A store created before the records host specification's step B1 recorded traits version 2.
    let dir = tempfile::tempdir().expect("a temporary directory");
    let raw = version_1(dir.path());
    raw.execute(
        "UPDATE meta SET value = '2' WHERE key = 'store_traits_version'",
        [],
    )
    .expect("an older traits version");
    drop(raw);
    drop(open_with(dir.path(), "main", StoreOptions::default()).expect("migrating"));
    let raw = Connection::open(database(dir.path())).expect("a raw connection");
    assert_eq!(meta(&raw, "store_traits_version").as_deref(), Some("3"));
    let rows: i64 = raw
        .query_row(
            "SELECT COUNT(*) FROM meta WHERE key = 'store_traits_version'",
            [],
            |r| r.get(0),
        )
        .expect("count");
    assert_eq!(rows, 1, "the value is set, not inserted beside the old one");
}

#[test]
fn two_handles_opening_a_version_1_store_migrate_it_once() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    drop(version_1(dir.path()));
    let path = dir.path().to_owned();
    let opened: Vec<_> = (0..4)
        .map(|_| {
            let path = path.clone();
            std::thread::spawn(move || {
                SqliteStore::open(&path, "main", StoreOptions::default()).map(|s| s.head())
            })
        })
        .collect();
    for handle in opened {
        let head = handle.join().expect("a thread").expect("opening");
        assert_eq!(head.expect("head"), 6);
    }
    let raw = Connection::open(database(dir.path())).expect("a raw connection");
    assert_eq!(user_version(&raw), SCHEMA_VERSION);
}

#[test]
fn a_kind_declared_after_its_records_exist_is_stale_until_a_rebuild() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    drop(version_1(dir.path()));
    let store = open_with(dir.path(), "main", StoreOptions::default()).expect("migrating");
    let decl = note();
    // The fixture's three notes were written before any declaration.
    let status = store.lane_status("notes", &decl).expect("status");
    assert_eq!(status.state, LaneState::Stale);
    assert_eq!(
        (status.stored, status.records, status.unindexed),
        (None, 3, 3)
    );
    let stale = |error: StoreError| assert_eq!(error, StoreError::LaneStale);
    stale(
        store
            .read_record("notes", &decl, "n1", &view(), &everyone())
            .expect_err("a read before the rebuild"),
    );
    stale(
        store
            .find_records(
                "notes",
                &decl,
                &find_all(FindOrder::Id),
                &view(),
                &everyone(),
            )
            .expect_err("a find before the rebuild"),
    );
    stale(
        store
            .put_declared_record(
                "notes",
                &decl,
                "n4",
                json!({ "statement": "Roses want morning sun." }),
                samples::envelope(&["space"], "t", "2026-11-12T09:00:00.000Z"),
                Expect::Absent,
                LaneWrite {
                    evidence: None,
                    flags: Vec::new(),
                    model: None,
                },
                &all_seeing(),
            )
            .expect_err("a declared put before the rebuild"),
    );
    // The undeclared reads are as before, stale or not.
    assert!(
        store
            .get_record("notes", "note", "n1", &everyone())
            .expect("get")
            .is_some()
    );

    let report = store
        .reindex_records("notes", &decl, &|_| Vec::new(), None, false)
        .expect("the rebuild");
    assert_eq!(
        (
            report.records,
            report.unindexed,
            report.wordings_changed,
            report.superseded
        ),
        (3, 0, 0, false)
    );
    let status = store.lane_status("notes", &decl).expect("status");
    assert_eq!((status.state, status.unindexed), (LaneState::Ready, 0));
    assert_eq!(status.with_match, 3);

    // Each record is found, by its own readers and no others, at its first put.
    let page = store
        .find_records(
            "notes",
            &decl,
            &find_all(FindOrder::Recent),
            &view(),
            &all_seeing(),
        )
        .expect("find");
    assert_eq!(
        page.items
            .iter()
            .map(|item| item.record.id.as_str())
            .collect::<Vec<_>>(),
        ["n3", "n2", "n1"],
        "by the first revision, though n1 was written again last"
    );
    let n1 = page.items.last().expect("n1");
    assert_eq!(n1.created_at, "2026-11-02T10:00:00.000Z");
    assert_eq!(n1.record.rev, 6);
    let visible = store
        .find_records(
            "notes",
            &decl,
            &find_all(FindOrder::Id),
            &view(),
            &everyone(),
        )
        .expect("find");
    assert_eq!(visible.total, Some(1), "access sets are not touched");
    let by_text = RecordFind {
        text: Some(umbel_store::lane::TextQuery {
            query: "pruning roses in winter".to_owned(),
            fields: Vec::new(),
        }),
        order: FindOrder::Rank,
        ..find_all(FindOrder::Rank)
    };
    let ranked = store
        .find_records("notes", &decl, &by_text, &view(), &everyone())
        .expect("a ranked find");
    assert_eq!(ranked.items.len(), 1);
    assert_eq!(ranked.items[0].record.id, "n1");
    // The other kind of the namespace was never declared and has no row.
    let raw = Connection::open(database(dir.path())).expect("a raw connection");
    let kinds: Vec<String> = raw
        .prepare("SELECT kind FROM record_kinds")
        .expect("prepare")
        .query_map([], |r| r.get(0))
        .expect("query")
        .collect::<Result<_, _>>()
        .expect("rows");
    assert_eq!(kinds, ["note"]);
}

#[test]
fn a_newer_schema_than_this_builds_is_refused() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    drop(open_with(dir.path(), "main", StoreOptions::default()).expect("creating"));
    let raw = Connection::open(database(dir.path())).expect("a raw connection");
    raw.pragma_update(None, "user_version", SCHEMA_VERSION + 1)
        .expect("bumping the version");
    drop(raw);
    let error = SqliteStore::open(dir.path(), "main", StoreOptions::default())
        .err()
        .expect("a refusal");
    assert_eq!(
        error,
        StoreError::VersionUnsupported {
            found: SCHEMA_VERSION + 1,
            supported: SCHEMA_VERSION
        }
    );
}
