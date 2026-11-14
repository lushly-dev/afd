//! A pass of sync against a real iCloud account, for the checks the
//! specification leaves to step B3 on the owner's account. Ignored: it runs
//! only when asked, with the sign-in in two files whose paths it is given, so
//! that the sign-in never appears in a command line, an environment variable
//! or its output.
//!
//! It reads and changes nothing at the provider beyond what sync does, which
//! is to read (`EXAMINE` and `BODY.PEEK`). It fetches headers for the whole
//! account and the bodies of a few batches, runs a second pass to time a
//! pass with nothing new, and answers the question of the specification's
//! section 4.2: when one Message-ID is in two mailboxes, does the provider
//! return the same header block and size for it, so that the store holds one
//! message? It prints and writes counts only: no address, subject, mailbox
//! name or text.
//!
//! ```text
//! LOAM_MAIL_LIVE_ADDRESS_FILE=... LOAM_MAIL_LIVE_PASSWORD_FILE=... \
//! LOAM_MAIL_LIVE_DIR=/tmp/live LOAM_MAIL_LIVE_OUT=results.json \
//!   cargo test --release --test live -- --ignored --nocapture
//! ```

#![allow(clippy::expect_used, clippy::unwrap_used)]

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Instant;

use afd::{Clock, SystemClock};
use async_trait::async_trait;
use loam_mail::engine::Engine;
use loam_mail::home::Home;
use loam_mail::parts::Structure;
use loam_mail::provider::imap::{Credentials, Endpoint, ICLOUD_NAMES, Imap};
use loam_mail::provider::{
    Connector, Fetched, FlagsSeen, Listing, Opened, PartFetched, Provider, ProviderError,
    RemoteMailbox, Since,
};
use loam_mail::store::{AccountRow, HeaderSeen, MessageId};
use loam_mail::sync::{AccountReport, Options, sync_account};
use serde_json::json;

/// A provider that serves only the first few requests for whole messages,
/// so that a pass over a large account fetches a sample of bodies and not
/// all of them. A request it does not serve returns nothing, which sync
/// takes as "not now".
struct Sampled {
    inner: Box<dyn Provider>,
    served: Arc<AtomicUsize>,
    limit: usize,
    timings: Timings,
}

/// Calls to the provider and the time they took, by method: what a pass
/// spent waiting on the provider, so that the rest is the engine's.
type Timings = Arc<std::sync::Mutex<std::collections::BTreeMap<&'static str, (u64, f64)>>>;

/// Runs `call`, adding its time to `method`'s.
async fn timed<T>(
    timings: &Timings,
    method: &'static str,
    call: impl std::future::Future<Output = T>,
) -> T {
    let started = Instant::now();
    let result = call.await;
    let mut timings = timings.lock().unwrap();
    let entry = timings.entry(method).or_insert((0, 0.0));
    entry.0 += 1;
    entry.1 += started.elapsed().as_secs_f64() * 1000.0;
    result
}

/// The provider's share of a pass, and the time left to the engine.
fn provider_time(timings: &Timings, seconds: f64) -> serde_json::Value {
    let timings = timings.lock().unwrap();
    let waited: f64 = timings.values().map(|(_, ms)| ms).sum::<f64>() / 1000.0;
    json!({
        "byMethod": timings.iter().map(|(method, (calls, ms))| {
            (method.to_string(), json!({ "calls": calls, "ms": ms.round() }))
        }).collect::<serde_json::Map<_, _>>(),
        "waitedSeconds": waited,
        "engineSeconds": seconds - waited,
    })
}

#[async_trait]
impl Provider for Sampled {
    async fn mailboxes(&mut self) -> Result<Vec<RemoteMailbox>, ProviderError> {
        timed(&self.timings, "mailboxes", self.inner.mailboxes()).await
    }
    async fn open(&mut self, mailbox: &str) -> Result<Opened, ProviderError> {
        timed(&self.timings, "open", self.inner.open(mailbox)).await
    }
    async fn list(&mut self) -> Result<Listing, ProviderError> {
        timed(&self.timings, "list", self.inner.list()).await
    }
    async fn changes(&mut self, cursor: &str) -> Result<Since, ProviderError> {
        timed(&self.timings, "changes", self.inner.changes(cursor)).await
    }
    async fn open_since(
        &mut self,
        mailbox: &str,
        validity: &str,
        cursor: &str,
    ) -> Result<(Opened, Option<Since>), ProviderError> {
        timed(
            &self.timings,
            "openSince",
            self.inner.open_since(mailbox, validity, cursor),
        )
        .await
    }
    async fn flags(&mut self) -> Result<Vec<FlagsSeen>, ProviderError> {
        timed(&self.timings, "flags", self.inner.flags()).await
    }
    async fn headers(&mut self, ids: &[String]) -> Result<Vec<HeaderSeen>, ProviderError> {
        timed(&self.timings, "headers", self.inner.headers(ids)).await
    }
    async fn messages(&mut self, ids: &[String]) -> Result<Vec<Fetched>, ProviderError> {
        if self.served.fetch_add(1, Ordering::SeqCst) < self.limit {
            timed(&self.timings, "messages", self.inner.messages(ids)).await
        } else {
            Ok(Vec::new())
        }
    }
    async fn structure(&mut self, id: &str) -> Result<Option<Structure>, ProviderError> {
        timed(&self.timings, "structure", self.inner.structure(id)).await
    }
    async fn parts(
        &mut self,
        id: &str,
        places: &[String],
    ) -> Result<Vec<PartFetched>, ProviderError> {
        if self.served.fetch_add(1, Ordering::SeqCst) < self.limit {
            timed(&self.timings, "parts", self.inner.parts(id, places)).await
        } else {
            Ok(Vec::new())
        }
    }
    async fn close(&mut self) {
        self.inner.close().await;
    }
}

struct Live {
    credentials: Credentials,
    served: Arc<AtomicUsize>,
    limit: usize,
    timings: Timings,
}

#[async_trait]
impl Connector for Live {
    async fn connect(&self, _account: &AccountRow) -> Result<Box<dyn Provider>, ProviderError> {
        let imap = timed(
            &self.timings,
            "connect",
            Imap::connect(&Endpoint::icloud(), &self.credentials, ICLOUD_NAMES),
        )
        .await?;
        let (condstore, qresync) = imap.extensions();
        eprintln!("connected: CONDSTORE {condstore}, QRESYNC {qresync}");
        Ok(Box::new(Sampled {
            inner: Box::new(imap),
            served: Arc::clone(&self.served),
            limit: self.limit,
            timings: Arc::clone(&self.timings),
        }))
    }
}

fn read_secret(variable: &str) -> String {
    let path = std::env::var(variable).unwrap_or_else(|_| panic!("{variable} names a file"));
    std::fs::read_to_string(path)
        .expect("the file can be read")
        .trim()
        .to_string()
}

fn totals(report: &AccountReport) -> serde_json::Value {
    let sum = |field: fn(&loam_mail::sync::MailboxReport) -> u64| -> u64 {
        report.mailboxes.iter().map(field).sum()
    };
    json!({
        "mailboxes": report.mailboxes.len(),
        "added": sum(|m| m.added),
        "changed": sum(|m| m.changed),
        "removed": sum(|m| m.removed),
        "notReturned": sum(|m| m.not_returned),
        "bodies": sum(|m| m.bodies),
        "setAside": sum(|m| m.set_aside),
        "errors": report.mailboxes.iter().filter(|m| m.error.is_some()).count(),
    })
}

#[test]
#[ignore = "a pass against a real iCloud account; run with the sign-in files named"]
fn a_pass_against_icloud() {
    let credentials = Credentials {
        user: read_secret("LOAM_MAIL_LIVE_ADDRESS_FILE"),
        password: read_secret("LOAM_MAIL_LIVE_PASSWORD_FILE"),
    };
    let directory = std::env::var("LOAM_MAIL_LIVE_DIR").expect("LOAM_MAIL_LIVE_DIR is set");
    let body_batches: usize = std::env::var("LOAM_MAIL_LIVE_BODY_BATCHES")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(20);
    let served = Arc::new(AtomicUsize::new(0));
    let timings: Timings = Arc::default();
    let connector = Live {
        credentials,
        served: Arc::clone(&served),
        limit: body_batches,
        timings: Arc::clone(&timings),
    };
    let home = Home::at(&directory);
    let engine = Engine::new(Some(home.clone()));
    let account = engine
        .with_store(|store| {
            // The address is not needed to sync: the connector holds the
            // sign-in. The row names the provider alone.
            store.add_account("icloud", "live", 0)?;
            Ok(store.accounts()?.remove(0))
        })
        .unwrap();
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    // The batch the B3 to B5 runs sampled with, so that "a few batches" of
    // bodies stay a few hundred.
    let options = Options {
        body_batch: 50,
        ..Options::default()
    };
    let started = Instant::now();
    let report_line = std::sync::Mutex::new(Instant::now());
    let first = runtime
        .block_on(sync_account(
            &engine,
            &connector,
            &account,
            &options,
            &SystemClock,
            &|line| {
                let mut at = report_line.lock().unwrap();
                if at.elapsed().as_secs() >= 30 {
                    *at = Instant::now();
                    eprintln!("{line}");
                }
            },
        ))
        .expect("the first pass completes");
    let first_seconds = started.elapsed().as_secs_f64();
    let first_totals = totals(&first);
    eprintln!("first pass: {first_seconds:.0} s, {first_totals}");

    timings.lock().unwrap().clear();
    let started = Instant::now();
    let second = runtime
        .block_on(sync_account(
            &engine,
            &connector,
            &account,
            &options,
            &SystemClock,
            &|_| {},
        ))
        .expect("the second pass completes");
    let second_seconds = started.elapsed().as_secs_f64();
    let second_totals = totals(&second);
    let second_provider = provider_time(&timings, second_seconds);
    eprintln!("second pass: {second_seconds:.1} s, {second_totals}, {second_provider}");

    // A third pass, after the second has tried what was due.
    timings.lock().unwrap().clear();
    let started = Instant::now();
    let third = runtime
        .block_on(sync_account(
            &engine,
            &connector,
            &account,
            &options,
            &SystemClock,
            &|_| {},
        ))
        .expect("the third pass completes");
    let third_seconds = started.elapsed().as_secs_f64();
    let third_totals = totals(&third);
    let third_provider = provider_time(&timings, third_seconds);
    eprintln!("third pass: {third_seconds:.1} s, {third_totals}, {third_provider}");

    // What the store's reads in a pass cost, mailbox by mailbox: the time
    // summed over every mailbox, and the most one mailbox took.
    let mut queries: std::collections::BTreeMap<&'static str, (f64, f64)> =
        std::collections::BTreeMap::new();
    let mut add = |name: &'static str, started: Instant| {
        let ms = started.elapsed().as_secs_f64() * 1000.0;
        let entry = queries.entry(name).or_insert((0.0, 0.0));
        entry.0 += ms;
        entry.1 = entry.1.max(ms);
    };
    let mut bodies_wanted = 0usize;
    let mut refetch_wanted = 0usize;
    let mut largest_shown = 0usize;
    engine
        .with_store(|store| {
            let now = SystemClock.now();
            for row in store.mailboxes(account.id)? {
                let at = Instant::now();
                let shown = store.shown_ids(row.id, &row.validity)?;
                add("shownIds", at);
                largest_shown = largest_shown.max(shown.len());
                let at = Instant::now();
                store.unreturned_tries(row.id, &row.validity)?;
                add("unreturnedTries", at);
                let at = Instant::now();
                store.mailbox_counts(row.id)?;
                add("mailboxCounts", at);
                let at = Instant::now();
                bodies_wanted += store.bodies_wanted(row.id, &row.validity, now)?.len();
                add("bodiesWanted", at);
                let at = Instant::now();
                refetch_wanted += store.refetch_wanted(row.id, &row.validity)?.len();
                add("refetchWanted", at);
                let at = Instant::now();
                store.mailbox_status(row.id)?;
                add("mailboxStatus", at);
            }
            Ok(())
        })
        .unwrap();
    let store_queries = json!({
        "byQuery": queries.iter().map(|(name, (total, most))| {
            (name.to_string(), json!({ "totalMs": total.round(), "mostMs": most.round() }))
        }).collect::<serde_json::Map<_, _>>(),
        "bodiesWanted": bodies_wanted,
        "refetchWanted": refetch_wanted,
        "largestMailboxShown": largest_shown,
    });
    eprintln!("store queries: {store_queries}");

    // The specification's 4.2: one Message-ID in two mailboxes.
    let database = rusqlite::Connection::open_with_flags(
        home.database(),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .unwrap();
    let mut shown: HashMap<i64, HashSet<i64>> = HashMap::new();
    {
        let mut statement = database
            .prepare("SELECT message_id, mailbox_id FROM observation WHERE ended_at IS NULL")
            .unwrap();
        let rows = statement
            .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)))
            .unwrap();
        for row in rows {
            let (message, mailbox) = row.unwrap();
            shown.entry(message).or_default().insert(mailbox);
        }
    }
    let in_two_mailboxes = shown
        .values()
        .filter(|mailboxes| mailboxes.len() > 1)
        .count();
    // Each message's own Message-ID, from its header block in the log.
    let mut by_id: HashMap<String, Vec<i64>> = HashMap::new();
    let mut without_id = 0u64;
    engine
        .with_store(|store| {
            for message in shown.keys() {
                let block = store.read_part(MessageId(*message), "header")?;
                let parsed = mail_parser::MessageParser::new().parse_headers(&block[..]);
                match parsed.as_ref().and_then(|parsed| parsed.message_id()) {
                    Some(id) => by_id.entry(id.to_string()).or_default().push(*message),
                    None => without_id += 1,
                }
            }
            Ok(())
        })
        .unwrap();
    let mut spread = 0u64; // a Message-ID shown in more than one mailbox
    let mut one_message = 0u64; // ... held as one message
    let mut several = 0u64; // ... held as several
    let mut same_block_other_size = 0u64;
    for messages in by_id.values() {
        let mailboxes: HashSet<i64> = messages
            .iter()
            .flat_map(|message| shown[message].iter().copied())
            .collect();
        if mailboxes.len() < 2 {
            continue;
        }
        spread += 1;
        if messages.len() == 1 {
            one_message += 1;
        } else {
            several += 1;
            let hashes: HashSet<Vec<u8>> = messages
                .iter()
                .map(|message| {
                    database
                        .query_row(
                            "SELECT header_hash FROM message WHERE id = ?1",
                            [message],
                            |row| row.get(0),
                        )
                        .unwrap()
                })
                .collect();
            if hashes.len() == 1 {
                same_block_other_size += 1;
            }
        }
    }
    let unreturned: (i64, i64) = database
        .query_row(
            "SELECT count(*) FILTER (WHERE tries < 3), count(*) FILTER (WHERE tries >= 3)
             FROM unreturned",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    let headers: i64 = database
        .query_row(
            "SELECT count(*) FROM observation WHERE ended_at IS NULL",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let results = json!({
        "run": "B5 live passes, iCloud: where a pass with nothing new spends its time",
        "firstPass": {
            "seconds": first_seconds,
            "headersPerSecond": (headers as f64) / first_seconds,
            "totals": first_totals,
        },
        "secondPass": {
            "seconds": second_seconds,
            "totals": second_totals,
            "provider": second_provider,
        },
        "thirdPass": {
            "seconds": third_seconds,
            "totals": third_totals,
            "provider": third_provider,
        },
        "storeQueries": store_queries,
        "messagesShown": headers,
        "awaited": unreturned.0,
        "unreturned": unreturned.1,
        "bodyBatchesServed": served.load(Ordering::SeqCst).min(body_batches),
        "identity": {
            "messagesInMoreThanOneMailbox": in_two_mailboxes,
            "messageIdsInMoreThanOneMailbox": spread,
            "heldAsOneMessage": one_message,
            "heldAsSeveral": several,
            "severalWithOneHeaderBlockAndOtherSizes": same_block_other_size,
            "messagesWithoutMessageId": without_id,
        },
    });
    let rendered = serde_json::to_string_pretty(&results).unwrap();
    println!("{rendered}");
    if let Ok(out) = std::env::var("LOAM_MAIL_LIVE_OUT") {
        std::fs::write(out, rendered + "\n").unwrap();
    }
}
