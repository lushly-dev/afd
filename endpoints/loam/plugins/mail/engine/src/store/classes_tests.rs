//! Tests of screening classes, the person's decisions and agents'
//! suggestions (the specification's 7.2 and 7.3).

#![allow(clippy::expect_used, clippy::unwrap_used)]

use rusqlite::types::Value;

use super::test_mail::*;
use super::*;

fn agent(id: &str) -> Proposer {
    Proposer {
        kind: "agent".to_string(),
        id: Some(id.to_string()),
    }
}

fn stored(suggested: Suggested) -> i64 {
    match suggested {
        Suggested::Stored(id) => id,
        Suggested::TooMany(most) => panic!("refused with {most} waiting"),
    }
}

#[test]
fn each_inbound_message_has_the_class_of_the_first_rule_that_matches() {
    let mut mail = Mail::new();
    let (inbox, sent) = (mail.inbox, mail.sent);
    let mine = mail.add(sent, PERSON, &["To: friend@example.org"]);
    let friend = mail.add(inbox, "Friend <friend@example.org>", &[]);
    let news = mail.add(inbox, "news@example.net", &["List-Id: <news.example.net>"]);
    let robot = mail.add(
        inbox,
        "robot@example.net",
        &["Auto-Submitted: auto-generated"],
    );
    let stranger = mail.add(inbox, "stranger@example.biz", &[]);
    assert_eq!(mail.class(mine), None, "the person's own mail has no class");
    assert_eq!(mail.class(friend).as_deref(), Some("known"));
    assert_eq!(mail.class(news).as_deref(), Some("bulk"));
    assert_eq!(mail.class(robot).as_deref(), Some("bulk"));
    assert_eq!(mail.class(stranger).as_deref(), Some("unknown"));

    // Out comes before everything, in before bulk.
    let decided = mail.decide("stranger@example.biz", Some(Decision::Out));
    assert_eq!(
        decided,
        Decided {
            previous: None,
            changed: 1
        }
    );
    assert_eq!(mail.class(stranger).as_deref(), Some("blocked"));
    mail.decide("friend@example.org", Some(Decision::Out));
    assert_eq!(mail.class(friend).as_deref(), Some("blocked"));
    mail.decide("news@example.net", Some(Decision::In));
    assert_eq!(mail.class(news).as_deref(), Some("known"));
    mail.assert_as_from_nothing();

    // Taken back, each class is the rules' again.
    let undone = mail.decide("stranger@example.biz", None);
    assert_eq!(undone.previous, Some(Decision::Out));
    assert_eq!(mail.class(stranger).as_deref(), Some("unknown"));
    mail.decide("friend@example.org", None);
    assert_eq!(mail.class(friend).as_deref(), Some("known"));
    // The same decision again changes nothing.
    assert_eq!(
        mail.decide("news@example.net", Some(Decision::In)).changed,
        0
    );
    mail.assert_as_from_nothing();
}

#[test]
fn a_template_seen_a_fifth_time_makes_the_four_before_it_bulk() {
    let mut mail = Mail::new();
    let inbox = mail.inbox;
    let early: Vec<MessageId> = (0..4)
        .map(|_| mail.add_whole(inbox, "promo@shop.example", &[]))
        .collect();
    for message in &early {
        assert_eq!(mail.class(*message).as_deref(), Some("unknown"));
    }
    let counted = table(&mail.store, "SELECT messages FROM template");
    assert_eq!(counted, [vec![Value::Integer(4)]]);
    let fifth = mail.add_whole(inbox, "promo@shop.example", &[]);
    for message in early.iter().chain([&fifth]) {
        assert_eq!(mail.class(*message).as_deref(), Some("bulk"));
    }
    // Headers alone have no template yet: the next is unknown until its
    // body is held.
    let headers_only = mail.add(inbox, "promo@shop.example", &[]);
    assert_eq!(mail.class(headers_only).as_deref(), Some("unknown"));
    mail.assert_as_from_nothing();
}

#[test]
fn writing_to_a_stranger_makes_its_earlier_mail_known() {
    let mut mail = Mail::new();
    let (inbox, sent) = (mail.inbox, mail.sent);
    let first = mail.add(inbox, "bob@example.org", &[]);
    assert_eq!(mail.class(first).as_deref(), Some("unknown"));
    mail.add(sent, PERSON, &["To: bob@example.org"]);
    assert_eq!(mail.class(first).as_deref(), Some("known"));
    let later = mail.add(inbox, "bob@example.org", &[]);
    assert_eq!(mail.class(later).as_deref(), Some("known"));
    mail.assert_as_from_nothing();
}

#[test]
fn a_mailbox_that_becomes_a_sent_mailbox_classes_its_correspondents_again() {
    let mut mail = Mail::new();
    let (inbox, archive) = (mail.inbox, mail.archive);
    let carol = mail.add(archive, "carol@example.net", &["To: dan@example.org"]);
    let dan = mail.add(inbox, "dan@example.org", &[]);
    assert_eq!(mail.class(carol).as_deref(), Some("unknown"));
    assert_eq!(mail.class(dan).as_deref(), Some("unknown"));
    mail.store
        .upsert_mailbox(
            mail.account,
            &MailboxSeen {
                provider_key: "Archive",
                name: "Archive",
                role: Role::Sent,
            },
            NOW,
        )
        .unwrap();
    // The archive's message is the person's: its sender is theirs, and the
    // one it went to is someone they wrote to.
    assert_eq!(mail.class(carol), None);
    assert_eq!(mail.class(dan).as_deref(), Some("known"));
    mail.assert_as_from_nothing();
}

#[test]
fn an_account_added_later_makes_its_address_the_person_s() {
    let mut mail = Mail::new();
    let message = mail.add(mail.inbox, "second@example.org", &[]);
    assert_eq!(mail.class(message).as_deref(), Some("unknown"));
    mail.store
        .add_account("icloud", "second@example.org", NOW)
        .unwrap();
    assert_eq!(mail.class(message), None);
    mail.assert_as_from_nothing();
}

#[test]
fn an_address_the_person_says_is_theirs_has_no_class_and_no_sender_row() {
    let mut mail = Mail::new();
    let inbox = mail.inbox;
    let message = mail.add(inbox, "alias@example.net", &[]);
    assert!(
        mail.store
            .sender(sender_id("alias@example.net"))
            .unwrap()
            .is_some()
    );
    let decided = mail.decide("alias@example.net", Some(Decision::Mine));
    assert_eq!(decided.changed, 1);
    assert_eq!(mail.class(message), None);
    assert!(
        mail.store
            .sender(sender_id("alias@example.net"))
            .unwrap()
            .is_none()
    );
    assert!(mail.store.is_own("alias@example.net").unwrap());
    assert!(!mail.store.is_own_by_mail("alias@example.net").unwrap());
    assert!(mail.store.is_own_by_mail(PERSON).unwrap());
    // Found by its id, though it has no sender row.
    let found = mail
        .store
        .decision_by_sender(sender_id("alias@example.net"))
        .unwrap()
        .unwrap();
    assert_eq!(found.decision, Decision::Mine);
    // Its later mail has no class either.
    let later = mail.add(inbox, "alias@example.net", &[]);
    assert_eq!(mail.class(later), None);
    mail.assert_as_from_nothing();

    let undone = mail.decide("alias@example.net", None);
    assert_eq!(undone.previous, Some(Decision::Mine));
    assert_eq!(mail.class(message).as_deref(), Some("unknown"));
    assert!(
        mail.store
            .sender(sender_id("alias@example.net"))
            .unwrap()
            .is_some()
    );
    mail.assert_as_from_nothing();
}

#[test]
fn a_rebuild_gives_the_same_classes_and_keeps_every_decision() {
    let mut mail = Mail::new();
    let (inbox, sent) = (mail.inbox, mail.sent);
    // A reply recorded before what it answers, which comes batches later,
    // and a template whose fifth message is in a later batch.
    mail.add(sent, PERSON, &["To: late@example.org"]);
    for number in 0..250 {
        mail.add(inbox, &format!("s{}@example.org", number % 40), &[]);
        if number % 60 == 0 {
            mail.add_whole(inbox, "promo@shop.example", &[]);
        }
    }
    mail.add(inbox, "late@example.org", &[]);
    mail.decide("s1@example.org", Some(Decision::Out));
    mail.decide("s2@example.org", Some(Decision::In));
    mail.decide("s3@example.org", Some(Decision::Mine));
    stored(
        mail.store
            .suggest("s4@example.org", Decision::Out, &agent("a"), 20, NOW)
            .unwrap(),
    );
    mail.assert_as_from_nothing();
    let classes = |mail: &Mail| {
        table(
            &mail.store,
            "SELECT class, count(*) FROM screening GROUP BY class ORDER BY class",
        )
    };
    assert_eq!(
        classes(&mail),
        [
            vec![Value::Text("blocked".into()), Value::Integer(7)],
            vec![Value::Text("bulk".into()), Value::Integer(5)],
            vec![Value::Text("known".into()), Value::Integer(8)],
            vec![Value::Text("unknown".into()), Value::Integer(229)],
        ]
    );
    let (derived, kept) = (mail.derived(), mail.kept());
    mail.store.rebuild(NOW, |_| {}).unwrap();
    assert_eq!(mail.derived(), derived);
    assert_eq!(mail.kept(), kept);
}

#[test]
fn a_store_that_held_mail_before_classes_is_classed_when_opened() {
    let directory = tempfile::tempdir().unwrap();
    let home = Home::at(directory.path().join("data"));
    {
        // Version 7 wrote these rows; it had no classes.
        let store = Store::open_with(&home, &schema::MIGRATIONS[..7]).unwrap();
        store
            .connection
            .execute_batch(
                "INSERT INTO account (id, provider, address, created_at)
                     VALUES (1, 'icloud', 'person@example.com', 0);
                 INSERT INTO mailbox (id, account_id, provider_key, name, role, header_only)
                     VALUES (1, 1, 'INBOX', 'INBOX', 'inbox', 0);
                 INSERT INTO message (id, header_hash, reported_size, first_seen_at)
                     VALUES (1, zeroblob(32), 10, 0), (2, randomblob(32), 10, 0);
                 INSERT INTO observation (message_id, mailbox_id, validity, provider_id, flags,
                                          seen_at)
                     VALUES (1, 1, '', '1', '[]', 0), (2, 1, '', '2', '[]', 0);
                 INSERT INTO envelope (message_id, parser, thread_id, date, sender_address,
                                       sender_name, subject, list_id)
                     VALUES (1, 3, 1, 0, 'news@example.net', '', 'n', 'news.example.net'),
                            (2, 3, 2, 0, 'person@example.com', '', 'p', '');",
            )
            .unwrap();
    }
    let store = Store::open(&home).unwrap();
    assert_eq!(
        store.schema_version().unwrap(),
        u32::try_from(schema::MIGRATIONS.len()).unwrap()
    );
    let classes = table(&store, "SELECT message_id, class FROM screening");
    assert_eq!(
        classes,
        [vec![Value::Integer(1), Value::Text("bulk".into())]],
        "the person's own message has no class"
    );
    let marks = table(
        &store,
        "SELECT count(*) FROM engine_state WHERE key = 'screening-fill'",
    );
    assert_eq!(marks, [vec![Value::Integer(0)]]);
}

#[test]
fn screening_waits_while_messages_wait_to_be_derived_again() {
    let mut mail = Mail::new();
    mail.add(mail.inbox, "bob@example.org", &[]);
    assert!(mail.store.screening_readiness().unwrap().ready());
    mail.store
        .connection
        .execute("UPDATE envelope SET parser = 2", [])
        .unwrap();
    let waiting = mail.store.screening_readiness().unwrap();
    assert_eq!(
        waiting,
        Readiness {
            stale: 1,
            rebuilding: false
        }
    );
    assert!(!waiting.ready());
    while mail.store.rederive_stale(200, NOW).unwrap() > 0 {}
    assert!(mail.store.screening_readiness().unwrap().ready());
    mail.store.rebuild_begin().unwrap();
    assert!(mail.store.screening_readiness().unwrap().rebuilding);
}

#[test]
fn a_suggestion_changes_no_class_until_the_person_accepts_it() {
    let mut mail = Mail::new();
    let inbox = mail.inbox;
    let messages: Vec<MessageId> = (0..3)
        .map(|_| mail.add(inbox, "stranger@example.biz", &[]))
        .collect();
    let first = stored(
        mail.store
            .suggest("stranger@example.biz", Decision::Out, &agent("a"), 20, NOW)
            .unwrap(),
    );
    assert_eq!(mail.class(messages[0]).as_deref(), Some("unknown"));
    // Suggesting again replaces the proposer's own earlier suggestion.
    let second = stored(
        mail.store
            .suggest("stranger@example.biz", Decision::Out, &agent("a"), 20, NOW)
            .unwrap(),
    );
    let replaced = mail.store.suggestion(first).unwrap().unwrap();
    assert_eq!(replaced.state, SuggestionState::Superseded);
    assert_eq!(replaced.closed_at, Some(NOW));
    let open = mail.store.open_suggestions("stranger@example.biz").unwrap();
    assert_eq!(open.iter().map(|row| row.id).collect::<Vec<_>>(), [second]);
    assert_eq!(open[0].proposer, agent("a"));
    assert_eq!(open[0].sender, sender_id("stranger@example.biz"));
    assert_eq!(mail.store.open_suggestion_count().unwrap(), 1);
    assert_eq!(
        mail.store
            .would_change("stranger@example.biz", Decision::Out)
            .unwrap(),
        3
    );

    let (row, decided) = mail.store.accept(second, NOW).unwrap().unwrap();
    assert_eq!(row.decision, Decision::Out);
    assert_eq!(
        decided,
        Decided {
            previous: None,
            changed: 3
        }
    );
    for message in &messages {
        assert_eq!(mail.class(*message).as_deref(), Some("blocked"));
    }
    let decision = mail
        .store
        .decision("stranger@example.biz")
        .unwrap()
        .unwrap();
    assert_eq!(decision.suggestion, Some(second));
    assert_eq!(
        mail.store.suggestion(second).unwrap().unwrap().state,
        SuggestionState::Accepted
    );
    assert!(mail.store.accept(second, NOW).unwrap().is_none(), "once");
    let (blocked, total) = mail.store.blocked_since(NOW - DAY, 20).unwrap();
    assert_eq!((blocked.len(), total), (1, 1));
    assert_eq!(blocked[0].1.as_ref().map(|row| row.id), Some(second));
    assert!(mail.store.blocked_since(NOW + 1, 20).unwrap().0.is_empty());
    mail.assert_as_from_nothing();
}

#[test]
fn the_person_s_own_decision_supersedes_what_waits_and_a_dismissal_closes_one() {
    let mut mail = Mail::new();
    mail.add(mail.inbox, "stranger@example.biz", &[]);
    mail.add(mail.inbox, "other@example.biz", &[]);
    let a = stored(
        mail.store
            .suggest("stranger@example.biz", Decision::In, &agent("a"), 20, NOW)
            .unwrap(),
    );
    let b = stored(
        mail.store
            .suggest("stranger@example.biz", Decision::Out, &agent("b"), 20, NOW)
            .unwrap(),
    );
    mail.decide("stranger@example.biz", Some(Decision::Out));
    for id in [a, b] {
        assert_eq!(
            mail.store.suggestion(id).unwrap().unwrap().state,
            SuggestionState::Superseded
        );
    }
    let decision = mail
        .store
        .decision("stranger@example.biz")
        .unwrap()
        .unwrap();
    assert_eq!(decision.suggestion, None, "the person's, not an agent's");
    let (blocked, _) = mail.store.blocked_since(0, 20).unwrap();
    assert!(blocked[0].1.is_none());

    let c = stored(
        mail.store
            .suggest("other@example.biz", Decision::Out, &agent("a"), 20, NOW)
            .unwrap(),
    );
    assert!(mail.store.dismiss(c, NOW).unwrap());
    assert!(!mail.store.dismiss(c, NOW).unwrap(), "already closed");
    assert_eq!(
        mail.store.suggestion(c).unwrap().unwrap().state,
        SuggestionState::Dismissed
    );
    assert_eq!(mail.store.open_suggestion_count().unwrap(), 0);
}

#[test]
fn a_caller_may_have_twenty_suggestions_waiting() {
    let mut mail = Mail::new();
    let inbox = mail.inbox;
    for number in 0..21 {
        mail.add(inbox, &format!("s{number}@example.org"), &[]);
    }
    for number in 0..20 {
        stored(
            mail.store
                .suggest(
                    &format!("s{number}@example.org"),
                    Decision::Out,
                    &agent("a"),
                    20,
                    NOW,
                )
                .unwrap(),
        );
    }
    let refused = mail
        .store
        .suggest("s20@example.org", Decision::Out, &agent("a"), 20, NOW)
        .unwrap();
    assert_eq!(refused, Suggested::TooMany(20));
    // Suggesting again on one it has waiting does not count twice.
    stored(
        mail.store
            .suggest("s0@example.org", Decision::In, &agent("a"), 20, NOW)
            .unwrap(),
    );
    // Another caller has its own twenty, and stdio's caller, with no id,
    // is a caller of its own.
    stored(
        mail.store
            .suggest("s20@example.org", Decision::Out, &agent("b"), 20, NOW)
            .unwrap(),
    );
    let stdio = Proposer {
        kind: "agent".to_string(),
        id: None,
    };
    stored(
        mail.store
            .suggest("s20@example.org", Decision::Out, &stdio, 20, NOW)
            .unwrap(),
    );
}

#[test]
fn every_screening_query_reads_an_index() {
    let mail = Mail::new();
    mail.store
        .connection
        .execute_batch(
            "CREATE TEMP TABLE IF NOT EXISTS screening_own (address TEXT PRIMARY KEY) WITHOUT ROWID;
             CREATE TEMP TABLE IF NOT EXISTS screening_target (message_id INTEGER PRIMARY KEY);",
        )
        .unwrap();
    for (name, sql) in classes::every_query() {
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
            // The temporary tables are a batch's own few rows; the senders
            // are read in the order of a page, a few thousand at most.
            assert!(
                line.starts_with("SCAN screening_target")
                    || line.starts_with("SCAN screening_own")
                    || (name == "waiting senders"
                        && line.starts_with("SCAN sender USING INDEX sender_recent")),
                "{name}:\n{plan}"
            );
        }
        let expected = match name {
            "by sender" | "by sender, removed" => "INDEX envelope_sender (sender_address=?)",
            "by template" | "by template, removed" | "recount" => {
                "envelope_template (template_key=?)"
            }
            "by target" | "by target, removed" => "SEARCH envelope USING INTEGER PRIMARY KEY",
            "class counts" | "would change" => "COVERING INDEX screening_sender (sender_address=?)",
            "queue" | "class list" => "INDEX screening_listed (class=?",
            "relist target" => "SEARCH screening USING INTEGER PRIMARY KEY",
            "relist mailbox" => "COVERING INDEX observation_mailbox (mailbox_id=?)",
            "waiting senders" => {
                "COVERING INDEX screening_sender (sender_address=? AND class=? AND listed=?)"
            }
            "blocked since" => "INDEX sender_decision_at (decision=? AND decided_at>?)",
            other => panic!("no plan expected for {other}"),
        };
        assert!(plan.contains(expected), "{name}:\n{plan}");
    }
}

#[test]
fn a_message_is_listed_while_a_mailbox_other_than_junk_and_trash_shows_it() {
    let mut mail = Mail::new();
    let (inbox, archive) = (mail.inbox, mail.archive);
    let trash = mail.mailbox("Deleted Messages", Role::Trash);
    let (moved, seen) = mail.add_seen(inbox, "bob@example.org", &[]);
    let kept = mail.add(archive, "carol@example.org", &[]);
    assert_eq!(mail.listed(moved), Some(true));
    // Moved to the trash: still classed, no longer listed.
    mail.store.record_removed(inbox, "", &["1"], NOW).unwrap();
    let mut again = seen.clone();
    again.provider_id = "t1".to_string();
    mail.store
        .record_headers(trash, "", std::slice::from_ref(&again), NOW)
        .unwrap();
    assert_eq!(mail.class(moved).as_deref(), Some("unknown"));
    assert_eq!(mail.listed(moved), Some(false));
    let (messages, senders) = mail.store.queue_counts().unwrap();
    assert_eq!((messages, senders), (1, 1));
    mail.assert_as_from_nothing();
    // Brought back.
    again.provider_id = "i1".to_string();
    mail.store
        .record_headers(inbox, "", std::slice::from_ref(&again), NOW)
        .unwrap();
    assert_eq!(mail.listed(moved), Some(true));
    mail.assert_as_from_nothing();

    // A mailbox that becomes trash, or a new generation that closes what
    // it showed, takes its messages out of the lists.
    let archive_role = |mail: &mut Mail, role| {
        mail.store
            .upsert_mailbox(
                mail.account,
                &MailboxSeen {
                    provider_key: "Archive",
                    name: "Archive",
                    role,
                },
                NOW,
            )
            .unwrap();
    };
    archive_role(&mut mail, Role::Trash);
    assert_eq!(mail.listed(kept), Some(false));
    mail.assert_as_from_nothing();
    archive_role(&mut mail, Role::Archive);
    assert_eq!(mail.listed(kept), Some(true));
    mail.store.set_validity(archive, "2", NOW).unwrap();
    assert_eq!(mail.listed(kept), Some(false));
    mail.assert_as_from_nothing();
    mail.store.retire_mailbox(inbox, NOW).unwrap();
    assert_eq!(mail.listed(moved), Some(false));
    mail.assert_as_from_nothing();
}

#[test]
fn a_template_that_falls_below_five_leaves_its_messages_unknown() {
    let mut mail = Mail::new();
    let inbox = mail.inbox;
    let messages: Vec<MessageId> = (0..5)
        .map(|_| mail.add_whole(inbox, "promo@shop.example", &[]))
        .collect();
    assert_eq!(mail.class(messages[0]).as_deref(), Some("bulk"));
    // A derivation that reads one message's template otherwise, as a new
    // version of it may.
    let old: Vec<u8> = mail
        .store
        .connection
        .query_row(
            "SELECT template_key FROM envelope WHERE message_id = ?1",
            [messages[4].0],
            |row| row.get(0),
        )
        .unwrap();
    let new = vec![7_u8; 16];
    let transaction = mail.store.connection.transaction().unwrap();
    transaction
        .execute(
            "UPDATE envelope SET template_key = ?2 WHERE message_id = ?1",
            rusqlite::params![messages[4].0, new],
        )
        .unwrap();
    classes::settle(
        &transaction,
        &classes::Reclassify {
            messages: Some(&std::collections::BTreeSet::from([messages[4].0])),
            templates: Some(&std::collections::BTreeSet::from([old, new])),
            ..Default::default()
        },
        NOW,
    )
    .unwrap();
    transaction.commit().unwrap();
    for message in &messages {
        assert_eq!(mail.class(*message).as_deref(), Some("unknown"));
    }
    mail.assert_as_from_nothing();
}
