//! Tests of senders (the specification's 7.1) and of step C1's report.

#![allow(clippy::expect_used, clippy::unwrap_used)]

use rusqlite::types::Value;

use super::*;

const DAY: i64 = 24 * 60 * 60 * 1000;
const BASE: i64 = 1_637_446_921_000;
const NOW: i64 = BASE + 400 * DAY;
const PERSON: &str = "person@example.com";

struct Mail {
    _directory: tempfile::TempDir,
    store: Store,
    account: AccountId,
    inbox: MailboxId,
    sent: MailboxId,
    archive: MailboxId,
    next: u32,
}

impl Mail {
    fn new() -> Self {
        let directory = tempfile::tempdir().unwrap();
        let home = Home::at(directory.path().join("data"));
        let mut store = Store::open(&home).unwrap();
        let account = store.add_account("icloud", PERSON, 1).unwrap();
        let mut mailbox = |key: &'static str, role| {
            store
                .upsert_mailbox(
                    account,
                    &MailboxSeen {
                        provider_key: key,
                        name: key,
                        role,
                    },
                )
                .unwrap()
        };
        let inbox = mailbox("INBOX", Role::Inbox);
        let sent = mailbox("Sent Messages", Role::Sent);
        let archive = mailbox("Archive", Role::Archive);
        Self {
            _directory: directory,
            store,
            account,
            inbox,
            sent,
            archive,
            next: 1,
        }
    }

    /// Records a message in `mailbox` and returns it. `fields` are header
    /// lines after `From`, `Message-ID` and the date.
    fn add(&mut self, mailbox: MailboxId, from: &str, fields: &[&str]) -> MessageId {
        let number = self.next;
        self.next += 1;
        let seen = header(number, from, fields);
        self.store
            .record_headers(mailbox, "", std::slice::from_ref(&seen), NOW)
            .unwrap();
        self.store
            .find_message(&seen.header_block, seen.reported_size)
            .unwrap()
            .unwrap()
    }

    /// Records message `message`, already held, in `mailbox` too.
    fn show_in(&mut self, mailbox: MailboxId, number: u32, from: &str, fields: &[&str]) {
        let mut seen = header(number, from, fields);
        seen.provider_id = format!("again-{number}");
        self.store
            .record_headers(mailbox, "", std::slice::from_ref(&seen), NOW)
            .unwrap();
    }

    fn row(&self, address: &str) -> Option<SenderRow> {
        self.store.sender(sender_id(address)).unwrap()
    }
}

fn header(number: u32, from: &str, fields: &[&str]) -> HeaderSeen {
    let date = mail_parser::DateTime::from_timestamp((BASE + i64::from(number) * DAY) / 1000);
    let mut block = format!(
        "From: {from}\r\nMessage-ID: <m{number}@example.com>\r\nDate: {}\r\nSubject: s{number}\r\n",
        date.to_rfc822()
    );
    for field in fields {
        block.push_str(field);
        block.push_str("\r\n");
    }
    block.push_str("\r\n");
    HeaderSeen {
        provider_id: number.to_string(),
        provider_thread: None,
        reported_size: 1000 + u64::from(number),
        internal_date: Some(BASE + i64::from(number) * DAY),
        flags: Vec::new(),
        header_block: block.into_bytes(),
    }
}

/// When the provider received message `number`.
fn at(number: u32) -> i64 {
    BASE + i64::from(number) * DAY
}

fn table(store: &Store, sql: &str) -> Vec<Vec<Value>> {
    let mut statement = store.connection.prepare(sql).unwrap();
    let columns = statement.column_count();
    statement
        .query_map([], |row| {
            (0..columns)
                .map(|column| row.get::<_, Value>(column))
                .collect()
        })
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
}

#[test]
fn a_sender_s_history_counts_what_the_person_wrote_to_it_and_answered() {
    let mut mail = Mail::new();
    let (inbox, sent) = (mail.inbox, mail.sent);
    mail.add(
        inbox,
        "Alice <alice@example.org>",
        &["To: person@example.com"],
    ); // m1
    mail.add(
        inbox,
        "Alice A. <ALICE@example.org>",
        &["To: person@example.com"],
    ); // m2
    mail.add(
        sent,
        "Person <person@example.com>",
        &[
            "To: Alice <alice@example.org>",
            "Cc: bob@example.org",
            "In-Reply-To: <m1@example.com>",
        ],
    ); // m3
    mail.add(sent, "person@example.com", &["To: alice@example.org"]); // m4
    mail.add(sent, "person@example.com", &["Bcc: carol@example.net"]); // m5
    for _ in 0..3 {
        mail.add(
            inbox,
            "News <news@lists.example.co.uk>",
            &["List-Id: <weekly.example.co.uk>", "To: person@example.com"],
        );
    }

    let alice = mail.row("alice@example.org").unwrap();
    assert_eq!(alice.id, sender_id("alice@example.org"));
    assert_eq!(alice.domain, "example.org");
    assert_eq!(alice.name, "Alice A.", "the name on its newest message");
    assert_eq!(
        (alice.messages, alice.bulk, alice.written, alice.answered),
        (2, 0, 2, 1)
    );
    assert_eq!(
        (alice.first_received, alice.last_received),
        (Some(at(1)), Some(at(2)))
    );
    assert_eq!(alice.last_written, Some(at(4)));
    assert_eq!(alice.recent, at(4));

    // Written to, never heard from: a row all the same, so their first
    // message is from someone the person knows.
    let bob = mail.row("bob@example.org").unwrap();
    assert_eq!((bob.messages, bob.written, bob.answered), (0, 1, 0));
    assert_eq!(bob.first_received, None);
    let carol = mail.row("carol@example.net").unwrap();
    assert_eq!(carol.written, 1, "Bcc counts");

    let news = mail.row("news@lists.example.co.uk").unwrap();
    assert_eq!((news.messages, news.bulk, news.written), (3, 3, 0));
    assert_eq!(news.domain, "example.co.uk");

    assert!(mail.row(PERSON).is_none(), "the person is no sender");
    let listed: Vec<String> = mail
        .store
        .senders(&SenderQuery {
            limit: 10,
            ..SenderQuery::default()
        })
        .unwrap()
        .into_iter()
        .map(|row| row.address)
        .collect();
    assert_eq!(
        listed,
        [
            "news@lists.example.co.uk",
            "carol@example.net",
            "alice@example.org",
            "bob@example.org"
        ]
    );
    let written: Vec<String> = mail
        .store
        .senders(&SenderQuery {
            written_to: true,
            limit: 10,
            ..SenderQuery::default()
        })
        .unwrap()
        .into_iter()
        .map(|row| row.address)
        .collect();
    assert_eq!(
        written,
        ["carol@example.net", "alice@example.org", "bob@example.org"]
    );
}

#[test]
fn a_page_of_senders_starts_after_the_last_of_the_page_before() {
    let mut mail = Mail::new();
    let inbox = mail.inbox;
    for number in 0..5 {
        mail.add(inbox, &format!("s{number}@example.org"), &[]);
    }
    let mut seen = Vec::new();
    let mut before = None;
    loop {
        let page = mail
            .store
            .senders(&SenderQuery {
                before,
                limit: 2,
                ..SenderQuery::default()
            })
            .unwrap();
        let Some(last) = page.last() else { break };
        before = Some((last.recent, last.id));
        seen.extend(page.into_iter().map(|row| row.address));
    }
    assert_eq!(
        seen,
        [
            "s4@example.org",
            "s3@example.org",
            "s2@example.org",
            "s1@example.org",
            "s0@example.org"
        ]
    );
    let domain = mail
        .store
        .senders(&SenderQuery {
            domain: Some("example.org"),
            limit: 10,
            ..SenderQuery::default()
        })
        .unwrap();
    assert_eq!(domain.len(), 5);
    let other = mail
        .store
        .senders(&SenderQuery {
            domain: Some("example.net"),
            limit: 10,
            ..SenderQuery::default()
        })
        .unwrap();
    assert!(other.is_empty());
}

#[test]
fn a_message_from_the_person_s_address_outside_a_sent_mailbox_makes_no_one_known() {
    // A stranger can write a message "from" the person, copied to themselves.
    let mut mail = Mail::new();
    let inbox = mail.inbox;
    mail.add(
        inbox,
        "person@example.com",
        &["To: person@example.com", "Cc: stranger@example.net"],
    );
    mail.add(inbox, "stranger@example.net", &["To: person@example.com"]);
    let stranger = mail.row("stranger@example.net").unwrap();
    assert_eq!((stranger.messages, stranger.written), (1, 0));
}

#[test]
fn a_message_a_sent_mailbox_shows_later_makes_its_recipients_written_to() {
    let mut mail = Mail::new();
    let (inbox, sent) = (mail.inbox, mail.sent);
    // The person copied themselves: the inbox has it first.
    let fields = ["To: dana@example.org", "Cc: person@example.com"];
    mail.add(inbox, "person@example.com", &fields);
    assert!(mail.row("dana@example.org").is_none());
    mail.show_in(sent, 1, "person@example.com", &fields);
    assert_eq!(mail.row("dana@example.org").unwrap().written, 1);
    // Leaving the sent mailbox does not unsend it.
    mail.store
        .record_removed(sent, "", &["again-1"], NOW)
        .unwrap();
    assert_eq!(mail.row("dana@example.org").unwrap().written, 1);
}

#[test]
fn an_address_the_person_sends_from_is_theirs_and_no_sender() {
    let mut mail = Mail::new();
    let (inbox, sent) = (mail.inbox, mail.sent);
    mail.add(inbox, "alias@example.net", &["To: person@example.com"]);
    assert!(mail.row("alias@example.net").is_some());
    mail.add(sent, "Me <alias@example.net>", &["To: erin@example.org"]);
    assert!(mail.row("alias@example.net").is_none());
    assert_eq!(mail.row("erin@example.org").unwrap().written, 1);
}

#[test]
fn an_account_s_address_is_the_person_s_from_when_it_is_added() {
    let mut mail = Mail::new();
    let inbox = mail.inbox;
    mail.add(inbox, "Other <Ötto@Example.net>", &[]);
    assert!(mail.row("ötto@example.net").is_some());
    mail.store
        .add_account("gmail", "Ötto@Example.net", 2)
        .unwrap();
    assert!(mail.row("ötto@example.net").is_none());
    // Still the person's when a batch computes it again: lower case beyond
    // ASCII, as the derivation writes a sender.
    mail.add(inbox, "Ötto@EXAMPLE.net", &[]);
    assert!(mail.row("ötto@example.net").is_none());
}

#[test]
fn a_mailbox_that_becomes_a_sent_mailbox_makes_its_messages_the_person_s() {
    let mut mail = Mail::new();
    let (account, archive) = (mail.account, mail.archive);
    mail.add(archive, "person@example.com", &["To: finn@example.org"]);
    assert!(mail.row("finn@example.org").is_none());
    mail.store
        .upsert_mailbox(
            account,
            &MailboxSeen {
                provider_key: "Archive",
                name: "Archive",
                role: Role::Sent,
            },
        )
        .unwrap();
    assert_eq!(mail.row("finn@example.org").unwrap().written, 1);
    mail.store
        .upsert_mailbox(
            account,
            &MailboxSeen {
                provider_key: "Archive",
                name: "Archive",
                role: Role::Archive,
            },
        )
        .unwrap();
    assert!(mail.row("finn@example.org").is_none());
}

#[test]
fn a_rebuild_gives_every_sender_the_same_row_and_id() {
    let mut mail = Mail::new();
    let (inbox, sent) = (mail.inbox, mail.sent);
    mail.add(inbox, "alice@example.org", &["To: person@example.com"]);
    // The reply arrives before what it answers is recorded elsewhere.
    mail.add(
        sent,
        "person@example.com",
        &["To: gus@example.org", "In-Reply-To: <m3@example.com>"],
    );
    mail.add(inbox, "gus@example.org", &["List-Unsubscribe: <https://x>"]);
    mail.add(sent, "alias@example.net", &["To: alice@example.org"]);
    let before = (
        table(&mail.store, "SELECT * FROM sender ORDER BY address"),
        table(
            &mail.store,
            "SELECT * FROM recipient ORDER BY message_id, address",
        ),
    );
    assert_eq!(before.0.len(), 2, "{before:?}");
    assert_eq!(mail.row("gus@example.org").unwrap().answered, 1);
    mail.store.rebuild(NOW, |_| {}).unwrap();
    let after = (
        table(&mail.store, "SELECT * FROM sender ORDER BY address"),
        table(
            &mail.store,
            "SELECT * FROM recipient ORDER BY message_id, address",
        ),
    );
    assert_eq!(after, before);
}

#[test]
fn a_sender_s_counts_read_indexes_and_start_from_the_person_s_mail() {
    let mail = Mail::new();
    let plan = |sql: &str| -> String {
        let mut statement = mail
            .store
            .connection
            .prepare(&format!("EXPLAIN QUERY PLAN {sql}"))
            .unwrap();
        let rows: Vec<String> = statement
            .query_map(["x"], |row| row.get::<_, String>(3))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        rows.join("\n")
    };
    let bulk = plan(&format!(
        "SELECT count(*) FROM envelope WHERE sender_address = ?1 AND {}",
        senders::BULK
    ));
    assert!(bulk.contains("envelope_sender_bulk"), "{bulk}");
    let name = plan(
        "SELECT sender_name FROM envelope WHERE sender_address = ?1
         ORDER BY received DESC, message_id DESC LIMIT 1",
    );
    assert!(name.contains("envelope_sender"), "{name}");
    assert!(!name.contains("TEMP B-TREE"), "{name}");
    let answered = plan(
        "SELECT count(DISTINCT answered.message_id) FROM mailbox AS sent
             CROSS JOIN observation AS mine ON mine.mailbox_id = sent.id AND sent.role = 'sent'
             CROSS JOIN envelope AS reply ON reply.message_id = mine.message_id
             CROSS JOIN envelope AS answered
                 ON answered.message_key = reply.answers_key AND answered.sender_address = ?1",
    );
    let first_loop = answered
        .lines()
        .find(|line| line.starts_with("SCAN") || line.starts_with("SEARCH"));
    assert_eq!(first_loop, Some("SCAN sent"), "{answered}");
    assert!(answered.contains("envelope_message_key"), "{answered}");
}

#[test]
fn a_registrable_domain_is_read_by_the_public_suffix_list() {
    assert_eq!(domain_of("a@mail.example.co.uk"), "example.co.uk");
    assert_eq!(domain_of("a@example.com."), "example.com");
    assert_eq!(domain_of("a@b@shop.example.com"), "example.com");
    assert_eq!(domain_of("no host"), "");
    assert_ne!(sender_id("a@example.com"), sender_id("b@example.com"));
    assert!(sender_id("a@example.com") < 1 << 53);
}

#[test]
fn the_report_counts_q2_and_the_stories_of_each_grouping() {
    let mut mail = Mail::new();
    let (inbox, sent, archive) = (mail.inbox, mail.sent, mail.archive);
    // A friend the person wrote to: known, so outside Q2.
    mail.add(sent, PERSON, &["To: friend@example.org"]);
    mail.add(inbox, "friend@example.org", &[]);
    // A list of six: decided by its header, one story under either grouping.
    for _ in 0..6 {
        mail.add(inbox, "news@example.net", &["List-Id: <news.example.net>"]);
    }
    // Two strangers with no header: undecided, since their templates (with
    // no body held) are unknown.
    mail.add(inbox, "a@stranger.example", &[]);
    mail.add(archive, "b@stranger.example", &[]);
    // Junk is left out of the census's scope.
    let junk = mail
        .store
        .upsert_mailbox(
            mail.account,
            &MailboxSeen {
                provider_key: "Junk",
                name: "Junk",
                role: Role::Junk,
            },
        )
        .unwrap();
    mail.add(junk, "spam@example.biz", &["Precedence: bulk"]);

    let report = mail.store.screening_report().unwrap();
    let every = report.every_message;
    assert_eq!(every.messages, 11);
    assert_eq!(every.inbound, 10);
    assert_eq!(every.from_strangers, 9);
    assert_eq!(every.decided_by_header, 7);
    assert_eq!(every.decided_by_template_alone, 0);
    assert_eq!(every.without_template_key, 9);
    assert_eq!(every.q2(), Some(7.0 / 9.0));
    assert_eq!(
        every.by_key,
        screening::Grouping {
            stories: 1,
            messages_in_stories: 6,
            groups: 1,
            ungrouped: 1,
        }
    );
    assert_eq!(every.by_key_and_shape, every.by_key);
    // By sender, the junk sender's one message has a group of its own.
    assert_eq!(
        every.by_sender,
        screening::Grouping {
            stories: 1,
            messages_in_stories: 6,
            groups: 2,
            ungrouped: 0,
        }
    );
    let census = report.as_the_census_counted;
    assert_eq!((census.messages, census.from_strangers), (10, 8));
    // The largest mailbox, the inbox, left out: the archive's stranger alone.
    let without = report.without_the_largest_mailbox;
    assert_eq!((without.from_strangers, without.decided()), (1, 0));
}
