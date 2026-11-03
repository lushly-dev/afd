//! Raw-byte canaries (phase 3 section 7.4, step 3a's part): records holding random canaries in
//! subject, text, tag, constraint, source and invalidation note are written, recalled and
//! forgotten, then the raw bytes of every file in the store directory are read and must hold no
//! canary: not the database, not its WAL, not FTS5's shadow tables. The test sees them before the
//! forget; the control without FTS5's `secure-delete` is in `memory_sqlite.rs`, since the store's
//! own compaction now clears the index even with it off. A reader held across a forget leaves
//! `wal: Pending` and an unsettled marker until a later writer retries and settles it. A forget or
//! purge compacts the index, so no forgotten word stays whole as an index page's separator, and
//! `memory-reindex` clears what an erasure without that compaction leaves. A destroyed key's bytes
//! leave every file. Nothing runs `ANALYZE`.

// Integration-test helpers fail by panicking; clippy exempts only `#[test]` bodies themselves.
#![allow(clippy::expect_used, clippy::unwrap_used)]

mod support;

use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};
use std::path::{Path, PathBuf};

use rusqlite::Connection;
use support::open_memory;
use umbel_store::conformance::samples;
use umbel_store::memory::{
    AsOf, Forget, Invalidate, InvalidationReason, MemoryWrite, RecallQuery, WalState,
};
use umbel_store::{
    ForgetSelector, MemoryQuery, MemoryStore, ReadFlags, ReaderFilter, ScopeQuery, Source,
};
use umbel_store_embedded::{SqliteMemoryStore, StoreOptions};

const ADA: &str = "human:ada";
const P_ADA: &str = "principal:human:ada";
const T0: i64 = samples::MEMORY_AT;

fn ada() -> ReaderFilter {
    ReaderFilter::tokens([P_ADA, "space"]).expect("a valid reader")
}

/// Letters porter does not stem away: no vowels, no `y`, no `s`.
const LETTERS: &[u8] = b"bcdfghjklmnpqrtvwxz";

/// A fresh random canary starting with `first`, lowercase and twelve letters long, so canaries
/// of different fields share no prefix.
fn canary(first: char) -> String {
    let mut out = String::from(first);
    let mut hasher = RandomState::new().build_hasher();
    hasher.write_u64(u64::from(u32::from(first)));
    let mut bits = hasher.finish();
    for _ in 0..11 {
        out.push(char::from(LETTERS[(bits % LETTERS.len() as u64) as usize]));
        bits /= LETTERS.len() as u64;
        if bits == 0 {
            let mut more = RandomState::new().build_hasher();
            more.write_u64(bits);
            bits = more.finish();
        }
    }
    out
}

/// One canary per field.
struct Canaries {
    subject: String,
    text: String,
    tag: String,
    constraint: String,
    source: String,
    note: String,
}

impl Canaries {
    fn new() -> Self {
        Self {
            subject: canary('b'),
            text: canary('c'),
            tag: canary('d'),
            constraint: canary('f'),
            source: canary('g'),
            note: canary('h'),
        }
    }

    fn all(&self) -> [&str; 6] {
        [
            &self.subject,
            &self.text,
            &self.tag,
            &self.constraint,
            &self.source,
            &self.note,
        ]
    }

    /// Record `n` holding every canary but the note's.
    fn entry(&self, n: u64) -> MemoryWrite {
        let mut e = samples::memory_entry(
            n,
            ADA,
            &[P_ADA],
            &format!("about {} today", self.subject),
            &format!("the body holds {} among other words", self.text),
        );
        e.tags = vec![self.tag.clone()];
        e.envelope.constraints = Some(vec![format!("only {}", self.constraint)]);
        e.envelope.sources = Some(vec![Source {
            resource: format!("file://{}", self.source),
            id: None,
            title: None,
            author: None,
            last_modified: None,
        }]);
        e
    }
}

/// Plain records that stay, so the database's pages are not all freed.
fn filler(m: &dyn MemoryStore, from: u64, count: u64) {
    let entries = (from..from + count)
        .map(|n| {
            samples::memory_entry(
                n,
                ADA,
                &[P_ADA],
                &format!("filler note {n}"),
                &format!("ordinary words about deploys and rollbacks, number {n}"),
            )
        })
        .collect();
    m.write(samples::memory_batch(T0, entries))
        .expect("the filler");
}

/// Every file under `dir`, recursively.
fn files(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![dir.to_owned()];
    while let Some(next) = stack.pop() {
        for entry in std::fs::read_dir(&next).expect("listing") {
            let path = entry.expect("an entry").path();
            if path.is_dir() {
                stack.push(path);
            } else {
                out.push(path);
            }
        }
    }
    out
}

fn contains(haystack: &[u8], needle: &str) -> bool {
    haystack
        .windows(needle.len())
        .any(|w| w == needle.as_bytes())
}

/// The files under `dir` that hold any of `needles`, with the needle found.
fn found_in(dir: &Path, needles: &[&str]) -> Vec<(PathBuf, String)> {
    let mut out = Vec::new();
    for file in files(dir) {
        let bytes = std::fs::read(&file).unwrap_or_default();
        for needle in needles {
            if contains(&bytes, needle) {
                out.push((file.clone(), (*needle).to_owned()));
            }
        }
    }
    out
}

fn recall(m: &dyn MemoryStore, text: &str) -> usize {
    let query = RecallQuery {
        query: MemoryQuery::parse(text).expect("a query"),
        scope: ScopeQuery::default(),
        classes: Vec::new(),
        tags: Vec::new(),
        authorities: Vec::new(),
        push: None,
        as_of: AsOf::at(T0 + 2000),
        flags: ReadFlags {
            include_flagged: true,
            include_expired: true,
            now: T0 + 2000,
        },
        limit: 200,
    };
    m.recall(&query, &ada()).expect("recall").hits.len()
}

/// Write the canaries by a single write and in a batch, invalidate one with a note canary,
/// recall each, and return the ids to forget.
fn write_canaries(m: &SqliteMemoryStore, c: &Canaries) -> Vec<String> {
    filler(m, 100, 20);
    m.write(samples::memory_batch(T0, vec![c.entry(1)]))
        .expect("a single write");
    let mut second = c.entry(2);
    second.subject = format!("again {} here", c.subject);
    second.text = format!("a second body with {}", c.text);
    let mut third = c.entry(3);
    third.subject = format!("third {} note", c.subject);
    third.text = format!("a third body, {}", c.text);
    m.write(samples::memory_batch(T0 + 1, vec![second, third]))
        .expect("a batch");
    m.invalidate(
        Invalidate {
            id: samples::memory_id(3),
            at: T0 + 1000,
            valid_until: T0 + 1000,
            by: ADA.into(),
            reason: InvalidationReason::Wrong,
            note: Some(format!("because {}", c.note)),
            expect_version: None,
            trace_id: None,
        },
        &ada(),
    )
    .expect("an invalidation with a note");
    for term in [&c.subject, &c.text, &c.tag] {
        assert!(recall(m, term) >= 1, "{term} is recalled before the forget");
    }
    (1..=3).map(samples::memory_id).collect()
}

fn forget(m: &dyn MemoryStore, ids: Vec<String>) -> WalState {
    let receipt = m
        .forget(Forget {
            owner: ADA.into(),
            selector: ForgetSelector::Ids(ids),
            at: T0 + 2000,
            trace_id: Some("t-forget".into()),
        })
        .expect("forget");
    assert_eq!(receipt.erased, 3);
    receipt.wal
}

#[test]
fn a_forget_leaves_no_canary_in_any_file() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let m = open_memory(dir.path(), "main", StoreOptions::default()).expect("opening");
    let c = Canaries::new();
    let ids = write_canaries(&m, &c);
    // Before the forget, the canaries are on disk in clear: the index's copy at least.
    assert!(
        !found_in(dir.path(), &c.all()).is_empty(),
        "the test sees the canaries before the forget"
    );
    assert_eq!(forget(&*m, ids), WalState::Clean);
    for term in [&c.subject, &c.text, &c.tag] {
        assert_eq!(recall(&*m, term), 0, "{term} is not recalled after");
    }
    let found = found_in(dir.path(), &c.all());
    assert!(found.is_empty(), "canaries left on disk: {found:?}");
    // The kept records still read.
    assert_eq!(recall(&*m, "filler"), 20);
}

#[test]
fn with_fts_secure_delete_off_the_compaction_still_leaves_no_canary() {
    // FTS5's `secure-delete` alone keeps a forgotten term with it off (`memory_sqlite.rs`); the
    // compaction after the forget rewrites the index, so the guarantee does not rest on it.
    let dir = tempfile::tempdir().expect("a temporary directory");
    let m = open_memory(dir.path(), "main", StoreOptions::default()).expect("opening");
    filler(&*m, 200, 1);
    let raw = Connection::open(dir.path().join("store").join("memory.sqlite3")).expect("raw");
    raw.execute(
        "INSERT INTO records_fts (records_fts, rank) VALUES ('secure-delete', 0)",
        [],
    )
    .expect("turning FTS5 secure-delete off");
    drop(raw);
    let c = Canaries::new();
    let ids = write_canaries(&m, &c);
    assert!(!found_in(dir.path(), &c.all()).is_empty(), "seen before");
    assert_eq!(forget(&*m, ids), WalState::Clean);
    let found = found_in(dir.path(), &c.all());
    assert!(found.is_empty(), "canaries left on disk: {found:?}");
}

/// `(key is null, settled)` of each id's entry in the key file.
fn markers(dir: &Path, ids: &[String]) -> Vec<(bool, bool)> {
    let raw = Connection::open(dir.join("store").join("memory.keys")).expect("the key file");
    ids.iter()
        .map(|id| {
            raw.query_row(
                "SELECT key IS NULL, settled FROM record_keys WHERE id = ?1",
                [id],
                |r| Ok((r.get(0)?, r.get::<_, i64>(1)? != 0)),
            )
            .expect("an entry")
        })
        .collect()
}

/// The live keys of `ids`.
fn keys_of(dir: &Path, ids: &[String]) -> Vec<Vec<u8>> {
    let raw = Connection::open(dir.join("store").join("memory.keys")).expect("the key file");
    ids.iter()
        .map(|id| {
            raw.query_row("SELECT key FROM record_keys WHERE id = ?1", [id], |r| {
                r.get(0)
            })
            .expect("a key")
        })
        .collect()
}

#[test]
fn a_forget_leaves_no_destroyed_key_in_any_file() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let m = open_memory(dir.path(), "main", StoreOptions::default()).expect("opening");
    let c = Canaries::new();
    let ids = write_canaries(&m, &c);
    let keys = keys_of(dir.path(), &ids);
    let hex: Vec<String> = keys
        .iter()
        .map(|k| k.iter().map(|b| format!("{b:02x}")).collect())
        .collect();
    let has = |dir: &Path| -> Vec<PathBuf> {
        files(dir)
            .into_iter()
            .filter(|f| {
                let bytes = std::fs::read(f).unwrap_or_default();
                keys.iter()
                    .any(|k| bytes.windows(k.len()).any(|w| w == &k[..]))
            })
            .collect()
    };
    assert!(
        !has(dir.path()).is_empty(),
        "the test sees the keys before the forget"
    );
    assert_eq!(forget(&*m, ids.clone()), WalState::Clean);
    assert_eq!(
        markers(dir.path(), &ids),
        vec![(true, true); 3],
        "settled markers"
    );
    let left = has(dir.path());
    assert!(
        left.is_empty(),
        "destroyed keys on disk: {left:?} ({hex:?})"
    );
    assert!(
        !files(dir.path())
            .iter()
            .any(|f| f.to_string_lossy().ends_with("memory.keys-journal")),
        "the key file's journal is gone after its commit"
    );
}

#[test]
fn a_reader_held_across_a_forget_leaves_the_wal_pending_until_a_checkpoint() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let m = open_memory(
        dir.path(),
        "main",
        StoreOptions {
            lock_timeout_ms: 200,
        },
    )
    .expect("opening");
    let c = Canaries::new();
    let ids = write_canaries(&m, &c);
    let mut reader =
        Connection::open(dir.path().join("store").join("memory.sqlite3")).expect("a reader");
    let snapshot = reader.transaction().expect("a read transaction");
    let n: i64 = snapshot
        .query_row("SELECT COUNT(*) FROM records", [], |r| r.get(0))
        .expect("a read");
    assert_eq!(n, 23);
    assert_eq!(
        forget(&*m, ids.clone()),
        WalState::Pending,
        "a reader holds the WAL"
    );
    assert!(
        !found_in(dir.path(), &[&c.text]).is_empty(),
        "until the WAL is truncated it may hold the text"
    );
    assert_eq!(
        markers(dir.path(), &ids),
        vec![(true, false); 3],
        "the keys are destroyed and the markers unsettled"
    );
    // A later write retries with no wait, and is busy again while the reader holds the WAL.
    filler(&*m, 300, 1);
    assert_eq!(markers(dir.path(), &ids), vec![(true, false); 3]);
    drop(snapshot);
    drop(reader);
    // Once the reader is gone, the next write's retry succeeds and settles them.
    filler(&*m, 301, 1);
    assert_eq!(markers(dir.path(), &ids), vec![(true, true); 3], "settled");
    let found = found_in(dir.path(), &c.all());
    assert!(found.is_empty(), "canaries left on disk: {found:?}");
}

#[test]
fn a_checkpoint_settles_a_pending_forget_once_the_reader_is_gone() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let m = open_memory(
        dir.path(),
        "main",
        StoreOptions {
            lock_timeout_ms: 200,
        },
    )
    .expect("opening");
    let c = Canaries::new();
    let ids = write_canaries(&m, &c);
    let mut reader =
        Connection::open(dir.path().join("store").join("memory.sqlite3")).expect("a reader");
    let snapshot = reader.transaction().expect("a read transaction");
    let _: i64 = snapshot
        .query_row("SELECT COUNT(*) FROM records", [], |r| r.get(0))
        .expect("a read");
    assert_eq!(forget(&*m, ids.clone()), WalState::Pending);
    drop(snapshot);
    drop(reader);
    m.checkpoint().expect("a checkpoint");
    assert_eq!(markers(dir.path(), &ids), vec![(true, true); 3]);
    let found = found_in(dir.path(), &c.all());
    assert!(found.is_empty(), "canaries left on disk: {found:?}");
}

#[test]
fn fts_secure_delete_is_set_by_the_insert_form_and_kept_by_reindex() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let m = open_memory(dir.path(), "main", StoreOptions::default()).expect("opening");
    filler(&*m, 1, 3);
    assert!(m.info().expect("info").fts_secure_delete);
    let receipt = m.reindex(false).expect("reindex");
    assert_eq!((receipt.reindexed, receipt.unreadable), (3, 0));
    assert!(
        m.info().expect("info").fts_secure_delete,
        "the recreated table sets it again"
    );
    assert_eq!(recall(&*m, "filler"), 3, "and still recalls");
}

/// Records of tokens `<prefix><n>q` and `<prefix><n>x` in odd records, kept words in even ones,
/// in two batches after 50 filler records: the layout where a leaf page of `records_fts_idx`
/// starts with a forgotten token that differs from the previous page's last term only in its last
/// character, so the page's separator is the whole token (spec, "Amendments from step 3a").
fn separator_layout(m: &SqliteMemoryStore, prefix: &str) -> Vec<String> {
    filler(m, 1000, 50);
    let entries = |range: std::ops::RangeInclusive<u64>| -> Vec<MemoryWrite> {
        range
            .map(|n| {
                let text = if n % 2 == 1 {
                    format!("{prefix}{n:04}q and {prefix}{n:04}x with kept words")
                } else {
                    format!("kept words only, number {n:04}")
                };
                samples::memory_entry(n, ADA, &[P_ADA], &format!("note {n}"), &text)
            })
            .collect()
    };
    for range in [1..=200, 201..=400] {
        m.write(samples::memory_batch(T0, entries(range)))
            .expect("a batch");
    }
    (1..=400)
        .filter(|n| n % 2 == 1)
        .flat_map(|n| [format!("{prefix}{n:04}q"), format!("{prefix}{n:04}x")])
        .collect()
}

/// How many `records_fts_idx` separators hold one of `whole`.
fn separators_holding(dir: &Path, whole: &[String]) -> usize {
    let raw = Connection::open(dir.join("store").join("memory.sqlite3")).expect("raw");
    let mut stmt = raw
        .prepare("SELECT term FROM records_fts_idx")
        .expect("records_fts_idx");
    let terms: Vec<Vec<u8>> = stmt
        .query_map([], |r| r.get(0))
        .expect("the separators")
        .collect::<Result<_, _>>()
        .expect("a separator");
    terms
        .iter()
        .filter(|term| whole.iter().any(|w| contains(term, w)))
        .count()
}

#[test]
fn a_forget_leaves_no_whole_token_as_an_index_separator() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let m = open_memory(dir.path(), "main", StoreOptions::default()).expect("opening");
    let prefix = canary('k');
    let whole = separator_layout(&m, &prefix);
    // The case is exercised: a word about to be forgotten starts an index page, and is that page's
    // separator. FTS5's `secure-delete` alone keeps it (`memory_sqlite.rs`).
    assert!(
        separators_holding(dir.path(), &whole) >= 1,
        "a forgotten word must start an index page for this test to mean anything"
    );
    // Forgotten in four calls, so each later call finds the index already compacted to one
    // segment, where FTS5's `optimize` would do nothing.
    let odd: Vec<u64> = (1..=400).filter(|n| n % 2 == 1).collect();
    for chunk in odd.chunks(50) {
        let receipt = m
            .forget(Forget {
                owner: ADA.into(),
                selector: ForgetSelector::Ids(
                    chunk.iter().map(|n| samples::memory_id(*n)).collect(),
                ),
                at: T0 + 1,
                trace_id: None,
            })
            .expect("forget");
        assert_eq!(receipt.erased, chunk.len() as u64);
        assert_eq!(receipt.wal, WalState::Clean);
    }
    assert_eq!(separators_holding(dir.path(), &whole), 0, "no separator");
    let whole: Vec<&str> = whole.iter().map(String::as_str).collect();
    let left = found_in(dir.path(), &whole);
    assert!(left.is_empty(), "whole forgotten tokens on disk: {left:?}");
    let left = found_in(dir.path(), &[&prefix]);
    assert!(left.is_empty(), "the forgotten prefix on disk: {left:?}");
    assert_eq!(recall(&*m, "filler"), 50);
    assert_eq!(recall(&*m, "kept"), 200);
    assert!(
        m.info().expect("info").fts_secure_delete,
        "kept by the rebuild"
    );
}

#[test]
fn reindex_clears_what_an_erasure_without_the_compaction_leaves() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let m = open_memory(dir.path(), "main", StoreOptions::default()).expect("opening");
    let prefix = canary('k');
    let whole = separator_layout(&m, &prefix);
    // Erase the odd records by hand, with both `secure-delete`s and no compaction: what a forget
    // whose rebuild could not run leaves behind (section 5.4's stated limit on token prefixes).
    let raw = Connection::open(dir.path().join("store").join("memory.sqlite3")).expect("raw");
    raw.query_row("PRAGMA secure_delete = ON", [], |r| r.get::<_, i64>(0))
        .expect("secure_delete");
    for n in (1..=400).filter(|n| n % 2 == 1) {
        let id = samples::memory_id(n);
        raw.execute(
            "DELETE FROM records_fts WHERE rowid = (SELECT rowid FROM records WHERE id = ?1)",
            [&id],
        )
        .expect("the index row");
        for table in [
            "record_derived",
            "observations",
            "record_access",
            "versions",
            "records",
        ] {
            raw.execute(&format!("DELETE FROM {table} WHERE id = ?1"), [&id])
                .expect("a row");
        }
    }
    drop(raw);
    assert!(
        separators_holding(dir.path(), &whole) >= 1,
        "FTS5's secure-delete alone keeps a separator"
    );
    let receipt = m.reindex(false).expect("reindex");
    assert_eq!(receipt.reindexed, 250);
    assert_eq!(separators_holding(dir.path(), &whole), 0);
    m.checkpoint().expect("checkpoint");
    let left = found_in(dir.path(), &[&prefix]);
    assert!(
        left.is_empty(),
        "the erased prefix on disk after reindex: {left:?}"
    );
    assert_eq!(recall(&*m, "kept"), 200);
}

#[test]
fn a_purge_leaves_no_whole_token_as_an_index_separator() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let m = open_memory(dir.path(), "main", StoreOptions::default()).expect("opening");
    let prefix = canary('k');
    let whole = separator_layout(&m, &prefix);
    assert!(separators_holding(dir.path(), &whole) >= 1);
    for n in (1..=400).filter(|n| n % 2 == 1) {
        m.invalidate(
            Invalidate {
                id: samples::memory_id(n),
                at: T0 + 1,
                valid_until: T0 + 1,
                by: ADA.into(),
                reason: InvalidationReason::Outdated,
                note: None,
                expect_version: None,
                trace_id: None,
            },
            &ada(),
        )
        .expect("invalidate");
    }
    let receipt = m
        .sweep(umbel_store::memory::Sweep {
            now: T0 + 91 * umbel_store::memory::DAY_MS,
            limit: 10_000,
            retention: umbel_store::memory::Retention::default(),
        })
        .expect("sweep");
    assert_eq!((receipt.purged, receipt.remaining), (200, 0));
    assert_eq!(separators_holding(dir.path(), &whole), 0);
    let left = found_in(dir.path(), &[&prefix]);
    assert!(left.is_empty(), "the purged prefix on disk: {left:?}");
}

/// Forget's cost with the compaction, on a store of `UMBEL_FORGET_COST_RECORDS` records (3000 by
/// default): printed, not asserted, for the specification's note.
#[test]
fn forget_cost_on_a_few_thousand_records() {
    let total: u64 = std::env::var("UMBEL_FORGET_COST_RECORDS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(3000);
    let dir = tempfile::tempdir().expect("a temporary directory");
    let m = open_memory(dir.path(), "main", StoreOptions::default()).expect("opening");
    let mut n = 1;
    while n <= total {
        let entries = (n..(n + 250).min(total + 1))
            .map(|k| {
                samples::memory_entry(
                    k,
                    ADA,
                    &[P_ADA],
                    &format!("record {k} about deploys"),
                    &format!(
                        "a paragraph of ordinary words for record {k}: rollbacks, canary flags, \
                         nightly backups, restarts and the release train, about forty words long \
                         so the index has a realistic size per record and several pages per term"
                    ),
                )
            })
            .collect();
        m.write(samples::memory_batch(T0, entries))
            .expect("a batch");
        n += 250;
    }
    let mut times = Vec::new();
    for k in 1..=5 {
        let started = std::time::Instant::now();
        let receipt = m
            .forget(Forget {
                owner: ADA.into(),
                selector: ForgetSelector::Ids(vec![samples::memory_id(k)]),
                at: T0 + 1,
                trace_id: None,
            })
            .expect("forget");
        times.push(started.elapsed());
        assert_eq!(receipt.erased, 1);
    }
    let info = m.info().expect("info");
    // The compaction alone, on a raw connection with the store's `secure_delete`.
    let raw = Connection::open(dir.path().join("store").join("memory.sqlite3")).expect("raw");
    raw.query_row("PRAGMA secure_delete = ON", [], |r| r.get::<_, i64>(0))
        .expect("secure_delete");
    let started = std::time::Instant::now();
    raw.execute(
        "INSERT INTO records_fts (records_fts) VALUES ('rebuild')",
        [],
    )
    .expect("rebuild");
    let rebuild = started.elapsed();
    println!(
        "forget of one record on {total} records: {times:?}; the rebuild alone {rebuild:?}; \
         database {} bytes",
        info.database_bytes
    );
}

#[test]
fn nothing_runs_analyze() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let m = open_memory(dir.path(), "main", StoreOptions::default()).expect("opening");
    let c = Canaries::new();
    let ids = write_canaries(&m, &c);
    forget(&*m, ids);
    m.sweep(umbel_store::memory::Sweep {
        now: T0,
        limit: 10,
        retention: umbel_store::memory::Retention::default(),
    })
    .expect("a sweep");
    m.reindex(false).expect("reindex");
    m.checkpoint().expect("checkpoint");
    let raw = Connection::open(dir.path().join("store").join("memory.sqlite3")).expect("raw");
    let stats: i64 = raw
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE name LIKE 'sqlite_stat%'",
            [],
            |r| r.get(0),
        )
        .expect("sqlite_master");
    assert_eq!(stats, 0, "no sqlite_stat table, which could copy FTS terms");
}
