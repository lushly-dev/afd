//! Tests of bursts (the specification's 7.4), with made-up floods.

#![allow(clippy::expect_used, clippy::unwrap_used)]

use rusqlite::types::Value;

use super::test_mail::*;
use super::*;

const HOUR: i64 = 60 * 60 * 1000;

/// Where the made-up floods start: well after the mail [`header`] dates.
const FLOOD: i64 = BASE + 500 * DAY;

impl Mail {
    /// Records a message's headers in `mailbox`, received at `at`.
    fn add_at(&mut self, mailbox: MailboxId, from: &str, fields: &[&str], at: i64) -> MessageId {
        let number = self.next;
        self.next += 1;
        let mut seen = header(number, from, fields);
        let date = mail_parser::DateTime::from_timestamp(at / 1000);
        let block = String::from_utf8(seen.header_block.clone()).unwrap();
        let block = block
            .lines()
            .map(|line| {
                if line.starts_with("Date: ") {
                    format!("Date: {}", date.to_rfc822())
                } else {
                    line.to_string()
                }
            })
            .collect::<Vec<_>>()
            .join("\r\n");
        seen.header_block = format!("{block}\r\n").into_bytes();
        seen.internal_date = Some(at);
        self.store
            .record_headers(mailbox, "", std::slice::from_ref(&seen), NOW)
            .unwrap();
        self.store
            .find_message(&seen.header_block, seen.reported_size)
            .unwrap()
            .unwrap()
    }

    /// `n` messages from `n` new senders, a minute apart from `at`, each
    /// with `fields`; the senders are `prefix0@…` onwards.
    fn flood(
        &mut self,
        mailbox: MailboxId,
        prefix: &str,
        fields: &[&str],
        n: i64,
        at: i64,
    ) -> Vec<MessageId> {
        (0..n)
            .map(|i| {
                self.add_at(
                    mailbox,
                    &format!("{prefix}{i}@flood.example"),
                    fields,
                    at + i * 60_000,
                )
            })
            .collect()
    }

    fn bursts(&self) -> Vec<BurstRow> {
        self.store.bursts_since(i64::MIN, 100).unwrap().0
    }

    fn story_of(&self, message: MessageId) -> Option<i64> {
        self.store
            .stories_of(&[message])
            .unwrap()
            .get(&message)
            .copied()
    }
}

#[test]
fn a_flood_of_new_senders_is_one_burst_in_place_of_their_queue_entries() {
    let mut mail = Mail::new();
    let inbox = mail.inbox;
    let flood = mail.flood(inbox, "s", &[], 40, FLOOD);
    let bursts = mail.bursts();
    assert_eq!(bursts.len(), 1);
    let burst = &bursts[0];
    assert_eq!(
        (burst.messages, burst.first, burst.last),
        (40, FLOOD, FLOOD + 39 * 60_000)
    );
    // One story of all forty, which the queue and the unknown list leave out.
    let story = mail.store.story(burst.id).unwrap().expect("a story");
    assert_eq!(
        (story.kind.as_str(), story.messages, story.title.as_str()),
        ("burst", 40, "40 messages from 40 new senders")
    );
    assert_eq!(mail.story_of(flood[0]), Some(burst.id));
    assert_eq!(mail.class(flood[0]).as_deref(), Some("unknown"));
    assert_eq!(mail.store.queue_counts().unwrap(), (0, 0));
    assert!(
        mail.store
            .class_messages(Class::Unknown, None, 50)
            .unwrap()
            .is_empty()
    );
    // A stranger's mail before the flood is still the queue's.
    mail.add_at(inbox, "earlier@example.org", &[], FLOOD - 30 * DAY);
    assert_eq!(mail.store.queue_counts().unwrap(), (1, 1));
    mail.assert_as_from_nothing();
}

#[test]
fn twenty_nine_in_a_day_is_no_burst() {
    let mut mail = Mail::new();
    let inbox = mail.inbox;
    mail.flood(inbox, "s", &[], 29, FLOOD);
    assert!(mail.bursts().is_empty());
    assert_eq!(mail.store.queue_counts().unwrap(), (29, 29));
    // The thirtieth, a day and more after the first, is still no burst.
    mail.add_at(inbox, "late@flood.example", &[], FLOOD + 25 * HOUR);
    assert!(mail.bursts().is_empty());
    // Within the day it is.
    mail.add_at(inbox, "soon@flood.example", &[], FLOOD + 23 * HOUR);
    assert_eq!(mail.bursts().len(), 1);
    assert_eq!(mail.bursts()[0].messages, 30);
    mail.assert_as_from_nothing();
}

#[test]
fn a_busy_account_needs_ten_times_its_median_day() {
    let mut mail = Mail::new();
    let inbox = mail.inbox;
    // Five new senders a day for the ninety days before: a median of five.
    for day in 1..=90 {
        mail.flood(inbox, &format!("d{day}x"), &[], 5, FLOOD - day * DAY);
    }
    // Forty in a day is not ten times five.
    let forty = mail.flood(inbox, "a", &[], 40, FLOOD);
    assert!(mail.bursts().is_empty());
    assert_eq!(mail.story_of(forty[0]), None);
    // Ten more make fifty: a burst.
    mail.flood(inbox, "b", &[], 10, FLOOD + 2 * HOUR);
    let bursts = mail.bursts();
    assert_eq!(bursts.len(), 1);
    assert_eq!(bursts[0].messages, 50);
    mail.assert_as_from_nothing();
}

#[test]
fn list_mail_in_a_burst_is_its_story_and_in_no_stream_story() {
    let mut mail = Mail::new();
    let inbox = mail.inbox;
    // Sign-up confirmations: each a new sender, all through one list.
    let signups = mail.flood(inbox, "s", &["List-Id: <signup.example>"], 35, FLOOD);
    let burst = mail.bursts()[0].id;
    assert_eq!(mail.class(signups[0]).as_deref(), Some("bulk"));
    assert_eq!(mail.story_of(signups[0]), Some(burst));
    // Their list's stream keeps the id its first messages gave it, before
    // the flood was one, but is no story.
    let stream = mail.store.list_story("signup.example").unwrap().unwrap();
    assert_eq!(mail.store.story(stream).unwrap(), None, "no stream of them");
    assert!(
        mail.store
            .class_messages(Class::Bulk, None, 50)
            .unwrap()
            .is_empty(),
        "in place of a row each"
    );
    // Later list mail, after the flood, is the list's stream again.
    for i in 0..5 {
        mail.add_at(
            inbox,
            &format!("s{i}@flood.example"),
            &["List-Id: <signup.example>"],
            FLOOD + 10 * DAY + i * HOUR,
        );
    }
    let stream = mail.store.list_story("signup.example").unwrap().unwrap();
    assert_eq!(mail.store.story(stream).unwrap().unwrap().messages, 5);
    mail.assert_as_from_nothing();
}

#[test]
fn a_known_sender_is_never_in_a_burst_and_the_flag_names_it() {
    let mut mail = Mail::new();
    let (inbox, sent) = (mail.inbox, mail.sent);
    mail.add(sent, PERSON, &["To: bank@example.org"]);
    let flood = mail.flood(inbox, "s", &[], 40, FLOOD);
    // The bank writes during the flood: known, not counted, and named by
    // the burst's flag.
    let bank = mail.add_at(inbox, "bank@example.org", &[], FLOOD + 10 * 60_000);
    let burst = mail.bursts()[0].clone();
    assert_eq!(burst.messages, 40);
    assert_eq!(mail.class(bank).as_deref(), Some("known"));
    assert_eq!(mail.story_of(bank), None);
    assert_eq!(
        mail.store.known_during(&burst).unwrap(),
        ["bank@example.org"]
    );
    // A flood sender the person writes to leaves the burst's story.
    mail.add(sent, PERSON, &["To: s3@flood.example"]);
    assert_eq!(mail.class(flood[3]).as_deref(), Some("known"));
    assert_eq!(mail.story_of(flood[3]), None);
    // Nor is it a first contact any longer: a sender the person knows is
    // not a stranger.
    assert_eq!(mail.store.story(burst.id).unwrap().unwrap().messages, 39);
    assert_eq!(mail.bursts()[0].messages, 39);
    mail.assert_as_from_nothing();
}

#[test]
fn a_flood_in_junk_is_a_burst_with_no_story() {
    let mut mail = Mail::new();
    let junk = mail.mailbox("Junk", Role::Junk);
    mail.flood(junk, "s", &[], 35, FLOOD);
    let bursts = mail.bursts();
    assert_eq!(
        bursts.len(),
        1,
        "a flood the provider filed away is a flood"
    );
    assert_eq!(mail.store.story(bursts[0].id).unwrap(), None);
    mail.assert_as_from_nothing();
}

#[test]
fn floods_that_overlap_are_one_burst_and_those_apart_two() {
    let mut mail = Mail::new();
    let inbox = mail.inbox;
    mail.flood(inbox, "a", &[], 30, FLOOD);
    mail.flood(inbox, "b", &[], 30, FLOOD + 20 * HOUR);
    assert_eq!(mail.bursts().len(), 1, "their windows overlap");
    mail.flood(inbox, "c", &[], 30, FLOOD + 30 * DAY);
    let bursts = mail.bursts();
    assert_eq!(bursts.len(), 2);
    // The second's median is still nothing: a quiet month has a median day
    // of none.
    assert_eq!(bursts[0].messages, 30);
    assert_eq!(bursts[1].messages, 60);
    mail.assert_as_from_nothing();
}

#[test]
fn a_rebuild_finds_the_same_bursts() {
    let mut mail = Mail::new();
    let (inbox, junk) = (mail.inbox, mail.mailbox("Junk", Role::Junk));
    mail.flood(inbox, "a", &["List-Id: <signup.example>"], 20, FLOOD);
    mail.flood(junk, "b", &[], 20, FLOOD + HOUR);
    mail.flood(inbox, "c", &[], 25, FLOOD + 40 * DAY);
    mail.assert_as_from_nothing();
    let derived = mail.derived();
    assert_eq!(mail.bursts().len(), 1);
    mail.store.rebuild(NOW, |_| {}).unwrap();
    assert_eq!(mail.derived(), derived);
    // The burst's story keeps its id across the rebuild.
    assert_eq!(mail.bursts().len(), 1);
}

#[test]
fn a_store_that_held_mail_before_bursts_has_them_when_opened() {
    let mut mail = Mail::new();
    let inbox = mail.inbox;
    let flood = mail.flood(inbox, "s", &[], 40, FLOOD);
    let bursts = mail.bursts();
    let derived = mail.derived();
    // As a store from before bursts: none found, and marked to fill.
    mail.store
        .connection
        .execute_batch(
            "DELETE FROM burst_message; DELETE FROM burst; DELETE FROM contact_day;
             DELETE FROM first_contact;
             INSERT INTO engine_state (key, value) VALUES ('burst-fill', 1);",
        )
        .unwrap();
    let mail = mail.reopen();
    assert_eq!(mail.bursts(), bursts);
    assert_eq!(mail.story_of(flood[0]), Some(bursts[0].id));
    assert_eq!(mail.derived(), derived);
    let marks = table(
        &mail.store,
        "SELECT count(*) FROM engine_state WHERE key = 'burst-fill'",
    );
    assert_eq!(marks, [vec![Value::Integer(0)]]);
}

#[test]
fn every_burst_query_reads_an_index() {
    let mail = Mail::new();
    let mut failed = Vec::new();
    for (name, sql) in bursts::every_query() {
        let mut statement = mail
            .store
            .connection
            .prepare(&format!("EXPLAIN QUERY PLAN {sql}"))
            .unwrap();
        let bound = statement.parameter_count();
        let plan: Vec<String> = statement
            .query_map(rusqlite::params_from_iter(vec!["x"; bound]), |row| {
                row.get::<_, String>(3)
            })
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        let plan = plan.join("\n");
        for line in plan.lines().filter(|line| line.starts_with("SCAN")) {
            if line != "SCAN CONSTANT ROW" {
                failed.push(format!("{name} scans:\n{plan}"));
            }
        }
        let expected = match name {
            "desired" => "envelope_sender (sender_address=? AND received<?)",
            "current" => "first_contact_sender (sender_address=?)",
            "on day" | "all" => "first_contact_received (account_id=?",
            "days" => "PRIMARY KEY (account_id=? AND day>? AND day<?)",
            "burst near" | "held" => "burst_account (account_id=?",
            "known during" => "screening_listed (class=? AND date>? AND date<?)",
            "latest" => "burst_latest",
            other => panic!("no plan expected for {other}"),
        };
        if !plan.contains(expected) {
            failed.push(format!("{name}:\n{plan}"));
        }
    }
    assert!(failed.is_empty(), "{}", failed.join("\n\n"));
}
