//! Screening's commands (the specification's 7.2, 7.3 and 11) over mail
//! synced from the scripted IMAP server: the mail of each class, the
//! person's decisions at the command line, an agent's suggestions over MCP
//! and the person's approval of one at the terminal, with everything that
//! came from a message labelled (12.1).

#![allow(clippy::expect_used, clippy::unwrap_used)]

mod support;

use std::sync::Arc;

use afd::{ActorKind, CommandContext, CommandInterface, CommandRegistry};
use loam_mail::cli::{Caller, EXIT_FAILED, EXIT_OK, run};
use loam_mail::secrets::InMemory;
use loam_mail::store::{Decision, Proposer, sender_id};
use serde_json::{Value, json};
use support::imap::World;
use support::synced::{Fixture, Scripted, assert_labelled, mail};

const STRANGER: &str = "stranger@example.biz";

/// Mail from a friend the person wrote to, a stranger, a list, and junk.
fn world(world: &mut World) {
    world.mailbox("INBOX", &[]);
    world.mailbox("Sent Messages", &["\\Sent"]);
    world.mailbox("Junk", &["\\Junk"]);
    world.add(
        "INBOX",
        mail(
            "Friend <friend@example.org>",
            "f1",
            "To: person@example.com\r\n",
        ),
        &[],
    );
    world.add(
        "Sent Messages",
        mail("person@example.com", "p1", "To: friend@example.org\r\n"),
        &["\\Seen"],
    );
    for number in 0..2 {
        world.add(
            "INBOX",
            mail(&format!("Stranger <{STRANGER}>"), &format!("s{number}"), ""),
            &[],
        );
    }
    for number in 0..3 {
        world.add(
            "INBOX",
            mail(
                "News <news@example.net>",
                &format!("n{number}"),
                "List-Id: <news.example.net>\r\n",
            ),
            &[],
        );
    }
    // Junk from a stranger: classed, and listed nowhere.
    world.add("Junk", mail("spam@example.biz", "j1", ""), &[]);
}

fn fixture() -> Fixture {
    Fixture::new(world)
}

impl Fixture {
    fn messages(&self, class: &str) -> Vec<Value> {
        let listed = self.agent("a", "mail-message-list", json!({ "class": class }));
        assert_eq!(listed["success"], true, "{listed}");
        assert_labelled(&listed, FROM_MESSAGES);
        listed["data"]["messages"].as_array().unwrap().clone()
    }

    fn senders_of(&self, class: &str) -> Vec<String> {
        self.messages(class)
            .iter()
            .map(|message| {
                message["content"]["sender"]["address"]
                    .as_str()
                    .unwrap()
                    .to_string()
            })
            .collect()
    }
}

const FROM_MESSAGES: &[&str] = &[
    "friend", "Friend", "stranger", "Stranger", "news", "News", "spam", "example",
];

#[test]
fn each_class_lists_its_mail_newest_first_and_junk_in_none() {
    let fixture = fixture();
    let known = fixture.messages("known");
    assert_eq!(
        fixture.senders_of("known"),
        ["friend@example.org"],
        "the person's own mail has no class"
    );
    assert_eq!(known[0]["class"], "known");
    assert_eq!(known[0]["sender"], sender_id("friend@example.org"));
    assert_eq!(fixture.senders_of("unknown"), [STRANGER, STRANGER]);
    assert_eq!(fixture.senders_of("bulk").len(), 3);
    assert!(fixture.messages("blocked").is_empty());
    // Newest first, paged by cursor.
    let page = fixture.agent(
        "a",
        "mail-message-list",
        json!({ "class": "bulk", "limit": 2 }),
    );
    let cursor = page["data"]["nextCursor"].as_str().unwrap().to_string();
    let rest = fixture.agent(
        "a",
        "mail-message-list",
        json!({ "class": "bulk", "cursor": cursor }),
    );
    let dates: Vec<i64> = page["data"]["messages"]
        .as_array()
        .unwrap()
        .iter()
        .chain(rest["data"]["messages"].as_array().unwrap())
        .map(|message| message["date"].as_i64().unwrap())
        .collect();
    assert_eq!(dates.len(), 3);
    assert!(dates.windows(2).all(|pair| pair[0] >= pair[1]), "{dates:?}");
    assert!(rest["data"]["nextCursor"].is_null());

    let refused = fixture.agent("a", "mail-message-list", json!({ "class": "spam" }));
    assert_eq!(refused["success"], false);

    // A thread's messages carry their class, and the person's own `own`.
    let thread = known[0]["thread"].clone();
    let opened = fixture.agent("a", "mail-thread-open", json!({ "thread": thread }));
    let classes: Vec<&str> = opened["data"]["messages"]
        .as_array()
        .unwrap()
        .iter()
        .map(|message| message["class"].as_str().unwrap())
        .collect();
    assert!(classes.contains(&"known"), "{opened}");
    let sent = fixture.engine.with_store(|store| {
        let account = store.accounts()?.remove(0);
        let sent = store
            .mailboxes(account.id)?
            .into_iter()
            .find(|row| row.name == "Sent Messages")
            .unwrap();
        store.list_threads(sent.id, None, 10)
    });
    let own_thread = sent.unwrap()[0].thread.0;
    let opened = fixture.agent("a", "mail-thread-open", json!({ "thread": own_thread }));
    assert_eq!(opened["data"]["messages"][0]["class"], "own", "{opened}");
}

#[test]
fn the_person_screens_at_the_command_line_and_an_agent_cannot() {
    let fixture = fixture();
    let stranger = sender_id(STRANGER);
    let over_mcp = fixture.agent(
        "a",
        "mail-sender-screen",
        json!({ "sender": stranger, "decision": "out" }),
    );
    assert_eq!(over_mcp["success"], false, "{over_mcp}");
    // Nor a script at the command line, such as an agent's shell.
    let by_a_script = fixture.cli(
        "mail-sender-screen",
        json!({ "sender": stranger, "decision": "out" }),
    );
    assert_eq!(
        by_a_script["error"]["code"], "PERSON_REQUIRED",
        "{by_a_script}"
    );
    assert!(fixture.senders_of("blocked").is_empty());

    let screened = fixture.person(
        "mail-sender-screen",
        json!({ "sender": stranger, "decision": "out" }),
    );
    assert_eq!(screened["success"], true, "{screened}");
    assert_eq!(
        screened["data"],
        json!({ "sender": stranger, "decision": "out", "previous": "undecided", "changed": 2 })
    );
    assert_eq!(fixture.senders_of("blocked"), [STRANGER, STRANGER]);
    assert!(fixture.senders_of("unknown").is_empty());
    let undone = fixture.person(
        "mail-sender-screen",
        json!({ "sender": stranger, "decision": "undecided" }),
    );
    assert_eq!(undone["data"]["previous"], "out");
    assert_eq!(fixture.senders_of("unknown").len(), 2);

    // An address typed in full, such as one of the person's.
    let mine = fixture.person(
        "mail-sender-screen",
        json!({ "address": " Stranger@Example.BIZ ", "decision": "mine" }),
    );
    assert_eq!(mine["data"]["sender"], stranger, "{mine}");
    assert!(fixture.senders_of("unknown").is_empty());
    let shown = fixture.cli("mail-sender-show", json!({ "sender": stranger }));
    assert_eq!(shown["data"]["decision"]["decision"], "mine", "{shown}");
    fixture.person(
        "mail-sender-screen",
        json!({ "sender": stranger, "decision": "undecided" }),
    );
    assert_eq!(fixture.senders_of("unknown").len(), 2);

    // An account's address the person also said is theirs is still never
    // screened in or out.
    let mine = fixture.person(
        "mail-sender-screen",
        json!({ "address": "person@example.com", "decision": "mine" }),
    );
    assert_eq!(mine["success"], true, "{mine}");
    for (input, code) in [
        (
            json!({ "address": "person@example.com", "decision": "in" }),
            "INVALID_INPUT",
        ),
        (
            json!({ "address": "person@example.com", "decision": "out" }),
            "INVALID_INPUT",
        ),
        (
            json!({ "sender": stranger, "address": STRANGER, "decision": "in" }),
            "INVALID_INPUT",
        ),
        (json!({ "decision": "in" }), "INVALID_INPUT"),
        (
            json!({ "address": "nobody", "decision": "in" }),
            "INVALID_INPUT",
        ),
        (json!({ "sender": 1, "decision": "in" }), "SENDER_NOT_FOUND"),
        (
            json!({ "sender": stranger, "decision": "maybe" }),
            "VALIDATION_ERROR",
        ),
    ] {
        let refused = fixture.person("mail-sender-screen", input.clone());
        assert_eq!(refused["error"]["code"], code, "{input}: {refused}");
    }
}

#[test]
fn an_agent_s_suggestion_waits_for_the_person_s_approval_at_the_terminal() {
    let fixture = fixture();
    let stranger = sender_id(STRANGER);
    let suggested = fixture.agent(
        "token-a",
        "mail-sender-suggest",
        json!({ "sender": stranger, "decision": "out" }),
    );
    assert_eq!(suggested["success"], true, "{suggested}");
    let id = suggested["data"]["suggestion"].as_i64().unwrap();
    // It changes no class.
    assert_eq!(fixture.senders_of("unknown").len(), 2);
    let listed = fixture.agent("a", "mail-sender-list", json!({ "suggested": true }));
    let senders: Vec<&Value> = listed["data"]["senders"]
        .as_array()
        .unwrap()
        .iter()
        .map(|sender| &sender["sender"])
        .collect();
    assert_eq!(senders, [&json!(stranger)], "{listed}");

    // The preview: the sender in a labelled part, the suggestion, its
    // proposer, how many held messages change class, and whether the person
    // has written to it.
    let preview = fixture.agent("a", "mail-sender-show", json!({ "suggestion": id }));
    assert_eq!(preview["success"], true, "{preview}");
    assert_labelled(&preview, FROM_MESSAGES);
    let data = &preview["data"];
    assert_eq!(data["content"]["address"], STRANGER);
    assert_eq!(data["preview"]["decision"], "out");
    assert_eq!(data["preview"]["changes"], 2);
    assert_eq!(data["preview"]["writtenTo"], false);
    assert_eq!(data["preview"]["proposer"]["token"], "token-a");
    assert_eq!(
        data["classes"],
        json!({ "blocked": 0, "known": 0, "bulk": 0, "unknown": 2 })
    );
    assert_eq!(data["suggestions"][0]["suggestion"], id);

    // An agent cannot accept; a script cannot either, with no one to ask.
    let accepted = fixture.agent("a", "mail-sender-accept", json!({ "suggestion": id }));
    assert_eq!(accepted["success"], false, "{accepted}");
    let input = format!(r#"{{"suggestion": {id}}}"#);
    let args = ["mail-sender-accept", input.as_str()];
    let mut out = Vec::new();
    let mut err = Vec::new();
    let status = run(
        &args.map(ToString::to_string),
        &fixture.registry,
        Caller::Script,
        &InMemory::default(),
        &mut out,
        &mut err,
    )
    .unwrap();
    assert_eq!(status, EXIT_FAILED);
    assert!(String::from_utf8_lossy(&out).contains("PERSON_REQUIRED"));

    // The person says no: nothing changes.
    let (status, _, said, asked) = fixture.terminal(&args, false);
    assert_eq!(status, EXIT_FAILED);
    assert_eq!(asked.len(), 1);
    assert!(said.contains("Nothing was done"), "{said}");
    assert_eq!(fixture.senders_of("unknown").len(), 2);

    // The person reads the preview and says yes. The summary holds no
    // address; the lines before it name each value from mail as such.
    let (status, printed, said, _) = fixture.terminal(&args, true);
    assert_eq!(status, EXIT_OK, "{printed}{said}");
    let summary = said
        .lines()
        .find(|line| line.starts_with("Accept suggestion"))
        .unwrap();
    assert_eq!(
        summary,
        format!("Accept suggestion {id}: block 1 sender; 2 held messages change class.")
    );
    assert!(!summary.contains("example"), "{summary}");
    assert!(
        said.contains(&format!(
            "The sender's address, as written in its mail: {STRANGER}"
        )),
        "{said}"
    );
    assert!(
        said.contains("The sender's name, as written in its mail: Stranger"),
        "{said}"
    );
    assert!(said.contains("You have never written to it."), "{said}");
    assert!(
        said.contains("Suggested by the agent with the token token-a."),
        "{said}"
    );
    let result: Value = serde_json::from_str(&printed).unwrap();
    assert_eq!(result["data"]["decision"], "out");
    assert_eq!(result["data"]["changed"], 2);
    assert_eq!(fixture.senders_of("blocked"), [STRANGER, STRANGER]);

    // Once only, and the block is seen in the status, with who proposed it.
    let again = fixture.person("mail-sender-show", json!({ "suggestion": id }));
    assert_eq!(again["data"]["preview"]["acceptable"], false, "{again}");
    assert_eq!(again["data"]["preview"]["refusal"], "PROPOSAL_NOT_OPEN");
    let (status, _, said, asked) = fixture.terminal(&args, true);
    assert_eq!(status, EXIT_FAILED, "{said}");
    assert!(asked.is_empty(), "not asked again: {asked:?}");
    assert!(said.contains("Nothing was done"), "{said}");
    let status = fixture.agent("a", "mail-status", json!({}));
    assert_labelled(&status, FROM_MESSAGES);
    let screening = &status["data"]["screening"];
    assert_eq!(screening["ready"], true, "{status}");
    assert_eq!(screening["suggestionsWaiting"], 0);
    assert_eq!(screening["queue"], json!({ "messages": 0, "senders": 0 }));
    let blocked = &screening["blockedLately"][0];
    assert_eq!(blocked["sender"], stranger);
    assert_eq!(blocked["by"]["kind"], "suggestion");
    assert_eq!(blocked["by"]["suggestion"], id);
    assert_eq!(blocked["by"]["proposer"]["token"], "token-a");
    assert_eq!(blocked["content"]["address"], STRANGER);
}

#[test]
fn a_suggestion_is_dismissed_by_the_person_or_its_proposer_alone() {
    let fixture = fixture();
    let stranger = sender_id(STRANGER);
    let suggest = |token: &str| {
        fixture.agent(
            token,
            "mail-sender-suggest",
            json!({ "sender": stranger, "decision": "in" }),
        )["data"]["suggestion"]
            .as_i64()
            .unwrap()
    };
    let a = suggest("token-a");
    let by_another = fixture.agent("token-b", "mail-sender-dismiss", json!({ "suggestion": a }));
    assert_eq!(by_another["error"]["code"], "FORBIDDEN", "{by_another}");
    let by_its_own = fixture.agent("token-a", "mail-sender-dismiss", json!({ "suggestion": a }));
    assert_eq!(by_its_own["data"]["state"], "dismissed", "{by_its_own}");
    let twice = fixture.agent("token-a", "mail-sender-dismiss", json!({ "suggestion": a }));
    assert_eq!(twice["error"]["code"], "PROPOSAL_NOT_OPEN");
    let b = suggest("token-b");
    let by_the_person = fixture.person("mail-sender-dismiss", json!({ "suggestion": b }));
    assert_eq!(
        by_the_person["data"]["state"], "dismissed",
        "{by_the_person}"
    );
    let missing = fixture.cli("mail-sender-dismiss", json!({ "suggestion": 999 }));
    assert_eq!(missing["error"]["code"], "PROPOSAL_NOT_OPEN");
    let no_sender = fixture.agent(
        "token-a",
        "mail-sender-suggest",
        json!({ "sender": 1, "decision": "in" }),
    );
    assert_eq!(no_sender["error"]["code"], "SENDER_NOT_FOUND");
}

#[test]
fn a_caller_with_twenty_suggestions_waiting_is_refused_a_twenty_first() {
    let fixture = fixture();
    fixture
        .engine
        .with_store(|store| {
            for number in 0..20 {
                store.suggest(
                    &format!("s{number}@example.org"),
                    Decision::Out,
                    &Proposer {
                        kind: "agent".to_string(),
                        id: Some("token-a".to_string()),
                    },
                    20,
                    0,
                )?;
            }
            Ok(())
        })
        .unwrap();
    let refused = fixture.agent(
        "token-a",
        "mail-sender-suggest",
        json!({ "sender": sender_id(STRANGER), "decision": "out" }),
    );
    assert_eq!(refused["error"]["code"], "POLICY_LIMIT", "{refused}");
    let another = fixture.agent(
        "token-b",
        "mail-sender-suggest",
        json!({ "sender": sender_id(STRANGER), "decision": "out" }),
    );
    assert_eq!(another["success"], true, "{another}");
}

#[test]
fn screening_waits_while_messages_wait_to_be_derived_again() {
    let fixture = fixture();
    let id = fixture.agent(
        "token-a",
        "mail-sender-suggest",
        json!({ "sender": sender_id(STRANGER), "decision": "out" }),
    )["data"]["suggestion"]
        .as_i64()
        .unwrap();
    fixture.make_stale();
    let listed = fixture.agent("a", "mail-message-list", json!({ "class": "unknown" }));
    assert_eq!(listed["error"]["code"], "SCREENING_NOT_READY", "{listed}");
    assert_eq!(listed["error"]["retryable"], true);
    let waiting = fixture.agent("a", "mail-sender-list", json!({ "waiting": true }));
    assert_eq!(waiting["error"]["code"], "SCREENING_NOT_READY");
    let shown = fixture.agent("a", "mail-sender-show", json!({ "suggestion": id }));
    assert_eq!(shown["data"]["classes"], Value::Null, "{shown}");
    assert_eq!(shown["data"]["preview"]["changes"], Value::Null);
    // The person is not asked: the preview's counts could be wrong.
    assert_eq!(shown["data"]["preview"]["acceptable"], false);
    assert_eq!(shown["data"]["preview"]["refusal"], "SCREENING_NOT_READY");
    let input = format!(r#"{{"suggestion": {id}}}"#);
    let (status, _, said, asked) = fixture.terminal(&["mail-sender-accept", input.as_str()], true);
    assert_eq!(status, EXIT_FAILED, "{said}");
    assert!(asked.is_empty(), "{asked:?}");
    let status = fixture.agent("a", "mail-status", json!({}));
    assert_eq!(status["data"]["screening"]["ready"], false);
    assert_eq!(status["data"]["screening"]["queue"], Value::Null);
    // The person's own decision is recorded whatever waits.
    let screened = fixture.person(
        "mail-sender-screen",
        json!({ "sender": sender_id(STRANGER), "decision": "in" }),
    );
    assert_eq!(screened["success"], true, "{screened}");

    // Once derived again, screening is read.
    let synced = fixture.cli("mail-sync", json!({}));
    assert_eq!(synced["success"], true, "{synced}");
    assert_eq!(fixture.senders_of("known").len(), 3);
}

#[test]
fn stdio_s_one_caller_dismisses_its_own_and_a_script_only_its_own() {
    let fixture = fixture();
    let stranger = sender_id(STRANGER);
    let suggestion = |result: Value| result["data"]["suggestion"].as_i64().unwrap();
    let by_stdio = suggestion(fixture.stdio(
        "mail-sender-suggest",
        json!({ "sender": stranger, "decision": "out" }),
    ));
    let shown = fixture.person("mail-sender-show", json!({ "suggestion": by_stdio }));
    assert_eq!(
        shown["data"]["preview"]["proposer"],
        json!({ "kind": "agent", "token": null, "name": null })
    );
    let by_agent = fixture.agent(
        "token-a",
        "mail-sender-dismiss",
        json!({ "suggestion": by_stdio }),
    );
    assert_eq!(by_agent["error"]["code"], "FORBIDDEN", "{by_agent}");
    let by_script = fixture.cli("mail-sender-dismiss", json!({ "suggestion": by_stdio }));
    assert_eq!(by_script["error"]["code"], "FORBIDDEN", "{by_script}");
    let own = fixture.stdio("mail-sender-dismiss", json!({ "suggestion": by_stdio }));
    assert_eq!(own["data"]["state"], "dismissed", "{own}");
    // A script's suggestion is a script's to dismiss.
    let by_a_script = suggestion(fixture.cli(
        "mail-sender-suggest",
        json!({ "sender": stranger, "decision": "in" }),
    ));
    let own = fixture.cli("mail-sender-dismiss", json!({ "suggestion": by_a_script }));
    assert_eq!(own["data"]["state"], "dismissed", "{own}");
}

#[test]
fn every_accept_is_held_and_an_approved_one_is_refused_when_it_cannot_go_ahead() {
    let fixture = fixture();
    let id = fixture.agent(
        "token-a",
        "mail-sender-suggest",
        json!({ "sender": sender_id(STRANGER), "decision": "out" }),
    )["data"]["suggestion"]
        .as_i64()
        .unwrap();
    // Held whatever it names, so the person's approval is checked every time.
    for suggestion in [id, 999] {
        let held = fixture.person("mail-sender-accept", json!({ "suggestion": suggestion }));
        assert_eq!(held["error"]["code"], "APPROVAL_REQUIRED", "{held}");
        assert!(
            !held["error"]["details"]["summary"]
                .as_str()
                .unwrap()
                .contains("example"),
            "{held}"
        );
    }
    // Past the approval (a registry with no approval middleware runs the
    // handler as an approved call does), what cannot go ahead is refused.
    let bare = CommandRegistry::new();
    bare.register(loam_mail::screening::accept(Arc::clone(&fixture.engine)))
        .unwrap();
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let approved = |suggestion: i64| {
        let context = CommandContext::new()
            .with_interface(CommandInterface::Cli)
            .with_actor(ActorKind::Human);
        let result = runtime.block_on(bare.execute(
            "mail-sender-accept",
            json!({ "suggestion": suggestion }),
            Some(context),
        ));
        serde_json::to_value(&result).unwrap()
    };
    fixture.make_stale();
    let refused = approved(id);
    assert_eq!(refused["error"]["code"], "SCREENING_NOT_READY", "{refused}");
    assert_eq!(approved(999)["error"]["code"], "PROPOSAL_NOT_OPEN");
    let synced = fixture.cli("mail-sync", json!({}));
    assert_eq!(synced["success"], true, "{synced}");
    assert_eq!(fixture.senders_of("unknown").len(), 2, "nothing changed");
    assert_eq!(approved(id)["data"]["decision"], "out");
    assert_eq!(approved(id)["error"]["code"], "PROPOSAL_NOT_OPEN", "once");
}

/// Runs commands as the registry does, but fails the preview of an accept.
struct NoPreview<'a>(&'a CommandRegistry);

#[async_trait::async_trait]
impl loam_mail::cli::Runner for NoPreview<'_> {
    async fn run(
        &self,
        name: &str,
        input: Value,
        terminal: bool,
        approval: Option<String>,
    ) -> afd::CommandResult<Value> {
        if name == "mail-sender-show" {
            return afd::failure(afd::CommandError::new("STORE_FAILED", "the store refused"));
        }
        loam_mail::cli::Local(self.0)
            .run(name, input, terminal, approval)
            .await
    }
}

#[test]
fn the_person_is_not_asked_to_accept_without_the_preview() {
    let fixture = fixture();
    let id = fixture.agent(
        "token-a",
        "mail-sender-suggest",
        json!({ "sender": sender_id(STRANGER), "decision": "out" }),
    )["data"]["suggestion"]
        .as_i64()
        .unwrap();
    let input = format!(r#"{{"suggestion": {id}}}"#);
    let args = ["mail-sender-accept".to_string(), input];
    let (mut out, mut err) = (Vec::new(), Vec::new());
    let mut person = Scripted {
        approve: true,
        asked: Vec::new(),
        typed: std::collections::VecDeque::new(),
    };
    let status = loam_mail::cli::run_on(
        &args,
        &fixture.registry,
        &NoPreview(&fixture.registry),
        Caller::Terminal(&mut person),
        &InMemory::default(),
        &mut out,
        &mut err,
    )
    .unwrap();
    assert_eq!(status, EXIT_FAILED);
    assert!(person.asked.is_empty(), "{:?}", person.asked);
    assert!(String::from_utf8_lossy(&err).contains("Nothing was done"));
    assert_eq!(fixture.senders_of("unknown").len(), 2);
}

#[test]
fn the_status_names_the_latest_blocks_and_the_list_gives_them_all() {
    let fixture = fixture();
    for address in [STRANGER, "news@example.net"] {
        let screened = fixture.person(
            "mail-sender-screen",
            json!({ "address": address, "decision": "out" }),
        );
        assert_eq!(screened["success"], true, "{screened}");
    }
    let status = fixture.agent("a", "mail-status", json!({}));
    let screening = &status["data"]["screening"];
    assert_eq!(screening["blockedLatelyTotal"], 2, "{status}");
    assert_eq!(screening["blockedLately"].as_array().unwrap().len(), 2);
    assert_eq!(screening["blockedLately"][0]["by"]["kind"], "person");
    let blocked = fixture.agent("a", "mail-sender-list", json!({ "decision": "out" }));
    let mut senders: Vec<i64> = blocked["data"]["senders"]
        .as_array()
        .unwrap()
        .iter()
        .map(|sender| sender["sender"].as_i64().unwrap())
        .collect();
    senders.sort_unstable();
    let mut expected = vec![sender_id(STRANGER), sender_id("news@example.net")];
    expected.sort_unstable();
    assert_eq!(senders, expected, "{blocked}");
    let admitted = fixture.agent("a", "mail-sender-list", json!({ "decision": "in" }));
    assert!(admitted["data"]["senders"].as_array().unwrap().is_empty());
    let waiting = fixture.agent("a", "mail-sender-list", json!({ "waiting": true }));
    assert!(
        waiting["data"]["senders"].as_array().unwrap().is_empty(),
        "{waiting}"
    );
}
