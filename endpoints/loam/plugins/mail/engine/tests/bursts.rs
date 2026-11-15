//! Bursts (the specification's 7.4) over mail synced from the scripted IMAP
//! server: a flood of new senders is one flagged story in place of its queue
//! entries, a known sender's mail stays out of it and is named by its flag,
//! and everything that came from a message is labelled (12.1).

#![allow(clippy::expect_used, clippy::unwrap_used)]

mod support;

use loam_mail::store::sender_id;
use serde_json::{Value, json};
use support::imap::World;
use support::synced::{Fixture, assert_labelled, mail};

/// A friend the person wrote to; forty new senders within the hour; the
/// friend writing during it; and a stranger a week before.
fn world(world: &mut World) {
    world.mailbox("INBOX", &[]);
    world.mailbox("Sent Messages", &["\\Sent"]);
    world.mailbox("Junk", &["\\Junk"]);
    world.add_received(
        "Sent Messages",
        mail("person@example.com", "p1", "To: friend@example.org\r\n"),
        &["\\Seen"],
        " 1-Mar-2026 09:00:00 +0000",
    );
    world.add_received(
        "INBOX",
        mail("stranger@example.biz", "s1", ""),
        &[],
        " 8-Mar-2026 09:00:00 +0000",
    );
    for number in 0..40 {
        world.add_received(
            "INBOX",
            mail(
                &format!("Signup <signup{number}@flood.example>"),
                &format!("f{number}"),
                "",
            ),
            &[],
            &format!("15-Mar-2026 10:{number:02}:00 +0000"),
        );
    }
    world.add_received(
        "INBOX",
        mail("Friend <friend@example.org>", "k1", ""),
        &[],
        "15-Mar-2026 10:20:30 +0000",
    );
}

const FROM_MESSAGES: &[&str] = &["flood", "Signup", "friend", "Friend", "stranger", "example"];

impl Fixture {
    fn ok(&self, name: &str, input: Value) -> Value {
        let result = self.agent("a", name, input);
        assert_eq!(result["success"], true, "{result}");
        assert_labelled(&result, FROM_MESSAGES);
        result["data"].clone()
    }
}

#[test]
fn a_flood_is_one_flagged_story_in_place_of_its_queue_entries() {
    let fixture = Fixture::new(world);
    let status = fixture.ok("mail-status", json!({}));
    let screening = &status["screening"];
    assert_eq!(screening["ready"], true, "{status}");
    // The queue holds the stranger alone; the forty are the burst's.
    assert_eq!(screening["queue"], json!({ "messages": 1, "senders": 1 }));
    let bursts = &screening["bursts"];
    assert_eq!(bursts["total"], 1, "{bursts}");
    let burst = &bursts["latest"][0];
    assert_eq!(burst["firstContacts"], 40);
    assert_eq!(burst["flagged"], true, "the friend wrote during it");
    assert_eq!(
        burst["knownDuring"],
        json!([sender_id("friend@example.org")])
    );
    assert_eq!(
        burst["content"]["knownDuring"],
        json!(["friend@example.org"])
    );

    // Its story: one card for the forty, listed with the others.
    let story = burst["story"].as_i64().unwrap();
    let opened = fixture.ok("mail-story-open", json!({ "story": story, "limit": 5 }));
    assert_eq!(opened["story"]["kind"], "burst");
    assert_eq!(opened["story"]["by"], "burst");
    assert_eq!(opened["story"]["messages"], 40);
    assert_eq!(
        opened["story"]["content"]["title"],
        "40 messages from 40 new senders"
    );
    assert_eq!(opened["story"]["burst"]["flagged"], true);
    assert_eq!(opened["messages"][0]["class"], "unknown");
    let listed = fixture.ok("mail-story-list", json!({}));
    assert_eq!(listed["stories"][0]["story"], story);

    // The unknown list holds the stranger alone; the friend is in the inbox.
    let unknown = fixture.ok("mail-message-list", json!({ "class": "unknown" }));
    assert_eq!(unknown["messages"].as_array().unwrap().len(), 1);
    let known = fixture.ok("mail-message-list", json!({ "class": "known" }));
    assert_eq!(
        known["messages"][0]["content"]["sender"]["address"],
        "friend@example.org"
    );
    assert_eq!(known["messages"][0]["story"], Value::Null);
}

#[test]
fn bursts_wait_with_screening() {
    let fixture = Fixture::new(world);
    fixture.make_stale();
    let status = fixture.ok("mail-status", json!({}));
    assert_eq!(status["screening"]["bursts"], Value::Null);
}
