//! Proposals (the specification's 9.4 and M28), on the scripted IMAP
//! server: a change an agent or a script may not make alone waits for the
//! person, changes nothing until they approve it at the terminal after its
//! preview, and then touches exactly its frozen set. A caller has five
//! waiting at most; a proposal goes after seven days, or when the person or
//! its proposer dismisses it.

#![allow(clippy::expect_used, clippy::unwrap_used)]

mod support;

use afd::{Actor, ActorKind, Clock, CommandContext, CommandInterface, ManualClock};
use loam_mail::cli::{Caller, EXIT_FAILED, EXIT_OK, run};
use loam_mail::operate::ChangeOptions;
use loam_mail::secrets::InMemory;
use loam_mail::store::{PROPOSAL_LIFETIME, Policy, SELECTION_LIFETIME, sender_id};
use serde_json::{Value, json};
use support::imap::World;
use support::synced::{Fixture, assert_labelled, mail};

const NEWS: &str = "News <news@example.net>";
const STRANGER: &str = "Stranger <stranger@example.biz>";

/// Words that appear only in the messages: none may appear in a result
/// outside a labelled part.
const FROM_MESSAGES: &[&str] = &["news@", "stranger@", "About ", "Words of"];

/// An inbox of four from a list and two from a stranger, with the mailboxes
/// a change moves mail to.
fn world(world: &mut World) {
    world.mailbox("INBOX", &[]);
    world.mailbox("Archive", &["\\Archive"]);
    world.mailbox("Deleted Messages", &["\\Trash"]);
    for number in 0..4 {
        world.add(
            "INBOX",
            mail(
                NEWS,
                &format!("n{number}"),
                "List-Id: <news.example.net>\r\n",
            ),
            &[],
        );
    }
    for number in 0..2 {
        world.add("INBOX", mail(STRANGER, &format!("s{number}"), ""), &[]);
    }
}

/// A policy under which an agent may change nothing alone.
const NOTHING_ALONE: Policy = Policy {
    change_per_call: 0,
    trash_per_call: 0,
    trash_per_day: 0,
    ask_above: 200,
};

fn subjects(fixture: &Fixture, mailbox: &str) -> Vec<String> {
    let mut found = fixture.server.world().subjects(mailbox);
    found.sort();
    found
}

/// Whether the provider was asked to change anything since the log was
/// last taken.
fn changed_at_the_provider(fixture: &Fixture) -> bool {
    fixture.server.take_log().iter().any(|line| {
        [
            "UID COPY",
            "UID MOVE",
            "UID STORE",
            "UID EXPUNGE",
            "EXPUNGE",
        ]
        .iter()
        .any(|command| line.starts_with(command))
    })
}

impl Fixture {
    fn set_policy(&self, policy: Policy) {
        self.engine
            .with_store(|store| store.set_policy(&policy, 1).map(|_| ()))
            .unwrap();
    }

    /// The id of the message whose words include `word`.
    fn message(&self, word: &str) -> i64 {
        let found = self.person("mail-search", json!({ "query": word }));
        found["data"]["hits"][0]["message"].as_i64().unwrap()
    }

    fn select(&self, query: Value) -> (i64, i64) {
        let made = self.agent("a", "mail-selection-create", query);
        assert_eq!(made["success"], true, "{made}");
        (
            made["data"]["selection"].as_i64().unwrap(),
            made["data"]["count"].as_i64().unwrap(),
        )
    }

    /// A proposal by the agent `token`, which must be made; its data.
    fn proposal(&self, token: &str, name: &str, input: Value) -> Value {
        let made = self.agent(token, name, input);
        assert_eq!(made["success"], true, "{made}");
        assert_eq!(made["data"]["state"], "proposed", "{made}");
        assert_labelled(&made, FROM_MESSAGES);
        made["data"].clone()
    }

    fn show(&self, id: &Value) -> Value {
        let shown = self.person("mail-operation-show", json!({ "operation": id }));
        assert_eq!(shown["success"], true, "{shown}");
        assert_labelled(&shown, FROM_MESSAGES);
        shown["data"].clone()
    }

    /// Approves operation `id` at the terminal, answering `yes`; the status,
    /// what was printed, and what the person read before the question.
    fn approve(&self, id: &Value, yes: bool) -> (u8, String, String) {
        let input = json!({ "operation": id }).to_string();
        let (status, out, err, _) = self.terminal(&["mail-operation-approve", &input], yes);
        (status, out, err)
    }

    /// The current preview digest of open proposal `id`.
    fn digest(&self, id: &Value) -> String {
        self.show(id)["preview"]["digest"]
            .as_str()
            .expect("open proposal preview carries a digest")
            .to_string()
    }

    /// The person's approval of open proposal `id` as the middleware issues it:
    /// held first, its token then good for a retry with the same `digest`.
    fn token(&self, id: &Value, digest: &str) -> String {
        let held = self.person(
            "mail-operation-approve",
            json!({ "operation": id, "digest": digest }),
        );
        assert_eq!(held["error"]["code"], "APPROVAL_REQUIRED", "{held}");
        held["error"]["details"]["approvalToken"]
            .as_str()
            .unwrap()
            .to_string()
    }

    /// `mail-operation-approve` of `id`, run with the person's approval
    /// `token` and preview `digest`, past the middleware into the command.
    fn approved_with(&self, id: &Value, digest: &str, token: String) -> Value {
        let context = CommandContext::new()
            .with_interface(CommandInterface::Cli)
            .with_actor(ActorKind::Human)
            .with_approval(token);
        self.execute(
            "mail-operation-approve",
            json!({ "operation": id, "digest": digest }),
            context,
        )
    }

    /// The command line run by a script, with no terminal; what it printed.
    fn as_script(&self, args: &[&str]) -> (u8, String) {
        let args: Vec<String> = args.iter().map(ToString::to_string).collect();
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let status = run(
            &args,
            &self.registry,
            Caller::Script,
            &InMemory::default(),
            &mut out,
            &mut err,
        )
        .unwrap();
        (status, String::from_utf8(out).unwrap())
    }

    /// A call from agent `token` at the time `clock` shows.
    fn agent_at(&self, token: &str, clock: &ManualClock, name: &str, input: Value) -> Value {
        let context = CommandContext::new()
            .with_interface(CommandInterface::Mcp)
            .with_actor(Actor::new(ActorKind::Agent).with_id(token))
            .with_clock(clock.clone());
        self.execute(name, input, context)
    }
}

#[test]
fn an_agents_change_over_the_policy_waits_and_changes_nothing_until_approved() {
    let fixture = Fixture::new(world);
    fixture.set_policy(NOTHING_ALONE);
    let (selection, count) = fixture.select(json!({ "text": "Words" }));
    assert_eq!(count, 6);
    fixture.server.take_log();
    let proposal = fixture.proposal(
        "a",
        "mail-trash",
        json!({ "selection": selection, "expectedCount": count }),
    );
    let id = proposal["operation"].clone();
    assert!(
        !changed_at_the_provider(&fixture),
        "nothing was asked of it"
    );
    assert_eq!(subjects(&fixture, "INBOX").len(), 6);
    assert_eq!(proposal["messages"], 6);
    assert_eq!(proposal["waiting"], 6);
    assert_eq!(proposal["proposal"]["proposer"]["token"], "a");
    assert!(
        proposal["proposal"]["why"]
            .as_str()
            .unwrap()
            .contains("more than the 0"),
        "{proposal}"
    );
    assert_eq!(
        proposal["proposal"]["expiresAt"].as_i64().unwrap()
            - proposal["proposal"]["proposedAt"].as_i64().unwrap(),
        PROPOSAL_LIFETIME
    );
    // A wrong count is refused as for any change, and proposes nothing.
    let wrong = fixture.agent(
        "a",
        "mail-trash",
        json!({ "selection": selection, "expectedCount": 5 }),
    );
    assert_eq!(wrong["error"]["code"], "SELECTION_MISMATCH", "{wrong}");

    // What awaits the person is in the status and the list.
    let status = fixture.person("mail-status", json!({}));
    assert_eq!(status["data"]["operations"]["proposed"], 1, "{status}");
    let waiting = &status["data"]["operations"]["proposals"][0];
    assert_eq!(waiting["operation"], id);
    assert_eq!(waiting["command"], "mail-trash");
    assert_eq!(waiting["messages"], 6);
    assert_eq!(waiting["proposal"]["proposer"]["kind"], "agent");
    let listed = fixture.person("mail-operation-list", json!({ "proposed": true }));
    assert_eq!(listed["data"]["operations"].as_array().unwrap().len(), 1);

    // The agent cannot carry it on, approve it or undo it itself.
    let resumed = fixture.agent("a", "mail-operation-resume", json!({ "operation": id }));
    assert_eq!(resumed["error"]["code"], "INVALID_INPUT", "{resumed}");
    let undone = fixture.agent("a", "mail-operation-undo", json!({ "operation": id }));
    assert_eq!(undone["error"]["code"], "INVALID_INPUT", "{undone}");
    // `mail-operation-approve` is released over MCP (M18 amended, F2a), held
    // for approval for every caller; a non-approver agent gets no token.
    let digest = fixture.digest(&id);
    let approved = fixture.agent(
        "a",
        "mail-operation-approve",
        json!({ "operation": id, "digest": digest }),
    );
    assert_eq!(approved["error"]["code"], "APPROVAL_REQUIRED", "{approved}");
    assert_eq!(approved["error"]["retryable"], false, "{approved}");
    assert!(
        approved["error"]["details"].get("approvalToken").is_none(),
        "non-approver must never receive an approval token: {approved}"
    );
    // Nor can a script at the command line, which has no terminal.
    let input = json!({ "operation": id, "digest": digest }).to_string();
    let (status, out) = fixture.as_script(&["mail-operation-approve", &input]);
    assert_eq!(status, EXIT_FAILED);
    assert!(out.contains("PERSON_REQUIRED"), "{out}");

    // Mail that arrives after the proposal matches its query, and is left.
    fixture
        .server
        .world()
        .add("INBOX", mail(STRANGER, "late", "Words of late"), &[]);
    fixture.sync();
    assert!(!changed_at_the_provider(&fixture));

    // The person says no: nothing changes, and it still waits.
    let (status, _, _) = fixture.approve(&id, false);
    assert_eq!(status, EXIT_FAILED);
    assert!(!changed_at_the_provider(&fixture));
    assert_eq!(fixture.show(&id)["state"], "proposed");

    // The person says yes: it runs, as the person's, on its frozen set.
    let (status, out, err) = fixture.approve(&id, true);
    assert_eq!(status, EXIT_OK, "{out}{err}");
    let done = fixture.show(&id);
    assert_eq!(done["state"], "done", "{done}");
    assert_eq!(done["changed"], 6);
    assert!(done["proposal"]["approvedAt"].is_i64());
    assert_eq!(subjects(&fixture, "INBOX"), ["About late"]);
    assert_eq!(subjects(&fixture, "Deleted Messages").len(), 6);
    // Approved once, it is not approved again, and refuses before any hold.
    let again = fixture.person(
        "mail-operation-approve",
        json!({ "operation": id, "digest": digest }),
    );
    assert_eq!(again["error"]["code"], "PROPOSAL_NOT_OPEN", "{again}");

    // It does not count against the proposer's day: two to the trash a day
    // is still the agent's to make.
    fixture.set_policy(Policy {
        trash_per_call: 2,
        trash_per_day: 2,
        ..NOTHING_ALONE
    });
    let late = fixture.message("late");
    let trashed = fixture.agent("a", "mail-trash", json!({ "messages": [late] }));
    assert_eq!(trashed["data"]["state"], "done", "{trashed}");
    // And the person undoes it like any other.
    let undo = fixture.person("mail-operation-undo", json!({ "operation": id }));
    assert_eq!(undo["data"]["state"], "done", "{undo}");
    assert_eq!(subjects(&fixture, "INBOX").len(), 6);
}

#[test]
fn the_preview_gives_the_query_the_counts_and_known_senders() {
    let fixture = Fixture::new(world);
    fixture.set_policy(NOTHING_ALONE);
    // The person knows the list's sender.
    let screened = fixture.person(
        "mail-sender-screen",
        json!({ "sender": sender_id("news@example.net"), "decision": "in" }),
    );
    assert_eq!(screened["success"], true, "{screened}");
    let (selection, count) = fixture.select(json!({ "text": "Words" }));
    let proposal = fixture.proposal(
        "a",
        "mail-archive",
        json!({ "selection": selection, "expectedCount": count }),
    );
    let id = proposal["operation"].clone();
    let shown = fixture.show(&id);
    let preview = &shown["preview"];
    assert_eq!(preview["approvable"], true, "{shown}");
    assert_eq!(preview["byAccount"][0]["places"], 6);
    assert_eq!(preview["byMailbox"][0]["role"], "inbox");
    assert_eq!(preview["byMailbox"][0]["name"]["trust"], "content");
    assert_eq!(preview["destinations"][0]["role"], "archive");
    assert_eq!(preview["byClass"]["known"], 4, "{preview}");
    assert_eq!(preview["byClass"]["unknown"], 2, "{preview}");
    assert_eq!(preview["knownSenders"]["messages"], 4);
    assert_eq!(preview["knownSenders"]["senders"], 1);
    // The query is the agent's words, which mail may have steered.
    assert_eq!(shown["query"]["trust"], "content");

    let (status, _, err) = fixture.approve(&id, false);
    assert_eq!(status, EXIT_FAILED);
    assert!(
        err.contains("proposed by the agent with the token a"),
        "{err}"
    );
    assert!(err.contains("as the proposer wrote it"), "{err}");
    assert!(err.contains("\"text\":\"Words\""), "{err}");
    assert!(err.contains("From mailbox"), "{err}");
    assert!(err.contains("(inbox; its name, as the provider writes it: INBOX): 6 places"));
    assert!(err.contains("Into mailbox"), "{err}");
    assert!(
        err.contains("By class: 4 known, 0 bulk, 2 unknown"),
        "{err}"
    );
    assert!(
        err.contains("it holds 4 messages from 1 sender you know"),
        "{err}"
    );
    // The summary holds counts alone.
    let summary = err
        .lines()
        .find(|line| line.starts_with("Approve operation"))
        .unwrap();
    assert!(
        summary.contains("archive 6 messages, proposed by the agent with the token a"),
        "{summary}"
    );
    for word in FROM_MESSAGES.iter().chain(&["INBOX", "Words"]) {
        assert!(!summary.contains(word), "{summary}");
    }

    // A set with no known sender's mail has no such line.
    let strangers = [fixture.message("s0"), fixture.message("s1")];
    let other = fixture.proposal("a", "mail-archive", json!({ "messages": strangers }));
    let (_, _, err) = fixture.approve(&other["operation"], false);
    assert!(!err.contains("senders you know"), "{err}");
    assert!(err.contains("2 unknown"), "{err}");
}

#[test]
fn a_caller_has_five_proposals_waiting_and_dismissing_one_makes_room() {
    let fixture = Fixture::new(world);
    fixture.set_policy(NOTHING_ALONE);
    let message = fixture.message("s0");
    let mut made = Vec::new();
    for _ in 0..5 {
        made.push(
            fixture.proposal("a", "mail-archive", json!({ "messages": [message] }))["operation"]
                .clone(),
        );
    }
    let sixth = fixture.agent("a", "mail-archive", json!({ "messages": [message] }));
    assert_eq!(sixth["error"]["code"], "POLICY_LIMIT", "{sixth}");
    // Another caller has five of its own.
    fixture.proposal("b", "mail-archive", json!({ "messages": [message] }));
    // An agent dismisses only its own; the person, any.
    let theirs = fixture.agent(
        "b",
        "mail-operation-dismiss",
        json!({ "operation": made[0] }),
    );
    assert_eq!(theirs["error"]["code"], "FORBIDDEN", "{theirs}");
    let own = fixture.agent(
        "a",
        "mail-operation-dismiss",
        json!({ "operation": made[0] }),
    );
    assert_eq!(own["data"]["state"], "dismissed", "{own}");
    assert_eq!(own["data"]["places"], 0, "its frozen set is dropped");
    let by_person = fixture.person("mail-operation-dismiss", json!({ "operation": made[1] }));
    assert_eq!(by_person["data"]["state"], "dismissed", "{by_person}");
    // Dismissed, it is not dismissed again, approved, resumed or undone.
    let again = fixture.agent(
        "a",
        "mail-operation-dismiss",
        json!({ "operation": made[0] }),
    );
    assert_eq!(again["error"]["code"], "PROPOSAL_NOT_OPEN", "{again}");
    let dummy_digest = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    let approved = fixture.person(
        "mail-operation-approve",
        json!({ "operation": made[0], "digest": dummy_digest }),
    );
    assert_eq!(approved["error"]["code"], "PROPOSAL_NOT_OPEN", "{approved}");
    // An approval taken while it was open is refused once it is dismissed.
    let digest2 = fixture.digest(&made[2]);
    let token = fixture.token(&made[2], &digest2);
    let dismissed = fixture.person("mail-operation-dismiss", json!({ "operation": made[2] }));
    assert_eq!(dismissed["data"]["state"], "dismissed", "{dismissed}");
    let late = fixture.approved_with(&made[2], &digest2, token);
    assert_eq!(late["error"]["code"], "PROPOSAL_NOT_OPEN", "{late}");
    // One that is not there is not open either (12.3), refused before any hold.
    let none = fixture.person("mail-operation-dismiss", json!({ "operation": 999 }));
    assert_eq!(none["error"]["code"], "PROPOSAL_NOT_OPEN", "{none}");
    let none = fixture.person(
        "mail-operation-approve",
        json!({ "operation": 999, "digest": dummy_digest }),
    );
    assert_eq!(none["error"]["code"], "PROPOSAL_NOT_OPEN", "{none}");
    let resumed = fixture.agent(
        "a",
        "mail-operation-resume",
        json!({ "operation": made[0] }),
    );
    assert_eq!(resumed["error"]["code"], "INVALID_INPUT", "{resumed}");
    // Three dismissed, three more fit.
    for _ in 0..3 {
        fixture.proposal("a", "mail-archive", json!({ "messages": [message] }));
    }
    let over = fixture.agent("a", "mail-archive", json!({ "messages": [message] }));
    assert_eq!(over["error"]["code"], "POLICY_LIMIT", "{over}");
    let (status, _, _) = fixture.approve(&made[0], true);
    assert_eq!(
        status, EXIT_FAILED,
        "a dismissed proposal is not asked about"
    );
    assert!(!changed_at_the_provider(&fixture));
}

#[test]
fn a_proposal_expires_after_seven_days() {
    let fixture = Fixture::new(world);
    fixture.set_policy(NOTHING_ALONE);
    let message = fixture.message("s0");
    // Proposed eight days ago, by the clock of that call.
    let clock = ManualClock::default();
    clock.set(afd::SystemClock.now() - PROPOSAL_LIFETIME - 24 * 60 * 60 * 1000);
    let mut made = Vec::new();
    for _ in 0..5 {
        let proposal = fixture.agent_at(
            "a",
            &clock,
            "mail-archive",
            json!({ "messages": [message] }),
        );
        assert_eq!(proposal["data"]["state"], "proposed", "{proposal}");
        made.push(proposal["data"]["operation"].clone());
    }
    let shown = fixture.show(&made[0]);
    assert_eq!(shown["state"], "expired", "{shown}");
    assert_eq!(shown["places"], 0);
    let approved = fixture.person(
        "mail-operation-approve",
        json!({ "operation": made[0], "digest": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }),
    );
    assert_eq!(approved["error"]["code"], "PROPOSAL_NOT_OPEN", "{approved}");
    let (status, _, _) = fixture.approve(&made[1], true);
    assert_eq!(status, EXIT_FAILED);
    assert!(!changed_at_the_provider(&fixture));
    // Expired, they no longer count against the caller's five.
    fixture.proposal("a", "mail-archive", json!({ "messages": [message] }));
}

#[test]
fn an_agents_resume_over_the_policy_is_a_proposal_and_dismissed_it_stops_again() {
    let fixture = Fixture::with_changes(
        |world_| {
            world(world_);
            world_.moves = true;
        },
        ChangeOptions {
            batch: 2,
            ..ChangeOptions::default()
        },
    );
    // The person's trash of six stops at its first batch, its answer lost.
    let ids: Vec<i64> = ["n0", "n1", "n2", "n3", "s0", "s1"]
        .iter()
        .map(|word| fixture.message(word))
        .collect();
    fixture.server.world().drop_after_doing = Some("MOVE".to_string());
    let first = fixture.person("mail-trash", json!({ "messages": ids }));
    assert_eq!(first["error"]["code"], "PROVIDER_UNAVAILABLE", "{first}");
    let id = first["error"]["details"]["operation"].clone();
    let stopped = fixture.show(&id);
    assert_eq!(stopped["state"], "stopped", "{stopped}");
    assert!(stopped["waiting"].as_u64().unwrap() > 0);
    fixture.set_policy(NOTHING_ALONE);
    let resumed = fixture.agent("a", "mail-operation-resume", json!({ "operation": id }));
    assert_eq!(resumed["data"]["state"], "proposed", "{resumed}");
    // A resume carries on; its preview counts what is left.
    let shown = fixture.show(&id);
    assert_eq!(
        shown["preview"]["byAccount"][0]["places"],
        stopped["waiting"]
    );
    let (_, _, err) = fixture.approve(&id, false);
    assert!(err.contains(&format!("Approve operation {id}: carry on operation {id}")));
    // Proposed after a change proposed later, by id, it is still named
    // first, as the newest proposal, where the person looks.
    let message = fixture.message("n0");
    fixture.proposal("b", "mail-archive", json!({ "messages": [message] }));
    std::thread::sleep(std::time::Duration::from_millis(5));
    fixture.agent("a", "mail-operation-dismiss", json!({ "operation": id }));
    fixture.agent("a", "mail-operation-resume", json!({ "operation": id }));
    let status = fixture.person("mail-status", json!({}));
    assert_eq!(
        status["data"]["operations"]["proposals"][0]["operation"], id,
        "{status}"
    );
    let listed = fixture.person(
        "mail-operation-list",
        json!({ "proposed": true, "limit": 1 }),
    );
    assert_eq!(listed["data"]["operations"][0]["operation"], id, "{listed}");
    let cursor = listed["data"]["nextCursor"].clone();
    let rest = fixture.person(
        "mail-operation-list",
        json!({ "proposed": true, "cursor": cursor }),
    );
    assert_eq!(
        rest["data"]["operations"].as_array().unwrap().len(),
        1,
        "{rest}"
    );
    assert_ne!(rest["data"]["operations"][0]["operation"], id);
    // Dismissed, it is stopped again, with what it did and when it stopped
    // kept.
    let dismissed = fixture.agent("a", "mail-operation-dismiss", json!({ "operation": id }));
    assert_eq!(dismissed["data"]["state"], "stopped", "{dismissed}");
    assert_eq!(dismissed["data"]["changed"], stopped["changed"]);
    assert_eq!(dismissed["data"]["endedAt"], stopped["endedAt"]);
    // Proposed again and approved, it runs to its end.
    fixture.agent("a", "mail-operation-resume", json!({ "operation": id }));
    let (status, out, err) = fixture.approve(&id, true);
    assert_eq!(status, EXIT_OK, "{out}{err}");
    assert_eq!(fixture.show(&id)["state"], "done");
    assert_eq!(subjects(&fixture, "Deleted Messages").len(), 6);
}

#[test]
fn an_agents_undo_over_the_policy_is_a_proposal_that_holds_the_operation() {
    let fixture = Fixture::new(world);
    let ids: Vec<i64> = ["n0", "n1", "n2"]
        .iter()
        .map(|word| fixture.message(word))
        .collect();
    let archived = fixture.person("mail-archive", json!({ "messages": ids }));
    let original = archived["data"]["operation"].clone();
    fixture.set_policy(NOTHING_ALONE);
    let undo = fixture.proposal("a", "mail-operation-undo", json!({ "operation": original }));
    let undo_id = undo["operation"].clone();
    assert_eq!(undo["undoOf"], original);
    // Proposed, it has undone nothing.
    let shown = fixture.show(&original);
    assert_eq!(shown["undoneBy"], Value::Null, "{shown}");
    // While it waits, the original is neither undone again nor carried on,
    // even by the person.
    for command in ["mail-operation-undo", "mail-operation-resume"] {
        let refused = fixture.person(command, json!({ "operation": original }));
        assert_eq!(refused["error"]["code"], "INVALID_INPUT", "{refused}");
        assert!(
            refused["error"]["message"]
                .as_str()
                .unwrap()
                .contains(&format!(
                    "operation {undo_id}, waits for the person's approval"
                )),
            "{command}: {refused}"
        );
    }
    let (status, out, err) = fixture.approve(&undo_id, true);
    assert_eq!(status, EXIT_OK, "{out}{err}");
    assert!(err.contains(&format!("undo operation {original}: put back 3 places")));
    assert_eq!(fixture.show(&original)["undoneBy"], undo_id);
    assert_eq!(subjects(&fixture, "INBOX").len(), 6);
    assert!(subjects(&fixture, "Archive").is_empty());
}

#[test]
fn mail_that_moved_before_the_approval_is_reported_and_left_alone() {
    let fixture = Fixture::new(world);
    fixture.set_policy(NOTHING_ALONE);
    let ids: Vec<i64> = ["s0", "s1"]
        .iter()
        .map(|word| fixture.message(word))
        .collect();
    let proposal = fixture.proposal("a", "mail-trash", json!({ "messages": ids }));
    // The person archives one of them meanwhile.
    let archived = fixture.person("mail-archive", json!({ "messages": [ids[0]] }));
    assert_eq!(archived["data"]["changed"], 1, "{archived}");
    let (status, out, err) = fixture.approve(&proposal["operation"], true);
    assert_eq!(status, EXIT_OK, "{out}{err}");
    let done = fixture.show(&proposal["operation"]);
    assert_eq!(done["changed"], 1, "{done}");
    assert_eq!(done["missing"], 1, "{done}");
    assert_eq!(subjects(&fixture, "Archive"), ["About s0"]);
    assert_eq!(subjects(&fixture, "Deleted Messages"), ["About s1"]);
}

#[test]
fn an_approved_proposal_too_large_for_a_call_runs_as_the_servers_work() {
    let fixture = Fixture::with_changes(
        world,
        ChangeOptions {
            batch: 1,
            inline_most: 1,
            slice: 1,
        },
    );
    fixture.set_policy(NOTHING_ALONE);
    let ids: Vec<i64> = (0..4).map(|n| fixture.message(&format!("n{n}"))).collect();
    let proposal = fixture.proposal("a", "mail-archive", json!({ "messages": ids }));
    let id = proposal["operation"].clone();
    let digest = fixture.digest(&id);
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .unwrap();
    runtime.block_on(async {
        let worker = loam_mail::work::Worker::start(&fixture.engine);
        let person = CommandContext::new()
            .with_interface(CommandInterface::Cli)
            .with_actor(ActorKind::Human);
        let run = |context: CommandContext| {
            let registry = &fixture.registry;
            let id = id.clone();
            let digest = digest.clone();
            async move {
                let result = registry
                    .execute(
                        "mail-operation-approve",
                        json!({ "operation": id, "digest": digest }),
                        Some(context),
                    )
                    .await;
                serde_json::to_value(&result).unwrap()
            }
        };
        // Held for the person's approval, then run with it.
        let held = run(person.clone()).await;
        assert_eq!(held["error"]["code"], "APPROVAL_REQUIRED", "{held}");
        let summary = held["error"]["details"]["summary"].as_str().unwrap();
        assert!(
            summary.contains("archive 4 messages, proposed by the agent with the token a"),
            "{summary}"
        );
        let token = held["error"]["details"]["approvalToken"]
            .as_str()
            .unwrap()
            .to_string();
        let approved = run(person.clone().with_approval(token)).await;
        assert_eq!(approved["data"]["state"], "running", "{approved}");
        let started = std::time::Instant::now();
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
                assert_eq!(shown["data"]["changed"], 4, "{shown}");
                break;
            }
            assert!(
                started.elapsed() < std::time::Duration::from_secs(30),
                "{shown}"
            );
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        worker.stop().await;
    });
    assert_eq!(subjects(&fixture, "Archive").len(), 4);
}

#[test]
fn the_screening_must_be_ready_for_an_approval() {
    let fixture = Fixture::new(world);
    fixture.set_policy(NOTHING_ALONE);
    let proposal = fixture.proposal(
        "a",
        "mail-archive",
        json!({ "messages": [fixture.message("s0")] }),
    );
    let id = proposal["operation"].clone();
    let digest = fixture.digest(&id);
    let token = fixture.token(&id, &digest);
    // Classes could be wrong while messages wait to be derived again.
    fixture.make_stale();
    let refused = fixture.approved_with(&id, &digest, token);
    assert_eq!(refused["error"]["code"], "SCREENING_NOT_READY", "{refused}");
    assert_eq!(fixture.show(&id)["preview"]["approvable"], false);
    let (status, _, _) = fixture.approve(&id, true);
    assert_eq!(status, EXIT_FAILED, "not asked about");
    assert!(!changed_at_the_provider(&fixture));
}

#[test]
fn a_proposal_outlives_its_selections_hour() {
    let fixture = Fixture::new(world);
    fixture.set_policy(NOTHING_ALONE);
    // Selected and proposed two hours ago.
    let clock = ManualClock::default();
    clock.set(afd::SystemClock.now() - 2 * SELECTION_LIFETIME);
    let made = fixture.agent_at(
        "a",
        &clock,
        "mail-selection-create",
        json!({ "text": "s0" }),
    );
    let (selection, count) = (
        made["data"]["selection"].clone(),
        made["data"]["count"].clone(),
    );
    let proposal = fixture.agent_at(
        "a",
        &clock,
        "mail-archive",
        json!({ "selection": selection, "expectedCount": count }),
    );
    assert_eq!(proposal["data"]["state"], "proposed", "{proposal}");
    // The selection has expired; the proposal has its own set.
    let expired = fixture.agent(
        "a",
        "mail-archive",
        json!({ "selection": selection, "expectedCount": count }),
    );
    assert_eq!(expired["error"]["code"], "SELECTION_MISMATCH", "{expired}");
    let (status, out, err) = fixture.approve(&proposal["data"]["operation"], true);
    assert_eq!(status, EXIT_OK, "{out}{err}");
    assert_eq!(subjects(&fixture, "Archive"), ["About s0"]);
}

#[test]
fn scripts_share_five_proposals_and_stdio_has_its_own() {
    let fixture = Fixture::new(world);
    fixture.set_policy(NOTHING_ALONE);
    let message = fixture.message("s0");
    for _ in 0..5 {
        let made = fixture.cli("mail-archive", json!({ "messages": [message] }));
        assert_eq!(made["data"]["state"], "proposed", "{made}");
    }
    let sixth = fixture.cli("mail-archive", json!({ "messages": [message] }));
    assert_eq!(sixth["error"]["code"], "POLICY_LIMIT", "{sixth}");
    let stdio = fixture.stdio("mail-archive", json!({ "messages": [message] }));
    assert_eq!(stdio["data"]["state"], "proposed", "{stdio}");
    assert_eq!(stdio["data"]["proposal"]["proposer"]["kind"], "agent");
    assert_eq!(stdio["data"]["proposal"]["proposer"]["token"], Value::Null);
}

#[test]
fn removing_the_account_removes_a_dismissed_undo_with_what_it_would_undo() {
    let fixture = Fixture::new(world);
    let archived = fixture.person(
        "mail-archive",
        json!({ "messages": [fixture.message("s0")] }),
    );
    let original = archived["data"]["operation"].clone();
    fixture.set_policy(NOTHING_ALONE);
    let undo = fixture.proposal("a", "mail-operation-undo", json!({ "operation": original }));
    let dismissed = fixture.agent(
        "a",
        "mail-operation-dismiss",
        json!({ "operation": undo["operation"] }),
    );
    assert_eq!(dismissed["data"]["places"], 0, "{dismissed}");
    let account = fixture.account.id;
    fixture
        .engine
        .with_store(|store| store.remove_account(account, 2).map(|_| ()))
        .unwrap();
    let listed = fixture.person("mail-operation-list", json!({}));
    assert_eq!(listed["data"]["operations"], json!([]), "{listed}");
}
