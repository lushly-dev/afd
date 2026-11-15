//! Steps C1's and C2's report on the owner's mail (the specification's 6.3,
//! 7.1, 7.2 and 8): Q2 as the engine computes it beside the census's figure,
//! how many stream stories each grouping gives, what screening classes the
//! mail falls into and what stories it makes, with what classing it,
//! reading stories and deciding on a sender cost.
//! Ignored: it runs only when asked, on a copy of a synced store whose
//! directory it is given.
//!
//! It opens the copy, which brings its schema up to date, derives again
//! every message an older derivation wrote (that fills the senders), and
//! writes counts, sizes and milliseconds only: no address, subject, name,
//! list id or text. It refuses the data directory an engine would use
//! (`LOAM_MAIL_HOME`'s, or the platform's): copy it first. On APFS,
//! `cp -cR` copies the log and the index at once, taking no room until they
//! differ, and `sqlite3 <database> ".backup <copy>"` copies the database
//! whole while a server writes it.
//!
//! ```text
//! LOAM_MAIL_LIVE_HOME=/path/to/copy LOAM_MAIL_LIVE_OUT=results.json \
//!   cargo test --release --test live_screening -- --ignored --nocapture
//! ```

#![allow(clippy::expect_used, clippy::unwrap_used)]

use std::path::Path;
use std::time::Instant;

use loam_mail::home::Home;
use loam_mail::store::{
    Class, Decision, KINDS_SHOWN, ScreeningCounts, SenderQuery, Store, StoryMessages, sender_id,
};
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

fn scope(counts: &ScreeningCounts) -> serde_json::Value {
    json!({
        "messages": counts.messages,
        "inbound": counts.inbound,
        "fromStrangers": counts.from_strangers,
        "decidedByHeader": counts.decided_by_header,
        "decidedByTemplateAlone": counts.decided_by_template_alone,
        "decided": counts.decided(),
        "q2": rounded(counts.q2()),
        "withoutTemplateKey": counts.without_template_key,
        "streamStories": {
            "byKey": counts.by_key,
            "byKeyAndShape": counts.by_key_and_shape,
            "bySender": counts.by_sender,
        },
    })
}

fn now() -> i64 {
    let elapsed = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap();
    i64::try_from(elapsed.as_millis()).unwrap()
}

fn same(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}

/// A table's or an index's pages, in MiB to a tenth.
fn mib(connection: &rusqlite::Connection, name: &str) -> f64 {
    let bytes: i64 = connection
        .query_row(
            "SELECT coalesce(sum(pgsize), 0) FROM dbstat WHERE name = ?1",
            [name],
            |row| row.get(0),
        )
        .unwrap();
    #[expect(clippy::cast_precision_loss, reason = "a size in MiB, to a tenth")]
    let mib = bytes as f64 / 1_048_576.0;
    (mib * 10.0).round() / 10.0
}

#[test]
#[ignore = "reads a copy of a real store; run with its directory named"]
fn screening_on_a_copy_of_a_synced_store() {
    let path = std::path::PathBuf::from(
        std::env::var("LOAM_MAIL_LIVE_HOME").expect("LOAM_MAIL_LIVE_HOME names a copy"),
    );
    let used = [
        Home::resolve(|name| std::env::var(name).ok()),
        Home::resolve(|name| (name != "LOAM_MAIL_HOME").then(|| std::env::var(name).ok())?),
    ];
    for home in used.iter().flatten() {
        assert!(
            !same(&path, home.root()),
            "copy the data directory: opening a store changes its schema"
        );
    }
    let home = Home::at(&path);
    let before = std::fs::metadata(home.database()).unwrap().len();

    let opened = Instant::now();
    let mut store = Store::open(&home).unwrap();
    let migration_ms = opened.elapsed().as_millis();
    let stale = store.stale_count().unwrap();
    let started = Instant::now();
    let mut derived = 0_u64;
    loop {
        let done = store.rederive_stale(500, now()).unwrap();
        if done == 0 {
            break;
        }
        derived += u64::try_from(done).unwrap();
        if derived.is_multiple_of(20_000) {
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

    // The sender commands' reads, and what a batch that touches the largest
    // sender spends on it.
    let mut list = Vec::new();
    for _ in 0..100 {
        let at = Instant::now();
        store
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
    let mut recompute = Vec::new();
    for _ in 0..20 {
        let at = Instant::now();
        let row = store.sender(sender_id(&largest.address)).unwrap().unwrap();
        store.sender_places(&row.address).unwrap();
        store.sender_lists(&row.address, 10).unwrap();
        show.push(at.elapsed().as_secs_f64() * 1000.0);
        let at = Instant::now();
        store.recompute_sender(&largest.address, now()).unwrap();
        recompute.push(at.elapsed().as_secs_f64() * 1000.0);
    }
    let persons = store.persons_messages().unwrap();

    // Screening (step C2): classing every message from nothing, as a store
    // from before classes is classed once, the classes and the queue, the
    // lists by class, and a decision on the largest sender and back. The
    // copy is changed; the store it was copied from is not.
    assert!(store.screening_readiness().unwrap().ready());
    let classed = Instant::now();
    store.classify_everything().unwrap();
    let classify_ms = classed.elapsed().as_millis();
    let connection = rusqlite::Connection::open(home.database()).unwrap();
    let count = |sql: &str| -> i64 { connection.query_row(sql, [], |row| row.get(0)).unwrap() };
    let shown =
        "EXISTS (SELECT 1 FROM observation JOIN mailbox ON mailbox.id = observation.mailbox_id
                 WHERE observation.message_id = screening.message_id
                   AND observation.ended_at IS NULL AND mailbox.role NOT IN ('junk', 'trash'))";
    let mut classes = serde_json::Map::new();
    for class in Class::ALL {
        let name = class.as_str();
        classes.insert(
            name.to_string(),
            json!({
                "held": count(&format!("SELECT count(*) FROM screening WHERE class = '{name}'")),
                "listed": count(&format!(
                    "SELECT count(*) FROM screening WHERE class = '{name}' AND {shown}"
                )),
            }),
        );
    }
    let templates = count("SELECT count(*) FROM template");
    let recurring = count("SELECT count(*) FROM template WHERE messages >= 5");
    // Stories (step C2's second pull request), made with the classes.
    let story_counts = json!({
        "stories": count("SELECT count(*) FROM story"),
        "byList": count("SELECT count(*) FROM story WHERE list_id <> ''"),
        "bySender": count("SELECT count(*) FROM story WHERE list_id = ''"),
        "streams": count("SELECT count(DISTINCT story_id) FROM story_member"),
        "bulkListed": count("SELECT count(*) FROM story_member"),
        "inStories": count("SELECT coalesce(sum(messages), 0) FROM story"),
        "exceptions": count("SELECT coalesce(sum(exceptions), 0) FROM story"),
        "withExceptions": count("SELECT count(*) FROM story WHERE exceptions > 0"),
        "withoutAUsualShape": count(
            "SELECT count(*) FROM story WHERE NOT EXISTS
                 (SELECT 1 FROM story_shape WHERE story_shape.story_id = story.id
                  AND story_shape.messages >= 5)",
        ),
        "kinds": count("SELECT coalesce(sum(kinds), 0) FROM story"),
        "withOneKind": count("SELECT count(*) FROM story WHERE kinds = 1"),
        "largestMessages": count("SELECT coalesce(max(messages), 0) FROM story"),
        "largestKinds": count("SELECT coalesce(max(kinds), 0) FROM story"),
    });
    let largest_story: Option<(i64, i64)> = connection
        .query_row(
            "SELECT id, (SELECT message_id FROM story_member WHERE story_id = story.id
                         ORDER BY date DESC, message_id DESC LIMIT 1)
             FROM story ORDER BY messages DESC, id LIMIT 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .ok();
    drop(connection);
    let (queue_messages, queue_senders) = store.queue_counts().unwrap();
    let mut lists = serde_json::Map::new();
    for class in Class::ALL {
        let mut samples = Vec::new();
        for _ in 0..20 {
            let at = Instant::now();
            store.class_messages(class, None, 51).unwrap();
            samples.push(at.elapsed().as_secs_f64() * 1000.0);
        }
        lists.insert(class.as_str().to_string(), json!(p95(samples)));
    }
    let mut waiting = Vec::new();
    for _ in 0..20 {
        let at = Instant::now();
        store
            .senders(&SenderQuery {
                waiting: true,
                limit: 51,
                ..SenderQuery::default()
            })
            .unwrap();
        waiting.push(at.elapsed().as_secs_f64() * 1000.0);
    }
    let mut story_list = Vec::new();
    let mut story_changes = Vec::new();
    for _ in 0..20 {
        let at = Instant::now();
        store.stories(None, 51).unwrap();
        story_list.push(at.elapsed().as_secs_f64() * 1000.0);
        let at = Instant::now();
        store.story_changes(0, 101).unwrap();
        story_changes.push(at.elapsed().as_secs_f64() * 1000.0);
    }
    // The largest story: opened (its card, its kinds and a page of its
    // messages), its exceptions, and computed again as a batch that brings
    // it one message would.
    let (mut open_story, mut open_exceptions, mut recompute_story) =
        (Vec::new(), Vec::new(), Vec::new());
    if let Some((story, newest)) = largest_story {
        for _ in 0..20 {
            let at = Instant::now();
            store.story(story).unwrap();
            store.story_kinds(story, KINDS_SHOWN).unwrap();
            store
                .story_messages(story, &StoryMessages::Every, None, 51)
                .unwrap();
            open_story.push(at.elapsed().as_secs_f64() * 1000.0);
            let at = Instant::now();
            store
                .story_messages(story, &StoryMessages::Exceptions, None, 51)
                .unwrap();
            open_exceptions.push(at.elapsed().as_secs_f64() * 1000.0);
            let at = Instant::now();
            store
                .recompute_stories(&[loam_mail::store::MessageId(newest)], now())
                .unwrap();
            recompute_story.push(at.elapsed().as_secs_f64() * 1000.0);
        }
    }
    let story_ms = |samples: Vec<f64>| (!samples.is_empty()).then(|| p95(samples));
    let before_decision = store.class_counts(&largest.address).unwrap();
    let preview = Instant::now();
    let would = store.would_change(&largest.address, Decision::Out).unwrap();
    let preview_ms = preview.elapsed().as_millis();
    let decided = Instant::now();
    let out = store
        .decide(&largest.address, Some(Decision::Out), now())
        .unwrap();
    let decide_ms = decided.elapsed().as_millis();
    // The first page of blocked mail, with the largest sender's in it.
    let mut blocked_list = Vec::new();
    for _ in 0..20 {
        let at = Instant::now();
        store.class_messages(Class::Blocked, None, 51).unwrap();
        blocked_list.push(at.elapsed().as_secs_f64() * 1000.0);
    }
    let undecided = Instant::now();
    let back = store.decide(&largest.address, None, now()).unwrap();
    let undo_ms = undecided.elapsed().as_millis();
    assert_eq!(
        store.class_counts(&largest.address).unwrap(),
        before_decision
    );
    assert_eq!(out.changed, would);
    drop(store);

    // Sizes, with the store closed: its write-ahead log is in the database.
    let after = std::fs::metadata(home.database()).unwrap().len();
    let connection = rusqlite::Connection::open(home.database()).unwrap();
    let recipients: i64 = connection
        .query_row("SELECT count(*) FROM recipient", [], |row| row.get(0))
        .unwrap();
    let derived_mib = json!({
        "recipient": mib(&connection, "recipient"),
        "link": mib(&connection, "link"),
        "envelope_sender": mib(&connection, "envelope_sender"),
        "envelope_sender_bulk": mib(&connection, "envelope_sender_bulk"),
        "envelope_sender_list": mib(&connection, "envelope_sender_list"),
        "envelope_message_key": mib(&connection, "envelope_message_key"),
        "observation_mailbox": mib(&connection, "observation_mailbox"),
        "senderWithItsIndexes": mib(&connection, "sender")
            + mib(&connection, "sender_recent")
            + mib(&connection, "sender_domain"),
    });
    let packed = path.join("packed.sqlite3");
    let _ = std::fs::remove_file(&packed);
    connection
        .execute("VACUUM INTO ?1", [packed.to_str().unwrap()])
        .unwrap();
    drop(connection);
    let after_vacuum = std::fs::metadata(&packed).unwrap().len();
    let packed_connection = rusqlite::Connection::open(&packed).unwrap();
    let packed_mib = json!({
        "recipient": mib(&packed_connection, "recipient"),
        "link": mib(&packed_connection, "link"),
    });
    drop(packed_connection);
    std::fs::remove_file(&packed).unwrap();

    let domains: std::collections::HashSet<&str> = everyone
        .iter()
        .map(|sender| sender.domain.as_str())
        .collect();
    let mut volumes: Vec<u64> = everyone.iter().map(|sender| sender.messages).collect();
    volumes.sort_unstable_by(|a, b| b.cmp(a));
    let result = json!({
        "upgrade": {
            "migrationMs": migration_ms,
            "stale": stale,
            "derivedAgain": derived,
            "derivedAgainSeconds": derive_seconds,
        },
        "databaseBytes": { "before": before, "after": after, "afterVacuum": after_vacuum },
        "tablesMiB": { "asDerived": derived_mib, "packed": packed_mib },
        "recipientRows": recipients,
        "senders": {
            "rows": everyone.len(),
            "writtenTo": everyone.iter().filter(|sender| sender.written > 0).count(),
            "writtenToNeverHeardFrom": everyone.iter().filter(|sender| sender.messages == 0).count(),
            "answered": everyone.iter().filter(|sender| sender.answered > 0).count(),
            "withBulkMail": everyone.iter().filter(|sender| sender.bulk > 0).count(),
            "registrableDomains": domains.len(),
            "fiveLargestByMessages": volumes.iter().take(5).collect::<Vec<_>>(),
            "personsMessages": persons,
            "listFiftyP95Ms": p95(list),
            "showLargestP95Ms": p95(show),
            "recomputeLargestP95Ms": p95(recompute),
        },
        "screening": {
            "classes": classes,
            "queue": { "messages": queue_messages, "senders": queue_senders },
            "templates": templates,
            "recurringTemplates": recurring,
            // Classing every message from nothing, and making every story.
            "classifyEverythingMs": classify_ms,
            "stories": story_counts,
            "storyListFiftyP95Ms": p95(story_list),
            "storyChangesHundredP95Ms": p95(story_changes),
            "largestStoryOpenP95Ms": story_ms(open_story),
            "largestStoryExceptionsP95Ms": story_ms(open_exceptions),
            "largestStoryRecomputeP95Ms": story_ms(recompute_story),
            "listFiftyP95Ms": lists,
            "sendersWaitingFiftyP95Ms": p95(waiting),
            "largestSender": {
                "messages": largest.messages,
                "previewMs": preview_ms,
                "blockChanged": out.changed,
                "blockMs": decide_ms,
                "blockedListFiftyP95Ms": p95(blocked_list),
                "undoChanged": back.changed,
                "undoMs": undo_ms,
            },
        },
        "q2": {
            "census": { "whole": CENSUS_Q2, "withoutTheLargestMailbox": CENSUS_Q2_WITHOUT_LARGEST },
            "everyMessage": scope(&report.every_message),
            "asTheCensusCounted": scope(&report.as_the_census_counted),
            "withoutTheLargestMailbox": scope(&report.without_the_largest_mailbox),
            "reportMs": report_ms,
        },
    });
    let text = serde_json::to_string_pretty(&result).unwrap();
    eprintln!("{text}");
    if let Ok(out) = std::env::var("LOAM_MAIL_LIVE_OUT") {
        std::fs::write(out, text).unwrap();
    }
}
