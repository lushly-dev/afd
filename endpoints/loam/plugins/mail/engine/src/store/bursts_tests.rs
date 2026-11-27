//! Tests of bursts (the specification's 7.4), with made-up floods.

#![allow(clippy::expect_used, clippy::unwrap_used)]

use rusqlite::types::Value;

use super::test_mail::*;
use super::*;

const HOUR: i64 = 60 * 60 * 1000;

/// Where the made-up floods start: well after the mail [`header`] dates.
const FLOOD: i64 = BASE + 500 * DAY;

/// When an account first synced just after the floods is first listed: its
/// junk and trash hold what the provider kept, and the engine watched
/// nothing before. [`Mail::with_history`] is listed at [`NOW`], a hundred
/// days before the floods, as an account the engine has watched since.
const SYNCED: i64 = FLOOD + 2 * DAY;

impl Mail {
    /// Mail with a history: one message from a list four months before the
    /// floods, so that the days before them are known to be quiet. A flood
    /// in an account's first month is not read as one (7.4).
    fn with_history() -> Self {
        Self::with_history_listed_at(NOW)
    }

    /// As [`Mail::with_history`], its mailboxes first listed at `at`.
    fn with_history_listed_at(at: i64) -> Self {
        let mut mail = Self::listed_at(at);
        let archive = mail.archive;
        mail.add_at(
            archive,
            "history@example.org",
            &["List-Id: <history.example>"],
            FLOOD - 120 * DAY,
        );
        mail
    }

    /// Records a message's headers in `mailbox`, received at `at`.
    fn add_at(&mut self, mailbox: MailboxId, from: &str, fields: &[&str], at: i64) -> MessageId {
        self.add_at_seen(mailbox, from, fields, at).0
    }

    /// As [`Mail::add_at`], with what the provider listed.
    fn add_at_seen(
        &mut self,
        mailbox: MailboxId,
        from: &str,
        fields: &[&str],
        at: i64,
    ) -> (MessageId, HeaderSeen) {
        let seen = self.seen_at(from, fields, at);
        self.store
            .record_headers(mailbox, "", std::slice::from_ref(&seen), NOW)
            .unwrap();
        let message = self
            .store
            .find_message(&seen.header_block, seen.reported_size)
            .unwrap()
            .unwrap();
        (message, seen)
    }

    /// A new message's headers, from `from` with `fields`, received at `at`.
    fn seen_at(&mut self, from: &str, fields: &[&str], at: i64) -> HeaderSeen {
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
        seen
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
        self.flood_seen(mailbox, prefix, fields, n, at)
            .into_iter()
            .map(|(message, _)| message)
            .collect()
    }

    /// As [`Mail::flood`], with what the provider listed of each.
    fn flood_seen(
        &mut self,
        mailbox: MailboxId,
        prefix: &str,
        fields: &[&str],
        n: i64,
        at: i64,
    ) -> Vec<(MessageId, HeaderSeen)> {
        self.flood_from(mailbox, prefix, fields, n, n, at)
    }

    /// As [`Mail::flood_seen`], from only `senders` new senders, each in
    /// turn.
    fn flood_from(
        &mut self,
        mailbox: MailboxId,
        prefix: &str,
        fields: &[&str],
        n: i64,
        senders: i64,
        at: i64,
    ) -> Vec<(MessageId, HeaderSeen)> {
        (0..n)
            .map(|i| {
                self.add_at_seen(
                    mailbox,
                    &format!("{prefix}{}@flood.example", i % senders),
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
    let mut mail = Mail::with_history();
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
    let mut mail = Mail::with_history();
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
fn a_few_new_senders_busy_first_day_is_no_burst() {
    let mut mail = Mail::with_history();
    let inbox = mail.inbox;
    // Forty-five from nine new senders, as a service just joined sends.
    mail.flood_from(inbox, "s", &[], 45, 9, FLOOD);
    assert!(mail.bursts().is_empty());
    assert_eq!(mail.store.queue_counts().unwrap(), (45, 9));
    // A tenth new sender within the day makes it one.
    mail.add_at(inbox, "tenth@flood.example", &[], FLOOD + HOUR);
    let bursts = mail.bursts();
    assert_eq!(bursts.len(), 1);
    assert_eq!(bursts[0].messages, 46);
    let story = mail.store.story(bursts[0].id).unwrap().expect("a story");
    assert_eq!(story.title, "46 messages from 10 new senders");
    mail.assert_as_from_nothing();
}

#[test]
fn kept_first_contacts_are_judged_on_their_own_senders() {
    let mut mail = Mail::with_history_listed_at(SYNCED);
    let inbox = mail.inbox;
    // First synced after the flood, junk's history starts ten days before
    // it, too short a history to judge all first contacts on.
    let junk = mail.mailbox_listed_at("Junk", Role::Junk, SYNCED);
    mail.add_at(junk, "spam@example.biz", &[], FLOOD - 10 * DAY);
    // Forty kept from five new senders, and ten more senders in junk.
    mail.flood_from(inbox, "s", &[], 40, 5, FLOOD);
    mail.flood(junk, "j", &[], 10, FLOOD + HOUR);
    assert!(
        mail.bursts().is_empty(),
        "junk's senders do not count toward the kept first contacts'"
    );
    // Five more kept senders within the day make it one.
    mail.flood(inbox, "t", &[], 5, FLOOD + 2 * HOUR);
    let bursts = mail.bursts();
    assert_eq!(bursts.len(), 1);
    assert_eq!(bursts[0].messages, 55);
    mail.assert_as_from_nothing();
}

#[test]
fn a_busy_account_needs_ten_times_its_median_day() {
    let mut mail = Mail::with_history();
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
    let mut mail = Mail::with_history();
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
    assert_eq!(
        mail.store
            .class_messages(Class::Bulk, None, 50)
            .unwrap()
            .len(),
        1,
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
    let mut mail = Mail::with_history();
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
    let mut mail = Mail::with_history();
    let junk = mail.mailbox("Junk", Role::Junk);
    // Junk that holds months, as a provider that keeps it does.
    mail.add_at(junk, "spam@example.biz", &[], FLOOD - 100 * DAY);
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
fn a_junk_flood_is_a_burst_once_junk_covers_a_month() {
    let mut mail = Mail::with_history_listed_at(SYNCED);
    let junk = mail.mailbox_listed_at("Junk", Role::Junk, SYNCED);
    // The first sync of an account whose provider empties junk monthly:
    // the oldest junk it holds is from twenty days before the flood, so
    // those twenty days are all the junk history there is.
    mail.add_at(junk, "spam@example.biz", &[], FLOOD - 20 * DAY);
    mail.flood(junk, "s", &[], 35, FLOOD);
    assert!(mail.bursts().is_empty());
    mail.assert_as_from_nothing();
    // Junk from thirty days before the flood: a month covered.
    mail.add_at(junk, "older@example.biz", &[], FLOOD - 30 * DAY);
    assert_eq!(mail.bursts().len(), 1);
    mail.assert_as_from_nothing();
}

#[test]
fn junk_the_provider_emptied_after_it_was_seen_still_covers_its_days() {
    let mut mail = Mail::with_history();
    let junk = mail.mailbox("Junk", Role::Junk);
    // Seen in junk forty days before the flood, then emptied by the
    // provider: what the engine saw there still counts.
    let (_, old) = mail.add_at_seen(junk, "spam@example.biz", &[], FLOOD - 40 * DAY);
    let ended = mail
        .store
        .record_removed(junk, "", &[old.provider_id.as_str()], NOW)
        .unwrap();
    assert_eq!(ended, 1);
    mail.flood(junk, "s", &[], 35, FLOOD);
    assert_eq!(mail.bursts().len(), 1);
    mail.assert_as_from_nothing();
}

#[test]
fn a_kept_first_contact_stays_kept_after_it_is_deleted() {
    let mut mail = Mail::with_history_listed_at(SYNCED);
    let inbox = mail.inbox;
    let junk = mail.mailbox_listed_at("Junk", Role::Junk, SYNCED);
    // First synced after the flood, with junk from five days before: all
    // first contacts cover too little, so the flood is a burst on its kept
    // ones alone.
    mail.add_at(junk, "spam@example.biz", &[], FLOOD - 5 * DAY);
    let flood = mail.flood_seen(inbox, "s", &[], 35, FLOOD);
    assert_eq!(mail.bursts().len(), 1);
    // Deleted for good: it reached the person, so it stays kept.
    let ids: Vec<&str> = flood
        .iter()
        .map(|(_, seen)| seen.provider_id.as_str())
        .collect();
    assert_eq!(mail.store.record_removed(inbox, "", &ids, NOW).unwrap(), 35);
    assert_eq!(mail.bursts().len(), 1);
    mail.assert_as_from_nothing();
}

#[test]
fn junk_and_trash_hold_history_from_when_they_were_first_listed() {
    let mut mail = Mail::with_history();
    let junk = mail.mailbox("Junk", Role::Junk);
    let trash = mail.mailbox("Deleted", Role::Trash);
    // Watched since a hundred days before the flood, junk has seen its
    // first contact of all only now, and trash five days before: what came
    // there between was seen too, so those days were quiet.
    mail.add_at(trash, "deleted@example.biz", &[], FLOOD - 5 * DAY);
    mail.flood(junk, "s", &[], 35, FLOOD);
    assert_eq!(mail.bursts().len(), 1);
    mail.assert_as_from_nothing();
}

#[test]
fn an_empty_trash_first_listed_after_a_flood_covers_nothing_before() {
    let mut mail = Mail::with_history_listed_at(SYNCED);
    let junk = mail.mailbox_listed_at("Junk", Role::Junk, SYNCED);
    let trash = mail.mailbox_listed_at("Deleted", Role::Trash, SYNCED);
    // Junk covers sixty days, but an empty trash says nothing of what the
    // provider emptied from it before the first sync.
    mail.add_at(junk, "spam@example.biz", &[], FLOOD - 60 * DAY);
    mail.flood(junk, "s", &[], 35, FLOOD);
    assert!(mail.bursts().is_empty());
    mail.assert_as_from_nothing();
    // Trash that holds a first contact from forty days before covers them.
    mail.add_at(trash, "deleted@example.biz", &[], FLOOD - 40 * DAY);
    assert_eq!(mail.bursts().len(), 1);
    mail.assert_as_from_nothing();
}

#[test]
fn a_junk_mailbox_that_appears_later_sets_no_start() {
    let mut mail = Mail::with_history();
    // Ten days before the flood, after the account was first listed, a junk
    // mailbox appears: it held nothing before it did.
    let junk = mail.mailbox_listed_at("Junk", Role::Junk, FLOOD - 10 * DAY);
    mail.flood(junk, "s", &[], 35, FLOOD);
    assert_eq!(mail.bursts().len(), 1);
    mail.assert_as_from_nothing();
}

#[test]
fn a_junk_flood_moved_out_of_junk_is_judged_as_kept() {
    let mut mail = Mail::with_history_listed_at(SYNCED);
    let inbox = mail.inbox;
    let junk = mail.mailbox_listed_at("Junk", Role::Junk, SYNCED);
    // First synced after the flood, junk holds only the flood: no burst on
    // all first contacts.
    let flood = mail.flood_seen(junk, "s", &[], 40, FLOOD);
    assert!(mail.bursts().is_empty());
    let move_out = |mail: &mut Mail, moved: &[(MessageId, HeaderSeen)]| {
        let ids: Vec<&str> = moved
            .iter()
            .map(|(_, seen)| seen.provider_id.as_str())
            .collect();
        let ended = mail.store.record_removed(junk, "", &ids, NOW).unwrap();
        assert_eq!(ended, ids.len() as u64);
        let seen: Vec<HeaderSeen> = moved.iter().map(|(_, seen)| seen.clone()).collect();
        mail.store.record_headers(inbox, "", &seen, NOW).unwrap();
    };
    // Five moved to the inbox are five that reached the person: no burst.
    move_out(&mut mail, &flood[..5]);
    assert!(mail.bursts().is_empty());
    mail.assert_as_from_nothing();
    // Thirty moved are a burst of kept first contacts, judged on the
    // account's whole history, and it holds the ten left in junk too.
    move_out(&mut mail, &flood[5..30]);
    let bursts = mail.bursts();
    assert_eq!(bursts.len(), 1);
    assert_eq!(bursts[0].messages, 40);
    mail.assert_as_from_nothing();
}

#[test]
fn a_flood_that_lasts_weeks_is_one_burst_until_it_is_the_usual_day() {
    let mut mail = Mail::with_history();
    let inbox = mail.inbox;
    // A flood of new senders spread over each day: two hundred a day for
    // three days, then thirty a day for eight weeks, each day's mail
    // recorded in one batch. Without the spike it lasts a day longer: its
    // first UTC day holds only its first few messages.
    for day in 0..59 {
        let n: i64 = if day < 3 { 200 } else { 30 };
        let seen: Vec<HeaderSeen> = (0..n)
            .map(|i| {
                let at = FLOOD + day * DAY + i * (DAY - HOUR) / n;
                mail.seen_at(&format!("d{day}x{i}@flood.example"), &[], at)
            })
            .collect();
        mail.store.record_headers(inbox, "", &seen, NOW).unwrap();
    }
    // Its windows overlap, so it is one burst while thirty a day is ten
    // times the median day before; that holds until flood days are half
    // the ninety before, and after that the flood is the usual day.
    let bursts = mail.bursts();
    assert_eq!(bursts.len(), 1, "{bursts:?}");
    assert_eq!(bursts[0].first, FLOOD);
    // The last window that passes starts on its forty-fifth day, when
    // fewer than half the ninety days before are flood days.
    assert_eq!((bursts[0].last - FLOOD) / DAY, 45);
    mail.assert_as_from_nothing();
}

#[test]
fn floods_that_overlap_are_one_burst_and_those_apart_two() {
    let mut mail = Mail::with_history();
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
    let mut mail = Mail::with_history();
    let (inbox, junk) = (mail.inbox, mail.mailbox("Junk", Role::Junk));
    mail.add_at(junk, "spam@example.biz", &[], FLOOD - 100 * DAY);
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
    let mut mail = Mail::with_history();
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
fn a_store_whose_bursts_another_rule_found_finds_them_again_when_opened() {
    let mut mail = Mail::with_history();
    let (account, inbox) = (mail.account, mail.inbox);
    // One burst that holds, and forty from four senders, which a rule on
    // messages alone made one of.
    let flood = mail.flood(inbox, "s", &[], 40, FLOOD);
    let few: Vec<i64> = mail
        .flood_from(inbox, "few", &[], 40, 4, FLOOD + 30 * DAY)
        .into_iter()
        .map(|(message, _)| message.0)
        .collect();
    let bursts = mail.bursts();
    assert_eq!(bursts.len(), 1);
    let queue = mail.store.queue_counts().unwrap();
    assert_eq!(queue, (40, 4));
    let derived = mail.derived();
    // As a store whose bursts rule 1 found: it missed the first and made
    // a burst, and its story, of the second.
    {
        let transaction = mail.store.connection.transaction().unwrap();
        transaction
            .execute_batch("DELETE FROM burst_message; DELETE FROM burst;")
            .unwrap();
        let first = FLOOD + 30 * DAY;
        let key = format!("burst {} {first}", account.0);
        transaction
            .execute("INSERT INTO stream (key) VALUES (?1)", [&key])
            .unwrap();
        let stale = transaction.last_insert_rowid();
        transaction
            .execute(
                "INSERT INTO burst (id, account_id, first, last, messages)
                 VALUES (?1, ?2, ?3, ?4, 40)",
                rusqlite::params![stale, account.0, first, first + 39 * 60_000],
            )
            .unwrap();
        for message in &few {
            transaction
                .execute(
                    "INSERT INTO burst_message (burst_id, message_id) VALUES (?1, ?2)",
                    rusqlite::params![stale, message],
                )
                .unwrap();
        }
        stories::compose_all(&transaction, NOW).unwrap();
        transaction
            .execute(
                "UPDATE engine_state SET value = 1 WHERE key = 'burst-rule'",
                [],
            )
            .unwrap();
        transaction.commit().unwrap();
        // The first flood is the queue's, the second the stale story's.
        assert_eq!(mail.store.queue_counts().unwrap(), (40, 40));
        assert_eq!(mail.story_of(MessageId(few[0])), Some(stale));
    }
    let mut mail = mail.reopen();
    assert_eq!(mail.bursts(), bursts);
    assert_eq!(mail.story_of(flood[0]), Some(bursts[0].id));
    // The stale burst's story is gone, its mail the queue's again.
    assert_eq!(mail.story_of(MessageId(few[0])), None);
    assert_eq!(mail.store.queue_counts().unwrap(), queue);
    let rule = table(
        &mail.store,
        "SELECT value FROM engine_state WHERE key = 'burst-rule'",
    );
    assert_eq!(rule, [vec![Value::Integer(bursts::RULE)]]);
    mail.assert_as_from_nothing();
    // The burst's story id is kept; the stale burst's stream is pruned at
    // the next rebuild, as any burst key without a burst is.
    let kept = mail.derived();
    let stale_key = format!("burst {} {}", account.0, FLOOD + 30 * DAY);
    let stale_streams = format!("SELECT count(*) FROM stream WHERE key = '{stale_key}'");
    assert_eq!(
        table(&mail.store, &stale_streams),
        [vec![Value::Integer(1)]]
    );
    mail.store.rebuild(NOW, |_| {}).unwrap();
    assert_eq!(mail.derived(), kept);
    assert_eq!(mail.derived(), derived);
    assert_eq!(
        table(&mail.store, &stale_streams),
        [vec![Value::Integer(0)]]
    );
}

#[test]
fn a_store_from_before_bursts_waits_for_an_account_it_never_listed() {
    let directory = tempfile::tempdir().unwrap();
    let home = Home::at(directory.path().join("data"));
    {
        // Version 9 wrote these: an account with no mailbox yet, and one
        // whose mailbox was listed at 500 and whose mail was first seen at
        // 100.
        let store = Store::open_with(&home, &schema::MIGRATIONS[..9]).unwrap();
        store
            .connection
            .execute_batch(
                "INSERT INTO account (id, provider, address, created_at)
                     VALUES (1, 'icloud', 'person@example.com', 0),
                            (2, 'icloud', 'other@example.com', 0);
                 INSERT INTO mailbox (id, account_id, provider_key, name, role, header_only,
                                      cursor, last_pass_at)
                     VALUES (1, 2, 'Junk', 'Junk', 'junk', 1, 'listed', 500);
                 INSERT INTO message (id, header_hash, reported_size, first_seen_at)
                     VALUES (1, zeroblob(32), 10, 100);
                 INSERT INTO observation (message_id, mailbox_id, validity, provider_id, flags,
                                          seen_at)
                     VALUES (1, 1, '', '1', '[]', 100);",
            )
            .unwrap();
    }
    let store = Store::open(&home).unwrap();
    assert_eq!(
        table(&store, "SELECT id, listed_at FROM account ORDER BY id"),
        [
            vec![Value::Integer(1), Value::Null],
            vec![Value::Integer(2), Value::Integer(500)]
        ],
        "an account with no mailbox listed waits"
    );
    assert_eq!(
        table(&store, "SELECT first_listed_at FROM mailbox"),
        [vec![Value::Integer(100)]],
        "watched since its account's mail was first seen"
    );
    assert_eq!(
        table(
            &store,
            "SELECT value FROM engine_state WHERE key = 'burst-rule'"
        ),
        [vec![Value::Integer(bursts::RULE)]]
    );
}

#[test]
fn an_account_whose_mailboxes_all_went_unlisted_waits() {
    let mut mail = Mail::new();
    let other = mail
        .store
        .add_account("icloud", "other@example.com", 1)
        .unwrap();
    let only = mail
        .store
        .upsert_mailbox(
            other,
            &MailboxSeen {
                provider_key: "INBOX",
                name: "INBOX",
                role: Role::Inbox,
            },
            NOW,
        )
        .unwrap();
    mail.store.retire_mailbox(only, NOW).unwrap();
    let waiting = table(
        &mail.store,
        &format!("SELECT listed_at FROM account WHERE id = {}", other.0),
    );
    assert_eq!(waiting, [vec![Value::Null]]);
}

#[test]
fn a_store_whose_mailboxes_migration_10_listed_late_counts_them_from_its_first_sync() {
    let mut mail = Mail::with_history();
    let junk = mail.mailbox("Junk", Role::Junk);
    mail.mailbox("Deleted", Role::Trash);
    // Synced from a hundred days before the flood, by a build from before
    // bursts; junk's first first contact came five days before it.
    mail.add_at(junk, "spam@example.biz", &[], FLOOD - 5 * DAY);
    mail.flood(junk, "s", &[], 35, FLOOD);
    assert_eq!(mail.bursts().len(), 1);
    // Migration 10 then took each mailbox's first listing from its last
    // pass, after the flood, and the second rule found its bursts. What the
    // migrations after 11 made goes too, as they run again.
    let upgraded = FLOOD + 3 * DAY;
    mail.store
        .connection
        .execute_batch(&format!(
            "UPDATE mailbox SET first_listed_at = {upgraded};
             UPDATE account SET listed_at = {upgraded};
             UPDATE engine_state SET value = 2 WHERE key = 'burst-rule';
             DROP TABLE operation_item;
             DROP TABLE operation;
             DROP TABLE selection_item;
             DROP TABLE selection;
             DROP TABLE account_policy;
             DROP TABLE policy;
             DROP TABLE snooze;
             DROP TABLE record;
             DROP TABLE proposed_story_member;
             DROP TABLE proposed_story;
             DROP TABLE instance_proof_key;
             DROP TABLE replyset_claim_key;
             DROP TABLE replyset_event;
             DROP TABLE replyset_question_reply;
             DROP TABLE replyset_question;
             DROP TABLE replyset_reply;
             DROP TABLE replyset;
             DROP TABLE outbound;
             DROP TABLE draft;
             ALTER TABLE token DROP COLUMN role;
             PRAGMA user_version = 10;"
        ))
        .unwrap();
    let mut mail = mail.reopen();
    assert_eq!(
        table(&mail.store, "SELECT DISTINCT first_listed_at FROM mailbox"),
        [vec![Value::Integer(NOW)]],
        "listed from when its account's mail was first seen"
    );
    assert_eq!(mail.bursts().len(), 1, "the empty trash covers its days");
    mail.assert_as_from_nothing();
}

#[test]
fn the_rule_is_raised_when_a_threshold_changes() {
    // A threshold changed here without raising the rule leaves the bursts
    // that stores found by the old thresholds: raise [`bursts::RULE`], then
    // this.
    assert_eq!(
        (
            bursts::RULE,
            BURST_LEAST,
            BURST_SENDERS_LEAST,
            BURST_TIMES,
            BURST_WINDOW,
            MEDIAN_DAYS,
            COVERED_LEAST
        ),
        (3, 30, 10, 10, 24 * HOUR, 90, 30)
    );
}

#[test]
fn mail_that_comes_after_a_burst_and_is_older_can_end_it() {
    let mut mail = Mail::with_history();
    let inbox = mail.inbox;
    mail.flood(inbox, "a", &["List-Id: <news.example>"], 40, FLOOD);
    assert_eq!(mail.bursts().len(), 1);
    // Sync fetches newest first: the months before come later, and show the
    // account was never quiet.
    for day in 1..=90 {
        mail.flood(inbox, &format!("d{day}x"), &[], 5, FLOOD - day * DAY);
    }
    assert!(mail.bursts().is_empty(), "forty is not ten times five");
    // The list's mail is its stream's again.
    let stream = mail.store.list_story("news.example").unwrap().unwrap();
    assert_eq!(mail.store.story(stream).unwrap().unwrap().messages, 40);
    mail.assert_as_from_nothing();
}

#[test]
fn a_flood_across_midnight_is_one_burst() {
    let mut mail = Mail::with_history();
    let inbox = mail.inbox;
    let midnight = FLOOD.div_euclid(DAY) * DAY + DAY;
    mail.flood(inbox, "s", &[], 40, midnight - 20 * 60_000);
    let bursts = mail.bursts();
    assert_eq!(bursts.len(), 1);
    assert_eq!(bursts[0].messages, 40);
    mail.assert_as_from_nothing();
}

#[test]
fn bursts_wait_for_an_account_to_be_listed_whole_once() {
    let mut mail = Mail::new();
    let seen_as = |key: &'static str| MailboxSeen {
        provider_key: key,
        name: key,
        role: Role::None,
    };
    // An account on its first sync: two mailboxes listed, one still being
    // listed, whose oldest mail may be to come.
    let account = mail
        .store
        .add_account("icloud", "first@example.com", NOW)
        .unwrap();
    let inbox = mail
        .store
        .upsert_mailbox(account, &seen_as("INBOX"), NOW)
        .unwrap();
    let archive = mail
        .store
        .upsert_mailbox(account, &seen_as("Archive"), NOW)
        .unwrap();
    let new = mail
        .store
        .upsert_mailbox(account, &seen_as("New"), NOW)
        .unwrap();
    mail.store.set_cursor(inbox, Some("listed"), NOW).unwrap();
    mail.store.set_cursor(archive, Some("listed"), NOW).unwrap();
    mail.add_at(
        archive,
        "history@example.org",
        &["List-Id: <history.example>"],
        FLOOD - 120 * DAY,
    );
    mail.flood(inbox, "s", &[], 40, FLOOD);
    assert!(mail.bursts().is_empty());
    assert_eq!(mail.store.queue_counts().unwrap(), (40, 40));
    assert_eq!(
        mail.store.accounts_waiting_for_bursts().unwrap(),
        vec![account.0]
    );
    mail.assert_as_from_nothing();
    mail.store.set_cursor(new, Some("listed"), NOW).unwrap();
    assert_eq!(mail.bursts().len(), 1);
    assert_eq!(mail.store.queue_counts().unwrap(), (0, 0));
    assert!(mail.store.accounts_waiting_for_bursts().unwrap().is_empty());
    // Listed whole once, the account is not held back again: not by a new
    // generation of a mailbox's ids, nor by a mailbox that appears or goes.
    mail.store.set_validity(new, "2", NOW).unwrap();
    assert_eq!(mail.bursts().len(), 1);
    mail.assert_as_from_nothing();
    let newer = mail
        .store
        .upsert_mailbox(account, &seen_as("Newer"), NOW)
        .unwrap();
    assert_eq!(mail.bursts().len(), 1);
    mail.assert_as_from_nothing();
    mail.store.retire_mailbox(newer, NOW).unwrap();
    assert_eq!(mail.bursts().len(), 1);
    mail.assert_as_from_nothing();
}

#[test]
fn a_message_two_accounts_hold_is_in_the_story_of_its_earliest_burst() {
    let mut mail = Mail::with_history();
    let inbox = mail.inbox;
    let other = mail
        .store
        .add_account("icloud", "other@example.com", NOW)
        .unwrap();
    let other_inbox = mail
        .store
        .upsert_mailbox(
            other,
            &MailboxSeen {
                provider_key: "INBOX",
                name: "INBOX",
                role: Role::Inbox,
            },
            NOW,
        )
        .unwrap();
    mail.store
        .set_cursor(other_inbox, Some("listed"), NOW)
        .unwrap();
    // Its own history, months before.
    let archive = mail.archive;
    let (_, mut history) = mail.add_at_seen(
        archive,
        "old@example.org",
        &["List-Id: <old.example>"],
        FLOOD - 130 * DAY,
    );
    history.provider_id = "oh".to_string();
    mail.store
        .record_headers(other_inbox, "", std::slice::from_ref(&history), NOW)
        .unwrap();
    // Forty messages, each in both accounts.
    let mut flood = Vec::new();
    for i in 0..40 {
        let (message, mut seen) = mail.add_at_seen(
            inbox,
            &format!("s{i}@flood.example"),
            &[],
            FLOOD + i * 60_000,
        );
        seen.provider_id = format!("o{i}");
        mail.store
            .record_headers(other_inbox, "", std::slice::from_ref(&seen), NOW)
            .unwrap();
        flood.push(message);
    }
    let bursts = mail.bursts();
    assert_eq!(bursts.len(), 2, "one in each account");
    let earliest = bursts
        .iter()
        .map(|burst| (burst.first, burst.id))
        .min()
        .unwrap()
        .1;
    assert_eq!(mail.story_of(flood[0]), Some(earliest));
    let other_burst = bursts.iter().find(|burst| burst.id != earliest).unwrap();
    assert_eq!(
        mail.store.story(other_burst.id).unwrap(),
        None,
        "its mail is the earliest burst's"
    );
    mail.assert_as_from_nothing();
}

#[test]
fn a_sender_screened_in_before_a_flood_is_not_new_and_one_after_still_counts() {
    let mut mail = Mail::with_history();
    let inbox = mail.inbox;
    // Screened in before the flood: no stranger then.
    mail.store
        .decide("s0@flood.example", Some(Decision::In), FLOOD - DAY)
        .unwrap();
    let flood = mail.flood(inbox, "s", &[], 40, FLOOD);
    assert_eq!(mail.bursts()[0].messages, 39);
    // Screened in after it: its mail leaves the story, yet still counts.
    mail.store
        .decide("s1@flood.example", Some(Decision::In), FLOOD + DAY)
        .unwrap();
    assert_eq!(mail.class(flood[1]).as_deref(), Some("known"));
    assert_eq!(mail.story_of(flood[1]), None);
    let burst = mail.bursts()[0].clone();
    assert_eq!(burst.messages, 39);
    assert_eq!(mail.store.story(burst.id).unwrap().unwrap().messages, 38);
    // An address the person says is theirs is no sender at all.
    mail.store
        .decide("s2@flood.example", Some(Decision::Mine), FLOOD + DAY)
        .unwrap();
    assert_eq!(mail.bursts()[0].messages, 38);
    mail.assert_as_from_nothing();
}

#[test]
fn a_mailbox_that_turns_sent_makes_its_senders_the_person_s() {
    let mut mail = Mail::with_history();
    let account = mail.account;
    let other = mail.mailbox("Other", Role::None);
    mail.flood(other, "s", &[], 40, FLOOD);
    assert_eq!(mail.bursts().len(), 1);
    mail.store
        .upsert_mailbox(
            account,
            &MailboxSeen {
                provider_key: "Other",
                name: "Other",
                role: Role::Sent,
            },
            NOW,
        )
        .unwrap();
    assert!(
        mail.bursts().is_empty(),
        "the person's own mail is no flood"
    );
    mail.assert_as_from_nothing();
}

#[test]
fn a_message_derived_again_with_another_time_leaves_the_burst() {
    let mut mail = Mail::with_history();
    let inbox = mail.inbox;
    let flood = mail.flood(inbox, "s", &[], 31, FLOOD);
    assert_eq!(mail.bursts()[0].messages, 31);
    let transaction = mail.store.connection.transaction().unwrap();
    for message in &flood[..2] {
        transaction
            .execute(
                "UPDATE envelope SET received = received + 30 * 86400000 WHERE message_id = ?1",
                [message.0],
            )
            .unwrap();
    }
    let senders = std::collections::BTreeSet::from([
        "s0@flood.example".to_string(),
        "s1@flood.example".to_string(),
    ]);
    super::senders::settle_senders(&transaction, &senders, NOW).unwrap();
    classes::settle(
        &transaction,
        &classes::Reclassify {
            messages: Some(&flood[..2].iter().map(|message| message.0).collect()),
            contacts: Some(&senders),
            ..Default::default()
        },
        NOW,
    )
    .unwrap();
    transaction.commit().unwrap();
    assert!(mail.bursts().is_empty(), "twenty-nine left in the day");
    mail.assert_as_from_nothing();
}

/// A small deterministic generator, so a failing run can be repeated.
struct Steps(u64);

impl Steps {
    fn below(&mut self, n: u64) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        (self.0 >> 33) % n
    }
}

#[test]
fn bursts_stay_what_finding_them_from_nothing_gives_through_any_sequence() {
    for seed in [1_u64, 2, 3, 4] {
        let seen_as = |key: &'static str, role| MailboxSeen {
            provider_key: key,
            name: key,
            role,
        };
        let mut mail = Mail::with_history();
        let mut steps = Steps(seed);
        let (account, inbox, archive, sent) = (mail.account, mail.inbox, mail.archive, mail.sent);
        let junk = mail.mailbox("Junk", Role::Junk);
        let trash = mail.mailbox("Deleted", Role::Trash);
        let shifting = mail.mailbox("Shifting", Role::None);
        let restarting = mail.mailbox("Restarting", Role::None);
        mail.add_at(junk, "spam@example.biz", &[], FLOOD - 100 * DAY);
        // A second account, which some floods reach too.
        let second = mail
            .store
            .add_account("icloud", "second@example.com", NOW)
            .unwrap();
        let second_inbox = mail
            .store
            .upsert_mailbox(second, &seen_as("INBOX", Role::Inbox), NOW)
            .unwrap();
        mail.store
            .set_cursor(second_inbox, Some("listed"), NOW)
            .unwrap();
        let mut floods = 0;
        let mut old: Vec<HeaderSeen> = Vec::new();
        let mut appeared = 0;
        for step in 0..60_u32 {
            match steps.below(12) {
                0..=2 => {
                    // A flood, some of it through a list, some of it junk.
                    let mailbox = [inbox, inbox, junk][steps.below(3) as usize];
                    let fields: &[&str] = if steps.below(2) == 0 {
                        &["List-Id: <news.example>"]
                    } else {
                        &[]
                    };
                    let at = FLOOD + i64::from(steps.below(60) as u8) * DAY;
                    let n = 10 + steps.below(30) as i64;
                    // From as many senders as messages, or from a few.
                    let senders = if steps.below(2) == 0 {
                        n
                    } else {
                        1 + steps.below(12) as i64
                    };
                    let flood =
                        mail.flood_from(mailbox, &format!("f{floods}x"), fields, n, senders, at);
                    if steps.below(3) == 0 {
                        let copies: Vec<HeaderSeen> = flood
                            .into_iter()
                            .map(|(_, mut seen)| {
                                seen.provider_id = format!("second{}", seen.provider_id);
                                seen
                            })
                            .collect();
                        mail.store
                            .record_headers(second_inbox, "", &copies, NOW)
                            .unwrap();
                    }
                    floods += 1;
                }
                3 => {
                    // Days before, quiet or busy, as newest-first sync
                    // brings them.
                    let day = 1 + steps.below(150) as i64;
                    for i in 0..1 + steps.below(8) {
                        let (_, seen) = mail.add_at_seen(
                            archive,
                            &format!("q{step}x{i}@old.example"),
                            &[],
                            FLOOD - day * DAY + i64::from(u8::try_from(i).unwrap()) * 60_000,
                        );
                        old.push(seen);
                    }
                }
                4 if floods > 0 => {
                    let address =
                        format!("f{}x{}@flood.example", steps.below(floods), steps.below(10));
                    let decision = match steps.below(3) {
                        0 => Some(Decision::In),
                        1 => Some(Decision::Mine),
                        _ => None,
                    };
                    let at = FLOOD + i64::from(steps.below(90) as u8) * DAY;
                    mail.store.decide(&address, decision, at).unwrap();
                }
                5 if floods > 0 => {
                    // The person writes to one of them, before its mail or
                    // after.
                    let address =
                        format!("f{}x{}@flood.example", steps.below(floods), steps.below(10));
                    let at = FLOOD + (i64::from(steps.below(120) as u8) - 30) * DAY;
                    mail.add_at(sent, PERSON, &[&format!("To: {address}")], at);
                }
                6 if !old.is_empty() => {
                    // Old mail thrown away: trash's history starts earlier.
                    let mut seen = old[steps.below(old.len() as u64) as usize].clone();
                    seen.provider_id = format!("t{step}");
                    mail.store
                        .record_headers(trash, "", std::slice::from_ref(&seen), NOW)
                        .unwrap();
                }
                7 => {
                    // A mailbox changes role, and back.
                    let role =
                        [Role::Junk, Role::Trash, Role::Sent, Role::None][steps.below(4) as usize];
                    mail.store
                        .upsert_mailbox(account, &seen_as("Shifting", role), NOW)
                        .unwrap();
                    mail.assert_as_from_nothing();
                    mail.flood(shifting, &format!("r{step}x"), &[], 5, FLOOD + 3 * DAY);
                    mail.assert_as_from_nothing();
                    mail.store
                        .upsert_mailbox(account, &seen_as("Shifting", Role::None), NOW)
                        .unwrap();
                }
                8 => {
                    // A mailbox appears, waits to be listed, and is listed
                    // or goes.
                    appeared += 1;
                    let key: &'static str =
                        Box::leak(format!("Appeared{appeared}").into_boxed_str());
                    // Some are junk or trash, first listed after the
                    // account was, so they set no start.
                    let role = [Role::None, Role::Junk, Role::Trash][steps.below(3) as usize];
                    let later = NOW + i64::from(step) * HOUR;
                    let new = mail
                        .store
                        .upsert_mailbox(account, &seen_as(key, role), NOW)
                        .unwrap();
                    mail.assert_as_from_nothing();
                    if steps.below(2) == 0 {
                        mail.store.set_cursor(new, Some("listed"), later).unwrap();
                    } else {
                        mail.store.retire_mailbox(new, NOW).unwrap();
                        mail.assert_as_from_nothing();
                        // And comes back, listed once before it went or not.
                        mail.store
                            .upsert_mailbox(account, &seen_as(key, role), NOW)
                            .unwrap();
                        mail.assert_as_from_nothing();
                        mail.store.set_cursor(new, Some("listed"), later).unwrap();
                    }
                    mail.assert_as_from_nothing();
                    mail.flood(new, &format!("a{step}x"), &[], 5, FLOOD + DAY);
                }
                9 => {
                    // A mailbox's ids start again.
                    mail.store
                        .set_validity(restarting, &format!("{step}"), NOW)
                        .unwrap();
                    mail.assert_as_from_nothing();
                    mail.store
                        .set_cursor(restarting, Some("listed"), NOW)
                        .unwrap();
                }
                10 if step % 20 == 0 => {
                    mail.store.rebuild(NOW, |_| {}).unwrap();
                }
                _ => {}
            }
            mail.assert_as_from_nothing();
        }
    }
}

#[test]
fn a_flood_after_trash_history_starts_is_judged_on_what_trash_covers() {
    let mut mail = Mail::with_history_listed_at(SYNCED);
    let (inbox, archive) = (mail.inbox, mail.archive);
    // First synced after the flood.
    let trash = mail.mailbox_listed_at("Deleted", Role::Trash, SYNCED);
    let oct = FLOOD - 31 * DAY;
    // Eight a day in the inbox for the three months before October.
    for day in 1..=90 {
        mail.flood(inbox, &format!("b{day}x"), &[], 8, oct - day * DAY);
    }
    // October: one a day, each also thrown away, so trash covers October.
    for day in 0..30 {
        let (_, mut seen) = mail.add_at_seen(
            archive,
            &format!("o{day}@quiet.example"),
            &[],
            oct + day * DAY,
        );
        seen.provider_id = format!("t{day}");
        mail.store
            .record_headers(trash, "", std::slice::from_ref(&seen), NOW)
            .unwrap();
    }
    // Sixty in a day: not ten times the kept median of eight, but ten times
    // October's, which is all trash's history covers.
    mail.flood(inbox, "s", &[], 60, FLOOD);
    assert_eq!(mail.bursts().len(), 1);
    mail.assert_as_from_nothing();
}

#[test]
fn every_burst_query_reads_an_index() {
    let mail = Mail::new();
    mail.store
        .connection
        .execute_batch(
            "CREATE TEMP TABLE IF NOT EXISTS contact_target (message_id INTEGER PRIMARY KEY);",
        )
        .unwrap();
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
            // The target is a batch's own few messages.
            if line != "SCAN CONSTANT ROW" && !line.ends_with("contact_target") {
                failed.push(format!("{name} scans:\n{plan}"));
            }
        }
        let expected = match name {
            "desired" => "envelope_sender (sender_address=? AND received<?)",
            "first day" => "first_contact_message (message_id=?)",
            "current" => "first_contact_sender (sender_address=?)",
            "on day" | "all" => "first_contact_received (account_id=?",
            "days" => "PRIMARY KEY (account_id=?)",
            "held" => "burst_account (account_id=?",
            "known during" => "screening_listed (class=? AND date>? AND date<?)",
            "latest" => "burst_latest",
            "covered from" | "kept from" => "first_contact_received (account_id=?",
            "accounts of" => "observation",
            "listed" => "",
            other => panic!("no plan expected for {other}"),
        };
        if !plan.contains(expected) {
            failed.push(format!("{name}:\n{plan}"));
        }
    }
    assert!(failed.is_empty(), "{}", failed.join("\n\n"));
}

#[test]
fn a_bursts_selection_is_what_its_story_shows_and_no_known_senders_mail() {
    let mut mail = Mail::with_history();
    let inbox = mail.inbox;
    let flood = mail.flood(inbox, "s", &[], 35, FLOOD);
    // The person screens one of the new senders in: its message stays a
    // first contact of the burst, and leaves the burst's story.
    mail.decide("s0@flood.example", Some(Decision::In));
    let bursts = mail.bursts();
    assert_eq!(bursts.len(), 1);
    let story = bursts[0].id;
    let selected = match mail
        .store
        .select(
            &SelectionQuery {
                story: Some(story),
                ..SelectionQuery::default()
            },
            "{}",
            &Proposer {
                kind: "agent".to_string(),
                id: None,
            },
            NOW,
        )
        .unwrap()
    {
        Selected::Made(row) => row,
        other => panic!("{other:?}"),
    };
    let messages: Vec<i64> = mail
        .store
        .selection_items(selected.id)
        .unwrap()
        .into_iter()
        .filter_map(|item| item.message)
        .collect();
    assert_eq!(messages.len(), 34);
    assert!(!messages.contains(&flood[0].0));
    let shown = mail
        .store
        .story_messages(story, &StoryMessages::Every, None, 100)
        .unwrap();
    assert_eq!(shown.len(), messages.len(), "what the story shows");
}
