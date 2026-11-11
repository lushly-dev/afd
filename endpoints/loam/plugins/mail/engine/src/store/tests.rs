//! The store's tests: migrations, a message's identity, and what a provider
//! showed.

#![allow(clippy::expect_used, clippy::unwrap_used)]

use super::*;

fn home() -> (tempfile::TempDir, Home) {
    let directory = tempfile::tempdir().expect("a temporary directory");
    let home = Home::at(directory.path().join("data"));
    (directory, home)
}

fn header(provider_id: &str, subject: &str, flags: &[&str]) -> HeaderSeen {
    HeaderSeen {
        provider_id: provider_id.to_string(),
        provider_thread: None,
        reported_size: 1000,
        internal_date: Some(1_700_000_000_000),
        flags: flags.iter().map(ToString::to_string).collect(),
        header_block: format!("Subject: {subject}\r\n\r\n").into_bytes(),
    }
}

/// A store with one account and two mailboxes.
fn seeded(home: &Home) -> (Store, MailboxId, MailboxId) {
    let mut store = Store::open(home).expect("the store opens");
    let account = store
        .add_account("icloud", "person@example.com", 1)
        .expect("an account");
    let inbox = store
        .upsert_mailbox(
            account,
            &MailboxSeen {
                provider_key: "INBOX",
                name: "Inbox",
                role: Role::Inbox,
            },
        )
        .expect("a mailbox");
    let archive = store
        .upsert_mailbox(
            account,
            &MailboxSeen {
                provider_key: "Archive",
                name: "Archive",
                role: Role::Archive,
            },
        )
        .expect("a mailbox");
    (store, inbox, archive)
}

fn rows(store: &Store, sql: &str) -> i64 {
    store
        .connection
        .query_row(sql, [], |row| row.get(0))
        .expect("a count")
}

#[test]
fn a_new_store_is_at_the_newest_schema_and_opens_again() {
    let (_directory, home) = home();
    let newest = u32::try_from(schema::MIGRATIONS.len()).unwrap();
    assert_eq!(
        Store::open(&home).unwrap().schema_version().unwrap(),
        newest
    );
    assert_eq!(
        Store::open(&home).unwrap().schema_version().unwrap(),
        newest
    );
}

#[test]
fn only_one_process_owns_the_store() {
    let (_directory, home) = home();
    let first = Store::open(&home).unwrap();
    assert!(matches!(Store::open(&home), Err(StoreError::InUse)));
    drop(first);
    assert!(Store::open(&home).is_ok());
}

#[test]
fn migrations_run_forward_one_at_a_time() {
    let (_directory, home) = home();
    let first = "CREATE TABLE one (id INTEGER PRIMARY KEY) STRICT;";
    let second = "CREATE TABLE two (id INTEGER PRIMARY KEY) STRICT; INSERT INTO two VALUES (7);";
    let store = Store::open_with(&home, &[first]).unwrap();
    assert_eq!(store.schema_version().unwrap(), 1);
    drop(store);
    // The second runs alone: running the first again would fail on its table.
    let store = Store::open_with(&home, &[first, second]).unwrap();
    assert_eq!(store.schema_version().unwrap(), 2);
    assert_eq!(rows(&store, "SELECT id FROM two"), 7);
}

#[test]
fn a_store_from_a_newer_program_is_refused_and_left_alone() {
    let (_directory, home) = home();
    let two = [
        "CREATE TABLE one (id INTEGER) STRICT;",
        "CREATE TABLE two (id INTEGER) STRICT;",
    ];
    drop(Store::open_with(&home, &two).unwrap());
    let refused = Store::open_with(&home, &two[..1]);
    assert!(
        matches!(
            refused,
            Err(StoreError::Newer {
                found: 2,
                supported: 1
            })
        ),
        "{refused:?}"
    );
    assert_eq!(
        Store::open_with(&home, &two)
            .unwrap()
            .schema_version()
            .unwrap(),
        2
    );
}

#[test]
fn a_migration_that_fails_changes_nothing() {
    let (_directory, home) = home();
    let first = "CREATE TABLE one (id INTEGER) STRICT;";
    let broken = "CREATE TABLE two (id INTEGER) STRICT; INSERT INTO missing VALUES (1);";
    drop(Store::open_with(&home, &[first]).unwrap());
    assert!(matches!(
        Store::open_with(&home, &[first, broken]),
        Err(StoreError::Sqlite(_))
    ));
    let store = Store::open_with(&home, &[first]).unwrap();
    assert_eq!(store.schema_version().unwrap(), 1);
    assert_eq!(
        rows(
            &store,
            "SELECT count(*) FROM sqlite_master WHERE name = 'two'"
        ),
        0
    );
}

#[cfg(unix)]
#[test]
fn the_directory_and_its_files_are_the_owners_alone() {
    use std::os::unix::fs::PermissionsExt;
    let (_directory, home) = home();
    let (mut store, inbox, _) = seeded(&home);
    store
        .record_headers(inbox, "", &[header("1", "a", &[])], 2)
        .unwrap();
    let mode = |path: &std::path::Path| path.metadata().unwrap().permissions().mode() & 0o777;
    assert_eq!(mode(home.root()), 0o700);
    assert_eq!(mode(&home.blobs()), 0o700);
    assert_eq!(mode(&home.database()), 0o600);
    assert_eq!(mode(&home.lock_file()), 0o600);
    let mut files = 0;
    for shard in std::fs::read_dir(home.blobs()).unwrap() {
        let shard = shard.unwrap().path();
        assert_eq!(mode(&shard), 0o700);
        for file in std::fs::read_dir(shard).unwrap() {
            assert_eq!(mode(&file.unwrap().path()), 0o600);
            files += 1;
        }
    }
    assert_eq!(files, 1);
}

#[test]
fn a_message_in_two_mailboxes_is_one_message_seen_twice() {
    let (_directory, home) = home();
    let (mut store, inbox, archive) = seeded(&home);
    let first = store
        .record_headers(inbox, "", &[header("10", "hello", &["\\Seen"])], 2)
        .unwrap();
    assert_eq!(
        first,
        BatchOutcome {
            new_messages: 1,
            added: 1,
            changed: 0,
            unchanged: 0
        }
    );
    // The same header block and size under another mailbox's own id.
    let second = store
        .record_headers(archive, "", &[header("77", "hello", &[])], 3)
        .unwrap();
    assert_eq!(
        second,
        BatchOutcome {
            new_messages: 0,
            added: 1,
            changed: 0,
            unchanged: 0
        }
    );
    assert_eq!(rows(&store, "SELECT count(*) FROM message"), 1);
    assert_eq!(
        rows(
            &store,
            "SELECT count(*) FROM observation WHERE ended_at IS NULL"
        ),
        2
    );
    // The same header block with another size is another message.
    let mut longer = header("11", "hello", &[]);
    longer.reported_size = 1001;
    assert_eq!(
        store
            .record_headers(inbox, "", &[longer], 4)
            .unwrap()
            .new_messages,
        1
    );
    assert_eq!(rows(&store, "SELECT count(*) FROM message"), 2);
}

#[test]
fn seeing_a_message_again_changes_nothing_and_a_new_flag_supersedes() {
    let (_directory, home) = home();
    let (mut store, inbox, _) = seeded(&home);
    store
        .record_headers(inbox, "", &[header("10", "hello", &["b", "a"])], 2)
        .unwrap();
    let changes = store.last_change().unwrap();
    // The same flags in another order, and one repeated.
    let again = store.record_headers(inbox, "", &[header("10", "hello", &["a", "b", "a"])], 3);
    assert_eq!(
        again.unwrap(),
        BatchOutcome {
            unchanged: 1,
            ..BatchOutcome::default()
        }
    );
    assert_eq!(store.last_change().unwrap(), changes);
    let flagged = store
        .record_headers(inbox, "", &[header("10", "hello", &["a"])], 4)
        .unwrap();
    assert_eq!(
        flagged,
        BatchOutcome {
            changed: 1,
            ..BatchOutcome::default()
        }
    );
    assert_eq!(store.last_change().unwrap(), changes + 1);
    // Nothing is deleted: the earlier observation is ended, and one is current.
    assert_eq!(rows(&store, "SELECT count(*) FROM observation"), 2);
    assert_eq!(
        rows(
            &store,
            "SELECT count(*) FROM observation WHERE ended_by = 'superseded'"
        ),
        1
    );
    assert_eq!(
        store
            .connection
            .query_row(
                "SELECT flags FROM observation WHERE ended_at IS NULL",
                [],
                |row| { row.get::<_, String>(0) }
            )
            .unwrap(),
        r#"["a"]"#
    );
}

#[test]
fn a_batch_is_stored_whole_or_not_at_all() {
    let (_directory, home) = home();
    let (mut store, inbox, _) = seeded(&home);
    // The database refuses the second message of the batch, after the first was written.
    store
        .connection
        .execute_batch(
            "CREATE TRIGGER refuse_two BEFORE INSERT ON observation WHEN NEW.provider_id = '2'
             BEGIN SELECT RAISE(ABORT, 'refused'); END;",
        )
        .unwrap();
    let batch = [header("1", "a", &[]), header("2", "b", &[])];
    assert!(matches!(
        store.record_headers(inbox, "", &batch, 2),
        Err(StoreError::Sqlite(_))
    ));
    assert_eq!(rows(&store, "SELECT count(*) FROM message"), 0);
    assert_eq!(rows(&store, "SELECT count(*) FROM held"), 0);
    assert_eq!(rows(&store, "SELECT count(*) FROM observation"), 0);
    assert_eq!(store.last_change().unwrap(), 0);
    // The first alone is accepted afterwards.
    assert_eq!(
        store
            .record_headers(inbox, "", &batch[..1], 3)
            .unwrap()
            .added,
        1
    );
}

#[test]
fn ids_of_another_generation_are_refused() {
    let (_directory, home) = home();
    let (mut store, inbox, _) = seeded(&home);
    let batch = [header("1", "a", &[])];
    assert!(matches!(
        store.record_headers(inbox, "other", &batch, 2),
        Err(StoreError::ValidityMismatch)
    ));
    assert!(matches!(
        store.record_not_returned(inbox, "other", &["1"], 2),
        Err(StoreError::ValidityMismatch)
    ));
    assert!(matches!(
        store.record_removed(inbox, "other", &["1"], 2),
        Err(StoreError::ValidityMismatch)
    ));
    assert!(matches!(
        store.record_headers(MailboxId(999), "", &batch, 2),
        Err(StoreError::NotFound("mailbox"))
    ));
    assert_eq!(rows(&store, "SELECT count(*) FROM observation"), 0);
}

/// Not a limit's proof, which is step B2's second half with the harness: a
/// first look at whether the log's write per message can meet 500 a second.
#[test]
#[ignore = "a measurement; run with --ignored --nocapture in a release build"]
fn measure_recording_headers() {
    let (_directory, home) = home();
    let (mut store, inbox, _) = seeded(&home);
    let total = 20_000_u32;
    let started = std::time::Instant::now();
    for batch in 0..total / 250 {
        let headers: Vec<HeaderSeen> = (0..250)
            .map(|index| {
                let number = batch * 250 + index;
                let mut seen = header(&number.to_string(), &format!("message {number}"), &[]);
                seen.header_block
                    .extend(format!("X-Filler: {}\r\n", "x".repeat(1500)).bytes());
                seen
            })
            .collect();
        store.record_headers(inbox, "", &headers, 2).unwrap();
    }
    let seconds = started.elapsed().as_secs_f64();
    println!(
        "{total} headers in {seconds:.2} s: {:.0} a second",
        f64::from(total) / seconds
    );
}

#[test]
fn flags_with_quotes_and_control_characters_are_kept_as_json() {
    assert_eq!(flags_json(&[]), "[]");
    let flags = ["a\"b".to_string(), "c\\d".to_string(), "e\nf".to_string()];
    let json = flags_json(&flags);
    let parsed: Vec<String> = serde_json::from_str(&json).expect("valid JSON");
    assert_eq!(parsed, flags);
}

#[test]
fn a_listed_message_that_does_not_arrive_is_counted_until_it_does() {
    let (_directory, home) = home();
    let (mut store, inbox, _) = seeded(&home);
    store
        .record_headers(inbox, "", &[header("1", "a", &[])], 2)
        .unwrap();
    store
        .record_not_returned(inbox, "", &["2", "3"], 3)
        .unwrap();
    store.record_not_returned(inbox, "", &["2"], 4).unwrap();
    let tries = |store: &Store, id: &str| {
        store
            .connection
            .query_row(
                "SELECT tries, first_tried_at, last_tried_at FROM unreturned WHERE provider_id = ?1",
                [id],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?, row.get::<_, i64>(2)?)),
            )
            .unwrap()
    };
    assert_eq!(tries(&store, "2"), (2, 3, 4));
    assert_eq!(tries(&store, "3"), (1, 3, 3));
    // Nothing is invented for them: no message and no observation.
    assert_eq!(
        store.mailbox_counts(inbox).unwrap(),
        MailboxCounts {
            headers_held: 1,
            bodies_held: 0,
            awaited: 2,
            unreturned: 0,
        }
    );
    assert_eq!(rows(&store, "SELECT count(*) FROM message"), 1);
    // One that answers is stored like any other and leaves the list.
    store
        .record_headers(inbox, "", &[header("2", "b", &[])], 5)
        .unwrap();
    assert_eq!(
        store.mailbox_counts(inbox).unwrap(),
        MailboxCounts {
            headers_held: 2,
            bodies_held: 0,
            awaited: 1,
            unreturned: 0,
        }
    );
}

#[test]
fn a_message_that_leaves_the_listing_is_ended_not_deleted() {
    let (_directory, home) = home();
    let (mut store, inbox, _) = seeded(&home);
    store
        .record_headers(
            inbox,
            "",
            &[header("1", "a", &[]), header("2", "b", &[])],
            2,
        )
        .unwrap();
    store.record_not_returned(inbox, "", &["3"], 2).unwrap();
    // "9" was never seen: removing it ends nothing.
    let changes = store.last_change().unwrap();
    assert_eq!(
        store
            .record_removed(inbox, "", &["1", "3", "9"], 3)
            .unwrap(),
        1
    );
    // One change, for the one observation that ended.
    assert_eq!(store.last_change().unwrap(), changes + 1);
    assert_eq!(
        rows(
            &store,
            "SELECT count(*) FROM change WHERE kind = 'observation-ended'"
        ),
        1
    );
    assert_eq!(
        store.mailbox_counts(inbox).unwrap(),
        MailboxCounts {
            headers_held: 1,
            bodies_held: 0,
            awaited: 0,
            unreturned: 0,
        }
    );
    assert_eq!(rows(&store, "SELECT count(*) FROM observation"), 2);
    assert_eq!(
        rows(
            &store,
            "SELECT count(*) FROM observation WHERE ended_by = 'removed'"
        ),
        1
    );
    // The message and its bytes stay.
    assert_eq!(rows(&store, "SELECT count(*) FROM message"), 2);
    // Seen again under the same id, it is current again.
    assert_eq!(
        store
            .record_headers(inbox, "", &[header("1", "a", &[])], 4)
            .unwrap()
            .added,
        1
    );
}

#[test]
fn a_new_generation_closes_the_mailbox_and_matches_its_messages_again() {
    let (_directory, home) = home();
    let (mut store, inbox, archive) = seeded(&home);
    assert!(store.set_validity(inbox, "100", 1).unwrap());
    assert_eq!(store.last_change().unwrap(), 0);
    assert!(!store.set_validity(inbox, "100", 1).unwrap());
    store
        .record_headers(
            inbox,
            "100",
            &[header("1", "a", &[]), header("2", "b", &[])],
            2,
        )
        .unwrap();
    store
        .record_headers(archive, "", &[header("5", "c", &[])], 2)
        .unwrap();
    store.record_not_returned(inbox, "100", &["3"], 2).unwrap();
    store.set_cursor(inbox, Some("modseq 9"), 2).unwrap();
    assert_eq!(
        store.mailbox_position(inbox).unwrap(),
        ("100".to_string(), Some("modseq 9".to_string()))
    );

    let changes = store.last_change().unwrap();
    assert!(store.set_validity(inbox, "200", 3).unwrap());
    // A view of the mailbox is told, with one row.
    assert_eq!(store.last_change().unwrap(), changes + 1);
    assert_eq!(
        store
            .connection
            .query_row(
                "SELECT kind, subject FROM change ORDER BY seq DESC LIMIT 1",
                [],
                |row| { Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)) }
            )
            .unwrap(),
        ("mailbox-closed".to_string(), inbox.0)
    );
    assert_eq!(
        store.mailbox_position(inbox).unwrap(),
        ("200".to_string(), None)
    );
    assert_eq!(
        store.mailbox_counts(inbox).unwrap(),
        MailboxCounts::default()
    );
    assert_eq!(
        rows(
            &store,
            "SELECT count(*) FROM observation WHERE ended_by = 'closed'"
        ),
        2
    );
    // Another mailbox is untouched.
    assert_eq!(store.mailbox_counts(archive).unwrap().headers_held, 1);
    // The old generation's ids are refused.
    assert!(matches!(
        store.record_headers(inbox, "100", &[header("1", "a", &[])], 4),
        Err(StoreError::ValidityMismatch)
    ));
    // Listed again under new ids, the messages are found, not stored twice.
    let again = store
        .record_headers(
            inbox,
            "200",
            &[header("41", "a", &[]), header("42", "b", &[])],
            4,
        )
        .unwrap();
    assert_eq!(
        again,
        BatchOutcome {
            new_messages: 0,
            added: 2,
            changed: 0,
            unchanged: 0
        }
    );
    assert_eq!(rows(&store, "SELECT count(*) FROM message"), 3);
}

fn part<'a>(message: MessageId, place: Place<'a>, bytes: &'a [u8]) -> PartSeen<'a> {
    PartSeen {
        message,
        place,
        bytes,
    }
}

#[test]
fn a_message_held_in_part_and_later_whole_keeps_its_row() {
    let (_directory, home) = home();
    let (mut store, inbox, _) = seeded(&home);
    let seen = header("1", "a", &[]);
    store
        .record_headers(inbox, "", std::slice::from_ref(&seen), 2)
        .unwrap();
    let message = store
        .find_message(&seen.header_block, seen.reported_size)
        .unwrap()
        .unwrap();
    assert_eq!(store.find_message(&seen.header_block, 999).unwrap(), None);
    assert_eq!(
        store.read_part(message, "header").unwrap(),
        seen.header_block
    );
    assert!(matches!(
        store.read_part(message, "whole"),
        Err(StoreError::NotFound("part"))
    ));

    store
        .record_parts(&[
            part(message, Place::Text("1"), b"the text"),
            part(message, Place::Attachment("2.1"), &[0, 159, 146, 150]),
        ])
        .unwrap();
    assert_eq!(store.mailbox_counts(inbox).unwrap().bodies_held, 0);
    let whole = [seen.header_block.as_slice(), b"the text"].concat();
    store
        .record_parts(&[part(message, Place::Whole, &whole)])
        .unwrap();
    assert_eq!(store.read_part(message, "whole").unwrap(), whole);
    assert_eq!(store.read_part(message, "1").unwrap(), b"the text");
    assert_eq!(store.read_part(message, "2.1").unwrap(), [0, 159, 146, 150]);
    assert_eq!(store.mailbox_counts(inbox).unwrap().bodies_held, 1);
    assert_eq!(rows(&store, "SELECT count(*) FROM message"), 1);
    assert_eq!(
        rows(
            &store,
            "SELECT count(*) FROM held WHERE kind IN ('text', 'attachment', 'whole')"
        ),
        3
    );
}

#[test]
fn parts_are_recorded_all_or_none_and_never_overwritten() {
    let (_directory, home) = home();
    let (mut store, inbox, _) = seeded(&home);
    let seen = header("1", "a", &[]);
    store
        .record_headers(inbox, "", std::slice::from_ref(&seen), 2)
        .unwrap();
    let message = store
        .find_message(&seen.header_block, seen.reported_size)
        .unwrap()
        .unwrap();
    let held = |store: &Store| rows(store, "SELECT count(*) FROM held");

    // The second part's message does not exist: the first is not recorded either.
    let refused = store.record_parts(&[
        part(message, Place::Text("1"), b"text"),
        part(MessageId(999), Place::Whole, b"x"),
    ]);
    assert!(
        matches!(refused, Err(StoreError::NotFound("message"))),
        "{refused:?}"
    );
    assert_eq!(held(&store), 1);

    // A place cannot stand in for the header block or the whole message.
    for place in ["header", "whole", "", "1.", ".1", "1..2", "1a", "-1"] {
        for bad in [Place::Text(place), Place::Attachment(place)] {
            let refused = store.record_parts(&[part(message, bad, b"other")]);
            assert!(
                matches!(refused, Err(StoreError::BadPlace)),
                "{place}: {refused:?}"
            );
        }
    }
    assert_eq!(
        store.read_part(message, "header").unwrap(),
        seen.header_block
    );

    // The same bytes again change nothing; other bytes for a held part are refused.
    store
        .record_parts(&[part(message, Place::Whole, b"first")])
        .unwrap();
    store
        .record_parts(&[part(message, Place::Whole, b"first")])
        .unwrap();
    assert!(matches!(
        store.record_parts(&[part(message, Place::Whole, b"second")]),
        Err(StoreError::Conflict)
    ));
    assert_eq!(store.read_part(message, "whole").unwrap(), b"first");
    assert_eq!(held(&store), 2);
}

#[test]
fn a_damaged_file_is_reported_on_read_and_repaired_by_storing_again() {
    let (_directory, home) = home();
    let (mut store, inbox, _) = seeded(&home);
    let seen = header("1", "a", &[]);
    store
        .record_headers(inbox, "", std::slice::from_ref(&seen), 2)
        .unwrap();
    let message = store
        .find_message(&seen.header_block, seen.reported_size)
        .unwrap()
        .unwrap();
    // Empty the header block's file, as a power failure could.
    let shard = std::fs::read_dir(home.blobs())
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let file = std::fs::read_dir(shard)
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    std::fs::write(&file, b"").unwrap();
    assert!(matches!(
        store.read_part(message, "header"),
        Err(StoreError::Log(LogError::Corrupt(_)))
    ));
    // The provider returns the header again: the file is written afresh.
    let again = store
        .record_headers(inbox, "", std::slice::from_ref(&seen), 3)
        .unwrap();
    assert_eq!(
        again,
        BatchOutcome {
            unchanged: 1,
            ..BatchOutcome::default()
        }
    );
    assert_eq!(
        store.read_part(message, "header").unwrap(),
        seen.header_block
    );
    // The damaged file was set aside, not deleted.
    assert_eq!(
        std::fs::read_dir(home.blobs().join("damaged"))
            .unwrap()
            .count(),
        1
    );
}

#[test]
fn a_thread_the_provider_changes_supersedes() {
    let (_directory, home) = home();
    let (mut store, inbox, _) = seeded(&home);
    let mut seen = header("1", "a", &[]);
    seen.provider_thread = Some("t1".to_string());
    store
        .record_headers(inbox, "", std::slice::from_ref(&seen), 2)
        .unwrap();
    assert_eq!(
        store
            .record_headers(inbox, "", std::slice::from_ref(&seen), 3)
            .unwrap()
            .unchanged,
        1
    );
    seen.provider_thread = Some("t2".to_string());
    assert_eq!(
        store
            .record_headers(inbox, "", std::slice::from_ref(&seen), 4)
            .unwrap()
            .changed,
        1
    );
}

#[test]
fn a_pass_records_its_cursor_and_clears_the_last_error() {
    let (_directory, home) = home();
    let (mut store, inbox, _) = seeded(&home);
    let error = |store: &Store| {
        store
            .connection
            .query_row(
                "SELECT last_error, last_pass_at FROM mailbox WHERE id = ?1",
                [inbox.0],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, Option<i64>>(1)?,
                    ))
                },
            )
            .unwrap()
    };
    store
        .set_error(inbox, "the provider could not be reached")
        .unwrap();
    assert_eq!(
        error(&store),
        (Some("the provider could not be reached".to_string()), None)
    );
    store.set_cursor(inbox, Some("c"), 9).unwrap();
    assert_eq!(error(&store), (None, Some(9)));
    for refused in [
        store.set_cursor(MailboxId(999), None, 1),
        store.set_error(MailboxId(999), "x"),
        store.set_validity(MailboxId(999), "1", 1).map(|_| ()),
        store.mailbox_position(MailboxId(999)).map(|_| ()),
    ] {
        assert!(
            matches!(refused, Err(StoreError::NotFound("mailbox"))),
            "{refused:?}"
        );
    }
}

#[test]
fn a_message_is_unreturned_after_three_tries() {
    let (_directory, home) = home();
    let (mut store, inbox, _) = seeded(&home);
    for (now, ids) in [(1, &["7", "8"][..]), (2, &["7"]), (3, &["7"])] {
        store.record_not_returned(inbox, "", ids, now).unwrap();
    }
    let counts = store.mailbox_counts(inbox).unwrap();
    assert_eq!((counts.awaited, counts.unreturned), (1, 1));
}

#[cfg(unix)]
#[test]
fn a_directory_that_was_open_to_others_is_closed() {
    use std::os::unix::fs::PermissionsExt;
    let (_directory, home) = home();
    std::fs::create_dir_all(home.root()).unwrap();
    std::fs::set_permissions(home.root(), std::fs::Permissions::from_mode(0o755)).unwrap();
    let _store = Store::open(&home).unwrap();
    assert_eq!(
        home.root().metadata().unwrap().permissions().mode() & 0o777,
        0o700
    );
    for file in ["mail.sqlite3", "mail.sqlite3-wal", "mail.sqlite3-shm"] {
        let mode = home
            .root()
            .join(file)
            .metadata()
            .unwrap()
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o600, "{file}");
    }
}

#[test]
fn what_was_stored_survives_closing_and_opening() {
    let (_directory, home) = home();
    let (mut store, inbox, _) = seeded(&home);
    let seen = header("1", "a", &["\\Seen"]);
    store
        .record_headers(inbox, "", std::slice::from_ref(&seen), 2)
        .unwrap();
    drop(store);
    let (store, inbox_again, _) = seeded(&home);
    assert_eq!(inbox_again, inbox);
    assert_eq!(store.mailbox_counts(inbox).unwrap().headers_held, 1);
    let message = store
        .find_message(&seen.header_block, seen.reported_size)
        .unwrap()
        .unwrap();
    assert_eq!(
        store.read_part(message, "header").unwrap(),
        seen.header_block
    );
}
