//! The measurement of the specification's section 4.4: the store's limits at
//! 500 000 messages, with the census's shape.
//!
//! The messages are made up; nothing here reads real mail. The full run is
//! ignored by default, because it takes minutes and gigabytes:
//!
//!     LOAM_MAIL_MEASURE_CENSUS=<counts file> LOAM_MAIL_MEASURE_OUT=<results file> \
//!         cargo test --release --test limits -- --ignored --nocapture
//!
//! `LOAM_MAIL_MEASURE_MESSAGES` sets how many messages (500 000 by default)
//! and `LOAM_MAIL_MEASURE_DIR` where the data directory is made. A small run
//! is part of the ordinary tests, to keep the harness itself working; it
//! checks counts, not times.

#![allow(clippy::expect_used, clippy::unwrap_used)]

use std::fmt::Write as _;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use loam_mail::home::Home;
use loam_mail::store::{
    HeaderSeen, MailboxId, MailboxSeen, MessageId, PartSeen, Place, Role, Store, ThreadId,
};
use serde_json::json;

/// The limits of the specification's section 4.4.
const LIST_P95_MS: f64 = 50.0;
const SEARCH_P95_MS: f64 = 200.0;
const OPEN_P95_MS: f64 = 50.0;
const IMPORT_PER_SECOND: f64 = 500.0;
const DERIVED_RATIO: f64 = 3.0;
const DIRECTORY_RATIO: f64 = 1.5;

/// The largest attachment the harness makes. The census found larger ones;
/// they would add bytes to the log and nothing to the tables.
const ATTACHMENT_LIMIT: u64 = 2 * 1024 * 1024;

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

/// About `bytes` of words, in lines.
fn text(rng: &mut Rng, bytes: u64, vocabulary: u64) -> String {
    let mut out = String::with_capacity(bytes as usize + 16);
    let mut line = 0;
    while (out.len() as u64) < bytes {
        let next = word(rng.zipf(vocabulary));
        if line + next.len() > 72 {
            out.push_str("\r\n");
            line = 0;
        } else if !out.is_empty() {
            out.push(' ');
            line += 1;
        }
        line += next.len();
        out.push_str(&next);
    }
    out
}

/// The mailbox's shape: the shares the store cares about.
struct Shape {
    templated: f64,
    in_threads: f64,
    senders: u64,
    vocabulary: u64,
    /// Upper bounds of whole-message sizes and how many messages fall under each.
    sizes: Vec<(u64, u64)>,
}

impl Shape {
    /// The iCloud census's shape (`prototype/icloud.counts.json`), used when
    /// no census file is given.
    fn default() -> Self {
        Self {
            templated: 0.82,
            in_threads: 0.67,
            senders: 2906,
            vocabulary: 50_000,
            sizes: vec![
                (4096, 2496),
                (16_384, 241_404),
                (65_536, 38_777),
                (262_144, 12_750),
                (1_048_576, 728),
                (10_485_760, 488),
                (26_214_400, 54),
            ],
        }
    }

    fn from_census(path: &Path) -> Self {
        let census: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(path).expect("the census file")).unwrap();
        let mut shape = Self::default();
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
        if let Some(sizes) = census["sizes_bytes"].as_object() {
            let mut read: Vec<(u64, u64)> = sizes
                .iter()
                .filter_map(|(range, count)| {
                    let upper = range.split('-').nth(1).and_then(|upper| upper.parse().ok());
                    Some((upper.unwrap_or(26_214_400), count.as_u64()?))
                })
                .collect();
            read.sort_unstable();
            if !read.is_empty() {
                shape.sizes = read;
            }
        }
        shape
    }

    /// A whole message's size, drawn from the census's distribution.
    fn size(&self, rng: &mut Rng) -> u64 {
        let total: u64 = self.sizes.iter().map(|(_, count)| count).sum();
        let mut pick = rng.below(total);
        let mut lower = 600;
        for (upper, count) in &self.sizes {
            if pick < *count {
                return lower + rng.below(upper.saturating_sub(lower).max(1));
            }
            pick -= count;
            lower = *upper;
        }
        8000
    }
}

struct Template {
    sender: u64,
    subject: String,
    body: String,
}

/// One made-up message.
struct Made {
    header: HeaderSeen,
    whole: Vec<u8>,
    /// The whole message's bytes without its attachment.
    text_bytes: u64,
}

struct Maker {
    rng: Rng,
    shape: Shape,
    templates: Vec<Template>,
    made: u64,
    total: u64,
}

impl Maker {
    fn new(shape: Shape, total: u64) -> Self {
        let mut rng = Rng(0x9E37_79B9_7F4A_7C15);
        let templates = (0..2_000u64)
            .map(|_| {
                let subject_words = 3 + rng.below(6);
                Template {
                    sender: rng.zipf(shape.senders),
                    subject: (0..subject_words)
                        .map(|_| word(rng.zipf(2_000)))
                        .collect::<Vec<_>>()
                        .join(" "),
                    body: {
                        let bytes = 300 + rng.below(3_000);
                        text(&mut rng, bytes, shape.vocabulary)
                    },
                }
            })
            .collect();
        Self {
            rng,
            shape,
            templates,
            made: 0,
            total,
        }
    }

    fn next(&mut self) -> Made {
        self.made += 1;
        let id = self.made;
        let size = self.shape.size(&mut self.rng);
        // What is over 64 KiB is an attachment; the rest is text, twice: plain and HTML.
        let attachment = size.saturating_sub(65_536).min(ATTACHMENT_LIMIT);
        let plain_bytes = (size - size.saturating_sub(65_536)).saturating_sub(1_600) / 3;
        let (sender, subject, plain) = if self.rng.unit() < self.shape.templated {
            let pick = self.rng.zipf(self.templates.len() as u64) as usize;
            let template = &self.templates[pick];
            // A copy shares its template's text and fills the rest of its
            // size with words of its own, as a notification does. Repeating
            // the template instead would give the index fewer words to hold.
            let own = plain_bytes
                .saturating_sub(template.body.len() as u64)
                .max(40);
            let extra = text(&mut self.rng, own, self.shape.vocabulary);
            let mut body = template.body.clone();
            body.push_str("\r\n");
            body.push_str(&extra);
            (template.sender, format!("{} {id}", template.subject), body)
        } else {
            let subject_words = 3 + self.rng.below(6);
            let subject = (0..subject_words)
                .map(|_| word(self.rng.zipf(5_000)))
                .collect::<Vec<_>>()
                .join(" ");
            let sender = self.rng.zipf(self.shape.senders);
            let body = text(&mut self.rng, plain_bytes.max(60), self.shape.vocabulary);
            (sender, subject, body)
        };
        let seconds = 1_450_000_000 + id as i64 * (315_000_000 / self.total.max(1) as i64).max(1);
        let date = mail_date(seconds);
        let mut header = String::with_capacity(1_800);
        for hop in 0..3 {
            let _ = write!(
                header,
                "Received: from mx{hop}.sender{sender}.example ([203.0.113.{}])\r\n\tby \
                 mail{hop}.provider.example with ESMTPS id {:016x}{:016x}\r\n\tfor \
                 <person@example.com>; {date}\r\n",
                self.rng.below(250),
                self.rng.next(),
                self.rng.next(),
            );
        }
        let _ = write!(
            header,
            "DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=sender{sender}.example;\r\n\t\
             s=selector1; h=from:to:subject:date:message-id; bh={:016x}{:016x}{:016x}=;\r\n\t\
             b={:016x}{:016x}{:016x}{:016x}{:016x}{:016x}{:016x}{:016x}\r\n",
            self.rng.next(),
            self.rng.next(),
            self.rng.next(),
            self.rng.next(),
            self.rng.next(),
            self.rng.next(),
            self.rng.next(),
            self.rng.next(),
            self.rng.next(),
            self.rng.next(),
            self.rng.next(),
        );
        let _ = write!(
            header,
            "From: {} <notify@sender{sender}.example>\r\nTo: Person <person@example.com>\r\n\
             Subject: {subject}\r\nDate: {date}\r\nMessage-ID: <m{id}@thread.example>\r\n",
            word(sender),
        );
        if id > 1 && self.rng.unit() < self.shape.in_threads {
            // Replies mostly join a recent message. One in fifty names a
            // second, older one, which makes two threads one.
            let back = 1 + self.rng.zipf((id - 1).min(5_000));
            let mut named = format!("<m{}@thread.example>", id - back);
            if id.is_multiple_of(50) {
                let other = 1 + self.rng.below(id - 1);
                let _ = write!(named, " <m{other}@thread.example>");
            }
            let _ = writeln!(header, "References: {named}\r");
        } else if id > 1 && id.is_multiple_of(100) {
            // One thread that never ends: every hundredth message joins it.
            let _ = writeln!(header, "References: <m1@thread.example>\r");
        }
        header.push_str(
            "List-Unsubscribe: <https://sender.example/unsubscribe>\r\nMIME-Version: 1.0\r\n",
        );
        let html = format!(
            "<html><head><style>p {{ margin: 0 0 12px 0; font: 14px sans-serif }}</style></head>\
             <body><table width=\"600\"><tr><td><p>{}</p></td></tr></table></body></html>",
            plain.replace("\r\n", "</p>\r\n<p>")
        );
        let mut body = String::with_capacity(plain.len() + html.len() + 600);
        let boundary = format!("alt-{id:x}");
        let _ = write!(
            body,
            "--{boundary}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n{plain}\r\n\
             --{boundary}\r\nContent-Type: text/html; charset=utf-8\r\n\r\n{html}\r\n--{boundary}--\r\n"
        );
        let mut whole = String::with_capacity(header.len() + body.len() + 200);
        let text_bytes;
        if attachment == 0 {
            let _ = write!(
                header,
                "Content-Type: multipart/alternative; boundary=\"{boundary}\"\r\n\r\n"
            );
            whole.push_str(&header);
            whole.push_str(&body);
            text_bytes = whole.len() as u64;
        } else {
            let outer = format!("mix-{id:x}");
            let _ = write!(
                header,
                "Content-Type: multipart/mixed; boundary=\"{outer}\"\r\n\r\n"
            );
            whole.push_str(&header);
            let _ = write!(
                whole,
                "--{outer}\r\nContent-Type: multipart/alternative; boundary=\"{boundary}\"\r\n\r\n{body}\r\n"
            );
            text_bytes = whole.len() as u64;
            let _ = write!(
                whole,
                "--{outer}\r\nContent-Type: application/pdf; name=\"file{id}.pdf\"\r\n\
                 Content-Disposition: attachment; filename=\"file{id}.pdf\"\r\n\
                 Content-Transfer-Encoding: base64\r\n\r\n"
            );
            // Bytes that do not compress, as a PDF's or a picture's do not.
            let mut written = 0;
            while written < attachment {
                for _ in 0..7 {
                    let _ = write!(whole, "{}", base64(self.rng.next()));
                }
                whole.push_str("\r\n");
                written += 79;
            }
            let _ = write!(whole, "--{outer}--\r\n");
        }
        let header_block = whole.as_bytes()[..whole.find("\r\n\r\n").unwrap() + 4].to_vec();
        Made {
            header: HeaderSeen {
                provider_id: id.to_string(),
                provider_thread: None,
                reported_size: whole.len() as u64,
                internal_date: Some(seconds * 1000),
                flags: vec!["\\Seen".to_string()],
                header_block,
            },
            whole: whole.into_bytes(),
            text_bytes,
        }
    }
}

/// Eleven characters of the base64 alphabet from 64 bits.
fn base64(mut bits: u64) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(11);
    for _ in 0..11 {
        out.push(ALPHABET[(bits & 63) as usize] as char);
        bits = bits.rotate_right(6) ^ 0x5DEE_CE66D;
    }
    out
}

fn mail_date(seconds: i64) -> String {
    mail_parser::DateTime::from_timestamp(seconds).to_rfc822()
}

fn percentile(sorted: &[f64], p: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    sorted[((sorted.len() as f64 - 1.0) * p).round() as usize]
}

fn sorted_ms(mut times: Vec<f64>) -> Vec<f64> {
    times.sort_by(|a, b| a.partial_cmp(b).unwrap());
    times
}

/// The bytes of every file under `path`: as their lengths, and as the disk
/// counts them.
fn directory_bytes(path: &Path) -> (u64, u64) {
    let (mut length, mut on_disk) = (0, 0);
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            let Ok(meta) = entry.metadata() else { continue };
            if meta.is_dir() {
                let (inner_length, inner_disk) = directory_bytes(&entry.path());
                length += inner_length;
                on_disk += inner_disk;
            } else {
                length += meta.len();
                #[cfg(unix)]
                {
                    use std::os::unix::fs::MetadataExt;
                    on_disk += meta.blocks() * 512;
                }
                #[cfg(not(unix))]
                {
                    on_disk += meta.len();
                }
            }
        }
    }
    (length, on_disk)
}

fn round(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

/// The machine's load averages, as `uptime` prints them: other work on the
/// machine slows every figure here, so a result says how busy it was.
fn load() -> String {
    std::process::Command::new("uptime")
        .output()
        .ok()
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .and_then(|line| {
            line.rsplit("load average")
                .next()
                .map(|rest| rest.trim_start_matches(['s', ':', ' ']).trim().to_string())
        })
        .unwrap_or_default()
}

/// Imports `messages` made-up messages and measures the store.
fn measure(messages: u64, shape: Shape, directory: &Path) -> serde_json::Value {
    let home = Home::at(directory.join("data"));
    let mut store = Store::open(&home).expect("the store opens");
    let account = store
        .add_account("icloud", "person@example.com", 1)
        .unwrap();
    // One large mailbox and five ordinary ones, as the census found.
    let mailboxes: Vec<MailboxId> = [
        "Notifications",
        "INBOX",
        "Archive",
        "Receipts",
        "Lists",
        "Work",
    ]
    .iter()
    .map(|name| {
        store
            .upsert_mailbox(
                account,
                &MailboxSeen {
                    provider_key: name,
                    name,
                    role: if *name == "INBOX" {
                        Role::Inbox
                    } else {
                        Role::None
                    },
                },
            )
            .unwrap()
    })
    .collect();

    let load_at_start = load();
    let vocabulary = shape.vocabulary;
    let now = 1_800_000_000_000;
    let mut maker = Maker::new(shape, messages);
    let mut store_time = Duration::ZERO;
    let (mut held_bytes, mut text_bytes) = (0u64, 0u64);
    let mut newest = 0;
    let mut batch_number = 0u64;
    let parts_batch: usize = std::env::var("LOAM_MAIL_MEASURE_PARTS_BATCH")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(50);
    let (mut headers_time, mut parts_time) = (Duration::ZERO, Duration::ZERO);
    let mut done = 0;
    while done < messages {
        let size = 250.min(messages - done);
        let made: Vec<Made> = (0..size).map(|_| maker.next()).collect();
        done += size;
        batch_number += 1;
        // Five batches of six go to the large mailbox.
        let mailbox = if batch_number.is_multiple_of(6) {
            mailboxes[1 + ((batch_number / 6 - 1) % 5) as usize]
        } else {
            mailboxes[0]
        };
        for message in &made {
            // Each message counts once, though its header block is also
            // held as a file of its own.
            held_bytes += message.whole.len() as u64;
            text_bytes += message.text_bytes;
            newest = newest.max(message.header.internal_date.unwrap_or(0));
        }
        let headers: Vec<HeaderSeen> = made.iter().map(|message| message.header.clone()).collect();

        let started = Instant::now();
        store.record_headers(mailbox, "", &headers, now).unwrap();
        headers_time += started.elapsed();
        let ids: Vec<MessageId> = headers
            .iter()
            .map(|seen| {
                store
                    .find_message(&seen.header_block, seen.reported_size)
                    .unwrap()
                    .expect("the message was recorded")
            })
            .collect();
        for (messages, ids) in made.chunks(parts_batch).zip(ids.chunks(parts_batch)) {
            let parts: Vec<PartSeen<'_>> = messages
                .iter()
                .zip(ids)
                .map(|(message, id)| PartSeen {
                    message: *id,
                    place: Place::Whole,
                    bytes: &message.whole,
                })
                .collect();
            let part_started = Instant::now();
            store.record_parts(&parts, now).unwrap();
            parts_time += part_started.elapsed();
        }
        store_time += started.elapsed();
        if done % 50_000 < 250 {
            eprintln!("imported {done} of {messages}");
        }
    }
    let started = Instant::now();
    store.settle_files().unwrap();
    store_time += started.elapsed();
    let import_rate = messages as f64 / store_time.as_secs_f64();

    let (database_bytes, _) = directory_bytes_of_file(&home.database());
    let (index_bytes, index_on_disk) = directory_bytes(&home.index());
    let (log_bytes, log_on_disk) = directory_bytes(&home.blobs());
    let (directory_length, directory_on_disk) = directory_bytes(home.root());
    let threads = store.thread_count().unwrap();

    // The reads are made by a store opened afresh: nothing of the import is
    // left in its own caches. The operating system's cache is as the import
    // left it; emptying that needs rights a test does not have.
    drop(store);
    let mut store = Store::open(&home).expect("the store opens again");

    // List 50 threads: two reads of three in the large mailbox, the third in
    // an ordinary one. Most reads are of the first
    // pages; some start deep in the list.
    let mut rng = Rng(0x2545_F491_4F6C_DD1D);
    let mut list_ms = Vec::new();
    let mut listed = 0u64;
    let mut cursor: Option<(i64, ThreadId)> = None;
    for i in 0..300u64 {
        if i % 5 == 0 {
            let back = rng.below((newest - 1_450_000_000_000).max(1) as u64) as i64;
            cursor = Some((newest - back, ThreadId(i64::MAX)));
        } else if i % 20 == 1 {
            cursor = None;
        }
        let started = Instant::now();
        let mailbox = mailboxes[usize::from(i % 3 == 2)];
        let page = store.list_threads(mailbox, cursor, 50).unwrap();
        list_ms.push(started.elapsed().as_secs_f64() * 1000.0);
        listed += page.len() as u64;
        cursor = page.last().map(|thread| (thread.last_date, thread.thread));
    }
    let list_ms = sorted_ms(list_ms);

    // Search, and read the 50 best back with their threads.
    let mut search_ms = Vec::new();
    let (mut queries_with_hits, mut hits) = (0u64, 0u64);
    for i in 0..300u64 {
        let first = if i % 5 < 2 {
            rng.below(200)
        } else {
            200 + rng.zipf(vocabulary - 200)
        };
        let query = if i % 3 == 0 {
            format!("{} {}", word(first), word(rng.zipf(vocabulary)))
        } else {
            word(first)
        };
        let started = Instant::now();
        let found = store.search(&query, 50).unwrap();
        search_ms.push(started.elapsed().as_secs_f64() * 1000.0);
        queries_with_hits += u64::from(!found.is_empty());
        hits += found.len() as u64;
    }
    let search_ms = sorted_ms(search_ms);

    // Open one message: read it from the log, check it, parse it.
    let mut open_ms = Vec::new();
    let mut opened_with_text = 0u64;
    for _ in 0..300 {
        let message = MessageId(1 + rng.below(messages) as i64);
        let started = Instant::now();
        let opened = store.open_message(message).unwrap();
        open_ms.push(started.elapsed().as_secs_f64() * 1000.0);
        opened_with_text += u64::from(opened.body.is_some_and(|body| !body.text.is_empty()));
    }
    let open_ms = sorted_ms(open_ms);

    let derived_ratio = (database_bytes + index_bytes) as f64 / text_bytes.max(1) as f64;
    let directory_ratio = directory_on_disk as f64 / held_bytes.max(1) as f64;
    let directory_length_ratio = directory_length as f64 / held_bytes.max(1) as f64;
    let (list_p95, search_p95, open_p95) = (
        percentile(&list_ms, 0.95),
        percentile(&search_ms, 0.95),
        percentile(&open_ms, 0.95),
    );
    let times = |sorted: &[f64]| {
        json!({ "p50": round(percentile(sorted, 0.5)), "p95": round(percentile(sorted, 0.95)),
                "max": round(sorted.last().copied().unwrap_or(0.0)) })
    };
    json!({
        "tool": "loam_mail limits",
        "load_averages": { "at_start": load_at_start, "at_end": load() },
        "messages": messages,
        "threads": threads,
        "shape": { "templated": round(maker.shape.templated), "in_threads": round(maker.shape.in_threads),
                   "senders": maker.shape.senders, "vocabulary": vocabulary },
        "bytes": {
            "held": held_bytes,
            "messages_without_attachments": text_bytes,
            "database": database_bytes,
            "index": index_bytes,
            "index_on_disk": index_on_disk,
            "log": log_bytes,
            "log_on_disk": log_on_disk,
            "directory": directory_length,
            "directory_on_disk": directory_on_disk,
        },
        "import": { "seconds": round(store_time.as_secs_f64()), "messages_per_second": round(import_rate),
                    "seconds_headers": round(headers_time.as_secs_f64()),
                    "seconds_bodies": round(parts_time.as_secs_f64()),
                    "bodies_to_a_batch": parts_batch },
        "list_50_threads_ms": times(&list_ms),
        "search_ms": times(&search_ms),
        "open_message_ms": times(&open_ms),
        "checks": { "threads_listed": listed, "queries": 300, "queries_with_hits": queries_with_hits,
                    "hits": hits, "opened_with_text": opened_with_text },
        "derived_ratio": round(derived_ratio),
        "directory_ratio": round(directory_ratio),
        "directory_ratio_by_file_length": round(directory_length_ratio),
        "limits": {
            "list_p95_ms": { "limit": LIST_P95_MS, "met": list_p95 <= LIST_P95_MS },
            "search_p95_ms": { "limit": SEARCH_P95_MS, "met": search_p95 <= SEARCH_P95_MS },
            "open_p95_ms": { "limit": OPEN_P95_MS, "met": open_p95 <= OPEN_P95_MS },
            "import_per_second": { "limit": IMPORT_PER_SECOND, "met": import_rate >= IMPORT_PER_SECOND },
            "derived_ratio": { "limit": DERIVED_RATIO, "met": derived_ratio <= DERIVED_RATIO },
            "directory_ratio": { "limit": DIRECTORY_RATIO, "met": directory_ratio <= DIRECTORY_RATIO },
        },
    })
}

/// The database with its write-ahead log, which is empty after a checkpoint.
fn directory_bytes_of_file(database: &Path) -> (u64, u64) {
    let mut length = 0;
    for path in [
        database.to_path_buf(),
        database.with_extension("sqlite3-wal"),
    ] {
        length += std::fs::metadata(path).map(|meta| meta.len()).unwrap_or(0);
    }
    (length, length)
}

#[test]
fn the_measurement_runs_at_a_small_size() {
    let directory = tempfile::tempdir().expect("a temporary directory");
    let result = measure(1_500, Shape::default(), directory.path());
    let checks = &result["checks"];
    assert_eq!(result["messages"], 1_500);
    assert!(result["threads"].as_u64().unwrap() < 1_500, "{result}");
    assert!(result["threads"].as_u64().unwrap() > 100, "{result}");
    assert!(
        checks["threads_listed"].as_u64().unwrap() > 1_000,
        "{result}"
    );
    assert!(
        checks["queries_with_hits"].as_u64().unwrap() > 150,
        "{result}"
    );
    assert_eq!(checks["opened_with_text"], 300, "{result}");
    assert!(result["bytes"]["index"].as_u64().unwrap() > 0);
}

#[test]
#[ignore = "the 4.4 measurement; run with --ignored --nocapture in a release build"]
fn the_limits_of_section_4_4_hold() {
    let variable = |name: &str| std::env::var(name).ok().filter(|value| !value.is_empty());
    let messages = variable("LOAM_MAIL_MEASURE_MESSAGES")
        .and_then(|value| value.parse().ok())
        .unwrap_or(500_000);
    let shape = variable("LOAM_MAIL_MEASURE_CENSUS")
        .map_or_else(Shape::default, |path| Shape::from_census(Path::new(&path)));
    let kept;
    let directory: PathBuf = match variable("LOAM_MAIL_MEASURE_DIR") {
        Some(path) => PathBuf::from(path),
        None => {
            kept = tempfile::tempdir().expect("a temporary directory");
            kept.path().to_path_buf()
        }
    };
    let result = measure(messages, shape, &directory);
    let rendered = serde_json::to_string_pretty(&result).unwrap();
    println!("{rendered}");
    if let Some(out) = variable("LOAM_MAIL_MEASURE_OUT") {
        std::fs::write(out, rendered + "\n").unwrap();
    }
    for (name, limit) in result["limits"].as_object().unwrap() {
        assert_eq!(limit["met"], true, "{name} is not met");
    }
}
