//! Records host specification step B6 scale benchmark (sections 8.2, 12.1 and 16; #2003).
//!
//! Ignored by default; run in release mode:
//! `cargo test --release --locked --test records_scale -- --ignored --nocapture`
//!
//! Measures at 10 000 and 100 000 records (words alone and with 256-dimension unit vectors):
//! - single `put_declared_record` (with full `synchronous=FULL` + `fullfsync` durability),
//! - `find_records` by key (`id` order) and by text (`id` and `rank` orders),
//! - `match_records` of 1 text, 64 texts, 64 texts of ~1 900 tokens, and 1 text of 1 rare term,
//!   with the once-a-call part, counts, gather, query direction, vector scan, both directions and
//!   hits timed apart through `SqliteStore::lane_match_timed`, for a 100% reader and a 1% reader
//!   (reporting distinct terms counted and candidates gathered for each reader),
//! - `reindex_records` chunked rebuild total time, chunk pause overhead, longest single chunk,
//!   and concurrent writer wait during chunked rebuild through `SqliteStore::lane_reindex_timed`
//!   and `SqliteStore::with_rebuild_hook`,
//! - SQLite `EXPLAIN QUERY PLAN` for every lane statement at 10 000 and 100 000 records.
//!
//! Prints timings with no latency thresholds (section 16).
use std::path::Path;
use std::sync::{Arc, Mutex, mpsc};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use rusqlite::{Connection, params};
use serde_json::json;
use umbel_store::conformance::samples;
use umbel_store::lane::{
    FindOrder, KeyFilter, LaneWrite, MatchVectors, Pointer, RecordDecl, RecordFind, RecordMatch,
    Standing, StandingView, TextQuery,
};
use umbel_store::{
    DocumentStore, EmbedError, Embedder, Expect, ModelId, ReaderFilter, canonical_json,
    record_target,
};
use umbel_store_embedded::{MatchTimings, RebuildPoint, SqliteStore, StoreOptions};

const NS: &str = "notes";
const KIND: &str = "note";
const FIRST_PUT_AT: &str = "2026-11-20T00:00:00.000Z";
const AT: &str = "2026-11-23T00:00:00.000Z";
const VEC_DIM: usize = 256;

const COMMON_WORDS: &[&str] = &[
    "the", "and", "for", "with", "that", "from", "this", "into", "soil", "water", "light", "bed",
    "spring", "autumn", "winter", "summer", "garden", "plants", "roots", "leaves",
];

const MEDIUM_WORDS: &[&str] = &[
    "prune",
    "mulch",
    "compost",
    "roses",
    "tomatoes",
    "basil",
    "lavender",
    "peppers",
    "garlic",
    "onions",
    "carrots",
    "beans",
    "squash",
    "thyme",
    "rosemary",
    "sage",
    "mint",
    "chives",
    "drainage",
    "loam",
    "clay",
    "sand",
    "frost",
    "shade",
    "trellis",
    "staking",
    "grafting",
    "cuttings",
    "seedlings",
    "germination",
    "pollination",
    "blossom",
    "harvest",
    "canopy",
    "rhizome",
    "tuber",
    "bulb",
    "perennial",
    "annual",
    "biennial",
];

fn decl() -> RecordDecl {
    RecordDecl {
        kind: KIND.to_owned(),
        standing: true,
        text: vec![Pointer::parse("/statement").unwrap()],
        keys: vec![
            Pointer::parse("/bed").unwrap(),
            Pointer::parse("/tags").unwrap(),
        ],
        matched: Some(0),
    }
}

fn view_all() -> StandingView {
    StandingView {
        own: Vec::new(),
        command_writable: Vec::new(),
        person: vec!["human:local".to_owned()],
        admit: vec![Standing::Unverified, Standing::Attested, Standing::Affirmed],
        levels: Vec::new(),
    }
}

/// Deterministic 256-dim stub embedder producing unit vectors without external weights.
struct ScaleStubEmbedder {
    model: ModelId,
}

impl ScaleStubEmbedder {
    fn vector_for(text: &str) -> Vec<f32> {
        let mut h: u64 = 0xcbf29ce484222325;
        for byte in text.as_bytes() {
            h ^= u64::from(*byte);
            h = h.wrapping_mul(0x100000001b3);
        }
        let mut out = vec![0.0f32; VEC_DIM];
        let mut norm_sq = 0.0f64;
        for slot in &mut out {
            h ^= h >> 12;
            h ^= h << 25;
            h ^= h >> 27;
            let val = ((h.wrapping_mul(0x2545F4914F6CDD1D) >> 40) as f32 / 16_777_216.0) - 0.5;
            *slot = val;
            norm_sq += f64::from(val) * f64::from(val);
        }
        let inv = (1.0 / norm_sq.sqrt()) as f32;
        for slot in &mut out {
            *slot *= inv;
        }
        out
    }
}

impl Embedder for ScaleStubEmbedder {
    fn model(&self) -> &ModelId {
        &self.model
    }
    fn dimensions(&self) -> usize {
        VEC_DIM
    }
    fn embed(&self, texts: &[&str]) -> Result<Vec<Vec<f32>>, EmbedError> {
        Ok(texts.iter().map(|t| Self::vector_for(t)).collect())
    }
}

/// Deterministic realistic gardening note body with Zipf-like common/medium/rare vocabulary
/// (~9.9 distinct tokens per record, keeping 100 000 records around ~990k postings, safely inside
/// `MATCH_POSTINGS = 4 000 000`).
fn record_statement(i: usize) -> String {
    let c0 = COMMON_WORDS[i % COMMON_WORDS.len()];
    let c1 = COMMON_WORDS[(i * 3 + 7) % COMMON_WORDS.len()];
    let c2 = COMMON_WORDS[(i * 7 + 13) % COMMON_WORDS.len()];
    let m0 = MEDIUM_WORDS[i % MEDIUM_WORDS.len()];
    let m1 = MEDIUM_WORDS[(i * 5 + 11) % MEDIUM_WORDS.len()];
    let m2 = MEDIUM_WORDS[(i * 11 + 3) % MEDIUM_WORDS.len()];
    let m3 = MEDIUM_WORDS[(i * 13 + 17) % MEDIUM_WORDS.len()];
    let topic = i / 50;
    let rare = i / 4;
    format!(
        "{m0} {c0} {m1} {c1} {m2} {c2} {m3} cultivar{topic} plot{rare} section{}",
        i % 250
    )
}

/// Seed `count` raw records in batched transactions (1% readable by `group:onepct`, 100% readable
/// by `space`), so `reindex_records` builds every lane table through the real production path.
fn seed_raw_records(db_path: &Path, count: usize) {
    let mut conn = Connection::open(db_path).unwrap();
    conn.pragma_update(None, "synchronous", "NORMAL").unwrap();
    let env_all =
        canonical_json(&serde_json::to_value(samples::envelope(&["space"], "seed", AT)).unwrap());
    let env_one = canonical_json(
        &serde_json::to_value(samples::envelope(&["space", "group:onepct"], "seed", AT)).unwrap(),
    );

    const BATCH: usize = 5_000;
    let mut rev: i64 = 0;
    for start in (0..count).step_by(BATCH) {
        let end = (start + BATCH).min(count);
        let tx = conn.transaction().unwrap();
        {
            let mut ins_rec = tx
                .prepare_cached(
                    "INSERT INTO records (ns, kind, id, rev, content_hash, body, envelope)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                )
                .unwrap();
            let mut ins_acc = tx
                .prepare_cached(
                    "INSERT INTO record_access (ns, kind, id, token) VALUES (?1, ?2, ?3, ?4)",
                )
                .unwrap();
            let mut ins_chg = tx
                .prepare_cached(
                    "INSERT INTO changes (rev, kind, target, content_hash, trace_id, at)
                     VALUES (?1, 'record', ?2, ?3, 'seed', ?4)",
                )
                .unwrap();
            let mut ins_cacc = tx
                .prepare_cached("INSERT INTO change_access (rev, token) VALUES (?1, ?2)")
                .unwrap();

            for i in start..end {
                let id = format!("n{i:06}");
                let target = record_target(NS, KIND, &id);
                let in_one_pct = i % 100 == 0;
                // Give n000000 an earlier first change row and a later rewrite so the benchmark
                // verifies that `first_puts` matched `changes.target` instead of falling back to
                // the record envelope.
                if i == 0 {
                    rev += 1;
                    let first_hash = format!("sha256:{:064x}", u64::MAX);
                    ins_chg
                        .execute(params![rev, target, first_hash, FIRST_PUT_AT])
                        .unwrap();
                    ins_cacc.execute(params![rev, "space"]).unwrap();
                    ins_cacc.execute(params![rev, "group:onepct"]).unwrap();
                }
                rev += 1;
                let bed = match i % 4 {
                    0 => "north",
                    1 => "south",
                    2 => "east",
                    _ => "west",
                };
                let body = json!({
                    "statement": record_statement(i),
                    "bed": bed,
                    "tags": [MEDIUM_WORDS[i % MEDIUM_WORDS.len()], format!("g{}", i % 20)],
                });
                let body_str = canonical_json(&body);
                let hash = format!("sha256:{i:064x}");
                let env_str = if in_one_pct { &env_one } else { &env_all };
                ins_rec
                    .execute(params![NS, KIND, id, rev, hash, body_str, env_str])
                    .unwrap();
                ins_acc.execute(params![NS, KIND, id, "space"]).unwrap();
                if in_one_pct {
                    ins_acc
                        .execute(params![NS, KIND, id, "group:onepct"])
                        .unwrap();
                }
                ins_chg.execute(params![rev, target, hash, AT]).unwrap();
                ins_cacc.execute(params![rev, "space"]).unwrap();
                if in_one_pct {
                    ins_cacc.execute(params![rev, "group:onepct"]).unwrap();
                }
            }
        }
        tx.commit().unwrap();
    }
}

fn fmt_ms(d: Duration) -> String {
    format!("{:.2} ms", d.as_secs_f64() * 1000.0)
}

fn print_match(label: &str, t: &MatchTimings) {
    println!(
        "  {label:<38} total={:>9} | once={:>8} ident={:>7} counts={:>9} gather={:>9} qdir={:>9} vec={:>9} both={:>9} hits={:>7} | terms={} cands={}",
        fmt_ms(t.total),
        fmt_ms(t.once_a_call),
        fmt_ms(t.identical),
        fmt_ms(t.counts),
        fmt_ms(t.gather),
        fmt_ms(t.query_direction),
        fmt_ms(t.vector_scan),
        fmt_ms(t.both_directions),
        fmt_ms(t.hits),
        t.distinct_terms_counted,
        t.total_candidates,
    );
}

fn long_1900_token_text(seed: usize) -> String {
    // 1 900 short tokens (~12 KiB, under MAX_LANE_TEXT_BYTES = 16 KiB) mixing common, medium and
    // per-text words, matching the §8.2 "64 texts of 1 900 tokens" row.
    let mut parts = Vec::with_capacity(1900);
    for j in 0..1900usize {
        if j % 5 == 0 {
            parts.push(COMMON_WORDS[(seed + j) % COMMON_WORDS.len()].to_owned());
        } else if j % 3 == 0 {
            parts.push(MEDIUM_WORDS[(seed * 7 + j) % MEDIUM_WORDS.len()].to_owned());
        } else {
            parts.push(format!("w{}", (seed * 31 + j) % 900));
        }
    }
    let out = parts.join(" ");
    assert!(out.len() <= umbel_store::lane::MAX_LANE_TEXT_BYTES);
    out
}

fn run_scale_suite(count: usize) {
    println!("\n================================================================================");
    println!("SCALE BENCHMARK: {count} records (release, 256-dim vectors)");
    println!("================================================================================");

    let dir = tempfile::tempdir().unwrap();
    let other_store = SqliteStore::open(dir.path(), "main", StoreOptions::default()).unwrap();
    let (go_tx, go_rx) = mpsc::sync_channel::<()>(0);
    let go_slot = Arc::new(Mutex::new(Some(go_tx)));
    let go_hook = Arc::clone(&go_slot);
    let store = SqliteStore::open(dir.path(), "main", StoreOptions::default())
        .unwrap()
        .with_rebuild_hook(Arc::new(move |point| {
            // While chunk 1 holds the write lock, release the pre-opened concurrent writer on
            // another kind so it contends on chunk 1's lock without inflating chunk 1 with
            // thread spawn or SQLite open overhead (§12.1).
            if point == RebuildPoint::InChunk(1)
                && let Some(tx) = go_hook.lock().unwrap().take()
            {
                tx.send(()).unwrap();
            }
        }));
    let decl = decl();
    let view = view_all();
    let reader_all = ReaderFilter::tokens(["space"]).unwrap();
    let reader_1pct = ReaderFilter::tokens(["group:onepct"]).unwrap();
    let model = ModelId::parse("scale256@0123456789abcdef").unwrap();
    let embedder = ScaleStubEmbedder {
        model: model.clone(),
    };

    let t_seed = Instant::now();
    seed_raw_records(&store.database_path(), count);
    println!("Seeded {count} raw records in {}", fmt_ms(t_seed.elapsed()));

    let writer_handle: JoinHandle<Duration> = std::thread::spawn(move || {
        let env = samples::envelope(&["space"], "concurrent-writer", AT);
        go_rx.recv().unwrap();
        let started = Instant::now();
        other_store
            .put_record(
                NS,
                "log",
                "during_rebuild",
                json!({ "note": "wrote between chunks" }),
                env,
                Expect::Absent,
            )
            .unwrap();
        started.elapsed()
    });

    // 1. Rebuild (words only, via production chunked reindex_records) + concurrent writer wait.
    let (rep, rt) = store
        .lane_reindex_timed(NS, &decl, &|_| Vec::new(), None, false)
        .unwrap();
    assert_eq!(rep.records, count as u64);
    assert!(!rep.superseded);
    let writer_wait = writer_handle.join().unwrap();
    // Verify `first_puts` matched `changes.target` (preserving n000000's rev 1 timestamp).
    {
        let conn = Connection::open(store.database_path()).unwrap();
        let (created_rev, created_at): (i64, String) = conn
            .query_row(
                "SELECT created_rev, created_at FROM record_lane WHERE ns = ?1 AND kind = ?2 AND id = 'n000000'",
                params![NS, KIND],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(created_rev, 1, "first_puts must recover initial rev 1");
        assert_eq!(
            created_at, FIRST_PUT_AT,
            "first_puts must recover initial timestamp from changes.target"
        );
    }
    let status = store.lane_status(NS, &decl).unwrap();
    let active_chunks: Duration = rt.chunks.iter().copied().sum();
    println!(
        "Rebuild (words only): total={} | first_puts={} | chunks={} (active={}, longest={}) | pauses={} | end={} | concurrent_writer_wait={}",
        fmt_ms(rt.total),
        fmt_ms(rt.first_puts),
        rt.chunks.len(),
        fmt_ms(active_chunks),
        fmt_ms(rt.longest_chunk()),
        fmt_ms(rt.pause_total),
        fmt_ms(rt.end_rebuild),
        fmt_ms(writer_wait),
    );
    println!(
        "LaneStatus: records={} postings={} with_match={} state={:?}",
        status.records, status.postings, status.with_match, status.state
    );

    // 2. Single put_declared_record at scale (median of 5 real fsync'd puts).
    let env = samples::envelope(&["space"], "put", AT);
    let mut put_times = Vec::new();
    for j in 0..5usize {
        let t = Instant::now();
        store
            .put_declared_record(
                NS,
                &decl,
                &format!("extra_{j}"),
                json!({
                    "statement": record_statement(count + j),
                    "bed": "north",
                    "tags": ["roses", "bench"],
                }),
                env.clone(),
                Expect::Absent,
                LaneWrite {
                    flags: Vec::new(),
                    evidence: None,
                    model: None,
                    // The production path: the check reads the writer's use (D212).
                    quota: Some(umbel_store::lane::RecordQuota::unlimited()),
                },
                &reader_all,
            )
            .unwrap();
        put_times.push(t.elapsed());
    }
    put_times.sort();
    println!(
        "Single put_declared_record (median of 5): {} (min={}, max={})",
        fmt_ms(put_times[2]),
        fmt_ms(put_times[0]),
        fmt_ms(put_times[4])
    );

    // 3. Find by key and by text (id + rank).
    let find_key = RecordFind {
        kind: KIND.to_owned(),
        keys: vec![KeyFilter {
            key: Pointer::parse("/bed").unwrap(),
            any: vec!["north".to_owned()],
        }],
        standings: Vec::new(),
        verified_only: false,
        text: None,
        order: FindOrder::Id,
        after: None,
        limit: 50,
        total: true,
    };
    let t = Instant::now();
    let page = store
        .find_records(NS, &decl, &find_key, &view, &reader_all)
        .unwrap();
    println!(
        "Find by key (limit=50, total={:?}): {}",
        page.total,
        fmt_ms(t.elapsed())
    );

    let find_text_id = RecordFind {
        kind: KIND.to_owned(),
        keys: Vec::new(),
        standings: Vec::new(),
        verified_only: false,
        text: Some(TextQuery {
            query: "prune roses winter mulch".to_owned(),
            fields: Vec::new(),
        }),
        order: FindOrder::Id,
        after: None,
        limit: 50,
        total: true,
    };
    let t = Instant::now();
    let page = store
        .find_records(NS, &decl, &find_text_id, &view, &reader_all)
        .unwrap();
    println!(
        "Find by text (order=id, total={:?}): {}",
        page.total,
        fmt_ms(t.elapsed())
    );

    let find_text_rank = RecordFind {
        order: FindOrder::Rank,
        ..find_text_id.clone()
    };
    let t = Instant::now();
    let page = store
        .find_records(NS, &decl, &find_text_rank, &view, &reader_all)
        .unwrap();
    println!(
        "Find by text (order=rank, total={:?}, cut={}): {}",
        page.total,
        page.cut,
        fmt_ms(t.elapsed())
    );

    // 4. Match queries (words alone) for 100% reader and 1% reader.
    let one_text = vec![record_statement(42)];
    let texts_64: Vec<String> = (0..64).map(|i| record_statement(i * 100)).collect();
    let texts_64_long: Vec<String> = (0..64).map(long_1900_token_text).collect();
    let one_rare = vec![format!("plot{}", (count / 4) - 1)];

    let mk_match = |texts: Vec<String>| RecordMatch {
        kind: KIND.to_owned(),
        texts,
        k: 20,
        keys: Vec::new(),
        standings: Vec::new(),
        verified_only: false,
        exclude: Vec::new(),
    };

    println!(
        "\nMatch (WORDS ONLY) — note: 100% and 1% readers pool different records and count different terms:"
    );
    for (r_label, reader) in [("100% reader", &reader_all), ("1% reader", &reader_1pct)] {
        for (q_label, texts) in [
            ("1 text", one_text.clone()),
            ("64 texts", texts_64.clone()),
            ("64 texts x 1900 tok", texts_64_long.clone()),
            ("1 text (1 rare term)", one_rare.clone()),
        ] {
            let (_, tm) = store
                .lane_match_timed(NS, &decl, &mk_match(texts), None, &view, reader)
                .unwrap();
            print_match(&format!("{r_label} / {q_label}"), &tm);
        }
    }

    // 5. Populate 256-dim vectors via production reindex_records (vectors_only = true).
    let (vrep, vrt) = store
        .lane_reindex_timed(NS, &decl, &|_| Vec::new(), Some(&embedder), true)
        .unwrap();
    assert_eq!(vrep.vectors_written, (count + 5) as u64);
    println!(
        "\nVector backfill (vectors_only, {VEC_DIM}-dim, {} vectors): {}",
        vrep.vectors_written,
        fmt_ms(vrt.vectors)
    );

    // 5b. Put and find with 256-dim vectors present (§16 "words alone and with vectors").
    let mut put_vec_times = Vec::new();
    for j in 0..5usize {
        let statement = record_statement(count + 100 + j);
        let vec_data = ScaleStubEmbedder::vector_for(&statement);
        let t = Instant::now();
        let meta = store
            .put_declared_record(
                NS,
                &decl,
                &format!("extra_vec_{j}"),
                json!({
                    "statement": statement,
                    "bed": "north",
                    "tags": ["roses", "bench"],
                }),
                env.clone(),
                Expect::Absent,
                LaneWrite {
                    flags: Vec::new(),
                    evidence: None,
                    model: Some(model.clone()),
                    // The production path: the check reads the writer's use (D212).
                    quota: Some(umbel_store::lane::RecordQuota::unlimited()),
                },
                &reader_all,
            )
            .unwrap();
        let digest = umbel_store::lane::match_digest(&statement).unwrap();
        assert!(
            store
                .put_record_vector(
                    NS,
                    &decl,
                    &format!("extra_vec_{j}"),
                    &digest,
                    &model,
                    vec_data,
                )
                .unwrap()
        );
        assert!(meta.meta.rev > 0);
        put_vec_times.push(t.elapsed());
    }
    put_vec_times.sort();
    println!(
        "Single put_declared_record + put_record_vector (median of 5): {} (min={}, max={})",
        fmt_ms(put_vec_times[2]),
        fmt_ms(put_vec_times[0]),
        fmt_ms(put_vec_times[4])
    );

    let t = Instant::now();
    let page = store
        .find_records(NS, &decl, &find_key, &view, &reader_all)
        .unwrap();
    println!(
        "Find by key (with vectors, limit=50, total={:?}): {}",
        page.total,
        fmt_ms(t.elapsed())
    );
    let t = Instant::now();
    let page = store
        .find_records(NS, &decl, &find_text_id, &view, &reader_all)
        .unwrap();
    println!(
        "Find by text (with vectors, order=id, total={:?}): {}",
        page.total,
        fmt_ms(t.elapsed())
    );
    let t = Instant::now();
    let page = store
        .find_records(NS, &decl, &find_text_rank, &view, &reader_all)
        .unwrap();
    println!(
        "Find by text (with vectors, order=rank, total={:?}, cut={}): {}",
        page.total,
        page.cut,
        fmt_ms(t.elapsed())
    );

    // 6. Match queries (WORDS + 256-DIM VECTORS) for 100% reader and 1% reader.
    let mk_vecs = |texts: &[String]| {
        let refs: Vec<&str> = texts.iter().map(String::as_str).collect();
        MatchVectors {
            model: model.clone(),
            weight: 0.5,
            vectors: embedder.embed(&refs).unwrap(),
        }
    };

    println!("\nMatch (WORDS + 256-DIM VECTORS):");
    for (r_label, reader) in [("100% reader", &reader_all), ("1% reader", &reader_1pct)] {
        for (q_label, texts) in [
            ("1 text", one_text.clone()),
            ("64 texts", texts_64.clone()),
            ("1 text (1 rare term)", one_rare.clone()),
        ] {
            let vecs = mk_vecs(&texts);
            let (mp, tm) = store
                .lane_match_timed(NS, &decl, &mk_match(texts), Some(&vecs), &view, reader)
                .unwrap();
            assert!(matches!(
                mp.meaning,
                umbel_store::lane::MeaningState::Served(_)
            ));
            print_match(&format!("{r_label} / {q_label}"), &tm);
        }
    }

    // 6b. Full rebuild with 256-dim vectors (fresh model replaces prior vectors end-to-end).
    let fresh_model = ModelId::parse("scale256-full@fedcba9876543210").unwrap();
    let fresh_embedder = ScaleStubEmbedder {
        model: fresh_model.clone(),
    };
    let store_plain = SqliteStore::open(dir.path(), "main", StoreOptions::default()).unwrap();
    let (full_rep, full_rt) = store_plain
        .lane_reindex_timed(NS, &decl, &|_| Vec::new(), Some(&fresh_embedder), false)
        .unwrap();
    assert_eq!(full_rep.records, (count + 10) as u64);
    assert_eq!(full_rep.vectors_written, (count + 10) as u64);
    assert_eq!(full_rep.vectors_removed, (count + 10) as u64);
    assert!(!full_rep.superseded);
    let full_active: Duration = full_rt.chunks.iter().copied().sum();
    println!(
        "\nRebuild (with {VEC_DIM}-dim vectors): total={} | chunks={} (active={}, longest={}) | pauses={} | end={} | vectors={} (written={}, removed={})",
        fmt_ms(full_rt.total),
        full_rt.chunks.len(),
        fmt_ms(full_active),
        fmt_ms(full_rt.longest_chunk()),
        fmt_ms(full_rt.pause_total),
        fmt_ms(full_rt.end_rebuild),
        fmt_ms(full_rt.vectors),
        full_rep.vectors_written,
        full_rep.vectors_removed,
    );

    // 7. SQLite EXPLAIN QUERY PLAN for every lane statement at this scale.
    println!("\nSQLite EXPLAIN QUERY PLAN at {count} records:");
    let plans = store_plain
        .explain_lane_plans(NS, &decl, &view, &reader_all, fresh_model.as_str())
        .unwrap();
    for (name, lines) in &plans {
        println!("  [{name}] {}", lines.join(" -> "));
    }
}

#[test]
#[ignore = "scale benchmark at 10 000 and 100 000 records; run in release with --ignored --nocapture"]
fn records_scale_10k_and_100k() {
    run_scale_suite(10_000);
    run_scale_suite(100_000);
}
