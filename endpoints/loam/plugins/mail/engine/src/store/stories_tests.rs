//! Tests of stream stories (the specification's section 8).

#![allow(clippy::expect_used, clippy::unwrap_used)]

use rusqlite::types::Value;

use super::test_mail::*;
use super::*;

const LIST: &str = "List-Id: News <news.example.net>";

impl Mail {
    /// Records `n` messages from `from` with `fields`, whole with `body`.
    fn add_many(
        &mut self,
        mailbox: MailboxId,
        from: &str,
        fields: &[&str],
        body: &str,
        n: usize,
    ) -> Vec<MessageId> {
        (0..n)
            .map(|_| self.add_body(mailbox, from, fields, body))
            .collect()
    }

    fn story(&self, id: i64) -> Option<StoryRow> {
        self.store.story(id).unwrap()
    }

    fn member_of(&self, message: MessageId) -> Option<i64> {
        self.store
            .connection
            .query_row(
                "SELECT story_id FROM story_member WHERE message_id = ?1",
                [message.0],
                |row| row.get(0),
            )
            .optional()
            .unwrap()
    }

    fn exception(&self, message: MessageId) -> bool {
        self.store
            .connection
            .query_row(
                "SELECT exception FROM story_member WHERE message_id = ?1",
                [message.0],
                |row| row.get(0),
            )
            .unwrap()
    }

    /// How many times `story` was noted as changed.
    fn noted(&self, story: i64) -> i64 {
        self.store
            .connection
            .query_row(
                "SELECT count(*) FROM change WHERE kind = 'story' AND subject = ?1",
                [story],
                |row| row.get(0),
            )
            .unwrap()
    }
}

#[test]
fn a_stream_is_a_story_from_its_fifth_bulk_message() {
    let mut mail = Mail::new();
    let inbox = mail.inbox;
    let story = list_story_id("news.example.net");
    let first = mail.add_many(inbox, "news@example.net", &[LIST], "Offers.\r\n", 4);
    assert_eq!(
        mail.member_of(first[0]),
        Some(story),
        "a member from the first"
    );
    assert_eq!(mail.story(story), None, "not a story at four");
    assert_eq!(mail.noted(story), 0);
    let fifth = mail.add_body(inbox, "news@example.net", &[LIST], "Offers.\r\n");
    let row = mail.story(story).expect("a story at five");
    assert_eq!(
        (row.kind.as_str(), row.list_id.as_str(), row.title.as_str()),
        ("stream", "news.example.net", "news.example.net")
    );
    assert_eq!((row.messages, row.exceptions, row.kinds), (5, 0, 1));
    assert_eq!(row.sender_address, "news@example.net");
    let dates: Vec<i64> = [first[0], fifth]
        .iter()
        .map(|message| mail.store.message_listed(*message).unwrap().unwrap().date)
        .collect();
    assert_eq!((row.first_date, row.last_date), (dates[0], dates[1]));
    // Made by the fifth message's headers, then changed by its body, which
    // gave it its shape and its kind.
    assert_eq!(mail.noted(story), 2);
    mail.assert_as_from_nothing();
}

#[test]
fn a_sender_with_no_list_is_its_own_stream_titled_by_its_name() {
    let mut mail = Mail::new();
    let inbox = mail.inbox;
    let bulk = "Precedence: bulk";
    mail.add_many(
        inbox,
        "Shop <deals@shop.example>",
        &[bulk],
        "Offers.\r\n",
        5,
    );
    // The same sender through a list is that list's.
    mail.add_many(
        inbox,
        "Shop <deals@shop.example>",
        &[LIST],
        "Offers.\r\n",
        5,
    );
    let by_sender = mail
        .story(sender_story_id("deals@shop.example"))
        .expect("a story of the sender");
    assert_eq!(
        (
            by_sender.title.as_str(),
            by_sender.list_id.as_str(),
            by_sender.messages
        ),
        ("Shop", "", 5)
    );
    assert_eq!(
        mail.story(list_story_id("news.example.net"))
            .unwrap()
            .messages,
        5
    );
    // With no name, the address.
    mail.add_many(inbox, "alerts@bank.example", &[bulk], "Alert.\r\n", 5);
    assert_eq!(
        mail.story(sender_story_id("alerts@bank.example"))
            .unwrap()
            .title,
        "alerts@bank.example"
    );
    assert_eq!(mail.store.story_count().unwrap(), 3);
    mail.assert_as_from_nothing();
}

#[test]
fn mail_that_is_not_bulk_is_in_no_story_and_a_decision_moves_it() {
    let mut mail = Mail::new();
    let (inbox, sent) = (mail.inbox, mail.sent);
    let story = list_story_id("news.example.net");
    let news = mail.add_many(inbox, "news@example.net", &[LIST], "Offers.\r\n", 6);
    let stranger = mail.add(inbox, "stranger@example.biz", &[]);
    assert_eq!(
        mail.member_of(stranger),
        None,
        "unknown mail is in no story"
    );
    assert_eq!(mail.story(story).unwrap().messages, 6);

    // Screened in, the sender's mail is the inbox's and leaves the story.
    let noted = mail.noted(story);
    mail.decide("news@example.net", Some(Decision::In));
    assert_eq!(mail.member_of(news[0]), None);
    assert_eq!(mail.story(story), None);
    assert_eq!(mail.noted(story), noted + 1, "its going is noted");
    mail.assert_as_from_nothing();

    // Taken back, it is a story again; blocked, it is none.
    mail.decide("news@example.net", None);
    assert_eq!(mail.story(story).unwrap().messages, 6);
    mail.decide("news@example.net", Some(Decision::Out));
    assert_eq!(mail.story(story), None);
    mail.decide("news@example.net", None);
    assert_eq!(mail.story(story).unwrap().messages, 6);

    // Written to, the sender is known.
    mail.add(sent, PERSON, &["To: news@example.net"]);
    assert_eq!(mail.story(story), None);
    mail.assert_as_from_nothing();
}

#[test]
fn a_message_moved_to_the_trash_leaves_its_story() {
    let mut mail = Mail::new();
    let inbox = mail.inbox;
    let trash = mail.mailbox("Deleted Messages", Role::Trash);
    let story = list_story_id("news.example.net");
    let (moved, seen) = mail.add_seen(inbox, "news@example.net", &[LIST]);
    for _ in 0..4 {
        mail.add(inbox, "news@example.net", &[LIST]);
    }
    assert_eq!(mail.story(story).unwrap().messages, 5);
    mail.store
        .record_removed(inbox, "", &[&seen.provider_id], NOW)
        .unwrap();
    let mut again = seen.clone();
    again.provider_id = "t1".to_string();
    mail.store
        .record_headers(trash, "", std::slice::from_ref(&again), NOW)
        .unwrap();
    assert_eq!(mail.member_of(moved), None, "the trash is not read as mail");
    assert_eq!(mail.story(story), None, "four are left");
    mail.assert_as_from_nothing();

    // Mail in a mailbox that becomes junk leaves its story too.
    let archive = mail.archive;
    mail.add(archive, "news@example.net", &[LIST]);
    mail.add(archive, "news@example.net", &[LIST]);
    assert_eq!(mail.story(story).unwrap().messages, 6);
    mail.store
        .upsert_mailbox(
            mail.account,
            &MailboxSeen {
                provider_key: "Archive",
                name: "Archive",
                role: Role::Junk,
            },
            NOW,
        )
        .unwrap();
    assert_eq!(mail.story(story), None);
    mail.assert_as_from_nothing();
}

#[test]
fn exceptions_are_the_messages_whose_body_shape_is_not_a_usual_one() {
    let mut mail = Mail::new();
    let inbox = mail.inbox;
    let story = list_story_id("news.example.net");
    let routine = mail.add_many(inbox, "news@example.net", &[LIST], "Offers.\r\n", 4);
    let odd = mail.add_body(inbox, "news@example.net", &[LIST], "> You wrote\r\n");
    // No shape is usual yet: nothing is routine to differ from.
    let row = mail.story(story).unwrap();
    assert_eq!((row.messages, row.exceptions), (5, 0));
    assert!(!mail.exception(odd));

    // The fifth routine one makes its shape usual, and the odd one an
    // exception.
    let noted = mail.noted(story);
    mail.add_body(inbox, "news@example.net", &[LIST], "Offers.\r\n");
    assert_eq!(mail.story(story).unwrap().exceptions, 1);
    assert!(mail.exception(odd));
    assert!(!mail.exception(routine[0]));
    // Its headers, then its body.
    assert_eq!(mail.noted(story), noted + 2);
    mail.assert_as_from_nothing();

    // A message whose body is not held has no shape, and is no exception.
    let headers = mail.add(inbox, "news@example.net", &[LIST]);
    assert!(!mail.exception(headers));
    assert_eq!(mail.story(story).unwrap().messages, 7);

    // Five odd ones make that shape usual too.
    for _ in 0..4 {
        mail.add_body(inbox, "news@example.net", &[LIST], "> You wrote\r\n");
    }
    assert_eq!(mail.story(story).unwrap().exceptions, 0);
    assert!(!mail.exception(odd));
    mail.assert_as_from_nothing();
}

#[test]
fn a_story_s_kinds_are_its_template_keys_with_a_count_each() {
    let mut mail = Mail::new();
    let inbox = mail.inbox;
    let story = list_story_id("news.example.net");
    let html = "Content-Type: text/html";
    mail.add_many(inbox, "news@example.net", &[LIST], "Offers.\r\n", 4);
    let receipts = mail.add_many(
        inbox,
        "news@example.net",
        &[LIST, html],
        "<p>Your receipt</p>\r\n",
        2,
    );
    let row = mail.story(story).unwrap();
    assert_eq!((row.messages, row.kinds), (6, 2));
    let kinds = mail.store.story_kinds(story, KINDS_SHOWN).unwrap();
    assert_eq!(
        kinds.iter().map(|kind| kind.messages).collect::<Vec<_>>(),
        [4, 2],
        "the most common first"
    );
    assert_eq!(kinds[1].newest, receipts[1]);
    assert_eq!(
        kinds[1].subject,
        mail.store
            .message_listed(receipts[1])
            .unwrap()
            .unwrap()
            .subject
    );
    let of_kind = mail
        .store
        .story_messages(story, &StoryMessages::Kind(kinds[1].key.clone()), None, 10)
        .unwrap();
    assert_eq!(
        of_kind
            .iter()
            .map(|item| item.listed.message)
            .collect::<Vec<_>>(),
        [receipts[1], receipts[0]],
        "newest first"
    );
    assert_eq!(mail.store.story_kinds(story, 1).unwrap().len(), 1);
    mail.assert_as_from_nothing();
}

#[test]
fn a_story_s_messages_are_read_newest_first_by_page() {
    let mut mail = Mail::new();
    let inbox = mail.inbox;
    let story = list_story_id("news.example.net");
    let news = mail.add_many(inbox, "news@example.net", &[LIST], "Offers.\r\n", 5);
    let odd = mail.add_body(inbox, "news@example.net", &[LIST], "> You wrote\r\n");
    let page = mail
        .store
        .story_messages(story, &StoryMessages::Every, None, 4)
        .unwrap();
    let ids: Vec<MessageId> = page.iter().map(|item| item.listed.message).collect();
    assert_eq!(ids, [odd, news[4], news[3], news[2]]);
    assert!(page[0].exception && !page[1].exception);
    let last = &page[3].listed;
    let rest = mail
        .store
        .story_messages(
            story,
            &StoryMessages::Every,
            Some((last.date, last.message)),
            4,
        )
        .unwrap();
    assert_eq!(
        rest.iter()
            .map(|item| item.listed.message)
            .collect::<Vec<_>>(),
        [news[1], news[0]]
    );
    let exceptions = mail
        .store
        .story_messages(story, &StoryMessages::Exceptions, None, 10)
        .unwrap();
    assert_eq!(exceptions.len(), 1);
    assert_eq!(exceptions[0].listed.message, odd);
    assert_eq!(
        mail.store.stories_of(&[news[0], odd]).unwrap().get(&odd),
        Some(&story)
    );
}

#[test]
fn stories_are_listed_newest_first_by_page() {
    let mut mail = Mail::new();
    let inbox = mail.inbox;
    let bulk = "Precedence: bulk";
    for sender in ["a@example.net", "b@example.net", "c@example.net"] {
        mail.add_many(inbox, sender, &[bulk], "Offers.\r\n", 5);
    }
    let page = mail.store.stories(None, 2).unwrap();
    assert_eq!(
        page.iter()
            .map(|row| row.sender_address.as_str())
            .collect::<Vec<_>>(),
        ["c@example.net", "b@example.net"]
    );
    let rest = mail
        .store
        .stories(Some((page[1].last_date, page[1].id)), 2)
        .unwrap();
    assert_eq!(rest.len(), 1);
    assert_eq!(rest[0].sender_address, "a@example.net");
}

#[test]
fn what_changed_is_each_story_once_after_a_cursor() {
    let mut mail = Mail::new();
    let inbox = mail.inbox;
    let bulk = "Precedence: bulk";
    let a = sender_story_id("a@example.net");
    let b = sender_story_id("b@example.net");
    mail.add_many(inbox, "a@example.net", &[bulk], "Offers.\r\n", 5);
    mail.add_many(inbox, "b@example.net", &[bulk], "Offers.\r\n", 5);
    let all = mail.store.story_changes(0, 100).unwrap();
    assert_eq!(
        all.changed
            .iter()
            .map(|(story, _)| *story)
            .collect::<Vec<_>>(),
        [a, b]
    );
    assert!(!all.reset);
    let cursor = all.last;
    assert_eq!(mail.store.story_changes(cursor, 100).unwrap().changed, []);

    // A changes again, then B: each once, in the order of their latest.
    mail.add_body(inbox, "a@example.net", &[bulk], "Offers.\r\n");
    mail.add_body(inbox, "b@example.net", &[bulk], "Offers.\r\n");
    mail.add_body(inbox, "a@example.net", &[bulk], "Offers.\r\n");
    let since = mail.store.story_changes(cursor, 100).unwrap();
    assert_eq!(
        since
            .changed
            .iter()
            .map(|(story, _)| *story)
            .collect::<Vec<_>>(),
        [b, a]
    );
    let first = mail.store.story_changes(cursor, 1).unwrap();
    assert_eq!(first.changed.len(), 1);
    let next = mail.store.story_changes(first.changed[0].1, 1).unwrap();
    assert_eq!(next.changed[0].0, a);

    // A rebuild derives every story again: a cursor from before it is
    // told so, as is one this store never gave.
    mail.store.rebuild(NOW, |_| {}).unwrap();
    assert!(mail.store.story_changes(since.last, 100).unwrap().reset);
    let after = mail.store.last_change().unwrap();
    assert!(!mail.store.story_changes(after, 100).unwrap().reset);
    assert!(mail.store.story_changes(after + 10, 100).unwrap().reset);
}

#[test]
fn a_rebuild_gives_the_same_stories() {
    let mut mail = Mail::new();
    let inbox = mail.inbox;
    // A stream whose fifth message, and whose usual shape, come in later
    // batches of the rebuild.
    for number in 0..150 {
        let sender = format!("s{}@example.net", number % 30);
        let body = if number % 7 == 0 {
            "> Quoted\r\n"
        } else {
            "Offers.\r\n"
        };
        mail.add_body(inbox, &sender, &[LIST], body);
        mail.add_body(inbox, &sender, &["Precedence: bulk"], body);
    }
    mail.decide("s3@example.net", Some(Decision::In));
    mail.assert_as_from_nothing();
    let derived = mail.derived();
    assert!(mail.store.story_count().unwrap() > 1);
    mail.store.rebuild(NOW, |_| {}).unwrap();
    assert_eq!(mail.derived(), derived);
}

#[test]
fn a_store_that_held_mail_before_stories_has_them_when_opened() {
    let directory = tempfile::tempdir().unwrap();
    let home = Home::at(directory.path().join("data"));
    {
        // Version 8 classed these rows; it had no stories.
        let store = Store::open_with(&home, &schema::MIGRATIONS[..8]).unwrap();
        let mut rows = String::from(
            "INSERT INTO account (id, provider, address, created_at)
                 VALUES (1, 'icloud', 'person@example.com', 0);
             INSERT INTO mailbox (id, account_id, provider_key, name, role, header_only)
                 VALUES (1, 1, 'INBOX', 'INBOX', 'inbox', 0);",
        );
        for id in 1..=5 {
            rows.push_str(&format!(
                "INSERT INTO message (id, header_hash, reported_size, first_seen_at)
                     VALUES ({id}, randomblob(32), 10, 0);
                 INSERT INTO observation (message_id, mailbox_id, validity, provider_id, flags,
                                          seen_at)
                     VALUES ({id}, 1, '', '{id}', '[]', 0);
                 INSERT INTO envelope (message_id, parser, thread_id, date, sender_address,
                                       sender_name, subject, list_id)
                     VALUES ({id}, 3, {id}, {id}, 'news@example.net', '', 'n',
                             'news.example.net');
                 INSERT INTO screening (message_id, class, date, sender_address, listed)
                     VALUES ({id}, 'bulk', {id}, 'news@example.net', 1);"
            ));
        }
        store.connection.execute_batch(&rows).unwrap();
    }
    let store = Store::open(&home).unwrap();
    assert_eq!(store.schema_version().unwrap(), 9);
    let story = store
        .story(list_story_id("news.example.net"))
        .unwrap()
        .expect("filled");
    assert_eq!(
        (story.messages, story.first_date, story.last_date),
        (5, 1, 5)
    );
    let marks = table(
        &store,
        "SELECT count(*) FROM engine_state WHERE key = 'story-fill'",
    );
    assert_eq!(marks, [vec![Value::Integer(0)]]);
}

#[test]
fn every_story_query_reads_an_index() {
    let mail = Mail::new();
    mail.store
        .connection
        .execute_batch(
            "CREATE TEMP TABLE IF NOT EXISTS story_target (message_id INTEGER PRIMARY KEY);",
        )
        .unwrap();
    let mut failed = Vec::new();
    for (name, sql) in stories::every_query() {
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
            // The target is a batch's own few rows; a constant row is the
            // one an EXISTS is read into.
            if !(line.starts_with("SCAN story_target")
                || line.starts_with("SCAN temp.story_target")
                || line == "SCAN CONSTANT ROW")
            {
                failed.push(format!("{name} scans:\n{plan}"));
            }
        }
        let expected = match name {
            "members before" | "members removed" | "exceptions of the target" => {
                "SEARCH story_member USING INTEGER PRIMARY KEY"
            }
            "members" => "SEARCH screening USING INTEGER PRIMARY KEY",
            "exceptions of a shape" | "shape count" => {
                "story_member_shape (story_id=? AND body_shape=?"
            }
            "exceptions of a story" | "span" | "newest" | "story messages" => {
                "story_member_date (story_id=?"
            }
            "has usual" => "story_shape_messages (story_id=? AND messages>?)",
            "exceptions" | "story exceptions" => "story_member_exception (story_id=?",
            "kind count" | "kind newest" | "story kind" => {
                "story_member_kind (story_id=? AND template_key=?"
            }
            "story list" => "story_recent",
            "story kinds" => "story_kind_most (story_id=?",
            "story changes" => "change_kind (kind=? AND seq>?)",
            "stories of" => "SEARCH story_member USING INTEGER PRIMARY KEY",
            other => panic!("no plan expected for {other}"),
        };
        if !plan.contains(expected) {
            failed.push(format!("{name}:\n{plan}"));
        }
    }
    assert!(failed.is_empty(), "{}", failed.join("\n\n"));
}
