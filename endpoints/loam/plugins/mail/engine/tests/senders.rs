//! The sender commands (the specification's 7.1 and section 11) over mail
//! synced from the scripted IMAP server: who the person wrote to and
//! answered, as a sync of the inbox and the sent mailbox finds it, paged and
//! filtered, with everything that came from a message labelled (12.1).

#![allow(clippy::expect_used, clippy::unwrap_used)]

mod support;

use std::sync::Arc;

use afd::{CommandContext, CommandInterface, CommandRegistry};
use loam_mail::engine::Engine;
use loam_mail::home::Home;
use loam_mail::provider::imap::{Credentials, Endpoint, ICLOUD_NAMES, ImapConnector};
use loam_mail::store::{AccountRow, sender_id};
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

struct Fixture {
    _directory: tempfile::TempDir,
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
            world.mailbox("Archive", &[]);
            world.add(
                "INBOX",
                mail(
                    "Ada Lovelace <ada@example.org>",
                    "a1",
                    "To: person@example.com\r\n",
                ),
                &[],
            );
            world.add(
                "Archive",
                mail("ada@example.org", "a2", "List-Id: <club.example.org>\r\n"),
                &[],
            );
            world.add(
                "Sent Messages",
                mail(
                    "person@example.com",
                    "p1",
                    "To: ada@example.org\r\nCc: Bea <bea@example.net>\r\nIn-Reply-To: <a1@example.org>\r\n",
                ),
                &["\\Seen"],
            );
            for number in 0..3 {
                world.add(
                    "INBOX",
                    mail(
                        "Shop <deals@shop.example.co.uk>",
                        &format!("d{number}"),
                        "List-Unsubscribe: <https://shop.example.co.uk/u>\r\n",
                    ),
                    &[],
                );
            }
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
            _directory: directory,
            _server: server,
            engine,
            registry,
        }
    }

    fn call(&self, name: &str, input: Value, interface: CommandInterface) -> Value {
        let context = CommandContext::new().with_interface(interface);
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let result = runtime.block_on(self.registry.execute(name, input, Some(context)));
        serde_json::to_value(&result).unwrap()
    }

    fn cli(&self, name: &str, input: Value) -> Value {
        self.call(name, input, CommandInterface::Cli)
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
    "ada", "Ada", "bea", "Bea", "shop", "Shop", "club", "example",
];

#[test]
fn senders_are_listed_with_what_the_person_wrote_and_answered() {
    let fixture = Fixture::new();
    let all = fixture.call("mail-sender-list", json!({}), CommandInterface::Mcp);
    assert_eq!(all["success"], true, "{all}");
    assert_labelled(&all, FROM_MESSAGES);
    let senders = all["data"]["senders"].as_array().unwrap();
    let by_address = |address: &str| {
        senders
            .iter()
            .find(|sender| sender["content"]["address"] == address)
            .unwrap_or_else(|| panic!("{address} in {all}"))
            .clone()
    };
    assert_eq!(senders.len(), 3, "the person is not listed: {all}");
    let ada = by_address("ada@example.org");
    assert_eq!(ada["sender"], sender_id("ada@example.org"));
    assert_eq!(
        (
            &ada["messages"],
            &ada["bulk"],
            &ada["written"],
            &ada["answered"]
        ),
        (&json!(2), &json!(1), &json!(1), &json!(1))
    );
    assert_eq!(ada["content"]["domain"], "example.org");
    let bea = by_address("bea@example.net");
    assert_eq!((&bea["messages"], &bea["written"]), (&json!(0), &json!(1)));
    let shop = by_address("deals@shop.example.co.uk");
    assert_eq!((&shop["bulk"], &shop["written"]), (&json!(3), &json!(0)));
    assert_eq!(shop["content"]["domain"], "example.co.uk");
    assert_eq!(shop["content"]["name"], "Shop");

    let written = fixture.cli("mail-sender-list", json!({ "writtenTo": true }));
    assert_eq!(written["data"]["senders"].as_array().unwrap().len(), 2);
    let domain = fixture.cli("mail-sender-list", json!({ "domain": " Example.CO.UK " }));
    assert_eq!(domain["data"]["senders"].as_array().unwrap().len(), 1);

    // A page at a time, by cursor, in the same order.
    let mut seen = Vec::new();
    let mut cursor = Value::Null;
    loop {
        let mut input = json!({ "limit": 1 });
        if !cursor.is_null() {
            input["cursor"] = cursor.clone();
        }
        let page = fixture.cli("mail-sender-list", input);
        assert_labelled(&page, FROM_MESSAGES);
        seen.extend(
            page["data"]["senders"]
                .as_array()
                .unwrap()
                .iter()
                .map(|sender| sender["sender"].clone()),
        );
        cursor = page["data"]["nextCursor"].clone();
        if cursor.is_null() {
            break;
        }
    }
    let listed: Vec<Value> = senders
        .iter()
        .map(|sender| sender["sender"].clone())
        .collect();
    assert_eq!(seen, listed);

    for (input, code) in [
        (json!({ "writtenTo": "yes" }), "VALIDATION_ERROR"),
        (json!({ "domain": 7 }), "VALIDATION_ERROR"),
        (json!({ "cursor": "nonsense" }), "INVALID_INPUT"),
    ] {
        let refused = fixture.cli("mail-sender-list", input);
        assert_eq!(refused["error"]["code"], code, "{refused}");
    }
}

#[test]
fn a_sender_is_shown_with_its_mailboxes_and_lists() {
    let fixture = Fixture::new();
    let ada = sender_id("ada@example.org");
    let shown = fixture.call(
        "mail-sender-show",
        json!({ "sender": ada }),
        CommandInterface::Mcp,
    );
    assert_eq!(shown["success"], true, "{shown}");
    assert_labelled(&shown, FROM_MESSAGES);
    let data = &shown["data"];
    assert_eq!(data["sender"], ada);
    assert_eq!(data["content"]["address"], "ada@example.org");
    assert_eq!(
        data["content"]["lists"],
        json!([{ "list": "club.example.org", "messages": 1 }])
    );
    let mailboxes = fixture
        .engine
        .with_store(|store| {
            let account = store.accounts()?.remove(0);
            store.mailboxes(account.id)
        })
        .unwrap();
    let id_of = |name: &str| mailboxes.iter().find(|row| row.name == name).unwrap().id.0;
    let mut places: Vec<(i64, i64)> = data["mailboxes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|place| {
            (
                place["mailbox"].as_i64().unwrap(),
                place["messages"].as_i64().unwrap(),
            )
        })
        .collect();
    places.sort_unstable();
    let mut expected = vec![(id_of("INBOX"), 1), (id_of("Archive"), 1)];
    expected.sort_unstable();
    assert_eq!(places, expected);

    let missing = fixture.cli("mail-sender-show", json!({ "sender": 1 }));
    assert_eq!(missing["error"]["code"], "SENDER_NOT_FOUND");
    let no_id = fixture.cli("mail-sender-show", json!({}));
    assert_eq!(no_id["error"]["code"], "INVALID_INPUT");
}
