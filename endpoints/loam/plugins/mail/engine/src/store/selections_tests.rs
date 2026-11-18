//! Selections in the store (the specification's 9.1): what a query freezes,
//! what it leaves out, and how long it is kept.

#![allow(clippy::expect_used, clippy::unwrap_used)]

use super::test_mail::{BASE, DAY, Mail, NOW, header};
use super::*;

fn agent(id: &str) -> Proposer {
    Proposer {
        kind: "agent".to_string(),
        id: Some(id.to_string()),
    }
}

impl Mail {
    fn select(&mut self, query: &SelectionQuery) -> SelectionRow {
        self.select_as(query, &agent("a"), NOW)
    }

    fn select_as(&mut self, query: &SelectionQuery, creator: &Proposer, now: i64) -> SelectionRow {
        match self.store.select(query, "{}", creator, now).unwrap() {
            Selected::Made(row) => row,
            Selected::TooMany(most) => panic!("refused at {most}"),
            Selected::Unreadable => panic!("the text is unreadable"),
        }
    }

    /// The messages a selection froze, as (message, mailbox).
    fn places(&self, selection: &SelectionRow) -> Vec<(i64, i64)> {
        let mut places: Vec<(i64, i64)> = self
            .store
            .selection_items(selection.id)
            .unwrap()
            .into_iter()
            .filter_map(|item| Some((item.message?, item.mailbox)))
            .collect();
        places.sort_unstable();
        places
    }

    /// Records `seen` in `mailbox` too, as the same message.
    fn show_in(&mut self, mailbox: MailboxId, seen: &HeaderSeen) {
        self.store
            .record_headers(mailbox, "", std::slice::from_ref(seen), NOW)
            .unwrap();
    }
}

fn of_mailbox(mailbox: MailboxId) -> SelectionQuery {
    SelectionQuery {
        mailbox: Some(mailbox),
        ..SelectionQuery::default()
    }
}

#[test]
fn a_selection_freezes_what_it_found_and_nothing_that_came_after() {
    let mut mail = Mail::new();
    let first = mail.add(mail.inbox, "a@example.org", &[]);
    let second = mail.add(mail.inbox, "a@example.org", &[]);
    let reply = mail.add(
        mail.inbox,
        "b@example.org",
        &["In-Reply-To: <m2@example.com>"],
    );
    mail.add(mail.archive, "a@example.org", &[]);
    let inbox = mail.inbox;
    let selection = mail.select(&of_mailbox(inbox));
    assert_eq!(
        (selection.messages, selection.threads, selection.unreturned),
        (3, 2, 0),
        "a reply joins its thread"
    );
    assert_eq!(selection.count(), 3);
    assert_eq!(selection.expires_at, NOW + SELECTION_LIFETIME);
    let frozen = mail.places(&selection);
    assert_eq!(
        frozen,
        [first, second, reply].map(|message| (message.0, inbox.0))
    );
    // Mail that arrives after, even matching the query, is not in it.
    mail.add(mail.inbox, "a@example.org", &[]);
    assert_eq!(mail.places(&selection), frozen);
    assert_eq!(
        mail.store
            .selection(selection.id)
            .unwrap()
            .unwrap()
            .messages,
        3
    );
    // The sample is the newest first.
    let sample = mail.store.selection_sample(selection.id, 2).unwrap();
    let sampled: Vec<MessageId> = sample.iter().map(|listed| listed.message).collect();
    assert_eq!(sampled, [reply, second]);
}

#[test]
fn junk_and_trash_are_selected_only_by_name() {
    let mut mail = Mail::new();
    let junk = mail.mailbox("Junk", Role::Junk);
    let trash = mail.mailbox("Deleted Messages", Role::Trash);
    let (kept, seen) = mail.add_seen(mail.inbox, "a@example.org", &[]);
    mail.show_in(trash, &seen);
    let spam = mail.add(junk, "a@example.org", &[]);
    let by_sender = SelectionQuery {
        sender: Some("a@example.org".to_string()),
        ..SelectionQuery::default()
    };
    let selection = mail.select(&by_sender);
    assert_eq!(mail.places(&selection), [(kept.0, mail.inbox.0)]);
    let in_trash = mail.select(&SelectionQuery {
        mailbox: Some(trash),
        ..by_sender.clone()
    });
    assert_eq!(mail.places(&in_trash), [(kept.0, trash.0)]);
    let in_junk = mail.select(&of_mailbox(junk));
    assert_eq!(mail.places(&in_junk), [(spam.0, junk.0)]);
}

#[test]
fn a_message_two_mailboxes_show_is_one_message_in_two_places() {
    let mut mail = Mail::new();
    let (message, seen) = mail.add_seen(mail.inbox, "a@example.org", &[]);
    let archive = mail.archive;
    mail.show_in(archive, &seen);
    let selection = mail.select(&SelectionQuery {
        account: Some(mail.account),
        ..SelectionQuery::default()
    });
    assert_eq!((selection.messages, selection.threads), (1, 1));
    assert_eq!(
        mail.places(&selection),
        [(message.0, mail.inbox.0), (message.0, archive.0)]
    );
}

#[test]
fn each_field_narrows_the_selection() {
    let mut mail = Mail::new();
    let friend = mail.add(mail.inbox, "friend@example.org", &[]);
    mail.decide("friend@example.org", Some(Decision::In));
    let stranger = mail.add(mail.inbox, "stranger@example.biz", &[]);
    let mut read = header(50, "stranger@example.biz", &[]);
    read.flags = vec!["\\Seen".to_string()];
    mail.show_in(mail.inbox, &read);
    let read = mail
        .store
        .find_message(&read.header_block, read.reported_size)
        .unwrap()
        .unwrap();
    let only = |mail: &mut Mail, query: SelectionQuery| -> Vec<i64> {
        let selection = mail.select(&query);
        mail.places(&selection)
            .into_iter()
            .map(|(message, _)| message)
            .collect()
    };
    let sender = SelectionQuery {
        sender: Some("stranger@example.biz".to_string()),
        ..SelectionQuery::default()
    };
    assert_eq!(only(&mut mail, sender.clone()), [stranger.0, read.0]);
    let known = SelectionQuery {
        class: Some(Class::Known),
        ..SelectionQuery::default()
    };
    assert_eq!(only(&mut mail, known), [friend.0]);
    let unread = SelectionQuery {
        unread: Some(true),
        ..sender.clone()
    };
    assert_eq!(only(&mut mail, unread), [stranger.0]);
    let seen = SelectionQuery {
        unread: Some(false),
        ..sender.clone()
    };
    assert_eq!(only(&mut mail, seen), [read.0]);
    // Message 2 is dated a day after message 1; message 50 long after.
    let dated = SelectionQuery {
        after: Some(BASE + 2 * DAY),
        before: Some(BASE + 3 * DAY),
        ..SelectionQuery::default()
    };
    assert_eq!(only(&mut mail, dated), [stranger.0]);
    let elsewhere = SelectionQuery {
        account: Some(AccountId(mail.account.0 + 1)),
        ..sender
    };
    assert!(only(&mut mail, elsewhere).is_empty());
}

#[test]
fn text_selects_every_match_not_only_a_search_page() {
    let mut mail = Mail::new();
    // More than a search's 1 000 hits, and one that does not match, in a
    // batch each as sync records them.
    let seen: Vec<HeaderSeen> = (100..1_106)
        .map(|number| header(number, "news@example.net", &[]))
        .collect();
    mail.store
        .record_headers(mail.inbox, "", &seen, NOW)
        .unwrap();
    let mut messages = Vec::new();
    let mut wholes = Vec::new();
    for (index, seen) in seen.iter().enumerate() {
        let message = mail
            .store
            .find_message(&seen.header_block, seen.reported_size)
            .unwrap()
            .unwrap();
        let body: &[u8] = if index == 0 {
            b"Something else.\r\n"
        } else {
            b"The quarterly report.\r\n"
        };
        messages.push(message);
        wholes.push([seen.header_block.as_slice(), body].concat());
    }
    let parts: Vec<PartSeen<'_>> = messages
        .iter()
        .zip(&wholes)
        .map(|(message, bytes)| PartSeen {
            message: *message,
            place: Place::Whole,
            bytes,
        })
        .collect();
    mail.store.record_parts(&parts, NOW).unwrap();
    let wanted: Vec<i64> = messages[1..].iter().map(|message| message.0).collect();
    let selection = mail.select(&SelectionQuery {
        text: Some("quarterly".to_string()),
        ..SelectionQuery::default()
    });
    let found: Vec<i64> = mail
        .places(&selection)
        .into_iter()
        .map(|(message, _)| message)
        .collect();
    assert_eq!(found, wanted);
    // Every word must match, and what cannot be read is refused rather than
    // searched for less.
    let both = mail.select(&SelectionQuery {
        text: Some("quarterly else".to_string()),
        ..SelectionQuery::default()
    });
    assert_eq!(both.messages, 0);
    let one = mail.select(&SelectionQuery {
        text: Some("something else".to_string()),
        ..SelectionQuery::default()
    });
    assert_eq!(mail.places(&one), [(messages[0].0, mail.inbox.0)]);
    assert_eq!(
        mail.store
            .select(
                &SelectionQuery {
                    text: Some("subject:(".to_string()),
                    ..SelectionQuery::default()
                },
                "{}",
                &agent("a"),
                NOW
            )
            .unwrap(),
        Selected::Unreadable
    );
}

#[test]
fn a_whole_mailbox_holds_its_unreturned_messages_counted_apart() {
    let mut mail = Mail::new();
    let inbox = mail.inbox;
    mail.add(inbox, "a@example.org", &[]);
    // Listed and never returned, tried enough times to count as such; and
    // one tried once, still awaited.
    for _ in 0..UNRETURNED_AFTER_TRIES {
        mail.store
            .record_not_returned(inbox, "", &["900"], NOW)
            .unwrap();
    }
    mail.store
        .record_not_returned(inbox, "", &["901"], NOW)
        .unwrap();
    let whole = mail.select(&of_mailbox(inbox));
    assert_eq!((whole.messages, whole.unreturned, whole.count()), (1, 1, 2));
    let unreturned: Vec<SelectionItem> = mail
        .store
        .selection_items(whole.id)
        .unwrap()
        .into_iter()
        .filter(|item| item.message.is_none())
        .collect();
    assert_eq!(
        unreturned,
        [SelectionItem {
            mailbox: inbox.0,
            validity: String::new(),
            provider_id: "900".to_string(),
            message: None,
        }]
    );
    // With any other field it is not the whole mailbox.
    let unread = mail.select(&SelectionQuery {
        unread: Some(true),
        ..of_mailbox(inbox)
    });
    assert_eq!((unread.messages, unread.unreturned), (1, 0));
    let account = mail.account;
    let with_account = mail.select(&SelectionQuery {
        account: Some(account),
        ..of_mailbox(inbox)
    });
    assert_eq!(with_account.unreturned, 1);
    // An account that does not hold the mailbox names none of its mail.
    let elsewhere = mail.select(&SelectionQuery {
        account: Some(AccountId(account.0 + 1)),
        ..of_mailbox(inbox)
    });
    assert_eq!(elsewhere.count(), 0);
}

#[test]
fn two_copies_of_a_message_in_a_mailbox_are_two_items_and_one_message() {
    let mut mail = Mail::new();
    let (message, seen) = mail.add_seen(mail.inbox, "a@example.org", &[]);
    // The same bytes under another id: copied into its own mailbox.
    let copy = HeaderSeen {
        provider_id: "copy".to_string(),
        ..seen
    };
    let inbox = mail.inbox;
    mail.show_in(inbox, &copy);
    let selection = mail.select(&of_mailbox(inbox));
    assert_eq!((selection.messages, selection.count()), (1, 1));
    let ids: Vec<(Option<i64>, String)> = mail
        .store
        .selection_items(selection.id)
        .unwrap()
        .into_iter()
        .map(|item| (item.message, item.provider_id))
        .collect();
    assert_eq!(
        ids,
        [
            (Some(message.0), "1".to_string()),
            (Some(message.0), "copy".to_string())
        ]
    );
}

#[test]
fn each_caller_holds_a_few_until_they_expire() {
    let mut mail = Mail::new();
    let inbox = mail.inbox;
    mail.add(inbox, "a@example.org", &[]);
    let query = of_mailbox(inbox);
    let first = mail.select_as(&query, &agent("a"), NOW);
    for _ in 1..MOST_SELECTIONS {
        mail.select_as(&query, &agent("a"), NOW + 1);
    }
    assert_eq!(
        mail.store
            .select(&query, "{}", &agent("a"), NOW + 2)
            .unwrap(),
        Selected::TooMany(MOST_SELECTIONS)
    );
    // Another caller is not held back.
    mail.select_as(&query, &agent("b"), NOW + 2);
    // Callers with no id are held by their kind.
    let script = Proposer {
        kind: "script".to_string(),
        id: None,
    };
    for _ in 0..MOST_SELECTIONS {
        mail.select_as(&query, &script, NOW + 2);
    }
    assert_eq!(
        mail.store.select(&query, "{}", &script, NOW + 2).unwrap(),
        Selected::TooMany(MOST_SELECTIONS)
    );
    let person = Proposer {
        kind: "human".to_string(),
        id: None,
    };
    mail.select_as(&query, &person, NOW + 2);
    // An hour on, the first has expired: it goes, and makes room.
    let later = NOW + SELECTION_LIFETIME;
    mail.select_as(&query, &agent("a"), later);
    assert!(mail.store.selection(first.id).unwrap().is_none());
    assert!(mail.places(&first).is_empty(), "its places go with it");
}

#[test]
fn a_rebuild_keeps_selections_and_removing_the_account_drops_them() {
    let mut mail = Mail::new();
    let inbox = mail.inbox;
    mail.add(inbox, "a@example.org", &[]);
    for _ in 0..UNRETURNED_AFTER_TRIES {
        mail.store
            .record_not_returned(inbox, "", &["900"], NOW)
            .unwrap();
    }
    let selection = mail.select(&of_mailbox(inbox));
    let frozen = mail.store.selection_items(selection.id).unwrap();
    assert_eq!(frozen.len(), 2);
    mail.store.rebuild(NOW, |_| {}).unwrap();
    assert_eq!(mail.store.selection_items(selection.id).unwrap(), frozen);
    let account = mail.account;
    mail.store.remove_account(account, NOW).unwrap();
    assert!(mail.store.selection(selection.id).unwrap().is_none());
    assert!(mail.store.selection_items(selection.id).unwrap().is_empty());
}

#[test]
fn the_policy_starts_as_the_person_agreed_and_keeps_what_they_set() {
    let mut mail = Mail::new();
    let row = mail.store.policy().unwrap();
    assert_eq!(row.policy, Policy::DEFAULT);
    assert_eq!(row.set_at, None);
    let stricter = Policy {
        change_per_call: 100,
        trash_per_call: 0,
        trash_per_day: 0,
        ask_above: 50,
    };
    assert_eq!(stricter.fault(), None);
    let before = mail.store.set_policy(&stricter, NOW).unwrap();
    assert_eq!(before.policy, Policy::DEFAULT);
    let mail = mail.reopen();
    let row = mail.store.policy().unwrap();
    assert_eq!((row.policy, row.set_at), (stricter, Some(NOW)));
}

#[test]
fn a_policy_past_what_a_call_can_finish_is_at_fault() {
    let ok = Policy::DEFAULT;
    for fault in [
        Policy {
            change_per_call: MOST_PER_CALL + 1,
            ..ok
        },
        Policy {
            trash_per_call: 300,
            ..ok
        },
        Policy {
            trash_per_day: MOST_PER_DAY + 1,
            ..ok
        },
        Policy {
            ask_above: MOST_ASK_ABOVE + 1,
            ..ok
        },
    ] {
        assert!(fault.fault().is_some(), "{fault:?}");
    }
}
