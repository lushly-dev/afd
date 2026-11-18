//! Changing mail at the provider (the specification's 9.1 to 9.4), on the
//! scripted IMAP server: the four change commands, operations and their
//! batches, resume after a stop at every step, cancel, and undo, under the
//! person's policy.

#![allow(clippy::expect_used, clippy::unwrap_used)]

mod support;

use std::time::{Duration, Instant};

use loam_mail::cli::{EXIT_FAILED, EXIT_OK};
use loam_mail::operate::ChangeOptions;
use loam_mail::store::Policy;
use serde_json::{Value, json};
use support::imap::World;
use support::synced::{Fixture, assert_labelled, mail};

const NEWS: &str = "News <news@example.net>";
const STRANGER: &str = "Stranger <stranger@example.biz>";

/// Words that appear only in the messages: none may appear in a result
/// outside a labelled part.
const FROM_MESSAGES: &[&str] = &["news@", "stranger@", "About ", "Words of"];

/// An inbox of four from a list, two read, and two from a stranger, with
/// the mailboxes a change moves mail to.
fn world(world: &mut World) {
    world.mailbox("INBOX", &[]);
    world.mailbox("Archive", &["\\Archive"]);
    world.mailbox("Deleted Messages", &["\\Trash"]);
    world.mailbox("Junk", &["\\Junk"]);
    world.mailbox("Receipts", &[]);
    for number in 0..4 {
        let flags: &[&str] = if number < 2 { &["\\Seen"] } else { &[] };
        world.add(
            "INBOX",
            mail(
                NEWS,
                &format!("n{number}"),
                "List-Id: <news.example.net>\r\n",
            ),
            flags,
        );
    }
    for number in 0..2 {
        world.add("INBOX", mail(STRANGER, &format!("s{number}"), ""), &[]);
    }
}

fn subjects(fixture: &Fixture, mailbox: &str) -> Vec<String> {
    let mut found = fixture.server.world().subjects(mailbox);
    found.sort();
    found
}

impl Fixture {
    fn mailbox_id(&self, role: &str) -> i64 {
        let status = self.person("mail-status", json!({}));
        status["data"]["accounts"][0]["mailboxes"]
            .as_array()
            .unwrap()
            .iter()
            .find(|mailbox| mailbox["role"] == role)
            .unwrap()["mailbox"]
            .as_i64()
            .unwrap()
    }

    /// The id of the message whose words include `word`.
    fn message(&self, word: &str) -> i64 {
        let found = self.person("mail-search", json!({ "query": word }));
        found["data"]["hits"][0]["message"].as_i64().unwrap()
    }

    /// What the store shows: each current place's role and subject, in
    /// order.
    fn shown(&self) -> Vec<(String, String)> {
        let database = self.directory.path().join("data").join("mail.sqlite3");
        let connection = rusqlite::Connection::open(database).unwrap();
        let mut statement = connection
            .prepare(
                "SELECT mailbox.role, envelope.subject FROM observation
                 JOIN mailbox ON mailbox.id = observation.mailbox_id
                 JOIN envelope ON envelope.message_id = observation.message_id
                 WHERE observation.ended_at IS NULL
                 ORDER BY 1, 2",
            )
            .unwrap();
        statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    }

    /// What the store shows equals what a pass of sync finds.
    fn shown_as_synced(&self) {
        let before = self.shown();
        self.sync();
        assert_eq!(self.shown(), before, "the store showed what sync finds");
    }

    fn set_policy(&self, policy: Policy) {
        self.engine
            .with_store(|store| store.set_policy(&policy, 1).map(|_| ()))
            .unwrap();
    }

    /// A change as the person, which must succeed; its data.
    fn changed(&self, name: &str, input: Value) -> Value {
        let result = self.person(name, input);
        assert_eq!(result["success"], true, "{result}");
        assert_labelled(&result, FROM_MESSAGES);
        result["data"].clone()
    }

    fn select(&self, query: Value) -> (i64, i64) {
        let made = self.person("mail-selection-create", query);
        assert_eq!(made["success"], true, "{made}");
        (
            made["data"]["selection"].as_i64().unwrap(),
            made["data"]["count"].as_i64().unwrap(),
        )
    }

    /// Resumes operation `id` until it is done.
    fn resume_to_the_end(&self, id: i64) -> Value {
        for _ in 0..8 {
            let shown = self.person("mail-operation-show", json!({ "operation": id }));
            if shown["data"]["state"] == "done" {
                return shown["data"].clone();
            }
            self.person("mail-operation-resume", json!({ "operation": id }));
        }
        panic!("operation {id} did not finish");
    }
}

#[test]
fn archive_takes_mail_out_of_the_inbox_and_undo_puts_it_back() {
    let fixture = Fixture::new(world);
    let inbox = fixture.mailbox_id("inbox");
    let (selection, count) = fixture.select(json!({ "mailbox": inbox, "text": "s0" }));
    assert_eq!(count, 1);
    fixture.server.take_log();
    let archived = fixture.changed(
        "mail-archive",
        json!({ "selection": selection, "expectedCount": count }),
    );
    assert_eq!(archived["state"], "done");
    assert_eq!(archived["changed"], 1);
    assert_eq!(archived["command"], "mail-archive");
    // The selection's query is the caller's words, which mail may steer.
    assert_eq!(archived["query"]["trust"], "content", "{archived}");
    assert_eq!(subjects(&fixture, "Archive"), ["About s0"]);
    assert!(!subjects(&fixture, "INBOX").contains(&"About s0".to_string()));
    let log = fixture.server.take_log();
    // Without MOVE: a copy, the delete flag, and the removal of exactly the
    // message copied; never a bare EXPUNGE.
    assert!(
        log.iter().any(|line| line.starts_with("UID COPY")),
        "{log:?}"
    );
    assert!(
        log.iter().any(|line| line.starts_with("UID STORE")),
        "{log:?}"
    );
    assert!(
        log.iter().any(|line| line.starts_with("UID EXPUNGE")),
        "{log:?}"
    );
    assert!(
        !log.iter().any(|line| line.starts_with("EXPUNGE")),
        "{log:?}"
    );
    fixture.shown_as_synced();

    let undone = fixture.changed(
        "mail-operation-undo",
        json!({ "operation": archived["operation"] }),
    );
    assert_eq!(undone["state"], "done");
    assert_eq!(undone["changed"], 1);
    assert_eq!(undone["undoOf"], archived["operation"]);
    assert!(subjects(&fixture, "Archive").is_empty());
    assert!(subjects(&fixture, "INBOX").contains(&"About s0".to_string()));
    // Its flags came back with it: unread.
    let flags = fixture.server.world().contents("INBOX");
    assert!(
        flags
            .iter()
            .all(|(_, flags)| !flags.contains(&"\\Deleted".to_string()))
    );
    fixture.shown_as_synced();
    // Undone once, it is not undone again.
    let again = fixture.person(
        "mail-operation-undo",
        json!({ "operation": archived["operation"] }),
    );
    assert_eq!(again["error"]["code"], "INVALID_INPUT", "{again}");
}

#[test]
fn archive_leaves_mail_outside_the_inbox_as_it_is() {
    let fixture = Fixture::new(|world_| {
        world(world_);
        world_.add("Receipts", mail(NEWS, "r0", ""), &[]);
    });
    let receipt = fixture.message("r0");
    let archived = fixture.changed("mail-archive", json!({ "messages": [receipt] }));
    assert_eq!(archived["unchanged"], 1);
    assert_eq!(archived["changed"], 0);
    assert_eq!(subjects(&fixture, "Receipts"), ["About r0"]);
}

#[test]
fn with_move_a_trash_is_one_step_and_its_undo_restores_the_inbox() {
    let fixture = Fixture::new(|world_| {
        world(world_);
        world_.moves = true;
    });
    let ids = [fixture.message("n0"), fixture.message("n2")];
    fixture.server.take_log();
    let trashed = fixture.changed("mail-trash", json!({ "messages": ids }));
    assert_eq!(trashed["changed"], 2);
    let log = fixture.server.take_log();
    assert!(
        log.iter().any(|line| line.starts_with("UID MOVE")),
        "{log:?}"
    );
    assert!(
        !log.iter().any(|line| line.starts_with("UID COPY")),
        "{log:?}"
    );
    assert_eq!(
        subjects(&fixture, "Deleted Messages"),
        ["About n0", "About n2"]
    );
    fixture.shown_as_synced();
    fixture.changed(
        "mail-operation-undo",
        json!({ "operation": trashed["operation"] }),
    );
    assert!(subjects(&fixture, "Deleted Messages").is_empty());
    assert_eq!(subjects(&fixture, "INBOX").len(), 6);
    // n0 was read and n2 was not, as before.
    let inbox = fixture.server.world().contents("INBOX");
    let read = inbox
        .iter()
        .filter(|(_, flags)| flags.contains(&"\\Seen".to_string()))
        .count();
    assert_eq!(read, 2);
    fixture.shown_as_synced();
}

#[test]
fn a_wrong_count_or_an_expired_selection_changes_nothing() {
    let fixture = Fixture::new(world);
    let inbox = fixture.mailbox_id("inbox");
    let (selection, count) = fixture.select(json!({ "mailbox": inbox }));
    fixture.server.take_log();
    let wrong = fixture.person(
        "mail-trash",
        json!({ "selection": selection, "expectedCount": count - 1 }),
    );
    assert_eq!(wrong["error"]["code"], "SELECTION_MISMATCH", "{wrong}");
    assert!(
        fixture.server.take_log().is_empty(),
        "nothing was asked of the provider"
    );
    assert_eq!(subjects(&fixture, "INBOX").len(), 6);
    let none = fixture.person(
        "mail-trash",
        json!({ "selection": selection + 99, "expectedCount": count }),
    );
    assert_eq!(none["error"]["code"], "SELECTION_MISMATCH", "{none}");
    let without = fixture.person("mail-trash", json!({ "selection": selection }));
    assert_eq!(without["error"]["code"], "INVALID_INPUT", "{without}");
}

#[test]
fn a_change_acts_on_the_frozen_set_and_on_nothing_that_came_after() {
    let fixture = Fixture::new(world);
    let inbox = fixture.mailbox_id("inbox");
    let (selection, count) = fixture.select(json!({ "mailbox": inbox, "class": "unknown" }));
    assert_eq!(count, 2);
    fixture
        .server
        .world()
        .add("INBOX", mail(STRANGER, "s2", ""), &[]);
    fixture.sync();
    let trashed = fixture.changed(
        "mail-trash",
        json!({ "selection": selection, "expectedCount": count }),
    );
    assert_eq!(trashed["changed"], 2);
    assert_eq!(
        subjects(&fixture, "Deleted Messages"),
        ["About s0", "About s1"]
    );
    assert!(subjects(&fixture, "INBOX").contains(&"About s2".to_string()));
}

#[test]
fn mark_sets_flags_and_undo_puts_each_back_as_it_was() {
    let fixture = Fixture::new(world);
    let inbox = fixture.mailbox_id("inbox");
    let (selection, count) = fixture.select(json!({ "mailbox": inbox, "class": "bulk" }));
    assert_eq!(count, 4);
    let before = fixture.server.world().contents("INBOX");
    let marked = fixture.changed(
        "mail-mark",
        json!({ "selection": selection, "expectedCount": count, "read": true, "flagged": true }),
    );
    // Two were unread; all four were unflagged.
    assert_eq!(marked["changed"], 4, "{marked}");
    let after = fixture.server.world().contents("INBOX");
    for (uid, flags) in after.iter().take(4) {
        assert!(flags.contains(&"\\Seen".to_string()), "{uid}");
        assert!(flags.contains(&"\\Flagged".to_string()), "{uid}");
    }
    fixture.shown_as_synced();
    let read = fixture.changed(
        "mail-mark",
        json!({ "messages": [fixture.message("n0")], "read": true }),
    );
    assert_eq!(read["unchanged"], 1, "already read");
    fixture.changed(
        "mail-operation-undo",
        json!({ "operation": marked["operation"] }),
    );
    let mut restored = fixture.server.world().contents("INBOX");
    let mut expected = before;
    for flags in restored
        .iter_mut()
        .map(|(_, flags)| flags)
        .chain(expected.iter_mut().map(|(_, flags)| flags))
    {
        flags.sort();
    }
    assert_eq!(restored, expected, "each message's flags as they were");
}

#[test]
fn label_copies_and_undo_removes_only_a_copy_whose_original_is_still_there() {
    let fixture = Fixture::new(world);
    let receipts = fixture.mailbox_id("none");
    let ids = [fixture.message("s0"), fixture.message("s1")];
    let copied = fixture.changed(
        "mail-label",
        json!({ "messages": ids, "mailbox": receipts, "copy": true }),
    );
    assert_eq!(copied["changed"], 2);
    assert_eq!(subjects(&fixture, "Receipts"), ["About s0", "About s1"]);
    assert_eq!(subjects(&fixture, "INBOX").len(), 6);
    fixture.shown_as_synced();
    // One original goes, elsewhere: its copy is then the last of it.
    let gone = fixture
        .server
        .world()
        .contents("INBOX")
        .into_iter()
        .map(|(uid, _)| uid)
        .next_back()
        .unwrap();
    fixture.server.world().expunge("INBOX", gone);
    let undone = fixture.changed(
        "mail-operation-undo",
        json!({ "operation": copied["operation"] }),
    );
    assert_eq!(undone["changed"], 1);
    assert_eq!(undone["missing"], 1, "the copy whose original went stays");
    assert_eq!(subjects(&fixture, "Receipts"), ["About s1"]);
}

#[test]
fn label_moves_within_its_account_and_refuses_a_mailbox_that_is_not_there() {
    let fixture = Fixture::new(world);
    let receipts = fixture.mailbox_id("none");
    let moved = fixture.changed(
        "mail-label",
        json!({ "messages": [fixture.message("n3")], "mailbox": receipts }),
    );
    assert_eq!(moved["changed"], 1);
    assert_eq!(subjects(&fixture, "Receipts"), ["About n3"]);
    assert_eq!(subjects(&fixture, "INBOX").len(), 5);
    let nowhere = fixture.person(
        "mail-label",
        json!({ "messages": [fixture.message("n1")], "mailbox": 999 }),
    );
    assert_eq!(nowhere["error"]["code"], "MAILBOX_NOT_FOUND", "{nowhere}");
}

#[test]
fn an_agent_within_the_policy_changes_mail_and_over_it_proposes() {
    let fixture = Fixture::new(world);
    fixture.set_policy(Policy {
        change_per_call: 2,
        trash_per_call: 2,
        trash_per_day: 3,
        ask_above: 200,
    });
    let news: Vec<i64> = (0..4).map(|n| fixture.message(&format!("n{n}"))).collect();
    let over = fixture.agent("a", "mail-archive", json!({ "messages": news }));
    // Over the policy, it is a proposal, which changes nothing (M28).
    assert_eq!(over["data"]["state"], "proposed", "{over}");
    assert_eq!(subjects(&fixture, "INBOX").len(), 6, "nothing changed");
    let within = fixture.agent("a", "mail-archive", json!({ "messages": &news[..2] }));
    assert_eq!(within["success"], true, "{within}");
    assert_eq!(within["data"]["creator"]["kind"], "agent");
    // Two to the trash, then two more is over the three a day.
    let first = fixture.agent("a", "mail-trash", json!({ "messages": &news[2..] }));
    assert_eq!(first["success"], true, "{first}");
    let strangers = [fixture.message("s0"), fixture.message("s1")];
    let second = fixture.agent("a", "mail-trash", json!({ "messages": strangers }));
    assert_eq!(second["data"]["state"], "proposed", "{second}");
    // Another agent has a day of its own; a move into the trash by label
    // counts as trash.
    let trash = fixture.mailbox_id("trash");
    let other = fixture.agent(
        "b",
        "mail-label",
        json!({ "messages": strangers, "mailbox": trash }),
    );
    assert_eq!(other["success"], true, "{other}");
    assert_eq!(subjects(&fixture, "Deleted Messages").len(), 4);
    // A script is under the policy too; the person is not.
    let undo_all = fixture.cli(
        "mail-operation-undo",
        json!({ "operation": first["data"]["operation"] }),
    );
    assert_eq!(undo_all["success"], true, "{undo_all}");
    fixture.set_policy(Policy {
        change_per_call: 0,
        trash_per_call: 0,
        trash_per_day: 0,
        ask_above: 200,
    });
    let script = fixture.cli("mail-mark", json!({ "messages": [news[0]], "read": false }));
    assert_eq!(script["data"]["state"], "proposed", "{script}");
    fixture.changed("mail-mark", json!({ "messages": news, "read": false }));
}

/// The person trashes three messages while the server drops the connection
/// at `drop`; resumed, each is moved once.
fn stopped_and_resumed(moves: bool, drop: impl FnOnce(&mut World)) {
    let fixture = Fixture::new(|world_| {
        world(world_);
        world_.moves = moves;
    });
    let ids = [
        fixture.message("n1"),
        fixture.message("n2"),
        fixture.message("s1"),
    ];
    drop(&mut fixture.server.world());
    let first = fixture.person("mail-trash", json!({ "messages": ids }));
    let id = if first["success"] == true {
        first["data"]["operation"].as_i64().unwrap()
    } else {
        assert_eq!(first["error"]["code"], "PROVIDER_UNAVAILABLE", "{first}");
        assert_eq!(first["error"]["details"]["state"], "stopped", "{first}");
        first["error"]["details"]["operation"].as_i64().unwrap()
    };
    let done = fixture.resume_to_the_end(id);
    assert_eq!(done["changed"], 3, "{done}");
    assert_eq!(
        subjects(&fixture, "Deleted Messages"),
        ["About n1", "About n2", "About s1"],
        "each moved once"
    );
    assert_eq!(
        subjects(&fixture, "INBOX"),
        ["About n0", "About n3", "About s0"]
    );
    fixture.shown_as_synced();
}

#[test]
fn a_move_without_move_resumes_from_a_stop_after_each_of_its_steps() {
    // Before each command a run sends, from signing in to the removal.
    for before in 0..12 {
        stopped_and_resumed(false, |world| world.drop_after_commands = Some(before));
    }
    // And after each change is made, with its answer lost.
    for verb in ["COPY", "STORE", "EXPUNGE"] {
        stopped_and_resumed(false, |world| {
            world.drop_after_doing = Some(verb.to_string());
        });
    }
}

#[test]
fn a_move_whose_answer_was_lost_is_found_and_not_made_twice() {
    stopped_and_resumed(true, |world| {
        world.drop_after_doing = Some("MOVE".to_string());
    });
    for before in 0..10 {
        stopped_and_resumed(true, |world| world.drop_after_commands = Some(before));
    }
}

#[test]
fn an_unreturned_message_is_changed_by_its_id_and_one_ignored_is_reported() {
    let fixture = Fixture::new(|world_| {
        world(world_);
        let hidden = world_.add("INBOX", mail(STRANGER, "h0", ""), &[]);
        world_.find("INBOX").never_return.insert(hidden);
        let stuck = world_.add("INBOX", mail(STRANGER, "k0", ""), &[]);
        world_.find("INBOX").never_return.insert(stuck);
        world_.find("INBOX").never_copy.insert(stuck);
    });
    let database = fixture.directory.path().join("data").join("mail.sqlite3");
    rusqlite::Connection::open(database)
        .unwrap()
        .execute("UPDATE unreturned SET tries = 100", [])
        .unwrap();
    let inbox = fixture.mailbox_id("inbox");
    let (selection, count) = fixture.select(json!({ "mailbox": inbox }));
    assert_eq!(count, 8);
    let trashed = fixture.changed(
        "mail-trash",
        json!({ "selection": selection, "expectedCount": count }),
    );
    assert_eq!(trashed["changed"], 7);
    assert_eq!(trashed["ignored"], 1, "the provider left one where it was");
    assert_eq!(fixture.server.world().contents("INBOX").len(), 1);
    assert_eq!(fixture.server.world().contents("Deleted Messages").len(), 7);
}

#[test]
fn a_stopped_operation_is_cancelled_shown_and_listed() {
    let fixture = Fixture::with_changes(
        world,
        ChangeOptions {
            batch: 1,
            ..ChangeOptions::default()
        },
    );
    let ids: Vec<i64> = (0..4).map(|n| fixture.message(&format!("n{n}"))).collect();
    // The connection drops in the second batch, before its copy.
    fixture.server.world().drop_after_commands = Some(14);
    let first = fixture.person("mail-archive", json!({ "messages": ids }));
    assert_eq!(first["success"], false, "{first}");
    let id = first["error"]["details"]["operation"].as_i64().unwrap();
    let cancelled = fixture.person("mail-operation-cancel", json!({ "operation": id }));
    assert_eq!(cancelled["success"], true, "{cancelled}");
    assert_eq!(cancelled["data"]["stopping"], false, "it had stopped");
    let shown = fixture.person(
        "mail-operation-show",
        json!({ "operation": id, "limit": 2 }),
    );
    assert_eq!(shown["data"]["state"], "stopped", "{shown}");
    assert!(shown["data"]["error"].is_string());
    assert_eq!(shown["data"]["items"].as_array().unwrap().len(), 2);
    let next = shown["data"]["nextCursor"].as_str().unwrap().to_string();
    let rest = fixture.person(
        "mail-operation-show",
        json!({ "operation": id, "cursor": next, "limit": 10 }),
    );
    assert_eq!(rest["data"]["items"].as_array().unwrap().len(), 2);
    assert!(rest["data"]["nextCursor"].is_null());
    let status = fixture.person("mail-status", json!({}));
    assert_eq!(status["data"]["operations"]["stopped"], 1, "{status}");
    let done = fixture.resume_to_the_end(id);
    assert_eq!(done["changed"], 4);
    let again = fixture.person("mail-operation-resume", json!({ "operation": id }));
    assert_eq!(again["error"]["code"], "INVALID_INPUT", "{again}");
    let listed = fixture.agent("a", "mail-operation-list", json!({ "limit": 1 }));
    assert_eq!(listed["data"]["operations"][0]["operation"], id);
    assert!(listed["data"]["nextCursor"].is_null());
    let missing = fixture.person("mail-operation-show", json!({ "operation": 999 }));
    assert_eq!(missing["error"]["code"], "OPERATION_NOT_FOUND");
}

#[test]
fn the_person_is_asked_at_the_terminal_above_the_policys_count() {
    let fixture = Fixture::new(world);
    fixture.set_policy(Policy {
        ask_above: 2,
        ..Policy::DEFAULT
    });
    let ids: Vec<i64> = (0..3).map(|n| fixture.message(&format!("n{n}"))).collect();
    let input = json!({ "messages": ids }).to_string();
    let (status, _, err, asked) = fixture.terminal(&["mail-archive", &input], false);
    assert_eq!(status, EXIT_FAILED);
    assert!(err.contains("Archive 3 messages."), "{err}");
    assert_eq!(asked.len(), 1);
    assert_eq!(subjects(&fixture, "Archive").len(), 0, "nothing was done");
    let (status, out, _, _) = fixture.terminal(&["mail-archive", &input], true);
    assert_eq!(status, EXIT_OK, "{out}");
    assert_eq!(subjects(&fixture, "Archive").len(), 3);
    // Two is not above two: not asked.
    let two = json!({ "messages": &ids[..2], "read": true }).to_string();
    let (status, _, _, asked) = fixture.terminal(&["mail-mark", &two], false);
    assert_eq!(status, EXIT_OK);
    assert!(asked.is_empty());
}

#[test]
fn a_change_too_large_for_a_call_runs_as_the_servers_work_and_stops_when_cancelled() {
    let fixture = Fixture::with_changes(
        world,
        ChangeOptions {
            batch: 1,
            inline_most: 1,
            slice: 1,
        },
    );
    let ids: Vec<i64> = (0..4).map(|n| fixture.message(&format!("n{n}"))).collect();
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .unwrap();
    runtime.block_on(async {
        let worker = loam_mail::work::Worker::start(&fixture.engine);
        // Let the first pass of sync go by.
        let started = Instant::now();
        while fixture.engine.work().status()["sync"]["last"].is_null() {
            assert!(started.elapsed() < Duration::from_secs(30));
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        fixture.server.world().slow = Some(Duration::from_millis(40));
        let person = afd::CommandContext::new()
            .with_interface(afd::CommandInterface::Cli)
            .with_actor(afd::ActorKind::Human);
        let made = fixture
            .registry
            .execute(
                "mail-archive",
                json!({ "messages": ids }),
                Some(person.clone()),
            )
            .await;
        let made = serde_json::to_value(&made).unwrap();
        assert_eq!(made["data"]["state"], "running", "{made}");
        let id = made["data"]["operation"].as_i64().unwrap();
        let cancelled = fixture
            .registry
            .execute(
                "mail-operation-cancel",
                json!({ "operation": id }),
                Some(person.clone()),
            )
            .await;
        let cancelled = serde_json::to_value(&cancelled).unwrap();
        assert_eq!(cancelled["data"]["stopping"], true, "{cancelled}");
        let started = Instant::now();
        let shown = loop {
            let shown = fixture
                .registry
                .execute(
                    "mail-operation-show",
                    json!({ "operation": id }),
                    Some(person.clone()),
                )
                .await;
            let shown = serde_json::to_value(&shown).unwrap();
            if shown["data"]["state"] != "running" {
                break shown;
            }
            assert!(started.elapsed() < Duration::from_secs(30));
            tokio::time::sleep(Duration::from_millis(20)).await;
        };
        assert_eq!(shown["data"]["state"], "stopped", "{shown}");
        let changed = shown["data"]["changed"].as_u64().unwrap();
        assert!(changed < 4, "stopped after the batch in hand: {shown}");
        fixture.server.world().slow = None;
        // Until the work has ended its slice, the operation is still its.
        let started = Instant::now();
        loop {
            let resumed = fixture
                .registry
                .execute(
                    "mail-operation-resume",
                    json!({ "operation": id }),
                    Some(person.clone()),
                )
                .await;
            let resumed = serde_json::to_value(&resumed).unwrap();
            if resumed["success"] == true {
                break;
            }
            assert_eq!(resumed["error"]["code"], "WORK_RUNNING", "{resumed}");
            assert!(started.elapsed() < Duration::from_secs(30));
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        let started = Instant::now();
        loop {
            let shown = fixture
                .registry
                .execute(
                    "mail-operation-show",
                    json!({ "operation": id }),
                    Some(person.clone()),
                )
                .await;
            let shown = serde_json::to_value(&shown).unwrap();
            if shown["data"]["state"] == "done" {
                assert_eq!(shown["data"]["changed"], 4);
                break;
            }
            assert!(started.elapsed() < Duration::from_secs(30), "{shown}");
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        assert!(
            !fixture.engine.work().status()["operations"]["last"].is_null(),
            "the work reports it"
        );
        worker.stop().await;
    });
    assert_eq!(subjects(&fixture, "Archive").len(), 4);
}

#[test]
fn removing_the_account_removes_its_operations_and_their_undos() {
    let fixture = Fixture::new(world);
    let trashed = fixture.changed("mail-trash", json!({ "messages": [fixture.message("n0")] }));
    fixture.changed(
        "mail-operation-undo",
        json!({ "operation": trashed["operation"] }),
    );
    let account = fixture.account.id;
    fixture
        .engine
        .with_store(|store| store.remove_account(account, 2).map(|_| ()))
        .unwrap();
    let listed = fixture.person("mail-operation-list", json!({}));
    assert_eq!(listed["data"]["operations"], json!([]));
}

#[test]
fn a_move_leaves_the_persons_sent_copies_unless_their_mailbox_is_named() {
    let fixture = Fixture::new(|world_| {
        world(world_);
        world_.mailbox("Sent Messages", &["\\Sent"]);
        world_.add("Sent Messages", mail(STRANGER, "s0", ""), &["\\Seen"]);
    });
    let trashed = fixture.changed("mail-trash", json!({ "messages": [fixture.message("s0")] }));
    assert_eq!(trashed["changed"], 1, "{trashed}");
    assert_eq!(trashed["unchanged"], 1, "the sent copy stays");
    assert_eq!(subjects(&fixture, "Sent Messages"), ["About s0"]);
    let sent = fixture.mailbox_id("sent");
    let (selection, count) = fixture.select(json!({ "mailbox": sent }));
    let named = fixture.changed(
        "mail-trash",
        json!({ "selection": selection, "expectedCount": count }),
    );
    assert_eq!(named["changed"], 1, "{named}");
    assert!(subjects(&fixture, "Sent Messages").is_empty());
}

#[test]
fn an_operation_stopped_part_way_through_a_move_is_finished_before_it_is_undone() {
    let fixture = Fixture::new(world);
    let ids = [fixture.message("n2"), fixture.message("s0")];
    // The originals are flagged to be deleted, and the answer is lost.
    fixture.server.world().drop_after_doing = Some("STORE".to_string());
    let first = fixture.person("mail-trash", json!({ "messages": ids }));
    let id = first["error"]["details"]["operation"].as_i64().unwrap();
    let refused = fixture.person("mail-operation-undo", json!({ "operation": id }));
    assert_eq!(refused["error"]["code"], "INVALID_INPUT", "{refused}");
    assert!(
        refused["error"]["suggestion"]
            .as_str()
            .unwrap()
            .contains("mail-operation-resume")
    );
    fixture.resume_to_the_end(id);
    fixture.changed("mail-operation-undo", json!({ "operation": id }));
    assert_eq!(subjects(&fixture, "INBOX").len(), 6);
    let flagged_to_go = fixture
        .server
        .world()
        .contents("INBOX")
        .into_iter()
        .filter(|(_, flags)| flags.contains(&"\\Deleted".to_string()))
        .count();
    assert_eq!(
        flagged_to_go, 0,
        "no original is left flagged to be deleted"
    );
    assert!(subjects(&fixture, "Deleted Messages").is_empty());
}

#[test]
fn a_mark_whose_answer_was_lost_keeps_the_flags_it_had_before() {
    let fixture = Fixture::new(world);
    let id = fixture.message("s1");
    // Two flags, set one after the other: the answer to the first is lost.
    fixture.server.world().drop_after_doing = Some("STORE".to_string());
    let first = fixture.person(
        "mail-mark",
        json!({ "messages": [id], "read": true, "flagged": true }),
    );
    let operation = first["error"]["details"]["operation"].as_i64().unwrap();
    let done = fixture.resume_to_the_end(operation);
    assert_eq!(done["changed"], 1, "{done}");
    fixture.changed("mail-operation-undo", json!({ "operation": operation }));
    let inbox = fixture.server.world().contents("INBOX");
    let (_, flags) = inbox.last().unwrap();
    assert!(
        flags.is_empty(),
        "unread and unflagged, as it was: {flags:?}"
    );
}

#[test]
fn an_unreturned_messages_lost_copy_is_never_guessed_at() {
    let fixture = Fixture::new(|world_| {
        world(world_);
        let hidden = world_.add("INBOX", mail(STRANGER, "h0", ""), &[]);
        world_.find("INBOX").never_return.insert(hidden);
    });
    let database = fixture.directory.path().join("data").join("mail.sqlite3");
    rusqlite::Connection::open(database)
        .unwrap()
        .execute("UPDATE unreturned SET tries = 100", [])
        .unwrap();
    let inbox = fixture.mailbox_id("inbox");
    let (selection, count) = fixture.select(json!({ "mailbox": inbox }));
    assert_eq!(count, 7);
    // Signing in, opening, finding, flags, the trash's next id: the
    // connection drops as the copy is asked for, before it is made.
    fixture.server.world().drop_after_commands = Some(7);
    let first = fixture.person(
        "mail-trash",
        json!({ "selection": selection, "expectedCount": count }),
    );
    let id = first["error"]["details"]["operation"].as_i64().unwrap();
    // Another message whose headers the provider never returns arrives in
    // the trash: counted alone, it would pass for the lost copy.
    {
        let mut world = fixture.server.world();
        let planted = world.add("Deleted Messages", mail(STRANGER, "p0", ""), &[]);
        world.find("Deleted Messages").never_return.insert(planted);
    }
    fixture.resume_to_the_end(id);
    let trash = subjects(&fixture, "Deleted Messages");
    assert_eq!(trash.len(), 8, "{trash:?}");
    assert!(
        trash.contains(&"About h0".to_string()),
        "the hidden message was copied"
    );
    assert!(subjects(&fixture, "INBOX").is_empty());
}

#[test]
fn undo_keeps_a_copy_whose_original_is_flagged_to_be_deleted() {
    let fixture = Fixture::new(world);
    let receipts = fixture.mailbox_id("none");
    let copied = fixture.changed(
        "mail-label",
        json!({ "messages": [fixture.message("s0")], "mailbox": receipts, "copy": true }),
    );
    // Another client flags the original to be deleted.
    let s0 = fixture
        .server
        .world()
        .subjects("INBOX")
        .iter()
        .position(|subject| subject == "About s0")
        .unwrap();
    let uid = fixture.server.world().contents("INBOX")[s0].0;
    fixture
        .server
        .world()
        .set_flags("INBOX", uid, &["\\Deleted"]);
    let undone = fixture.changed(
        "mail-operation-undo",
        json!({ "operation": copied["operation"] }),
    );
    assert_eq!(undone["missing"], 1, "{undone}");
    assert_eq!(subjects(&fixture, "Receipts"), ["About s0"]);
}

#[test]
fn a_move_into_junk_counts_as_trash() {
    let fixture = Fixture::new(world);
    fixture.set_policy(Policy {
        trash_per_call: 0,
        trash_per_day: 0,
        ..Policy::DEFAULT
    });
    let junk = fixture.mailbox_id("junk");
    let moved = fixture.agent(
        "a",
        "mail-label",
        json!({ "messages": [fixture.message("s0")], "mailbox": junk }),
    );
    assert_eq!(moved["data"]["state"], "proposed", "{moved}");
    assert_eq!(moved["data"]["proposal"]["proposer"]["kind"], "agent");
    let copied = fixture.agent(
        "a",
        "mail-label",
        json!({ "messages": [fixture.message("s0")], "mailbox": junk, "copy": true }),
    );
    assert_eq!(
        copied["success"], true,
        "a copy leaves the mail where it is: {copied}"
    );
}
