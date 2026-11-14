//! Step C1's report on the owner's mail (the specification's 6.3 and 7.2):
//! Q2 as the engine computes it beside the census's figure, and how many
//! stream stories each of the two groupings gives. Ignored: it runs only
//! when asked, on a copy of a synced store whose directory it is given.
//!
//! It opens the copy, which brings its schema up to date, derives again
//! every message an older derivation wrote (that fills the senders), and
//! reports counts and milliseconds only: no address, subject, name or text.
//! It refuses the data directory a running engine uses: copy it first (on
//! APFS, `cp -cR` makes the copy at once and takes no room until it differs).
//!
//! ```text
//! LOAM_MAIL_LIVE_HOME=/path/to/copy LOAM_MAIL_LIVE_OUT=results.json \
//!   cargo test --release --test live_screening -- --ignored --nocapture
//! ```

#![allow(clippy::expect_used, clippy::unwrap_used)]

use std::time::Instant;

use loam_mail::home::Home;
use loam_mail::store::{ScreeningCounts, SenderQuery, Store, sender_id};
use serde_json::json;

/// The census's Q2 on the same account (the prototype's README): the whole
/// account, and without the largest mailbox.
const CENSUS_Q2: f64 = 0.984;
const CENSUS_Q2_WITHOUT_LARGEST: f64 = 0.609;

fn p95(mut samples: Vec<f64>) -> f64 {
    samples.sort_by(f64::total_cmp);
    let at = (samples.len() * 95).div_ceil(100).saturating_sub(1);
    (samples[at] * 100.0).round() / 100.0
}

fn rounded(share: Option<f64>) -> Option<f64> {
    share.map(|share| (share * 1000.0).round() / 1000.0)
}

fn counts(counts: &ScreeningCounts) -> serde_json::Value {
    let mut value = serde_json::to_value(counts).unwrap();
    value["decided"] = json!(counts.decided());
    value["q2"] = json!(rounded(counts.q2()));
    value
}

#[test]
#[ignore = "reads a copy of a real store; run with its directory named"]
fn screening_on_a_copy_of_a_synced_store() {
    let path = std::env::var("LOAM_MAIL_LIVE_HOME").expect("LOAM_MAIL_LIVE_HOME names a copy");
    let path = std::path::PathBuf::from(path);
    if let Some(real) = std::env::var_os("HOME") {
        let real = std::path::Path::new(&real).join("Library/Application Support/loam-mail");
        assert_ne!(
            path.canonicalize().ok(),
            real.canonicalize().ok(),
            "copy the data directory; this changes the store's schema"
        );
    }
    let home = Home::at(path);
    let opened = Instant::now();
    let mut store = Store::open(&home).unwrap();
    let migrate_ms = opened.elapsed().as_millis();

    let stale = store.stale_count().unwrap();
    let started = Instant::now();
    let mut derived = 0_u64;
    loop {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis();
        let done = store
            .rederive_stale(500, i64::try_from(now).unwrap())
            .unwrap();
        if done == 0 {
            break;
        }
        derived += u64::try_from(done).unwrap();
        if derived % 20_000 < 500 {
            eprintln!(
                "derived {derived} of {stale} in {} s",
                started.elapsed().as_secs()
            );
        }
    }
    store.commit_index().unwrap();
    let derive_seconds = started.elapsed().as_secs();

    let reported = Instant::now();
    let report = store.screening_report().unwrap();
    let report_ms = reported.elapsed().as_millis();

    // The sender commands' reads, 100 times each.
    let mut list = Vec::new();
    let mut page_one = Vec::new();
    for _ in 0..100 {
        let at = Instant::now();
        page_one = store
            .senders(&SenderQuery {
                limit: 51,
                ..SenderQuery::default()
            })
            .unwrap();
        list.push(at.elapsed().as_secs_f64() * 1000.0);
    }
    let everyone = store
        .senders(&SenderQuery {
            limit: u32::MAX,
            ..SenderQuery::default()
        })
        .unwrap();
    let largest = everyone
        .iter()
        .max_by_key(|sender| sender.messages)
        .cloned()
        .unwrap();
    let mut show = Vec::new();
    for _ in 0..20 {
        let at = Instant::now();
        let row = store.sender(sender_id(&largest.address)).unwrap().unwrap();
        store.sender_places(&row.address).unwrap();
        store.sender_lists(&row.address, 10).unwrap();
        show.push(at.elapsed().as_secs_f64() * 1000.0);
    }

    let written_to = everyone.iter().filter(|sender| sender.written > 0).count();
    let answered = everyone.iter().filter(|sender| sender.answered > 0).count();
    let only_written = everyone
        .iter()
        .filter(|sender| sender.messages == 0)
        .count();
    let with_bulk = everyone.iter().filter(|sender| sender.bulk > 0).count();
    let domains: std::collections::HashSet<&str> = everyone
        .iter()
        .map(|sender| sender.domain.as_str())
        .collect();
    let mut volumes: Vec<u64> = everyone.iter().map(|sender| sender.messages).collect();
    volumes.sort_unstable_by(|a, b| b.cmp(a));

    let result = json!({
        "migrationMs": migrate_ms,
        "derivedAgain": { "messages": derived, "stale": stale, "seconds": derive_seconds },
        "senders": {
            "rows": everyone.len(),
            "writtenTo": written_to,
            "answered": answered,
            "writtenToNeverHeardFrom": only_written,
            "withBulkMail": with_bulk,
            "domains": domains.len(),
            "largestSendersMessages": volumes.iter().take(5).collect::<Vec<_>>(),
            "listFiftyP95Ms": p95(list),
            "showLargestP95Ms": p95(show),
            "firstPage": page_one.len(),
        },
        "report": {
            "ms": report_ms,
            "everyMessage": counts(&report.every_message),
            "asTheCensusCounted": counts(&report.as_the_census_counted),
            "withoutTheLargestMailbox": counts(&report.without_the_largest_mailbox),
            "census": { "q2": CENSUS_Q2, "q2WithoutTheLargestMailbox": CENSUS_Q2_WITHOUT_LARGEST },
        },
    });
    let text = serde_json::to_string_pretty(&result).unwrap();
    eprintln!("{text}");
    if let Ok(out) = std::env::var("LOAM_MAIL_LIVE_OUT") {
        std::fs::write(out, text).unwrap();
    }
}
