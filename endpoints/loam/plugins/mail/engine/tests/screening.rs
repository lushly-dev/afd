//! Screening's commands (the specification's 7.2, 7.3 and 11) over mail
//! synced from the scripted IMAP server: the mail of each class, the
//! person's decisions at the command line, an agent's suggestions over MCP
//! and the person's approval of one at the terminal, with everything that
//! came from a message labelled (12.1).

#![allow(clippy::expect_used, clippy::unwrap_used)]

mod support;

use std::sync::Arc;

use afd::{Actor, ActorKind, CommandContext, CommandInterface, CommandRegistry};
use loam_mail::cli::{Caller, EXIT_FAILED, EXIT_OK, Person, run};
use loam_mail::engine::Engine;
use loam_mail::home::Home;
use loam_mail::provider::imap::{Credentials, Endpoint, ICLOUD_NAMES, ImapConnector};
use loam_mail::secrets::InMemory;
use loam_mail::store::{AccountRow, Decision, Proposer, sender_id};
use loam_mail::sync::{Options, sync_account};
use serde_json::{Value, json};
use support::imap::{PASSWORD, Server, USER};

fn mail(from: &str, id: &str, fields: &str) -> Vec<u8> {
    format!(
        "From: {from}\r\nMessage-ID: <{id}@example.org>\r\nSubject: About {id}\r\n{fields}\
         Content-Type: text/plain\r\n\r\nWords of {id}.\r\n"
    )
    .into_bytes()
}

const STRANGER: &str = "stranger@example.biz";

struct Fixture {
    directory: tempfile::TempDir,
    _server: Server,
    engine: Arc<Engine>,
    registry: CommandRegistry,
}

impl Fixture {
    fn new() -> Self {
        let directory = tempfile::tempdir().unwrap();
        let server = Server::start(true, true);
        {
            let mut world = server.world();
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
        let endpoint = Endpoint {
            host: "127.0.0.1".to_string(),
            port: server.address.port(),
            tls: false,
        };
        let connector = ImapConnector::new(endpoint, ICLOUD_NAMES, |_| {
            Ok(Credentials {
                user: USER.to_string(),
                password: PASSWORD.to_string(),
            })
        });
        let engine = Arc::new(
            Engine::new(Some(Home::at(directory.path().join("data"))))
                .with_connector(Arc::new(connector))
                .with_sync_options(Options {
                    backoff: std::time::Duration::ZERO,
                    ..Options::default()
                }),
        );
        let account: AccountRow = engine
            .with_store(|store| {
                store.add_account("icloud", USER, 0)?;
                Ok(store.accounts()?.remove(0))
            })
            .unwrap();
        let registry = loam_mail::registry(&engine).unwrap();
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let connector = Arc::clone(engine.connector().unwrap());
        runtime
            .block_on(sync_account(
                &engine,
                connector.as_ref(),
                &account,
                engine.sync_options(),
                &afd::SystemClock,
                &|_| {},
            ))
            .unwrap();
        Self {
            directory,
            _server: server,
            engine,
            registry,
        }
    }

    fn execute(&self, name: &str, input: Value, context: CommandContext) -> Value {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let result = runtime.block_on(self.registry.execute(name, input, Some(context)));
        serde_json::to_value(&result).unwrap()
    }

    /// A call from the agent whose token has id `token`, over MCP.
    fn agent(&self, token: &str, name: &str, input: Value) -> Value {
        let context = CommandContext::new()
            .with_interface(CommandInterface::Mcp)
            .with_actor(Actor::new(ActorKind::Agent).with_id(token));
        self.execute(name, input, context)
    }

    /// A call at the command line, from a script.
    fn cli(&self, name: &str, input: Value) -> Value {
        let context = CommandContext::new()
            .with_interface(CommandInterface::Cli)
            .with_actor(ActorKind::Script);
        self.execute(name, input, context)
    }

    /// Runs the command line as a person at a terminal who answers
    /// `approve`; returns the status, standard output and error.
    fn terminal(&self, args: &[&str], approve: bool) -> (u8, String, String, Vec<String>) {
        let args: Vec<String> = args.iter().map(ToString::to_string).collect();
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let mut person = Scripted {
            approve,
            asked: Vec::new(),
        };
        let status = run(
            &args,
            &self.registry,
            Caller::Terminal(&mut person),
            &InMemory::default(),
            &mut out,
            &mut err,
        )
        .unwrap();
        (
            status,
            String::from_utf8(out).unwrap(),
            String::from_utf8(err).unwrap(),
            person.asked,
        )
    }

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

    /// Marks every message as derived by an older derivation, as an upgrade
    /// of the derivation does, through a connection of its own.
    fn make_stale(&self) {
        let database = self.directory.path().join("data").join("mail.sqlite3");
        let connection = rusqlite::Connection::open(database).unwrap();
        connection
            .execute("UPDATE envelope SET parser = parser - 1", [])
            .unwrap();
    }
}

struct Scripted {
    approve: bool,
    asked: Vec<String>,
}

impl Person for Scripted {
    fn confirm(&mut self, question: &str) -> std::io::Result<bool> {
        self.asked.push(question.to_string());
        Ok(self.approve)
    }

    fn secret(&mut self, prompt: &str) -> std::io::Result<String> {
        self.asked.push(prompt.to_string());
        Ok(String::new())
    }
}

/// Every string that came from a message sits under a part labelled
/// `"trust": "content"`.
fn assert_labelled(value: &Value, words: &[&str]) {
    fn walk(value: &Value, inside: bool, words: &[&str], path: &str) {
        match value {
            Value::String(text) => {
                for word in words {
                    assert!(
                        inside || !text.contains(word),
                        "`{word}` outside content at {path}"
                    );
                }
            }
            Value::Array(items) => {
                for (index, item) in items.iter().enumerate() {
                    walk(item, inside, words, &format!("{path}[{index}]"));
                }
            }
            Value::Object(fields) => {
                let labelled = inside || fields.get("trust") == Some(&json!("content"));
                for (key, item) in fields {
                    walk(item, labelled, words, &format!("{path}.{key}"));
                }
            }
            _ => {}
        }
    }
    walk(value, false, words, "");
}

const FROM_MESSAGES: &[&str] = &[
    "friend", "Friend", "stranger", "Stranger", "news", "News", "spam", "example",
];

#[test]
fn each_class_lists_its_mail_newest_first_and_junk_in_none() {
    let fixture = Fixture::new();
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
    let fixture = Fixture::new();
    let stranger = sender_id(STRANGER);
    let over_mcp = fixture.agent(
        "a",
        "mail-sender-screen",
        json!({ "sender": stranger, "decision": "out" }),
    );
    assert_eq!(over_mcp["success"], false, "{over_mcp}");
    assert!(fixture.senders_of("blocked").is_empty());

    let screened = fixture.cli(
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
    let undone = fixture.cli(
        "mail-sender-screen",
        json!({ "sender": stranger, "decision": "undecided" }),
    );
    assert_eq!(undone["data"]["previous"], "out");
    assert_eq!(fixture.senders_of("unknown").len(), 2);

    // An address typed in full, such as one of the person's.
    let mine = fixture.cli(
        "mail-sender-screen",
        json!({ "address": " Stranger@Example.BIZ ", "decision": "mine" }),
    );
    assert_eq!(mine["data"]["sender"], stranger, "{mine}");
    assert!(fixture.senders_of("unknown").is_empty());
    let shown = fixture.cli("mail-sender-show", json!({ "sender": stranger }));
    assert_eq!(shown["data"]["decision"]["decision"], "mine", "{shown}");
    fixture.cli(
        "mail-sender-screen",
        json!({ "sender": stranger, "decision": "undecided" }),
    );
    assert_eq!(fixture.senders_of("unknown").len(), 2);

    for (input, code) in [
        (
            json!({ "address": "person@example.com", "decision": "in" }),
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
        let refused = fixture.cli("mail-sender-screen", input.clone());
        assert_eq!(refused["error"]["code"], code, "{input}: {refused}");
    }
}

#[test]
fn an_agent_s_suggestion_waits_for_the_person_s_approval_at_the_terminal() {
    let fixture = Fixture::new();
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
    let again = fixture.cli("mail-sender-accept", json!({ "suggestion": id }));
    assert_eq!(again["error"]["code"], "PROPOSAL_NOT_OPEN", "{again}");
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
    let fixture = Fixture::new();
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
    let by_the_person = fixture.cli("mail-sender-dismiss", json!({ "suggestion": b }));
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
    let fixture = Fixture::new();
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
    let fixture = Fixture::new();
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
    // Accepting is refused without asking the person: the preview's counts
    // could be wrong.
    let accepted = fixture.cli("mail-sender-accept", json!({ "suggestion": id }));
    assert_eq!(
        accepted["error"]["code"], "SCREENING_NOT_READY",
        "{accepted}"
    );
    let status = fixture.agent("a", "mail-status", json!({}));
    assert_eq!(status["data"]["screening"]["ready"], false);
    assert_eq!(status["data"]["screening"]["queue"], Value::Null);
    // The person's own decision is recorded whatever waits.
    let screened = fixture.cli(
        "mail-sender-screen",
        json!({ "sender": sender_id(STRANGER), "decision": "in" }),
    );
    assert_eq!(screened["success"], true, "{screened}");

    // Once derived again, screening is read.
    let synced = fixture.cli("mail-sync", json!({}));
    assert_eq!(synced["success"], true, "{synced}");
    assert_eq!(fixture.senders_of("known").len(), 3);
}
