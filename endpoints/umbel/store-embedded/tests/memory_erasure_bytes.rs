//! Raw-byte canaries (phase 3 section 7.4, step 3a's part): records holding random canaries in
//! subject, text, tag, constraint, source and invalidation note are written, recalled and
//! forgotten, then the raw bytes of every file in the store directory are read and must hold no
//! canary: not the database, not its WAL, not FTS5's shadow tables. A control with FTS5's
//! `secure-delete` off must find one. A reader held across a forget leaves `wal: Pending` until
//! a later checkpoint. `memory-reindex` clears the token prefixes FTS5 leaves, and nothing runs
//! `ANALYZE`. Step 3b adds markers, retries and destroyed keys to this file.

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
fn the_control_with_fts_secure_delete_off_finds_a_canary() {
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
    assert_eq!(forget(&*m, ids), WalState::Clean);
    let found = found_in(dir.path(), &[&c.subject, &c.text, &c.tag]);
    assert!(
        !found.is_empty(),
        "without FTS5 secure-delete the index keeps a forgotten term"
    );
    // Only the index: the sealed columns and the content table were overwritten.
    let found = found_in(dir.path(), &[&c.constraint, &c.source, &c.note]);
    assert!(found.is_empty(), "{found:?}");
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
        forget(&*m, ids),
        WalState::Pending,
        "a reader holds the WAL"
    );
    assert!(
        !found_in(dir.path(), &[&c.text]).is_empty(),
        "until the WAL is truncated it may hold the text"
    );
    drop(snapshot);
    drop(reader);
    m.checkpoint().expect("a checkpoint");
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

#[test]
fn reindex_clears_token_prefixes_a_forget_leaves() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let m = open_memory(dir.path(), "main", StoreOptions::default()).expect("opening");
    filler(&*m, 1000, 50);
    // Tokens sharing a long prefix unique to the forgotten records, as section 5.4's review found,
    // in the same segments as kept records, so the segments outlive the forget.
    let prefix = canary('k');
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
    for chunk in (1..=400_u64)
        .filter(|n| n % 2 == 1)
        .collect::<Vec<_>>()
        .chunks(100)
    {
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
    }
    // FTS5's `secure-delete` removes the forgotten entries from the segments, but a leaf page's
    // separator in `records_fts_idx` is the shortest prefix of the page's first term that sorts
    // after the previous page's last term. When those differ only in their last character, the
    // separator is the whole token: on the bundled 3.54.1 this layout leaves one forgotten token
    // whole (spec, "Amendments from step 3a"). Recreating the table clears it.
    let whole: Vec<String> = (1..=400)
        .filter(|n| n % 2 == 1)
        .flat_map(|n| [format!("{prefix}{n:04}q"), format!("{prefix}{n:04}x")])
        .collect();
    let whole: Vec<&str> = whole.iter().map(String::as_str).collect();
    let raw = Connection::open(dir.path().join("store").join("memory.sqlite3")).expect("raw");
    let separators: Vec<Vec<u8>> = {
        let mut stmt = raw
            .prepare("SELECT term FROM records_fts_idx")
            .expect("records_fts_idx");
        stmt.query_map([], |r| r.get(0))
            .expect("the separators")
            .collect::<Result<_, _>>()
            .expect("a separator")
    };
    drop(raw);
    let kept_whole = separators
        .iter()
        .filter(|term| whole.iter().any(|w| contains(term, w)))
        .count();
    let kept_prefix = separators
        .iter()
        .filter(|term| contains(term, &prefix))
        .count();
    println!(
        "before reindex: {kept_prefix} separators hold the forgotten prefix, {kept_whole} a whole \
         forgotten token; files holding the prefix: {}",
        found_in(dir.path(), &[&prefix]).len()
    );
    assert!(
        kept_whole >= 1,
        "the stated limit no longer reproduces on this SQLite: re-check section 5.4's limits"
    );
    m.reindex(false).expect("reindex");
    let after = found_in(dir.path(), &[&prefix]);
    assert!(after.is_empty(), "the prefix after reindex: {after:?}");
    assert_eq!(recall(&*m, "filler"), 50);
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
