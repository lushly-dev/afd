//! The tantivy index beside the suite: its on-disk form (LZ4, the payload, the layout),
//! durability, checksums, snippets, scores that do not depend on the reader, a second handle
//! seeing another's commits, the writer wait, and the petgraph cache.

// Integration-test helpers fail by panicking; clippy exempts only `#[test]` bodies themselves.
#![allow(clippy::expect_used, clippy::unwrap_used)]

mod support;

use std::time::{Duration, Instant};

use serde_json::Value;
use support::{open, open_index};
use umbel_store::conformance::samples;
use umbel_store::{
    DocGraph, DocumentStore, Expect, GraphBatch, GraphStore, IndexChunk, IndexFilters, IndexQuery,
    Node, ReaderFilter, SearchIndex, StoreError,
};
use umbel_store_embedded::{GRAPH_CACHE_ENTRIES, SqliteStore, StoreOptions, TantivyIndex};

fn space() -> ReaderFilter {
    ReaderFilter::tokens(["space"]).expect("a valid token")
}

fn ask(text: &str) -> IndexQuery {
    IndexQuery {
        text: text.to_owned(),
        filters: IndexFilters::default(),
        limit: 50,
    }
}

fn chunk(doc: &str, title: &str, body: &str, access: &[&str]) -> IndexChunk {
    samples::chunk(doc, 0, title, body, access)
}

fn commit(index: &dyn SearchIndex, chunks: Vec<IndexChunk>, applied: u64) {
    let mut writer = index.writer().expect("a writer");
    for chunk in chunks {
        let doc = chunk.doc.clone();
        writer.replace(&doc, vec![chunk]).expect("replace");
    }
    writer.commit(applied).expect("commit");
}

fn meta(dir: &std::path::Path) -> Value {
    let text =
        std::fs::read_to_string(dir.join("index").join("v1").join("meta.json")).expect("meta.json");
    serde_json::from_str(&text).expect("json")
}

#[test]
fn the_index_is_lz4_in_index_v1_with_the_revision_as_its_commit_payload() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let index = TantivyIndex::open(dir.path(), "main", StoreOptions::default()).expect("opening");
    assert_eq!(index.path(), dir.path().join("index").join("v1"));
    assert_eq!(
        meta(dir.path())["index_settings"]["docstore_compression"],
        "lz4",
        "the compressor is named in the index, never a default"
    );
    commit(
        &index,
        vec![chunk("a/one", "One", "first note", &["space"])],
        42,
    );
    let payload: Value =
        serde_json::from_str(meta(dir.path())["payload"].as_str().expect("a payload"))
            .expect("json");
    assert_eq!(payload, serde_json::json!({"applied": 42, "schema": 1}));
    let info = index.info().expect("info");
    assert_eq!((info.applied, info.schema_version, info.chunks), (42, 1, 1));
    assert!(info.segments >= 1 && info.bytes > 0);
    assert!(
        index
            .live_files()
            .expect("files")
            .iter()
            .any(|f| f.to_string_lossy() == "meta.json")
    );
}

#[test]
fn reopening_returns_the_same_revision_and_chunks() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    {
        let index =
            TantivyIndex::open(dir.path(), "main", StoreOptions::default()).expect("opening");
        let mut rich = chunk("a/one", "One", "first note", &["space", "group:eng"]);
        rich.tags = vec!["t".into()];
        rich.updated = Some("2026-02-03T04:05:06Z".into());
        rich.meta = serde_json::json!({"k": "v"}).as_object().cloned().unwrap();
        commit(&index, vec![rich], 9);
    }
    let index = TantivyIndex::open(dir.path(), "main", StoreOptions::default()).expect("reopening");
    assert_eq!(index.applied().expect("applied"), 9);
    let chunks = index.chunks("a/one", &space()).expect("chunks");
    assert_eq!(chunks.len(), 1);
    assert_eq!(chunks[0].access.tokens(), ["group:eng", "space"]);
    assert_eq!(chunks[0].updated.as_deref(), Some("2026-02-03T04:05:06Z"));
    assert_eq!(chunks[0].meta["k"], "v");
}

#[test]
fn a_damaged_segment_is_found_by_the_checksum_validation() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let index = TantivyIndex::open(dir.path(), "main", StoreOptions::default()).expect("opening");
    commit(
        &index,
        vec![chunk(
            "a/one",
            "One",
            "first note about checksums",
            &["space"],
        )],
        1,
    );
    assert!(index.check().expect("check").damaged.is_empty(), "sound");
    // Flip a byte in the middle of a live segment's postings file.
    let victim = index
        .live_files()
        .expect("files")
        .into_iter()
        .find(|f| f.extension().is_some_and(|e| e == "idx"))
        .expect("a postings file");
    let path = dir.path().join("index").join("v1").join(&victim);
    let mut bytes = std::fs::read(&path).expect("read");
    let middle = bytes.len() / 2;
    bytes[middle] ^= 0xFF;
    std::fs::write(&path, bytes).expect("write");
    let check = index.check().expect("check");
    assert_eq!(
        check.damaged,
        vec![victim.display().to_string()],
        "the damaged file is named"
    );
}

#[test]
fn a_newer_schema_is_refused_with_what_this_build_serves() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    {
        let index =
            TantivyIndex::open(dir.path(), "main", StoreOptions::default()).expect("opening");
        commit(&index, vec![chunk("a/one", "One", "note", &["space"])], 1);
    }
    let path = dir.path().join("index").join("v1").join("meta.json");
    let mut value: Value = serde_json::from_slice(&std::fs::read(&path).expect("read")).unwrap();
    value["payload"] = Value::String(r#"{"applied":1,"schema":2}"#.to_owned());
    std::fs::write(&path, serde_json::to_vec(&value).unwrap()).expect("write");
    let error = TantivyIndex::open(dir.path(), "main", StoreOptions::default())
        .err()
        .expect("refused");
    assert_eq!(
        error,
        StoreError::VersionUnsupported {
            found: 2,
            supported: 1
        }
    );
}

#[test]
fn hits_carry_a_highlighted_snippet_and_the_stored_chunk() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let index = TantivyIndex::open(dir.path(), "main", StoreOptions::default()).expect("opening");
    let body = "Filler text. ".repeat(40)
        + "Then the canary is reverted before the fleet. "
        + &"More filler. ".repeat(40);
    commit(&index, vec![chunk("a/one", "One", &body, &["space"])], 1);
    let hits = index.search(&ask("canary"), &space()).expect("search");
    assert_eq!(hits.len(), 1);
    let snippet = hits[0].snippet.as_deref().expect("a snippet");
    assert!(snippet.contains("**canary**"), "{snippet}");
    assert!(snippet.chars().count() <= 260, "{}", snippet.len());
    assert_eq!(hits[0].chunk.body, body, "the stored chunk is whole");
    assert_eq!((hits[0].doc.as_str(), hits[0].ordinal), ("a/one", 0));
    // A match outside the body has no snippet to show.
    let titled = index.search(&ask("title:one"), &space()).expect("search");
    assert!(titled[0].snippet.is_none());
}

#[test]
fn a_score_does_not_depend_on_who_is_asking_or_the_filters() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let index = TantivyIndex::open(dir.path(), "main", StoreOptions::default()).expect("opening");
    commit(
        &index,
        vec![
            chunk(
                "a/one",
                "Rollout",
                "rollout plan for the quarter",
                &["space"],
            ),
            chunk("a/two", "Rollout", "rollout plan, hidden", &["group:sec"]),
        ],
        1,
    );
    let plain = index.search(&ask("rollout"), &space()).expect("search");
    let wide = ReaderFilter::tokens(["space", "group:sec", "group:other", "principal:human:ada"])
        .expect("a reader");
    let seen_by_more = index.search(&ask("rollout"), &wide).expect("search");
    let derived = index
        .search(&ask("rollout"), &ReaderFilter::derivation())
        .expect("search");
    let first = |hits: &[umbel_store::ChunkHit]| {
        hits.iter()
            .find(|h| h.doc == "a/one")
            .map(|h| h.score)
            .expect("a/one")
    };
    // BM25 statistics are the index's (owner decision 4); the reader's tokens add nothing.
    assert_eq!(first(&plain).to_bits(), first(&seen_by_more).to_bits());
    assert_eq!(first(&plain).to_bits(), first(&derived).to_bits());
    let filtered = index
        .search(
            &IndexQuery {
                filters: IndexFilters {
                    collection: Some("a".into()),
                    ..IndexFilters::default()
                },
                ..ask("rollout")
            },
            &space(),
        )
        .expect("search");
    assert_eq!(first(&plain).to_bits(), first(&filtered).to_bits());
}

#[test]
fn a_prefix_scores_the_fields_boost_and_nothing_else() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let index = TantivyIndex::open(dir.path(), "main", StoreOptions::default()).expect("opening");
    commit(
        &index,
        vec![
            chunk("a/one", "Rollout", "unrelated", &["space"]),
            chunk("a/two", "Rollover", "unrelated", &["space"]),
        ],
        1,
    );
    let hits = index.search(&ask("title:roll*"), &space()).expect("search");
    assert_eq!(hits.len(), 2);
    for hit in hits {
        assert!(
            (hit.score - 3.0).abs() < 1e-6,
            "constant 1 x boost 3: {}",
            hit.score
        );
    }
    let hits = index
        .search(&ask("title:roll*^2"), &space())
        .expect("search");
    assert!(
        hits.iter().all(|h| (h.score - 6.0).abs() < 1e-6),
        "a user boost multiplies"
    );
}

#[test]
fn a_second_handle_sees_commits_made_through_the_first() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let writer_side = open_index(dir.path(), "main", StoreOptions::default()).expect("opening");
    let reader_side = open_index(dir.path(), "main", StoreOptions::default()).expect("opening");
    assert!(
        reader_side
            .search(&ask("note"), &space())
            .expect("search")
            .is_empty()
    );
    commit(
        &*writer_side,
        vec![chunk("a/one", "One", "a note", &["space"])],
        3,
    );
    // ReloadPolicy::Manual with a reload before each search: no sleeps, no staleness.
    assert_eq!(
        reader_side
            .search(&ask("note"), &space())
            .expect("search")
            .len(),
        1
    );
    assert_eq!(reader_side.applied().expect("applied"), 3);
    assert_eq!(
        reader_side.chunks("a/one", &space()).expect("chunks").len(),
        1
    );
}

#[test]
fn the_writer_wait_is_bounded_by_the_lock_timeout() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let index = open_index(
        dir.path(),
        "main",
        StoreOptions {
            lock_timeout_ms: 200,
        },
    )
    .expect("opening");
    let held = index.writer().expect("the first writer");
    let started = Instant::now();
    assert_eq!(index.writer().err(), Some(StoreError::Busy));
    let waited = started.elapsed();
    assert!(waited >= Duration::from_millis(150), "{waited:?}");
    assert!(waited < Duration::from_secs(10), "{waited:?}");
    drop(held);
    index.writer().expect("free again");
}

#[test]
fn chunk_caps_are_enforced_before_anything_is_staged() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let index = TantivyIndex::open(dir.path(), "main", StoreOptions::default()).expect("opening");
    let mut writer = index.writer().expect("a writer");
    let many: Vec<IndexChunk> = (0..2001)
        .map(|n| {
            let mut c = chunk("a/one", "One", "x", &["space"]);
            c.ordinal = n;
            c
        })
        .collect();
    assert!(matches!(
        writer.replace(&"a/one".to_owned(), many),
        Err(StoreError::TooLarge(_))
    ));
    let big = chunk("a/one", "One", &"x ".repeat(600_000), &["space"]);
    assert!(matches!(
        writer.replace(&"a/one".to_owned(), vec![big]),
        Err(StoreError::TooLarge(_))
    ));
    let mut bad_date = chunk("a/one", "One", "x", &["space"]);
    bad_date.updated = Some("yesterday".into());
    assert!(matches!(
        writer.replace(&"a/one".to_owned(), vec![bad_date]),
        Err(StoreError::Invalid(_))
    ));
    writer.commit(1).expect("commit");
    assert!(index.chunks("a/one", &space()).expect("chunks").is_empty());
}

#[test]
fn a_finished_session_refuses_more_work() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let index = TantivyIndex::open(dir.path(), "main", StoreOptions::default()).expect("opening");
    let mut writer = index.writer().expect("a writer");
    writer.commit(1).expect("commit");
    assert!(matches!(
        writer.replace(&"a/one".to_owned(), vec![]),
        Err(StoreError::Invalid(_))
    ));
    assert!(matches!(writer.clear(), Err(StoreError::Invalid(_))));
    assert!(matches!(writer.commit(2), Err(StoreError::Invalid(_))));
    assert_eq!(writer.applied().expect("applied"), 1);
}

fn doc_graph(id: &str) -> Option<DocGraph> {
    Some(DocGraph {
        nodes: vec![Node {
            id: format!("doc:{id}"),
            kind: "document".to_owned(),
            label: id.to_owned(),
        }],
        edges: vec![],
    })
}

fn put(store: &SqliteStore, id: &str, access: &[&str]) {
    store
        .put_document(samples::document(id, access, id, "t"), Expect::Any)
        .expect("put");
}

#[test]
fn the_petgraph_cache_is_keyed_by_revisions_and_reader_and_bounded() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let stores = open(dir.path(), "main").expect("opening");
    let store = SqliteStore::open(dir.path(), "main", StoreOptions::default()).expect("opening");
    put(&store, "a/open", &["space"]);
    put(&store, "a/secret", &["group:sec"]);
    store
        .apply(
            GraphBatch {
                entries: vec![
                    ("a/open".into(), doc_graph("a/open")),
                    ("a/secret".into(), doc_graph("a/secret")),
                ],
            },
            2,
        )
        .expect("apply");
    drop(stores);
    let outsider = space();
    let insider = ReaderFilter::tokens(["space", "group:sec"]).expect("a reader");
    let first = store.readable_graph(&outsider).expect("graph");
    assert_eq!(first.graph.node_count(), 1, "only the readable node");
    assert!(first.node("doc:a/open").is_some() && first.node("doc:a/secret").is_none());
    let again = store.readable_graph(&outsider).expect("graph");
    assert!(
        std::sync::Arc::ptr_eq(&first, &again),
        "served from the cache"
    );
    let wide = store.readable_graph(&insider).expect("graph");
    assert_eq!(wide.graph.node_count(), 2, "another reader, another entry");
    let subgraph = store.subgraph(&outsider).expect("subgraph");
    assert_eq!(subgraph.nodes.len(), first.graph.node_count());
    // The cached form converts back to exactly what the trait method reads from SQL, so the host
    // can serve the whole-graph read from the cache.
    assert_eq!(first.to_subgraph(), subgraph);
    let wide_sql = store.subgraph(&insider).expect("subgraph");
    assert_eq!(wide.to_subgraph(), wide_sql);

    // Tightening a document's access moves the head, not the graph's applied revision, and the
    // edges it hides must disappear at once: the key includes the head.
    put(&store, "a/open", &["group:sec"]);
    let tightened = store.readable_graph(&outsider).expect("graph");
    assert!(!std::sync::Arc::ptr_eq(&first, &tightened));
    assert_eq!(tightened.graph.node_count(), 0, "hidden at once");

    // The cache holds at most eight graphs.
    for n in 0..(GRAPH_CACHE_ENTRIES + 3) {
        let reader = ReaderFilter::tokens(["space", &format!("group:g{n}")]).expect("a reader");
        store.readable_graph(&reader).expect("graph");
    }
    let evicted = store.readable_graph(&insider).expect("graph");
    assert!(
        !std::sync::Arc::ptr_eq(&wide, &evicted),
        "the least recently used entry was evicted"
    );
}
