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
                    NOW,
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
            NOW,
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
            NOW,
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
fn every_sender_query_reads_an_index_or_starts_from_the_person_s_mail() {
    let mail = Mail::new();
    for (name, sql) in senders::every_query() {
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
        // A scan reads every row of a table: only the mailboxes, to find
        // the sent ones, and the accounts may be read so. Every address is
        // read once, when a mailbox becomes a sent mailbox or stops being one.
        if name != "every" {
            for line in plan.lines().filter(|line| line.starts_with("SCAN")) {
                assert!(
                    line == "SCAN sent" || line.starts_with("SCAN account "),
                    "{name}:\n{plan}"
                );
            }
        }
        let first_loop = plan
            .lines()
            .find(|line| line.starts_with("SCAN") || line.starts_with("SEARCH"));
        match name {
            "written" | "answered" => {
                assert_eq!(first_loop, Some("SCAN sent"), "{name}:\n{plan}");
            }
            "own" => assert!(
                plan.contains("SCAN sent\nSEARCH mine USING COVERING INDEX observation_mailbox"),
                "{name}:\n{plan}"
            ),
            "counts" | "name" | "places" => {
                assert!(
                    plan.contains("COVERING INDEX envelope_sender ")
                        || plan.contains("INDEX envelope_sender ("),
                    "{name}:\n{plan}"
                );
            }
            "bulk" => assert!(plan.contains("envelope_sender_bulk"), "{name}:\n{plan}"),
            "lists" => assert!(
                plan.contains("COVERING INDEX envelope_sender_list"),
                "{name}:\n{plan}"
            ),
            _ => {}
        }
        if name == "name" {
            assert!(!plan.contains("TEMP B-TREE"), "{name}:\n{plan}");
        }
        if name == "answered" {
            assert!(plan.contains("envelope_message_key"), "{name}:\n{plan}");
        }
    }
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
            NOW,
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

#[test]
fn a_reply_derived_again_without_what_it_answered_leaves_that_sender_unanswered() {
    let mut mail = Mail::new();
    let (inbox, sent) = (mail.inbox, mail.sent);
    mail.add(inbox, "alice@example.org", &[]); // m1
    let reply_fields = ["To: bob@example.org", "In-Reply-To: <m1@example.com>"];
    let reply = mail.add(sent, PERSON, &reply_fields); // m2
    assert_eq!(mail.row("alice@example.org").unwrap().answered, 1);
    assert_eq!(mail.row("bob@example.org").unwrap().written, 1);
    // Derived again from bytes that now say less, as after a damaged file or
    // a new version of the derivation: no recipients, and nothing answered.
    let mut header = derive::header_fields(&header(2, PERSON, &reply_fields).header_block);
    header.answers_key = None;
    header.recipients.clear();
    let transaction = mail.store.connection.transaction().unwrap();
    let mut touched = derived::Touched::new(None);
    derived::derive_header(&transaction, reply.0, &header, &mut touched).unwrap();
    derived::settle(&transaction, &touched, NOW).unwrap();
    transaction.commit().unwrap();
    assert_eq!(mail.row("alice@example.org").unwrap().answered, 0);
    assert!(mail.row("bob@example.org").is_none());
}

#[test]
fn a_redirect_in_a_sent_mailbox_is_the_person_s_and_its_first_sender_is_not() {
    let mut mail = Mail::new();
    let sent = mail.sent;
    mail.add(
        sent,
        "stranger@example.net",
        &[
            "To: person@example.com",
            "Cc: other@example.net",
            "Resent-From: person@example.com",
            "Resent-To: friend@example.org",
        ],
    );
    let stranger = mail.row("stranger@example.net").unwrap();
    assert_eq!((stranger.messages, stranger.written), (1, 0));
    assert_eq!(mail.row("friend@example.org").unwrap().written, 1);
    assert!(mail.row("other@example.net").is_none());
}

#[test]
fn a_sender_that_turns_out_to_be_the_person_is_a_change() {
    let mut mail = Mail::new();
    let (inbox, sent) = (mail.inbox, mail.sent);
    mail.add(inbox, "alias@example.net", &[]);
    let changes = |mail: &Mail| -> i64 {
        mail.store
            .connection
            .query_row(
                "SELECT count(*) FROM change WHERE kind = 'sender' AND subject = ?1",
                [sender_id("alias@example.net")],
                |row| row.get(0),
            )
            .unwrap()
    };
    let before = changes(&mail);
    mail.add(sent, "alias@example.net", &["To: erin@example.org"]);
    assert!(mail.row("alias@example.net").is_none());
    assert_eq!(changes(&mail), before + 1);
}

#[test]
fn a_rebuild_over_several_batches_gives_the_same_senders() {
    let mut mail = Mail::new();
    let (inbox, sent) = (mail.inbox, mail.sent);
    // A reply recorded before what it answers, which comes a batch later.
    mail.add(
        sent,
        PERSON,
        &["To: late@example.org", "In-Reply-To: <m252@example.com>"],
    ); // m1
    for number in 0..250 {
        mail.add(inbox, &format!("s{}@example.org", number % 40), &[]); // m2 to m251
    }
    mail.add(inbox, "late@example.org", &[]); // m252
    // And one recorded after what it answers, a batch earlier (m5 is s3's).
    mail.add(
        sent,
        PERSON,
        &["To: s3@example.org", "In-Reply-To: <m5@example.com>"],
    ); // m253
    let late = mail.row("late@example.org").unwrap();
    assert_eq!((late.messages, late.written, late.answered), (1, 1, 1));
    let s3 = mail.row("s3@example.org").unwrap();
    assert_eq!((s3.written, s3.answered), (1, 1));
    let tables = |mail: &Mail| {
        (
            table(&mail.store, "SELECT * FROM sender ORDER BY address"),
            table(
                &mail.store,
                "SELECT * FROM recipient ORDER BY message_id, address",
            ),
        )
    };
    let before = tables(&mail);
    mail.store.rebuild(NOW, |_| {}).unwrap();
    assert_eq!(tables(&mail), before);
}

#[test]
fn a_store_from_before_senders_is_derived_again_and_gains_them() {
    let directory = tempfile::tempdir().unwrap();
    let home = Home::at(directory.path().join("data"));
    let blocks = [
        header(1, "Alice <alice@example.org>", &["To: person@example.com"]),
        header(
            2,
            PERSON,
            &["To: alice@example.org", "In-Reply-To: <m1@example.com>"],
        ),
    ];
    {
        // Version 6 wrote these rows; its derivation had no senders.
        let store = Store::open_with(&home, &schema::MIGRATIONS[..6]).unwrap();
        store
            .connection
            .execute_batch(
                "INSERT INTO account (id, provider, address, created_at)
                     VALUES (1, 'icloud', 'person@example.com', 0);
                 INSERT INTO mailbox (id, account_id, provider_key, name, role, header_only)
                     VALUES (1, 1, 'INBOX', 'INBOX', 'inbox', 0),
                            (2, 1, 'Sent Messages', 'Sent Messages', 'sent', 0);",
            )
            .unwrap();
        for (seen, mailbox) in blocks.iter().zip([1, 2]) {
            let blob = store.log().put(&seen.header_block).unwrap();
            let id = i64::from(mailbox);
            store
                .connection
                .execute(
                    "INSERT INTO message (id, header_hash, reported_size, first_seen_at,
                                          received_at)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    rusqlite::params![
                        id,
                        blob.as_bytes().as_slice(),
                        i64::try_from(seen.reported_size).unwrap(),
                        NOW,
                        seen.internal_date
                    ],
                )
                .unwrap();
            store
                .connection
                .execute(
                    "INSERT INTO held (message_id, part, kind, blob, size)
                     VALUES (?1, 'header', 'header', ?2, ?3)",
                    rusqlite::params![
                        id,
                        blob.as_bytes().as_slice(),
                        i64::try_from(seen.header_block.len()).unwrap()
                    ],
                )
                .unwrap();
            store
                .connection
                .execute(
                    "INSERT INTO observation (message_id, mailbox_id, validity, provider_id,
                                              flags, seen_at)
                     VALUES (?1, ?2, '', ?1, '[]', 0)",
                    [id, id],
                )
                .unwrap();
            store
                .connection
                .execute(
                    "INSERT INTO envelope (message_id, parser, thread_id, date, sender_address,
                                           sender_name, subject)
                     VALUES (?1, 2, ?1, 0, 'old', '', 'old')",
                    [id],
                )
                .unwrap();
        }
    }
    let mut store = Store::open(&home).unwrap();
    let received: Vec<Vec<Value>> = table(&store, "SELECT received FROM envelope ORDER BY 1");
    assert_eq!(
        received,
        [vec![Value::Integer(at(1))], vec![Value::Integer(at(2))]],
        "the migration fills when each was received"
    );
    assert_eq!(store.stale_count().unwrap(), 2);
    assert_eq!(store.sender(sender_id("alice@example.org")).unwrap(), None);
    while store.rederive_stale(200, NOW).unwrap() > 0 {}
    let alice = store
        .sender(sender_id("alice@example.org"))
        .unwrap()
        .unwrap();
    assert_eq!((alice.messages, alice.written, alice.answered), (1, 1, 1));
    assert_eq!(alice.name, "Alice");
}
