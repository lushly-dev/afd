//! An engine whose one account is synced from the scripted IMAP server, and
//! the callers a test calls its commands as: an agent over MCP, stdio's one
//! caller, a script and the person at the command line.

#![allow(dead_code, clippy::expect_used, clippy::unwrap_used)]

use std::sync::Arc;

use afd::{Actor, ActorKind, CommandContext, CommandInterface, CommandRegistry};
use loam_mail::cli::{Caller, Person, run};
use loam_mail::engine::Engine;
use loam_mail::home::Home;
use loam_mail::operate::ChangeOptions;
use loam_mail::provider::imap::{Credentials, Endpoint, ICLOUD_NAMES, ImapConnector};
use loam_mail::provider::smtp::{SmtpEndpoint, SmtpSender};
use loam_mail::secrets::InMemory;
use loam_mail::store::AccountRow;
use loam_mail::sync::{Options, sync_account};
use serde_json::{Value, json};

use super::imap::{PASSWORD, Server, USER, World};
use super::smtp::SmtpServer;

/// A plain message from `from` with the id `id` and the header lines
/// `fields`, each ending in a line break.
pub fn mail(from: &str, id: &str, fields: &str) -> Vec<u8> {
    format!(
        "From: {from}\r\nMessage-ID: <{id}@example.org>\r\nSubject: About {id}\r\n{fields}\
         Content-Type: text/plain\r\n\r\nWords of {id}.\r\n"
    )
    .into_bytes()
}

pub struct Fixture {
    pub directory: tempfile::TempDir,
    pub server: Server,
    pub smtp: SmtpServer,
    pub engine: Arc<Engine>,
    pub registry: CommandRegistry,
    pub account: AccountRow,
}

impl Fixture {
    /// The engine after one sync of the mailboxes `world` makes.
    pub fn new(world: impl FnOnce(&mut World)) -> Self {
        Self::with_changes(world, ChangeOptions::default())
    }

    /// [`Fixture::new`], with operations sized by `change`.
    pub fn with_changes(world: impl FnOnce(&mut World), change: ChangeOptions) -> Self {
        let directory = tempfile::tempdir().unwrap();
        let server = Server::start(true, true);
        let smtp = SmtpServer::start();
        world(&mut server.world());
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
        let sender = SmtpSender::new(
            SmtpEndpoint::plain("127.0.0.1", smtp.address.port()),
            |_| {
                Ok(Credentials {
                    user: USER.to_string(),
                    password: PASSWORD.to_string(),
                })
            },
        );
        let engine = Arc::new(
            Engine::new(Some(Home::at(directory.path().join("data"))))
                .with_connector(Arc::new(connector))
                .with_sender(Arc::new(sender))
                .with_sync_options(Options {
                    backoff: std::time::Duration::ZERO,
                    ..Options::default()
                })
                .with_change_options(change),
        );
        let account: AccountRow = engine
            .with_store(|store| {
                store.add_account("icloud", USER, 0)?;
                Ok(store.accounts()?.remove(0))
            })
            .unwrap();
        let registry = loam_mail::registry(&engine).unwrap();
        let fixture = Self {
            directory,
            server,
            smtp,
            engine,
            registry,
            account,
        };
        fixture.sync();
        fixture
    }

    /// Syncs the account again, as a pass does.
    pub fn sync(&self) {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let connector = Arc::clone(self.engine.connector().unwrap());
        runtime
            .block_on(sync_account(
                &self.engine,
                connector.as_ref(),
                &self.account,
                self.engine.sync_options(),
                &afd::SystemClock,
                &|_| {},
            ))
            .unwrap();
    }

    pub fn execute(&self, name: &str, input: Value, context: CommandContext) -> Value {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let result = runtime.block_on(self.registry.execute(name, input, Some(context)));
        serde_json::to_value(&result).unwrap()
    }

    /// A call from the agent whose token has id `token`, over MCP.
    pub fn agent(&self, token: &str, name: &str, input: Value) -> Value {
        let context = CommandContext::new()
            .with_interface(CommandInterface::Mcp)
            .with_actor(Actor::new(ActorKind::Agent).with_id(token));
        self.execute(name, input, context)
    }

    /// A call from the person at a terminal.
    pub fn person(&self, name: &str, input: Value) -> Value {
        let context = CommandContext::new()
            .with_interface(CommandInterface::Cli)
            .with_actor(ActorKind::Human);
        self.execute(name, input, context)
    }

    /// A call over MCP from stdio's one caller, which has no actor.
    pub fn stdio(&self, name: &str, input: Value) -> Value {
        let context = CommandContext::new().with_interface(CommandInterface::Mcp);
        self.execute(name, input, context)
    }

    /// A call at the command line, from a script.
    pub fn cli(&self, name: &str, input: Value) -> Value {
        let context = CommandContext::new()
            .with_interface(CommandInterface::Cli)
            .with_actor(ActorKind::Script);
        self.execute(name, input, context)
    }

    /// Runs the command line as a person at a terminal who answers
    /// `approve`; returns the status, standard output and error, and what
    /// the person was asked.
    pub fn terminal(&self, args: &[&str], approve: bool) -> (u8, String, String, Vec<String>) {
        self.terminal_typing(args, approve, &[])
    }

    /// [`Fixture::terminal`], also answering each `type_text` prompt in order
    /// from `typed`.
    pub fn terminal_typing(
        &self,
        args: &[&str],
        approve: bool,
        typed: &[&str],
    ) -> (u8, String, String, Vec<String>) {
        let args: Vec<String> = args.iter().map(ToString::to_string).collect();
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let mut person = Scripted {
            approve,
            asked: Vec::new(),
            typed: typed.iter().map(ToString::to_string).collect(),
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

    /// Marks every message as derived by an older derivation, as an upgrade
    /// of the derivation does, through a connection of its own.
    pub fn make_stale(&self) {
        let database = self.directory.path().join("data").join("mail.sqlite3");
        let connection = rusqlite::Connection::open(database).unwrap();
        connection
            .execute("UPDATE envelope SET parser = parser - 1", [])
            .unwrap();
    }
}

/// A person at a terminal who answers every question `approve`.
pub struct Scripted {
    pub approve: bool,
    pub asked: Vec<String>,
    pub typed: std::collections::VecDeque<String>,
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

    fn type_text(&mut self, prompt: &str) -> std::io::Result<String> {
        self.asked.push(prompt.to_string());
        Ok(self.typed.pop_front().unwrap_or_default())
    }
}

/// Every string that came from a message sits under a part labelled
/// `"trust": "content"`: none outside one holds any of `words`.
pub fn assert_labelled(value: &Value, words: &[&str]) {
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
