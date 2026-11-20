//! Drafts and snoozed threads (the specification's 9.5 and section 11), on
//! the scripted IMAP server: every caller may write, change, discard and
//! restore a draft, from the revision it read; nothing reaches the provider;
//! what a caller wrote is content in every result; a discarded draft goes
//! after 30 days; and a snoozed thread leaves its mailbox's list until its
//! time or until mail arrives in it.

#![allow(clippy::expect_used, clippy::unwrap_used)]

mod support;

use afd::{Actor, ActorKind, CommandContext, CommandInterface, fixed_clock};
use serde_json::{Value, json};
use support::imap::World;
use support::synced::{Fixture, assert_labelled, mail};

const STRANGER: &str = "Stranger <stranger@example.biz>";

/// Words only the drafts and the messages hold: none may appear in a
/// result outside a labelled part.
const WRITTEN: &[&str] = &["stranger@", "friend@", "Lunch", "Words of", "About "];

const DAY: i64 = 24 * 60 * 60 * 1000;

fn world(world: &mut World) {
    world.mailbox("INBOX", &[]);
    world.mailbox("Sent Messages", &["\\Sent"]);
    world.add("INBOX", mail(STRANGER, "s0", ""), &[]);
    world.add("INBOX", mail(STRANGER, "s1", ""), &[]);
}

fn ok(result: &Value) -> Value {
    assert_eq!(result["success"], true, "{result}");
    assert_labelled(result, WRITTEN);
    result["data"].clone()
}

fn code(result: &Value) -> &str {
    assert_eq!(result["success"], false, "{result}");
    assert_labelled(result, WRITTEN);
    result["error"]["code"].as_str().unwrap()
}

impl FixtureExt for Fixture {
    fn at(&self, now: i64, name: &str, input: Value) -> Value {
        let context = CommandContext::new()
            .with_interface(CommandInterface::Mcp)
            .with_actor(Actor::new(ActorKind::Agent).with_id("tok_a"))
            .with_clock(fixed_clock(now));
        self.execute(name, input, context)
    }

    fn message(&self, word: &str) -> i64 {
        let found = self.person("mail-search", json!({ "query": word }));
        found["data"]["hits"][0]["message"].as_i64().unwrap()
    }

    fn inbox(&self) -> i64 {
        let status = self.person("mail-status", json!({}));
        status["data"]["accounts"][0]["mailboxes"]
            .as_array()
            .unwrap()
            .iter()
            .find(|mailbox| mailbox["role"] == "inbox")
            .unwrap()["mailbox"]
            .as_i64()
            .unwrap()
    }
}

trait FixtureExt {
    fn at(&self, now: i64, name: &str, input: Value) -> Value;
    fn message(&self, word: &str) -> i64;
    fn inbox(&self) -> i64;
}

#[test]
fn an_agent_writes_a_draft_the_person_changes_and_each_change_names_its_revision() {
    let fixture = Fixture::new(world);
    fixture.server.take_log();
    let answered = fixture.message("s0");
    let made = ok(&fixture.agent(
        "tok_a",
        "mail-draft-create",
        json!({
            "answers": answered,
            "to": ["Stranger@Example.BIZ"],
            "subject": "Re: About s0",
            "body": "Words of a reply.",
        }),
    ));
    assert_eq!(made["revision"], 1);
    assert_eq!(made["answers"], answered);
    assert_eq!(made["account"], fixture.account.id.0);
    // The domain is kept in lower case; the local part as written.
    assert_eq!(made["content"]["to"], json!(["Stranger@example.biz"]));
    assert_eq!(made["content"]["body"], "Words of a reply.");
    assert_eq!(made["authors"]["body"]["kind"], "agent");
    assert_eq!(made["authors"]["body"]["token"], "tok_a");
    let draft = made["draft"].clone();

    // A change from a revision that is not the draft's is refused.
    let stale = fixture.person(
        "mail-draft-update",
        json!({ "draft": draft, "revision": 7, "body": "Lunch?" }),
    );
    assert_eq!(code(&stale), "DRAFT_CHANGED");
    // No revision at all is refused too, by the schema.
    let none = fixture.person(
        "mail-draft-update",
        json!({ "draft": draft, "body": "Lunch?" }),
    );
    assert_eq!(code(&none), "VALIDATION_ERROR");

    let changed = ok(&fixture.person(
        "mail-draft-update",
        json!({ "draft": draft, "revision": 1, "body": "Lunch?", "cc": ["friend@example.org"] }),
    ));
    assert_eq!(changed["revision"], 2);
    assert_eq!(changed["content"]["body"], "Lunch?");
    assert_eq!(changed["content"]["cc"], json!(["friend@example.org"]));
    // The recipients are replaced together: `to` was left out.
    assert_eq!(changed["content"]["to"], json!([]));
    // Each part names who wrote it last.
    assert_eq!(changed["authors"]["body"]["kind"], "human");
    assert_eq!(changed["authors"]["subject"]["kind"], "agent");

    let shown = ok(&fixture.agent("tok_a", "mail-draft-show", json!({ "draft": draft })));
    assert_eq!(shown, changed);
    // Nothing reached the provider.
    let log = fixture.server.take_log();
    assert!(
        !log.iter().any(|line| line.starts_with("APPEND")
            || line.starts_with("UID STORE")
            || line.starts_with("UID COPY")),
        "{log:?}"
    );
}

#[test]
fn input_a_draft_cannot_hold_is_refused_without_repeating_it() {
    let fixture = Fixture::new(world);
    for input in [
        json!({ "to": ["Stranger <stranger@example.biz>"] }),
        json!({ "to": ["stranger@example.biz, friend@example.org"] }),
        json!({ "subject": "About s0\r\nBcc: friend@example.org" }),
        json!({ "body": "x".repeat(48 * 1024 + 1) }),
        json!({ "to": (0..101).map(|n| format!("p{n}@example.org")).collect::<Vec<_>>() }),
    ] {
        let refused = fixture.agent("tok_a", "mail-draft-create", input.clone());
        assert_eq!(code(&refused), "INVALID_INPUT", "{input}");
    }
    // A list that is not one is refused by the schema.
    let not_a_list = fixture.agent(
        "tok_a",
        "mail-draft-create",
        json!({ "to": "a@example.org" }),
    );
    assert_eq!(code(&not_a_list), "VALIDATION_ERROR");
    let nothing = fixture.agent(
        "tok_a",
        "mail-draft-create",
        json!({ "answers": 999_999, "body": "Words of" }),
    );
    assert_eq!(code(&nothing), "MESSAGE_NOT_FOUND");
    let no_account = fixture.agent("tok_a", "mail-draft-create", json!({ "account": 42 }));
    assert_eq!(code(&no_account), "ACCOUNT_NOT_FOUND");
    let missing = fixture.agent("tok_a", "mail-draft-show", json!({ "draft": 5 }));
    assert_eq!(code(&missing), "DRAFT_NOT_FOUND");
}

#[test]
fn a_discarded_draft_is_restored_within_30_days_and_goes_after() {
    let fixture = Fixture::new(world);
    let start = 1_800_000_000_000;
    let made = ok(&fixture.at(
        start,
        "mail-draft-create",
        json!({ "to": ["friend@example.org"], "body": "Lunch?" }),
    ));
    let draft = made["draft"].clone();
    let discarded = ok(&fixture.at(start, "mail-draft-discard", json!({ "draft": draft })));
    assert_eq!(discarded["revision"], 2);
    assert_eq!(discarded["discardedAt"], start);
    assert_eq!(discarded["goesAt"], start + 30 * DAY);
    // Out of the list of drafts, into that of the discarded ones.
    let listed = ok(&fixture.at(start, "mail-draft-list", json!({})));
    assert_eq!(listed["drafts"], json!([]));
    let aside = ok(&fixture.at(start, "mail-draft-list", json!({ "discarded": true })));
    assert_eq!(aside["drafts"][0]["draft"], draft);
    assert_eq!(aside["drafts"][0]["content"]["snippet"], "Lunch?");
    // It is not changed while discarded, nor discarded twice.
    let change = fixture.at(
        start,
        "mail-draft-update",
        json!({ "draft": draft, "revision": 2, "body": "Words of" }),
    );
    assert_eq!(code(&change), "INVALID_INPUT");
    let again = fixture.at(start, "mail-draft-discard", json!({ "draft": draft }));
    assert_eq!(code(&again), "INVALID_INPUT");

    let restored = ok(&fixture.at(
        start + 29 * DAY,
        "mail-draft-restore",
        json!({ "draft": draft }),
    ));
    assert_eq!(restored["revision"], 3);
    assert_eq!(restored["discardedAt"], Value::Null);
    let listed = ok(&fixture.at(start + 29 * DAY, "mail-draft-list", json!({})));
    assert_eq!(listed["drafts"][0]["draft"], draft);

    // Discarded again, it goes 30 days after.
    ok(&fixture.at(
        start + 29 * DAY,
        "mail-draft-discard",
        json!({ "draft": draft }),
    ));
    let held = fixture.at(
        start + 58 * DAY,
        "mail-draft-show",
        json!({ "draft": draft }),
    );
    assert_eq!(held["success"], true);
    let gone = fixture.at(
        start + 59 * DAY,
        "mail-draft-show",
        json!({ "draft": draft }),
    );
    assert_eq!(code(&gone), "DRAFT_NOT_FOUND");
    let too_late = fixture.at(
        start + 59 * DAY,
        "mail-draft-restore",
        json!({ "draft": draft }),
    );
    assert_eq!(code(&too_late), "DRAFT_NOT_FOUND");
}

#[test]
fn drafts_are_listed_the_most_recently_changed_first_and_paged() {
    let fixture = Fixture::new(world);
    let start = 1_800_000_000_000;
    let mut ids = Vec::new();
    for number in 0..5 {
        let made = ok(&fixture.at(
            start + number,
            "mail-draft-create",
            json!({ "body": format!("Lunch {number}") }),
        ));
        ids.push(made["draft"].as_i64().unwrap());
    }
    let first = ok(&fixture.at(start + 10, "mail-draft-list", json!({ "limit": 2 })));
    let listed: Vec<i64> = first["drafts"]
        .as_array()
        .unwrap()
        .iter()
        .map(|draft| draft["draft"].as_i64().unwrap())
        .collect();
    assert_eq!(listed, [ids[4], ids[3]]);
    let second = ok(&fixture.at(
        start + 10,
        "mail-draft-list",
        json!({ "limit": 2, "cursor": first["nextCursor"] }),
    ));
    assert_eq!(second["drafts"][0]["draft"], ids[2]);
}

#[test]
fn a_snoozed_thread_leaves_the_list_until_its_time_or_new_mail() {
    let fixture = Fixture::new(world);
    let inbox = fixture.inbox();
    let thread = {
        let found = fixture.person("mail-search", json!({ "query": "s0" }));
        found["data"]["hits"][0]["thread"].clone()
    };
    let now = afd::Clock::now(&afd::SystemClock);
    let listed = |snoozed: bool| -> Vec<Value> {
        let list = fixture.person(
            "mail-thread-list",
            json!({ "mailbox": inbox, "snoozed": snoozed }),
        );
        list["data"]["threads"]
            .as_array()
            .unwrap()
            .iter()
            .map(|thread| thread["thread"].clone())
            .collect()
    };
    assert_eq!(listed(false).len(), 2);

    let until = now + DAY;
    let snoozed = ok(&fixture.agent(
        "tok_a",
        "mail-thread-snooze",
        json!({ "thread": thread, "until": until }),
    ));
    assert_eq!(snoozed["previous"], Value::Null);
    assert!(!listed(false).contains(&thread));
    assert_eq!(listed(true), std::slice::from_ref(&thread));
    let shown = fixture.person(
        "mail-thread-list",
        json!({ "mailbox": inbox, "snoozed": true }),
    );
    assert_eq!(shown["data"]["threads"][0]["snoozedUntil"], until);

    // A rebuild keeps it: it is not derived.
    let rebuilt = fixture.person("mail-rebuild", json!({}));
    assert_eq!(rebuilt["success"], true, "{rebuilt}");
    assert_eq!(listed(true), std::slice::from_ref(&thread));

    // Ended, and set again: each returns what it was before, which undoes it.
    let ended = ok(&fixture.agent("tok_a", "mail-thread-snooze", json!({ "thread": thread })));
    assert_eq!(ended["previous"], until);
    assert!(listed(false).contains(&thread));
    ok(&fixture.agent(
        "tok_a",
        "mail-thread-snooze",
        json!({ "thread": thread, "until": until }),
    ));

    // A time past or more than a year ahead is refused.
    for refused in [now - 1, now + 367 * DAY] {
        let result = fixture.agent(
            "tok_a",
            "mail-thread-snooze",
            json!({ "thread": thread, "until": refused }),
        );
        assert_eq!(code(&result), "INVALID_INPUT");
    }
    let nowhere = fixture.agent(
        "tok_a",
        "mail-thread-snooze",
        json!({ "thread": 999_999, "until": until }),
    );
    assert_eq!(code(&nowhere), "THREAD_NOT_FOUND");

    // Mail that arrives in the thread ends the snooze.
    std::thread::sleep(std::time::Duration::from_millis(5));
    fixture.server.world().add(
        "INBOX",
        mail(
            STRANGER,
            "s0-again",
            "In-Reply-To: <s0@example.org>\r\nReferences: <s0@example.org>\r\n",
        ),
        &[],
    );
    fixture.sync();
    assert!(listed(true).is_empty(), "{:?}", listed(true));
    assert!(listed(false).contains(&thread));
}

/// Found by review: the largest draft the limits allow, with a body of
/// characters JSON escapes, is shown whole.
#[test]
fn the_largest_draft_is_shown_whole() {
    let fixture = Fixture::new(world);
    let made = ok(&fixture.agent(
        "tok_a",
        "mail-draft-create",
        json!({
            "to": (0..100).map(|n| format!("{}{n}@example.org", "p".repeat(60))).collect::<Vec<_>>(),
            "subject": "s".repeat(998),
            "body": "\u{1}\"".repeat(24 * 1024),
        }),
    ));
    let shown = ok(&fixture.agent(
        "tok_a",
        "mail-draft-show",
        json!({ "draft": made["draft"] }),
    ));
    assert_eq!(shown["content"]["body"].as_str().unwrap().len(), 48 * 1024);
}

/// Found by review: addresses that are not plain dot-atoms, and subjects
/// holding characters that break a header or display as something else.
#[test]
fn malformed_addresses_and_unsafe_subjects_are_refused() {
    let fixture = Fixture::new(world);
    for to in [
        "a..b@example.org",
        ".a@example.org",
        "a.@example.org",
        "a@b.c/d",
        "a@-b.org",
        "ceo@example.com\u{202e}gro.elpmaxe",
        "\u{200b}a@example.org",
        "ü@example.org",
        "=?utf-8?q?a?=@example.org",
    ] {
        let refused = fixture.agent("tok_a", "mail-draft-create", json!({ "to": [to] }));
        assert_eq!(code(&refused), "INVALID_INPUT", "{to:?}");
        assert!(!refused.to_string().contains("example"), "{to:?} repeated");
    }
    for subject in [
        "a\u{0}b",
        "a\u{2028}b",
        "a\u{202e}b",
        "a\u{85}b",
        "a\u{61c}b",
        "a\u{2060}b",
        "a\u{e0041}b",
    ] {
        let refused = fixture.agent("tok_a", "mail-draft-create", json!({ "subject": subject }));
        assert_eq!(code(&refused), "INVALID_INPUT", "{subject:?}");
    }
    let tab = fixture.agent("tok_a", "mail-draft-create", json!({ "subject": "a\tb" }));
    assert_eq!(tab["success"], true, "a tab is kept");
}

/// Found by review: removing the account says its drafts go for good, and
/// takes them and its snoozes.
#[test]
fn removing_the_account_says_its_drafts_go_and_takes_them() {
    let fixture = Fixture::new(world);
    ok(&fixture.agent("tok_a", "mail-draft-create", json!({ "body": "Lunch?" })));
    ok(&fixture.agent("tok_a", "mail-draft-create", json!({ "body": "Lunch!" })));
    let thread = {
        let found = fixture.person("mail-search", json!({ "query": "s0" }));
        found["data"]["hits"][0]["thread"].clone()
    };
    let until = afd::Clock::now(&afd::SystemClock) + DAY;
    ok(&fixture.agent(
        "tok_a",
        "mail-thread-snooze",
        json!({ "thread": thread, "until": until }),
    ));
    let account = fixture.account.id.0.to_string();
    let (status, out, err, _) = fixture.terminal(
        &["mail-account-remove", &format!("{{\"account\":{account}}}")],
        true,
    );
    assert_eq!(status, loam_mail::cli::EXIT_OK, "{err}");
    let said = format!("{out}{err}");
    assert!(
        said.contains("its 2 drafts, which are kept nowhere else and go for good (their text stays in the journal)"),
        "{said}"
    );
    let left = fixture.agent("tok_a", "mail-draft-list", json!({}));
    assert_eq!(ok(&left)["drafts"], json!([]));
    let database = fixture.directory.path().join("data").join("mail.sqlite3");
    let snoozes: i64 = rusqlite::Connection::open(database)
        .unwrap()
        .query_row("SELECT count(*) FROM snooze", [], |row| row.get(0))
        .unwrap();
    assert_eq!(snoozes, 0);
}

/// Found by review: a snooze is ended by mail that arrives after it was
/// set, in the same millisecond too, and stays ended when that mail goes.
#[test]
fn a_snooze_ended_by_new_mail_stays_ended() {
    let fixture = Fixture::new(world);
    let inbox = fixture.inbox();
    let thread = {
        let found = fixture.person("mail-search", json!({ "query": "s0" }));
        found["data"]["hits"][0]["thread"].clone()
    };
    // Snoozed at a time after the reply will arrive by the sync's clock:
    // only the order of the ids tells that the reply came after.
    let now = afd::Clock::now(&afd::SystemClock) + 10 * 60 * 1000;
    ok(&fixture.at(
        now,
        "mail-thread-snooze",
        json!({ "thread": thread, "until": now + DAY }),
    ));
    let reply = fixture.server.world().add(
        "INBOX",
        mail(
            STRANGER,
            "s0-again",
            "In-Reply-To: <s0@example.org>\r\nReferences: <s0@example.org>\r\n",
        ),
        &[],
    );
    fixture.sync();
    let snoozed = |fixture: &Fixture| -> Value {
        fixture.person(
            "mail-thread-list",
            json!({ "mailbox": inbox, "snoozed": true }),
        )["data"]["threads"]
            .clone()
    };
    assert_eq!(snoozed(&fixture), json!([]));
    // The reply goes; the snooze does not come back.
    fixture.server.world().expunge("INBOX", reply);
    fixture.sync();
    assert_eq!(snoozed(&fixture), json!([]));
}
