//! Store measurement for the Mail proposal's phase 0, step 0.3 (question Q3).
//!
//! Imports synthetic messages into SQLite tables shaped for mail and a tantivy index, then
//! measures what the proposal's section 7 asks for: the store-side import rate, the size on
//! disk against the messages' bytes, and the time to list 50 threads and to search.
//!
//!     cargo run --release -- --messages 100000 --out results-100k.json
//!
//! The messages are made up. Nothing here reads real mail.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

use rusqlite::{params, Connection};
use serde_json::json;
use tantivy::collector::TopDocs;
use tantivy::query::QueryParser;
use tantivy::schema::{Schema, Value, FAST, INDEXED, STORED, TEXT};
use tantivy::{doc, Index, IndexWriter, TantivyDocument};

/// The thresholds the owner accepted (the proposal's section 7, Q3).
const LIST_P95_MS: f64 = 50.0;
const SEARCH_P95_MS: f64 = 200.0;
const IMPORT_PER_SECOND: f64 = 500.0;
const SIZE_RATIO: f64 = 3.0;

/// A small deterministic generator, so every run makes the same mailbox.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n.max(1)
    }
    fn unit(&mut self) -> f64 {
        (self.next() >> 11) as f64 / (1u64 << 53) as f64
    }
    /// A rank in `0..n` where low ranks are far more likely, as word and sender use is.
    fn zipf(&mut self, n: u64) -> u64 {
        let u = self.unit();
        ((n as f64).powf(u) - 1.0).max(0.0) as u64 % n.max(1)
    }
}

const SYLLABLES: [&str; 24] = [
    "ka", "to", "mi", "ra", "sen", "lo", "vi", "da", "ne", "pu", "shi", "tor", "ba", "gel", "fo",
    "wen", "ju", "tal", "ro", "kes", "ma", "lin", "ope", "dra",
];

fn word(rank: u64) -> String {
    let mut n = rank + 1;
    let mut out = String::new();
    while n > 0 {
        out.push_str(SYLLABLES[(n % 24) as usize]);
        n /= 24;
    }
    out
}

fn text(rng: &mut Rng, words: u64, vocabulary: u64) -> String {
    let mut out = String::with_capacity(words as usize * 7);
    for i in 0..words {
        if i > 0 {
            out.push(' ');
        }
        out.push_str(&word(rng.zipf(vocabulary)));
    }
    out
}

struct Template {
    sender: u64,
    subject: String,
    body: String,
}

struct Shape {
    templated: f64,  // share of messages made from a recurring template
    in_threads: f64, // share of messages that join an existing thread
    vocabulary: u64,
    senders: u64,
}

fn percentile(sorted: &[f64], p: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let index = ((sorted.len() as f64 - 1.0) * p).round() as usize;
    sorted[index]
}

fn dir_bytes(path: &Path) -> u64 {
    let mut total = 0;
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            let meta = entry.metadata();
            if let Ok(meta) = meta {
                total += if meta.is_dir() {
                    dir_bytes(&entry.path())
                } else {
                    meta.len()
                };
            }
        }
    }
    total
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    let flag = |name: &str| {
        args.iter()
            .position(|a| a == name)
            .and_then(|i| args.get(i + 1))
            .cloned()
    };
    let messages: u64 = flag("--messages")
        .and_then(|v| v.parse().ok())
        .unwrap_or(100_000);
    let out = flag("--out");
    let dir = flag("--dir")
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::temp_dir().join(format!("loam-mail-store-bench-{messages}")));
    let mut shape = Shape {
        templated: 0.6,
        in_threads: 0.3,
        vocabulary: 50_000,
        senders: 5_000,
    };
    // A census file, if given, sets the two shares the store cares about.
    if let Some(path) = flag("--census") {
        let census: serde_json::Value = serde_json::from_str(&fs::read_to_string(path)?)?;
        let total = census["messages"].as_f64().unwrap_or(0.0);
        if total > 0.0 {
            let q1 = &census["q1"];
            let templated = q1["templated_without_list_unsubscribe"]
                .as_f64()
                .unwrap_or(0.0)
                + q1["templated_with_list_unsubscribe"]
                    .as_f64()
                    .unwrap_or(0.0);
            shape.templated = (templated / total).clamp(0.0, 1.0);
            let threads = census["threads"]["distinct"].as_f64().unwrap_or(total);
            shape.in_threads = (1.0 - threads / total).clamp(0.0, 0.95);
            shape.senders = census["senders"]["distinct"]
                .as_u64()
                .unwrap_or(shape.senders)
                .max(1);
        }
    }

    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("index"))?;
    let db_path = dir.join("mail.sqlite3");
    let mut db = Connection::open(&db_path)?;
    db.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         CREATE TABLE message (
             id INTEGER PRIMARY KEY, thread_id INTEGER NOT NULL, sender_id INTEGER NOT NULL,
             date INTEGER NOT NULL, size INTEGER NOT NULL, flags INTEGER NOT NULL,
             template_id INTEGER, subject TEXT NOT NULL, body TEXT NOT NULL);
         CREATE TABLE thread (
             id INTEGER PRIMARY KEY, last_date INTEGER NOT NULL, messages INTEGER NOT NULL,
             unread INTEGER NOT NULL, last_sender INTEGER NOT NULL, subject TEXT NOT NULL,
             snippet TEXT NOT NULL);
         CREATE INDEX thread_by_date ON thread (last_date DESC);
         CREATE INDEX message_by_thread ON message (thread_id, date);",
    )?;

    let mut schema = Schema::builder();
    let f_id = schema.add_u64_field("id", STORED | FAST | INDEXED);
    let f_thread = schema.add_u64_field("thread", STORED | FAST);
    let f_subject = schema.add_text_field("subject", TEXT);
    let f_body = schema.add_text_field("body", TEXT);
    let index = Index::create_in_dir(dir.join("index"), schema.build())?;
    let mut writer: IndexWriter = index.writer(256 * 1024 * 1024)?;

    // The recurring templates: a sender, a subject and a body that copies share.
    let mut rng = Rng(0x9E37_79B9_7F4A_7C15);
    let templates: Vec<Template> = (0..2_000u64)
        .map(|_| {
            let words = 40 + rng.below(400);
            let subject_words = 3 + rng.below(6);
            Template {
                sender: rng.zipf(shape.senders),
                subject: text(&mut rng, subject_words, 2_000),
                body: text(&mut rng, words, shape.vocabulary),
            }
        })
        .collect();

    let mut raw_bytes: u64 = 0;
    let mut thread_count: u64 = 0;
    let mut thread_subject: HashMap<u64, String> = HashMap::new();
    let started = Instant::now();
    let mut next = 1u64;
    while next <= messages {
        let batch_end = (next + 5_000).min(messages + 1);
        let tx = db.transaction()?;
        {
            let mut insert = tx.prepare_cached(
                "INSERT INTO message (id, thread_id, sender_id, date, size, flags, template_id, subject, body)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            )?;
            let mut upsert = tx.prepare_cached(
                "INSERT INTO thread (id, last_date, messages, unread, last_sender, subject, snippet)
                 VALUES (?1, ?2, 1, 1, ?3, ?4, ?5)
                 ON CONFLICT (id) DO UPDATE SET last_date = excluded.last_date, messages = messages + 1,
                     unread = unread + 1, last_sender = excluded.last_sender, snippet = excluded.snippet",
            )?;
            for id in next..batch_end {
                let date = 1_450_000_000 + id as i64 * (315_000_000 / messages.max(1) as i64);
                let (sender, mut subject, body, template_id) = if rng.unit() < shape.templated {
                    let t = rng.zipf(templates.len() as u64) as usize;
                    let template = &templates[t];
                    // A copy differs from its template by a few words, as a receipt does.
                    let body = format!("{} {}", template.body, text(&mut rng, 6, shape.vocabulary));
                    (
                        template.sender,
                        format!("{} {}", template.subject, id),
                        body,
                        Some(t as u64),
                    )
                } else {
                    let words = 30 + (rng.unit().powi(3) * 3_000.0) as u64;
                    let subject_words = 3 + rng.below(6);
                    (
                        rng.zipf(shape.senders),
                        text(&mut rng, subject_words, 5_000),
                        text(&mut rng, words, shape.vocabulary),
                        None,
                    )
                };
                let thread = if thread_count > 0 && rng.unit() < shape.in_threads {
                    // Replies mostly join a recent thread.
                    let back = rng.zipf(thread_count.min(5_000));
                    let thread = thread_count - back;
                    subject = thread_subject.get(&thread).cloned().unwrap_or(subject);
                    thread
                } else {
                    thread_count += 1;
                    if thread_subject.len() > 20_000 {
                        thread_subject.clear();
                    }
                    thread_subject.insert(thread_count, subject.clone());
                    thread_count
                };
                let size = (subject.len() + body.len()) as u64;
                raw_bytes += size;
                let snippet: String = body.chars().take(120).collect();
                insert.execute(params![
                    id as i64,
                    thread as i64,
                    sender as i64,
                    date,
                    size as i64,
                    0,
                    template_id.map(|t| t as i64),
                    subject,
                    body
                ])?;
                upsert.execute(params![
                    thread as i64,
                    date,
                    sender as i64,
                    subject,
                    snippet
                ])?;
                writer.add_document(
                    doc!(f_id => id, f_thread => thread, f_subject => subject, f_body => body),
                )?;
            }
        }
        tx.commit()?;
        if batch_end % 50_000 < 5_000 {
            writer.commit()?;
        }
        next = batch_end;
    }
    writer.commit()?;
    writer.wait_merging_threads()?;
    let import_seconds = started.elapsed().as_secs_f64();
    db.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;

    let sqlite_bytes = fs::metadata(&db_path)?.len();
    let index_bytes = dir_bytes(&dir.join("index"));

    // List 50 threads, newest first. Most reads are of the first pages; some go deep.
    let mut list_ms: Vec<f64> = Vec::new();
    {
        let mut list = db.prepare(
            "SELECT id, subject, snippet, last_date, messages, unread, last_sender
             FROM thread ORDER BY last_date DESC LIMIT 50 OFFSET ?1",
        )?;
        let pages = (thread_count / 50).max(1);
        for i in 0..300u64 {
            let page = if i % 5 == 0 {
                rng.below(pages)
            } else {
                rng.below(pages.min(20))
            };
            let t = Instant::now();
            let rows: Vec<(i64, String, String)> = list
                .query_map(params![(page * 50) as i64], |row| {
                    Ok((row.get(0)?, row.get(1)?, row.get(2)?))
                })?
                .collect::<Result<_, _>>()?;
            std::hint::black_box(rows);
            list_ms.push(t.elapsed().as_secs_f64() * 1000.0);
        }
    }
    list_ms.sort_by(|a, b| a.partial_cmp(b).unwrap());

    // Search, then read the 50 best threads back from the tables, as a client would.
    let reader = index.reader()?;
    let searcher = reader.searcher();
    let parser = QueryParser::for_index(&index, vec![f_subject, f_body]);
    let mut search_ms: Vec<f64> = Vec::new();
    let mut queries_with_hits = 0u64;
    let mut hits_returned = 0u64;
    {
        let mut by_id =
            db.prepare("SELECT id, subject, snippet, last_date FROM thread WHERE id = ?1")?;
        for i in 0..300u64 {
            let first = if i % 5 < 2 {
                rng.below(200)
            } else {
                200 + rng.zipf(shape.vocabulary - 200)
            };
            let query_text = if i % 3 == 0 {
                format!("{} {}", word(first), word(rng.zipf(shape.vocabulary)))
            } else {
                word(first)
            };
            let t = Instant::now();
            let query = parser.parse_query(&query_text)?;
            let hits = searcher.search(&query, &TopDocs::with_limit(50).order_by_score())?;
            queries_with_hits += u64::from(!hits.is_empty());
            hits_returned += hits.len() as u64;
            for (_score, address) in hits {
                let document: TantivyDocument = searcher.doc(address)?;
                if let Some(thread) = document.get_first(f_thread).and_then(|v| v.as_u64()) {
                    let row: Option<(i64, String)> = by_id
                        .query_row(params![thread as i64], |row| Ok((row.get(0)?, row.get(1)?)))
                        .ok();
                    std::hint::black_box(row);
                }
            }
            search_ms.push(t.elapsed().as_secs_f64() * 1000.0);
        }
    }
    search_ms.sort_by(|a, b| a.partial_cmp(b).unwrap());

    let import_rate = messages as f64 / import_seconds;
    let size_ratio = (sqlite_bytes + index_bytes) as f64 / raw_bytes.max(1) as f64;
    let list_p95 = percentile(&list_ms, 0.95);
    let search_p95 = percentile(&search_ms, 0.95);
    let round = |v: f64| (v * 100.0).round() / 100.0;
    let result = json!({
        "tool": "loam_mail_store_bench",
        "messages": messages,
        "threads": thread_count,
        "shape": { "templated": round(shape.templated), "in_threads": round(shape.in_threads),
                   "senders": shape.senders, "vocabulary": shape.vocabulary },
        "raw_bytes": raw_bytes,
        "sqlite_bytes": sqlite_bytes,
        "index_bytes": index_bytes,
        "import": { "seconds": round(import_seconds), "messages_per_second": round(import_rate) },
        "list_50_threads_ms": { "p50": round(percentile(&list_ms, 0.5)), "p95": round(list_p95),
                                "max": round(*list_ms.last().unwrap_or(&0.0)) },
        "search_ms": { "p50": round(percentile(&search_ms, 0.5)), "p95": round(search_p95),
                       "max": round(*search_ms.last().unwrap_or(&0.0)),
                       "queries": search_ms.len(), "queries_with_hits": queries_with_hits,
                       "hits_returned": hits_returned },
        "size_ratio": round(size_ratio),
        "thresholds": {
            "list_p95_ms": { "limit": LIST_P95_MS, "met": list_p95 <= LIST_P95_MS },
            "search_p95_ms": { "limit": SEARCH_P95_MS, "met": search_p95 <= SEARCH_P95_MS },
            "import_per_second": { "limit": IMPORT_PER_SECOND, "met": import_rate >= IMPORT_PER_SECOND },
            "size_ratio": { "limit": SIZE_RATIO, "met": size_ratio <= SIZE_RATIO },
        },
    });
    let rendered = serde_json::to_string_pretty(&result)?;
    match out {
        Some(path) => fs::write(path, rendered + "\n")?,
        None => println!("{rendered}"),
    }
    drop(db);
    let _ = fs::remove_dir_all(&dir);
    Ok(())
}
