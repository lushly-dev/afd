//! Selections and the person's policy (the specification's 9.1 and 9.4)
//! through the commands, over mail synced from the scripted IMAP server: an
//! agent selects over MCP, and the person changes the policy at the
//! terminal.

#![allow(clippy::expect_used, clippy::unwrap_used)]

mod support;

use loam_mail::cli::{Caller, EXIT_FAILED, EXIT_OK, run};
use loam_mail::secrets::InMemory;
use loam_mail::store::{MOST_SELECTIONS, SELECTION_LIFETIME, SelectionItem, sender_id};
use serde_json::{Value, json};
use support::imap::World;
use support::synced::{Fixture, assert_labelled, mail};

const STRANGER: &str = "stranger@example.biz";

/// Six messages through a list, two from a stranger, and junk.
fn world(world: &mut World) {
    world.mailbox("INBOX", &[]);
    world.mailbox("Junk", &["\\Junk"]);
    for number in 0..6 {
        world.add(
            "INBOX",
            mail(
                "News <news@example.net>",
                &format!("n{number}"),
                "List-Id: <news.example.net>\r\n",
            ),
            &["\\Seen"],
        );
    }
    for number in 0..2 {
        world.add(
            "INBOX",
            mail(&format!("Stranger <{STRANGER}>"), &format!("s{number}"), ""),
            &[],
        );
    }
    world.add("Junk", mail(STRANGER, "j1", ""), &[]);
}

const FROM_MESSAGES: &[&str] = &["news", "News", "stranger", "Stranger", "example"];

impl Fixture {
    /// The id `mail-status` gives the mailbox of `role`.
    fn mailbox_of(&self, role: &str) -> i64 {
        let status = self.agent("a", "mail-status", json!({}));
        status["data"]["accounts"][0]["mailboxes"]
            .as_array()
            .unwrap()
            .iter()
            .find(|mailbox| mailbox["role"] == role)
            .unwrap()["mailbox"]
            .as_i64()
            .unwrap()
    }

    fn select(&self, token: &str, query: Value) -> Value {
        let made = self.agent(token, "mail-selection-create", query);
        assert_eq!(made["success"], true, "{made}");
        assert_labelled(&made, FROM_MESSAGES);
        made["data"].clone()
    }

    fn places(&self, selection: i64) -> Vec<SelectionItem> {
        self.engine
            .with_store(|store| store.selection_items(selection))
            .unwrap()
    }

    fn policy(&self) -> Value {
        let shown = self.agent("a", "mail-policy-show", json!({}));
        assert_eq!(shown["success"], true, "{shown}");
        shown["data"]["policy"].clone()
    }
}

#[test]
fn an_agent_selects_a_mailbox_and_gets_exact_counts_and_a_labelled_sample() {
    let fixture = Fixture::new(world);
    let inbox = fixture.mailbox_of("inbox");
    let made = fixture.select("a", json!({ "mailbox": inbox }));
    assert_eq!(made["count"], 8, "{made}");
    assert_eq!(made["messages"], 8);
    assert_eq!(made["threads"], 8);
    assert_eq!(made["unreturned"], 0);
    assert_eq!(
        made["expiresAt"].as_i64().unwrap() - made["createdAt"].as_i64().unwrap(),
        SELECTION_LIFETIME
    );
    let sample = made["sample"].as_array().unwrap();
    assert_eq!(sample.len(), 5);
    assert_eq!(sample[0]["content"]["trust"], "content");
    let selection = made["selection"].as_i64().unwrap();
    let frozen = fixture.places(selection);
    assert_eq!(frozen.len(), 8);

    // Mail that arrives and matches is not in it.
    fixture
        .server
        .world()
        .add("INBOX", mail(STRANGER, "s9", ""), &[]);
    fixture.sync();
    assert_eq!(fixture.places(selection), frozen);
    let again = fixture.select("a", json!({ "mailbox": inbox }));
    assert_eq!(again["count"], 9);
}

#[test]
fn a_story_a_class_a_sender_and_read_mail_each_select_theirs() {
    let fixture = Fixture::new(world);
    let stories = fixture.agent("a", "mail-story-list", json!({}));
    let story = stories["data"]["stories"][0]["story"].as_i64().unwrap();
    assert_eq!(
        fixture.select("a", json!({ "story": story }))["messages"],
        6
    );
    // The stranger's junk is left out unless junk is named.
    assert_eq!(
        fixture.select("a", json!({ "class": "unknown" }))["messages"],
        2
    );
    let sender = sender_id(STRANGER);
    assert_eq!(
        fixture.select("a", json!({ "sender": sender }))["messages"],
        2
    );
    let junk = fixture.mailbox_of("junk");
    assert_eq!(
        fixture.select("a", json!({ "sender": sender, "mailbox": junk }))["messages"],
        1
    );
    assert_eq!(
        fixture.select("a", json!({ "unread": false }))["messages"],
        6
    );
    assert_eq!(
        fixture.select("a", json!({ "text": "s1" }))["messages"],
        1,
        "the subject `About s1`"
    );
}

#[test]
fn what_a_query_names_must_be_well_formed_and_exist() {
    let fixture = Fixture::new(world);
    // The crate checks each field's type against the schema first.
    for (query, code) in [
        (json!({}), "INVALID_INPUT"),
        (json!({ "after": 10, "before": 10 }), "INVALID_INPUT"),
        (json!({ "class": "spam" }), "VALIDATION_ERROR"),
        (json!({ "unread": "yes" }), "VALIDATION_ERROR"),
        (json!({ "text": " " }), "INVALID_INPUT"),
        (json!({ "text": "x".repeat(513) }), "INVALID_INPUT"),
        (json!({ "mailbox": "INBOX" }), "VALIDATION_ERROR"),
        (json!({ "account": 999 }), "ACCOUNT_NOT_FOUND"),
        (json!({ "mailbox": 999 }), "MAILBOX_NOT_FOUND"),
        (json!({ "sender": 1 }), "SENDER_NOT_FOUND"),
        (json!({ "story": 999 }), "STORY_NOT_FOUND"),
        (json!({ "text": "subject:(" }), "INVALID_INPUT"),
    ] {
        let refused = fixture.agent("a", "mail-selection-create", query.clone());
        assert_eq!(refused["error"]["code"], code, "{query}: {refused}");
        assert!(
            refused["error"]["suggestion"].is_string(),
            "{query}: {refused}"
        );
    }
}

#[test]
fn a_mailbox_of_another_account_names_nothing_and_is_refused() {
    let fixture = Fixture::new(world);
    let inbox = fixture.mailbox_of("inbox");
    let other = fixture
        .engine
        .with_store(|store| store.add_account("icloud", "other@example.com", 0))
        .unwrap();
    let refused = fixture.agent(
        "a",
        "mail-selection-create",
        json!({ "mailbox": inbox, "account": other.0 }),
    );
    assert_eq!(refused["error"]["code"], "MAILBOX_NOT_FOUND", "{refused}");
    let own = fixture.select(
        "a",
        json!({ "mailbox": inbox, "account": fixture.account.id.0 }),
    );
    assert_eq!(own["messages"], 8);
}

#[test]
fn the_journal_keeps_a_selections_query_and_counts_and_no_mail() {
    let fixture = Fixture::new(world);
    let made = fixture.select("a", json!({ "text": "s1" }));
    assert_eq!(made["sample"].as_array().unwrap().len(), 1);
    let journal =
        std::fs::read_to_string(fixture.directory.path().join("data").join("journal.jsonl"))
            .unwrap();
    let entry = journal
        .lines()
        .find(|line| line.contains("mail-selection-create"))
        .unwrap();
    assert!(entry.contains("\"count\":1"), "{entry}");
    assert!(entry.contains("s1"), "the caller's query is kept: {entry}");
    for word in ["Stranger", "stranger@", "Words of"] {
        assert!(!entry.contains(word), "`{word}` in the journal: {entry}");
    }
}

#[test]
fn a_selection_waits_until_the_mail_is_derived_again() {
    let fixture = Fixture::new(world);
    let inbox = fixture.mailbox_of("inbox");
    fixture.make_stale();
    let refused = fixture.agent("a", "mail-selection-create", json!({ "mailbox": inbox }));
    assert_eq!(refused["error"]["code"], "SCREENING_NOT_READY", "{refused}");
    assert_eq!(refused["error"]["retryable"], true);
}

#[test]
fn a_caller_holds_a_few_selections_and_another_is_not_held_back() {
    let fixture = Fixture::new(world);
    let inbox = fixture.mailbox_of("inbox");
    for _ in 0..MOST_SELECTIONS {
        fixture.select("a", json!({ "mailbox": inbox }));
    }
    let refused = fixture.agent("a", "mail-selection-create", json!({ "mailbox": inbox }));
    assert_eq!(refused["error"]["code"], "POLICY_LIMIT", "{refused}");
    assert_labelled(&refused, FROM_MESSAGES);
    fixture.select("b", json!({ "mailbox": inbox }));
}

fn policy_set(fixture: &Fixture, input: &Value, approve: bool) -> (u8, String, Vec<String>) {
    let input = input.to_string();
    let (status, _, said, asked) = fixture.terminal(&["mail-policy-set", input.as_str()], approve);
    (status, said, asked)
}

#[test]
fn only_the_person_changes_the_policy_and_is_shown_it_in_numbers() {
    let fixture = Fixture::new(world);
    let default = json!({
        "changePerCall": 500,
        "trashPerCall": 50,
        "trashPerDay": 200,
        "askAbove": 200,
        "setAt": null,
    });
    assert_eq!(fixture.policy(), default);
    let stricter = json!({ "trashPerCall": 10, "trashPerDay": 20 });

    // An agent cannot; a script cannot, with no one to ask.
    let refused = fixture.agent("a", "mail-policy-set", stricter.clone());
    assert_eq!(refused["success"], false, "{refused}");
    let args = ["mail-policy-set".to_string(), stricter.to_string()];
    let (mut out, mut err) = (Vec::new(), Vec::new());
    let status = run(
        &args,
        &fixture.registry,
        Caller::Script,
        &InMemory::default(),
        &mut out,
        &mut err,
    )
    .unwrap();
    assert_eq!(status, EXIT_FAILED);
    assert!(String::from_utf8_lossy(&out).contains("PERSON_REQUIRED"));
    assert_eq!(fixture.policy(), default);

    // The person who declines changes nothing.
    let (status, said, asked) = policy_set(&fixture, &stricter, false);
    assert_eq!(status, EXIT_FAILED);
    assert_eq!(asked.len(), 1);
    assert!(
        said.contains("trash up to 10 a call and 20 a day"),
        "{said}"
    );
    assert_eq!(fixture.policy(), default);

    // The person who approves sets it.
    let (status, said, _) = policy_set(&fixture, &stricter, true);
    assert_eq!(status, EXIT_OK, "{said}");
    let set = fixture.policy();
    assert_eq!(set["trashPerCall"], 10);
    assert_eq!(set["trashPerDay"], 20);
    assert_eq!(set["changePerCall"], 500);
    assert!(set["setAt"].is_i64());
}

#[test]
fn a_policy_that_cannot_be_kept_is_refused_whole() {
    let fixture = Fixture::new(world);
    let before = fixture.policy();
    for input in [
        json!({}),
        json!({ "trashPerCall": 300, "trashPerDay": 200 }),
        json!({ "changePerCall": 1001 }),
        json!({ "trashPerDay": -1 }),
        json!({ "askAbove": "many" }),
    ] {
        let (status, said, asked) = policy_set(&fixture, &input, true);
        assert_eq!(status, EXIT_FAILED, "{input}: {said}");
        assert!(asked.is_empty(), "{input}: asked {asked:?}");
        assert_eq!(fixture.policy(), before, "{input}");
    }
    // Input wrong only beside the stored policy is held, as any other is,
    // since the person could change that policy before the command reads
    // it; approved, it is refused all the same.
    let (status, said, asked) = policy_set(&fixture, &json!({ "trashPerCall": 300 }), true);
    assert_eq!(status, EXIT_FAILED, "{said}");
    assert_eq!(asked.len(), 1, "{said}");
    assert!(said.contains("cannot be set as given"), "{said}");
    assert_eq!(fixture.policy(), before);
}
