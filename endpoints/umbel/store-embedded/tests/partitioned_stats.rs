//! Exact filtering in the embedded stores (phase 5 sections 9.1 and 9.2, D125): a reader's
//! results are computed from what it may read and nothing else, so writing, indexing or deleting
//! what it cannot read changes no byte of them, scores, order and snippets included; statistics
//! exclude deleted chunks; a prefix expands over readable terms only; memory recall ranks by BM25
//! over the readable matches alone, and refuses a query past the ceiling.

// Integration-test helpers fail by panicking; clippy exempts only `#[test]` bodies themselves.
#![allow(clippy::expect_used, clippy::unwrap_used)]

use umbel_store::conformance::samples;
use umbel_store::{ChunkHit, IndexChunk, IndexFilters, IndexQuery, ReaderFilter, SearchIndex};
use umbel_store_embedded::{StoreOptions, TantivyIndex};

fn reader(tokens: &[&str]) -> ReaderFilter {
    ReaderFilter::tokens(tokens.iter().copied()).expect("a valid reader")
}

fn bo() -> ReaderFilter {
    reader(&["space", "principal:human:bo"])
}

fn ada() -> ReaderFilter {
    reader(&["space", "principal:human:ada"])
}

fn ask(text: &str) -> IndexQuery {
    IndexQuery {
        text: text.to_owned(),
        filters: IndexFilters::default(),
        limit: 50,
    }
}

fn chunk(doc: &str, ordinal: u32, title: &str, body: &str, access: &[&str]) -> IndexChunk {
    let mut chunk = samples::chunk(doc, ordinal, title, body, access);
    chunk.tags = vec!["ops".into(), format!("tag-{}", body.len() % 3)];
    chunk.description = Some(format!("about {title}"));
    if let serde_json::Value::Object(meta) =
        serde_json::json!({ "team": if body.len().is_multiple_of(2) { "ops" } else { "dev" } })
    {
        chunk.meta = meta;
    }
    chunk
}

/// Replace each document with its chunks, in one commit at `applied`.
fn commit(index: &TantivyIndex, docs: Vec<(String, Vec<IndexChunk>)>, applied: u64) {
    let mut writer = index.writer().expect("a writer");
    for (doc, chunks) in docs {
        writer.replace(&doc, chunks).expect("replace");
    }
    writer.commit(applied).expect("commit");
}

fn one(doc: &str, title: &str, body: &str, access: &[&str]) -> (String, Vec<IndexChunk>) {
    (doc.to_owned(), vec![chunk(doc, 0, title, body, access)])
}

/// What the reader sees, as bytes: every hit with its score, snippet and chunk.
fn seen(index: &TantivyIndex, query: &IndexQuery, reader: &ReaderFilter) -> String {
    let hits: Vec<ChunkHit> = index.search(query, reader).expect("search");
    serde_json::to_string(&hits).expect("json")
}

/// The queries every differential runs: bare terms, phrases, fields, boosts, raw and meta
/// fields, prefixes, exclusions and the structured filters.
fn queries() -> Vec<IndexQuery> {
    let mut all: Vec<IndexQuery> = [
        "rollout",
        "rollout canary fleet",
        "\"canary release\"",
        "\"canary fleet\"~3",
        "title:rollout^2 body:canary",
        "tags:ops rollout",
        "meta.team:ops",
        "description:rollout",
        "rol*",
        "\"canary rel\"*",
        "fleet -canary",
        "+rollout plan",
        "path:runbook",
    ]
    .iter()
    .map(|text| ask(text))
    .collect();
    all.push(IndexQuery {
        filters: IndexFilters {
            tags: vec!["ops".into()],
            ..IndexFilters::default()
        },
        ..ask("rollout fleet")
    });
    all.push(IndexQuery {
        limit: 2,
        ..ask("rollout canary")
    });
    all
}

fn visible() -> Vec<(String, Vec<IndexChunk>)> {
    vec![
        one(
            "a/runbook",
            "Rollout runbook",
            "The rollout starts with a canary release, then the fleet follows.",
            &["space"],
        ),
        one(
            "a/plan",
            "Plan",
            "A rollout plan for the quarter: canary first, fleet later, rollback ready.",
            &["principal:human:bo"],
        ),
        (
            "a/long".to_owned(),
            vec![
                chunk(
                    "a/long",
                    0,
                    "Fleet notes",
                    "Fleet fleet fleet. The canary release went well.",
                    &["space"],
                ),
                chunk(
                    "a/long",
                    1,
                    "Fleet notes",
                    "Rolling restarts of the fleet; the rollout paused once.",
                    &["space"],
                ),
            ],
        ),
        one(
            "b/other",
            "Unrelated",
            "Nothing here mentions the deploy words at all.",
            &["space", "principal:human:ada"],
        ),
    ]
}

/// Ada's documents: the same vocabulary, many times over, and long bodies, so every statistic
/// would move if a hidden chunk counted; and more distinct `rol` terms than a prefix may expand
/// into, all sorting before every readable one.
fn hidden(round: usize) -> Vec<(String, Vec<IndexChunk>)> {
    let mut docs = Vec::new();
    for n in 0..30 {
        let body = format!(
            "rollout canary release fleet canary canary rollout plan {} {}",
            "secret ".repeat(n * 7 + round),
            "fleet ".repeat(n % 5)
        );
        docs.push(one(
            &format!("h/secret-{round}-{n}"),
            "Rollout secret",
            &body,
            &["principal:human:ada"],
        ));
    }
    let terms: Vec<String> = (0..300).map(|n| format!("rolaa{round}x{n:03}")).collect();
    docs.push(one(
        &format!("h/prefixes-{round}"),
        "Prefixes",
        &terms.join(" "),
        &["principal:human:ada"],
    ));
    docs.push(one(
        &format!("h/runbook-{round}"),
        "Runbook",
        "a canary release of the runbook, hidden",
        &["group:sec"],
    ));
    docs
}

#[test]
fn indexing_what_a_reader_cannot_read_changes_no_byte_of_its_results() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let index = TantivyIndex::open(dir.path(), "main", StoreOptions::default()).expect("opening");
    let mut docs = visible();
    let rest = docs.split_off(2);
    commit(&index, docs, 1);
    commit(&index, rest, 2);
    let before: Vec<String> = queries().iter().map(|q| seen(&index, q, &bo())).collect();
    let ada_before: Vec<String> = queries().iter().map(|q| seen(&index, q, &ada())).collect();
    assert!(
        before.iter().any(|hits| hits.contains("\"score\"")),
        "the readable set matches"
    );

    // Hidden writes in several commits (several segments), and deletes of hidden chunks.
    for round in 0..3 {
        commit(&index, hidden(round), 3 + round as u64);
    }
    commit(
        &index,
        vec![
            ("h/secret-0-1".to_owned(), Vec::new()),
            ("h/secret-1-2".to_owned(), Vec::new()),
            ("h/prefixes-2".to_owned(), Vec::new()),
        ],
        10,
    );
    for (query, expected) in queries().iter().zip(&before) {
        assert_eq!(
            &seen(&index, query, &bo()),
            expected,
            "`{}`: bo's results moved with what he cannot read",
            query.text
        );
    }
    // Ada reads the hidden chunks: her results move, so the queries do reach them.
    let ada_after: Vec<String> = queries().iter().map(|q| seen(&index, q, &ada())).collect();
    assert_ne!(ada_before, ada_after);
}

#[test]
fn a_prefix_expands_over_the_readers_terms_only() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let index = TantivyIndex::open(dir.path(), "main", StoreOptions::default()).expect("opening");
    commit(&index, visible(), 1);
    // 600 hidden `rol` terms, in one segment, all sorting before `rollout`.
    commit(&index, hidden(0), 2);
    commit(&index, hidden(1), 3);
    let hits = index.search(&ask("body:rol*"), &bo()).expect("search");
    let docs: Vec<&str> = hits.iter().map(|h| h.doc.as_str()).collect();
    for doc in ["a/runbook", "a/plan", "a/long"] {
        assert!(docs.contains(&doc), "{doc} in {docs:?}");
    }
    // Ada's expansion is capped at 256 readable terms, the first in byte order: hers.
    let hers = index.search(&ask("body:rol*"), &ada()).expect("search");
    assert!(hers.iter().all(|h| h.doc.starts_with("h/prefixes-")));
}

#[test]
fn statistics_exclude_deleted_chunks() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let index = TantivyIndex::open(dir.path(), "main", StoreOptions::default()).expect("opening");
    // Space-readable documents bo reads too, in the same segment as the ones kept, then deleted:
    // the segment keeps them, marked deleted.
    let mut docs = visible();
    docs.extend((0..20).map(|n| {
        one(
            &format!("c/gone-{n}"),
            "Rollout",
            &"rollout canary fleet plan ".repeat(n + 1),
            &["space"],
        )
    }));
    commit(&index, docs, 1);
    commit(
        &index,
        (0..20)
            .map(|n| (format!("c/gone-{n}"), Vec::new()))
            .collect(),
        2,
    );
    let info = index.info().expect("info");
    assert_eq!(info.chunks, 5, "the deleted chunks are not live");
    let fresh_dir = tempfile::tempdir().expect("a temporary directory");
    let fresh =
        TantivyIndex::open(fresh_dir.path(), "main", StoreOptions::default()).expect("opening");
    commit(&fresh, visible(), 1);
    for query in queries() {
        assert_eq!(
            seen(&index, &query, &bo()),
            seen(&fresh, &query, &bo()),
            "`{}`: a deleted chunk still counts",
            query.text
        );
    }
}

/// The review's I1: more tied chunks than any window, written in reverse id order between
/// hidden commits that move segment layout, still keep exactly the first by document id.
#[test]
fn ties_past_any_window_keep_the_first_by_document_id_whatever_the_segments() {
    const TIED: usize = 4_200;
    let tied = |n: usize| one(&format!("t/tie-{n:05}"), "Tie", "zebra stripes", &["space"]);
    let build = |with_hidden: bool| {
        let dir = tempfile::tempdir().expect("a temporary directory");
        let index =
            TantivyIndex::open(dir.path(), "main", StoreOptions::default()).expect("opening");
        let mut applied = 0;
        for batch in (0..TIED).rev().collect::<Vec<_>>().chunks(700) {
            applied += 1;
            commit(&index, batch.iter().map(|&n| tied(n)).collect(), applied);
            if with_hidden {
                applied += 1;
                let hidden = (0..50)
                    .map(|n| {
                        one(
                            &format!("h/zebra-{applied}-{n}"),
                            "Zebra",
                            "zebra stripes zebra",
                            &["principal:human:ada"],
                        )
                    })
                    .collect();
                commit(&index, hidden, applied);
            }
        }
        (dir, index)
    };
    let (_plain_dir, plain) = build(false);
    let (_mixed_dir, mixed) = build(true);
    let first: Vec<String> = (0..10).map(|n| format!("t/tie-{n:05}")).collect();
    for text in ["zebra", "zeb*", "body:zebra stripes"] {
        let query = IndexQuery {
            limit: 10,
            ..ask(text)
        };
        let hits = mixed.search(&query, &bo()).expect("search");
        let docs: Vec<String> = hits.iter().map(|h| h.doc.clone()).collect();
        assert_eq!(docs, first, "`{text}`");
        assert_eq!(
            seen(&mixed, &query, &bo()),
            seen(&plain, &query, &bo()),
            "`{text}`"
        );
    }
}

#[test]
fn a_snippet_weighs_terms_by_what_the_reader_can_read() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let index = TantivyIndex::open(dir.path(), "main", StoreOptions::default()).expect("opening");
    // Two fragments far apart: one with `zebra`, one with `yak`. For bo, `zebra` is rare and
    // `yak` common, so the snippet shows the `zebra` fragment.
    let body = format!(
        "The zebra crossed here. {} The yak stayed there.",
        "Filler words go on and on. ".repeat(30)
    );
    let mut docs = vec![one("a/target", "Target", &body, &["space"])];
    for n in 0..5 {
        docs.push(one(
            &format!("a/yak-{n}"),
            "Yaks",
            "a yak, another yak",
            &["space"],
        ));
    }
    commit(&index, docs, 1);
    let snippet = |reader: &ReaderFilter| {
        index
            .search(&ask("zebra yak"), reader)
            .expect("search")
            .into_iter()
            .find(|h| h.doc == "a/target")
            .and_then(|h| h.snippet)
            .expect("a snippet")
    };
    let before = snippet(&bo());
    assert!(before.contains("**zebra**"), "{before}");
    // Hidden documents make `zebra` common and leave `yak` rare for whoever reads them.
    commit(
        &index,
        (0..40)
            .map(|n| {
                one(
                    &format!("h/zebra-{n}"),
                    "Zebras",
                    "zebra zebra",
                    &["principal:human:ada"],
                )
            })
            .collect(),
        2,
    );
    assert_eq!(
        snippet(&bo()),
        before,
        "bo's snippet moved with ada's documents"
    );
    assert!(
        snippet(&ada()).contains("**yak**"),
        "ada's weights are hers"
    );
}

mod memory {
    //! Section 9.2: recall's BM25 per reader filter, and the ceiling.

    use umbel_store::conformance::samples;
    use umbel_store::memory::{
        AsOf, MAX_RECALL_MATCHES, MemoryStore, MemoryWrite, ReadFlags, RecallPage, RecallQuery,
        ScopeQuery,
    };
    use umbel_store::{Authority, MemoryQuery, ReaderFilter, StoreError};
    use umbel_store_embedded::{SqliteMemoryStore, StoreOptions};

    const ADA: &str = "human:ada";
    const BO: &str = "human:bo";
    const NOW: i64 = samples::MEMORY_AT + 60_000;

    fn bo() -> ReaderFilter {
        super::bo()
    }

    fn ada() -> ReaderFilter {
        super::ada()
    }

    fn open(dir: &std::path::Path) -> SqliteMemoryStore {
        SqliteMemoryStore::open(dir, "main", StoreOptions::default()).expect("opening")
    }

    fn entry(n: u64, owner: &str, access: &str, subject: &str, text: &str) -> MemoryWrite {
        let mut e = samples::memory_entry(n, owner, &[access], subject, text);
        samples::agree(&mut e);
        e
    }

    fn write(memory: &SqliteMemoryStore, at: i64, entries: Vec<MemoryWrite>) {
        for batch in entries.chunks(umbel_store::memory::MAX_MEMORY_BATCH) {
            memory
                .write(samples::memory_batch(at, batch.to_vec()))
                .expect("write");
        }
    }

    fn query(text: &str) -> RecallQuery {
        RecallQuery {
            query: MemoryQuery::parse(text).expect("a query"),
            scope: ScopeQuery::default(),
            classes: Vec::new(),
            tags: Vec::new(),
            authorities: Vec::new(),
            push: None,
            as_of: AsOf::at(NOW),
            flags: ReadFlags {
                include_flagged: true,
                include_expired: false,
                now: NOW,
            },
            limit: 200,
        }
    }

    fn recall(memory: &SqliteMemoryStore, text: &str, reader: &ReaderFilter) -> RecallPage {
        memory.recall(&query(text), reader).expect("recall")
    }

    fn ids(page: &RecallPage) -> Vec<String> {
        page.hits.iter().map(|h| h.record.id.clone()).collect()
    }

    /// Bo's records: `alpha` is rare for him and `beta` common, so the `alpha` record leads.
    fn bos(memory: &SqliteMemoryStore) {
        let p_bo = "principal:human:bo";
        let mut entries = vec![
            entry(1, BO, p_bo, "Alpha note", "alpha alpha comes first for bo"),
            entry(2, BO, p_bo, "Beta note", "beta beta comes second for bo"),
            entry(3, BO, "space", "Beta again", "beta in the team space"),
            entry(4, BO, p_bo, "More beta", "beta once more"),
        ];
        for n in 0..12 {
            entries.push(entry(
                10 + n,
                BO,
                p_bo,
                &format!("Filler {n}"),
                &format!("filler words number {n}"),
            ));
        }
        write(memory, samples::MEMORY_AT, entries);
    }

    #[test]
    fn writing_what_a_reader_cannot_read_changes_no_byte_of_its_recall() {
        let dir = tempfile::tempdir().expect("a temporary directory");
        let memory = open(dir.path());
        bos(&memory);
        let texts = [
            "alpha beta",
            "alpha",
            "beta",
            "+beta alpha",
            "be*",
            "\"beta note\"",
            "subject:beta",
        ];
        let before: Vec<RecallPage> = texts.iter().map(|t| recall(&memory, t, &bo())).collect();
        assert_eq!(
            ids(&before[0])[0],
            samples::memory_id(1),
            "alpha is rarer than beta for bo"
        );
        // Ada's records make `alpha` common and lengthen the average record, for her alone.
        let p_ada = "principal:human:ada";
        let hidden: Vec<MemoryWrite> = (0..120)
            .map(|n| {
                entry(
                    100 + n,
                    ADA,
                    p_ada,
                    "Alpha everywhere",
                    &format!("alpha {} beta? no", "padding ".repeat(n as usize)),
                )
            })
            .collect();
        write(&memory, samples::MEMORY_AT + 1000, hidden);
        for (text, expected) in texts.iter().zip(&before) {
            assert_eq!(
                &recall(&memory, text, &bo()),
                expected,
                "`{text}`: bo's recall moved with ada's records"
            );
        }
        // Ada reads them: for her `alpha` is the common term, and the `beta` record leads her
        // recall of the space's records.
        let hers = recall(&memory, "alpha beta", &ada());
        assert!(hers.hits.len() > 2);
    }

    #[test]
    fn ties_order_by_tier_then_recency_then_id() {
        let dir = tempfile::tempdir().expect("a temporary directory");
        let memory = open(dir.path());
        let p_bo = "principal:human:bo";
        let mut agent = entry(1, BO, p_bo, "Tied", "kumquat orchard");
        samples::set_authority(&mut agent, Authority::Agent);
        let mut person = entry(2, BO, p_bo, "Tied", "kumquat orchard");
        samples::set_authority(&mut person, Authority::Person);
        let mut tool = entry(3, BO, p_bo, "Tied", "kumquat orchard");
        samples::set_authority(&mut tool, Authority::Tool);
        // One authority per batch; the agent's is newest.
        write(&memory, samples::MEMORY_AT, vec![person]);
        write(&memory, samples::MEMORY_AT + 10, vec![tool]);
        write(&memory, samples::MEMORY_AT + 20, vec![agent]);
        assert_eq!(
            ids(&recall(&memory, "kumquat", &bo())),
            [
                samples::memory_id(2),
                samples::memory_id(3),
                samples::memory_id(1)
            ],
            "equal scores: person, then tool, then agent, whatever the recency"
        );
    }

    #[test]
    fn past_the_ceiling_a_query_is_too_broad_counting_only_what_the_reader_reads() {
        assert_eq!(MAX_RECALL_MATCHES, 50_000, "section 9.2's ceiling");
        let dir = tempfile::tempdir().expect("a temporary directory");
        // The ceiling's code with a lower ceiling (the `testkit` seam), so the test need not
        // write fifty thousand records.
        let ceiling = 300;
        let memory = open(dir.path()).with_recall_ceiling(ceiling);
        bos(&memory);
        let p_ada = "principal:human:ada";
        let count = ceiling + 1;
        let hidden: Vec<MemoryWrite> = (0..count)
            .map(|n| {
                entry(
                    1000 + n,
                    ADA,
                    p_ada,
                    "Broad",
                    &format!("ubiquitous word {n}"),
                )
            })
            .collect();
        write(&memory, samples::MEMORY_AT + 1000, hidden);
        assert_eq!(
            memory.recall(&query("ubiquitous"), &ada()),
            Err(StoreError::QueryTooBroad { limit: ceiling }),
            "never a silent truncation"
        );
        // At the ceiling exactly, every match is ranked.
        let narrower = memory
            .recall(&query("+ubiquitous -299 -300"), &ada())
            .expect("recall");
        assert_eq!(narrower.hits.len(), 200, "the limit, after ranking all 299");
        // Bo reads none of them: his query is not broad, and answers as before they existed.
        assert!(recall(&memory, "ubiquitous", &bo()).hits.is_empty());
        assert_eq!(
            ids(&recall(&memory, "alpha", &bo())),
            [samples::memory_id(1)]
        );
    }
}
