//! The story commands (the specification's section 8 and 11) over mail
//! synced from the scripted IMAP server: the stories of a list and of a
//! sender with no list, a story's kinds, exceptions and messages, and what
//! changed since a cursor the caller keeps, with everything that came from
//! a message labelled (12.1).

#![allow(clippy::expect_used, clippy::unwrap_used)]

mod support;

use loam_mail::store::{list_story_id, sender_id, sender_story_id};
use serde_json::{Value, json};
use support::imap::World;
use support::synced::{Fixture, assert_labelled, mail};

const SHOP: &str = "deals@shop.example";

/// A message of the news list, with `body`.
fn news(id: &str, body: &str) -> Vec<u8> {
    format!(
        "From: News <news@example.net>\r\nMessage-ID: <{id}@example.org>\r\nSubject: Issue {id}\r\n\
         List-Id: News <news.example.net>\r\nContent-Type: text/plain\r\n\r\n{body}\r\n"
    )
    .into_bytes()
}

/// A list's six issues, one of them shaped unlike the others; a shop's
/// five receipts with no list; a stranger; and a list's mail in junk.
fn world(world: &mut World) {
    world.mailbox("INBOX", &[]);
    world.mailbox("Sent Messages", &["\\Sent"]);
    world.mailbox("Junk", &["\\Junk"]);
    for number in 0..5 {
        world.add(
            "INBOX",
            news(&format!("n{number}"), "This week's news."),
            &[],
        );
    }
    world.add("INBOX", news("odd", "> You wrote to us"), &[]);
    for number in 0..5 {
        world.add(
            "INBOX",
            mail(
                &format!("Shop <{SHOP}>"),
                &format!("r{number}"),
                "Precedence: bulk\r\n",
            ),
            &[],
        );
    }
    world.add("INBOX", mail("stranger@example.biz", "s1", ""), &[]);
    for number in 0..5 {
        world.add(
            "Junk",
            mail(
                "promo@spam.example",
                &format!("j{number}"),
                "List-Id: <promo.spam.example>\r\n",
            ),
            &[],
        );
    }
}

const FROM_MESSAGES: &[&str] = &[
    "news", "News", "Issue", "Shop", "deals", "stranger", "promo", "example",
];

impl Fixture {
    fn ok(&self, name: &str, input: Value) -> Value {
        let result = self.agent("a", name, input);
        assert_eq!(result["success"], true, "{result}");
        assert_labelled(&result, FROM_MESSAGES);
        result["data"].clone()
    }

    fn code(&self, name: &str, input: Value) -> String {
        let result = self.agent("a", name, input);
        assert_eq!(result["success"], false, "{result}");
        result["error"]["code"].as_str().unwrap().to_string()
    }
}

#[test]
fn the_stories_are_each_list_and_each_sender_with_no_list() {
    let fixture = Fixture::new(world);
    let listed = fixture.ok("mail-story-list", json!({}));
    let stories = listed["stories"].as_array().unwrap();
    assert_eq!(
        stories.len(),
        2,
        "junk and the stranger are in none: {listed}"
    );
    let shop = &stories[0];
    assert_eq!(shop["story"], sender_story_id(SHOP), "the newest first");
    assert_eq!(
        (&shop["kind"], &shop["by"], &shop["messages"]),
        (&json!("stream"), &json!("sender"), &json!(5))
    );
    assert_eq!(shop["sender"], sender_id(SHOP));
    assert_eq!(shop["content"]["title"], "Shop");
    assert_eq!(shop["content"]["listId"], Value::Null);
    let list = &stories[1];
    assert_eq!(list["story"], list_story_id("news.example.net"));
    assert_eq!(
        (&list["by"], &list["messages"]),
        (&json!("list"), &json!(6))
    );
    assert_eq!(list["content"]["title"], "news.example.net");
    assert_eq!(list["content"]["senderAddress"], "news@example.net");
    assert_eq!(listed["nextCursor"], Value::Null);

    // Paged by cursor, which holds no address.
    let page = fixture.ok("mail-story-list", json!({ "limit": 1 }));
    let cursor = page["nextCursor"].as_str().unwrap();
    assert!(!cursor.contains('@'), "{cursor}");
    let rest = fixture.ok("mail-story-list", json!({ "cursor": cursor }));
    assert_eq!(rest["stories"][0]["story"], list["story"]);

    let status = fixture.ok("mail-status", json!({}));
    assert_eq!(status["screening"]["stories"], 2);
}

#[test]
fn a_story_opens_with_its_kinds_and_its_messages_newest_first() {
    let fixture = Fixture::new(world);
    let story = list_story_id("news.example.net");
    let opened = fixture.ok("mail-story-open", json!({ "story": story }));
    assert_eq!(opened["story"]["messages"], 6);
    assert_eq!(opened["story"]["exceptions"], 1, "{opened}");
    assert_eq!(opened["only"], "every");
    // The odd one's subject is shaped unlike the issues': a kind of its own.
    let kinds = opened["kindsShown"].as_array().unwrap();
    assert_eq!(opened["story"]["kinds"], 2);
    assert_eq!(
        kinds
            .iter()
            .map(|kind| &kind["messages"])
            .collect::<Vec<_>>(),
        [5, 1],
        "the most common first"
    );
    assert_eq!(kinds[1]["content"]["subject"], "Issue odd");
    let messages = opened["messages"].as_array().unwrap();
    assert_eq!(messages.len(), 6);
    assert_eq!(
        messages[0]["content"]["subject"], "Issue odd",
        "newest first"
    );
    assert_eq!(messages[0]["exception"], true);
    assert_eq!(messages[1]["exception"], false);
    assert_eq!(messages[0]["class"], "bulk");
    assert_eq!(messages[0]["kind"], kinds[1]["kind"]);
    assert_eq!(messages[1]["kind"], kinds[0]["kind"]);

    let exceptions = fixture.ok(
        "mail-story-open",
        json!({ "story": story, "exceptions": true }),
    );
    assert_eq!(exceptions["only"], "exceptions");
    assert_eq!(exceptions["messages"].as_array().unwrap().len(), 1);
    let of_kind = fixture.ok(
        "mail-story-open",
        json!({ "story": story, "kind": kinds[0]["kind"], "limit": 4 }),
    );
    assert_eq!(of_kind["messages"].as_array().unwrap().len(), 4);
    let cursor = of_kind["nextCursor"].as_str().unwrap();
    let rest = fixture.ok(
        "mail-story-open",
        json!({ "story": story, "kind": kinds[0]["kind"], "cursor": cursor }),
    );
    assert_eq!(rest["messages"].as_array().unwrap().len(), 1);

    assert_eq!(
        fixture.code("mail-story-open", json!({ "story": 1 })),
        "STORY_NOT_FOUND"
    );
    assert_eq!(
        fixture.code("mail-story-open", json!({ "story": story, "kind": "nope" })),
        "INVALID_INPUT"
    );
    assert_eq!(
        fixture.code(
            "mail-story-open",
            json!({ "story": story, "kind": kinds[0]["kind"], "exceptions": true })
        ),
        "INVALID_INPUT"
    );

    // Each message a list or a thread gives names its story.
    let bulk = fixture.ok("mail-message-list", json!({ "class": "bulk" }));
    let first = &bulk["messages"][0];
    let thread = fixture.ok("mail-thread-open", json!({ "thread": first["thread"] }));
    assert_eq!(thread["messages"][0]["story"], first["story"]);
    assert!(first["story"].is_i64(), "{first}");
    let unknown = fixture.ok("mail-message-list", json!({ "class": "unknown" }));
    assert_eq!(unknown["messages"][0]["story"], Value::Null);
}

#[test]
fn what_changed_is_read_with_a_cursor_the_caller_keeps() {
    let fixture = Fixture::new(world);
    let shop = sender_story_id(SHOP);
    let list = list_story_id("news.example.net");
    let all = fixture.ok("mail-story-changes", json!({}));
    let changed: Vec<&Value> = all["changes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|change| &change["story"])
        .collect();
    assert_eq!(changed.len(), 2);
    assert!(changed.contains(&&json!(shop)) && changed.contains(&&json!(list)));
    assert_eq!(all["changes"][0]["state"], "current");
    assert_eq!(
        (&all["reset"], &all["more"]),
        (&json!(false), &json!(false))
    );
    let cursor = all["nextCursor"].as_str().unwrap().to_string();
    let none = fixture.ok("mail-story-changes", json!({ "cursor": cursor }));
    assert_eq!(none["changes"], json!([]));
    assert_eq!(none["nextCursor"], json!(cursor));

    // Screened in, the shop's mail is the inbox's: its story is gone.
    let screened = fixture.person(
        "mail-sender-screen",
        json!({ "sender": sender_id(SHOP), "decision": "in" }),
    );
    assert_eq!(screened["success"], true, "{screened}");
    let since = fixture.ok("mail-story-changes", json!({ "cursor": cursor }));
    assert_eq!(
        since["changes"],
        json!([{ "story": shop, "state": "gone" }])
    );

    // A new issue changes the list's story.
    fixture
        .server
        .world()
        .add("INBOX", news("n9", "This week's news."), &[]);
    fixture.sync();
    let cursor = since["nextCursor"].as_str().unwrap();
    let after = fixture.ok("mail-story-changes", json!({ "cursor": cursor }));
    assert_eq!(after["changes"][0]["story"], list);
    assert_eq!(after["changes"][0]["messages"], 7);

    // Paged: one at a time.
    let first = fixture.ok("mail-story-changes", json!({ "limit": 1 }));
    assert_eq!(first["more"], true);
    let next = fixture.ok(
        "mail-story-changes",
        json!({ "cursor": first["nextCursor"], "limit": 1 }),
    );
    assert_ne!(next["changes"][0]["story"], first["changes"][0]["story"]);
    assert_eq!(
        fixture.code("mail-story-changes", json!({ "cursor": "x" })),
        "INVALID_INPUT"
    );
}

#[test]
fn stories_wait_with_screening() {
    let fixture = Fixture::new(world);
    fixture.make_stale();
    for (name, input) in [
        ("mail-story-list", json!({})),
        (
            "mail-story-open",
            json!({ "story": list_story_id("news.example.net") }),
        ),
        ("mail-story-changes", json!({})),
    ] {
        assert_eq!(fixture.code(name, input), "SCREENING_NOT_READY");
    }
    let status = fixture.ok("mail-status", json!({}));
    assert_eq!(status["screening"]["stories"], Value::Null);
}
