//! Tests of what is derived: fields, threads, places, the index, and the
//! rebuild that reproduces them.

#![allow(clippy::expect_used, clippy::unwrap_used)]

use rusqlite::types::Value;

use super::*;

const DAY: i64 = 24 * 60 * 60 * 1000;
/// 2021-11-20 22:22:01 UTC, the date of [`mail`]'s first message.
const BASE: i64 = 1_637_446_921_000;
/// When the tests' messages are recorded: after every date they carry.
const NOW: i64 = BASE + 400 * DAY;

fn home() -> (tempfile::TempDir, Home) {
    let directory = tempfile::tempdir().expect("a temporary directory");
    let home = Home::at(directory.path().join("data"));
    (directory, home)
}

fn seeded(home: &Home) -> (Store, MailboxId, MailboxId) {
    let mut store = Store::open(home).expect("the store opens");
    let account = store
        .add_account("icloud", "person@example.com", 1)
        .unwrap();
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
    let archive = mailbox("Archive", Role::Archive);
    (store, inbox, archive)
}

/// A header block: message `number`, sent `number` days after [`BASE`],
/// naming `references`.
fn block(number: u32, subject: &str, references: &[u32]) -> Vec<u8> {
    let date = mail_parser::DateTime::from_timestamp((BASE + i64::from(number) * DAY) / 1000);
    let mut block = format!(
        "From: Sender {number} <sender{number}@example.com>\r\n\
         Subject: {subject}\r\n\
         Date: {}\r\n\
         Message-ID: <m{number}@example.com>\r\n",
        date.to_rfc822()
    );
    if !references.is_empty() {
        let ids: Vec<String> = references
            .iter()
            .map(|other| format!("<m{other}@example.com>"))
            .collect();
        block.push_str(&format!("References: {}\r\n", ids.join(" ")));
    }
    block.push_str("\r\n");
    block.into_bytes()
}

fn seen(number: u32, subject: &str, references: &[u32]) -> HeaderSeen {
    HeaderSeen {
        provider_id: number.to_string(),
        provider_thread: None,
        reported_size: 1000 + u64::from(number),
        internal_date: Some(BASE + i64::from(number) * DAY),
        flags: Vec::new(),
        header_block: block(number, subject, references),
    }
}

fn record(store: &mut Store, mailbox: MailboxId, headers: &[HeaderSeen]) -> Vec<MessageId> {
    store.record_headers(mailbox, "", headers, NOW).unwrap();
    headers
        .iter()
        .map(|seen| {
            store
                .find_message(&seen.header_block, seen.reported_size)
                .unwrap()
                .unwrap()
        })
        .collect()
}

fn whole(seen: &HeaderSeen, text: &str) -> Vec<u8> {
    [seen.header_block.as_slice(), text.as_bytes()].concat()
}

fn thread_of(store: &Store, message: MessageId) -> i64 {
    store
        .connection
        .query_row(
            "SELECT thread_id FROM envelope WHERE message_id = ?1",
            [message.0],
            |row| row.get(0),
        )
        .unwrap()
}

fn rows(store: &Store, sql: &str) -> i64 {
    store
        .connection
        .query_row(sql, [], |row| row.get(0))
        .unwrap()
}

/// Every row of every derived table, in order.
fn derived(store: &Store) -> Vec<(String, Vec<Vec<Value>>)> {
    [
        ("envelope", "message_id"),
        ("part", "message_id, place"),
        ("thread_key", "key"),
        ("thread", "id"),
        ("thread_place", "mailbox_id, thread_id"),
    ]
    .iter()
    .map(|(table, order)| {
        let mut statement = store
            .connection
            .prepare(&format!("SELECT * FROM {table} ORDER BY {order}"))
            .unwrap();
        let columns = statement.column_count();
        let rows: Vec<Vec<Value>> = statement
            .query_map([], |row| {
                (0..columns)
                    .map(|column| row.get::<_, Value>(column))
                    .collect()
            })
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        ((*table).to_string(), rows)
    })
    .collect()
}

/// A store with threads that merged, bodies, a copy in a second mailbox and
/// a message removed from one.
fn busy(home: &Home) -> (Store, MailboxId, MailboxId) {
    let (mut store, inbox, archive) = seeded(home);
    let headers = [
        seen(1, "plan", &[]),
        seen(2, "other", &[]),
        seen(3, "Re: plan", &[1]),
        // Names both threads: they become one.
        seen(4, "Re: plan and other", &[1, 2]),
        seen(5, "alone", &[]),
        seen(6, "Re: missing", &[90]),
        seen(7, "Re: missing too", &[90]),
    ];
    let messages = record(&mut store, inbox, &headers);
    store
        .record_parts(
            &[
                PartSeen {
                    message: messages[0],
                    place: Place::Whole,
                    bytes: &whole(&headers[0], "The plan is a picnic by the river.\r\n"),
                },
                PartSeen {
                    message: messages[4],
                    place: Place::Whole,
                    bytes: &whole(&headers[4], "Quarterly figures attached.\r\n"),
                },
            ],
            NOW,
        )
        .unwrap();
    record(&mut store, archive, &headers[4..5]);
    store.record_removed(inbox, "", &["2"], NOW).unwrap();
    (store, inbox, archive)
}

#[test]
fn headers_give_a_message_its_fields_and_its_thread() {
    let (_directory, home) = home();
    let (mut store, inbox, _) = seeded(&home);
    let messages = record(
        &mut store,
        inbox,
        &[
            seen(1, "plan", &[]),
            seen(2, "Re: plan", &[1]),
            seen(3, "other", &[]),
        ],
    );
    assert_eq!(thread_of(&store, messages[0]), messages[0].0);
    assert_eq!(thread_of(&store, messages[1]), messages[0].0);
    assert_eq!(thread_of(&store, messages[2]), messages[2].0);

    let listed = store.list_threads(inbox, None, 50).unwrap();
    assert_eq!(listed.len(), 2);
    // Newest first: the lone message is a day newer than the reply.
    assert_eq!(listed[0].thread, ThreadId(messages[2].0));
    assert_eq!(listed[0].subject, "other");
    assert_eq!(listed[1].thread, ThreadId(messages[0].0));
    assert_eq!(listed[1].subject, "plan");
    assert_eq!(listed[1].messages, 2);
    assert_eq!(listed[1].shown, 2);
    assert_eq!(listed[1].last_sender, "Sender 2");
    assert_eq!(listed[1].last_date, BASE + 2 * DAY);
}

#[test]
fn a_list_is_paged_from_the_last_row_of_the_page_before() {
    let (_directory, home) = home();
    let (mut store, inbox, _) = seeded(&home);
    let headers: Vec<HeaderSeen> = (1..=7).map(|n| seen(n, &format!("s{n}"), &[])).collect();
    record(&mut store, inbox, &headers);
    let first = store.list_threads(inbox, None, 3).unwrap();
    let subjects = |page: &[ThreadListed]| -> Vec<String> {
        page.iter().map(|thread| thread.subject.clone()).collect()
    };
    assert_eq!(subjects(&first), ["s7", "s6", "s5"]);
    let last = first.last().unwrap();
    let second = store
        .list_threads(inbox, Some((last.last_date, last.thread)), 3)
        .unwrap();
    assert_eq!(subjects(&second), ["s4", "s3", "s2"]);
    let last = second.last().unwrap();
    let third = store
        .list_threads(inbox, Some((last.last_date, last.thread)), 3)
        .unwrap();
    assert_eq!(subjects(&third), ["s1"]);
}

#[test]
fn threads_that_a_later_message_joins_become_one_under_the_lowest_id() {
    let (_directory, home) = home();
    let (mut store, inbox, _) = seeded(&home);
    let messages = record(
        &mut store,
        inbox,
        &[seen(1, "a", &[]), seen(2, "b", &[]), seen(3, "c", &[])],
    );
    assert_eq!(store.list_threads(inbox, None, 50).unwrap().len(), 3);
    // In its own batch, so that the merge meets rows already written.
    let joiner = record(&mut store, inbox, &[seen(4, "Re: a and b", &[2, 1])]);
    let lowest = messages[0].0;
    for message in [messages[0], messages[1], joiner[0]] {
        assert_eq!(thread_of(&store, message), lowest);
    }
    let listed = store.list_threads(inbox, None, 50).unwrap();
    assert_eq!(listed.len(), 2);
    assert_eq!(listed[0].thread, ThreadId(lowest));
    assert_eq!(listed[0].messages, 3);
    assert_eq!(listed[0].subject, "a");
    assert_eq!(rows(&store, "SELECT count(*) FROM thread"), 2);
    assert_eq!(rows(&store, "SELECT count(*) FROM thread_place"), 2);
}

#[test]
fn two_replies_to_a_message_that_is_not_held_are_one_thread() {
    let (_directory, home) = home();
    let (mut store, inbox, _) = seeded(&home);
    let messages = record(
        &mut store,
        inbox,
        &[seen(1, "Re: gone", &[90]), seen(2, "Re: gone", &[90])],
    );
    assert_eq!(thread_of(&store, messages[1]), messages[0].0);
}

#[test]
fn a_date_in_the_future_is_not_believed() {
    let (_directory, home) = home();
    let (mut store, inbox, _) = seeded(&home);
    let mut future = seen(1, "stay on top", &[]);
    future.header_block =
        b"Subject: stay on top\r\nDate: Sat, 20 Nov 2099 14:22:01 -0800\r\n\r\n".to_vec();
    future.internal_date = Some(BASE);
    record(&mut store, inbox, &[future]);
    let listed = store.list_threads(inbox, None, 50).unwrap();
    assert_eq!(listed[0].last_date, BASE);
    assert!(rows(&store, "SELECT sent_at FROM envelope") > NOW);
}

#[test]
fn a_body_gives_the_snippet_the_parts_and_the_text_a_search_finds() {
    let (_directory, home) = home();
    let (mut store, inbox, _) = seeded(&home);
    let headers = [seen(1, "plan", &[]), seen(2, "figures", &[])];
    let messages = record(&mut store, inbox, &headers);

    // Before any body, the subject is searchable.
    let found = store.search("figures", 10).unwrap();
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].message, messages[1]);
    assert_eq!(found[0].snippet, "");
    assert!(store.search("picnic", 10).unwrap().is_empty());

    store
        .record_parts(
            &[PartSeen {
                message: messages[0],
                place: Place::Whole,
                bytes: &whole(&headers[0], "The plan is a picnic\r\nby the river.\r\n"),
            }],
            NOW,
        )
        .unwrap();
    let found = store.search("picnic", 10).unwrap();
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].message, messages[0]);
    assert_eq!(found[0].thread, ThreadId(messages[0].0));
    assert_eq!(found[0].subject, "plan");
    assert_eq!(found[0].snippet, "The plan is a picnic by the river.");
    assert_eq!(found[0].sender, "Sender 1");
    // The message is in the index once: its headers' document was replaced.
    assert_eq!(store.search("plan", 10).unwrap().len(), 1);
    assert_eq!(rows(&store, "SELECT count(*) FROM part"), 1);
    let listed = store.list_threads(inbox, None, 50).unwrap();
    assert_eq!(listed[1].snippet, "The plan is a picnic by the river.");

    let opened = store.open_message(messages[0]).unwrap();
    assert_eq!(opened.header.subject, "plan");
    assert!(opened.body.unwrap().text.contains("picnic"));
    assert_eq!(store.open_message(messages[1]).unwrap().body, None);
    // A query the parser cannot read in full does not fail.
    assert!(store.search("picnic AND (", 10).is_ok());
}

#[test]
fn a_thread_shows_in_each_mailbox_that_shows_one_of_its_messages() {
    let (_directory, home) = home();
    let (mut store, inbox, archive) = seeded(&home);
    let headers = [seen(1, "plan", &[]), seen(2, "Re: plan", &[1])];
    record(&mut store, inbox, &headers);
    record(&mut store, archive, &headers[..1]);
    let shown = |store: &Store, mailbox| -> Vec<(u64, i64)> {
        store
            .list_threads(mailbox, None, 50)
            .unwrap()
            .iter()
            .map(|thread| (thread.shown, thread.last_date))
            .collect()
    };
    assert_eq!(shown(&store, inbox), [(2, BASE + 2 * DAY)]);
    // The archive shows the older message alone, under that message's date.
    assert_eq!(shown(&store, archive), [(1, BASE + DAY)]);

    store.record_removed(inbox, "", &["2"], NOW).unwrap();
    assert_eq!(shown(&store, inbox), [(1, BASE + DAY)]);
    store.record_removed(inbox, "", &["1"], NOW).unwrap();
    assert_eq!(shown(&store, inbox), []);
    assert_eq!(shown(&store, archive), [(1, BASE + DAY)]);

    // A new generation of ids: the mailbox shows nothing until it is listed again.
    assert!(store.set_validity(archive, "2", NOW).unwrap());
    assert_eq!(shown(&store, archive), []);
    store
        .record_headers(archive, "2", &headers[..1], NOW)
        .unwrap();
    assert_eq!(shown(&store, archive), [(1, BASE + DAY)]);
    // The thread itself still has both messages.
    assert_eq!(rows(&store, "SELECT messages FROM thread"), 2);
}

#[test]
fn a_rebuild_reproduces_every_derived_table_and_the_index() {
    let (_directory, home) = home();
    let (mut store, inbox, _) = busy(&home);
    store.commit_index().unwrap();
    let before = derived(&store);
    assert!(
        before.iter().all(|(_, rows)| !rows.is_empty()),
        "{before:?}"
    );
    let listed = store.list_threads(inbox, None, 50).unwrap();

    let done = store.rebuild(NOW, |_| {}).unwrap();
    assert!(done.finished);
    assert_eq!(done.done, 7);
    assert!(!store.rebuilding().unwrap());
    assert_eq!(derived(&store), before);
    assert_eq!(store.list_threads(inbox, None, 50).unwrap(), listed);
    assert_eq!(store.search("picnic", 10).unwrap().len(), 1);
    assert_eq!(store.search("figures", 10).unwrap().len(), 1);
    assert_eq!(store.index.as_ref().unwrap().documents(), 7);
    assert_eq!(rows(&store, "SELECT count(*) FROM index_pending"), 0);
}

#[test]
fn a_rebuild_keeps_a_thread_in_each_mailbox_when_its_parts_merge_in_one_batch() {
    let (_directory, home) = home();
    let (mut store, inbox, archive) = seeded(&home);
    // Two threads in two mailboxes, then a message elsewhere that names both.
    let older = record(&mut store, archive, &[seen(1, "b", &[])]);
    let newer = record(&mut store, inbox, &[seen(2, "a", &[])]);
    let account = store
        .add_account("icloud", "person@example.com", 1)
        .unwrap();
    let sent = store
        .upsert_mailbox(
            account,
            &MailboxSeen {
                provider_key: "Sent",
                name: "Sent",
                role: Role::Sent,
            },
        )
        .unwrap();
    record(&mut store, sent, &[seen(3, "Re: a and b", &[2, 1])]);
    assert_eq!(thread_of(&store, newer[0]), older[0].0);
    let shown = |store: &Store, mailbox| -> Vec<(ThreadId, u64)> {
        store
            .list_threads(mailbox, None, 50)
            .unwrap()
            .iter()
            .map(|thread| (thread.thread, thread.shown))
            .collect()
    };
    let one = vec![(ThreadId(older[0].0), 1)];
    for mailbox in [inbox, archive, sent] {
        assert_eq!(shown(&store, mailbox), one);
    }
    let before = derived(&store);

    // The rebuild derives all three in one batch.
    store.rebuild(NOW, |_| {}).unwrap();
    for mailbox in [inbox, archive, sent] {
        assert_eq!(shown(&store, mailbox), one);
    }
    assert_eq!(derived(&store), before);
}

#[test]
fn a_merged_thread_leaves_a_mailbox_when_its_last_message_there_does() {
    let (_directory, home) = home();
    let (mut store, inbox, archive) = seeded(&home);
    record(&mut store, archive, &[seen(1, "b", &[])]);
    record(&mut store, inbox, &[seen(2, "a", &[])]);
    record(&mut store, archive, &[seen(3, "Re: a and b", &[2, 1])]);
    assert_eq!(store.list_threads(inbox, None, 50).unwrap().len(), 1);
    store.record_removed(inbox, "", &["2"], NOW).unwrap();
    assert!(store.list_threads(inbox, None, 50).unwrap().is_empty());
    assert_eq!(store.list_threads(archive, None, 50).unwrap()[0].shown, 2);
    assert_eq!(rows(&store, "SELECT count(*) FROM thread_place"), 1);
}

/// 450 messages in two mailboxes, every third a reply to the first.
fn many(store: &mut Store, inbox: MailboxId, archive: MailboxId) -> Vec<HeaderSeen> {
    let headers: Vec<HeaderSeen> = (1..=450)
        .map(|n| {
            seen(
                n,
                &format!("subject{n}"),
                if n % 3 == 0 { &[1] } else { &[] },
            )
        })
        .collect();
    for (number, batch) in headers.chunks(100).enumerate() {
        record(store, if number % 2 == 0 { inbox } else { archive }, batch);
    }
    store.commit_index().unwrap();
    headers
}

#[test]
fn a_rebuild_that_was_stopped_carries_on_to_the_same_rows() {
    let (_directory, home) = home();
    let (mut store, inbox, archive) = seeded(&home);
    many(&mut store, inbox, archive);
    let before = derived(&store);

    store.rebuild_begin().unwrap();
    assert!(store.rebuilding().unwrap());
    assert_eq!(rows(&store, "SELECT count(*) FROM envelope"), 0);
    let step = store.rebuild_step(NOW).unwrap();
    assert!(!step.finished);
    assert!(step.done < step.total);
    // A stop: nothing is committed to the index, and the process ends.
    drop(store);

    let mut store = Store::open(&home).unwrap();
    assert!(store.rebuilding().unwrap());
    let mut steps = 0;
    assert!(store.rebuild(NOW, |_| steps += 1).unwrap().finished);
    // Two batches were left, and the step that finds nothing more.
    assert_eq!(steps, 3);
    assert_eq!(derived(&store), before);
    assert_eq!(store.search("subject7", 10).unwrap().len(), 1);
    assert_eq!(store.index.as_ref().unwrap().documents(), 450);
}

#[test]
fn mail_recorded_while_a_rebuild_is_under_way_is_derived_by_it() {
    let (_directory, home) = home();
    let (mut store, inbox, archive) = seeded(&home);
    many(&mut store, inbox, archive);
    store.rebuild_begin().unwrap();
    store.rebuild_step(NOW).unwrap();

    let late = seen(451, "late arrival", &[2]);
    let message = record(&mut store, inbox, std::slice::from_ref(&late))[0];
    assert_eq!(
        rows(
            &store,
            "SELECT count(*) FROM envelope WHERE message_id = 451"
        ),
        0
    );
    store
        .record_parts(
            &[PartSeen {
                message,
                place: Place::Whole,
                bytes: &whole(&late, "Sorry to be late.\r\n"),
            }],
            NOW,
        )
        .unwrap();
    assert!(store.rebuild(NOW, |_| {}).unwrap().finished);
    assert_eq!(thread_of(&store, message), 2);
    assert_eq!(store.search("late", 10).unwrap().len(), 1);
    assert_eq!(store.index.as_ref().unwrap().documents(), 451);
    assert_eq!(rows(&store, "SELECT count(*) FROM part"), 1);
    // A second rebuild of the whole gives the same rows again.
    let after = derived(&store);
    store.rebuild(NOW, |_| {}).unwrap();
    assert_eq!(derived(&store), after);
}

#[test]
fn an_index_ahead_of_the_database_does_not_swallow_new_documents() {
    let (_directory, home) = home();
    let (mut store, inbox, _) = seeded(&home);
    record(
        &mut store,
        inbox,
        &[
            seen(1, "one", &[]),
            seen(2, "two", &[]),
            seen(3, "three", &[]),
        ],
    );
    store.commit_index().unwrap();
    drop(store);
    // A power failure took the database's last transactions, or an older
    // copy of it was restored: its numbering starts again under the index's.
    {
        let database = rusqlite::Connection::open(home.database()).unwrap();
        database
            .execute_batch(
                "DELETE FROM sqlite_sequence WHERE name = 'index_pending';
                 UPDATE engine_state SET value = 0 WHERE key = 'index-committed';",
            )
            .unwrap();
    }

    let mut store = Store::open(&home).unwrap();
    record(&mut store, inbox, &[seen(4, "four", &[])]);
    assert!(rows(&store, "SELECT min(seq) FROM index_pending") > 3);
    // A stop before the index was committed.
    drop(store);
    let mut store = Store::open(&home).unwrap();
    assert_eq!(store.search("four", 10).unwrap().len(), 1);
}

#[test]
fn a_store_with_mail_from_before_these_tables_waits_for_a_rebuild() {
    let (_directory, home) = home();
    let block = block(1, "from before", &[]);
    {
        let store = Store::open_with(&home, &schema::MIGRATIONS[..1]).unwrap();
        let blob = store.log().put(&block).unwrap();
        store
            .connection
            .execute(
                "INSERT INTO message (header_hash, reported_size, first_seen_at) VALUES (?1, 1001, 5)",
                [blob.as_bytes().as_slice()],
            )
            .unwrap();
        store
            .connection
            .execute(
                "INSERT INTO held (message_id, part, kind, blob, size) VALUES (1, 'header', 'header', ?1, 10)",
                [blob.as_bytes().as_slice()],
            )
            .unwrap();
    }
    let mut store = Store::open(&home).unwrap();
    assert!(store.rebuilding().unwrap());
    store.rebuild(NOW, |_| {}).unwrap();
    assert_eq!(store.search("before", 10).unwrap().len(), 1);

    // A store with no mail has nothing to rebuild.
    let (_other, empty) = self::home();
    drop(Store::open_with(&empty, &schema::MIGRATIONS[..1]).unwrap());
    assert!(!Store::open(&empty).unwrap().rebuilding().unwrap());
}

#[test]
fn documents_a_stop_lost_reach_the_index_when_the_store_opens_again() {
    let (_directory, home) = home();
    let (mut store, inbox, _) = seeded(&home);
    let headers = [seen(1, "plan", &[]), seen(2, "figures", &[])];
    let messages = record(&mut store, inbox, &headers);
    store
        .record_parts(
            &[PartSeen {
                message: messages[0],
                place: Place::Whole,
                bytes: &whole(&headers[0], "A picnic.\r\n"),
            }],
            NOW,
        )
        .unwrap();
    assert_eq!(rows(&store, "SELECT count(*) FROM index_pending"), 3);
    // A stop before the index was committed.
    drop(store);

    let mut store = Store::open(&home).unwrap();
    assert_eq!(store.search("picnic", 10).unwrap().len(), 1);
    assert_eq!(store.search("figures", 10).unwrap().len(), 1);
    assert_eq!(rows(&store, "SELECT count(*) FROM index_pending"), 0);
    assert_eq!(store.index.as_ref().unwrap().documents(), 2);
}

#[test]
fn an_index_older_than_the_tables_is_reported_and_a_rebuild_makes_it_again() {
    let (_directory, home) = home();
    let (mut store, inbox, _) = seeded(&home);
    record(&mut store, inbox, &[seen(1, "plan", &[])]);
    assert_eq!(store.search("plan", 10).unwrap().len(), 1);
    drop(store);
    std::fs::remove_dir_all(home.index()).unwrap();

    let mut store = Store::open(&home).unwrap();
    assert!(matches!(
        store.search("plan", 10),
        Err(StoreError::IndexStale)
    ));
    let refused = store.record_headers(inbox, "", &[seen(2, "more", &[])], NOW);
    assert!(
        matches!(refused, Err(StoreError::IndexStale)),
        "{refused:?}"
    );
    // Lists do not need the index.
    assert_eq!(store.list_threads(inbox, None, 50).unwrap().len(), 1);

    store.rebuild(NOW, |_| {}).unwrap();
    assert_eq!(store.search("plan", 10).unwrap().len(), 1);
    record(&mut store, inbox, &[seen(2, "more", &[])]);
    assert_eq!(store.search("more", 10).unwrap().len(), 1);
}

#[test]
fn a_message_whose_bytes_cannot_be_read_back_does_not_stop_a_rebuild() {
    let (_directory, home) = home();
    let (mut store, inbox, _) = seeded(&home);
    let headers = [seen(1, "plan", &[]), seen(2, "figures", &[])];
    let messages = record(&mut store, inbox, &headers);
    assert!(
        store
            .log()
            .set_aside(BlobId::of(&headers[0].header_block))
            .unwrap()
    );

    assert!(store.rebuild(NOW, |_| {}).unwrap().finished);
    let unparsed: Option<String> = store
        .connection
        .query_row(
            "SELECT unparsed FROM envelope WHERE message_id = ?1",
            [messages[0].0],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        unparsed.as_deref(),
        Some("the headers could not be read from the log")
    );
    assert_eq!(store.search("figures", 10).unwrap().len(), 1);
    assert_eq!(store.list_threads(inbox, None, 50).unwrap().len(), 2);
}

#[test]
fn a_change_row_says_which_threads_a_batch_changed() {
    let (_directory, home) = home();
    let (mut store, inbox, _) = seeded(&home);
    record(
        &mut store,
        inbox,
        &[seen(1, "a", &[]), seen(2, "Re: a", &[1])],
    );
    assert_eq!(
        rows(&store, "SELECT count(*) FROM change WHERE kind = 'thread'"),
        1
    );
    assert_eq!(
        rows(&store, "SELECT subject FROM change WHERE kind = 'thread'"),
        1
    );
}

#[test]
fn the_migration_that_adds_unread_counts_them_from_the_observations() {
    let (_directory, home) = home();
    {
        let store = Store::open_with(&home, &schema::MIGRATIONS[..2]).unwrap();
        store
            .connection
            .execute_batch(
                r#"
                INSERT INTO account (id, provider, address, created_at) VALUES (1, 'icloud', 'a', 0);
                INSERT INTO mailbox (id, account_id, provider_key, name, role, header_only)
                    VALUES (1, 1, 'INBOX', 'INBOX', 'inbox', 0);
                INSERT INTO message (id, header_hash, reported_size, first_seen_at)
                    VALUES (1, zeroblob(32), 10, 0), (2, randomblob(32), 10, 0);
                INSERT INTO observation (message_id, mailbox_id, validity, provider_id, flags, seen_at)
                    VALUES (1, 1, '', '1', '["\\Seen"]', 0), (2, 1, '', '2', '[]', 0);
                INSERT INTO envelope (message_id, parser, thread_id, date, sender_address,
                                      sender_name, subject)
                    VALUES (1, 1, 1, 5, 'a', '', 's'), (2, 1, 1, 6, 'a', '', 's');
                INSERT INTO thread (id, last_date, messages, attachments, last_message, subject,
                                    snippet, last_sender)
                    VALUES (1, 6, 2, 0, 2, 's', '', 'a');
                INSERT INTO thread_place (mailbox_id, thread_id, last_date, messages)
                    VALUES (1, 1, 6, 2);
                "#,
            )
            .unwrap();
    }
    let store = Store::open(&home).unwrap();
    let listed = store.list_threads(MailboxId(1), None, 10).unwrap();
    assert_eq!((listed[0].shown, listed[0].unread), (2, 1));
}

#[test]
fn a_change_of_flags_is_a_change_of_what_is_unread() {
    let (_directory, home) = home();
    let (mut store, inbox, _) = seeded(&home);
    record(
        &mut store,
        inbox,
        &[seen(1, "plan", &[]), seen(2, "plan", &[1])],
    );
    let unread = |store: &Store| store.list_threads(inbox, None, 10).unwrap()[0].unread;
    assert_eq!(unread(&store), 2);
    let changed = store
        .record_flags(
            inbox,
            "",
            &[
                crate::provider::FlagsSeen {
                    provider_id: "1".to_string(),
                    flags: vec!["\\Seen".to_string()],
                },
                // One the mailbox does not show is left alone.
                crate::provider::FlagsSeen {
                    provider_id: "77".to_string(),
                    flags: vec![],
                },
            ],
            NOW + 1,
        )
        .unwrap();
    assert_eq!(changed, 1);
    assert_eq!(unread(&store), 1);
    // The same flags again change nothing.
    assert_eq!(
        store
            .record_flags(
                inbox,
                "",
                &[crate::provider::FlagsSeen {
                    provider_id: "1".to_string(),
                    flags: vec!["\\Seen".to_string()],
                }],
                NOW + 2,
            )
            .unwrap(),
        0
    );
}
